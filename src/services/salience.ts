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
 *  absent from the map (caller treats missing as salience=0). */
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

// --------------------------------- Blend -------------------------------------

/** Blend salience into a hybrid score. Multiplicative boost so zero salience
 *  preserves the input score exactly. Clamped at 1.0. */
export function blendHybridScore(
  hybridScore: number,
  salience: number | undefined,
  alpha: number,
): number {
  if (!salience || salience <= 0) return hybridScore;
  if (alpha <= 0) return hybridScore;
  const boosted = hybridScore * (1 + alpha * salience);
  return Math.min(1.0, boosted);
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
