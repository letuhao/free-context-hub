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
  return { tag, k, samples, outDir, surfacesFilter };
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

/** Loose-match fallback for code surface: many existing golden queries list
 *  targets as partial paths ("src/index.ts"). Accept equality OR substring. */
function matchKey(surface: Surface, itemKey: string, targets: Set<string>): boolean {
  if (targets.has(itemKey)) return true;
  if (surface === 'code') {
    for (const t of targets) {
      if (itemKey.includes(t) || t.includes(itemKey)) return true;
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
  found_ranks: number[];            // 1-based ranks of target hits within top-k
  graded_hits_in_rank_order: GradedHit[];
  latency_ms_samples: number[];
  latency_ms_median: number;
  has_relevant_hit_in_top_k: boolean;
  friction_class: string | null;
  error?: string;
};

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

  const found_ranks: number[] = [];
  const graded: GradedHit[] = [];
  for (let i = 0; i < topK.length; i++) {
    const hit = matchKey(surface, topK[i]!.key, targets);
    graded.push(hit ? 2 : 0);
    if (hit) found_ranks.push(i + 1);
  }

  const sortedLat = [...latencies].sort((a, b) => a - b);
  const median = sortedLat.length
    ? sortedLat[Math.floor((sortedLat.length - 1) / 2)]!
    : 0;

  const has_relevant_hit_in_top_k = found_ranks.length > 0;
  const friction_class = classifyFriction({
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
    found_ranks,
    graded_hits_in_rank_order: graded,
    latency_ms_samples: latencies,
    latency_ms_median: median,
    has_relevant_hit_in_top_k,
    friction_class,
    error: last.error,
  };
}

// ---------------------------- Friction classifier --------------------------

function classifyFriction(p: {
  targetCount: number;
  topKLen: number;
  foundRanks: number[];
  dupRate: number;
  error?: string;
}): string | null {
  if (p.error) return 'retrieval-error';
  if (p.topKLen === 0) return 'empty-result-set';
  if (p.targetCount === 0) return null; // adversarial-miss queries intentionally have no target; not a friction
  if (p.foundRanks.length === 0) return 'no-relevant-hit';
  if (p.dupRate >= 0.3) return 'duplicate-domination';
  const best = Math.min(...p.foundRanks);
  if (best > 3 && p.dupRate < 0.3) return 'rank-order-inversion';
  return null;
}

// ----------------------- Per-surface aggregation ---------------------------

type SurfaceAggregate = {
  query_count: number;
  errors: number;
  metrics: {
    recall_at_5: number; recall_at_10: number;
    mrr: number;
    ndcg_at_5: number; ndcg_at_10: number;
    duplication_rate_at_10: number;
    coverage_pct: number;
    latency_p50_ms: number; latency_p95_ms: number; latency_mean_ms: number;
  };
  per_query: PerQuery[];
};

function aggregate(perQuery: PerQuery[]): SurfaceAggregate {
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
  const sumDup = perQuery.reduce(
    (a, q) => a + duplicationRateAtK(q.top_k_keys.map((k) => ({ key: k })), 10),
    0,
  );

  // Coverage: "should-hit" queries that did hit. Adversarial-miss excluded so
  // the percentage isn't artificially inflated by intentional zero-target queries.
  const coverageBools = withTargets.map((q) => q.has_relevant_hit_in_top_k);

  const allSamples = perQuery.flatMap((q) => q.latency_ms_samples);
  const lat = latencySummary(allSamples);

  return {
    query_count: n,
    errors,
    metrics: {
      recall_at_5: round(sumRecall5 / nWithTargets),
      recall_at_10: round(sumRecall10 / nWithTargets),
      mrr: round(sumMrr / nWithTargets),
      ndcg_at_5: round(sumNdcg5 / nWithTargets),
      ndcg_at_10: round(sumNdcg10 / nWithTargets),
      duplication_rate_at_10: round(sumDup / Math.max(n, 1)),
      coverage_pct: round(coveragePct(coverageBools)),
      latency_p50_ms: Math.round(lat.p50),
      latency_p95_ms: Math.round(lat.p95),
      latency_mean_ms: Math.round(lat.mean),
    },
    per_query: perQuery,
  };
}

function round(x: number): number {
  return Math.round(x * 10000) / 10000;
}

// ------------------------------ Markdown render ----------------------------

function renderMarkdown(archive: BaselineArchive): string {
  const { tag, git_commit, git_branch, run_started_at, elapsed_ms, project_id, surfaces } = archive;
  const lines: string[] = [];
  lines.push('---');
  lines.push(`tag: ${tag}`);
  lines.push(`commit: ${git_commit}`);
  lines.push(`branch: ${git_branch}`);
  lines.push(`run_at: ${run_started_at}`);
  lines.push(`elapsed_ms: ${elapsed_ms}`);
  lines.push(`project_id: ${project_id}`);
  lines.push('---');
  lines.push('');
  lines.push(`# RAG Baseline — ${tag}`);
  lines.push('');
  lines.push('## Summary (all surfaces)');
  lines.push('');
  lines.push('| Surface | Q | err | recall@5 | recall@10 | MRR | nDCG@5 | nDCG@10 | dup@10 | cov% | p50 ms | p95 ms |');
  lines.push('|---|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|');
  for (const [s, a] of Object.entries(surfaces)) {
    if (!a) continue;
    const m = a.metrics;
    lines.push(
      `| ${s} | ${a.query_count} | ${a.errors} | ${m.recall_at_5} | ${m.recall_at_10} | ${m.mrr} | ${m.ndcg_at_5} | ${m.ndcg_at_10} | ${m.duplication_rate_at_10} | ${m.coverage_pct} | ${m.latency_p50_ms} | ${m.latency_p95_ms} |`,
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
      const friction = q.friction_class ?? (q.has_relevant_hit_in_top_k ? 'clean' : '—');
      lines.push(`| ${q.id} | ${q.group} | ${found} | ${friction} | ${q.latency_ms_median} |`);
    }
    lines.push('');
  }

  lines.push('## Friction observed (top examples)');
  lines.push('');
  const frictionExamples: string[] = [];
  for (const [s, a] of Object.entries(surfaces)) {
    if (!a) continue;
    const flagged = a.per_query.filter((q) => q.friction_class);
    for (const q of flagged.slice(0, 3)) {
      frictionExamples.push(
        `- **${s}/${q.id}** — ${q.friction_class}: query \`${q.query.slice(0, 80)}\`; top-3 keys=[${q.top_k_keys.slice(0, 3).join(', ')}]`,
      );
    }
  }
  if (frictionExamples.length === 0) {
    lines.push('_(none flagged by heuristic classifier)_');
  } else {
    lines.push(...frictionExamples);
  }
  lines.push('');

  lines.push('## Known limitations');
  lines.push('');
  lines.push('- Latency varies ±10–20% across runs; quality metrics are deterministic.');
  lines.push(`- Global surface uses REST /api/search/global (ILIKE, not semantic); recall floor comes from raw substring matching.`);
  lines.push('- Code surface requires an indexed `chunks` population; empty index → 0 coverage regardless of query quality.');
  lines.push('');

  return lines.join('\n');
}

// -------------------------------- Archive JSON -----------------------------

type BaselineArchive = {
  schema_version: string;
  tag: string;
  run_started_at: string;
  run_ended_at: string;
  elapsed_ms: number;
  git_commit: string;
  git_branch: string;
  project_id: string;
  samples_per_query: number;
  k: number;
  surfaces: Partial<Record<Surface, SurfaceAggregate>>;
};

function gitInfo(): { commit: string; branch: string } {
  try {
    const commit = execSync('git rev-parse --short HEAD', { encoding: 'utf8' }).trim();
    const branch = execSync('git rev-parse --abbrev-ref HEAD', { encoding: 'utf8' }).trim();
    return { commit, branch };
  } catch {
    return { commit: 'unknown', branch: 'unknown' };
  }
}

// --------------------------------- Main -----------------------------------

async function main() {
  const { tag, k, samples, outDir, surfacesFilter } = parseArgs(process.argv.slice(2));
  const today = new Date().toISOString().slice(0, 10);
  const runStart = new Date();
  const { commit, branch } = gitInfo();

  console.log(`[baseline] tag=${tag} k=${k} samples=${samples} surfaces=${surfacesFilter.join(',')}`);
  console.log(`[baseline] MCP=${MCP_URL}  API=${API_URL}`);

  const client = new McpClient({ name: 'rag-baseline-runner', version: '1.0.0' }, { capabilities: {} });
  await client.connect(new StreamableHTTPClientTransport(new URL(MCP_URL), {}));

  const surfaces: Partial<Record<Surface, SurfaceAggregate>> = {};
  let primaryProjectId = 'free-context-hub';

  try {
    for (const surface of surfacesFilter) {
      const file = GOLDEN_FILES[surface];
      const setRaw = await fs.readFile(file, 'utf8').catch(() => null);
      if (!setRaw) {
        console.log(`[baseline] ${surface}: MISSING golden set at ${file}, skipping`);
        continue;
      }
      const set = JSON.parse(setRaw) as GoldenSet;
      const pid = set.project_id_suggested ?? primaryProjectId;
      if (surface === 'lessons') primaryProjectId = pid;
      console.log(`[baseline] ${surface}: ${set.queries.length} queries against project=${pid}`);

      const dispatch = makeDispatcher(surface, client, pid);
      const perQuery: PerQuery[] = [];
      for (const q of set.queries) {
        process.stdout.write(`  ${surface}/${q.id} ... `);
        const res = await evalQuery(surface, dispatch, q, k, samples);
        process.stdout.write(
          `${res.found_ranks.length ? 'HIT@' + res.found_ranks.join(',') : 'MISS'} (${res.latency_ms_median}ms${res.friction_class ? ', ' + res.friction_class : ''})\n`,
        );
        perQuery.push(res);
      }
      surfaces[surface] = aggregate(perQuery);
    }
  } finally {
    await client.close();
  }

  const runEnd = new Date();
  const archive: BaselineArchive = {
    schema_version: SCHEMA_VERSION,
    tag,
    run_started_at: runStart.toISOString(),
    run_ended_at: runEnd.toISOString(),
    elapsed_ms: runEnd.getTime() - runStart.getTime(),
    git_commit: commit,
    git_branch: branch,
    project_id: primaryProjectId,
    samples_per_query: samples,
    k,
    surfaces,
  };

  await fs.mkdir(outDir, { recursive: true });
  const jsonPath = path.join(outDir, `${today}-${tag}.json`);
  const mdPath = path.join(outDir, `${today}-${tag}.md`);
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
