/**
 * Phase 15 Sprint 15.3 — requests service unit tests.
 *
 * Design ref: docs/specs/2026-05-17-phase-15-sprint-15.3-design.md §3, §8 (T1–T12).
 *
 * Covers (T3 = part A, T4 = part B — same test file):
 *   T1  submit counter_sign → multi-step route from seeded matrix
 *   T2  submit escalate_to_authority → single-step route from seeded matrix
 *   T3  topic-override row beats project/default
 *   T4  no_route for unmatched (kind, weight)
 *   T5  collective rejected (D6)
 *   T6  non-artifact subject_type rejected (D7)
 *   T7  topic_closed on a closed topic
 *   T8  endorse advances current_step (→ step_endorsed)
 *   T9  endorsing the last step → approved + artifact → final
 *   T10 return → returned + artifact → working
 *   T11 reject → rejected, artifact untouched
 *   T12 weight above 2147483647 → clean BAD_REQUEST/400 (B4)
 *   + non-matching-level actor → not_authorized
 *   + deciding a non-current step → not_current_step
 *   + self_decision_forbidden (D5/B1)
 *   + decide on closed topic → topic_closed
 */

import assert from 'node:assert/strict';
import test, { before, after, beforeEach } from 'node:test';
import { submitRequest, getRequest, listRequests, decideStep } from './requests.js';
import { charterTopic, joinTopic, closeTopic } from './topics.js';
import { postTask, claimTask, completeTask } from './board.js';
import { getDbPool } from '../db/client.js';

const TEST_PROJECT = '__test_requests__';

async function cleanup() {
  const pool = getDbPool();
  const topicIds = await pool.query<{ topic_id: string }>(
    `SELECT topic_id FROM topics WHERE project_id = $1`,
    [TEST_PROJECT],
  );
  for (const { topic_id } of topicIds.rows) {
    await pool.query(`DELETE FROM request_steps WHERE request_id IN
      (SELECT request_id FROM requests WHERE topic_id=$1)`, [topic_id]);
    await pool.query(`DELETE FROM requests WHERE topic_id = $1`, [topic_id]);
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
  await pool.query(`DELETE FROM doa_matrix WHERE project_id = $1`, [TEST_PROJECT]);
}

before(cleanup);
after(cleanup);
beforeEach(cleanup);

/**
 * Create an active topic with 3 participants at 3 levels.
 * Returns: { topicId, executionActor, coordinationActor, authorityActor }
 */
async function mkTopicWithParticipants() {
  const t = await charterTopic({
    project_id: TEST_PROJECT,
    name: 'Request Test Topic',
    charter: 'approve artifacts',
    created_by: 'authority-actor',
  });
  const topicId = t.topic_id;
  await joinTopic({ topic_id: topicId, actor_id: 'execution-actor', actor_type: 'human', display_name: 'Exec', level: 'execution' });
  await joinTopic({ topic_id: topicId, actor_id: 'coordination-actor', actor_type: 'human', display_name: 'Coord', level: 'coordination' });
  await joinTopic({ topic_id: topicId, actor_id: 'authority-actor', actor_type: 'human', display_name: 'Auth', level: 'authority' });
  return { topicId, executionActor: 'execution-actor', coordinationActor: 'coordination-actor', authorityActor: 'authority-actor' };
}

/** Create a task + artifact in for_review state. Returns artifact_id. */
async function mkForReviewArtifact(topicId: string, slot: string, actorId: string) {
  const task = await postTask({
    topic_id: topicId, title: `Task ${slot}`, topology: 'parallel',
    slot, kind: 'document', created_by: actorId,
  });
  const claim = await claimTask({ task_id: task.task_id, actor_id: actorId });
  assert.equal(claim.status, 'claimed');
  const complete = await completeTask({ task_id: task.task_id, actor_id: actorId });
  assert.equal(complete.status, 'completed');
  return task.artifact_id;
}

// ── T1: counter_sign multi-step route ──────────────────────────────────────

test('T1: submit counter_sign weight<50 → multi-step route [coordination, authority] for execution submitter', async () => {
  const { topicId, executionActor } = await mkTopicWithParticipants();
  const artifactId = await mkForReviewArtifact(topicId, 'doc-t1', executionActor);

  // weight=10 → seeded __default__ row: coordination/counter_sign, required=coordination
  // execution submitter → deriveRoute('execution','coordination','counter_sign')
  // → levels strictly above execution (rank 0) AND ≤ coordination (rank 1) → ['coordination']
  // That is only 1 step (coordination). For a genuine multi-step route, we need execution
  // submitter with required=authority (counter_sign), which gives [coordination, authority].
  // The __default__ rows cover: 0-49→coordination, 50+→authority. So weight≥50 gives authority.
  // BUT weight≥50 has route_shape=escalate_to_authority → only [authority]. To get a
  // 2-step counter_sign we need a project row with required=authority/counter_sign.
  // Add such a row for this test.
  const pool = getDbPool();
  await pool.query(
    `INSERT INTO doa_matrix (project_id, topic_id, kind, weight_min, weight_max, required_level, route_shape)
     VALUES ($1, NULL, 'artifact_review', 0, 49, 'authority', 'counter_sign')`,
    [TEST_PROJECT],
  );

  const result = await submitRequest({
    topic_id: topicId,
    subject_type: 'artifact',
    subject_id: artifactId,
    kind: 'artifact_review',
    weight: 10,
    procedure: 'unilateral',
    submitted_by: executionActor,
  });

  assert.equal(result.status, 'submitted');
  if (result.status !== 'submitted') throw new Error('setup failed');
  // With project row (tier 1): authority/counter_sign beats __default__ (tier 2)
  // deriveRoute('execution','authority','counter_sign') → [coordination, authority]
  assert.deepEqual(result.route, ['coordination', 'authority']);
  assert.equal(result.current_step, 0);
  assert.ok(result.request_id, 'request_id generated');

  // Verify DB state
  const steps = await pool.query(
    `SELECT step_index, target_office, status, doa_snapshot FROM request_steps
     WHERE request_id=$1 ORDER BY step_index`,
    [result.request_id],
  );
  assert.equal(steps.rows.length, 2);
  assert.equal(steps.rows[0].target_office, 'coordination');
  assert.equal(steps.rows[0].status, 'pending');
  assert.equal(steps.rows[1].target_office, 'authority');
  assert.equal(steps.rows[1].status, 'pending');
  // doa_snapshot ends with :t1 (project row tier)
  assert.ok(steps.rows[0].doa_snapshot.endsWith(':t1'), `snapshot: ${steps.rows[0].doa_snapshot}`);
});

// ── T2: escalate_to_authority single-step ──────────────────────────────────

test('T2: submit escalate_to_authority weight>=50 → single-step [authority] route', async () => {
  const { topicId, executionActor } = await mkTopicWithParticipants();
  const artifactId = await mkForReviewArtifact(topicId, 'doc-t2', executionActor);

  // weight=100 → seeded __default__ row: authority/escalate_to_authority
  const result = await submitRequest({
    topic_id: topicId,
    subject_type: 'artifact',
    subject_id: artifactId,
    kind: 'artifact_review',
    weight: 100,
    procedure: 'unilateral',
    submitted_by: executionActor,
  });

  assert.equal(result.status, 'submitted');
  if (result.status !== 'submitted') throw new Error('setup failed');
  assert.deepEqual(result.route, ['authority']);
  assert.equal(result.current_step, 0);

  const pool = getDbPool();
  const steps = await pool.query(
    `SELECT step_index, target_office FROM request_steps WHERE request_id=$1 ORDER BY step_index`,
    [result.request_id],
  );
  assert.equal(steps.rows.length, 1);
  assert.equal(steps.rows[0].target_office, 'authority');
});

// ── T3: topic-override row ─────────────────────────────────────────────────

test('T3: topic-override row beats project and __default__', async () => {
  const { topicId, executionActor } = await mkTopicWithParticipants();
  const artifactId = await mkForReviewArtifact(topicId, 'doc-t3', executionActor);

  // Insert a topic-override row that changes the shape for weight=10
  const pool = getDbPool();
  await pool.query(
    `INSERT INTO doa_matrix (project_id, topic_id, kind, weight_min, weight_max, required_level, route_shape)
     VALUES ($1, $2, 'artifact_review', 0, 49, 'authority', 'escalate_to_authority')`,
    [TEST_PROJECT, topicId],
  );

  const result = await submitRequest({
    topic_id: topicId,
    subject_type: 'artifact',
    subject_id: artifactId,
    kind: 'artifact_review',
    weight: 10,
    procedure: 'unilateral',
    submitted_by: executionActor,
  });

  assert.equal(result.status, 'submitted');
  if (result.status !== 'submitted') throw new Error('setup failed');
  // Should use topic override: authority/escalate_to_authority → [authority]
  assert.deepEqual(result.route, ['authority']);
});

// ── T4: no_route ──────────────────────────────────────────────────────────

test('T4: no_route for unmatched (kind, weight)', async () => {
  const { topicId, executionActor } = await mkTopicWithParticipants();
  const artifactId = await mkForReviewArtifact(topicId, 'doc-t4', executionActor);

  const result = await submitRequest({
    topic_id: topicId,
    subject_type: 'artifact',
    subject_id: artifactId,
    kind: 'completely_unknown_kind',
    weight: 10,
    procedure: 'unilateral',
    submitted_by: executionActor,
  });

  assert.equal(result.status, 'no_route');
});

// ── T5: collective rejected ────────────────────────────────────────────────

test('T5: collective procedure → BAD_REQUEST', async () => {
  const { topicId, executionActor } = await mkTopicWithParticipants();
  const artifactId = await mkForReviewArtifact(topicId, 'doc-t5', executionActor);

  await assert.rejects(
    () => submitRequest({
      topic_id: topicId,
      subject_type: 'artifact',
      subject_id: artifactId,
      kind: 'artifact_review',
      weight: 10,
      procedure: 'collective',
      submitted_by: executionActor,
    }),
    (err: any) => {
      assert.equal(err.code, 'BAD_REQUEST');
      assert.ok(err.message.includes('collective'));
      return true;
    },
  );
});

// ── T6: non-artifact subject_type ─────────────────────────────────────────

test('T6: non-artifact subject_type → BAD_REQUEST', async () => {
  const { topicId, executionActor } = await mkTopicWithParticipants();

  await assert.rejects(
    () => submitRequest({
      topic_id: topicId,
      subject_type: 'task',
      subject_id: 'some-task-id',
      kind: 'artifact_review',
      weight: 10,
      procedure: 'unilateral',
      submitted_by: executionActor,
    }),
    (err: any) => {
      assert.equal(err.code, 'BAD_REQUEST');
      assert.ok(err.message.toLowerCase().includes('artifact'));
      return true;
    },
  );
});

// ── T7: topic_closed ──────────────────────────────────────────────────────

test('T7: topic_closed on a closed topic', async () => {
  const { topicId, executionActor, authorityActor } = await mkTopicWithParticipants();
  const artifactId = await mkForReviewArtifact(topicId, 'doc-t7', executionActor);

  await closeTopic({ topic_id: topicId, actor_id: authorityActor });

  const result = await submitRequest({
    topic_id: topicId,
    subject_type: 'artifact',
    subject_id: artifactId,
    kind: 'artifact_review',
    weight: 10,
    procedure: 'unilateral',
    submitted_by: executionActor,
  });
  assert.equal(result.status, 'topic_closed');
});

// ── T12: weight > 2147483647 → BAD_REQUEST (B4) ────────────────────────────

test('T12: weight above 2147483647 → clean BAD_REQUEST (B4)', async () => {
  const { topicId, executionActor } = await mkTopicWithParticipants();
  const artifactId = await mkForReviewArtifact(topicId, 'doc-t12', executionActor);

  await assert.rejects(
    () => submitRequest({
      topic_id: topicId,
      subject_type: 'artifact',
      subject_id: artifactId,
      kind: 'artifact_review',
      weight: 3_000_000_000,
      procedure: 'unilateral',
      submitted_by: executionActor,
    }),
    (err: any) => {
      assert.equal(err.code, 'BAD_REQUEST');
      assert.ok(err.message.toLowerCase().includes('weight'), `message: ${err.message}`);
      return true;
    },
  );
});

// ── getRequest / listRequests ──────────────────────────────────────────────

test('getRequest returns request + steps', async () => {
  const { topicId, executionActor } = await mkTopicWithParticipants();
  const artifactId = await mkForReviewArtifact(topicId, 'doc-get', executionActor);

  const sub = await submitRequest({
    topic_id: topicId,
    subject_type: 'artifact',
    subject_id: artifactId,
    kind: 'artifact_review',
    weight: 10,
    procedure: 'unilateral',
    submitted_by: executionActor,
  });
  assert.equal(sub.status, 'submitted');
  if (sub.status !== 'submitted') throw new Error('setup failed');

  const req = await getRequest({ request_id: sub.request_id });
  assert.ok(req, 'request found');
  assert.equal(req!.request_id, sub.request_id);
  assert.equal(req!.status, 'open');
  assert.equal(req!.current_step, 0);
  assert.ok(Array.isArray(req!.steps) && req!.steps.length > 0);
});

test('listRequests filters by topic_id and optional status', async () => {
  const { topicId, executionActor } = await mkTopicWithParticipants();
  const art1 = await mkForReviewArtifact(topicId, 'doc-list1', executionActor);
  const art2 = await mkForReviewArtifact(topicId, 'doc-list2', executionActor);

  await submitRequest({
    topic_id: topicId, subject_type: 'artifact', subject_id: art1,
    kind: 'artifact_review', weight: 10, procedure: 'unilateral', submitted_by: executionActor,
  });
  await submitRequest({
    topic_id: topicId, subject_type: 'artifact', subject_id: art2,
    kind: 'artifact_review', weight: 10, procedure: 'unilateral', submitted_by: executionActor,
  });

  const all = await listRequests({ topic_id: topicId });
  assert.equal(all.requests.length, 2);

  const open = await listRequests({ topic_id: topicId, status: 'open' });
  assert.equal(open.requests.length, 2);

  const approved = await listRequests({ topic_id: topicId, status: 'approved' });
  assert.equal(approved.requests.length, 0);
});

// ── T8: endorse advances current_step ─────────────────────────────────────

test('T8: endorse step 0 → step_endorsed, current_step advances to 1', async () => {
  const { topicId, executionActor, coordinationActor } = await mkTopicWithParticipants();
  const artifactId = await mkForReviewArtifact(topicId, 'doc-t8', executionActor);

  // Insert a project-level row to get a 2-step counter_sign route for execution submitter
  const pool = getDbPool();
  await pool.query(
    `INSERT INTO doa_matrix (project_id, topic_id, kind, weight_min, weight_max, required_level, route_shape)
     VALUES ($1, NULL, 'artifact_review', 0, 49, 'authority', 'counter_sign')`,
    [TEST_PROJECT],
  );

  // weight=10, project row: authority/counter_sign, execution submitter → [coordination, authority]
  const sub = await submitRequest({
    topic_id: topicId, subject_type: 'artifact', subject_id: artifactId,
    kind: 'artifact_review', weight: 10, procedure: 'unilateral', submitted_by: executionActor,
  });
  assert.equal(sub.status, 'submitted');
  if (sub.status !== 'submitted') throw new Error('setup failed');

  const decide = await decideStep({
    request_id: sub.request_id,
    step_index: 0,
    actor_id: coordinationActor,
    decision: 'endorse',
  });
  assert.equal(decide.status, 'step_endorsed');
  if (decide.status !== 'step_endorsed') throw new Error('endorse failed');
  assert.equal(decide.current_step, 1);

  const req = await getRequest({ request_id: sub.request_id });
  assert.equal(req!.current_step, 1);
  assert.equal(req!.status, 'open');
});

// ── T9: endorse last step → approved ─────────────────────────────────────

test('T9: endorse last step → approved + artifact → final', async () => {
  const { topicId, executionActor, coordinationActor, authorityActor } = await mkTopicWithParticipants();
  const artifactId = await mkForReviewArtifact(topicId, 'doc-t9', executionActor);

  // Insert project row: authority/counter_sign for 2-step route
  const pool = getDbPool();
  await pool.query(
    `INSERT INTO doa_matrix (project_id, topic_id, kind, weight_min, weight_max, required_level, route_shape)
     VALUES ($1, NULL, 'artifact_review', 0, 49, 'authority', 'counter_sign')`,
    [TEST_PROJECT],
  );

  // weight=10 → project row: authority/counter_sign → [coordination, authority]
  const sub = await submitRequest({
    topic_id: topicId, subject_type: 'artifact', subject_id: artifactId,
    kind: 'artifact_review', weight: 10, procedure: 'unilateral', submitted_by: executionActor,
  });
  assert.equal(sub.status, 'submitted');
  if (sub.status !== 'submitted') throw new Error('setup failed');

  // Endorse step 0 (coordination)
  const d1 = await decideStep({
    request_id: sub.request_id, step_index: 0,
    actor_id: coordinationActor, decision: 'endorse',
  });
  assert.equal(d1.status, 'step_endorsed');

  // Endorse step 1 (authority) — last step → approved
  const d2 = await decideStep({
    request_id: sub.request_id, step_index: 1,
    actor_id: authorityActor, decision: 'endorse',
  });
  assert.equal(d2.status, 'approved');

  // Verify artifact state
  const artQ = getDbPool();
  const art = await artQ.query<{ state: string }>(
    `SELECT state FROM artifacts WHERE artifact_id=$1`,
    [artifactId],
  );
  assert.equal(art.rows[0].state, 'final');

  // Verify request state
  const req = await getRequest({ request_id: sub.request_id });
  assert.equal(req!.status, 'approved');
});

// ── T10: return → returned + artifact → working ───────────────────────────

test('T10: return → returned + artifact → working', async () => {
  const { topicId, executionActor, coordinationActor } = await mkTopicWithParticipants();
  const artifactId = await mkForReviewArtifact(topicId, 'doc-t10', executionActor);

  const sub = await submitRequest({
    topic_id: topicId, subject_type: 'artifact', subject_id: artifactId,
    kind: 'artifact_review', weight: 10, procedure: 'unilateral', submitted_by: executionActor,
  });
  assert.equal(sub.status, 'submitted');
  if (sub.status !== 'submitted') throw new Error('setup failed');

  const decide = await decideStep({
    request_id: sub.request_id, step_index: 0,
    actor_id: coordinationActor, decision: 'return',
  });
  assert.equal(decide.status, 'returned');

  const artPool = getDbPool();
  const art = await artPool.query<{ state: string }>(
    `SELECT state FROM artifacts WHERE artifact_id=$1`,
    [artifactId],
  );
  assert.equal(art.rows[0].state, 'working');

  const req = await getRequest({ request_id: sub.request_id });
  assert.equal(req!.status, 'returned');
});

// ── T11: reject → rejected, artifact untouched ───────────────────────────

test('T11: reject → rejected, artifact stays for_review (untouched)', async () => {
  const { topicId, executionActor, coordinationActor } = await mkTopicWithParticipants();
  const artifactId = await mkForReviewArtifact(topicId, 'doc-t11', executionActor);

  const sub = await submitRequest({
    topic_id: topicId, subject_type: 'artifact', subject_id: artifactId,
    kind: 'artifact_review', weight: 10, procedure: 'unilateral', submitted_by: executionActor,
  });
  assert.equal(sub.status, 'submitted');
  if (sub.status !== 'submitted') throw new Error('setup failed');

  const decide = await decideStep({
    request_id: sub.request_id, step_index: 0,
    actor_id: coordinationActor, decision: 'reject',
  });
  assert.equal(decide.status, 'rejected');

  const artPool2 = getDbPool();
  const art = await artPool2.query<{ state: string }>(
    `SELECT state FROM artifacts WHERE artifact_id=$1`,
    [artifactId],
  );
  assert.equal(art.rows[0].state, 'for_review', 'artifact untouched after reject');

  const req = await getRequest({ request_id: sub.request_id });
  assert.equal(req!.status, 'rejected');
});

// ── MED-1: resolveArtifact 0-row path (artifact NOT in for_review) ─────────
//
// §3.3 invariant 5: when the guarded UPDATE finds 0 rows (the artifact is not
// in for_review), resolveArtifact returns { artifact_advanced: false }. The
// request still resolves (approved or returned), request.resolved is emitted
// with artifact_advanced:false, and NO artifact_versions row is written.

test('MED-1: endorse-final with artifact NOT in for_review → approved, artifact_advanced:false, no artifact_versions written', async () => {
  const { topicId, executionActor, coordinationActor, authorityActor } = await mkTopicWithParticipants();
  const artifactId = await mkForReviewArtifact(topicId, 'doc-med1', executionActor);

  // Use a single-step escalate_to_authority route so authority can endorse in one step.
  // weight=100 → seeded __default__ authority/escalate_to_authority → ['authority']
  const sub = await submitRequest({
    topic_id: topicId,
    subject_type: 'artifact',
    subject_id: artifactId,
    kind: 'artifact_review',
    weight: 100,
    procedure: 'unilateral',
    submitted_by: executionActor,
  });
  assert.equal(sub.status, 'submitted');
  if (sub.status !== 'submitted') throw new Error('setup failed');

  // Snapshot artifact_versions count before the decision
  const pool = getDbPool();
  const versBefore = await pool.query<{ n: number }>(
    `SELECT COUNT(*)::int AS n FROM artifact_versions WHERE artifact_id=$1`,
    [artifactId],
  );

  // Force the artifact OUT of for_review (simulates a concurrent revert or out-of-order
  // state change). The guarded UPDATE in resolveArtifact requires state='for_review' — with
  // state='working' the UPDATE will match 0 rows (the 0-row best-effort path).
  await pool.query(`UPDATE artifacts SET state='working' WHERE artifact_id=$1`, [artifactId]);

  // Endorse the only step (authority) → should resolve as 'approved'
  const decide = await decideStep({
    request_id: sub.request_id,
    step_index: 0,
    actor_id: authorityActor,
    decision: 'endorse',
  });
  assert.equal(decide.status, 'approved', 'request resolved as approved despite 0-row artifact update');

  // request row must be 'approved'
  const req = await getRequest({ request_id: sub.request_id });
  assert.equal(req!.status, 'approved');

  // artifact_versions count must NOT have increased (no artifact_versions INSERT on 0-row path)
  const versAfter = await pool.query<{ n: number }>(
    `SELECT COUNT(*)::int AS n FROM artifact_versions WHERE artifact_id=$1`,
    [artifactId],
  );
  assert.equal(
    versAfter.rows[0].n, versBefore.rows[0].n,
    'no artifact_versions row written when artifact is not in for_review',
  );

  // artifact must remain in 'working' state (not advanced to 'final')
  const art = await pool.query<{ state: string }>(
    `SELECT state FROM artifacts WHERE artifact_id=$1`,
    [artifactId],
  );
  assert.equal(art.rows[0].state, 'working', 'artifact state unchanged (not advanced)');

  // request.resolved event must carry artifact_advanced:false
  const { replayEvents } = await import('./coordinationEvents.js');
  const ev = await replayEvents({ topic_id: topicId });
  const resolved = ev.events.find((e) => e.type === 'request.resolved');
  assert.ok(resolved, 'request.resolved event emitted');
  assert.equal(resolved!.payload.artifact_advanced, false, 'artifact_advanced:false on 0-row path');
  assert.equal(resolved!.payload.outcome, 'approved');
});

// ── not_authorized ────────────────────────────────────────────────────────

test('non-matching-level actor → not_authorized', async () => {
  const { topicId, coordinationActor, authorityActor } = await mkTopicWithParticipants();
  const artifactId = await mkForReviewArtifact(topicId, 'doc-na', coordinationActor);

  // coordinationActor submits; weight=10 → seeded __default__: coordination/counter_sign
  // deriveRoute('coordination','coordination','counter_sign') → empty → ['coordination']
  // So step 0 targets coordination.
  const sub = await submitRequest({
    topic_id: topicId, subject_type: 'artifact', subject_id: artifactId,
    kind: 'artifact_review', weight: 10, procedure: 'unilateral', submitted_by: coordinationActor,
  });
  assert.equal(sub.status, 'submitted');
  if (sub.status !== 'submitted') throw new Error('setup failed');

  // authorityActor is a participant but at 'authority' level, not 'coordination'
  // so they are not_authorized (not self_decision_forbidden since they're not the submitter)
  const decide = await decideStep({
    request_id: sub.request_id, step_index: 0,
    actor_id: authorityActor, decision: 'endorse',
  });
  assert.equal(decide.status, 'not_authorized');
});

// ── not_current_step ──────────────────────────────────────────────────────

test('deciding a non-current step → not_current_step', async () => {
  const { topicId, executionActor, coordinationActor } = await mkTopicWithParticipants();
  const artifactId = await mkForReviewArtifact(topicId, 'doc-ncs', executionActor);

  const sub = await submitRequest({
    topic_id: topicId, subject_type: 'artifact', subject_id: artifactId,
    kind: 'artifact_review', weight: 10, procedure: 'unilateral', submitted_by: executionActor,
  });
  assert.equal(sub.status, 'submitted');
  if (sub.status !== 'submitted') throw new Error('setup failed');

  // Try to decide step 1 while current_step=0
  const decide = await decideStep({
    request_id: sub.request_id, step_index: 1,
    actor_id: coordinationActor, decision: 'endorse',
  });
  assert.equal(decide.status, 'not_current_step');
});

// ── self_decision_forbidden (D5/B1) ──────────────────────────────────────

test('submitter cannot endorse their own request → self_decision_forbidden', async () => {
  // Create a topic where coordination-actor will be the submitter
  // but also the only coordination officeholder at step 0
  const { topicId, coordinationActor, executionActor } = await mkTopicWithParticipants();
  const artifactId = await mkForReviewArtifact(topicId, 'doc-sdf', executionActor);

  // coordination actor submits → route=[authority] (they're above execution)
  // Actually: coordination submitter, weight=10 → coordination/counter_sign
  // → deriveRoute('coordination','coordination','counter_sign') → fallback [coordination]
  // So step 0 targets coordination — but submitter is coordination-actor → self_decision_forbidden

  // But we need a route where the submitter's level matches the step's target_office.
  // Use coordination submitter with weight=10 (→ counter_sign, requiredLevel=coordination)
  // deriveRoute('coordination', 'coordination', 'counter_sign') → empty ladder → [coordination]
  const sub = await submitRequest({
    topic_id: topicId,
    subject_type: 'artifact',
    subject_id: artifactId,
    kind: 'artifact_review',
    weight: 10,
    procedure: 'unilateral',
    submitted_by: coordinationActor,
  });
  assert.equal(sub.status, 'submitted');
  if (sub.status !== 'submitted') throw new Error('setup failed');

  // The submitter (coordinationActor) tries to endorse step 0
  const decide = await decideStep({
    request_id: sub.request_id,
    step_index: 0,
    actor_id: coordinationActor,
    decision: 'endorse',
  });
  assert.equal(decide.status, 'self_decision_forbidden');
});

// ── decide on closed topic → topic_closed ────────────────────────────────

test('decide on a closed topic → topic_closed', async () => {
  const { topicId, executionActor, coordinationActor, authorityActor } = await mkTopicWithParticipants();
  const artifactId = await mkForReviewArtifact(topicId, 'doc-dtc', executionActor);

  const sub = await submitRequest({
    topic_id: topicId, subject_type: 'artifact', subject_id: artifactId,
    kind: 'artifact_review', weight: 10, procedure: 'unilateral', submitted_by: executionActor,
  });
  assert.equal(sub.status, 'submitted');
  if (sub.status !== 'submitted') throw new Error('setup failed');

  // bypass drain so the open request survives; tests the closed-topic guard
  await getDbPool().query(`UPDATE topics SET status='closed' WHERE topic_id=$1`, [topicId]);

  // decideStep should return topic_closed
  const decide = await decideStep({
    request_id: sub.request_id, step_index: 0,
    actor_id: coordinationActor, decision: 'endorse',
  });
  assert.equal(decide.status, 'topic_closed');
});

// ── Sprint 15.6 consistency fixes (AC13–AC18) ─────────────────────────────

test('AC13: repeat_endorser — same actor cannot decide two steps in a counter_sign request', async () => {
  const { topicId, executionActor, authorityActor } = await mkTopicWithParticipants();
  const pool = getDbPool();

  // Insert a synthetic counter_sign request where both steps target 'authority'.
  // This tests the distinct-endorser invariant: the same actor must not sign more
  // than one step in a counter_sign route (DEFERRED-013).
  const { rows: [{ id: requestId }] } = await pool.query<{ id: string }>(
    `SELECT gen_random_uuid()::text AS id`,
  );
  await pool.query(
    `INSERT INTO requests
       (request_id, topic_id, subject_type, subject_id, kind, weight,
        procedure, route_shape, status, current_step, submitted_by)
     VALUES ($1, $2, 'artifact', 'phantom-artifact', 'artifact_review', 10,
       'unilateral', 'counter_sign', 'open', 0, $3)`,
    [requestId, topicId, executionActor],
  );
  await pool.query(`
    INSERT INTO request_steps
      (request_id, step_index, target_office, doa_snapshot, procedure, deadline, status)
    VALUES
      ($1, 0, 'authority', 'test:t0', 'unilateral', now() + interval '60 minutes', 'pending'),
      ($1, 1, 'authority', 'test:t0', 'unilateral', now() + interval '60 minutes', 'pending')`,
    [requestId],
  );

  // authorityActor endorses step 0 → step_endorsed
  const d1 = await decideStep({
    request_id: requestId, step_index: 0,
    actor_id: authorityActor, decision: 'endorse',
  });
  assert.equal(d1.status, 'step_endorsed');

  // Same actor tries step 1 → repeat_endorser
  const d2 = await decideStep({
    request_id: requestId, step_index: 1,
    actor_id: authorityActor, decision: 'endorse',
  });
  assert.equal(d2.status, 'repeat_endorser');
});

test('AC14: listRequests for an unknown topic_id → NOT_FOUND error', async () => {
  await assert.rejects(
    () => listRequests({ topic_id: 'no-such-topic-id-xyz' }),
    (err: any) => {
      assert.equal(err.code, 'NOT_FOUND');
      assert.ok(err.message.includes('not found'), `message: ${err.message}`);
      return true;
    },
  );
});

test('AC15: reject → request.resolved event carries artifact_advanced:false', async () => {
  const { topicId, executionActor, coordinationActor } = await mkTopicWithParticipants();
  const artifactId = await mkForReviewArtifact(topicId, 'doc-ac15', executionActor);

  const sub = await submitRequest({
    topic_id: topicId, subject_type: 'artifact', subject_id: artifactId,
    kind: 'artifact_review', weight: 10, procedure: 'unilateral', submitted_by: executionActor,
  });
  assert.equal(sub.status, 'submitted');
  if (sub.status !== 'submitted') throw new Error('setup failed');

  await decideStep({
    request_id: sub.request_id, step_index: 0,
    actor_id: coordinationActor, decision: 'reject',
  });

  const { replayEvents } = await import('./coordinationEvents.js');
  const ev = await replayEvents({ topic_id: topicId });
  const resolved = ev.events.find((e) => e.type === 'request.resolved');
  assert.ok(resolved, 'request.resolved event present');
  assert.equal(resolved!.payload.outcome, 'rejected');
  assert.equal(resolved!.payload.artifact_advanced, false, 'artifact_advanced:false on reject path');
});

test('AC17 (service F5): non-integer step_index → BAD_REQUEST', async () => {
  await assert.rejects(
    () => decideStep({ request_id: 'any', step_index: 1.5, actor_id: 'any', decision: 'endorse' }),
    (err: any) => {
      assert.equal(err.code, 'BAD_REQUEST');
      assert.ok(err.message.toLowerCase().includes('step_index'), `message: ${err.message}`);
      return true;
    },
  );
});

test('AC18: submitRequest with submitted_by exceeding 256 chars → BAD_REQUEST', async () => {
  const { topicId } = await mkTopicWithParticipants();

  await assert.rejects(
    () => submitRequest({
      topic_id: topicId,
      subject_type: 'artifact',
      subject_id: 'some-artifact',
      kind: 'artifact_review',
      weight: 10,
      procedure: 'unilateral',
      submitted_by: 'x'.repeat(257),
    }),
    (err: any) => {
      assert.equal(err.code, 'BAD_REQUEST');
      assert.ok(err.message.toLowerCase().includes('submitted_by'), `message: ${err.message}`);
      return true;
    },
  );
});

// ════════════════════════════════════════════════════════════════════════════
// Sprint 15.3.1 — security fix-up tests (F3a, F5, F7)
// ════════════════════════════════════════════════════════════════════════════

// ── F7: length cap on kind / subject_id ──────────────────────────────────────

test('F7: submitRequest rejects an over-long kind (>256 chars)', async () => {
  const { topicId, executionActor } = await mkTopicWithParticipants();
  const artifactId = await mkForReviewArtifact(topicId, 'doc-f7k', executionActor);
  await assert.rejects(
    () => submitRequest({
      topic_id: topicId, subject_type: 'artifact', subject_id: artifactId,
      kind: 'x'.repeat(257), weight: 10, procedure: 'unilateral', submitted_by: executionActor,
    }),
    (err: any) => { assert.equal(err.code, 'BAD_REQUEST'); return true; },
  );
});

test('F7: submitRequest rejects an over-long subject_id (>256 chars)', async () => {
  const { topicId, executionActor } = await mkTopicWithParticipants();
  await assert.rejects(
    () => submitRequest({
      topic_id: topicId, subject_type: 'artifact', subject_id: 'y'.repeat(257),
      kind: 'artifact_review', weight: 10, procedure: 'unilateral', submitted_by: executionActor,
    }),
    (err: any) => { assert.equal(err.code, 'BAD_REQUEST'); return true; },
  );
});

// ── F5: step_index validation in decideStep ──────────────────────────────────

test('F5: decideStep rejects a negative step_index', async () => {
  const { topicId, executionActor } = await mkTopicWithParticipants();
  const artifactId = await mkForReviewArtifact(topicId, 'doc-f5n', executionActor);
  const sub = await submitRequest({
    topic_id: topicId, subject_type: 'artifact', subject_id: artifactId,
    kind: 'artifact_review', weight: 10, procedure: 'unilateral', submitted_by: executionActor,
  });
  assert.equal(sub.status, 'submitted');
  if (sub.status !== 'submitted') throw new Error('setup failed');
  await assert.rejects(
    () => decideStep({ request_id: sub.request_id, step_index: -1, actor_id: 'coordination-actor', decision: 'endorse' }),
    (err: any) => { assert.equal(err.code, 'BAD_REQUEST'); return true; },
  );
});

test('F5: decideStep rejects a fractional step_index', async () => {
  const { topicId, executionActor } = await mkTopicWithParticipants();
  const artifactId = await mkForReviewArtifact(topicId, 'doc-f5f', executionActor);
  const sub = await submitRequest({
    topic_id: topicId, subject_type: 'artifact', subject_id: artifactId,
    kind: 'artifact_review', weight: 10, procedure: 'unilateral', submitted_by: executionActor,
  });
  assert.equal(sub.status, 'submitted');
  if (sub.status !== 'submitted') throw new Error('setup failed');
  await assert.rejects(
    () => decideStep({ request_id: sub.request_id, step_index: 1.5, actor_id: 'coordination-actor', decision: 'endorse' }),
    (err: any) => { assert.equal(err.code, 'BAD_REQUEST'); return true; },
  );
});

// ── F3a: submitRequest must reject a cross-topic artifact ────────────────────

test('F3a: submitRequest rejects an artifact that belongs to another topic', async () => {
  const a = await mkTopicWithParticipants();
  const b = await mkTopicWithParticipants();
  const foreignArtifact = await mkForReviewArtifact(b.topicId, 'doc-xtopic', b.executionActor);
  await assert.rejects(
    () => submitRequest({
      topic_id: a.topicId, subject_type: 'artifact', subject_id: foreignArtifact,
      kind: 'artifact_review', weight: 10, procedure: 'unilateral', submitted_by: a.executionActor,
    }),
    (err: any) => { assert.equal(err.code, 'NOT_FOUND'); return true; },
  );
});

// ── Sprint 15.6 HIGH fix: submitRequest must block on 'closing' ──────────────

test('AC19: submitRequest on a closing topic → topic_closed', async () => {
  const { topicId, executionActor } = await mkTopicWithParticipants();
  // Simulate the drain window: topic is 'closing' before Phase 3 seal.
  await getDbPool().query(`UPDATE topics SET status='closing' WHERE topic_id=$1`, [topicId]);

  const result = await submitRequest({
    topic_id: topicId, subject_type: 'artifact', subject_id: 'phantom-artifact',
    kind: 'artifact_review', weight: 10, procedure: 'unilateral', submitted_by: executionActor,
  });
  assert.equal(result.status, 'topic_closed');
});

// ── MED-4: counter_sign positive — distinct actor can endorse step 1 ─────────

test('AC16: distinct actor can endorse step 1 of a counter_sign request (different actor is allowed)', async () => {
  const { topicId, executionActor, coordinationActor, authorityActor } = await mkTopicWithParticipants();
  const pool = getDbPool();

  const { rows: [{ id: requestId }] } = await pool.query<{ id: string }>(
    `SELECT gen_random_uuid()::text AS id`,
  );
  await pool.query(
    `INSERT INTO requests
       (request_id, topic_id, subject_type, subject_id, kind, weight,
        procedure, route_shape, status, current_step, submitted_by)
     VALUES ($1, $2, 'artifact', 'phantom-artifact', 'artifact_review', 10,
       'unilateral', 'counter_sign', 'open', 0, $3)`,
    [requestId, topicId, executionActor],
  );
  await pool.query(`
    INSERT INTO request_steps
      (request_id, step_index, target_office, doa_snapshot, procedure, deadline, status)
    VALUES
      ($1, 0, 'coordination', 'test:t0', 'unilateral', now() + interval '60 minutes', 'pending'),
      ($1, 1, 'authority',    'test:t0', 'unilateral', now() + interval '60 minutes', 'pending')`,
    [requestId],
  );

  const d1 = await decideStep({
    request_id: requestId, step_index: 0,
    actor_id: coordinationActor, decision: 'endorse',
  });
  assert.equal(d1.status, 'step_endorsed');

  // Different actor endorses step 1 — must NOT return repeat_endorser
  const d2 = await decideStep({
    request_id: requestId, step_index: 1,
    actor_id: authorityActor, decision: 'endorse',
  });
  assert.equal(d2.status, 'approved', 'distinct actor can endorse a different step in counter_sign');
});

// ── MED-6: valid topic with zero requests → [] (not NOT_FOUND) ───────────────

test('AC20: listRequests for a valid topic with no requests → empty array', async () => {
  const { topicId } = await mkTopicWithParticipants();
  const result = await listRequests({ topic_id: topicId });
  assert.ok(Array.isArray(result.requests), 'result.requests is an array');
  assert.equal(result.requests.length, 0, 'no requests on a fresh topic');
});

// ── F3a: approved request emits artifact events on the artifact's topic (guard) ──

test('F3a: an approved request emits artifact events on the artifact topic', async () => {
  const { topicId, executionActor, authorityActor } = await mkTopicWithParticipants();
  const artifactId = await mkForReviewArtifact(topicId, 'doc-f3a-ev', executionActor);
  // weight=100 → seeded __default__ authority/escalate_to_authority → single-step [authority]
  const sub = await submitRequest({
    topic_id: topicId, subject_type: 'artifact', subject_id: artifactId,
    kind: 'artifact_review', weight: 100, procedure: 'unilateral', submitted_by: executionActor,
  });
  assert.equal(sub.status, 'submitted');
  if (sub.status !== 'submitted') throw new Error('setup failed');

  const decide = await decideStep({
    request_id: sub.request_id, step_index: 0, actor_id: authorityActor, decision: 'endorse',
  });
  assert.equal(decide.status, 'approved');

  // resolveArtifact derives the topic from the artifact (F3a); the artifact events
  // must therefore appear in THIS topic's event log.
  const { replayEvents } = await import('./coordinationEvents.js');
  const ev = await replayEvents({ topic_id: topicId });
  assert.ok(
    ev.events.some((e) => e.type === 'artifact.versioned'),
    'artifact.versioned present in the artifact topic event log',
  );
  assert.ok(
    ev.events.some((e) => e.type === 'artifact.state_changed'),
    'artifact.state_changed present in the artifact topic event log',
  );
});

// ── Sprint 15.7 — primitive-outcome chaining tests (DEFERRED-019) ──────────

test('15.7 AC1: approve last step → chain emits task.posted + request.resolved.chain.kind=posted', async () => {
  const { topicId, executionActor, coordinationActor } = await mkTopicWithParticipants();
  const artifactId = await mkForReviewArtifact(topicId, 'doc-15-7-ac1', executionActor);
  const submit = await submitRequest({
    topic_id: topicId,
    subject_type: 'artifact',
    subject_id: artifactId,
    kind: 'artifact_review',
    weight: 10, // → __default__: coordination/counter_sign → 1 step
    procedure: 'unilateral',
    submitted_by: executionActor,
  });
  assert.equal(submit.status, 'submitted');
  if (submit.status !== 'submitted') throw new Error('setup');

  const decide = await decideStep({
    request_id: submit.request_id!,
    step_index: 0,
    actor_id: coordinationActor,
    decision: 'endorse',
  });
  assert.equal(decide.status, 'approved');
  if (decide.status !== 'approved') throw new Error('approve failed');
  assert.equal(decide.chain.kind, 'posted');
  if (decide.chain.kind !== 'posted') throw new Error('chain kind wrong');
  assert.ok(decide.chain.task_id, 'task_id present');
  assert.ok(decide.chain.artifact_id, 'artifact_id present');

  // Verify task exists with derived default title
  const pool = getDbPool();
  const t = await pool.query(`SELECT title, topology, raci FROM tasks WHERE task_id=$1`, [decide.chain.task_id]);
  assert.equal(t.rows[0].title, 'Execute approved request: artifact_review');
  assert.equal(t.rows[0].topology, 'parallel');
  assert.equal(t.rows[0].raci.source_request, submit.request_id);

  // Verify request.resolved event has chain field
  const { replayEvents } = await import('./coordinationEvents.js');
  const ev = await replayEvents({ topic_id: topicId });
  const resolved = ev.events.find((e) => e.type === 'request.resolved');
  assert.ok(resolved, 'request.resolved emitted');
  assert.equal((resolved!.payload as { chain?: { kind: string } }).chain?.kind, 'posted');
});

test('15.7 AC3: approve with execution_task blob → chained task uses blob params', async () => {
  const { topicId, executionActor, coordinationActor } = await mkTopicWithParticipants();
  const artifactId = await mkForReviewArtifact(topicId, 'doc-15-7-ac3', executionActor);
  const submit = await submitRequest({
    topic_id: topicId,
    subject_type: 'artifact',
    subject_id: artifactId,
    kind: 'artifact_review',
    weight: 10,
    procedure: 'unilateral',
    submitted_by: executionActor,
    execution_task: {
      title: 'Custom chained title',
      slot: 'custom-exec',
      kind: 'custom-kind',
    },
  });
  assert.equal(submit.status, 'submitted');
  if (submit.status !== 'submitted') throw new Error('setup');

  const decide = await decideStep({
    request_id: submit.request_id!,
    step_index: 0,
    actor_id: coordinationActor,
    decision: 'endorse',
  });
  assert.equal(decide.status, 'approved');
  if (decide.status !== 'approved') throw new Error('approve failed');
  if (decide.chain.kind !== 'posted') throw new Error('chain kind wrong');

  const pool = getDbPool();
  const t = await pool.query(`SELECT title, depends_on FROM tasks WHERE task_id=$1`, [decide.chain.task_id]);
  assert.equal(t.rows[0].title, 'Custom chained title');
  const a = await pool.query(`SELECT slot, kind FROM artifacts WHERE artifact_id=$1`, [decide.chain.artifact_id]);
  assert.equal(a.rows[0].slot, 'custom-exec');
  assert.equal(a.rows[0].kind, 'custom-kind');
});

test('15.7 AC6: reject decision → no chain, no new task created', async () => {
  const { topicId, executionActor, coordinationActor } = await mkTopicWithParticipants();
  const artifactId = await mkForReviewArtifact(topicId, 'doc-15-7-ac6r', executionActor);
  const submit = await submitRequest({
    topic_id: topicId,
    subject_type: 'artifact',
    subject_id: artifactId,
    kind: 'artifact_review',
    weight: 10,
    procedure: 'unilateral',
    submitted_by: executionActor,
  });
  assert.equal(submit.status, 'submitted');

  const decide = await decideStep({
    request_id: (submit as { request_id: string }).request_id,
    step_index: 0,
    actor_id: coordinationActor,
    decision: 'reject',
  });
  assert.equal(decide.status, 'rejected');

  // No chained task: only the original mkForReviewArtifact task exists.
  const pool = getDbPool();
  const tasks = await pool.query(`SELECT task_id FROM tasks WHERE topic_id=$1`, [topicId]);
  assert.equal(tasks.rows.length, 1, 'no chained task on reject');
});

test('15.7 AC7: approve on a closing topic → chain emits task.deferred (subject_type=topic), request.resolved.chain.kind=deferred', async () => {
  const { topicId, executionActor, coordinationActor } = await mkTopicWithParticipants();
  const artifactId = await mkForReviewArtifact(topicId, 'doc-15-7-ac7', executionActor);
  const submit = await submitRequest({
    topic_id: topicId,
    subject_type: 'artifact',
    subject_id: artifactId,
    kind: 'artifact_review',
    weight: 10,
    procedure: 'unilateral',
    submitted_by: executionActor,
  });
  assert.equal(submit.status, 'submitted');

  // 15.6 test isolation pattern — direct UPDATE to 'closing' to bypass closeTopic
  // Phase 2 drain (which would force-close our open request before we can approve).
  const pool = getDbPool();
  await pool.query(`UPDATE topics SET status='closing' WHERE topic_id=$1`, [topicId]);

  const decide = await decideStep({
    request_id: (submit as { request_id: string }).request_id,
    step_index: 0,
    actor_id: coordinationActor,
    decision: 'endorse',
  });
  // Note: in 15.6, decideStep blocks on closing ONLY for new writer paths (submitRequest etc.),
  // NOT for decideStep itself. So the approval succeeds, but the chain hits 'closing' and defers.
  assert.equal(decide.status, 'approved', `expected approved, got ${decide.status}`);
  if (decide.status !== 'approved') throw new Error('expected approved');
  assert.equal(decide.chain.kind, 'deferred');
  if (decide.chain.kind !== 'deferred') throw new Error('chain not deferred');
  assert.equal(decide.chain.reason, 'topic_closing');
  assert.ok(decide.chain.deferred_event_id, 'deferred_event_id present');

  // No task created
  const tasks = await pool.query(`SELECT task_id FROM tasks WHERE topic_id=$1`, [topicId]);
  assert.equal(tasks.rows.length, 1, 'no chained task on closing');

  // task.deferred event with subject_type='topic' was emitted
  const { replayEvents } = await import('./coordinationEvents.js');
  const ev = await replayEvents({ topic_id: topicId });
  const deferred = ev.events.find((e) => e.type === 'task.deferred');
  assert.ok(deferred, 'task.deferred event emitted');
  assert.equal(deferred!.subject_type, 'topic');
  assert.equal(deferred!.subject_id, topicId);
  assert.equal((deferred!.payload as { reason: string }).reason, 'topic_closing');
});

test('15.7 AC10: approve with execution_task.depends_on referencing nonexistent task → CHAINED_TASK_DEPENDENCY_INVALID + request stays open', async () => {
  const { topicId, executionActor, coordinationActor } = await mkTopicWithParticipants();
  const artifactId = await mkForReviewArtifact(topicId, 'doc-15-7-ac10', executionActor);
  const fakeTaskId = '11111111-2222-3333-4444-555555555555'; // does not exist

  const submit = await submitRequest({
    topic_id: topicId,
    subject_type: 'artifact',
    subject_id: artifactId,
    kind: 'artifact_review',
    weight: 10,
    procedure: 'unilateral',
    submitted_by: executionActor,
    execution_task: { depends_on: [fakeTaskId] },
  });
  assert.equal(submit.status, 'submitted');

  let caught: unknown = null;
  try {
    await decideStep({
      request_id: (submit as { request_id: string }).request_id,
      step_index: 0,
      actor_id: coordinationActor,
      decision: 'endorse',
    });
  } catch (err) {
    caught = err;
  }
  assert.ok(caught, 'should throw');
  assert.equal((caught as { code: string }).code, 'CHAINED_TASK_DEPENDENCY_INVALID');

  // Request still 'open' (rollback)
  const pool = getDbPool();
  const r = await pool.query(`SELECT status FROM requests WHERE request_id=$1`, [(submit as { request_id: string }).request_id]);
  assert.equal(r.rows[0].status, 'open');

  // No chained task
  const tasks = await pool.query(`SELECT task_id FROM tasks WHERE topic_id=$1`, [topicId]);
  assert.equal(tasks.rows.length, 1, 'no chained task on dep-invalid');
});
