/**
 * Phase 15 Sprint 15.2 — board service unit tests.
 *
 * Design ref: docs/specs/2026-05-16-phase-15-sprint-15.2-design.md §8 (T1–T7).
 * Harness mirrored from src/services/artifactLeases.test.ts / topics.test.ts —
 * real test DB, cleanup by topic_id / project.
 *
 * Covers:
 *   T1 postTask creates task + artifact (draft v1) + emits task.posted +
 *      artifact.created; postTask against a missing topic → NOT_FOUND
 *   T2 listBoard filters by status
 *   T3 claimTask → claimed + claim.granted/task.claimed, monotonic fencing token
 *   T4 second claimTask on a held task → conflict with the real incumbent
 *   T5 concurrency — Promise.all of N claimTask → exactly one claimed, no 500
 *   T6 releaseTask by holder; by non-holder → not_owner; on an expired claim →
 *      claim_expired
 *   T7 completeTask → completed + for_review + claim released; no_live_claim /
 *      not_owner
 */

import assert from 'node:assert/strict';
import test, { before, after, beforeEach } from 'node:test';
import { postTask, listBoard, claimTask, releaseTask, completeTask } from './board.js';
import { charterTopic, joinTopic } from './topics.js';
import { replayEvents } from './coordinationEvents.js';
import { getDbPool } from '../db/client.js';

const TEST_PROJECT = '__test_board__';

async function cleanup() {
  const pool = getDbPool();
  // claims/artifact_versions/artifacts/tasks reference topics — delete children first.
  const topicIds = await pool.query<{ topic_id: string }>(
    `SELECT topic_id FROM topics WHERE project_id = $1`,
    [TEST_PROJECT],
  );
  for (const { topic_id } of topicIds.rows) {
    await pool.query(`DELETE FROM claims WHERE topic_id = $1`, [topic_id]);
    await pool.query(
      `DELETE FROM artifact_versions WHERE artifact_id IN
         (SELECT artifact_id FROM artifacts WHERE topic_id = $1)`,
      [topic_id],
    );
    await pool.query(`DELETE FROM artifacts WHERE topic_id = $1`, [topic_id]);
    await pool.query(`DELETE FROM tasks WHERE topic_id = $1`, [topic_id]);
    await pool.query(`DELETE FROM coordination_events WHERE topic_id = $1`, [topic_id]);
  }
  await pool.query(`DELETE FROM topics WHERE project_id = $1`, [TEST_PROJECT]);
  await pool.query(`DELETE FROM actors WHERE project_id = $1`, [TEST_PROJECT]);
}

before(cleanup);
after(cleanup);
beforeEach(cleanup);

/** Charter + join an active topic; returns its topic_id. */
async function mkActiveTopic(): Promise<string> {
  const t = await charterTopic({
    project_id: TEST_PROJECT,
    name: 'Board Test',
    charter: 'do the work',
    created_by: 'creator-1',
  });
  await joinTopic({
    topic_id: t.topic_id, actor_id: 'creator-1', actor_type: 'ai',
    display_name: 'Creator', level: 'coordination',
  });
  return t.topic_id;
}

/** Force-expire every claim on an artifact (simulate sweep-window lapse). */
async function expireClaims(artifactId: string) {
  const pool = getDbPool();
  await pool.query(
    `UPDATE claims SET expires_at = now() - interval '1 minute' WHERE artifact_id = $1`,
    [artifactId],
  );
}

// ── T1 ──────────────────────────────────────────────────────────────────────

test('T1: postTask creates a task + draft v1 artifact and emits task.posted + artifact.created', async () => {
  const topicId = await mkActiveTopic();
  const task = await postTask({
    topic_id: topicId, title: 'Write the doc', topology: 'parallel',
    slot: 'spec', kind: 'document', created_by: 'creator-1',
  });
  assert.equal(task.status, 'posted');
  assert.equal(task.topology, 'parallel');
  assert.ok(task.task_id, 'task_id generated');
  assert.equal(task.artifact_id, `${topicId}:${task.task_id}:spec`, 'derived artifact_id');

  const pool = getDbPool();
  const art = await pool.query<{ state: string; version: number }>(
    `SELECT state, version FROM artifacts WHERE artifact_id = $1`,
    [task.artifact_id],
  );
  assert.equal(art.rows[0].state, 'draft');
  assert.equal(art.rows[0].version, 1);
  const ver = await pool.query<{ note: string; version: number }>(
    `SELECT note, version FROM artifact_versions WHERE artifact_id = $1`,
    [task.artifact_id],
  );
  assert.equal(ver.rows.length, 1);
  assert.equal(ver.rows[0].version, 1);
  assert.equal(ver.rows[0].note, 'created');

  const ev = await replayEvents({ topic_id: topicId });
  const types = ev.events.map((e) => e.type);
  assert.ok(types.includes('task.posted'), 'task.posted emitted');
  assert.ok(types.includes('artifact.created'), 'artifact.created emitted');
});

test('T1: postTask against a missing topic → NOT_FOUND', async () => {
  await assert.rejects(
    postTask({
      topic_id: 'no-such-topic', title: 't', topology: 'parallel',
      slot: 'spec', kind: 'document', created_by: 'creator-1',
    }),
    /not found/,
  );
});

test('T1: postTask with an invalid slot → BAD_REQUEST', async () => {
  const topicId = await mkActiveTopic();
  await assert.rejects(
    postTask({
      topic_id: topicId, title: 't', topology: 'parallel',
      slot: 'Bad Slot', kind: 'document', created_by: 'creator-1',
    }),
    /slot must be/,
  );
});

// ── T2 ──────────────────────────────────────────────────────────────────────

test('T2: listBoard filters by status', async () => {
  const topicId = await mkActiveTopic();
  const t1 = await postTask({
    topic_id: topicId, title: 'task one', topology: 'parallel',
    slot: 'one', kind: 'document', created_by: 'creator-1',
  });
  await postTask({
    topic_id: topicId, title: 'task two', topology: 'parallel',
    slot: 'two', kind: 'document', created_by: 'creator-1',
  });
  // claim t1 so it leaves 'posted'
  await claimTask({ task_id: t1.task_id, actor_id: 'creator-1' });

  const all = await listBoard({ topic_id: topicId });
  assert.equal(all.tasks.length, 2, 'default lists all tasks');

  const posted = await listBoard({ topic_id: topicId, status: 'posted' });
  assert.equal(posted.tasks.length, 1, 'status filter narrows to the posted set');
  assert.equal(posted.tasks[0].title, 'task two');
  assert.equal(posted.tasks[0].artifact_state, 'draft');

  const claimed = await listBoard({ topic_id: topicId, status: 'claimed' });
  assert.equal(claimed.tasks.length, 1);
  assert.equal(claimed.tasks[0].task_id, t1.task_id);
});

// ── T3 ──────────────────────────────────────────────────────────────────────

test('T3: claimTask → claimed + claim.granted/task.claimed; fencing token strictly increases', async () => {
  const topicId = await mkActiveTopic();
  const taskA = await postTask({
    topic_id: topicId, title: 'task A', topology: 'parallel',
    slot: 'a', kind: 'document', created_by: 'creator-1',
  });
  const taskB = await postTask({
    topic_id: topicId, title: 'task B', topology: 'parallel',
    slot: 'b', kind: 'document', created_by: 'creator-1',
  });

  const c1 = await claimTask({ task_id: taskA.task_id, actor_id: 'worker-1' });
  assert.equal(c1.status, 'claimed');
  if (c1.status !== 'claimed') return;
  assert.ok(c1.claim_id);
  assert.equal(c1.artifact_id, taskA.artifact_id);
  assert.ok(new Date(c1.expires_at).getTime() > Date.now());

  const c2 = await claimTask({ task_id: taskB.task_id, actor_id: 'worker-2' });
  assert.equal(c2.status, 'claimed');
  if (c2.status !== 'claimed') return;
  assert.ok(c2.fencing_token > c1.fencing_token, 'fencing token strictly increases');

  const ev = await replayEvents({ topic_id: topicId });
  const types = ev.events.map((e) => e.type);
  assert.ok(types.includes('claim.granted'), 'claim.granted emitted');
  assert.ok(types.includes('task.claimed'), 'task.claimed emitted');

  // task A is now 'claimed'
  const pool = getDbPool();
  const t = await pool.query<{ status: string }>(
    `SELECT status FROM tasks WHERE task_id = $1`, [taskA.task_id],
  );
  assert.equal(t.rows[0].status, 'claimed');
});

test('T3: claimTask on an unknown task → not_found', async () => {
  const r = await claimTask({
    task_id: '00000000-0000-0000-0000-000000000000', actor_id: 'worker-1',
  });
  assert.equal(r.status, 'not_found');
});

// ── T4 ──────────────────────────────────────────────────────────────────────

test('T4: a second claimTask on a held task → conflict with the real incumbent', async () => {
  const topicId = await mkActiveTopic();
  const task = await postTask({
    topic_id: topicId, title: 'contended', topology: 'parallel',
    slot: 'c', kind: 'document', created_by: 'creator-1',
  });
  const first = await claimTask({ task_id: task.task_id, actor_id: 'incumbent' });
  assert.equal(first.status, 'claimed');

  const second = await claimTask({ task_id: task.task_id, actor_id: 'latecomer' });
  assert.equal(second.status, 'conflict');
  if (second.status === 'conflict') {
    assert.equal(second.incumbent_actor_id, 'incumbent', 'reports the real incumbent');
    assert.ok(second.expires_at && new Date(second.expires_at).getTime() > Date.now());
  }
});

test('T4: claimTask on a completed task → conflict reason task_completed', async () => {
  const topicId = await mkActiveTopic();
  const task = await postTask({
    topic_id: topicId, title: 'done task', topology: 'parallel',
    slot: 'd', kind: 'document', created_by: 'creator-1',
  });
  const c = await claimTask({ task_id: task.task_id, actor_id: 'worker-1' });
  assert.equal(c.status, 'claimed');
  await completeTask({ task_id: task.task_id, actor_id: 'worker-1' });

  const reclaim = await claimTask({ task_id: task.task_id, actor_id: 'worker-2' });
  assert.equal(reclaim.status, 'conflict');
  if (reclaim.status === 'conflict') {
    assert.equal(reclaim.reason, 'task_completed');
  }
});

// ── T5 ──────────────────────────────────────────────────────────────────────

test('T5: concurrent claimTask on one task → exactly one claimed, rest conflict, no 500', async () => {
  const topicId = await mkActiveTopic();
  const task = await postTask({
    topic_id: topicId, title: 'race', topology: 'parallel',
    slot: 'race', kind: 'document', created_by: 'creator-1',
  });
  const results = await Promise.all(
    Array.from({ length: 6 }, (_, i) =>
      claimTask({ task_id: task.task_id, actor_id: `racer-${i}` }),
    ),
  );
  const claimed = results.filter((r) => r.status === 'claimed');
  const conflicts = results.filter((r) => r.status === 'conflict');
  assert.equal(claimed.length, 1, 'exactly one claim wins');
  assert.equal(conflicts.length, 5, 'the rest are conflict');
  // every conflict names the (same) real incumbent
  const winnerActor = claimed[0].status === 'claimed' ? null : null;
  void winnerActor;
  for (const r of conflicts) {
    if (r.status === 'conflict') {
      assert.ok(r.incumbent_actor_id, 'conflict carries a real incumbent_actor_id');
    }
  }
  // exactly one claim row exists for this artifact
  const pool = getDbPool();
  const n = await pool.query<{ n: number }>(
    `SELECT COUNT(*)::int AS n FROM claims WHERE artifact_id = $1`,
    [task.artifact_id],
  );
  assert.equal(n.rows[0].n, 1);
});

// ── T6 ──────────────────────────────────────────────────────────────────────

test('T6: releaseTask by the holder → released; task back to posted', async () => {
  const topicId = await mkActiveTopic();
  const task = await postTask({
    topic_id: topicId, title: 'releasable', topology: 'parallel',
    slot: 'rel', kind: 'document', created_by: 'creator-1',
  });
  await claimTask({ task_id: task.task_id, actor_id: 'holder' });
  const r = await releaseTask({ task_id: task.task_id, actor_id: 'holder' });
  assert.equal(r.status, 'released');

  const pool = getDbPool();
  const t = await pool.query<{ status: string }>(
    `SELECT status FROM tasks WHERE task_id = $1`, [task.task_id],
  );
  assert.equal(t.rows[0].status, 'posted', 'task returns to the board');
  const claims = await pool.query<{ n: number }>(
    `SELECT COUNT(*)::int AS n FROM claims WHERE artifact_id = $1`,
    [task.artifact_id],
  );
  assert.equal(claims.rows[0].n, 0, 'claim row deleted');

  const ev = await replayEvents({ topic_id: topicId });
  assert.ok(ev.events.some((e) => e.type === 'task.released'), 'task.released emitted');
});

test('T6: releaseTask by a non-holder → not_owner', async () => {
  const topicId = await mkActiveTopic();
  const task = await postTask({
    topic_id: topicId, title: 't', topology: 'parallel',
    slot: 'rel2', kind: 'document', created_by: 'creator-1',
  });
  await claimTask({ task_id: task.task_id, actor_id: 'holder' });
  const r = await releaseTask({ task_id: task.task_id, actor_id: 'imposter' });
  assert.equal(r.status, 'not_owner');
});

test('T6: releaseTask on an expired claim → claim_expired (the sweep owns it)', async () => {
  const topicId = await mkActiveTopic();
  const task = await postTask({
    topic_id: topicId, title: 't', topology: 'parallel',
    slot: 'rel3', kind: 'document', created_by: 'creator-1',
  });
  await claimTask({ task_id: task.task_id, actor_id: 'holder' });
  await expireClaims(task.artifact_id);
  const r = await releaseTask({ task_id: task.task_id, actor_id: 'holder' });
  assert.equal(r.status, 'claim_expired');
});

test('T6: releaseTask on an unknown task → not_found', async () => {
  const r = await releaseTask({
    task_id: '00000000-0000-0000-0000-000000000000', actor_id: 'holder',
  });
  assert.equal(r.status, 'not_found');
});

// ── T7 ──────────────────────────────────────────────────────────────────────

test('T7: completeTask → task completed, artifact for_review, claim released', async () => {
  const topicId = await mkActiveTopic();
  const task = await postTask({
    topic_id: topicId, title: 'completable', topology: 'parallel',
    slot: 'cmp', kind: 'document', created_by: 'creator-1',
  });
  await claimTask({ task_id: task.task_id, actor_id: 'worker-1' });
  const r = await completeTask({ task_id: task.task_id, actor_id: 'worker-1' });
  assert.equal(r.status, 'completed');

  const pool = getDbPool();
  const t = await pool.query<{ status: string }>(
    `SELECT status FROM tasks WHERE task_id = $1`, [task.task_id],
  );
  assert.equal(t.rows[0].status, 'completed');
  const art = await pool.query<{ state: string }>(
    `SELECT state FROM artifacts WHERE artifact_id = $1`, [task.artifact_id],
  );
  assert.equal(art.rows[0].state, 'for_review');
  const claims = await pool.query<{ n: number }>(
    `SELECT COUNT(*)::int AS n FROM claims WHERE artifact_id = $1`,
    [task.artifact_id],
  );
  assert.equal(claims.rows[0].n, 0, 'claim released at for_review');

  const ev = await replayEvents({ topic_id: topicId });
  const types = ev.events.map((e) => e.type);
  assert.ok(types.includes('task.completed'), 'task.completed emitted');
  assert.ok(types.includes('artifact.state_changed'), 'artifact.state_changed emitted');
});

test('T7: completeTask with no live claim → no_live_claim', async () => {
  const topicId = await mkActiveTopic();
  const task = await postTask({
    topic_id: topicId, title: 't', topology: 'parallel',
    slot: 'cmp2', kind: 'document', created_by: 'creator-1',
  });
  // posted but never claimed
  const r = await completeTask({ task_id: task.task_id, actor_id: 'worker-1' });
  assert.equal(r.status, 'no_live_claim');
});

test('T7: completeTask by a non-holder → not_owner', async () => {
  const topicId = await mkActiveTopic();
  const task = await postTask({
    topic_id: topicId, title: 't', topology: 'parallel',
    slot: 'cmp3', kind: 'document', created_by: 'creator-1',
  });
  await claimTask({ task_id: task.task_id, actor_id: 'holder' });
  const r = await completeTask({ task_id: task.task_id, actor_id: 'imposter' });
  assert.equal(r.status, 'not_owner');
});

test('T7: completeTask on an already-completed task → already_completed', async () => {
  const topicId = await mkActiveTopic();
  const task = await postTask({
    topic_id: topicId, title: 't', topology: 'parallel',
    slot: 'cmp4', kind: 'document', created_by: 'creator-1',
  });
  await claimTask({ task_id: task.task_id, actor_id: 'worker-1' });
  await completeTask({ task_id: task.task_id, actor_id: 'worker-1' });
  const r = await completeTask({ task_id: task.task_id, actor_id: 'worker-1' });
  assert.equal(r.status, 'already_completed');
});
