/**
 * Phase 12 Sprint 12.1c — Access-frequency salience for lessons retrieval.
 *
 * First biological-memory feature of Phase 12. Lessons that get consumed
 * more often (retrieved by `reflect`, read via GET, or frequently surfaced
 * in search) accrue an exponentially-time-decayed "salience score." The
 * score blends into the hybrid semantic+FTS ranking as a tunable boost,
 * nudging actually-used memories up in retrieval.
 *
 * Write path (fire-and-forget INSERTs via `logLessonAccess`):
 *   - consumption-reflect    weight=1.0     reflect MCP tool
 *   - consumption-read       weight=1.0     GET /api/lessons/:id
 *   - consideration-search   weight=1/rank  searchLessons result ranks
 *   - audit-bootstrap        weight=1.0     one-time migration backfill
 *
 * Read path (synchronous SQL aggregation via `computeSalience`):
 *   For each lesson, SUM(weight × exp(-age_days × ln2 / halfLife)) over
 *   all access rows within a 180-day window, then normalize via
 *   `1 - exp(-weighted_score)` to get salience ∈ [0, 1].
 *
 * Blend (pure function `blendHybridScore`):
 *   final = LEAST(1.0, hybrid × (1 + α × salience))
 *   α=0.10 by default → max 10% boost at max salience.
 *
 * Env knobs (src/env.ts):
 *   LESSONS_SALIENCE_DISABLED   umbrella opt-out (both read + write)
 *   LESSONS_SALIENCE_ALPHA      boost magnitude; default 0.10, clamped [0,1]
 *   LESSONS_SALIENCE_HALF_LIFE_DAYS   decay half-life; default 7, min 1
 */

import type { Pool } from 'pg';
import { getEnv } from '../env.js';
import { createModuleLogger } from '../utils/logger.js';

const logger = createModuleLogger('salience');

export type SalienceConfig = {
  /** Maximum boost magnitude, clamped to [0, 1]. 0 disables boost without
   *  disabling the logging pipeline. */
  alpha: number;
  /** Time for a single access event's weight to decay by half, in days.
   *  Default 7 — short-term "hot" memory window. */
  halfLifeDays: number;
};

/** Read env + clamp. Safe to call on every search — cached env object. */
export function getSalienceConfig(): SalienceConfig {
  const env = getEnv();
  return {
    alpha: env.LESSONS_SALIENCE_ALPHA,
    halfLifeDays: env.LESSONS_SALIENCE_HALF_LIFE_DAYS,
  };
}

/** True when the umbrella kill-switch is set. When true, callers should
 *  skip both the write-path INSERTs and the read-path salience computation. */
export function isSalienceDisabled(): boolean {
  return getEnv().LESSONS_SALIENCE_DISABLED;
}

// --------------------------------- Read path ---------------------------------

/** Aggregate per-lesson weighted+decayed access counts and normalize to
 *  salience ∈ [0, 1].
 *
 *  - Rows older than 180 days are ignored (hard cutoff).
 *  - weighted_score = Σ weight × exp(-age_days × ln2 / halfLifeDays)
 *  - salience = 1 - exp(-weighted_score)   (sigmoid-like, caps at 1)
 *
 *  Returns a Map keyed by lesson_id. Lessons with no access history are
 *  absent from the map (caller treats missing as salience=0).
 *
 *  For multi-project searches, prefer `computeSalienceMultiProject` to
 *  avoid N+1 roundtrips (Sprint 12.1c /review-impl MED-1). */
export async function computeSalience(
  pool: Pool,
  projectId: string,
  lessonIds: string[],
  config: SalienceConfig,
): Promise<Map<string, number>> {
  const out = new Map<string, number>();
  if (lessonIds.length === 0) return out;

  const res = await pool.query(
    `SELECT lesson_id::text AS lesson_id,
            SUM(
              weight *
              EXP(
                -EXTRACT(EPOCH FROM (NOW() - accessed_at))
                / 86400.0
                / $3::float
                * LN(2)
              )
            ) AS weighted_score
       FROM lesson_access_log
      WHERE project_id = $1
        AND lesson_id = ANY($2::uuid[])
        AND accessed_at > NOW() - INTERVAL '180 days'
      GROUP BY lesson_id`,
    [projectId, lessonIds, config.halfLifeDays],
  );

  for (const row of res.rows) {
    const weighted = Number(row.weighted_score);
    if (!Number.isFinite(weighted) || weighted <= 0) continue;
    const salience = 1 - Math.exp(-weighted);
    out.set(String(row.lesson_id), salience);
  }
  return out;
}

/** Multi-project variant — ONE SQL query for all projects. Replaces the
 *  per-project loop pattern that caused N+1 roundtrips in
 *  `searchLessonsMulti` (Sprint 12.1c /review-impl MED-1).
 *
 *  The output Map key is `lesson_id` alone (lesson_ids are UUIDs, globally
 *  unique across projects). If a lesson appears under multiple project_ids
 *  — which shouldn't happen with the current ON DELETE CASCADE schema but
 *  is defensively handled — the salience sums across both. */
export async function computeSalienceMultiProject(
  pool: Pool,
  projectIds: string[],
  lessonIds: string[],
  config: SalienceConfig,
): Promise<Map<string, number>> {
  const out = new Map<string, number>();
  if (lessonIds.length === 0 || projectIds.length === 0) return out;

  const res = await pool.query(
    `SELECT lesson_id::text AS lesson_id,
            SUM(
              weight *
              EXP(
                -EXTRACT(EPOCH FROM (NOW() - accessed_at))
                / 86400.0
                / $3::float
                * LN(2)
              )
            ) AS weighted_score
       FROM lesson_access_log
      WHERE project_id = ANY($1::text[])
        AND lesson_id = ANY($2::uuid[])
        AND accessed_at > NOW() - INTERVAL '180 days'
      GROUP BY lesson_id`,
    [projectIds, lessonIds, config.halfLifeDays],
  );

  for (const row of res.rows) {
    const weighted = Number(row.weighted_score);
    if (!Number.isFinite(weighted) || weighted <= 0) continue;
    const salience = 1 - Math.exp(-weighted);
    out.set(String(row.lesson_id), salience);
  }
  return out;
}

// --------------------------------- Blend -------------------------------------

/** Blend salience into a hybrid score. Multiplicative boost so zero salience
 *  preserves the input score exactly. Clamped at 1.0.
 *
 *  Sprint 12.1d — QUERY-CONDITIONAL SALIENCE:
 *  The optional `semSimilarity` parameter (∈ [0, 1]) scales the salience
 *  boost by how semantically close the lesson is to the current query.
 *  This addresses the `popularity-feedback-loop` friction class from
 *  Sprint 12.1c /review-impl MED-3:
 *    - Popular-but-unrelated lessons (high salience, low sem_score) get
 *      MOST of their boost cancelled.
 *    - Narrow-topic matches (moderate salience, high sem_score) keep
 *      proportional boost.
 *    - Popular-AND-relevant lessons (high salience, high sem_score) get
 *      the full boost they deserve.
 *  Biologically: memory activation requires both the retrieval cue
 *  matching the memory AND recency/frequency signals.
 *
 *  When `semSimilarity` is undefined, defaults to 1.0 — preserves the
 *  original Sprint 12.1c behavior for backward-compat with any direct
 *  caller that hasn't been updated.
 *
 *  Sprint 12.1d /review-impl MED-2 — RELEVANCE SIGNAL, NOT PURE SEMANTIC:
 *  Callers should pass a COMBINED retrieval-cue-match signal, not pure
 *  sem_score. FTS-only relevant matches (specific identifiers, short
 *  technical tokens the embedder doesn't separate well) have low sem_score
 *  despite being highly relevant; feeding pure sem_score would cancel
 *  their legitimate salience boost. Current callers in lessons.ts pass
 *  `max(sem_score, fts_score)` for this reason. The parameter name is kept
 *  as `semSimilarity` for backward-compat but treat it as "relevance
 *  signal ∈ [0, 1]."
 *
 *  Sprint 12.1d /review-impl MED-1 — NaN GUARD:
 *  pgvector cosine distance can return NaN for zero-magnitude vectors
 *  (degenerate queries, corrupted embeddings). `Number(NaN) = NaN` then
 *  `Math.min(1, NaN) = NaN` then `NaN <= 0 = false` — so without an
 *  isFinite check, NaN propagates into the final score and `sort()` on
 *  NaN elements has undefined order. Explicit isFinite returns unchanged
 *  hybridScore for any non-finite input (treated as "no signal available").
 *
 *  Sprint 12.1c /review-impl LOW-1: the clamp means a lesson whose hybrid
 *  score is already near 1.0 loses ordering information — two near-ceiling
 *  hybrid scores can both clamp to 1.0 regardless of salience. This is
 *  deliberate (scores shouldn't exceed 1.0) and rare on a semantic+FTS
 *  distribution where max scores cluster around 0.7-0.9. Revisit if the
 *  indexer/reranker ever produces genuine 1.0 hybrids routinely.
 *
 *  Sprint 12.1d /review-impl LOW-3: the upper `Math.min(1, …)` silently
 *  caps out-of-range inputs. pgvector's SQL wraps sem_score in
 *  `GREATEST(0, …)` but has NO upper cap — if pgvector ever produces
 *  distance < 0 due to numerical error, sem_score would exceed 1 and the
 *  clamp would hide the anomaly. Not worth explicit telemetry today, but
 *  documented here so a maintainer chasing "why is this row always at max
 *  boost" has a lead. */
export function blendHybridScore(
  hybridScore: number,
  salience: number | undefined,
  alpha: number,
  semSimilarity?: number,
): number {
  if (!salience || salience <= 0) return hybridScore;
  if (alpha <= 0) return hybridScore;
  // Sprint 12.1d /review-impl MED-1: NaN guard before clamp.
  // Non-finite semSim (NaN/Inf from pgvector edge cases) → treat as no
  // signal → skip the boost. Conservative: popular-unrelated stays
  // suppressed rather than accidentally boosted.
  const raw = semSimilarity === undefined ? 1.0 : semSimilarity;
  if (!Number.isFinite(raw)) return hybridScore;
  const condition = Math.max(0, Math.min(1, raw));
  if (condition <= 0) return hybridScore;
  const boosted = hybridScore * (1 + alpha * salience * condition);
  return Math.min(1.0, boosted);
}

/** Apply query-conditional salience blend to a list of matches in-place,
 *  then sort by score descending. Returns the count of matches whose score
 *  actually changed (useful for the explanation string).
 *
 *  Sprint 12.1d /review-impl LOW-2: extracted from the inline loops in
 *  `searchLessons` and `searchLessonsMulti` so the Map-plumbing can be
 *  unit-tested without mocking the DB pool. The two callers previously
 *  had 9-line near-duplicate loops that couldn't be exercised except
 *  through full-stack tests.
 *
 *  The `relevanceSignalByLessonId` map should contain the blended
 *  `max(sem_score, fts_score)` for each match's lesson_id. Missing keys
 *  are treated as undefined (passes through as "no signal" → no boost per
 *  MED-1 NaN-guard semantics, which is also what happens for NaN/missing).
 *  Missing salienceMap keys → undefined → blend returns hybridScore
 *  unchanged (zero-salience short-circuit). */
export function applyQueryConditionalSalienceBlend<T extends { lesson_id: string; score: number }>(
  matches: T[],
  salienceMap: Map<string, number>,
  relevanceSignalByLessonId: Map<string, number>,
  alpha: number,
): { effectiveBoosts: number } {
  let effectiveBoosts = 0;
  for (const m of matches) {
    const sal = salienceMap.get(m.lesson_id);
    const rel = relevanceSignalByLessonId.get(m.lesson_id);
    const before = m.score;
    m.score = blendHybridScore(m.score, sal, alpha, rel);
    // Floating-point-safe change check — any observable score change counts.
    if (Math.abs(m.score - before) > 1e-12) effectiveBoosts += 1;
  }
  matches.sort((a, b) => b.score - a.score);
  return { effectiveBoosts };
}

// --------------------------------- Write path --------------------------------

export type AccessLogEntry = {
  lesson_id: string;
  project_id: string;
  /** Context classes, in order of biological strength:
   *  - `audit-bootstrap`       — one-time seed from guardrail_audit_logs (strong, 1.0)
   *  - `consumption-*`         — this memory was actually USED (strong, 1.0)
   *  - `consideration-search`  — this memory was surfaced (weak, rank-weighted < 1.0)
   *
   *  Consumption kinds reflect the concrete endpoints in this codebase where
   *  a lesson_id gets dereferenced and processed:
   *  - `consumption-reflect`   — reflect MCP tool pipes into LLM synthesis
   *  - `consumption-improve`   — POST /:id/improve invokes LLM on content
   *  - `consumption-tags`      — POST /:id/suggest-tags scans content
   *  - `consumption-versions`  — GET /:id/versions view history (GUI/operator)
   *  - `consumption-read`      — reserved for future GET /api/lessons/:id endpoint */
  context:
    | 'audit-bootstrap'
    | 'consumption-reflect'
    | 'consumption-improve'
    | 'consumption-tags'
    | 'consumption-versions'
    | 'consumption-read'
    | 'consideration-search';
  /** Default 1.0 — rank-weighted search entries pass `1/rank`. */
  weight?: number;
  metadata?: Record<string, unknown>;
};

/** Batched fire-and-forget INSERT into lesson_access_log.
 *  Callers should NOT await this in the request's critical path; use
 *  `.catch(...)` to swallow and log. A write failure must never break
 *  the retrieval it's piggybacking on.
 *
 *  Sprint 12.1c /review-impl MED-2 — POOL-SIZING ASSUMPTION:
 *  Every `searchLessons` call emits one unawaited INSERT holding a pool
 *  connection for ~5-50ms. Under concurrent load (~20 parallel searches),
 *  fire-and-forget INSERTs can saturate a default 10-connection pool and
 *  queue critical GET responses behind them. For salience-enabled
 *  deployments, configure the pg pool with `max >= 20` to maintain
 *  headroom. Follow-up work (future sprint): write-behind batching every
 *  ~1s, or a lightweight semaphore capping concurrent access-log writes.
 *
 *  Returns a Promise that resolves on success; callers that want to
 *  confirm persistence in tests may await it. */
export async function logLessonAccess(pool: Pool, entries: AccessLogEntry[]): Promise<void> {
  if (entries.length === 0) return;

  // Build a single multi-row INSERT: VALUES ($1,$2,$3,$4,$5), ($6,$7,$8,$9,$10), ...
  const valueTuples: string[] = [];
  const params: unknown[] = [];
  let p = 0;
  for (const e of entries) {
    valueTuples.push(`($${++p}::uuid, $${++p}::text, $${++p}::text, $${++p}::real, $${++p}::jsonb)`);
    params.push(e.lesson_id);
    params.push(e.project_id);
    params.push(e.context);
    params.push(e.weight ?? 1.0);
    params.push(e.metadata ? JSON.stringify(e.metadata) : null);
  }

  const sql = `
    INSERT INTO lesson_access_log (lesson_id, project_id, context, weight, metadata)
    VALUES ${valueTuples.join(', ')}
  `;

  try {
    await pool.query(sql, params);
  } catch (err) {
    // Never throw — retrieval must keep working. Log warn so an operator
    // watching for write-volume issues can diagnose later.
    logger.warn({ err, entries: entries.length }, 'logLessonAccess failed (swallowed)');
  }
}
