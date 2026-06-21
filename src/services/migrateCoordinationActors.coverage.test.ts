/**
 * Actor Data Boundary F1 — coverage guard for the coordination actor-column list [review-impl F1 #3].
 *
 * The migration + the enforce-ready gate both key off a HAND-MAINTAINED list of actor columns
 * (SCALAR_COLUMNS / ARRAY_COLUMNS in migrateCoordinationActors.ts). If a future migration adds an
 * actor-bearing column to a covered table and nobody updates the list, the gate reports "ready" while
 * that column still holds legacy strings → those rows strand under auth-ON. These tests make that
 * drift fail loudly:
 *   (1) every listed column actually exists in the live schema with the expected type (catches a
 *       rename/drop that would turn a migration UPDATE into a silent no-op);
 *   (2) no UN-listed actor-named text column on a covered table sneaks in (catches a NEW column on an
 *       existing coordination table — the most common drift). Brand-new TABLES are out of scope by
 *       design and must be added to the list explicitly.
 */

import assert from 'node:assert/strict';
import test from 'node:test';
import { getDbPool } from '../db/client.js';
import {
  MIGRATED_SCALAR_COLUMNS,
  MIGRATED_ARRAY_COLUMNS,
  DELIBERATELY_EXCLUDED_ACTOR_COLUMNS,
} from './migrateCoordinationActors.js';

const key = (t: string, c: string) => `${t}.${c}`;

test('coverage: every migrated column exists in the live schema with the expected type', async () => {
  const pool = getDbPool();
  for (const [t, c] of MIGRATED_SCALAR_COLUMNS) {
    const r = await pool.query<{ data_type: string }>(
      `SELECT data_type FROM information_schema.columns WHERE table_name=$1 AND column_name=$2`,
      [t, c],
    );
    assert.equal(r.rowCount, 1, `migrated scalar column ${key(t, c)} must exist in the schema`);
    assert.equal(r.rows[0].data_type, 'text', `${key(t, c)} should be a text actor column`);
  }
  for (const [t, c] of MIGRATED_ARRAY_COLUMNS) {
    const r = await pool.query<{ data_type: string }>(
      `SELECT data_type FROM information_schema.columns WHERE table_name=$1 AND column_name=$2`,
      [t, c],
    );
    assert.equal(r.rowCount, 1, `migrated array column ${key(t, c)} must exist in the schema`);
    assert.equal(r.rows[0].data_type, 'ARRAY', `${key(t, c)} should be a text[] actor column`);
  }
});

test('coverage: no un-listed actor-named text column on a covered table (drift tripwire)', async () => {
  const tables = Array.from(
    new Set([
      ...MIGRATED_SCALAR_COLUMNS.map(([t]) => t),
      ...MIGRATED_ARRAY_COLUMNS.map(([t]) => t),
      ...DELIBERATELY_EXCLUDED_ACTOR_COLUMNS.map(([t]) => t),
    ]),
  );
  const accountedFor = new Set<string>([
    ...MIGRATED_SCALAR_COLUMNS.map(([t, c]) => key(t, c)),
    ...MIGRATED_ARRAY_COLUMNS.map(([t, c]) => key(t, c)),
    ...DELIBERATELY_EXCLUDED_ACTOR_COLUMNS.map(([t, c]) => key(t, c)),
  ]);

  // Actor naming conventions used across the substrate: `actor_id`, any `*_by` provenance column, and
  // the proxy pair. Restricted to TEXT so UUID references (e.g. lessons.superseded_by, *.principal_id)
  // are naturally excluded — those are not free-text actor identities.
  const pool = getDbPool();
  const r = await pool.query<{ table_name: string; column_name: string }>(
    `SELECT table_name, column_name
       FROM information_schema.columns
      WHERE table_name = ANY($1::text[])
        AND data_type = 'text'
        AND (column_name = 'actor_id' OR column_name ~ '_by$' OR column_name IN ('principal', 'proxy'))`,
    [tables],
  );

  const unaccounted = r.rows
    .map((row) => key(row.table_name, row.column_name))
    .filter((k) => !accountedFor.has(k));

  assert.deepEqual(
    unaccounted,
    [],
    `un-listed actor-named text column(s) on a covered table — add each to SCALAR_COLUMNS (if it gates ` +
      `an ownership/membership/ballot comparison) or to DELIBERATELY_EXCLUDED_ACTOR_COLUMNS (with a why): ` +
      unaccounted.join(', '),
  );
});
