/**
 * Phase 15 Sprint 15.4 — decisionBodies service unit tests.
 *
 * Design ref: docs/specs/2026-05-18-phase-15-sprint-15.4-design.md §2, §9.
 *
 * Covers:
 *   T2 createBody — valid → row with supplied fields; quorum<0 / threshold>1 /
 *      threshold<=0 / empty name → BAD_REQUEST
 *   T3 addBodyMember — new → {ok}+row; idempotent re-add updates weight;
 *      unknown body → body_not_found; vote_weight<=0 → BAD_REQUEST
 *   T4 getBody / listBodies — body + members snapshot; unknown id → null;
 *      listBodies returns only the project's bodies
 */

import assert from 'node:assert/strict';
import test, { before, after, beforeEach } from 'node:test';
import { createBody, addBodyMember, getBody, listBodies } from './decisionBodies.js';
import { getDbPool } from '../db/client.js';

const TEST_PROJECT = '__test_decision_bodies__';
const OTHER_PROJECT = '__test_decision_bodies_other__';

async function cleanup() {
  const pool = getDbPool();
  for (const proj of [TEST_PROJECT, OTHER_PROJECT]) {
    const bodyIds = await pool.query<{ body_id: string }>(
      `SELECT body_id FROM decision_bodies WHERE project_id = $1`,
      [proj],
    );
    for (const { body_id } of bodyIds.rows) {
      await pool.query(`DELETE FROM body_members WHERE body_id = $1`, [body_id]);
    }
    await pool.query(`DELETE FROM decision_bodies WHERE project_id = $1`, [proj]);
  }
}

before(cleanup);
after(cleanup);
beforeEach(cleanup);

// ── T2: createBody ──────────────────────────────────────────────────────────

test('T2: createBody valid → row with supplied fields', async () => {
  const body = await createBody({
    project_id: TEST_PROJECT,
    name: 'Steering Committee',
    quorum: 5,
    threshold: 0.6,
    veto_holders: ['golden-share'],
    created_by: 'founder',
  });
  assert.ok(body.body_id, 'body_id generated');
  assert.equal(body.project_id, TEST_PROJECT);
  assert.equal(body.name, 'Steering Committee');
  assert.equal(Number(body.quorum), 5);
  assert.equal(Number(body.threshold), 0.6);
  assert.deepEqual(body.veto_holders, ['golden-share']);
  assert.equal(body.created_by, 'founder');
  assert.ok(body.created_at, 'created_at present');
});

test('T2: createBody default veto_holders → empty array', async () => {
  const body = await createBody({
    project_id: TEST_PROJECT,
    name: 'Plain Body',
    quorum: 0,
    threshold: 0.5,
    created_by: 'founder',
  });
  assert.deepEqual(body.veto_holders, []);
});

test('T2: createBody quorum<0 → BAD_REQUEST', async () => {
  await assert.rejects(
    () => createBody({ project_id: TEST_PROJECT, name: 'X', quorum: -1, threshold: 0.5, created_by: 'f' }),
    (err: any) => { assert.equal(err.code, 'BAD_REQUEST'); return true; },
  );
});

test('T2: createBody threshold>1 → BAD_REQUEST', async () => {
  await assert.rejects(
    () => createBody({ project_id: TEST_PROJECT, name: 'X', quorum: 0, threshold: 1.5, created_by: 'f' }),
    (err: any) => { assert.equal(err.code, 'BAD_REQUEST'); return true; },
  );
});

test('T2: createBody threshold<=0 → BAD_REQUEST', async () => {
  await assert.rejects(
    () => createBody({ project_id: TEST_PROJECT, name: 'X', quorum: 0, threshold: 0, created_by: 'f' }),
    (err: any) => { assert.equal(err.code, 'BAD_REQUEST'); return true; },
  );
});

test('T2: createBody empty name → BAD_REQUEST', async () => {
  await assert.rejects(
    () => createBody({ project_id: TEST_PROJECT, name: '   ', quorum: 0, threshold: 0.5, created_by: 'f' }),
    (err: any) => { assert.equal(err.code, 'BAD_REQUEST'); return true; },
  );
});

test('T2: createBody empty created_by → BAD_REQUEST', async () => {
  await assert.rejects(
    () => createBody({ project_id: TEST_PROJECT, name: 'X', quorum: 0, threshold: 0.5, created_by: '' }),
    (err: any) => { assert.equal(err.code, 'BAD_REQUEST'); return true; },
  );
});

test('T2: createBody name over 256 chars → BAD_REQUEST', async () => {
  await assert.rejects(
    () => createBody({ project_id: TEST_PROJECT, name: 'x'.repeat(257), quorum: 0, threshold: 0.5, created_by: 'f' }),
    (err: any) => { assert.equal(err.code, 'BAD_REQUEST'); return true; },
  );
});

test('T2: createBody non-finite threshold → BAD_REQUEST', async () => {
  await assert.rejects(
    () => createBody({ project_id: TEST_PROJECT, name: 'X', quorum: 0, threshold: NaN, created_by: 'f' }),
    (err: any) => { assert.equal(err.code, 'BAD_REQUEST'); return true; },
  );
});

test('T2: createBody veto_holders with an empty string → BAD_REQUEST', async () => {
  await assert.rejects(
    () => createBody({ project_id: TEST_PROJECT, name: 'X', quorum: 0, threshold: 0.5, veto_holders: ['ok', ''], created_by: 'f' }),
    (err: any) => { assert.equal(err.code, 'BAD_REQUEST'); return true; },
  );
});

// ── T3: addBodyMember ───────────────────────────────────────────────────────

test('T3: addBodyMember new → {ok} + row', async () => {
  const body = await createBody({ project_id: TEST_PROJECT, name: 'B', quorum: 0, threshold: 0.5, created_by: 'f' });
  const res = await addBodyMember({ body_id: body.body_id, actor_id: 'alice', vote_weight: 3 });
  assert.equal(res.status, 'ok');
  if (res.status !== 'ok') throw new Error('add failed');
  assert.equal(res.body_id, body.body_id);
  assert.equal(res.actor_id, 'alice');
  assert.equal(Number(res.vote_weight), 3);

  const pool = getDbPool();
  const row = await pool.query<{ vote_weight: string }>(
    `SELECT vote_weight FROM body_members WHERE body_id=$1 AND actor_id=$2`,
    [body.body_id, 'alice'],
  );
  assert.equal(row.rowCount, 1);
  assert.equal(Number(row.rows[0].vote_weight), 3);
});

test('T3: addBodyMember idempotent re-add updates weight', async () => {
  const body = await createBody({ project_id: TEST_PROJECT, name: 'B', quorum: 0, threshold: 0.5, created_by: 'f' });
  await addBodyMember({ body_id: body.body_id, actor_id: 'bob', vote_weight: 2 });
  const res = await addBodyMember({ body_id: body.body_id, actor_id: 'bob', vote_weight: 7 });
  assert.equal(res.status, 'ok');

  const pool = getDbPool();
  const row = await pool.query<{ vote_weight: string; n: string }>(
    `SELECT vote_weight FROM body_members WHERE body_id=$1 AND actor_id=$2`,
    [body.body_id, 'bob'],
  );
  assert.equal(row.rowCount, 1, 're-add does not create a duplicate row');
  assert.equal(Number(row.rows[0].vote_weight), 7, 'weight updated to the new value');
});

test('T3: addBodyMember unknown body → body_not_found', async () => {
  const res = await addBodyMember({
    body_id: '00000000-0000-0000-0000-000000000000',
    actor_id: 'ghost',
    vote_weight: 1,
  });
  assert.equal(res.status, 'body_not_found');
});

test('T3: addBodyMember vote_weight<=0 → BAD_REQUEST', async () => {
  const body = await createBody({ project_id: TEST_PROJECT, name: 'B', quorum: 0, threshold: 0.5, created_by: 'f' });
  await assert.rejects(
    () => addBodyMember({ body_id: body.body_id, actor_id: 'z', vote_weight: 0 }),
    (err: any) => { assert.equal(err.code, 'BAD_REQUEST'); return true; },
  );
});

test('T3: addBodyMember empty actor_id → BAD_REQUEST', async () => {
  const body = await createBody({ project_id: TEST_PROJECT, name: 'B', quorum: 0, threshold: 0.5, created_by: 'f' });
  await assert.rejects(
    () => addBodyMember({ body_id: body.body_id, actor_id: '', vote_weight: 1 }),
    (err: any) => { assert.equal(err.code, 'BAD_REQUEST'); return true; },
  );
});

// ── T4: getBody / listBodies ────────────────────────────────────────────────

test('T4: getBody returns body + the full member set in one snapshot', async () => {
  const body = await createBody({ project_id: TEST_PROJECT, name: 'Council', quorum: 2, threshold: 0.5, created_by: 'f' });
  await addBodyMember({ body_id: body.body_id, actor_id: 'm1', vote_weight: 1 });
  await addBodyMember({ body_id: body.body_id, actor_id: 'm2', vote_weight: 4 });

  const fetched = await getBody({ body_id: body.body_id });
  assert.ok(fetched, 'body found');
  assert.equal(fetched!.body_id, body.body_id);
  assert.equal(fetched!.name, 'Council');
  assert.equal(fetched!.members.length, 2);
  const byActor = new Map(fetched!.members.map((m) => [m.actor_id, Number(m.vote_weight)]));
  assert.equal(byActor.get('m1'), 1);
  assert.equal(byActor.get('m2'), 4);
});

test('T4: getBody unknown id → null', async () => {
  const fetched = await getBody({ body_id: '00000000-0000-0000-0000-000000000000' });
  assert.equal(fetched, null);
});

test('T4: getBody with no members → empty members array', async () => {
  const body = await createBody({ project_id: TEST_PROJECT, name: 'Empty', quorum: 0, threshold: 0.5, created_by: 'f' });
  const fetched = await getBody({ body_id: body.body_id });
  assert.ok(fetched);
  assert.deepEqual(fetched!.members, []);
});

test('T4: listBodies returns only the project’s bodies', async () => {
  const b1 = await createBody({ project_id: TEST_PROJECT, name: 'B1', quorum: 0, threshold: 0.5, created_by: 'f' });
  await createBody({ project_id: TEST_PROJECT, name: 'B2', quorum: 0, threshold: 0.5, created_by: 'f' });
  await createBody({ project_id: OTHER_PROJECT, name: 'Foreign', quorum: 0, threshold: 0.5, created_by: 'f' });
  await addBodyMember({ body_id: b1.body_id, actor_id: 'm', vote_weight: 1 });

  const res = await listBodies({ project_id: TEST_PROJECT });
  assert.equal(res.bodies.length, 2, 'only the two TEST_PROJECT bodies');
  const names = res.bodies.map((b) => b.name).sort();
  assert.deepEqual(names, ['B1', 'B2']);
  const b1Fetched = res.bodies.find((b) => b.body_id === b1.body_id);
  assert.equal(b1Fetched!.members.length, 1, 'listBodies carries each body’s members');
});
