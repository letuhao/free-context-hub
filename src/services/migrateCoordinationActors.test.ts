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

test('migrate: the SAME legacy string in two tables maps to ONE principal [F1f-adv #4 dedup]', async () => {
  const client = await getDbPool().connect();
  try {
    await client.query('BEGIN');
    const tid = `${PREFIX}dedupT`;
    const shared = `${PREFIX}sharedActor`;
    // same string as a topic creator AND a dispute party
    await client.query(
      `INSERT INTO topics (topic_id, project_id, name, charter, created_by) VALUES ($1,$2,'n','c',$3)`,
      [tid, `${PREFIX}proj`, shared],
    );
    await client.query(`INSERT INTO disputes (topic_id, subject_ref, parties) VALUES ($1,'x',$2)`, [tid, [shared]]);
    await migrateCoordinationActorIds(client, { restrictTo: [shared] });
    const t = await client.query<{ created_by: string }>(`SELECT created_by FROM topics WHERE topic_id=$1`, [tid]);
    const d = await client.query<{ parties: string[] }>(`SELECT parties FROM disputes WHERE topic_id=$1`, [tid]);
    assert.equal(t.rows[0].created_by, d.rows[0].parties[0], 'one principal for the shared string across tables');
  } finally {
    await client.query('ROLLBACK').catch(() => {});
    client.release();
  }
});

test('migrate: blank actor excluded (no empty-display_name principal); over-long display_name truncated [F1f-adv #3]', async () => {
  const client = await getDbPool().connect();
  try {
    await client.query('BEGIN');
    const longActor = `${PREFIX}${'x'.repeat(400)}`;
    const tidLong = `${PREFIX}longT`;
    const tidBlank = `${PREFIX}blankT`;
    await client.query(`INSERT INTO topics (topic_id, project_id, name, charter, created_by) VALUES ($1,$2,'n','c',$3)`, [tidLong, `${PREFIX}proj`, longActor]);
    await client.query(`INSERT INTO topics (topic_id, project_id, name, charter, created_by) VALUES ($1,$2,'n','c',$3)`, [tidBlank, `${PREFIX}proj`, '']);
    await migrateCoordinationActorIds(client, { restrictTo: [longActor, ''] });

    // long: rewritten; the imported principal's display_name is truncated to 256
    const tl = await client.query<{ created_by: string }>(`SELECT created_by FROM topics WHERE topic_id=$1`, [tidLong]);
    assert.ok(isUuid(tl.rows[0].created_by));
    const pl = await client.query<{ display_name: string }>(`SELECT display_name FROM principals WHERE principal_id=$1`, [tl.rows[0].created_by]);
    assert.equal(pl.rows[0].display_name.length, 256);

    // blank: NOT migrated (stays ''), so no empty-display_name principal is created
    const tb = await client.query<{ created_by: string }>(`SELECT created_by FROM topics WHERE topic_id=$1`, [tidBlank]);
    assert.equal(tb.rows[0].created_by, '', 'blank actor left as-is, not turned into a principal');
  } finally {
    await client.query('ROLLBACK').catch(() => {});
    client.release();
  }
});

test('migrate: reserved system:/motion: sentinels are NOT imported as principals and do not block the gate [F1f-adv pass2 #1]', async () => {
  const client = await getDbPool().connect();
  try {
    await client.query('BEGIN ISOLATION LEVEL REPEATABLE READ');
    const tid = `${PREFIX}sentinelT`;
    // a synthetic system actor written by background services lands in an actor column
    await client.query(
      `INSERT INTO topics (topic_id, project_id, name, charter, created_by) VALUES ($1,$2,'n','c',$3)`,
      [tid, `${PREFIX}proj`, 'system:sweep'],
    );
    const beforeCount = await countUnmigratedCoordinationActors(client);
    await migrateCoordinationActorIds(client, { restrictTo: ['system:sweep'] });
    const t = await client.query<{ created_by: string }>(`SELECT created_by FROM topics WHERE topic_id=$1`, [tid]);
    assert.equal(t.rows[0].created_by, 'system:sweep', 'sentinel left as-is, not turned into a principal');
    const pr = await client.query<{ n: number }>(
      `SELECT count(*)::int AS n FROM principals WHERE display_name = 'system:sweep'`,
    );
    assert.equal(pr.rows[0].n, 0, 'no bogus principal minted for the sentinel');
    const afterCount = await countUnmigratedCoordinationActors(client);
    assert.equal(afterCount, beforeCount, 'sentinel never counted as un-migrated (gate not wedged)');
  } finally {
    await client.query('ROLLBACK').catch(() => {});
    client.release();
  }
});

test('migrate: array with MIXED elements — only the legacy element is rewritten; already-principal + sentinel preserved IN ORDER [review-impl F1 #4]', async () => {
  const client = await getDbPool().connect();
  try {
    await client.query('BEGIN');
    // An already-migrated principal to sit in the array alongside a legacy string and a sentinel.
    const pr = await client.query<{ principal_id: string }>(
      `INSERT INTO principals (kind, status, display_name, is_root) VALUES ('agent','active',$1,false) RETURNING principal_id`,
      [`${PREFIX}existing`],
    );
    const existingPid = pr.rows[0].principal_id;
    const legacy = `${PREFIX}mixedLegacy`;
    const tid = `${PREFIX}mixedT`;
    // parties = [legacy, existingPrincipal, system:resolve] — only `legacy` is in restrictTo.
    await client.query(
      `INSERT INTO disputes (topic_id, subject_ref, parties) VALUES ($1,'x',$2)`,
      [tid, [legacy, existingPid, 'system:resolve']],
    );
    await client.query(
      `INSERT INTO topics (topic_id, project_id, name, charter, created_by) VALUES ($1,$2,'n','c',$3)`,
      [tid, `${PREFIX}proj`, legacy],
    );

    await migrateCoordinationActorIds(client, { restrictTo: [legacy] });

    const d = await client.query<{ parties: string[] }>(`SELECT parties FROM disputes WHERE topic_id=$1`, [tid]);
    const parties = d.rows[0].parties;
    assert.equal(parties.length, 3, 'cardinality preserved');
    // [0] legacy -> a fresh principal uuid (and equals the topic.created_by mint for the same string)
    assert.ok(isUuid(parties[0]), 'legacy element rewritten to a uuid');
    const tc = await client.query<{ created_by: string }>(`SELECT created_by FROM topics WHERE topic_id=$1`, [tid]);
    assert.equal(parties[0], tc.rows[0].created_by, 'same legacy string -> one principal, even across scalar+array');
    // [1] already-principal -> untouched; [2] sentinel -> untouched. Order intact.
    assert.equal(parties[1], existingPid, 'already-principal element left as-is, position 1');
    assert.equal(parties[2], 'system:resolve', 'sentinel element left as-is, position 2');
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
