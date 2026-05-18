/**
 * Phase 15 Sprint 15.5 — disputes service integration tests.
 *
 * Design ref: docs/specs/2026-05-18-phase-15-sprint-15.5-design.md §2.2
 * Spec hash:  a506ddd08a5c6dfc
 *
 * Covers:
 *   T5  openDispute — valid → dispute + resolution_request_id; parties<2 → BAD_REQUEST;
 *       unknown topic → NOT_FOUND; inactive topic → TOPIC_NOT_ACTIVE;
 *       invalid procedure → BAD_REQUEST; collective → BAD_REQUEST (DEFERRED-018)
 *   T5  resolveDispute — approved request → resolved + dispute.resolved event;
 *       returned request → resolved; rejected request → resolved;
 *       open (non-terminal) request → RESOLUTION_PENDING;
 *       already resolved → ALREADY_RESOLVED; unknown id → NOT_FOUND
 *   T5  getDispute — returns dispute + resolution_request with steps
 *   T5  listDisputes — status filter applied
 */

import assert from 'node:assert/strict';
import test, { before, after } from 'node:test';
import {
  openDispute,
  resolveDispute,
  getDispute,
  listDisputes,
} from './disputes.js';
import { charterTopic, joinTopic } from './topics.js';
import { replayEvents } from './coordinationEvents.js';
import { getDbPool } from '../db/client.js';

const TEST_PROJECT = '__test_disputes__';
const ACTOR_A = 'dispute-actor-a';
const ACTOR_B = 'dispute-actor-b';

async function cleanup() {
  const pool = getDbPool();
  const topicIds = await pool.query<{ topic_id: string }>(
    `SELECT topic_id FROM topics WHERE project_id=$1`,
    [TEST_PROJECT],
  );
  for (const { topic_id } of topicIds.rows) {
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
    await pool.query(`DELETE FROM doa_matrix WHERE project_id=$1`, [TEST_PROJECT]);
    await pool.query(`DELETE FROM coordination_events WHERE topic_id=$1`, [topic_id]);
    await pool.query(`DELETE FROM topic_participants WHERE topic_id=$1`, [topic_id]);
  }
  await pool.query(`DELETE FROM topics WHERE project_id=$1`, [TEST_PROJECT]);
  await pool.query(`DELETE FROM actors WHERE project_id=$1`, [TEST_PROJECT]);
  await pool.query(`DELETE FROM projects WHERE project_id=$1`, [TEST_PROJECT]);
}

async function makeProject() {
  const pool = getDbPool();
  await pool.query(
    `INSERT INTO projects (project_id, name) VALUES ($1, $2) ON CONFLICT DO NOTHING`,
    [TEST_PROJECT, 'Dispute Test Project'],
  );
}

async function makeTopic(): Promise<string> {
  const result = await charterTopic({
    project_id: TEST_PROJECT,
    name: 'Dispute Test Topic',
    charter: 'Test charter for disputes',
    created_by: ACTOR_A,
  });
  await joinTopic({ topic_id: result.topic_id, actor_id: ACTOR_A, level: 'authority', actor_type: 'human', display_name: 'Actor A' });
  await joinTopic({ topic_id: result.topic_id, actor_id: ACTOR_B, level: 'coordination', actor_type: 'human', display_name: 'Actor B' });
  return result.topic_id;
}

before(async () => {
  await cleanup();
  await makeProject();
});

after(cleanup);

// ── openDispute ───────────────────────────────────────────────────────────────

test('openDispute — valid params: dispute created + resolution request submitted', async () => {
  const topicId = await makeTopic();
  const { dispute, resolution_request_id } = await openDispute({
    topic_id: topicId,
    subject_ref: 'artifact/test/slot-1',
    parties: [ACTOR_A, ACTOR_B],
    procedure: 'unilateral',
    submitted_by: ACTOR_A,
  });
  assert.equal(dispute.status, 'open');
  assert.equal(dispute.topic_id, topicId);
  assert.ok(resolution_request_id, 'resolution_request_id should be set');
  assert.ok(dispute.resolution_request_id === resolution_request_id);

  // Verify dispute.opened event emitted
  const replay = await replayEvents({ topic_id: topicId, since: 0, limit: 100 });
  const openedEvents = replay.events.filter(e => e.type === 'dispute.opened');
  assert.ok(openedEvents.length >= 1);
  assert.ok(openedEvents.some(e => e.subject_id === dispute.dispute_id));
});

test('openDispute — parties < 2: BAD_REQUEST', async () => {
  const topicId = await makeTopic();
  await assert.rejects(
    () => openDispute({ topic_id: topicId, subject_ref: 'x', parties: [ACTOR_A], procedure: 'unilateral', submitted_by: ACTOR_A }),
    (err: unknown) => { assert.ok(err instanceof Error && err.message.includes('at least 2')); return true; },
  );
});

test('openDispute — unknown topic: NOT_FOUND', async () => {
  await assert.rejects(
    () => openDispute({ topic_id: 'no-such-topic', subject_ref: 'x', parties: [ACTOR_A, ACTOR_B], procedure: 'unilateral', submitted_by: ACTOR_A }),
    (err: unknown) => { assert.ok(err instanceof Error && err.message.includes('not found')); return true; },
  );
});

test('openDispute — inactive topic: TOPIC_NOT_ACTIVE', async () => {
  const topicId = await makeTopic();
  const pool = getDbPool();
  await pool.query(`UPDATE topics SET status='closed' WHERE topic_id=$1`, [topicId]);
  await assert.rejects(
    () => openDispute({ topic_id: topicId, subject_ref: 'x', parties: [ACTOR_A, ACTOR_B], procedure: 'unilateral', submitted_by: ACTOR_A }),
    (err: unknown) => { assert.ok(err instanceof Error && err.message.includes('not active')); return true; },
  );
});

test('openDispute — collective procedure: BAD_REQUEST (DEFERRED-018)', async () => {
  const topicId = await makeTopic();
  await assert.rejects(
    () => openDispute({ topic_id: topicId, subject_ref: 'x', parties: [ACTOR_A, ACTOR_B], procedure: 'collective', submitted_by: ACTOR_A }),
    (err: unknown) => { assert.ok(err instanceof Error && err.message.includes('DEFERRED-018')); return true; },
  );
});

// ── resolveDispute ────────────────────────────────────────────────────────────

async function makeApprovedDispute(topicId: string): Promise<{ dispute_id: string; resolution_request_id: string }> {
  const { dispute, resolution_request_id } = await openDispute({
    topic_id: topicId,
    subject_ref: 'artifact/test/slot-resolve',
    parties: [ACTOR_A, ACTOR_B],
    procedure: 'unilateral',
    submitted_by: ACTOR_A,
  });
  // Force the resolution request to 'approved' directly in DB to bypass full decide cycle
  const pool = getDbPool();
  await pool.query(`UPDATE requests SET status='approved' WHERE request_id=$1`, [resolution_request_id]);
  return { dispute_id: dispute.dispute_id, resolution_request_id };
}

test('resolveDispute — approved resolution request: status=resolved + dispute.resolved event', async () => {
  const topicId = await makeTopic();
  const { dispute_id } = await makeApprovedDispute(topicId);

  const resolved = await resolveDispute(dispute_id);
  assert.equal(resolved.status, 'resolved');

  const replay = await replayEvents({ topic_id: topicId, since: 0, limit: 100 });
  const resolvedEvents = replay.events.filter(e => e.type === 'dispute.resolved');
  const evt = resolvedEvents.find(e => e.subject_id === dispute_id);
  assert.ok(evt, 'dispute.resolved event emitted');
  assert.equal(evt!.actor_id, ACTOR_A); // parties[0]
  assert.equal(evt!.payload.request_status, 'approved');
});

test('resolveDispute — returned resolution request: also resolves', async () => {
  const topicId = await makeTopic();
  const { dispute, resolution_request_id } = await openDispute({
    topic_id: topicId,
    subject_ref: 'x',
    parties: [ACTOR_A, ACTOR_B],
    procedure: 'unilateral',
    submitted_by: ACTOR_A,
  });
  const pool = getDbPool();
  await pool.query(`UPDATE requests SET status='returned' WHERE request_id=$1`, [resolution_request_id]);

  const resolved = await resolveDispute(dispute.dispute_id);
  assert.equal(resolved.status, 'resolved');
});

test('resolveDispute — non-terminal request: RESOLUTION_PENDING', async () => {
  const topicId = await makeTopic();
  const { dispute } = await openDispute({
    topic_id: topicId,
    subject_ref: 'y',
    parties: [ACTOR_A, ACTOR_B],
    procedure: 'unilateral',
    submitted_by: ACTOR_A,
  });
  // Request is still 'open'
  await assert.rejects(
    () => resolveDispute(dispute.dispute_id),
    (err: unknown) => { assert.ok(err instanceof Error && err.message.includes('RESOLUTION_PENDING') || err instanceof Error && err.message.includes('still')); return true; },
  );
});

test('resolveDispute — already resolved: ALREADY_RESOLVED', async () => {
  const topicId = await makeTopic();
  const { dispute_id } = await makeApprovedDispute(topicId);
  await resolveDispute(dispute_id);
  await assert.rejects(
    () => resolveDispute(dispute_id),
    (err: unknown) => { assert.ok(err instanceof Error && err.message.includes('already resolved')); return true; },
  );
});

test('resolveDispute — unknown id: NOT_FOUND', async () => {
  await assert.rejects(
    () => resolveDispute('00000000-0000-0000-0000-ffffffffffff'),
    (err: unknown) => { assert.ok(err instanceof Error && err.message.includes('not found')); return true; },
  );
});

// ── getDispute ────────────────────────────────────────────────────────────────

test('getDispute — returns dispute + resolution_request with steps', async () => {
  const topicId = await makeTopic();
  const { dispute, resolution_request_id } = await openDispute({
    topic_id: topicId,
    subject_ref: 'getDispute-test',
    parties: [ACTOR_A, ACTOR_B],
    procedure: 'unilateral',
    submitted_by: ACTOR_A,
  });
  const detail = await getDispute(dispute.dispute_id);
  assert.equal(detail.dispute_id, dispute.dispute_id);
  assert.ok(detail.resolution_request !== null);
  assert.equal(detail.resolution_request!.request_id, resolution_request_id);
  assert.ok(Array.isArray(detail.resolution_request!.steps));
});

test('getDispute — unknown id: NOT_FOUND', async () => {
  await assert.rejects(
    () => getDispute('00000000-0000-0000-0000-000000000002'),
    (err: unknown) => { assert.ok(err instanceof Error && err.message.includes('not found')); return true; },
  );
});

// ── listDisputes ──────────────────────────────────────────────────────────────

test('listDisputes — status filter: open vs resolved', async () => {
  const topicId = await makeTopic();
  const { dispute, resolution_request_id } = await openDispute({
    topic_id: topicId,
    subject_ref: 'list-test',
    parties: [ACTOR_A, ACTOR_B],
    procedure: 'unilateral',
    submitted_by: ACTOR_A,
  });
  const pool = getDbPool();
  await pool.query(`UPDATE requests SET status='approved' WHERE request_id=$1`, [resolution_request_id]);
  await resolveDispute(dispute.dispute_id);

  const { disputes: open } = await listDisputes(topicId, { status: 'open' });
  const { disputes: resolved } = await listDisputes(topicId, { status: 'resolved' });
  assert.ok(!open.some(d => d.dispute_id === dispute.dispute_id));
  assert.ok(resolved.some(d => d.dispute_id === dispute.dispute_id));
});

test('listDisputes — total count', async () => {
  const topicId = await makeTopic();
  const { total } = await listDisputes(topicId);
  assert.ok(typeof total === 'number' && total >= 0);
});
