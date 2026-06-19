/**
 * Actor Data Boundary F1f.3 — migrate the Phase-15 coordination substrate's legacy free-text
 * actor_ids onto principal_ids (the namespace unification the F1-adv pass-1 finding requires).
 *
 * For each DISTINCT legacy actor string across the coordination tables that is NOT already a
 * principal_id, create an imported principal (kind='agent', display_name=the string, active) and
 * rewrite every column to that principal_id. After this runs, coordination ownership/membership
 * comparisons are uniformly principal-keyed, so enabling auth-ON cannot strand claims/votes/proxies.
 *
 * Idempotent: runs in one transaction; a value already equal to some principal_id is excluded, so a
 * re-run is a no-op. A no-op on empty data. Run out-of-band BEFORE enabling MCP_AUTH_ENABLED
 * (assertEnforceReady gates on it — F1f.4). Operators bind credentials to the imported principals to
 * act as them under auth-ON.
 *
 * Table/column names below are hardcoded constants (never user input) — safe to interpolate.
 */

import type { PoolClient } from 'pg';
import { getDbPool } from '../db/client.js';

/** Scalar text columns that hold an actor identity. */
const SCALAR_COLUMNS: ReadonlyArray<readonly [table: string, column: string]> = [
  ['claims', 'actor_id'],
  ['body_members', 'actor_id'],
  ['votes', 'actor_id'],
  ['proxies', 'principal'],
  ['proxies', 'proxy'],
  ['topic_participants', 'actor_id'],
  ['topic_participants', 'granted_by'],
  ['tasks', 'created_by'],
  ['artifact_versions', 'created_by'],
  ['topics', 'created_by'],
  ['requests', 'submitted_by'],
  ['request_steps', 'decided_by'],
  ['decision_bodies', 'created_by'],
  ['motions', 'proposed_by'],
  ['motions', 'seconded_by'],
  ['intake_items', 'submitted_by'],
  ['coordination_events', 'actor_id'],
  ['lessons', 'captured_by'],
];

/** text[] columns whose elements hold actor identities. */
const ARRAY_COLUMNS: ReadonlyArray<readonly [table: string, column: string]> = [
  ['decision_bodies', 'veto_holders'],
  ['disputes', 'parties'],
];

export interface MigrateActorsResult {
  imported: number; // principals created for legacy strings
  scalarColumns: number;
  arrayColumns: number;
}

/** The UNION that collects every actor value across the coordination tables (scalar + array elems). */
function collectUnionSql(): string {
  return [
    ...SCALAR_COLUMNS.map(([t, c]) => `SELECT ${c} AS v FROM ${t} WHERE ${c} IS NOT NULL`),
    ...ARRAY_COLUMNS.map(([t, c]) => `SELECT unnest(${c}) AS v FROM ${t} WHERE ${c} IS NOT NULL`),
  ].join('\n        UNION\n        ');
}

/**
 * Count distinct coordination actor values that are NOT yet a principal_id. assertEnforceReady gates
 * on this being 0 — auth must not be enabled while the board still holds un-migrated string actors
 * (they would strand under principal-keyed comparisons). [F1-adv finding #5 / F1f.4]
 */
export async function countUnmigratedCoordinationActors(executor?: PoolClient): Promise<number> {
  const runner = executor ?? getDbPool();
  const r = await runner.query<{ n: number }>(`
    SELECT count(*)::int AS n FROM (
      SELECT DISTINCT v FROM (
        ${collectUnionSql()}
      ) s
      WHERE s.v IS NOT NULL
        AND NOT EXISTS (SELECT 1 FROM principals p WHERE p.principal_id::text = s.v)
    ) u
  `);
  return r.rows[0].n;
}

export async function migrateCoordinationActorIds(
  executor?: PoolClient,
  opts?: { restrictTo?: readonly string[] },
): Promise<MigrateActorsResult> {
  const ownTxn = !executor;
  const client = executor ?? (await getDbPool().connect());
  // restrictTo bounds the migration to a specific set of legacy actor strings — production runs
  // global (no restrict); tests pass their own seeded values so only THOSE rows are locked/rewritten
  // (no cross-suite deadlock, deterministic). Also usable operationally to migrate a known actor.
  const restrict = opts?.restrictTo && opts.restrictTo.length > 0 ? opts.restrictTo : null;
  try {
    if (ownTxn) await client.query('BEGIN');

    // Collect every distinct legacy actor value that is NOT already a principal_id. Comparing
    // principal_id::text (not the string cast to uuid) avoids 22P02 on non-UUID legacy strings.
    const collectUnion = collectUnionSql();

    await client.query('DROP TABLE IF EXISTS _coord_actor_map');
    await client.query('CREATE TEMP TABLE _coord_actor_map (legacy text PRIMARY KEY, pid uuid) ON COMMIT DROP');
    await client.query(
      `
      INSERT INTO _coord_actor_map (legacy)
      SELECT DISTINCT v FROM (
        ${collectUnion}
      ) s
      WHERE s.v IS NOT NULL
        AND NOT EXISTS (SELECT 1 FROM principals p WHERE p.principal_id::text = s.v)
        ${restrict ? 'AND s.v = ANY($1::text[])' : ''}
    `,
      restrict ? [restrict] : [],
    );

    // Mint one imported principal per legacy string (uuid chosen in the map, then inserted).
    await client.query('UPDATE _coord_actor_map SET pid = gen_random_uuid() WHERE pid IS NULL');
    const ins = await client.query(`
      INSERT INTO principals (principal_id, kind, status, display_name, is_root)
      SELECT pid, 'agent', 'active', legacy, false FROM _coord_actor_map
    `);
    const imported = ins.rowCount ?? 0;

    // Rewrite scalar columns.
    for (const [t, c] of SCALAR_COLUMNS) {
      await client.query(`UPDATE ${t} tt SET ${c} = m.pid::text FROM _coord_actor_map m WHERE tt.${c} = m.legacy`);
    }

    // Rewrite array columns, preserving element order; unknown elements (already principals) pass through.
    for (const [t, c] of ARRAY_COLUMNS) {
      await client.query(`
        UPDATE ${t} tt SET ${c} = (
          SELECT array_agg(COALESCE(m.pid::text, u.elem) ORDER BY u.ord)
          FROM unnest(tt.${c}) WITH ORDINALITY AS u(elem, ord)
          LEFT JOIN _coord_actor_map m ON m.legacy = u.elem
        )
        WHERE tt.${c} IS NOT NULL AND cardinality(tt.${c}) > 0
      `);
    }

    if (ownTxn) await client.query('COMMIT');
    return { imported, scalarColumns: SCALAR_COLUMNS.length, arrayColumns: ARRAY_COLUMNS.length };
  } catch (err) {
    if (ownTxn) await client.query('ROLLBACK').catch(() => {});
    throw err;
  } finally {
    if (ownTxn) client.release();
  }
}
