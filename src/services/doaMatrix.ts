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
  /** Sprint 15.8 — per-row decision procedure. */
  procedure: 'unilateral' | 'collective';
  /** Sprint 15.8 — decision body for collective procedure (NULL on unilateral). */
  body_id: string | null;
  /**
   * Sprint 15.10 — per-level body map for multi-tier collective routes
   * (DEFERRED-022). Empty Map when no doa_matrix_levels entries exist;
   * caller falls back to {required_level → body_id} from the single-body
   * column (15.8 backward compat).
   */
  body_by_level: Map<string, string>;
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
    procedure: 'unilateral' | 'collective';
    body_id: string | null;
    body_by_level_json: Record<string, string>;
    tier: string;
  }>(
    `SELECT m.matrix_id, m.required_level, m.route_shape, m.procedure, m.body_id,
            COALESCE(
              jsonb_object_agg(ml.level, ml.body_id) FILTER (WHERE ml.level IS NOT NULL),
              '{}'::jsonb
            ) AS body_by_level_json,
            (m.weight_max - m.weight_min) AS span,
            CASE WHEN m.topic_id = $1                              THEN 0
                 WHEN m.topic_id IS NULL AND m.project_id = $2      THEN 1
                 ELSE 2 END AS tier
       FROM doa_matrix m
       LEFT JOIN doa_matrix_levels ml ON ml.matrix_id = m.matrix_id
      WHERE m.kind = $3
        AND m.weight_min <= $4
        AND m.weight_max >= $4
        AND ( m.topic_id = $1
           OR (m.topic_id IS NULL AND m.project_id = $2)
           OR (m.topic_id IS NULL AND m.project_id = '__default__') )
      GROUP BY m.matrix_id, m.required_level, m.route_shape, m.procedure,
               m.body_id, m.weight_max, m.weight_min, m.topic_id, m.project_id
      ORDER BY tier ASC, span ASC, m.matrix_id ASC
      LIMIT 1`,
    [topic_id, project_id, kind, weight],
  );

  if (res.rowCount === 0) return null;

  const row = res.rows[0];
  const tier = Number(row.tier);
  // pg returns JSONB columns as parsed objects; convert to Map.
  const bbl = new Map<string, string>();
  for (const [lvl, bid] of Object.entries(row.body_by_level_json ?? {})) {
    if (typeof bid === 'string') bbl.set(lvl, bid);
  }
  return {
    matrix_id: row.matrix_id,
    required_level: row.required_level,
    route_shape: row.route_shape,
    doa_snapshot: `${row.matrix_id}:t${tier}`,
    procedure: row.procedure,
    body_id: row.body_id,
    body_by_level: bbl,
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
