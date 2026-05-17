/**
 * Phase 15 Sprint 15.2 — coordinationSweep service unit tests.
 *
 * Design ref: docs/specs/2026-05-16-phase-15-sprint-15.2-design.md §8 (T13–T17).
 * Harness mirrored from src/services/artifactLeases.test.ts. Setup uses
 * postTask / claimTask / writeArtifact / baselineArtifact — runs after T2/T4.
 *
 * Covers:
 *   T13 an expired claim → task posted, claim.expired emitted, claim gone
 *   T14 sweep reverts a never-baselined artifact to draft
 *   T15 sweep reverts a baselined-then-edited artifact to its last baselined
 *       version — never un-baselines; accepted_fencing_token unchanged
 *   T16 an expired claim on a closed topic → claim dropped, artifact NOT
 *       reverted, no event
 *   T17 a batch with one un-recoverable claim + one good claim → the good one
 *       is still recovered (the bad one's failure does not abort the cycle)
 */

import assert from 'node:assert/strict';
import test, { before, after, beforeEach } from 'node:test';
import { sweepAbandonedClaims, sweepStalledSteps, sweepExpiredMotions } from './coordinationSweep.js';
import { postTask, claimTask } from './board.js';
import { writeArtifact, baselineArtifact } from './artifacts.js';
import { charterTopic, joinTopic, closeTopic } from './topics.js';
import { replayEvents } from './coordinationEvents.js';
import { submitRequest } from './requests.js';
import { createBody, addBodyMember } from './decisionBodies.js';
import { proposeMotion, secondMotion, castVote } from './motions.js';
import { getDbPool } from '../db/client.js';

const TEST_PROJECT = '__test_coordination_sweep__';

async function cleanup() {
  const pool = getDbPool();
  const topicIds = await pool.query<{ topic_id: string }>(
    `SELECT topic_id FROM topics WHERE project_id = $1`,
    [TEST_PROJECT],
  );
  for (const { topic_id } of topicIds.rows) {
    // Clean up votes + motions (added by Sprint 15.4)
    await pool.query(`DELETE FROM votes WHERE motion_id IN
      (SELECT motion_id FROM motions WHERE topic_id=$1)`, [topic_id]);
    await pool.query(`DELETE FROM motions WHERE topic_id = $1`, [topic_id]);
    // Clean up request_steps + requests (added by Sprint 15.3)
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
  // decision bodies (project-scoped config — Sprint 15.4)
  const bodyIds = await pool.query<{ body_id: string }>(
    `SELECT body_id FROM decision_bodies WHERE project_id = $1`,
    [TEST_PROJECT],
  );
  for (const { body_id } of bodyIds.rows) {
    await pool.query(`DELETE FROM body_members WHERE body_id = $1`, [body_id]);
  }
  await pool.query(`DELETE FROM decision_bodies WHERE project_id = $1`, [TEST_PROJECT]);
}

before(cleanup);
after(cleanup);
beforeEach(cleanup);

async function mkActiveTopic(): Promise<string> {
  const t = await charterTopic({
    project_id: TEST_PROJECT, name: 'Sweep Test',
    charter: 'recover abandoned claims', created_by: 'creator-1',
  });
  await joinTopic({
    topic_id: t.topic_id, actor_id: 'creator-1', actor_type: 'ai',
    display_name: 'Creator', level: 'coordination',
  });
  return t.topic_id;
}

async function postAndClaim(topicId: string, slot: string, actorId = 'worker-1') {
  const task = await postTask({
    topic_id: topicId, title: `task ${slot}`, topology: 'parallel',
    slot, kind: 'document', created_by: 'creator-1',
  });
  const claim = await claimTask({ task_id: task.task_id, actor_id: actorId });
  assert.equal(claim.status, 'claimed');
  if (claim.status !== 'claimed') throw new Error('setup: claim failed');
  return {
    task_id: task.task_id,
    artifact_id: task.artifact_id,
    claim_id: claim.claim_id,
    fencing_token: claim.fencing_token,
  };
}

/** Force-expire every claim on an artifact (simulate an abandoned claim). */
async function expireClaims(artifactId: string) {
  const pool = getDbPool();
  await pool.query(
    `UPDATE claims SET expires_at = now() - interval '10 minutes' WHERE artifact_id = $1`,
    [artifactId],
  );
}

// ── T13 ─────────────────────────────────────────────────────────────────────

test('T13: an expired claim → task posted, claim.expired emitted, claim gone', async () => {
  const topicId = await mkActiveTopic();
  const s = await postAndClaim(topicId, 'doc');
  // task is 'claimed'
  await expireClaims(s.artifact_id);

  const result = await sweepAbandonedClaims();
  assert.equal(result.recovered, 1);

  const pool = getDbPool();
  const t = await pool.query<{ status: string }>(
    `SELECT status FROM tasks WHERE task_id = $1`, [s.task_id],
  );
  assert.equal(t.rows[0].status, 'posted', 'task returns to the board');
  const claims = await pool.query<{ n: number }>(
    `SELECT COUNT(*)::int AS n FROM claims WHERE claim_id = $1`, [s.claim_id],
  );
  assert.equal(claims.rows[0].n, 0, 'expired claim row deleted');

  const ev = await replayEvents({ topic_id: topicId });
  const types = ev.events.map((e) => e.type);
  assert.ok(types.includes('claim.expired'), 'claim.expired emitted');
  assert.ok(types.includes('task.released'), 'task.released emitted');
});

test('T13: a sweep with no expired claims is a no-op', async () => {
  const topicId = await mkActiveTopic();
  await postAndClaim(topicId, 'fresh'); // a live claim — not expired
  const result = await sweepAbandonedClaims();
  assert.equal(result.recovered, 0);
});

// ── T14 ─────────────────────────────────────────────────────────────────────

test('T14: sweep reverts a never-baselined artifact to draft', async () => {
  const topicId = await mkActiveTopic();
  const s = await postAndClaim(topicId, 'nb');
  // write once → artifact is 'working' v2, never baselined
  const w = await writeArtifact({
    artifact_id: s.artifact_id, claim_id: s.claim_id, fencing_token: s.fencing_token,
    content_ref: 'ref://working-content', actor_id: 'worker-1',
  });
  assert.equal(w.status, 'ok');
  await expireClaims(s.artifact_id);

  const result = await sweepAbandonedClaims();
  assert.equal(result.recovered, 1);

  const pool = getDbPool();
  const art = await pool.query<{ state: string; content_ref: string | null }>(
    `SELECT state, content_ref FROM artifacts WHERE artifact_id = $1`, [s.artifact_id],
  );
  assert.equal(art.rows[0].state, 'draft', 'no baseline → reverted to draft');
  assert.equal(art.rows[0].content_ref, null, 'draft revert clears content_ref');
  const ver = await pool.query<{ note: string }>(
    `SELECT note FROM artifact_versions WHERE artifact_id = $1 ORDER BY version DESC LIMIT 1`,
    [s.artifact_id],
  );
  assert.equal(ver.rows[0].note, 'reverted to draft');
});

// ── T15 ─────────────────────────────────────────────────────────────────────

test('T15: sweep reverts a baselined-then-edited artifact to its last baselined version; accepted_fencing_token unchanged', async () => {
  const topicId = await mkActiveTopic();
  const s = await postAndClaim(topicId, 'be');
  // write → working v2
  await writeArtifact({
    artifact_id: s.artifact_id, claim_id: s.claim_id, fencing_token: s.fencing_token,
    content_ref: 'ref://pre-baseline', actor_id: 'worker-1',
  });
  // baseline → baselined v3 (content_ref carried forward = ref://pre-baseline)
  const b = await baselineArtifact({
    artifact_id: s.artifact_id, claim_id: s.claim_id, fencing_token: s.fencing_token,
    actor_id: 'worker-1',
  });
  assert.equal(b.status, 'ok');
  // edit again → working v4 with new content
  await writeArtifact({
    artifact_id: s.artifact_id, claim_id: s.claim_id, fencing_token: s.fencing_token,
    content_ref: 'ref://post-baseline-edit', actor_id: 'worker-1',
  });

  const pool = getDbPool();
  const before = await pool.query<{ accepted_fencing_token: string }>(
    `SELECT accepted_fencing_token FROM artifacts WHERE artifact_id = $1`, [s.artifact_id],
  );
  const tokenBefore = Number(before.rows[0].accepted_fencing_token);

  await expireClaims(s.artifact_id);
  const result = await sweepAbandonedClaims();
  assert.equal(result.recovered, 1);

  const art = await pool.query<{ state: string; content_ref: string | null; accepted_fencing_token: string }>(
    `SELECT state, content_ref, accepted_fencing_token FROM artifacts WHERE artifact_id = $1`,
    [s.artifact_id],
  );
  assert.equal(art.rows[0].state, 'baselined', 'reverted to baselined, never un-baselined');
  assert.equal(art.rows[0].content_ref, 'ref://pre-baseline', 'content reverted to the last baseline');
  assert.equal(
    Number(art.rows[0].accepted_fencing_token), tokenBefore,
    'accepted_fencing_token unchanged by the revert (monotonic)',
  );
  const ver = await pool.query<{ note: string }>(
    `SELECT note FROM artifact_versions WHERE artifact_id = $1 ORDER BY version DESC LIMIT 1`,
    [s.artifact_id],
  );
  assert.match(ver.rows[0].note, /^reverted to v\d+$/, 'revert note names the baselined version');
});

// ── T16 ─────────────────────────────────────────────────────────────────────

test('T16: an expired claim on a closed topic → claim dropped, artifact NOT reverted, no event', async () => {
  const topicId = await mkActiveTopic();
  const s = await postAndClaim(topicId, 'ct');
  // write → working v2
  await writeArtifact({
    artifact_id: s.artifact_id, claim_id: s.claim_id, fencing_token: s.fencing_token,
    content_ref: 'ref://working', actor_id: 'worker-1',
  });
  await expireClaims(s.artifact_id);
  await closeTopic({ topic_id: topicId, actor_id: 'creator-1' });

  const pool = getDbPool();
  const evBefore = await replayEvents({ topic_id: topicId });
  const evCountBefore = evBefore.events.length;
  const artBefore = await pool.query<{ state: string; version: number }>(
    `SELECT state, version FROM artifacts WHERE artifact_id = $1`, [s.artifact_id],
  );
  // [item 2-B] the task is 'claimed' before the sweep (writeArtifact does not
  // change task status — claimTask set it).
  const taskBefore = await pool.query<{ status: string }>(
    `SELECT status FROM tasks WHERE task_id = $1`, [s.task_id],
  );
  assert.equal(taskBefore.rows[0].status, 'claimed', 'task is claimed pre-sweep');
  // [COSMETIC item 23] artifact_versions row count before the sweep — the most
  // direct proof the closed-topic branch appends NO new version.
  const verBefore = await pool.query<{ n: number }>(
    `SELECT COUNT(*)::int AS n FROM artifact_versions WHERE artifact_id = $1`,
    [s.artifact_id],
  );

  const result = await sweepAbandonedClaims();
  assert.equal(result.recovered, 1, 'closed-topic claim is counted as recovered (the claim is dropped)');

  const claims = await pool.query<{ n: number }>(
    `SELECT COUNT(*)::int AS n FROM claims WHERE claim_id = $1`, [s.claim_id],
  );
  assert.equal(claims.rows[0].n, 0, 'dangling claim dropped');

  const artAfter = await pool.query<{ state: string; version: number }>(
    `SELECT state, version FROM artifacts WHERE artifact_id = $1`, [s.artifact_id],
  );
  assert.equal(artAfter.rows[0].state, artBefore.rows[0].state, 'artifact state unchanged');
  assert.equal(artAfter.rows[0].version, artBefore.rows[0].version, 'artifact NOT reverted');

  // [COSMETIC item 23] no artifact_versions row appended — the directest "no revert" proof.
  const verAfter = await pool.query<{ n: number }>(
    `SELECT COUNT(*)::int AS n FROM artifact_versions WHERE artifact_id = $1`,
    [s.artifact_id],
  );
  assert.equal(
    verAfter.rows[0].n, verBefore.rows[0].n,
    'artifact_versions count unchanged — the closed-topic sweep appended nothing',
  );

  // [item 2-B] the task is marked 'abandoned' — it cannot return to the board.
  const taskAfter = await pool.query<{ status: string }>(
    `SELECT status FROM tasks WHERE task_id = $1`, [s.task_id],
  );
  assert.equal(
    taskAfter.rows[0].status, 'abandoned',
    'closed-topic sweep marks the task abandoned',
  );

  const evAfter = await replayEvents({ topic_id: topicId });
  assert.equal(evAfter.events.length, evCountBefore, 'no event emitted on a closed topic');
});

// ── T17 ─────────────────────────────────────────────────────────────────────

test('T17: a batch with one un-recoverable claim + one good claim → the good one is still recovered', async () => {
  const topicId = await mkActiveTopic();
  // good claim
  const good = await postAndClaim(topicId, 'good', 'worker-good');
  // un-recoverable claim — we pre-insert an artifact_versions row at the version
  // revertArtifact will try to write (current version + 1), so its INSERT raises
  // a 23505 PK violation → the §0.1-loop catch logs and continues.
  const bad = await postAndClaim(topicId, 'bad', 'worker-bad');

  const pool = getDbPool();
  const curVer = await pool.query<{ version: number }>(
    `SELECT version FROM artifacts WHERE artifact_id = $1`, [bad.artifact_id],
  );
  const collidingVersion = curVer.rows[0].version + 1;
  await pool.query(
    `INSERT INTO artifact_versions (artifact_id, version, state, content_ref, fencing_token, note, created_by)
     VALUES ($1, $2, 'draft', NULL, NULL, 'planted-collision', 'test')`,
    [bad.artifact_id, collidingVersion],
  );

  await expireClaims(good.artifact_id);
  await expireClaims(bad.artifact_id);

  const result = await sweepAbandonedClaims();
  // the good claim is recovered; the bad one's failure does not abort the cycle.
  assert.equal(result.recovered, 1, 'exactly the good claim is recovered');

  // good task returned to the board
  const goodTask = await pool.query<{ status: string }>(
    `SELECT status FROM tasks WHERE task_id = $1`, [good.task_id],
  );
  assert.equal(goodTask.rows[0].status, 'posted', 'good task recovered despite the bad claim');
  const goodClaims = await pool.query<{ n: number }>(
    `SELECT COUNT(*)::int AS n FROM claims WHERE claim_id = $1`, [good.claim_id],
  );
  assert.equal(goodClaims.rows[0].n, 0, 'good claim row deleted');

  // bad claim — recovery rolled back; the claim row is still present.
  const badClaims = await pool.query<{ n: number }>(
    `SELECT COUNT(*)::int AS n FROM claims WHERE claim_id = $1`, [bad.claim_id],
  );
  assert.equal(badClaims.rows[0].n, 1, 'un-recoverable claim left intact for a retry');
});

// ── sweepStalledSteps (T17–T20) ──────────────────────────────────────────────

/**
 * Helper: create an active topic with 3 participants, submit a request, and
 * force-expire its current step's deadline so the sweep will pick it up.
 */
async function mkTopicWithStalledStep(slot: string, submitterLevel: 'execution' | 'coordination' | 'authority') {
  const pool = getDbPool();

  const t = await charterTopic({
    project_id: TEST_PROJECT, name: `Sweep Step Test ${slot}`,
    charter: 'stalled step sweep test', created_by: `actor-auth-${slot}`,
  });
  const topicId = t.topic_id;
  await joinTopic({ topic_id: topicId, actor_id: `actor-exec-${slot}`, actor_type: 'ai', display_name: 'Exec', level: 'execution' });
  await joinTopic({ topic_id: topicId, actor_id: `actor-coord-${slot}`, actor_type: 'ai', display_name: 'Coord', level: 'coordination' });
  await joinTopic({ topic_id: topicId, actor_id: `actor-auth-${slot}`, actor_type: 'ai', display_name: 'Auth', level: 'authority' });

  // Create a for_review artifact
  const task = await postTask({
    topic_id: topicId, title: `Task ${slot}`, topology: 'parallel',
    slot, kind: 'document', created_by: `actor-exec-${slot}`,
  });
  const claim = await claimTask({ task_id: task.task_id, actor_id: `actor-exec-${slot}` });
  if (claim.status !== 'claimed') throw new Error('setup: claim failed');
  const { completeTask } = await import('./board.js');
  await completeTask({ task_id: task.task_id, actor_id: `actor-exec-${slot}` });
  const artifactId = task.artifact_id;

  // Submit a request. Use the seeded __default__ weight=10 (coordination/counter_sign).
  const subBy = submitterLevel === 'execution' ? `actor-exec-${slot}`
    : submitterLevel === 'coordination' ? `actor-coord-${slot}`
    : `actor-auth-${slot}`;

  const sub = await submitRequest({
    topic_id: topicId,
    subject_type: 'artifact',
    subject_id: artifactId,
    kind: 'artifact_review',
    weight: 10,
    procedure: 'unilateral',
    submitted_by: subBy,
  });
  if (sub.status !== 'submitted') throw new Error(`submitRequest failed: ${sub.status}`);

  // Force-expire the current step's deadline so the sweep picks it up
  await pool.query(
    `UPDATE request_steps SET deadline = now() - interval '10 minutes'
     WHERE request_id=$1 AND step_index=0`,
    [sub.request_id],
  );

  return { topicId, requestId: sub.request_id, route: sub.route, artifactId };
}

// ── T17: stalled step below authority climbs one level ────────────────────

test('T17: stalled step below authority → climbs one level with fresh deadline + emits request.step_escalated', async () => {
  // execution submitter, weight=10 → coordination/counter_sign → ['coordination']
  // step 0 targets coordination
  const { topicId, requestId } = await mkTopicWithStalledStep('t17', 'execution');

  const pool = getDbPool();
  const stepBefore = await pool.query<{ target_office: string; status: string }>(
    `SELECT target_office, status FROM request_steps WHERE request_id=$1 AND step_index=0`,
    [requestId],
  );
  assert.equal(stepBefore.rows[0].target_office, 'coordination');

  const result = await sweepStalledSteps({ grace_minutes: 0 });
  assert.equal(result.escalated, 1);

  const stepAfter = await pool.query<{ target_office: string; status: string }>(
    `SELECT target_office, status FROM request_steps WHERE request_id=$1 AND step_index=0`,
    [requestId],
  );
  // coordination → authority (one level up)
  assert.equal(stepAfter.rows[0].target_office, 'authority', 'step climbed to authority');
  assert.equal(stepAfter.rows[0].status, 'pending', 'status stays pending');

  const ev = await replayEvents({ topic_id: topicId });
  const escalatedEvents = ev.events.filter((e) => e.type === 'request.step_escalated');
  assert.equal(escalatedEvents.length, 1, 'exactly one step_escalated event emitted');
  assert.equal(escalatedEvents[0].payload.step_index, 0);
  assert.equal(escalatedEvents[0].payload.from_office, 'coordination');
  assert.equal(escalatedEvents[0].payload.to_office, 'authority');

  // Request still open
  const req = await pool.query<{ status: string }>(
    `SELECT status FROM requests WHERE request_id=$1`,
    [requestId],
  );
  assert.equal(req.rows[0].status, 'open');
});

// ── T18: stalled authority step → escalation_exhausted ───────────────────

test('T18: stalled authority step → escalation_exhausted', async () => {
  // coordination submitter, weight=10 → __default__: coordination/counter_sign
  // deriveRoute('coordination','coordination','counter_sign') → empty → ['coordination']
  // Step 0 targets coordination. Force it up to authority by a direct DB update.
  const { topicId, requestId } = await mkTopicWithStalledStep('t18', 'coordination');

  const pool = getDbPool();
  // Manually set target_office to authority (as if a previous sweep already climbed it)
  await pool.query(
    `UPDATE request_steps SET target_office='authority', deadline = now() - interval '10 minutes'
     WHERE request_id=$1 AND step_index=0`,
    [requestId],
  );

  const result = await sweepStalledSteps({ grace_minutes: 0 });
  assert.equal(result.escalated, 1);

  const stepAfter = await pool.query<{ status: string; decided_by: string }>(
    `SELECT status, decided_by FROM request_steps WHERE request_id=$1 AND step_index=0`,
    [requestId],
  );
  assert.equal(stepAfter.rows[0].status, 'escalated', 'terminal step status = escalated');
  assert.equal(stepAfter.rows[0].decided_by, 'system:sweep');

  const reqAfter = await pool.query<{ status: string }>(
    `SELECT status FROM requests WHERE request_id=$1`,
    [requestId],
  );
  assert.equal(reqAfter.rows[0].status, 'escalation_exhausted');

  const ev = await replayEvents({ topic_id: topicId });
  const escalatedEvents = ev.events.filter((e) => e.type === 'request.step_escalated');
  assert.equal(escalatedEvents.length, 1);
  assert.equal(escalatedEvents[0].payload.exhausted, true);

  const resolvedEvents = ev.events.filter((e) => e.type === 'request.resolved');
  assert.equal(resolvedEvents.length, 1);
  assert.equal(resolvedEvents[0].payload.outcome, 'escalation_exhausted');
});

// ── T19: stalled step on a closed topic → skipped ────────────────────────

test('T19: stalled step on a closed topic → skipped (no mutation, no events)', async () => {
  const { topicId, requestId } = await mkTopicWithStalledStep('t19', 'execution');
  const pool = getDbPool();

  // Close the topic after submission (simulates a race or deliberate close)
  await closeTopic({ topic_id: topicId, actor_id: `actor-auth-t19` });

  const evBefore = await replayEvents({ topic_id: topicId });
  const evCountBefore = evBefore.events.length;

  const stepBefore = await pool.query<{ target_office: string; deadline: Date }>(
    `SELECT target_office, deadline FROM request_steps WHERE request_id=$1 AND step_index=0`,
    [requestId],
  );
  const officeBefore = stepBefore.rows[0].target_office;

  const result = await sweepStalledSteps({ grace_minutes: 0 });
  assert.equal(result.escalated, 0, 'closed-topic step not counted as escalated');

  // No mutation
  const stepAfter = await pool.query<{ target_office: string; status: string }>(
    `SELECT target_office, status FROM request_steps WHERE request_id=$1 AND step_index=0`,
    [requestId],
  );
  assert.equal(stepAfter.rows[0].target_office, officeBefore, 'target_office unchanged');
  assert.equal(stepAfter.rows[0].status, 'pending', 'status unchanged');

  // No events on the closed topic
  // (replayEvents works even on closed topics — it just reads the sealed log)
  const evAfter = await replayEvents({ topic_id: topicId });
  assert.equal(evAfter.events.length, evCountBefore, 'no new events on closed topic');
});

// ── T20: batch with one bad + one good → good still escalates (genuine crash) ─
//
// The previous T20 set the bad request to status='approved', which caused the
// sweep's pre-step lock-check to skip it via the WHERE-clause filter — the
// per-step try/catch was NEVER entered. This rework plants a real DB-level fault
// (a 23505 PK collision on coordination_events, identical to the T17 technique)
// so the bad step's per-step transaction throws inside the try-block, driving
// the §0.1-loop catch. The good step must still escalate.
//
// Technique (mirrors T17 for sweepAbandonedClaims):
//   1. Both requests are open (status='open'), both have expired deadlines, so
//      the initial scan picks them both up.
//   2. Read the bad topic's current topics.next_seq.
//   3. Pre-insert a coordination_events row at seq = next_seq + 1 (the seq the
//      sweep will attempt to use for the first appendEvent inside the bad step's
//      transaction). This causes a 23505 PK violation on (topic_id, seq).
//   4. Call sweepStalledSteps — the bad step's transaction throws, the §0.1-loop
//      catch rolls back and continues, and the good step escalates normally.

test('T20: batch with one bad and one good stalled step → good one still escalates (genuine crash isolation)', async () => {
  const { topicId: topicGood, requestId: reqGood } = await mkTopicWithStalledStep('t20g', 'execution');
  const { topicId: topicBad, requestId: reqBad } = await mkTopicWithStalledStep('t20b', 'execution');

  const pool = getDbPool();

  // Verify both requests are open and their steps have expired deadlines —
  // the scan's WHERE filter must include them both.
  const reqBadRow = await pool.query<{ status: string }>(
    `SELECT status FROM requests WHERE request_id=$1`, [reqBad],
  );
  assert.equal(reqBadRow.rows[0].status, 'open', 'bad request is open so the scan picks it up');
  const reqGoodRow = await pool.query<{ status: string }>(
    `SELECT status FROM requests WHERE request_id=$1`, [reqGood],
  );
  assert.equal(reqGoodRow.rows[0].status, 'open', 'good request is open so the scan picks it up');

  // Plant a 23505 PK collision on the bad topic's coordination_events.
  // appendEvent does: UPDATE topics SET next_seq=next_seq+1 ... RETURNING next_seq
  // then INSERTs at (topic_id, next_seq). We pre-occupy that slot so the INSERT throws.
  const seqRow = await pool.query<{ next_seq: string }>(
    `SELECT next_seq FROM topics WHERE topic_id=$1`, [topicBad],
  );
  const collidingSeq = Number(seqRow.rows[0].next_seq) + 1;
  await pool.query(
    `INSERT INTO coordination_events (topic_id, seq, actor_id, type, subject_type, subject_id, payload)
     VALUES ($1, $2, 'test', 'request.step_escalated', 'request', $3, '{}')`,
    [topicBad, collidingSeq, reqBad],
  );

  // Both steps are stalled (deadlines already expired by mkTopicWithStalledStep).
  const result = await sweepStalledSteps({ grace_minutes: 0 });

  // The bad step's transaction threw (23505 PK violation) → caught by §0.1-loop
  // catch → logged + rolled back + continued. Only the good step committed.
  assert.equal(result.escalated, 1, 'exactly the good step is counted escalated');

  // Good step must have been escalated (coordination → authority)
  const stepGoodAfter = await pool.query<{ target_office: string }>(
    `SELECT target_office FROM request_steps WHERE request_id=$1 AND step_index=0`,
    [reqGood],
  );
  assert.equal(stepGoodAfter.rows[0].target_office, 'authority', 'good step escalated to authority');

  // Bad step must be unchanged (its transaction rolled back)
  const stepBadAfter = await pool.query<{ target_office: string; status: string }>(
    `SELECT target_office, status FROM request_steps WHERE request_id=$1 AND step_index=0`,
    [reqBad],
  );
  assert.equal(stepBadAfter.rows[0].target_office, 'coordination', 'bad step target_office unchanged (rolled back)');
  assert.equal(stepBadAfter.rows[0].status, 'pending', 'bad step status unchanged (rolled back)');

  // Good topic must have exactly one step_escalated event
  const ev = await replayEvents({ topic_id: topicGood });
  const escalatedEvents = ev.events.filter((e) => e.type === 'request.step_escalated');
  assert.equal(escalatedEvents.length, 1, 'exactly 1 step_escalated event on the good topic');
  assert.equal(escalatedEvents[0].payload.from_office, 'coordination');
  assert.equal(escalatedEvents[0].payload.to_office, 'authority');
});

// ════════════════════════════════════════════════════════════════════════════
// Sprint 15.4 — sweepExpiredMotions (T11)
//
// Covers:
//   T11a a balloting motion past deadline → swept (auto-tally to the outcome)
//   T11b a proposed motion past deadline → lapsed (reason:not_seconded)
//   T11c a motion on a closed topic → skipped (no mutation, no event)
//   T11d a batch with one bad + one good expired motion → the good one resolves
//        (crash isolation — the 15.3 T20 pattern)
// ════════════════════════════════════════════════════════════════════════════

/**
 * Helper: create an active topic with N coordination-level participants, plus a
 * decision body with the given weighted members + veto holders.
 */
async function mkMotionTopic(
  slot: string,
  actorIds: string[] = ['proposer', 'seconder', 'voterA'],
  bodyOpts: { quorum?: number; threshold?: number; veto_holders?: string[]; members?: Array<[string, number]> } = {},
) {
  const t = await charterTopic({
    project_id: TEST_PROJECT, name: `Motion Sweep ${slot}`,
    charter: 'motion sweep test', created_by: actorIds[0],
  });
  const topicId = t.topic_id;
  for (const a of actorIds) {
    await joinTopic({ topic_id: topicId, actor_id: a, actor_type: 'ai', display_name: a, level: 'coordination' });
  }
  const body = await createBody({
    project_id: TEST_PROJECT, name: `Body ${slot}`,
    quorum: bodyOpts.quorum ?? 0, threshold: bodyOpts.threshold ?? 0.5,
    veto_holders: bodyOpts.veto_holders ?? [], created_by: actorIds[0],
  });
  for (const [actor, weight] of bodyOpts.members ?? []) {
    await addBodyMember({ body_id: body.body_id, actor_id: actor, vote_weight: weight });
  }
  return { topicId, bodyId: body.body_id };
}

/** Force a motion's deadline into the past. */
async function expireMotionRow(motionId: string) {
  const pool = getDbPool();
  await pool.query(
    `UPDATE motions SET deadline = now() - interval '10 minutes' WHERE motion_id = $1`,
    [motionId],
  );
}

// ── T11a: balloting motion past deadline → auto-tallied ──────────────────────

test('T11a: a balloting motion past deadline → swept, auto-tallied to the correct outcome', async () => {
  const { topicId, bodyId } = await mkMotionTopic('t11a', ['proposer', 'seconder', 'voterA'], {
    quorum: 0, threshold: 0.5, members: [['proposer', 1], ['seconder', 1], ['voterA', 9]],
  });
  const p = await proposeMotion({ topic_id: topicId, body_id: bodyId, subject_ref: 'ref', proposed_by: 'proposer' });
  if (p.status !== 'proposed') throw new Error('setup failed');
  await secondMotion({ motion_id: p.motion_id, actor_id: 'seconder' });
  await castVote({ motion_id: p.motion_id, actor_id: 'voterA', choice: 'for' }); // 9 for, base 9
  await expireMotionRow(p.motion_id);

  const result = await sweepExpiredMotions();
  assert.equal(result.resolved, 1);

  const pool = getDbPool();
  const m = await pool.query<{ status: string; tally: any }>(
    `SELECT status, tally FROM motions WHERE motion_id=$1`, [p.motion_id],
  );
  // for=9, base=9, 9 >= 0.5*9 → carried
  assert.equal(m.rows[0].status, 'carried', 'sweep auto-tallied to carried');
  assert.equal(Number(m.rows[0].tally.for), 9);

  const ev = await replayEvents({ topic_id: topicId });
  const tallied = ev.events.find((e) => e.type === 'motion.tallied');
  assert.ok(tallied, 'motion.tallied emitted by the sweep');
  assert.equal(tallied!.actor_id, 'system:sweep');
  assert.equal(tallied!.payload.outcome, 'carried');
  assert.equal(tallied!.payload.auto, true);
});

// ── T11b: proposed motion past deadline → lapsed ─────────────────────────────

test('T11b: a proposed (never-seconded) motion past deadline → lapsed (reason not_seconded)', async () => {
  const { topicId, bodyId } = await mkMotionTopic('t11b', ['proposer'], { members: [['proposer', 1]] });
  const p = await proposeMotion({ topic_id: topicId, body_id: bodyId, subject_ref: 'ref', proposed_by: 'proposer' });
  if (p.status !== 'proposed') throw new Error('setup failed');
  // never seconded — stays 'proposed'
  await expireMotionRow(p.motion_id);

  const result = await sweepExpiredMotions();
  assert.equal(result.resolved, 1);

  const pool = getDbPool();
  const m = await pool.query<{ status: string; tally: any }>(
    `SELECT status, tally FROM motions WHERE motion_id=$1`, [p.motion_id],
  );
  assert.equal(m.rows[0].status, 'lapsed', 'never-seconded motion lapses');
  assert.equal(m.rows[0].tally, null, 'lapsed-not-seconded carries no tally');

  const ev = await replayEvents({ topic_id: topicId });
  const tallied = ev.events.find((e) => e.type === 'motion.tallied');
  assert.ok(tallied, 'motion.tallied emitted');
  assert.equal(tallied!.payload.outcome, 'lapsed');
  assert.equal(tallied!.payload.reason, 'not_seconded');
});

// ── T11c: motion on a closed topic → skipped ─────────────────────────────────

test('T11c: an expired motion on a closed topic → skipped (no mutation, no event)', async () => {
  const { topicId, bodyId } = await mkMotionTopic('t11c', ['proposer', 'seconder', 'voterA'], {
    members: [['proposer', 1], ['seconder', 1], ['voterA', 1]],
  });
  const p = await proposeMotion({ topic_id: topicId, body_id: bodyId, subject_ref: 'ref', proposed_by: 'proposer' });
  if (p.status !== 'proposed') throw new Error('setup failed');
  await secondMotion({ motion_id: p.motion_id, actor_id: 'seconder' });
  await expireMotionRow(p.motion_id);
  await closeTopic({ topic_id: topicId, actor_id: 'proposer' });

  const pool = getDbPool();
  const evBefore = await replayEvents({ topic_id: topicId });
  const evCountBefore = evBefore.events.length;

  const result = await sweepExpiredMotions();
  assert.equal(result.resolved, 0, 'closed-topic motion not counted as resolved');

  const m = await pool.query<{ status: string }>(
    `SELECT status FROM motions WHERE motion_id=$1`, [p.motion_id],
  );
  assert.equal(m.rows[0].status, 'balloting', 'motion unchanged — frozen mid-ballot');

  const evAfter = await replayEvents({ topic_id: topicId });
  assert.equal(evAfter.events.length, evCountBefore, 'no event emitted on the closed topic');
});

// ── T11d: batch with one bad + one good expired motion → good still resolves ─

test('T11d: a batch with one bad and one good expired motion → the good one still resolves (crash isolation)', async () => {
  const good = await mkMotionTopic('t11dg', ['proposer', 'seconder', 'voterA'], {
    quorum: 0, threshold: 0.5, members: [['proposer', 1], ['seconder', 1], ['voterA', 5]],
  });
  const bad = await mkMotionTopic('t11db', ['proposer', 'seconder', 'voterA'], {
    quorum: 0, threshold: 0.5, members: [['proposer', 1], ['seconder', 1], ['voterA', 5]],
  });

  // good motion — balloting, past deadline
  const pGood = await proposeMotion({ topic_id: good.topicId, body_id: good.bodyId, subject_ref: 'ref', proposed_by: 'proposer' });
  if (pGood.status !== 'proposed') throw new Error('setup failed');
  await secondMotion({ motion_id: pGood.motion_id, actor_id: 'seconder' });
  await castVote({ motion_id: pGood.motion_id, actor_id: 'voterA', choice: 'for' });
  await expireMotionRow(pGood.motion_id);

  // bad motion — balloting, past deadline; plant a 23505 PK collision on the bad
  // topic's coordination_events so the sweep's appendEvent throws inside the
  // per-motion transaction (the T17/T20 crash-isolation technique).
  const pBad = await proposeMotion({ topic_id: bad.topicId, body_id: bad.bodyId, subject_ref: 'ref', proposed_by: 'proposer' });
  if (pBad.status !== 'proposed') throw new Error('setup failed');
  await secondMotion({ motion_id: pBad.motion_id, actor_id: 'seconder' });
  await expireMotionRow(pBad.motion_id);

  const pool = getDbPool();
  const seqRow = await pool.query<{ next_seq: string }>(
    `SELECT next_seq FROM topics WHERE topic_id=$1`, [bad.topicId],
  );
  const collidingSeq = Number(seqRow.rows[0].next_seq) + 1;
  await pool.query(
    `INSERT INTO coordination_events (topic_id, seq, actor_id, type, subject_type, subject_id, payload)
     VALUES ($1, $2, 'test', 'motion.tallied', 'motion', $3, '{}')`,
    [bad.topicId, collidingSeq, pBad.motion_id],
  );

  const result = await sweepExpiredMotions();
  // the bad motion's transaction threw (23505) → §0.1-loop catch logged + rolled
  // back + continued; only the good motion committed.
  assert.equal(result.resolved, 1, 'exactly the good motion is counted resolved');

  const mGood = await pool.query<{ status: string }>(
    `SELECT status FROM motions WHERE motion_id=$1`, [pGood.motion_id],
  );
  assert.equal(mGood.rows[0].status, 'carried', 'good motion resolved despite the bad one');

  const mBad = await pool.query<{ status: string }>(
    `SELECT status FROM motions WHERE motion_id=$1`, [pBad.motion_id],
  );
  assert.equal(mBad.rows[0].status, 'balloting', 'bad motion unchanged (rolled back)');
});
