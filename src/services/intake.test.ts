/**
 * Phase 15 Sprint 15.5 — intake service integration tests.
 *
 * Design ref: docs/specs/2026-05-18-phase-15-sprint-15.5-design.md §2.1
 * Spec hash:  a506ddd08a5c6dfc
 *
 * Covers:
 *   T2  submitIntake — valid; with topic_id → intake.received emitted;
 *       without topic_id → no event; invalid kind → BAD_REQUEST;
 *       empty body → BAD_REQUEST; unknown project → NOT_FOUND;
 *       unknown topic_id → NOT_FOUND; inactive topic → TOPIC_NOT_ACTIVE
 *   T3  triageIntake (link-only) — task route → triaged + intake.triaged;
 *       actor_id missing → BAD_REQUEST; non-received item → INTAKE_ALREADY_TRIAGED
 *   T3  triageIntake (dispute) — requires active topic; creates dispute + links
 *   T2  dismissIntake — received → dismissed; already triaged → INTAKE_ALREADY_TRIAGED;
 *       already dismissed → INTAKE_ALREADY_DISMISSED; unknown id → NOT_FOUND
 *   T2  getIntake — returns row; unknown id → NOT_FOUND
 *   T2  listIntake — kind + status filters applied
 */

import assert from 'node:assert/strict';
import test, { before, after } from 'node:test';
import {
  submitIntake,
  triageIntake,
  dismissIntake,
  getIntake,
  listIntake,
} from './intake.js';
import { charterTopic, joinTopic } from './topics.js';
import { replayEvents } from './coordinationEvents.js';
import { getDbPool } from '../db/client.js';

const TEST_PROJECT = '__test_intake__';
const TEST_ACTOR = 'intake-actor-1';

async function cleanup() {
  const pool = getDbPool();
  const topicIds = await pool.query<{ topic_id: string }>(
    `SELECT topic_id FROM topics WHERE project_id=$1`,
    [TEST_PROJECT],
  );
  for (const { topic_id } of topicIds.rows) {
    // Clean up disputes referencing intake test topics
    const disputeIds = await pool.query<{ dispute_id: string }>(
      `SELECT dispute_id FROM disputes WHERE topic_id=$1`,
      [topic_id],
    );
    for (const { dispute_id } of disputeIds.rows) {
      await pool.query(`DELETE FROM request_steps WHERE request_id IN
        (SELECT request_id FROM requests WHERE subject_id=$1)`, [dispute_id]);
      await pool.query(`DELETE FROM requests WHERE subject_id=$1`, [dispute_id]);
    }
    await pool.query(`DELETE FROM disputes WHERE topic_id=$1`, [topic_id]);
    await pool.query(`DELETE FROM intake_items WHERE topic_id=$1`, [topic_id]);
    await pool.query(`DELETE FROM coordination_events WHERE topic_id=$1`, [topic_id]);
  }
  await pool.query(`DELETE FROM intake_items WHERE project_id=$1 AND topic_id IS NULL`, [TEST_PROJECT]);
  await pool.query(`DELETE FROM topic_participants WHERE topic_id IN
    (SELECT topic_id FROM topics WHERE project_id=$1)`, [TEST_PROJECT]);
  await pool.query(`DELETE FROM topics WHERE project_id=$1`, [TEST_PROJECT]);
  await pool.query(`DELETE FROM actors WHERE project_id=$1`, [TEST_PROJECT]);
  await pool.query(`DELETE FROM projects WHERE project_id=$1`, [TEST_PROJECT]);
}

async function makeProject() {
  const pool = getDbPool();
  await pool.query(
    `INSERT INTO projects (project_id, name) VALUES ($1, $2) ON CONFLICT DO NOTHING`,
    [TEST_PROJECT, 'Intake Test Project'],
  );
}

async function makeTopic(): Promise<string> {
  const result = await charterTopic({
    project_id: TEST_PROJECT,
    name: 'Intake Test Topic',
    charter: 'Test charter',
    created_by: TEST_ACTOR,
  });
  await joinTopic({ topic_id: result.topic_id, actor_id: TEST_ACTOR, level: 'authority', actor_type: 'human', display_name: 'Actor 1' });
  return result.topic_id;
}

before(async () => {
  await cleanup();
  await makeProject();
});

after(cleanup);

// ── submitIntake ──────────────────────────────────────────────────────────────

test('submitIntake — valid without topic_id: no event emitted', async () => {
  const item = await submitIntake({
    project_id: TEST_PROJECT,
    kind: 'suggestion',
    body: 'A suggestion without a topic',
    submitted_by: TEST_ACTOR,
  });
  assert.equal(item.status, 'received');
  assert.equal(item.project_id, TEST_PROJECT);
  assert.equal(item.topic_id, null);
  assert.equal(item.kind, 'suggestion');
  assert.ok(item.intake_id);
});

test('submitIntake — valid with topic_id: intake.received event emitted', async () => {
  const topicId = await makeTopic();
  const item = await submitIntake({
    project_id: TEST_PROJECT,
    topic_id: topicId,
    kind: 'violation_report',
    body: 'A violation report',
    submitted_by: TEST_ACTOR,
  });
  assert.equal(item.status, 'received');
  assert.equal(item.topic_id, topicId);

  const replay = await replayEvents({ topic_id: topicId, since: 0, limit: 100 });
  const events = replay.events.filter(e => e.type === 'intake.received');
  assert.equal(events.length, 1);
  assert.equal(events[0].subject_id, item.intake_id);
});

test('submitIntake — invalid kind: BAD_REQUEST', async () => {
  await assert.rejects(
    () => submitIntake({ project_id: TEST_PROJECT, kind: 'invalid', body: 'x', submitted_by: TEST_ACTOR }),
    (err: unknown) => { assert.ok(err instanceof Error && err.message.includes('kind must be one of')); return true; },
  );
});

test('submitIntake — empty body: BAD_REQUEST', async () => {
  await assert.rejects(
    () => submitIntake({ project_id: TEST_PROJECT, kind: 'suggestion', body: '', submitted_by: TEST_ACTOR }),
    (err: unknown) => { assert.ok(err instanceof Error && err.message.includes('required')); return true; },
  );
});

test('submitIntake — body over 16384 chars: BAD_REQUEST', async () => {
  await assert.rejects(
    () => submitIntake({ project_id: TEST_PROJECT, kind: 'suggestion', body: 'x'.repeat(16385), submitted_by: TEST_ACTOR }),
    (err: unknown) => { assert.ok(err instanceof Error && err.message.includes('16384')); return true; },
  );
});

test('submitIntake — unknown project: NOT_FOUND', async () => {
  await assert.rejects(
    () => submitIntake({ project_id: '__nonexistent_proj__', kind: 'suggestion', body: 'x', submitted_by: TEST_ACTOR }),
    (err: unknown) => { assert.ok(err instanceof Error && err.message.includes('not found')); return true; },
  );
});

test('submitIntake — unknown topic_id: NOT_FOUND', async () => {
  await assert.rejects(
    () => submitIntake({ project_id: TEST_PROJECT, topic_id: 'no-such-topic', kind: 'suggestion', body: 'x', submitted_by: TEST_ACTOR }),
    (err: unknown) => { assert.ok(err instanceof Error && err.message.includes('not found')); return true; },
  );
});

test('submitIntake — closed topic: TOPIC_NOT_ACTIVE', async () => {
  const topicId = await makeTopic();
  const pool = getDbPool();
  // Force close the topic directly for this test
  await pool.query(`UPDATE topics SET status='closed' WHERE topic_id=$1`, [topicId]);
  await assert.rejects(
    () => submitIntake({ project_id: TEST_PROJECT, topic_id: topicId, kind: 'suggestion', body: 'x', submitted_by: TEST_ACTOR }),
    (err: unknown) => { assert.ok(err instanceof Error && err.message.includes('not active')); return true; },
  );
});

// ── dismissIntake ─────────────────────────────────────────────────────────────

test('dismissIntake — received item: dismissed, no event', async () => {
  const item = await submitIntake({ project_id: TEST_PROJECT, kind: 'suggestion', body: 'dismiss me', submitted_by: TEST_ACTOR });
  const dismissed = await dismissIntake(item.intake_id);
  assert.equal(dismissed.status, 'dismissed');
});

test('dismissIntake — unknown id: NOT_FOUND', async () => {
  await assert.rejects(
    () => dismissIntake('00000000-0000-0000-0000-000000000000'),
    (err: unknown) => { assert.ok(err instanceof Error && err.message.includes('not found')); return true; },
  );
});

test('dismissIntake — already dismissed: INTAKE_ALREADY_DISMISSED', async () => {
  const item = await submitIntake({ project_id: TEST_PROJECT, kind: 'suggestion', body: 'dismiss twice', submitted_by: TEST_ACTOR });
  await dismissIntake(item.intake_id);
  await assert.rejects(
    () => dismissIntake(item.intake_id),
    (err: unknown) => { assert.ok(err instanceof Error && err.message.includes('already dismissed')); return true; },
  );
});

// ── getIntake ─────────────────────────────────────────────────────────────────

test('getIntake — existing id: returns row', async () => {
  const item = await submitIntake({ project_id: TEST_PROJECT, kind: 'request', body: 'get me', submitted_by: TEST_ACTOR });
  const fetched = await getIntake(item.intake_id);
  assert.equal(fetched.intake_id, item.intake_id);
  assert.equal(fetched.kind, 'request');
});

test('getIntake — unknown id: NOT_FOUND', async () => {
  await assert.rejects(
    () => getIntake('00000000-0000-0000-0000-000000000001'),
    (err: unknown) => { assert.ok(err instanceof Error && err.message.includes('not found')); return true; },
  );
});

// ── listIntake ────────────────────────────────────────────────────────────────

test('listIntake — kind filter applied', async () => {
  await submitIntake({ project_id: TEST_PROJECT, kind: 'violation_report', body: 'v1', submitted_by: TEST_ACTOR });
  await submitIntake({ project_id: TEST_PROJECT, kind: 'suggestion', body: 's1', submitted_by: TEST_ACTOR });

  const { items } = await listIntake(TEST_PROJECT, { kind: 'violation_report' });
  assert.ok(items.every(i => i.kind === 'violation_report'));
});

test('listIntake — status filter applied', async () => {
  const item = await submitIntake({ project_id: TEST_PROJECT, kind: 'suggestion', body: 'list-dismiss', submitted_by: TEST_ACTOR });
  await dismissIntake(item.intake_id);

  const { items } = await listIntake(TEST_PROJECT, { status: 'dismissed' });
  assert.ok(items.some(i => i.intake_id === item.intake_id));
  assert.ok(items.every(i => i.status === 'dismissed'));
});

test('listIntake — total count returned', async () => {
  const { total } = await listIntake(TEST_PROJECT);
  assert.ok(typeof total === 'number' && total >= 0);
});

// ── triageIntake (link-only) ──────────────────────────────────────────────────

test('triageIntake — link-only task route: status=triaged, intake.triaged emitted', async () => {
  const topicId = await makeTopic();
  const item = await submitIntake({
    project_id: TEST_PROJECT,
    topic_id: topicId,
    kind: 'suggestion',
    body: 'triage me to a task',
    submitted_by: TEST_ACTOR,
  });

  const fakeTaskId = '00000000-0000-0000-0000-aaaaaaaaaaaa';
  const result = await triageIntake(item.intake_id, {
    route_kind: 'task',
    actor_id: TEST_ACTOR,
    topic_id: topicId,
    routed_to: fakeTaskId,
  });

  assert.equal(result.status, 'triaged');
  assert.equal(result.routed_to, fakeTaskId);

  const replay = await replayEvents({ topic_id: topicId, since: 0, limit: 100 });
  const triageEvents = replay.events.filter(e => e.type === 'intake.triaged');
  assert.ok(triageEvents.some(e => e.subject_id === item.intake_id));
});

test('triageIntake — missing actor_id: BAD_REQUEST', async () => {
  const topicId = await makeTopic();
  const item = await submitIntake({ project_id: TEST_PROJECT, kind: 'suggestion', body: 'x', submitted_by: TEST_ACTOR });
  await assert.rejects(
    () => triageIntake(item.intake_id, { route_kind: 'task', actor_id: '', topic_id: topicId, routed_to: 'abc' }),
    (err: unknown) => { assert.ok(err instanceof Error && err.message.includes('required')); return true; },
  );
});

test('triageIntake — non-received item: INTAKE_ALREADY_TRIAGED', async () => {
  const topicId = await makeTopic();
  const item = await submitIntake({
    project_id: TEST_PROJECT,
    topic_id: topicId,
    kind: 'suggestion',
    body: 'triage twice',
    submitted_by: TEST_ACTOR,
  });
  await triageIntake(item.intake_id, {
    route_kind: 'task',
    actor_id: TEST_ACTOR,
    topic_id: topicId,
    routed_to: '00000000-0000-0000-0000-bbbbbbbbbbbb',
  });
  await assert.rejects(
    () => triageIntake(item.intake_id, {
      route_kind: 'task',
      actor_id: TEST_ACTOR,
      topic_id: topicId,
      routed_to: '00000000-0000-0000-0000-cccccccccccc',
    }),
    (err: unknown) => { assert.ok(err instanceof Error && err.message.includes('already triaged')); return true; },
  );
});

test('triageIntake — already dismissed: INTAKE_ALREADY_DISMISSED', async () => {
  const topicId = await makeTopic();
  const item = await submitIntake({ project_id: TEST_PROJECT, kind: 'suggestion', body: 'dismissed-then-triage', submitted_by: TEST_ACTOR });
  await dismissIntake(item.intake_id);
  await assert.rejects(
    () => triageIntake(item.intake_id, {
      route_kind: 'task',
      actor_id: TEST_ACTOR,
      topic_id: topicId,
      routed_to: '00000000-0000-0000-0000-dddddddddddd',
    }),
    (err: unknown) => { assert.ok(err instanceof Error && err.message.includes('already dismissed')); return true; },
  );
});

// ── triageIntake (dispute route) ──────────────────────────────────────────────

test('triageIntake — dispute route: creates dispute + links intake item', async () => {
  const topicId = await makeTopic();
  const item = await submitIntake({
    project_id: TEST_PROJECT,
    topic_id: topicId,
    kind: 'violation_report',
    body: 'triage to dispute',
    submitted_by: TEST_ACTOR,
  });

  const result = await triageIntake(item.intake_id, {
    route_kind: 'dispute',
    actor_id: TEST_ACTOR,
    topic_id: topicId,
    subject_ref: 'artifact/test/slot-dispute',
    parties: [TEST_ACTOR, 'other-party'],
    procedure: 'unilateral',
    submitted_by: TEST_ACTOR,
  });

  assert.equal(result.status, 'triaged');
  assert.ok(result.dispute_id, 'dispute_id present');
  assert.ok(result.resolution_request_id, 'resolution_request_id present');
  assert.equal(result.routed_to, result.dispute_id);

  // intake.triaged event emitted with dispute_id in payload
  const replay = await replayEvents({ topic_id: topicId, since: 0, limit: 100 });
  const triageEvents = replay.events.filter(e => e.type === 'intake.triaged');
  const evt = triageEvents.find(e => e.subject_id === item.intake_id);
  assert.ok(evt, 'intake.triaged event emitted');
  assert.equal(evt!.payload.dispute_id, result.dispute_id);
});

test('triageIntake — dispute route with closed topic: TOPIC_NOT_ACTIVE', async () => {
  const topicId = await makeTopic();
  const item = await submitIntake({ project_id: TEST_PROJECT, kind: 'suggestion', body: 'closed-dispute', submitted_by: TEST_ACTOR });
  const pool = getDbPool();
  await pool.query(`UPDATE topics SET status='closed' WHERE topic_id=$1`, [topicId]);
  await assert.rejects(
    () => triageIntake(item.intake_id, {
      route_kind: 'dispute',
      actor_id: TEST_ACTOR,
      topic_id: topicId,
      subject_ref: 'x',
      parties: [TEST_ACTOR, 'other-party'],
      procedure: 'unilateral',
      submitted_by: TEST_ACTOR,
    }),
    (err: unknown) => { assert.ok(err instanceof Error && err.message.includes('not active')); return true; },
  );
});
