/**
 * Phase 12 Sprint 12.0 — unified RAG baseline runner.
 *
 * Orchestrates all 4 retrieval surfaces (lessons / code / chunks / global)
 * against their respective golden sets, records per-query outcomes + latency
 * samples, and emits a pair of artifacts:
 *   - docs/qc/baselines/YYYY-MM-DD-<tag>.json (archived, machine-readable)
 *   - docs/qc/baselines/YYYY-MM-DD-<tag>.md   (scorecard, human-readable)
 *
 * Intended as a "nail": every downstream Phase-12 sprint runs the same command
 * and then diff's the resulting archive against a prior tag (diffBaselines.ts).
 *
 * Usage:
 *   npx tsx src/qc/runBaseline.ts --tag phase-12-sprint-0
 *   npx tsx src/qc/runBaseline.ts --tag smoke --samples 1 --k 10
 */

import * as dotenv from 'dotenv';
import fs from 'node:fs/promises';
import path from 'node:path';
import { execSync } from 'node:child_process';

import { Client as McpClient } from '@modelcontextprotocol/sdk/client/index.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';

import {
  recallAtK,
  mrr,
  ndcgAtK,
  duplicationRateAtK,
  latencySummary,
  coveragePct,
  nearSemanticKey,
} from './metrics.js';
import type { GradedHit } from './metrics.js';
import type { GoldenQuery, GoldenSet, Surface } from './goldenTypes.js';
import { normalizePath } from './goldenTypes.js';
import {
  callLessons,
  callCode,
  callChunks,
  callGlobal,
  type SurfaceResult,
} from './surfaces.js';
import {
  computeNoiseFloor,
  fmtNoiseFloorValue,
  type NoiseFloorPerSurface,
} from './noiseFloor.js';
import { runGenPipeline, allTemplateHashes, type AnswererConfig } from './genPipeline.js';
import { scoreOnce, type JudgeRequest, type MetricName } from './judge.js';
import type {
  GenResult,
  GenManifest,
  GenSurfaceAggregate,
  GenMetricSummary,
} from './genEvalTypes.js';
import { DEFAULT_THRESHOLDS } from './genEvalTypes.js';

dotenv.config();

const SCHEMA_VERSION = '1.1'; // Sprint 16.3: bumped from 1.0 — added generation block
const DEFAULT_SAMPLES = 3;
const DEFAULT_K = 10;
const DEFAULT_OUT_DIR = 'docs/qc/baselines';

const MCP_URL = process.env.MCP_SERVER_URL?.trim() || 'http://localhost:3000/mcp';
const API_URL = process.env.API_BASE_URL?.trim() || 'http://localhost:3001';

/** Where each surface's golden set lives. */
const GOLDEN_FILES: Record<Surface, string> = {
  lessons: 'qc/lessons-queries.json',
  code: 'qc/queries.json',
  chunks: 'qc/chunks-queries.json',
  global: 'qc/global-queries.json',
};

// ------------------------------- CLI parsing -------------------------------

function parseArgs(argv: string[]) {
  const args = new Map<string, string>();
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i]!;
    if (a.startsWith('--')) {
      const key = a.replace(/^--/, '');
      const next = argv[i + 1];
      if (next !== undefined && !next.startsWith('--')) {
        args.set(key, next);
        i++;
      } else {
        args.set(key, 'true');
      }
    }
  }
  const tag = args.get('tag') ?? 'untagged';
  const k = Number(args.get('k') ?? DEFAULT_K);
  const samples = Number(args.get('samples') ?? DEFAULT_SAMPLES);
  const outDir = args.get('out') ?? DEFAULT_OUT_DIR;
  const surfacesFilter = (args.get('surfaces') ?? 'lessons,code,chunks,global')
    .split(',')
    .map((s) => s.trim() as Surface);
  // Sprint 12.0.2: --control flag runs the goldenset TWICE back-to-back and
  // embeds a per-metric noise-floor in the archive. Lets downstream diffs
  // distinguish real signal from measurement-jitter without requiring
  // operators to run and track a separate control archive by hand.
  const control = args.get('control') === 'true' || args.get('control') === '1';

  // Sprint 16.3: gen-eval flags.
  //  auto = run when row has ideal_answer (default)
  //  on   = error if row has no ideal_answer and gen-eval is enabled (strict)
  //  off  = skip gen-eval entirely (retrieval-only, like the pre-16.3 default)
  const genEval = (args.get('gen-eval') ?? 'auto') as 'auto' | 'on' | 'off';
  const judgeUrl = args.get('judge-url') ?? process.env.RAGAS_JUDGE_URL ?? 'http://localhost:3005';
  const topKContexts = Number(args.get('top-k-contexts') ?? 5);
  // Limit per-surface row count — useful for smoke runs.
  const maxRowsRaw = args.get('max-rows');
  const maxRows = maxRowsRaw ? Number(maxRowsRaw) : null;

  return {
    tag,
    k,
    samples,
    outDir,
    surfacesFilter,
    control,
    genEval,
    judgeUrl,
    topKContexts,
    maxRows,
  };
}

// ----------------------- Target-matching per surface -----------------------

/** Produce a set of normalized keys (same normalization as SurfaceItem.key)
 *  that, when matched against item.key, constitute a "hit". */
function targetKeysFor(surface: Surface, q: GoldenQuery): Set<string> {
  const out = new Set<string>();
  if (surface === 'lessons') {
    for (const id of q.target_lesson_ids ?? []) out.add(id.toLowerCase());
  } else if (surface === 'code') {
    for (const p of q.target_files ?? []) out.add(normalizePath(p));
  } else if (surface === 'chunks') {
    for (const id of q.target_chunk_ids ?? []) out.add(id);
  } else {
    for (const t of q.target_any ?? []) out.add(`${t.type}:${t.id.toLowerCase()}`);
  }
  return out;
}

/** Path-suffix match for code surface. Safer than `.includes()` which would
 *  false-positive (e.g. target `src/index.ts` matching item `src/routes/index.ts`).
 *  Requires either exact match or a `/`-bounded suffix match in either
 *  direction. Other surfaces use exact key equality only. */
function matchKey(surface: Surface, itemKey: string, targets: Set<string>): boolean {
  if (targets.has(itemKey)) return true;
  if (surface === 'code') {
    for (const t of targets) {
      if (itemKey.endsWith('/' + t)) return true;
      if (t.endsWith('/' + itemKey)) return true;
    }
  }
  return false;
}

// --------------------------- Per-query evaluation --------------------------

type PerQuery = {
  id: string;
  group: string;
  query: string;
  top_k_keys: string[];
  top_k_titles: (string | undefined)[];
  /** Sprint 12.0.1: snippet passthrough required for near-semantic
   *  dup-rate v1. Truncated to 300 chars in archive to bound JSON size
   *  while still preserving enough context for diagnosis of friction
   *  cases (200 was cutting mid-sentence on long docs). */
  top_k_snippets: (string | undefined)[];
  found_ranks: number[];            // 1-based ranks of target hits within top-k
  graded_hits_in_rank_order: GradedHit[];
  latency_ms_samples: number[];
  latency_ms_median: number;
  has_relevant_hit_in_top_k: boolean;
  /** All friction classes that apply to this query. Empty array ⇒ either
   *  `clean` (non-adversarial, hit found) or `—` (adversarial intentional miss).
   *  A query can belong to multiple classes (e.g. duplicate-domination AND
   *  rank-order-inversion). */
  friction_classes: string[];
  error?: string;
  /** Sprint 16.3: gen-eval result, attached only when the row had an
   *  ideal_answer AND gen-eval was enabled for this run. */
  generation?: GenResult;
};

/** Run the adapter N times to measure latency under repeated calls. We use
 *  the *last* run's items for ranking — determinism is verified in Phase 9
 *  VERIFY, so all runs return identical ordering in practice. If retrieval
 *  becomes non-deterministic (e.g. embeddings jitter under load), upgrade
 *  to mode-of-N consensus. Today's choice is "arbitrary but consistent." */
async function runSamples<T extends SurfaceResult>(
  fn: () => Promise<T>,
  samples: number,
): Promise<{ last: T; latencies: number[] }> {
  let last: T | undefined;
  const latencies: number[] = [];
  for (let i = 0; i < samples; i++) {
    const r = await fn();
    latencies.push(r.latencyMs);
    last = r;
  }
  return { last: last!, latencies };
}

async function evalQuery(
  surface: Surface,
  dispatch: (query: string, k: number) => Promise<SurfaceResult>,
  q: GoldenQuery,
  k: number,
  samples: number,
  genEval?: GenEvalConfig,
): Promise<PerQuery> {
  const { last, latencies } = await runSamples(() => dispatch(q.query, k), samples);
  const topK = last.items.slice(0, k);
  const targets = targetKeysFor(surface, q);
  const mustKw = (q.must_keywords ?? []).map((s) => s.toLowerCase());

  const found_ranks: number[] = [];
  const graded: GradedHit[] = [];
  for (let i = 0; i < topK.length; i++) {
    const item = topK[i]!;
    const hit = matchKey(surface, item.key, targets);
    if (hit) {
      found_ranks.push(i + 1);
      // Grade 2 = strong hit (all must_keywords present in title or snippet).
      // Grade 1 = weak hit (target matched but keywords missing — may be
      // a wrong-snippet-chunk or a stale index).
      if (mustKw.length === 0) {
        graded.push(2);
      } else {
        const text = `${item.title ?? ''} ${item.snippet ?? ''}`.toLowerCase();
        graded.push(mustKw.every((kw) => text.includes(kw)) ? 2 : 1);
      }
    } else {
      graded.push(0);
    }
  }

  const sortedLat = [...latencies].sort((a, b) => a - b);
  const median = sortedLat.length
    ? sortedLat[Math.floor((sortedLat.length - 1) / 2)]!
    : 0;

  const has_relevant_hit_in_top_k = found_ranks.length > 0;
  const friction_classes = classifyFriction({
    targetCount: targets.size,
    topKLen: topK.length,
    foundRanks: found_ranks,
    dupRate: duplicationRateAtK(topK, k),
    error: last.error,
  });

  // Sprint 16.3: gen-eval pipeline runs after retrieval, only when:
  //   1. gen-eval is enabled (auto/on)
  //   2. row has an ideal_answer (means it's a gen-eval-tagged row)
  //   3. retrieval didn't error
  let generation: GenResult | undefined = undefined;
  const shouldGenEval =
    genEval !== undefined &&
    genEval.mode !== 'off' &&
    q.ideal_answer !== undefined &&
    !last.error;
  if (shouldGenEval && genEval) {
    generation = await runGenEvalForRow(surface, q, topK, genEval);
  } else if (genEval?.mode === 'on' && q.ideal_answer === undefined) {
    // Strict mode: row missing ideal_answer is a hard error
    generation = {
      generated_answer: '',
      contexts_used: [],
      prompt_used: '',
      synth_ms: 0,
      judge_ms: 0,
      scores: {},
      error: 'gen-eval=on but row has no ideal_answer',
    };
  }

  return {
    id: q.id,
    group: q.group,
    query: q.query,
    top_k_keys: topK.map((x) => x.key),
    top_k_titles: topK.map((x) => x.title),
    top_k_snippets: topK.map((x) => (x.snippet ? x.snippet.slice(0, 300) : undefined)),
    found_ranks,
    graded_hits_in_rank_order: graded,
    latency_ms_samples: latencies,
    latency_ms_median: median,
    has_relevant_hit_in_top_k,
    friction_classes,
    error: last.error,
    ...(generation ? { generation } : {}),
  };
}

// Sprint 16.3: gen-eval helpers

type GenEvalConfig = {
  mode: 'auto' | 'on' | 'off';
  judgeUrl: string;
  judgeTimeoutMs: number;
  answerer: AnswererConfig;
  topKContexts: number;
};

/** Run synth + judge for a single row. Errors are captured into GenResult.error
 *  so they don't fail the whole baseline. */
async function runGenEvalForRow(
  surface: Surface,
  q: GoldenQuery,
  retrievalHits: SurfaceResult['items'],
  cfg: GenEvalConfig,
): Promise<GenResult> {
  // 1. Synthesize an answer using the top-K retrieval hits.
  const synthRes = await runGenPipeline(
    {
      surface,
      question: q.query,
      retrievalHits,
      topK: cfg.topKContexts,
    },
    cfg.answerer,
  );

  // Synth failed → return error result without judge call.
  if (synthRes.error) {
    return {
      generated_answer: synthRes.generated_answer,
      contexts_used: synthRes.contexts_used,
      prompt_used: synthRes.prompt_used,
      synth_ms: synthRes.synth_ms,
      judge_ms: 0,
      scores: {},
      error: synthRes.error,
    };
  }

  // 2. Route metrics: standard set for most categories; refusal_correctness
  // added by sidecar for no_answer rows (server-side routing).
  const requestedMetrics: MetricName[] = [
    'faithfulness',
    'answer_relevancy',
    'context_precision',
    'context_recall',
    // Phase 17 Sprint 17.1: second judge of groundedness, single-call.
    // Divergence vs faithfulness is a signal worth investigating.
    'groundedness_self_eval',
  ];

  const judgeReq: JudgeRequest = {
    request_id: `${surface}/${q.id}`,
    question: q.query,
    answer: synthRes.generated_answer,
    contexts: synthRes.contexts_used.map((c) => ({
      id: c.key,
      text: c.snippet_preview ?? '',
    })),
    ground_truth: q.ideal_answer,
    answer_category: q.answer_category,
    metrics: requestedMetrics,
    options: { include_reasons: true },
  };

  const t0 = Date.now();
  try {
    const judgeRes = await scoreOnce(judgeReq, {
      baseUrl: cfg.judgeUrl,
      timeoutMs: cfg.judgeTimeoutMs,
    });
    const judge_ms = Date.now() - t0;
    return {
      generated_answer: synthRes.generated_answer,
      contexts_used: synthRes.contexts_used,
      prompt_used: synthRes.prompt_used,
      synth_ms: synthRes.synth_ms,
      judge_ms,
      scores: judgeRes.scores,
      reasons: Object.keys(judgeRes.reasons).length ? judgeRes.reasons : undefined,
      skipped: judgeRes.skipped.length ? judgeRes.skipped : undefined,
      skip_reason: judgeRes.skip_reason ?? undefined,
      fail_reasons: detectFailReasons(judgeRes.scores),
    };
  } catch (err) {
    const judge_ms = Date.now() - t0;
    return {
      generated_answer: synthRes.generated_answer,
      contexts_used: synthRes.contexts_used,
      prompt_used: synthRes.prompt_used,
      synth_ms: synthRes.synth_ms,
      judge_ms,
      scores: {},
      error: `judge_failed: ${err instanceof Error ? err.message : String(err)}`,
    };
  }
}

function detectFailReasons(scores: Record<string, number | null>): string[] {
  const fails: string[] = [];
  const t = DEFAULT_THRESHOLDS;
  if (scores.faithfulness !== null && scores.faithfulness !== undefined && scores.faithfulness < t.faithfulness_min) {
    fails.push(`faithfulness<${t.faithfulness_min}`);
  }
  if (scores.answer_relevancy !== null && scores.answer_relevancy !== undefined && scores.answer_relevancy < t.answer_relevancy_min) {
    fails.push(`answer_relevancy<${t.answer_relevancy_min}`);
  }
  if (scores.context_precision !== null && scores.context_precision !== undefined && scores.context_precision < t.context_precision_min) {
    fails.push(`context_precision<${t.context_precision_min}`);
  }
  if (scores.context_recall !== null && scores.context_recall !== undefined && scores.context_recall < t.context_recall_min) {
    fails.push(`context_recall<${t.context_recall_min}`);
  }
  if (scores.refusal_correctness !== null && scores.refusal_correctness !== undefined && scores.refusal_correctness < t.refusal_correctness_min) {
    fails.push(`refusal_correctness<${t.refusal_correctness_min}`);
  }
  if (
    scores.groundedness_self_eval !== null &&
    scores.groundedness_self_eval !== undefined &&
    scores.groundedness_self_eval < t.groundedness_self_eval_min
  ) {
    fails.push(`groundedness_self_eval<${t.groundedness_self_eval_min}`);
  }
  return fails;
}

// ---------------------------- Friction classifier --------------------------

/** Classify all friction classes that apply to a single query's outcome.
 *  Returns an empty array when no friction is observed. A query can belong
 *  to multiple classes simultaneously (duplicate-domination + rank-order-inversion). */
function classifyFriction(p: {
  targetCount: number;
  topKLen: number;
  foundRanks: number[];
  dupRate: number;
  error?: string;
}): string[] {
  const classes: string[] = [];
  if (p.error) classes.push('retrieval-error');
  if (p.topKLen === 0) classes.push('empty-result-set');
  // Adversarial-miss queries (no target) are intentional negatives; nothing
  // below this point makes sense for them.
  if (p.targetCount === 0) return classes;
  if (p.foundRanks.length === 0) classes.push('no-relevant-hit');
  if (p.dupRate >= 0.3) classes.push('duplicate-domination');
  if (p.foundRanks.length > 0) {
    const best = Math.min(...p.foundRanks);
    if (best > 3 && p.dupRate < 0.3) classes.push('rank-order-inversion');
  }
  return classes;
}

// ----------------------- Per-surface aggregation ---------------------------

type SurfaceAggregate = {
  query_count: number;
  errors: number;
  /** Project id the golden set was evaluated against. Per-surface to
   *  preserve provenance when surfaces target different projects
   *  (e.g. lessons→free-context-hub vs code→qc-free-context-hub). */
  project_id: string;
  /** Sprint 16.3: gen-eval rollup, present when at least one row produced
   *  numeric scores. Null for retrieval-only baselines. */
  generation?: GenSurfaceAggregate;
  metrics: {
    recall_at_5: number; recall_at_10: number;
    mrr: number;
    ndcg_at_5: number; ndcg_at_10: number;
    duplication_rate_at_10: number;
    /** Sprint 12.0.1 v1 dup-rate: keys on normalized title+snippet[:100].
     *  Catches same-title-different-UUID and timestamp-variant fixture
     *  clusters that the v0 metric misses. */
    duplication_rate_nearsemantic_at_10: number;
    coverage_pct: number;
    /** Null when the surface has zero latency samples (e.g. zero queries).
     *  Distinguishable from "0ms ultra-fast" in the scorecard and diff. */
    latency_p50_ms: number | null;
    latency_p95_ms: number | null;
    latency_mean_ms: number | null;
  };
  per_query: PerQuery[];
};

function aggregateGen(perQuery: PerQuery[]): GenSurfaceAggregate | undefined {
  const withGen = perQuery.filter((q) => q.generation !== undefined);
  if (!withGen.length) return undefined;

  const judged = withGen.filter((q) => !q.generation!.error);
  const rows_with_gt = withGen.length;
  const rows_judged = judged.length;
  const rows_skipped = perQuery.length - withGen.length;

  // Collect each metric's values across all judged rows.
  const byMetric: Record<string, number[]> = {};
  for (const q of judged) {
    const scores = q.generation!.scores;
    for (const [m, v] of Object.entries(scores)) {
      if (v === null || v === undefined || !Number.isFinite(v)) continue;
      (byMetric[m] = byMetric[m] ?? []).push(v);
    }
  }

  const metrics: Record<string, GenMetricSummary> = {};
  const t = DEFAULT_THRESHOLDS;
  for (const [m, vals] of Object.entries(byMetric)) {
    if (!vals.length) continue;
    const mean = vals.reduce((a, b) => a + b, 0) / vals.length;
    const variance = vals.reduce((a, b) => a + (b - mean) ** 2, 0) / vals.length;
    const std = Math.sqrt(variance);
    const sorted = [...vals].sort((a, b) => a - b);
    const p10 = sorted[Math.max(0, Math.floor(sorted.length * 0.1))]!;

    let threshold = 0;
    if (m === 'faithfulness') threshold = t.faithfulness_min;
    else if (m === 'answer_relevancy') threshold = t.answer_relevancy_min;
    else if (m === 'context_precision') threshold = t.context_precision_min;
    else if (m === 'context_recall') threshold = t.context_recall_min;
    else if (m === 'refusal_correctness') threshold = t.refusal_correctness_min;
    else if (m === 'groundedness_self_eval') threshold = t.groundedness_self_eval_min;
    const fail_count = vals.filter((v) => v < threshold).length;

    metrics[m] = {
      mean: round(mean),
      std: round(std),
      p10: round(p10),
      fail_count,
    };
  }

  return { rows_with_gt, rows_judged, rows_skipped, metrics };
}

function aggregate(perQuery: PerQuery[], projectId: string): SurfaceAggregate {
  const n = perQuery.length;
  const errors = perQuery.filter((q) => !!q.error).length;

  const withTargets = perQuery.filter((q) => {
    // Exclude adversarial-miss queries (no targets) from quality-metric averages.
    // Keep them in coverage% (expected negatives) and latency (stack load).
    return q.group !== 'adversarial-miss';
  });
  const nWithTargets = Math.max(withTargets.length, 1);

  const sumRecall5 = withTargets.reduce((a, q) => a + recallAtK(q.found_ranks, 5), 0);
  const sumRecall10 = withTargets.reduce((a, q) => a + recallAtK(q.found_ranks, 10), 0);
  const sumMrr = withTargets.reduce((a, q) => a + mrr(q.found_ranks), 0);
  const sumNdcg5 = withTargets.reduce((a, q) => a + ndcgAtK(q.graded_hits_in_rank_order, 5), 0);
  const sumNdcg10 = withTargets.reduce((a, q) => a + ndcgAtK(q.graded_hits_in_rank_order, 10), 0);

  // dup-rate averaged across *all* queries (including adversarial) because
  // duplicate-domination is a retrieval pathology independent of whether the
  // answer is present.
  // v0: key = entity id (exact match only; UUIDs)
  const sumDup = perQuery.reduce(
    (a, q) => a + duplicationRateAtK(q.top_k_keys.map((k) => ({ key: k })), 10),
    0,
  );
  // v1 (Sprint 12.0.1): key = normalized title+snippet[:100] — catches
  // same-title-different-UUID and timestamp-variant fixture clusters.
  const sumDupNearSem = perQuery.reduce((a, q) => {
    const items = q.top_k_titles.map((title, i) => ({
      key: nearSemanticKey(title, q.top_k_snippets[i]),
    }));
    return a + duplicationRateAtK(items, 10);
  }, 0);

  // Coverage: "should-hit" queries that did hit. Adversarial-miss excluded so
  // the percentage isn't artificially inflated by intentional zero-target queries.
  const coverageBools = withTargets.map((q) => q.has_relevant_hit_in_top_k);

  const allSamples = perQuery.flatMap((q) => q.latency_ms_samples);
  const lat = latencySummary(allSamples);

  const gen = aggregateGen(perQuery);

  return {
    query_count: n,
    errors,
    project_id: projectId,
    ...(gen ? { generation: gen } : {}),
    metrics: {
      recall_at_5: round(sumRecall5 / nWithTargets),
      recall_at_10: round(sumRecall10 / nWithTargets),
      mrr: round(sumMrr / nWithTargets),
      ndcg_at_5: round(sumNdcg5 / nWithTargets),
      ndcg_at_10: round(sumNdcg10 / nWithTargets),
      duplication_rate_at_10: round(sumDup / Math.max(n, 1)),
      duplication_rate_nearsemantic_at_10: round(sumDupNearSem / Math.max(n, 1)),
      coverage_pct: round(coveragePct(coverageBools)),
      // C1: null when no latency samples; distinct from "0ms instant"
      latency_p50_ms: lat.n === 0 ? null : Math.round(lat.p50),
      latency_p95_ms: lat.n === 0 ? null : Math.round(lat.p95),
      latency_mean_ms: lat.n === 0 ? null : Math.round(lat.mean),
    },
    per_query: perQuery,
  };
}

function round(x: number): number {
  return Math.round(x * 10000) / 10000;
}

// ------------------------------ Markdown render ----------------------------

function fmtMetric(v: number | null): string {
  return v === null ? '—' : String(v);
}

function renderMarkdown(archive: BaselineArchive): string {
  const { tag, git_commit, git_branch, run_started_at, elapsed_ms, project_id, surfaces, noise_floor, gen_manifest } = archive;
  const lines: string[] = [];
  lines.push('---');
  lines.push(`tag: ${tag}`);
  lines.push(`commit: ${git_commit}`);
  lines.push(`branch: ${git_branch}`);
  lines.push(`run_at: ${run_started_at}`);
  lines.push(`elapsed_ms: ${elapsed_ms}`);
  lines.push(`project_id_primary: ${project_id}`);
  lines.push('---');
  lines.push('');
  lines.push(`# RAG Baseline — ${tag}`);
  lines.push('');

  // Sprint 16.3: gen-eval manifest section.
  if (gen_manifest) {
    lines.push('## Gen-eval manifest');
    lines.push('');
    lines.push(`- **answerer:** \`${gen_manifest.answerer_model_id}\` @ \`${gen_manifest.answerer_endpoint}\` (temp=${gen_manifest.answerer_temperature}, seed=${gen_manifest.answerer_seed}, max_tokens=${gen_manifest.answerer_max_tokens})`);
    lines.push(`- **judge:** \`${gen_manifest.judge_model_id}\` @ \`${gen_manifest.judge_endpoint}\``);
    if (gen_manifest.judge_prompts_hash) {
      lines.push(`- **judge prompts hash:** \`${gen_manifest.judge_prompts_hash}\``);
    }
    lines.push(`- **synthesizer template hashes:**`);
    for (const [s, h] of Object.entries(gen_manifest.synthesizer_prompt_hashes)) {
      lines.push(`  - ${s}: \`${h}\``);
    }
    lines.push('');
  }

  lines.push('## Summary (all surfaces)');
  lines.push('');
  lines.push('| Surface | Project | Q | err | recall@5 | recall@10 | MRR | nDCG@5 | nDCG@10 | dup@10 | dup@10 nearsem | cov% | p50 ms | p95 ms |');
  lines.push('|---|---|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|');
  for (const [s, a] of Object.entries(surfaces)) {
    if (!a) continue;
    const m = a.metrics;
    lines.push(
      `| ${s} | ${a.project_id} | ${a.query_count} | ${a.errors} | ${m.recall_at_5} | ${m.recall_at_10} | ${m.mrr} | ${m.ndcg_at_5} | ${m.ndcg_at_10} | ${m.duplication_rate_at_10} | ${m.duplication_rate_nearsemantic_at_10} | ${m.coverage_pct} | ${fmtMetric(m.latency_p50_ms)} | ${fmtMetric(m.latency_p95_ms)} |`,
    );
  }
  lines.push('');

  // Sprint 16.3: per-surface gen-eval rollup table (if any surface has gen data).
  const surfacesWithGen = Object.entries(surfaces).filter(([, a]) => a?.generation);
  if (surfacesWithGen.length > 0) {
    lines.push('## Gen-eval summary (per surface)');
    lines.push('');
    lines.push('| Surface | rows w/ gt | rows judged | faithfulness | answer_relevancy | context_precision | context_recall | refusal_correctness | groundedness_self_eval |');
    lines.push('|---|---:|---:|---:|---:|---:|---:|---:|---:|');
    const fmtGen = (m?: GenMetricSummary): string => {
      if (!m) return '—';
      return `${m.mean.toFixed(2)} ±${m.std.toFixed(2)}${m.fail_count > 0 ? ` (${m.fail_count} fail)` : ''}`;
    };
    for (const [s, a] of surfacesWithGen) {
      const g = a!.generation!;
      lines.push(
        `| ${s} | ${g.rows_with_gt} | ${g.rows_judged} | ${fmtGen(g.metrics.faithfulness)} | ${fmtGen(g.metrics.answer_relevancy)} | ${fmtGen(g.metrics.context_precision)} | ${fmtGen(g.metrics.context_recall)} | ${fmtGen(g.metrics.refusal_correctness)} | ${fmtGen(g.metrics.groundedness_self_eval)} |`,
      );
    }
    lines.push('');
    lines.push(`_Thresholds (WARN-only): faithfulness ≥ ${DEFAULT_THRESHOLDS.faithfulness_min} · answer_relevancy ≥ ${DEFAULT_THRESHOLDS.answer_relevancy_min} · context_precision ≥ ${DEFAULT_THRESHOLDS.context_precision_min} · context_recall ≥ ${DEFAULT_THRESHOLDS.context_recall_min} · refusal_correctness ≥ ${DEFAULT_THRESHOLDS.refusal_correctness_min} · groundedness_self_eval ≥ ${DEFAULT_THRESHOLDS.groundedness_self_eval_min}_`);
    lines.push('');

    // Fail-list: per-surface failing rows
    lines.push('### Gen-eval threshold violations');
    lines.push('');
    let totalFails = 0;
    for (const [s, a] of surfacesWithGen) {
      const failing = a!.per_query.filter((q) => q.generation?.fail_reasons && q.generation.fail_reasons.length > 0);
      if (failing.length === 0) continue;
      totalFails += failing.length;
      lines.push(`**${s}** (${failing.length}):`);
      for (const q of failing.slice(0, 5)) {
        lines.push(`  - \`${q.id}\` — ${q.generation!.fail_reasons!.join(', ')}`);
      }
      if (failing.length > 5) lines.push(`  - _(+${failing.length - 5} more)_`);
      lines.push('');
    }
    if (totalFails === 0) lines.push('_(none — all judged rows met threshold)_');
    lines.push('');
  }

  for (const [s, a] of Object.entries(surfaces)) {
    if (!a) continue;
    lines.push(`## ${s} — per-query detail`);
    lines.push('');
    lines.push('| id | group | found@ | friction | p50 ms |');
    lines.push('|---|---|---|---|---:|');
    for (const q of a.per_query) {
      const found = q.found_ranks.length ? q.found_ranks.join(',') : '—';
      const friction = q.friction_classes.length
        ? q.friction_classes.join(';')
        : q.has_relevant_hit_in_top_k
        ? 'clean'
        : '—';
      lines.push(`| ${q.id} | ${q.group} | ${found} | ${friction} | ${q.latency_ms_median} |`);
    }
    lines.push('');
  }

  lines.push('## Friction observed (top examples)');
  lines.push('');
  const frictionExamples: string[] = [];
  let totalFlagged = 0;
  for (const [s, a] of Object.entries(surfaces)) {
    if (!a) continue;
    const flagged = a.per_query.filter((q) => q.friction_classes.length > 0);
    totalFlagged += flagged.length;
    for (const q of flagged.slice(0, 3)) {
      frictionExamples.push(
        `- **${s}/${q.id}** — ${q.friction_classes.join('; ')}: query \`${q.query.slice(0, 80)}\`; top-3 keys=[${q.top_k_keys.slice(0, 3).join(', ')}]`,
      );
    }
  }
  if (frictionExamples.length === 0) {
    lines.push('_(none flagged by heuristic classifier)_');
  } else {
    lines.push(
      `_(showing up to 3 per surface; ${totalFlagged} total queries have flagged friction across all surfaces)_`,
    );
    lines.push('');
    lines.push(...frictionExamples);
  }
  lines.push('');

  // Sprint 12.0.2: when --control was used, render the noise-floor table
  // so readers know how much each metric moves across back-to-back runs on
  // the same code. Future diffs compare |delta| vs this table (MED-1).
  if (noise_floor) {
    lines.push('## Noise floor (|control − new| per metric, same code, back-to-back runs)');
    lines.push('');
    lines.push(
      '| Surface | recall@5 | recall@10 | MRR | nDCG@5 | nDCG@10 | dup@10 | dup@10 nearsem | cov% | p50 | p95 | mean |',
    );
    lines.push('|---|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|');
    for (const [s, nf] of Object.entries(noise_floor)) {
      if (!nf) continue;
      lines.push(
        `| ${s} | ${fmtNoiseFloorValue(nf.recall_at_5)} | ${fmtNoiseFloorValue(nf.recall_at_10)} | ${fmtNoiseFloorValue(nf.mrr)} | ${fmtNoiseFloorValue(nf.ndcg_at_5)} | ${fmtNoiseFloorValue(nf.ndcg_at_10)} | ${fmtNoiseFloorValue(nf.duplication_rate_at_10)} | ${fmtNoiseFloorValue(nf.duplication_rate_nearsemantic_at_10)} | ${fmtNoiseFloorValue(nf.coverage_pct)} | ${fmtNoiseFloorValue(nf.latency_p50_ms)} | ${fmtNoiseFloorValue(nf.latency_p95_ms)} | ${fmtNoiseFloorValue(nf.latency_mean_ms)} |`,
      );
    }
    lines.push('');
    lines.push(
      '_Interpretation: any |delta| in a later diff that falls within these bounds is measurement-jitter, not signal. `diffBaselines.ts` now reads this field (MED-1) and badges within-floor deltas as ⚪._',
    );
    lines.push('');
  }

  lines.push('## Known limitations');
  lines.push('');
  lines.push('- Latency varies ±10–20% across runs; quality metrics are deterministic.');
  lines.push('- Global surface uses REST /api/search/global (ILIKE, not semantic); recall floor comes from raw substring matching.');
  lines.push('- Code surface requires an indexed `chunks` population; empty index → 0 coverage regardless of query quality.');
  lines.push(
    '- `duplication_rate_at_10` v0 keys on exact entity id. Same-title-different-UUID noise (the original Phase-12 motivation: multiple lesson rows titled "Global search test retry pattern") is invisible to v0 — a reader seeing `dup@10 = 0` should NOT conclude "no duplication"; see `snippet-redundancy` in `docs/qc/friction-classes.md`.',
  );
  lines.push(
    '- Golden-set ceiling bias: lesson queries are paraphrases of lesson content, and target ids were cherry-picked from recently-active lessons. Reported `recall@10 = 1.0` may reflect "queries are easy" rather than "retriever is strong." Sprint 12.1 should add adversarial queries (synonyms, typos, indirect references) to distinguish real improvement from noise.',
  );
  lines.push('');

  return lines.join('\n');
}

// -------------------------------- Archive JSON -----------------------------

// Sprint 12.0.2 /review-impl LOW-4: noise-floor helpers extracted to
// src/qc/noiseFloor.ts so they can be unit-tested without importing
// this module (which fires main() at load time).

type BaselineArchive = {
  schema_version: string;
  /** Sprint 16.3: top-level manifest for gen-eval — judge + answerer model
   *  pinning + per-surface synthesizer prompt hashes. Present iff gen-eval
   *  ran (any surface had at least one row with ideal_answer). */
  gen_manifest?: GenManifest;
  tag: string;
  run_started_at: string;
  run_ended_at: string;
  /** Wall-clock across the entire invocation. Under --control this covers
   *  BOTH runs stitched together; see control_elapsed_ms / new_elapsed_ms
   *  for per-run timings. */
  elapsed_ms: number;
  /** Sprint 12.0.2 /review-impl LOW-3: per-run elapsed under --control.
   *  Absent when --control not used. */
  control_elapsed_ms?: number;
  new_elapsed_ms?: number;
  git_commit: string;
  git_branch: string;
  project_id: string;
  samples_per_query: number;
  k: number;
  surfaces: Partial<Record<Surface, SurfaceAggregate>>;
  /** When --control is passed, embed the first run's per-surface metrics so
   *  a later reader can compute the noise floor from first principles. */
  control_run_surfaces?: Partial<Record<Surface, SurfaceAggregate>>;
  /** |control - new| per-surface per-metric. Present only under --control. */
  noise_floor?: Partial<Record<Surface, NoiseFloorPerSurface>>;
};

function gitInfo(): { commit: string; branch: string } {
  try {
    const commit = execSync('git rev-parse --short HEAD', { encoding: 'utf8' }).trim();
    const branch = execSync('git rev-parse --abbrev-ref HEAD', { encoding: 'utf8' }).trim();
    // Sprint 12.1a /review-impl LOW-2: append `+dirty` when the working tree
    // has uncommitted changes. Prevents future readers from assuming two
    // archives with the same SHA were produced by the same code.
    const dirty = execSync('git status --porcelain', { encoding: 'utf8' }).trim();
    return { commit: dirty.length > 0 ? `${commit}+dirty` : commit, branch };
  } catch {
    return { commit: 'unknown', branch: 'unknown' };
  }
}

// --------------------------------- Main -----------------------------------

/** Run every surface in `surfacesFilter` against its golden set, returning
 *  the per-surface aggregated metrics. Extracted so `--control` mode can
 *  call this twice without duplicating the loop. */
async function runAllSurfaces(
  client: McpClient,
  opts: {
    k: number;
    samples: number;
    surfacesFilter: Surface[];
    label: string;
    genEval?: GenEvalConfig;
    maxRows: number | null;
  },
): Promise<{ surfaces: Partial<Record<Surface, SurfaceAggregate>>; primaryProjectId: string }> {
  const surfaces: Partial<Record<Surface, SurfaceAggregate>> = {};
  let primaryProjectId = 'free-context-hub';
  // Sprint 12.0.2 /review-impl COSMETIC-1: label may be '' for non-control
  // runs; elide the `/label` suffix so the log line reads `[baseline]`.
  const prefix = opts.label ? `[baseline/${opts.label}]` : '[baseline]';
  const perQueryPrefix = opts.label ? `[${opts.label}] ` : '';

  for (const surface of opts.surfacesFilter) {
    const file = GOLDEN_FILES[surface];
    const setRaw = await fs.readFile(file, 'utf8').catch(() => null);
    if (!setRaw) {
      console.log(`${prefix} ${surface}: MISSING golden set at ${file}, skipping`);
      continue;
    }
    const set = JSON.parse(setRaw) as GoldenSet;
    const pid = set.project_id_suggested ?? primaryProjectId;
    if (surface === 'lessons') primaryProjectId = pid;
    console.log(`${prefix} ${surface}: ${set.queries.length} queries against project=${pid}`);

    const dispatch = makeDispatcher(surface, client, pid);
    const perQuery: PerQuery[] = [];
    // Sprint 16.3: --max-rows truncation for smoke runs.
    const queriesToRun =
      opts.maxRows !== null ? set.queries.slice(0, opts.maxRows) : set.queries;
    for (const q of queriesToRun) {
      process.stdout.write(`  ${perQueryPrefix}${surface}/${q.id} ... `);
      const res = await evalQuery(surface, dispatch, q, opts.k, opts.samples, opts.genEval);
      const frictionNote = res.friction_classes.length ? ', ' + res.friction_classes.join(';') : '';
      let genNote = '';
      if (res.generation) {
        if (res.generation.error) {
          genNote = `, gen=ERR(${res.generation.error.slice(0, 40)})`;
        } else {
          const f = res.generation.scores.faithfulness;
          const fmt = (v: number | null | undefined) =>
            v === null || v === undefined ? '—' : v.toFixed(2);
          genNote = `, gen[f=${fmt(f)}/r=${fmt(res.generation.scores.answer_relevancy)}/cp=${fmt(res.generation.scores.context_precision)}/cr=${fmt(res.generation.scores.context_recall)}]`;
        }
      }
      process.stdout.write(
        `${res.found_ranks.length ? 'HIT@' + res.found_ranks.join(',') : 'MISS'} (${res.latency_ms_median}ms${frictionNote}${genNote})\n`,
      );
      perQuery.push(res);
    }
    surfaces[surface] = aggregate(perQuery, pid);
  }

  return { surfaces, primaryProjectId };
}

// Sprint 16.3: probe judge sidecar /health for manifest fields.
async function probeJudgeManifest(judgeUrl: string): Promise<{
  ragas_version?: string;
  judge_model?: string;
  judge_endpoint?: string;
  prompts_hash?: string;
}> {
  try {
    const url = judgeUrl.replace(/\/$/, '') + '/health';
    const ctl = new AbortController();
    const timer = setTimeout(() => ctl.abort(), 5_000);
    try {
      const res = await fetch(url, { signal: ctl.signal });
      if (!res.ok) return {};
      return (await res.json()) as any;
    } finally {
      clearTimeout(timer);
    }
  } catch {
    return {};
  }
}

async function main() {
  const {
    tag,
    k,
    samples,
    outDir,
    surfacesFilter,
    control,
    genEval,
    judgeUrl,
    topKContexts,
    maxRows,
  } = parseArgs(process.argv.slice(2));
  const today = new Date().toISOString().slice(0, 10);
  const runStart = new Date();
  const { commit, branch } = gitInfo();

  console.log(`[baseline] tag=${tag} k=${k} samples=${samples} control=${control} gen-eval=${genEval} surfaces=${surfacesFilter.join(',')}${maxRows !== null ? ` max-rows=${maxRows}` : ''}`);
  console.log(`[baseline] MCP=${MCP_URL}  API=${API_URL}${genEval !== 'off' ? `  JUDGE=${judgeUrl}` : ''}`);

  // Sprint 16.3: build gen-eval config when not disabled.
  let genConfig: GenEvalConfig | undefined = undefined;
  let genManifest: GenManifest | undefined = undefined;
  if (genEval !== 'off') {
    const answererBaseUrl =
      process.env.ANSWERER_AGENT_BASE_URL ?? process.env.JUDGE_AGENT_BASE_URL ?? 'http://localhost:1234/v1';
    const answererApiKey =
      process.env.ANSWERER_AGENT_API_KEY ?? process.env.JUDGE_AGENT_API_KEY ?? 'lm-studio';
    const answererModel =
      process.env.ANSWERER_AGENT_MODEL ?? process.env.JUDGE_AGENT_MODEL ?? 'google/gemma-4-26b-a4b';
    const answererTemperature = Number(process.env.ANSWERER_AGENT_TEMPERATURE ?? '0.2');
    const answererSeed = Number(process.env.ANSWERER_AGENT_SEED ?? '42');
    const answererMaxTokens = Number(process.env.ANSWERER_AGENT_MAX_TOKENS ?? '1024');
    const answererTimeoutMs = Number(process.env.ANSWERER_AGENT_TIMEOUT_MS ?? '60000');
    const judgeTimeoutMs = Number(process.env.RAGAS_JUDGE_TIMEOUT_MS ?? '120000');

    genConfig = {
      mode: genEval,
      judgeUrl,
      judgeTimeoutMs,
      answerer: {
        baseUrl: answererBaseUrl,
        apiKey: answererApiKey,
        model: answererModel,
        temperature: answererTemperature,
        seed: answererSeed,
        maxTokens: answererMaxTokens,
        timeoutMs: answererTimeoutMs,
      },
      topKContexts,
    };

    // Probe judge /health for manifest (best-effort; doesn't block run).
    const probe = await probeJudgeManifest(judgeUrl);
    const synthHashes = await allTemplateHashes();
    genManifest = {
      judge_endpoint: probe.judge_endpoint ?? judgeUrl,
      judge_model_id: probe.judge_model ?? 'unknown',
      judge_prompts_hash: probe.prompts_hash ?? null,
      answerer_endpoint: answererBaseUrl,
      answerer_model_id: answererModel,
      answerer_temperature: answererTemperature,
      answerer_seed: answererSeed,
      answerer_max_tokens: answererMaxTokens,
      synthesizer_prompt_hashes: synthHashes,
    };
    console.log(
      `[baseline] gen-eval enabled: answerer=${answererModel} @ ${answererBaseUrl}, judge=${probe.judge_model ?? 'unknown'} @ ${judgeUrl}, top-K=${topKContexts}`,
    );
  }

  const client = new McpClient({ name: 'rag-baseline-runner', version: '1.0.0' }, { capabilities: {} });
  await client.connect(new StreamableHTTPClientTransport(new URL(MCP_URL), {}));

  let surfaces: Partial<Record<Surface, SurfaceAggregate>>;
  let primaryProjectId: string;
  let controlSurfaces: Partial<Record<Surface, SurfaceAggregate>> | undefined;
  let noiseFloor: Partial<Record<Surface, NoiseFloorPerSurface>> | undefined;
  let controlElapsedMs: number | undefined;
  let newElapsedMs: number | undefined;

  try {
    if (control) {
      // Run twice back-to-back at the same server load. The first run is
      // treated as a CONTROL; the second is the canonical archive. Noise
      // floor = |run2 - run1| per metric.
      // Sprint 12.0.2 /review-impl LOW-3: track per-run elapsed so the
      // archive's top-level `elapsed_ms` isn't the only available timing.
      console.log('[baseline] --control mode: running goldenset twice to establish noise floor');
      const c0 = Date.now();
      const run1 = await runAllSurfaces(client, { k, samples, surfacesFilter, label: 'control', genEval: genConfig, maxRows });
      controlElapsedMs = Date.now() - c0;
      const n0 = Date.now();
      const run2 = await runAllSurfaces(client, { k, samples, surfacesFilter, label: 'new', genEval: genConfig, maxRows });
      newElapsedMs = Date.now() - n0;
      surfaces = run2.surfaces;
      primaryProjectId = run2.primaryProjectId;
      controlSurfaces = run1.surfaces;
      noiseFloor = computeNoiseFloor(run1.surfaces, run2.surfaces);
    } else {
      // Sprint 12.0.2 /review-impl COSMETIC-1: restore the pre-12.0.2
      // `[baseline]` log prefix for non-control runs (empty label).
      const res = await runAllSurfaces(client, { k, samples, surfacesFilter, label: '', genEval: genConfig, maxRows });
      surfaces = res.surfaces;
      primaryProjectId = res.primaryProjectId;
    }
  } finally {
    await client.close();
  }

  // LOW-3: If majority of queries errored (stack likely dying), suffix the
  // archive `-partial` so future diffs don't treat this as a real baseline.
  let totalQueries = 0;
  let totalErrors = 0;
  for (const a of Object.values(surfaces)) {
    if (!a) continue;
    totalQueries += a.query_count;
    totalErrors += a.errors;
  }
  const errorFraction = totalQueries === 0 ? 0 : totalErrors / totalQueries;
  let finalTag = tag;
  if (errorFraction > 0.5) {
    finalTag = `${tag}-partial`;
    console.warn(
      `[baseline] WARNING: ${totalErrors}/${totalQueries} queries errored (${Math.round(errorFraction * 100)}%). Archiving under tag '${finalTag}' — do not treat as baseline.`,
    );
  }

  const runEnd = new Date();
  const archive: BaselineArchive = {
    schema_version: SCHEMA_VERSION,
    ...(genManifest ? { gen_manifest: genManifest } : {}),
    tag: finalTag,
    run_started_at: runStart.toISOString(),
    run_ended_at: runEnd.toISOString(),
    elapsed_ms: runEnd.getTime() - runStart.getTime(),
    git_commit: commit,
    git_branch: branch,
    project_id: primaryProjectId,
    samples_per_query: samples,
    k,
    surfaces,
    ...(controlSurfaces ? { control_run_surfaces: controlSurfaces } : {}),
    ...(noiseFloor ? { noise_floor: noiseFloor } : {}),
    ...(controlElapsedMs !== undefined ? { control_elapsed_ms: controlElapsedMs } : {}),
    ...(newElapsedMs !== undefined ? { new_elapsed_ms: newElapsedMs } : {}),
  };

  await fs.mkdir(outDir, { recursive: true });
  const jsonPath = path.join(outDir, `${today}-${finalTag}.json`);
  const mdPath = path.join(outDir, `${today}-${finalTag}.md`);
  await fs.writeFile(jsonPath, JSON.stringify(archive, null, 2), 'utf8');
  await fs.writeFile(mdPath, renderMarkdown(archive), 'utf8');

  console.log(`\n[baseline] wrote ${jsonPath}`);
  console.log(`[baseline] wrote ${mdPath}`);
  console.log(`[baseline] elapsed ${archive.elapsed_ms}ms across ${surfacesFilter.length} surface(s)`);
}

function makeDispatcher(
  surface: Surface,
  client: McpClient,
  projectId: string,
): (query: string, k: number) => Promise<SurfaceResult> {
  switch (surface) {
    case 'lessons':
      return (q, k) => callLessons(client, projectId, q, k);
    case 'code':
      return (q, k) => callCode(client, projectId, q, k);
    case 'chunks':
      return (q, k) => callChunks(client, projectId, q, k);
    case 'global':
      return (q, k) => callGlobal(API_URL, projectId, q, k);
  }
}

main().catch((e) => {
  console.error('[baseline] FATAL', e);
  process.exit(1);
});
