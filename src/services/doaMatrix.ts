/**
 * Phase 15 Sprint 15.3 — DoA matrix resolution + route derivation.
 *
 * Design ref: docs/specs/2026-05-17-phase-15-sprint-15.3-design.md §2
 * Spec hash:  6f79057f9e42e4fc
 *
 * The Delegation-of-Authority matrix maps (project_id, topic_id?, kind, weight)
 * to a (required_level, route_shape) pair. Resolution precedence: topic-override
 * rows (tier 0) → project rows (tier 1) → __default__ rows (tier 2). Within a
 * tier, the narrowest weight span wins; ties broken by matrix_id (deterministic).
 *
 * `resolveMatrixRow` — a plain read (no lock); called pre-BEGIN in submitRequest.
 * `deriveRoute` — a pure function: given submitter level, required level, and
 * route shape, produces an ordered list of ≥1 target offices.
 *
 * `STEP_DEADLINE_MINUTES` is exported for use by requests.ts when inserting steps.
 */

import type { PoolClient } from 'pg';

// ── Level constants (§2) ─────────────────────────────────────────────────────

export const LEVEL_RANK: Record<string, number> = {
  execution: 0,
  coordination: 1,
  authority: 2,
};

/** Levels in ascending rank order (execution < coordination < authority). */
export const LEVELS_ASC: string[] = ['execution', 'coordination', 'authority'];

/** Step deadline in minutes (D10). A step's clock starts when it becomes active. */
export const STEP_DEADLINE_MINUTES = 60;

// ── Types ─────────────────────────────────────────────────────────────────────

export type MatrixRow = {
  matrix_id: string;
  required_level: string;
  route_shape: string;
  /** Frozen snapshot string: `<matrix_id>:t<tier>` (D4). */
  doa_snapshot: string;
};

// ── §2.1 resolveMatrixRow ─────────────────────────────────────────────────────

/**
 * Resolve the best-matching DoA matrix row for a given
 * (project_id, topic_id, kind, weight) combination.
 *
 * Returns null when no row matches (→ `no_route`).
 *
 * The tier-ranked ORDER BY enforces the precedence chain (D2):
 *   tier 0 = topic-override (topic_id = $topic)
 *   tier 1 = project row   (topic_id IS NULL AND project_id = $proj)
 *   tier 2 = __default__   (topic_id IS NULL AND project_id = '__default__')
 * Within each tier, narrowest span wins; ties broken by matrix_id (stable).
 *
 * The `doa_snapshot` string (`<matrix_id>:t<tier>`) is frozen onto every
 * request_steps row at submission — a later matrix edit never re-targets an
 * in-flight request (D4, §9 inv. 1).
 */
export async function resolveMatrixRow(
  client: PoolClient,
  params: {
    project_id: string;
    topic_id: string;
    kind: string;
    weight: number;
  },
): Promise<MatrixRow | null> {
  const { project_id, topic_id, kind, weight } = params;

  const res = await client.query<{
    matrix_id: string;
    required_level: string;
    route_shape: string;
    tier: string;
  }>(
    `SELECT matrix_id, required_level, route_shape,
            (weight_max - weight_min) AS span,
            CASE WHEN topic_id = $1                              THEN 0
                 WHEN topic_id IS NULL AND project_id = $2      THEN 1
                 ELSE 2 END AS tier
       FROM doa_matrix
      WHERE kind = $3
        AND weight_min <= $4
        AND weight_max >= $4
        AND ( topic_id = $1
           OR (topic_id IS NULL AND project_id = $2)
           OR (topic_id IS NULL AND project_id = '__default__') )
      ORDER BY tier ASC, span ASC, matrix_id ASC
      LIMIT 1`,
    [topic_id, project_id, kind, weight],
  );

  if (res.rowCount === 0) return null;

  const row = res.rows[0];
  const tier = Number(row.tier);
  return {
    matrix_id: row.matrix_id,
    required_level: row.required_level,
    route_shape: row.route_shape,
    doa_snapshot: `${row.matrix_id}:t${tier}`,
  };
}

// ── §2.2 deriveRoute ──────────────────────────────────────────────────────────

/**
 * Derive the ordered list of target offices for a request route (D3).
 *
 * - `escalate_to_authority` → `[requiredLevel]` (one step at the covering level).
 * - `counter_sign` → all levels strictly above the submitter up to required_level,
 *   in ascending rank order. If that list would be empty (submitter outranks or
 *   equals required), falls back to `[requiredLevel]` — so the result is always ≥1.
 *
 * Both shapes return an ordered list of ≥1 office strings.
 */
export function deriveRoute(
  submitterLevel: string,
  requiredLevel: string,
  routeShape: string,
): string[] {
  if (routeShape === 'escalate_to_authority') {
    return [requiredLevel];
  }

  // counter_sign: all levels with rank strictly > submitter AND rank ≤ required
  const submitterRank = LEVEL_RANK[submitterLevel] ?? -1;
  const requiredRank = LEVEL_RANK[requiredLevel] ?? 2;

  const ladder = LEVELS_ASC.filter((l) => {
    const rank = LEVEL_RANK[l]!;
    return rank > submitterRank && rank <= requiredRank;
  });

  // Empty ladder fallback: if the submitter already outranks required or they
  // are equal, return [requiredLevel] so the result is always ≥1.
  if (ladder.length === 0) {
    return [requiredLevel];
  }

  return ladder;
}
