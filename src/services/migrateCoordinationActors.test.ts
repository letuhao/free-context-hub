/**
 * Actor Data Boundary F1f.3 — coordination actor_id → principal migration.
 *
 * The migration mutates GLOBAL state, so each test runs inside its own BEGIN…ROLLBACK on a dedicated
 * client (passed as the executor) — nothing commits. Assertions concern ONLY this test's own seeded
 * rows (never global aggregates), so they're deterministic even while other suites run concurrently.
 */

import assert from 'node:assert/strict';
import test from 'node:test';
import { validate as isUuid } from 'uuid';
import { migrateCoordinationActorIds, countUnmigratedCoordinationActors } from './migrateCoordinationActors.js';
import { getDbPool } from '../db/client.js';

const PREFIX = '__test_migrate_actor__';

test('migrate: rewrites legacy scalar + array actor_ids to imported principals (order preserved)', async () => {
  const client = await getDbPool().connect();
  try {
    await client.query('BEGIN');
    const tid = `${PREFIX}topic`;
    await client.query(
      `INSERT INTO topics (topic_id, project_id, name, charter, created_by) VALUES ($1, $2, 'n', 'c', $3)`,
      [tid, `${PREFIX}proj`, `${PREFIX}creator`],
    );
    await client.query(
      `INSERT INTO disputes (topic_id, subject_ref, parties) VALUES ($1, 'artifact:x', $2)`,
      [tid, [`${PREFIX}partyA`, `${PREFIX}partyB`]],
    );

    await migrateCoordinationActorIds(client, {
      restrictTo: [`${PREFIX}creator`, `${PREFIX}partyA`, `${PREFIX}partyB`],
    });

    // scalar: topics.created_by is now a principal UUID named after the legacy string
    const t = await client.query<{ created_by: string }>(`SELECT created_by FROM topics WHERE topic_id = $1`, [tid]);
    assert.ok(isUuid(t.rows[0].created_by), 'created_by rewritten to a uuid');
    const pc = await client.query<{ display_name: string; kind: string; status: string }>(
      `SELECT display_name, kind, status FROM principals WHERE principal_id = $1`,
      [t.rows[0].created_by],
    );
    assert.equal(pc.rows[0].display_name, `${PREFIX}creator`);
    assert.equal(pc.rows[0].kind, 'agent');
    assert.equal(pc.rows[0].status, 'active');

    // array: disputes.parties rewritten, order preserved (partyA stays first)
    const d = await client.query<{ parties: string[] }>(`SELECT parties FROM disputes WHERE topic_id = $1`, [tid]);
    assert.equal(d.rows[0].parties.length, 2);
    assert.ok(isUuid(d.rows[0].parties[0]) && isUuid(d.rows[0].parties[1]));
    const p0 = await client.query<{ display_name: string }>(
      `SELECT display_name FROM principals WHERE principal_id = $1`,
      [d.rows[0].parties[0]],
    );
    assert.equal(p0.rows[0].display_name, `${PREFIX}partyA`, 'array element order preserved');
  } finally {
    await client.query('ROLLBACK').catch(() => {});
    client.release();
  }
});

test('migrate: idempotent — a re-run leaves an already-migrated value unchanged', async () => {
  const client = await getDbPool().connect();
  try {
    await client.query('BEGIN');
    const tid = `${PREFIX}topic2`;
    await client.query(
      `INSERT INTO topics (topic_id, project_id, name, charter, created_by) VALUES ($1, $2, 'n', 'c', $3)`,
      [tid, `${PREFIX}proj`, `${PREFIX}c2`],
    );
    await migrateCoordinationActorIds(client, { restrictTo: [`${PREFIX}c2`] });
    const first = await client.query<{ created_by: string }>(`SELECT created_by FROM topics WHERE topic_id = $1`, [tid]);
    await migrateCoordinationActorIds(client, { restrictTo: [`${PREFIX}c2`] });
    const second = await client.query<{ created_by: string }>(`SELECT created_by FROM topics WHERE topic_id = $1`, [tid]);
    assert.ok(isUuid(first.rows[0].created_by));
    assert.equal(second.rows[0].created_by, first.rows[0].created_by, 'value unchanged on re-run');
  } finally {
    await client.query('ROLLBACK').catch(() => {});
    client.release();
  }
});

test('migrate: leaves a value that is already a principal_id untouched (no double-rewrite)', async () => {
  const client = await getDbPool().connect();
  try {
    await client.query('BEGIN');
    const pr = await client.query<{ principal_id: string }>(
      `INSERT INTO principals (kind, status, display_name, is_root) VALUES ('agent','active',$1,false) RETURNING principal_id`,
      [`${PREFIX}already`],
    );
    const pid = pr.rows[0].principal_id;
    const tid = `${PREFIX}topic3`;
    await client.query(
      `INSERT INTO topics (topic_id, project_id, name, charter, created_by) VALUES ($1, $2, 'n', 'c', $3)`,
      [tid, `${PREFIX}proj`, pid],
    );
    await migrateCoordinationActorIds(client, { restrictTo: [pid, `${PREFIX}already`] });
    const t = await client.query<{ created_by: string }>(`SELECT created_by FROM topics WHERE topic_id = $1`, [tid]);
    assert.equal(t.rows[0].created_by, pid, 'a value already equal to a principal_id is left as-is');
  } finally {
    await client.query('ROLLBACK').catch(() => {});
    client.release();
  }
});

test('countUnmigratedCoordinationActors: counts a legacy actor, drops it once resolved (enforce-ready gate)', async () => {
  // REPEATABLE READ = stable snapshot, so concurrent commits can't change the count between the two
  // reads. We resolve ONLY this test's own freshly-inserted row (no global migrate), so there is no
  // UPDATE conflict with other suites — the before/after delta is deterministically exactly 1.
  const client = await getDbPool().connect();
  try {
    await client.query('BEGIN ISOLATION LEVEL REPEATABLE READ');
    const tid = `${PREFIX}gate`;
    await client.query(
      `INSERT INTO topics (topic_id, project_id, name, charter, created_by) VALUES ($1, $2, 'n', 'c', $3)`,
      [tid, `${PREFIX}proj`, `${PREFIX}legacyGate`],
    );
    const before = await countUnmigratedCoordinationActors(client);
    assert.ok(before >= 1, 'the un-migrated legacy actor is counted');

    // Resolve just our actor: create a principal and point our row at it.
    const pr = await client.query<{ principal_id: string }>(
      `INSERT INTO principals (kind, status, display_name, is_root) VALUES ('agent','active',$1,false) RETURNING principal_id`,
      [`${PREFIX}gateResolved`],
    );
    await client.query(`UPDATE topics SET created_by = $1 WHERE topic_id = $2`, [pr.rows[0].principal_id, tid]);

    const after = await countUnmigratedCoordinationActors(client);
    assert.equal(after, before - 1, 'resolving exactly our one legacy actor drops the count by exactly 1');
  } finally {
    await client.query('ROLLBACK').catch(() => {});
    client.release();
  }
});
