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

dotenv.config();

const SCHEMA_VERSION = '1.0';
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
  return { tag, k, samples, outDir, surfacesFilter, control };
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
  };
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

  return {
    query_count: n,
    errors,
    project_id: projectId,
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
  const { tag, git_commit, git_branch, run_started_at, elapsed_ms, project_id, surfaces, noise_floor } = archive;
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
  opts: { k: number; samples: number; surfacesFilter: Surface[]; label: string },
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
    for (const q of set.queries) {
      process.stdout.write(`  ${perQueryPrefix}${surface}/${q.id} ... `);
      const res = await evalQuery(surface, dispatch, q, opts.k, opts.samples);
      const frictionNote = res.friction_classes.length ? ', ' + res.friction_classes.join(';') : '';
      process.stdout.write(
        `${res.found_ranks.length ? 'HIT@' + res.found_ranks.join(',') : 'MISS'} (${res.latency_ms_median}ms${frictionNote})\n`,
      );
      perQuery.push(res);
    }
    surfaces[surface] = aggregate(perQuery, pid);
  }

  return { surfaces, primaryProjectId };
}

async function main() {
  const { tag, k, samples, outDir, surfacesFilter, control } = parseArgs(process.argv.slice(2));
  const today = new Date().toISOString().slice(0, 10);
  const runStart = new Date();
  const { commit, branch } = gitInfo();

  console.log(`[baseline] tag=${tag} k=${k} samples=${samples} control=${control} surfaces=${surfacesFilter.join(',')}`);
  console.log(`[baseline] MCP=${MCP_URL}  API=${API_URL}`);

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
      const run1 = await runAllSurfaces(client, { k, samples, surfacesFilter, label: 'control' });
      controlElapsedMs = Date.now() - c0;
      const n0 = Date.now();
      const run2 = await runAllSurfaces(client, { k, samples, surfacesFilter, label: 'new' });
      newElapsedMs = Date.now() - n0;
      surfaces = run2.surfaces;
      primaryProjectId = run2.primaryProjectId;
      controlSurfaces = run1.surfaces;
      noiseFloor = computeNoiseFloor(run1.surfaces, run2.surfaces);
    } else {
      // Sprint 12.0.2 /review-impl COSMETIC-1: restore the pre-12.0.2
      // `[baseline]` log prefix for non-control runs (empty label).
      const res = await runAllSurfaces(client, { k, samples, surfacesFilter, label: '' });
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
