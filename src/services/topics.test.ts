/**
 * Phase 15 Sprint 15.1 — topics service unit tests.
 *
 * Design ref: docs/specs/2026-05-16-phase-15-sprint-15.1-design.md §8 (T6–T12).
 * Harness mirrored from src/services/artifactLeases.test.ts — real test DB.
 *
 * Covers:
 *   - charterTopic creates a chartered topic + emits topic.chartered seq 1
 *   - joinTopic registers actor / participant / event, flips chartered→active,
 *     returns a coherent induction pack
 *   - idempotent re-join + the since_seq>0 re-prime pack
 *   - re-join with a conflicting actor_type is rejected
 *   - getTopic returns topic + roster; NOT_FOUND for unknown
 *   - closeTopic emits topic.closed last, seals the log, is idempotent
 *   - actor identity is project-scoped
 */

import assert from 'node:assert/strict';
import test, { before, after, beforeEach } from 'node:test';
import { charterTopic, joinTopic, getTopic, closeTopic } from './topics.js';
import { replayEvents } from './coordinationEvents.js';
import { getDbPool } from '../db/client.js';

const TEST_PROJECT = '__test_topics__';
const TEST_PROJECT_B = '__test_topics_B__';

async function cleanup() {
  const pool = getDbPool();
  for (const proj of [TEST_PROJECT, TEST_PROJECT_B]) {
    await pool.query(
      `DELETE FROM coordination_events WHERE topic_id IN
         (SELECT topic_id FROM topics WHERE project_id = $1)`,
      [proj],
    );
    await pool.query(`DELETE FROM topics WHERE project_id = $1`, [proj]);
    await pool.query(`DELETE FROM actors WHERE project_id = $1`, [proj]);
  }
}

function mkTopic(projectId = TEST_PROJECT) {
  return charterTopic({
    project_id: projectId,
    name: 'Test Topic',
    charter: 'do the thing',
    created_by: 'creator-1',
  });
}

before(cleanup);
after(cleanup);
beforeEach(cleanup);

test('charterTopic creates a chartered topic and emits topic.chartered at seq 1', async () => {
  const t = await mkTopic();
  assert.equal(t.status, 'chartered');
  assert.equal(t.project_id, TEST_PROJECT);
  assert.ok(t.topic_id, 'topic_id is generated');
  const ev = await replayEvents({ topic_id: t.topic_id });
  assert.equal(ev.events.length, 1);
  assert.equal(ev.events[0].type, 'topic.chartered');
  assert.equal(ev.events[0].seq, 1);
});

test('joinTopic registers actor + participant, emits topic.actor_joined, flips to active', async () => {
  const t = await mkTopic();
  const pack = await joinTopic({
    topic_id: t.topic_id, actor_id: 'actor-A', actor_type: 'ai',
    display_name: 'Actor A', level: 'execution',
  });
  assert.equal(pack.topic.status, 'active', 'first join flips chartered -> active');
  assert.equal(pack.roster.length, 1);
  assert.equal(pack.roster[0].actor_id, 'actor-A');
  assert.equal(pack.roster[0].level, 'execution');
  assert.equal(pack.roster[0].type, 'ai');
  assert.deepEqual(pack.events.map((e) => e.type), ['topic.chartered', 'topic.actor_joined']);
  // coherence — your_cursor is the max seq in events
  assert.equal(pack.your_cursor, 2);
  assert.equal(pack.your_cursor, pack.events[pack.events.length - 1].seq);
  // coherence — every roster actor has its topic.actor_joined event in `events` (since_seq=0)
  for (const p of pack.roster) {
    const joined = pack.events.find(
      (e) => e.type === 'topic.actor_joined' && e.actor_id === p.actor_id,
    );
    assert.ok(joined, `roster actor ${p.actor_id} has its join event in events`);
  }
});

test('joinTopic re-join is idempotent; the since_seq>0 re-prime pack is coherent', async () => {
  const t = await mkTopic();
  const first = await joinTopic({
    topic_id: t.topic_id, actor_id: 'actor-A', actor_type: 'ai',
    display_name: 'Actor A', level: 'execution',
  });
  // re-join with since_seq = the first pack's cursor — the re-prime path
  const second = await joinTopic({
    topic_id: t.topic_id, actor_id: 'actor-A', actor_type: 'ai',
    display_name: 'Actor A', level: 'execution', since_seq: first.your_cursor,
  });
  assert.equal(second.roster.length, 1, 're-join adds no participant row');
  const full = await replayEvents({ topic_id: t.topic_id });
  assert.equal(
    full.events.filter((e) => e.type === 'topic.actor_joined').length, 1,
    're-join emits no second topic.actor_joined',
  );
  // since_seq>0 pack: events contains only events past the cursor
  for (const e of second.events) {
    assert.ok(e.seq > first.your_cursor, `event seq ${e.seq} is past since_seq ${first.your_cursor}`);
  }
  // your_cursor consistent with events (max seq, or since_seq when empty)
  const expectedCursor = second.events.length > 0
    ? second.events[second.events.length - 1].seq
    : first.your_cursor;
  assert.equal(second.your_cursor, expectedCursor);
});

test('joinTopic re-join with a conflicting actor_type throws BAD_REQUEST', async () => {
  const t = await mkTopic();
  await joinTopic({
    topic_id: t.topic_id, actor_id: 'actor-A', actor_type: 'ai',
    display_name: 'Actor A', level: 'execution',
  });
  await assert.rejects(
    joinTopic({
      topic_id: t.topic_id, actor_id: 'actor-A', actor_type: 'human',
      display_name: 'Actor A', level: 'execution',
    }),
    /already registered as/,
  );
});

test('getTopic returns the topic + full roster; NOT_FOUND for an unknown topic', async () => {
  const t = await mkTopic();
  await joinTopic({
    topic_id: t.topic_id, actor_id: 'actor-A', actor_type: 'ai',
    display_name: 'Actor A', level: 'coordination',
  });
  const got = await getTopic({ topic_id: t.topic_id });
  assert.equal(got.topic.topic_id, t.topic_id);
  assert.equal(got.topic.status, 'active');
  assert.equal(got.roster.length, 1);
  assert.equal(got.roster[0].level, 'coordination');
  await assert.rejects(getTopic({ topic_id: 'no-such-topic' }), /not found/);
});

test('closeTopic emits topic.closed last, seals the log, and is idempotent', async () => {
  const t = await mkTopic();
  await joinTopic({
    topic_id: t.topic_id, actor_id: 'actor-A', actor_type: 'human',
    display_name: 'Actor A', level: 'authority',
  });
  const closed = await closeTopic({ topic_id: t.topic_id, actor_id: 'actor-A' });
  assert.equal(closed.status, 'closed');
  assert.equal(closed.already_closed, false);

  const ev = await replayEvents({ topic_id: t.topic_id });
  assert.equal(ev.events[ev.events.length - 1].type, 'topic.closed', 'topic.closed is the last event');
  const evCountAfterClose = ev.events.length;

  // sealed — a subsequent join is rejected
  await assert.rejects(
    joinTopic({
      topic_id: t.topic_id, actor_id: 'actor-B', actor_type: 'ai',
      display_name: 'Actor B', level: 'execution',
    }),
    /is closed/,
  );

  // second close → already_closed, no new event
  const closed2 = await closeTopic({ topic_id: t.topic_id, actor_id: 'actor-A' });
  assert.equal(closed2.already_closed, true);
  const ev2 = await replayEvents({ topic_id: t.topic_id });
  assert.equal(ev2.events.length, evCountAfterClose, 'second close emits no event');
});

test('actor identity is project-scoped: same actor_id in two projects = two actors rows', async () => {
  const tA = await mkTopic(TEST_PROJECT);
  const tB = await mkTopic(TEST_PROJECT_B);
  await joinTopic({
    topic_id: tA.topic_id, actor_id: 'shared-actor', actor_type: 'ai',
    display_name: 'In A', level: 'execution',
  });
  await joinTopic({
    topic_id: tB.topic_id, actor_id: 'shared-actor', actor_type: 'human',
    display_name: 'In B', level: 'authority',
  });
  const pool = getDbPool();
  const r = await pool.query<{ project_id: string; type: string; display_name: string }>(
    `SELECT project_id, type, display_name FROM actors
     WHERE actor_id = 'shared-actor' AND project_id IN ($1, $2)
     ORDER BY project_id`,
    [TEST_PROJECT, TEST_PROJECT_B],
  );
  assert.equal(r.rows.length, 2, 'two distinct actors rows');
  const byProj = Object.fromEntries(r.rows.map((x) => [x.project_id, x]));
  assert.equal(byProj[TEST_PROJECT].type, 'ai');
  assert.equal(byProj[TEST_PROJECT_B].type, 'human');
});

// ── Sprint 15.6 — closeTopic drain tests (AC1, AC2, AC3, AC7, AC8, AC10) ────
//
// Uses a separate project constant + cleanup helper to accommodate board + request
// fixtures without interfering with the existing topics tests.

const TEST_PROJECT_DRAIN = '__test_topics_drain__';

async function cleanupDrain() {
  const pool = getDbPool();
  const topicIds = await pool.query<{ topic_id: string }>(
    `SELECT topic_id FROM topics WHERE project_id = $1`,
    [TEST_PROJECT_DRAIN],
  );
  for (const { topic_id } of topicIds.rows) {
    await pool.query(`DELETE FROM intake_items WHERE topic_id = $1`, [topic_id]);
    await pool.query(`DELETE FROM disputes WHERE topic_id = $1`, [topic_id]);
    await pool.query(
      `DELETE FROM votes WHERE motion_id IN (SELECT motion_id FROM motions WHERE topic_id = $1)`,
      [topic_id],
    );
    await pool.query(`DELETE FROM motions WHERE topic_id = $1`, [topic_id]);
    await pool.query(
      `DELETE FROM request_steps WHERE request_id IN (SELECT request_id FROM requests WHERE topic_id = $1)`,
      [topic_id],
    );
    await pool.query(`DELETE FROM requests WHERE topic_id = $1`, [topic_id]);
    await pool.query(`DELETE FROM claims WHERE topic_id = $1`, [topic_id]);
    await pool.query(
      `DELETE FROM artifact_versions WHERE artifact_id IN (SELECT artifact_id FROM artifacts WHERE topic_id = $1)`,
      [topic_id],
    );
    await pool.query(`DELETE FROM artifacts WHERE topic_id = $1`, [topic_id]);
    await pool.query(`DELETE FROM tasks WHERE topic_id = $1`, [topic_id]);
    await pool.query(`DELETE FROM coordination_events WHERE topic_id = $1`, [topic_id]);
  }
  await pool.query(`DELETE FROM topics WHERE project_id = $1`, [TEST_PROJECT_DRAIN]);
  await pool.query(`DELETE FROM actors WHERE project_id = $1`, [TEST_PROJECT_DRAIN]);
  await pool.query(`DELETE FROM doa_matrix WHERE project_id = $1`, [TEST_PROJECT_DRAIN]);
}

async function mkActiveDrainTopic() {
  const t = await charterTopic({
    project_id: TEST_PROJECT_DRAIN,
    name: 'Drain Topic',
    charter: 'drain test',
    created_by: 'drain-authority',
  });
  await joinTopic({
    topic_id: t.topic_id, actor_id: 'drain-authority', actor_type: 'human',
    display_name: 'Authority', level: 'authority',
  });
  await joinTopic({
    topic_id: t.topic_id, actor_id: 'drain-execution', actor_type: 'human',
    display_name: 'Execution', level: 'execution',
  });
  return t.topic_id;
}

test('AC1+AC7: closeTopic emits topic.closing before topic.closed (empty drain)', async () => {
  await cleanupDrain();
  const topicId = await mkActiveDrainTopic();

  const result = await closeTopic({ topic_id: topicId, actor_id: 'drain-authority' });
  assert.equal(result.status, 'closed');
  assert.equal(result.already_closed, false);

  const ev = await replayEvents({ topic_id: topicId });
  const types = ev.events.map((e) => e.type);
  assert.ok(types.includes('topic.closing'), 'topic.closing event emitted');
  assert.equal(types[types.length - 1], 'topic.closed', 'topic.closed is the final event');
  const closingIdx = types.indexOf('topic.closing');
  const closedIdx = types.lastIndexOf('topic.closed');
  assert.ok(closingIdx < closedIdx, 'topic.closing precedes topic.closed');
});

test('AC8: closeTopic with no in-flight items → all force_lapsed counts are zero', async () => {
  await cleanupDrain();
  const topicId = await mkActiveDrainTopic();

  const result = await closeTopic({ topic_id: topicId, actor_id: 'drain-authority' });
  assert.deepEqual(
    result.force_lapsed,
    { claims: 0, requests: 0, motions: 0, disputes: 0, intake_items: 0 },
  );
});

test('AC2+AC8: closeTopic drains open claim → claim.force_lapsed event, task abandoned', async () => {
  await cleanupDrain();
  const topicId = await mkActiveDrainTopic();

  const { postTask, claimTask } = await import('./board.js');
  const task = await postTask({
    topic_id: topicId, title: 'Drain Claim Task', topology: 'parallel',
    slot: 'doc-drain-claim', kind: 'document', created_by: 'drain-execution',
  });
  await claimTask({ task_id: task.task_id, actor_id: 'drain-execution' });

  const result = await closeTopic({ topic_id: topicId, actor_id: 'drain-authority' });
  assert.equal(result.force_lapsed.claims, 1, 'one claim drained');
  assert.equal(result.force_lapsed.requests, 0);

  const ev = await replayEvents({ topic_id: topicId });
  const forceLapsed = ev.events.find((e) => e.type === 'claim.force_lapsed');
  assert.ok(forceLapsed, 'claim.force_lapsed event emitted');

  const pool = getDbPool();
  const claimQ = await pool.query(`SELECT 1 FROM claims WHERE task_id = $1`, [task.task_id]);
  assert.equal(claimQ.rowCount, 0, 'claim row deleted');

  const taskQ = await pool.query<{ status: string }>(
    `SELECT status FROM tasks WHERE task_id = $1`, [task.task_id]);
  assert.equal(taskQ.rows[0].status, 'abandoned', 'task marked abandoned');
});

test('AC3+AC8: closeTopic drains open request → request.force_closed event, force_lapsed.requests=1', async () => {
  await cleanupDrain();
  const topicId = await mkActiveDrainTopic();

  const pool = getDbPool();
  await pool.query(
    `INSERT INTO doa_matrix
       (project_id, topic_id, kind, weight_min, weight_max, required_level, route_shape)
     VALUES ($1, NULL, 'artifact_review', 0, 999, 'authority', 'escalate_to_authority')`,
    [TEST_PROJECT_DRAIN],
  );

  const { postTask, claimTask, completeTask } = await import('./board.js');
  const { submitRequest } = await import('./requests.js');

  const task = await postTask({
    topic_id: topicId, title: 'Drain Art Task', topology: 'parallel',
    slot: 'art-drain', kind: 'document', created_by: 'drain-execution',
  });
  await claimTask({ task_id: task.task_id, actor_id: 'drain-execution' });
  await completeTask({ task_id: task.task_id, actor_id: 'drain-execution' });

  const sub = await submitRequest({
    topic_id: topicId, subject_type: 'artifact', subject_id: task.artifact_id,
    kind: 'artifact_review', weight: 10, procedure: 'unilateral', submitted_by: 'drain-execution',
  });
  assert.equal(sub.status, 'submitted');

  const result = await closeTopic({ topic_id: topicId, actor_id: 'drain-authority' });
  assert.equal(result.force_lapsed.requests, 1, 'one request drained');
  assert.equal(result.force_lapsed.claims, 0, 'completeTask removed the claim before close');

  const ev = await replayEvents({ topic_id: topicId });
  const forceClose = ev.events.find((e) => e.type === 'request.force_closed');
  assert.ok(forceClose, 'request.force_closed event emitted');

  const reqQ = await pool.query<{ status: string }>(
    `SELECT status FROM requests WHERE topic_id = $1`, [topicId]);
  assert.ok(reqQ.rows.every((r) => r.status === 'rejected'), 'request force-closed (status=rejected)');
});

test('AC10: closeTopic on already-closed topic → already_closed:true, no new events', async () => {
  await cleanupDrain();
  const topicId = await mkActiveDrainTopic();

  await closeTopic({ topic_id: topicId, actor_id: 'drain-authority' });
  const ev1 = await replayEvents({ topic_id: topicId });
  const count1 = ev1.events.length;

  const result2 = await closeTopic({ topic_id: topicId, actor_id: 'drain-authority' });
  assert.equal(result2.already_closed, true);
  assert.deepEqual(
    result2.force_lapsed,
    { claims: 0, requests: 0, motions: 0, disputes: 0, intake_items: 0 },
  );

  const ev2 = await replayEvents({ topic_id: topicId });
  assert.equal(ev2.events.length, count1, 'second close adds no events');
});
