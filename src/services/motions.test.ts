/**
 * Phase 15 Sprint 15.4 — motions service unit tests.
 *
 * Design ref: docs/specs/2026-05-18-phase-15-sprint-15.4-design.md §3, §4, §9.
 *
 * Covers:
 *   T5  propose — valid → proposed + motion.proposed; non-participant →
 *       not_participant; unknown body → body_not_found; cross-project body →
 *       body_not_found; closed topic → topic_closed; deadline_minutes out of
 *       range → BAD_REQUEST
 *   T6  second — member≠proposer → balloting + motion.seconded; proposer →
 *       self_second_forbidden; non-member → not_member; non-proposed → conflict;
 *       closed topic → topic_closed
 *   T7  vote — member while balloting → vote_recorded + weight snapshot;
 *       non-member → not_member; non-balloting → not_balloting; past-deadline →
 *       balloting_closed; re-cast → already_voted; proxy ballot → principal-keyed
 *       row with proxy_for set; self-proxy → BAD_REQUEST
 *   T8  tally — pre-deadline → balloting_open (BLOCK-1); quorum unmet → lapsed;
 *       quorum+threshold met → carried; quorum met, threshold unmet → failed;
 *       all-abstain → failed; tie at threshold=0.5 → carried; non-balloting →
 *       not_balloting; weight-snapshot uses cast-time weight
 *   T9  veto — veto_holder while balloting → vetoed + motion.vetoed; non-holder →
 *       not_veto_holder; non-balloting → not_balloting; mutual exclusion
 *   T10 getMotion / listMotions — motion + votes; unknown id → null;
 *       listMotions unknown topic → NOT_FOUND; status filter narrows
 */

import assert from 'node:assert/strict';
import test, { before, after, beforeEach } from 'node:test';
import {
  proposeMotion,
  secondMotion,
  castVote,
  tallyMotion,
  vetoMotion,
  getMotion,
  listMotions,
} from './motions.js';
import { createBody, addBodyMember } from './decisionBodies.js';
import { charterTopic, joinTopic, closeTopic } from './topics.js';
import { replayEvents } from './coordinationEvents.js';
import { getDbPool } from '../db/client.js';

const TEST_PROJECT = '__test_motions__';

async function cleanup() {
  const pool = getDbPool();
  const topicIds = await pool.query<{ topic_id: string }>(
    `SELECT topic_id FROM topics WHERE project_id = $1`,
    [TEST_PROJECT],
  );
  for (const { topic_id } of topicIds.rows) {
    // Sprint 15.8 — request_steps may link to motions; null out first.
    await pool.query(`UPDATE request_steps SET motion_id=NULL WHERE request_id IN
      (SELECT request_id FROM requests WHERE topic_id=$1)`, [topic_id]);
    await pool.query(`DELETE FROM votes WHERE motion_id IN
      (SELECT motion_id FROM motions WHERE topic_id=$1)`, [topic_id]);
    await pool.query(`DELETE FROM motions WHERE topic_id = $1`, [topic_id]);
    // Sprint 15.8 — collective tests create requests + request_steps for the topic.
    await pool.query(`DELETE FROM request_steps WHERE request_id IN
      (SELECT request_id FROM requests WHERE topic_id=$1)`, [topic_id]);
    await pool.query(`DELETE FROM requests WHERE topic_id = $1`, [topic_id]);
    // Sprint 15.7 — chain may have created tasks/artifacts on carried tallies.
    await pool.query(`DELETE FROM claims WHERE topic_id = $1`, [topic_id]);
    await pool.query(`DELETE FROM artifact_versions WHERE artifact_id IN
      (SELECT artifact_id FROM artifacts WHERE topic_id=$1)`, [topic_id]);
    await pool.query(`DELETE FROM artifacts WHERE topic_id = $1`, [topic_id]);
    await pool.query(`DELETE FROM tasks WHERE topic_id = $1`, [topic_id]);
    await pool.query(`DELETE FROM coordination_events WHERE topic_id = $1`, [topic_id]);
  }
  // Sprint 15.8 — doa_matrix must be dropped BEFORE decision_bodies (FK).
  await pool.query(`DELETE FROM doa_matrix WHERE project_id = $1`, [TEST_PROJECT]);
  await pool.query(`DELETE FROM topics WHERE project_id = $1`, [TEST_PROJECT]);
  await pool.query(`DELETE FROM actors WHERE project_id = $1`, [TEST_PROJECT]);
  // bodies (project-scoped config; including the cross-project body in T5)
  const bodyIds = await pool.query<{ body_id: string }>(
    `SELECT body_id FROM decision_bodies WHERE project_id IN ($1, $2)`,
    [TEST_PROJECT, `${TEST_PROJECT}_x`],
  );
  for (const { body_id } of bodyIds.rows) {
    await pool.query(`DELETE FROM body_members WHERE body_id = $1`, [body_id]);
  }
  await pool.query(`DELETE FROM decision_bodies WHERE project_id IN ($1, $2)`, [TEST_PROJECT, `${TEST_PROJECT}_x`]);
}

before(cleanup);
after(cleanup);
beforeEach(cleanup);

/**
 * Create an active topic with N participants. Returns { topicId, actors }.
 * `actorIds` default: proposer, seconder, voterA, voterB, voterC.
 */
async function mkTopic(actorIds: string[] = ['proposer', 'seconder', 'voterA', 'voterB', 'voterC']) {
  const t = await charterTopic({
    project_id: TEST_PROJECT, name: 'Motion Test Topic',
    charter: 'collective decision', created_by: actorIds[0],
  });
  for (const a of actorIds) {
    await joinTopic({ topic_id: t.topic_id, actor_id: a, actor_type: 'human', display_name: a, level: 'coordination' });
  }
  return { topicId: t.topic_id, actors: actorIds };
}

/** Create a body in TEST_PROJECT with the given weighted members + veto holders. */
async function mkBody(opts: {
  quorum?: number;
  threshold?: number;
  veto_holders?: string[];
  members?: Array<[string, number]>;
  project_id?: string;
}) {
  const body = await createBody({
    project_id: opts.project_id ?? TEST_PROJECT,
    name: 'Test Body',
    quorum: opts.quorum ?? 0,
    threshold: opts.threshold ?? 0.5,
    veto_holders: opts.veto_holders ?? [],
    created_by: 'founder',
  });
  for (const [actor, weight] of opts.members ?? []) {
    await addBodyMember({ body_id: body.body_id, actor_id: actor, vote_weight: weight });
  }
  return body;
}

/** Force a motion's deadline into the past (the 15.3 escalation-test precedent). */
async function expireMotion(motionId: string) {
  const pool = getDbPool();
  await pool.query(
    `UPDATE motions SET deadline = now() - interval '10 minutes' WHERE motion_id = $1`,
    [motionId],
  );
}

/** Propose + second a motion → leaves it in 'balloting'. Returns motion_id. */
async function mkBallotingMotion(topicId: string, bodyId: string, proposer = 'proposer', seconder = 'seconder') {
  const p = await proposeMotion({
    topic_id: topicId, body_id: bodyId, subject_ref: 'ref-1', proposed_by: proposer,
  });
  assert.equal(p.status, 'proposed');
  if (p.status !== 'proposed') throw new Error('propose setup failed');
  const s = await secondMotion({ motion_id: p.motion_id, actor_id: seconder });
  assert.equal(s.status, 'seconded');
  return p.motion_id;
}

// ════════════════════════════════════════════════════════════════════════════
// T5 — proposeMotion
// ════════════════════════════════════════════════════════════════════════════

test('T5: proposeMotion valid → proposed + motion.proposed event', async () => {
  const { topicId } = await mkTopic();
  const body = await mkBody({ members: [['voterA', 1]] });
  const res = await proposeMotion({
    topic_id: topicId, body_id: body.body_id, subject_ref: 'adopt-spec', proposed_by: 'proposer',
  });
  assert.equal(res.status, 'proposed');
  if (res.status !== 'proposed') throw new Error('propose failed');
  assert.ok(res.motion_id, 'motion_id generated');
  assert.ok(res.deadline, 'deadline returned');

  const ev = await replayEvents({ topic_id: topicId });
  const proposed = ev.events.find((e) => e.type === 'motion.proposed');
  assert.ok(proposed, 'motion.proposed emitted');
  assert.equal(proposed!.subject_type, 'motion');
  assert.equal(proposed!.subject_id, res.motion_id);
  assert.equal(proposed!.payload.body_id, body.body_id);
  assert.equal(proposed!.payload.subject_ref, 'adopt-spec');

  const pool = getDbPool();
  const m = await pool.query<{ status: string }>(
    `SELECT status FROM motions WHERE motion_id=$1`, [res.motion_id],
  );
  assert.equal(m.rows[0].status, 'proposed');
});

test('T5: proposeMotion non-participant → not_participant', async () => {
  const { topicId } = await mkTopic();
  const body = await mkBody({});
  const res = await proposeMotion({
    topic_id: topicId, body_id: body.body_id, subject_ref: 'x', proposed_by: 'stranger',
  });
  assert.equal(res.status, 'not_participant');
});

test('T5: proposeMotion unknown body → body_not_found', async () => {
  const { topicId } = await mkTopic();
  const res = await proposeMotion({
    topic_id: topicId, body_id: '00000000-0000-0000-0000-000000000000',
    subject_ref: 'x', proposed_by: 'proposer',
  });
  assert.equal(res.status, 'body_not_found');
});

test('T5: proposeMotion cross-project body → body_not_found', async () => {
  const { topicId } = await mkTopic();
  // a body in a DIFFERENT project — must be rejected (cross-project integrity, inv. 8)
  const foreignBody = await mkBody({ project_id: `${TEST_PROJECT}_x` });
  const res = await proposeMotion({
    topic_id: topicId, body_id: foreignBody.body_id, subject_ref: 'x', proposed_by: 'proposer',
  });
  assert.equal(res.status, 'body_not_found');
});

test('T5: proposeMotion closed topic → topic_closed', async () => {
  const { topicId } = await mkTopic();
  const body = await mkBody({});
  await closeTopic({ topic_id: topicId, actor_id: 'proposer' });
  const res = await proposeMotion({
    topic_id: topicId, body_id: body.body_id, subject_ref: 'x', proposed_by: 'proposer',
  });
  assert.equal(res.status, 'topic_closed');
});

test('T5: proposeMotion unknown topic → NOT_FOUND', async () => {
  const body = await mkBody({});
  await assert.rejects(
    () => proposeMotion({
      topic_id: 'no-such-topic', body_id: body.body_id, subject_ref: 'x', proposed_by: 'proposer',
    }),
    (err: any) => { assert.equal(err.code, 'NOT_FOUND'); return true; },
  );
});

test('T5: proposeMotion deadline_minutes below MIN → BAD_REQUEST', async () => {
  const { topicId } = await mkTopic();
  const body = await mkBody({});
  await assert.rejects(
    () => proposeMotion({
      topic_id: topicId, body_id: body.body_id, subject_ref: 'x',
      proposed_by: 'proposer', deadline_minutes: 1,
    }),
    (err: any) => { assert.equal(err.code, 'BAD_REQUEST'); return true; },
  );
});

test('T5: proposeMotion deadline_minutes above MAX → BAD_REQUEST', async () => {
  const { topicId } = await mkTopic();
  const body = await mkBody({});
  await assert.rejects(
    () => proposeMotion({
      topic_id: topicId, body_id: body.body_id, subject_ref: 'x',
      proposed_by: 'proposer', deadline_minutes: 999999,
    }),
    (err: any) => { assert.equal(err.code, 'BAD_REQUEST'); return true; },
  );
});

test('T5: proposeMotion fractional deadline_minutes → BAD_REQUEST', async () => {
  const { topicId } = await mkTopic();
  const body = await mkBody({});
  await assert.rejects(
    () => proposeMotion({
      topic_id: topicId, body_id: body.body_id, subject_ref: 'x',
      proposed_by: 'proposer', deadline_minutes: 10.5,
    }),
    (err: any) => { assert.equal(err.code, 'BAD_REQUEST'); return true; },
  );
});

test('T5: proposeMotion over-long subject_ref → BAD_REQUEST', async () => {
  const { topicId } = await mkTopic();
  const body = await mkBody({});
  await assert.rejects(
    () => proposeMotion({
      topic_id: topicId, body_id: body.body_id, subject_ref: 'z'.repeat(257), proposed_by: 'proposer',
    }),
    (err: any) => { assert.equal(err.code, 'BAD_REQUEST'); return true; },
  );
});

test('T5: proposeMotion deadline_minutes at the MIN/MAX boundary → accepted (review-impl COSMETIC-3)', async () => {
  const { topicId } = await mkTopic();
  const body = await mkBody({});
  const atMin = await proposeMotion({
    topic_id: topicId, body_id: body.body_id, subject_ref: 'min', proposed_by: 'proposer', deadline_minutes: 5,
  });
  assert.equal(atMin.status, 'proposed', 'deadline_minutes = 5 (MIN) accepted');
  const atMax = await proposeMotion({
    topic_id: topicId, body_id: body.body_id, subject_ref: 'max', proposed_by: 'proposer', deadline_minutes: 43200,
  });
  assert.equal(atMax.status, 'proposed', 'deadline_minutes = 43200 (MAX) accepted');
});

// ════════════════════════════════════════════════════════════════════════════
// T6 — secondMotion
// ════════════════════════════════════════════════════════════════════════════

test('T6: secondMotion by a member ≠ proposer → balloting + motion.seconded', async () => {
  const { topicId } = await mkTopic();
  const body = await mkBody({ members: [['proposer', 1], ['seconder', 1]] });
  const p = await proposeMotion({
    topic_id: topicId, body_id: body.body_id, subject_ref: 'x', proposed_by: 'proposer',
  });
  assert.equal(p.status, 'proposed');
  if (p.status !== 'proposed') throw new Error('setup failed');

  const res = await secondMotion({ motion_id: p.motion_id, actor_id: 'seconder' });
  assert.equal(res.status, 'seconded');
  if (res.status !== 'seconded') throw new Error('second failed');
  assert.equal(res.motion_status, 'balloting');

  const pool = getDbPool();
  const m = await pool.query<{ status: string; seconded_by: string }>(
    `SELECT status, seconded_by FROM motions WHERE motion_id=$1`, [p.motion_id],
  );
  assert.equal(m.rows[0].status, 'balloting');
  assert.equal(m.rows[0].seconded_by, 'seconder');

  const ev = await replayEvents({ topic_id: topicId });
  assert.ok(ev.events.some((e) => e.type === 'motion.seconded'), 'motion.seconded emitted');
});

test('T6: secondMotion by the proposer → self_second_forbidden', async () => {
  const { topicId } = await mkTopic();
  const body = await mkBody({ members: [['proposer', 1]] });
  const p = await proposeMotion({
    topic_id: topicId, body_id: body.body_id, subject_ref: 'x', proposed_by: 'proposer',
  });
  if (p.status !== 'proposed') throw new Error('setup failed');
  const res = await secondMotion({ motion_id: p.motion_id, actor_id: 'proposer' });
  assert.equal(res.status, 'self_second_forbidden');
});

test('T6: secondMotion by a non-member → not_member', async () => {
  const { topicId } = await mkTopic();
  const body = await mkBody({ members: [['proposer', 1]] });
  const p = await proposeMotion({
    topic_id: topicId, body_id: body.body_id, subject_ref: 'x', proposed_by: 'proposer',
  });
  if (p.status !== 'proposed') throw new Error('setup failed');
  // 'seconder' is a topic participant but NOT a body member
  const res = await secondMotion({ motion_id: p.motion_id, actor_id: 'seconder' });
  assert.equal(res.status, 'not_member');
});

test('T6: secondMotion on a non-proposed motion → conflict', async () => {
  const { topicId } = await mkTopic();
  const body = await mkBody({ members: [['proposer', 1], ['seconder', 1], ['voterA', 1]] });
  const motionId = await mkBallotingMotion(topicId, body.body_id);
  // motion is now 'balloting' — a second second is a conflict
  const res = await secondMotion({ motion_id: motionId, actor_id: 'voterA' });
  assert.equal(res.status, 'conflict');
});

test('T6: secondMotion unknown motion → not_found', async () => {
  const res = await secondMotion({
    motion_id: '00000000-0000-0000-0000-000000000000', actor_id: 'seconder',
  });
  assert.equal(res.status, 'not_found');
});

test('T6: secondMotion on a closed topic → topic_closed', async () => {
  const { topicId } = await mkTopic();
  const body = await mkBody({ members: [['proposer', 1], ['seconder', 1]] });
  const p = await proposeMotion({
    topic_id: topicId, body_id: body.body_id, subject_ref: 'x', proposed_by: 'proposer',
  });
  if (p.status !== 'proposed') throw new Error('setup failed');
  // bypass drain so the proposed motion survives; tests the closed-topic guard
  await getDbPool().query(`UPDATE topics SET status='closed' WHERE topic_id=$1`, [topicId]);
  const res = await secondMotion({ motion_id: p.motion_id, actor_id: 'seconder' });
  assert.equal(res.status, 'topic_closed');
});

// ════════════════════════════════════════════════════════════════════════════
// T7 — castVote
// ════════════════════════════════════════════════════════════════════════════

test('T7: castVote by a member while balloting → vote_recorded + weight snapshot', async () => {
  const { topicId } = await mkTopic();
  const body = await mkBody({ members: [['proposer', 1], ['seconder', 1], ['voterA', 9]] });
  const motionId = await mkBallotingMotion(topicId, body.body_id);

  const res = await castVote({ motion_id: motionId, actor_id: 'voterA', choice: 'for' });
  assert.equal(res.status, 'vote_recorded');

  const pool = getDbPool();
  const v = await pool.query<{ choice: string; weight: string; proxy_for: string | null }>(
    `SELECT choice, weight, proxy_for FROM votes WHERE motion_id=$1 AND actor_id=$2`,
    [motionId, 'voterA'],
  );
  assert.equal(v.rows[0].choice, 'for');
  assert.equal(Number(v.rows[0].weight), 9, 'weight snapshotted from body_members.vote_weight');
  assert.equal(v.rows[0].proxy_for, null);

  const ev = await replayEvents({ topic_id: topicId });
  const voteEv = ev.events.find((e) => e.type === 'vote.cast');
  assert.ok(voteEv, 'vote.cast emitted');
  assert.equal(voteEv!.payload.principal, 'voterA');
  assert.equal(voteEv!.payload.choice, 'for');
});

test('T7: castVote by a non-member → not_member', async () => {
  const { topicId } = await mkTopic();
  const body = await mkBody({ members: [['proposer', 1], ['seconder', 1]] });
  const motionId = await mkBallotingMotion(topicId, body.body_id);
  // 'voterA' is a topic participant but NOT a body member
  const res = await castVote({ motion_id: motionId, actor_id: 'voterA', choice: 'for' });
  assert.equal(res.status, 'not_member');
});

test('T7: castVote on a non-balloting motion → not_balloting', async () => {
  const { topicId } = await mkTopic();
  const body = await mkBody({ members: [['proposer', 1], ['voterA', 1]] });
  // motion stays 'proposed' (never seconded)
  const p = await proposeMotion({
    topic_id: topicId, body_id: body.body_id, subject_ref: 'x', proposed_by: 'proposer',
  });
  if (p.status !== 'proposed') throw new Error('setup failed');
  const res = await castVote({ motion_id: p.motion_id, actor_id: 'voterA', choice: 'for' });
  assert.equal(res.status, 'not_balloting');
});

test('T7: castVote on a past-deadline motion → balloting_closed', async () => {
  const { topicId } = await mkTopic();
  const body = await mkBody({ members: [['proposer', 1], ['seconder', 1], ['voterA', 1]] });
  const motionId = await mkBallotingMotion(topicId, body.body_id);
  await expireMotion(motionId);
  const res = await castVote({ motion_id: motionId, actor_id: 'voterA', choice: 'for' });
  assert.equal(res.status, 'balloting_closed');
});

test('T7: castVote re-cast by the same principal → already_voted', async () => {
  const { topicId } = await mkTopic();
  const body = await mkBody({ members: [['proposer', 1], ['seconder', 1], ['voterA', 1]] });
  const motionId = await mkBallotingMotion(topicId, body.body_id);
  const first = await castVote({ motion_id: motionId, actor_id: 'voterA', choice: 'for' });
  assert.equal(first.status, 'vote_recorded');
  const second = await castVote({ motion_id: motionId, actor_id: 'voterA', choice: 'against' });
  assert.equal(second.status, 'already_voted', 'one immutable ballot per principal');
});

test('T7: castVote proxy ballot → principal-keyed row with proxy_for set', async () => {
  const { topicId } = await mkTopic();
  const body = await mkBody({ members: [['proposer', 1], ['seconder', 1], ['voterA', 5]] });
  const motionId = await mkBallotingMotion(topicId, body.body_id);
  // 'seconder' casts voterA's ballot by proxy
  const res = await castVote({ motion_id: motionId, actor_id: 'voterA', choice: 'for', proxy_for: 'seconder' });
  assert.equal(res.status, 'vote_recorded');

  const pool = getDbPool();
  const v = await pool.query<{ actor_id: string; weight: string; proxy_for: string | null }>(
    `SELECT actor_id, weight, proxy_for FROM votes WHERE motion_id=$1`,
    [motionId],
  );
  assert.equal(v.rowCount, 1);
  assert.equal(v.rows[0].actor_id, 'voterA', 'row keyed on the principal');
  assert.equal(Number(v.rows[0].weight), 5, 'principal’s weight snapshotted');
  assert.equal(v.rows[0].proxy_for, 'seconder', 'proxy_for records the holder');

  const ev = await replayEvents({ topic_id: topicId });
  const voteEv = ev.events.find((e) => e.type === 'vote.cast');
  assert.equal(voteEv!.actor_id, 'seconder', 'event actor_id is the proxy holder');
  assert.equal(voteEv!.payload.principal, 'voterA');
});

test('T7: castVote self-proxy (proxy_for == actor_id) → BAD_REQUEST', async () => {
  const { topicId } = await mkTopic();
  const body = await mkBody({ members: [['proposer', 1], ['seconder', 1], ['voterA', 1]] });
  const motionId = await mkBallotingMotion(topicId, body.body_id);
  await assert.rejects(
    () => castVote({ motion_id: motionId, actor_id: 'voterA', choice: 'for', proxy_for: 'voterA' }),
    (err: any) => { assert.equal(err.code, 'BAD_REQUEST'); return true; },
  );
});

test('T7: castVote invalid choice → BAD_REQUEST', async () => {
  const { topicId } = await mkTopic();
  const body = await mkBody({ members: [['proposer', 1], ['seconder', 1], ['voterA', 1]] });
  const motionId = await mkBallotingMotion(topicId, body.body_id);
  await assert.rejects(
    () => castVote({ motion_id: motionId, actor_id: 'voterA', choice: 'maybe' as any }),
    (err: any) => { assert.equal(err.code, 'BAD_REQUEST'); return true; },
  );
});

test('T7: castVote unknown motion → not_found', async () => {
  const res = await castVote({
    motion_id: '00000000-0000-0000-0000-000000000000', actor_id: 'voterA', choice: 'for',
  });
  assert.equal(res.status, 'not_found');
});

test('T7: castVote on a closed topic → topic_closed', async () => {
  const { topicId } = await mkTopic();
  const body = await mkBody({ members: [['proposer', 1], ['seconder', 1], ['voterA', 1]] });
  const motionId = await mkBallotingMotion(topicId, body.body_id);
  // bypass drain so the balloting motion survives; tests the closed-topic guard
  await getDbPool().query(`UPDATE topics SET status='closed' WHERE topic_id=$1`, [topicId]);
  const res = await castVote({ motion_id: motionId, actor_id: 'voterA', choice: 'for' });
  assert.equal(res.status, 'topic_closed');
});

// ════════════════════════════════════════════════════════════════════════════
// T8 — tallyMotion (the §4 algorithm)
// ════════════════════════════════════════════════════════════════════════════

test('T8: tallyMotion pre-deadline → balloting_open (BLOCK-1)', async () => {
  const { topicId } = await mkTopic();
  const body = await mkBody({ quorum: 0, threshold: 0.5, members: [['proposer', 1], ['seconder', 1], ['voterA', 1]] });
  const motionId = await mkBallotingMotion(topicId, body.body_id);
  await castVote({ motion_id: motionId, actor_id: 'voterA', choice: 'for' });
  // deadline NOT expired — tally must reject
  const res = await tallyMotion({ motion_id: motionId });
  assert.equal(res.status, 'balloting_open');
});

test('T8: tallyMotion quorum unmet → lapsed', async () => {
  const { topicId } = await mkTopic();
  // quorum 100; only 1 weight participates → quorum_met=false → lapsed
  const body = await mkBody({ quorum: 100, threshold: 0.5, members: [['proposer', 1], ['seconder', 1], ['voterA', 1]] });
  const motionId = await mkBallotingMotion(topicId, body.body_id);
  await castVote({ motion_id: motionId, actor_id: 'voterA', choice: 'for' });
  await expireMotion(motionId);
  const res = await tallyMotion({ motion_id: motionId });
  assert.equal(res.status, 'lapsed');
  if (res.status !== 'lapsed') throw new Error('expected lapsed');
  assert.equal(res.tally.quorum_met, false);
});

test('T8: tallyMotion quorum + threshold met → carried', async () => {
  const { topicId } = await mkTopic();
  const body = await mkBody({ quorum: 2, threshold: 0.6, members: [['proposer', 1], ['seconder', 1], ['voterA', 7], ['voterB', 3]] });
  const motionId = await mkBallotingMotion(topicId, body.body_id);
  await castVote({ motion_id: motionId, actor_id: 'voterA', choice: 'for' });    // 7 for
  await castVote({ motion_id: motionId, actor_id: 'voterB', choice: 'against' }); // 3 against
  await expireMotion(motionId);
  const res = await tallyMotion({ motion_id: motionId });
  // for=7, base=10, 7 >= 0.6*10=6 → carried
  assert.equal(res.status, 'carried');
  if (res.status !== 'carried') throw new Error('expected carried');
  assert.equal(Number(res.tally.for), 7);
  assert.equal(Number(res.tally.against), 3);
  assert.equal(res.tally.quorum_met, true);
});

test('T8: tallyMotion quorum met, threshold unmet → failed', async () => {
  const { topicId } = await mkTopic();
  const body = await mkBody({ quorum: 2, threshold: 0.6, members: [['proposer', 1], ['seconder', 1], ['voterA', 5], ['voterB', 5]] });
  const motionId = await mkBallotingMotion(topicId, body.body_id);
  await castVote({ motion_id: motionId, actor_id: 'voterA', choice: 'for' });    // 5 for
  await castVote({ motion_id: motionId, actor_id: 'voterB', choice: 'against' }); // 5 against
  await expireMotion(motionId);
  const res = await tallyMotion({ motion_id: motionId });
  // for=5, base=10, 5 >= 0.6*10=6 is false → failed
  assert.equal(res.status, 'failed');
});

test('T8: tallyMotion all-abstain → failed (base 0, no divide-by-zero)', async () => {
  const { topicId } = await mkTopic();
  const body = await mkBody({ quorum: 1, threshold: 0.5, members: [['proposer', 1], ['seconder', 1], ['voterA', 4]] });
  const motionId = await mkBallotingMotion(topicId, body.body_id);
  await castVote({ motion_id: motionId, actor_id: 'voterA', choice: 'abstain' });
  await expireMotion(motionId);
  const res = await tallyMotion({ motion_id: motionId });
  // participating=4 >= quorum 1 → quorum_met; base=f+a=0 → carried=false → failed
  assert.equal(res.status, 'failed');
  if (res.status !== 'failed') throw new Error('expected failed');
  assert.equal(Number(res.tally.base), 0);
});

test('T8: tallyMotion tie at threshold=0.5 → carried (inclusive threshold WARN-2)', async () => {
  const { topicId } = await mkTopic();
  const body = await mkBody({ quorum: 0, threshold: 0.5, members: [['proposer', 1], ['seconder', 1], ['voterA', 5], ['voterB', 5]] });
  const motionId = await mkBallotingMotion(topicId, body.body_id);
  await castVote({ motion_id: motionId, actor_id: 'voterA', choice: 'for' });    // 5 for
  await castVote({ motion_id: motionId, actor_id: 'voterB', choice: 'against' }); // 5 against
  await expireMotion(motionId);
  const res = await tallyMotion({ motion_id: motionId });
  // for=5, base=10, 5 >= 0.5*10=5 → carried (inclusive ≥)
  assert.equal(res.status, 'carried');
});

test('T8: tallyMotion no votes at all, quorum>0 → lapsed', async () => {
  const { topicId } = await mkTopic();
  const body = await mkBody({ quorum: 1, threshold: 0.5, members: [['proposer', 1], ['seconder', 1]] });
  const motionId = await mkBallotingMotion(topicId, body.body_id);
  await expireMotion(motionId);
  const res = await tallyMotion({ motion_id: motionId });
  assert.equal(res.status, 'lapsed');
});

test('T8: tallyMotion no votes at all, quorum=0 → failed', async () => {
  const { topicId } = await mkTopic();
  const body = await mkBody({ quorum: 0, threshold: 0.5, members: [['proposer', 1], ['seconder', 1]] });
  const motionId = await mkBallotingMotion(topicId, body.body_id);
  await expireMotion(motionId);
  const res = await tallyMotion({ motion_id: motionId });
  // participating=0 >= 0 → quorum_met; base=0 → carried false → failed
  assert.equal(res.status, 'failed');
});

// ── Sprint 15.6 HIGH fix: proposeMotion must block on 'closing' ──────────────

test('T5: proposeMotion on a closing topic → topic_closed', async () => {
  const { topicId } = await mkTopic();
  const body = await mkBody({});
  // Simulate the drain window: topic is 'closing' but not yet 'closed'.
  await getDbPool().query(`UPDATE topics SET status='closing' WHERE topic_id=$1`, [topicId]);

  const res = await proposeMotion({
    topic_id: topicId, body_id: body.body_id, subject_ref: 'x', proposed_by: 'proposer',
  });
  assert.equal(res.status, 'topic_closed');
});

test('T8: tallyMotion on a non-balloting motion → not_balloting', async () => {
  const { topicId } = await mkTopic();
  const body = await mkBody({ members: [['proposer', 1]] });
  const p = await proposeMotion({
    topic_id: topicId, body_id: body.body_id, subject_ref: 'x', proposed_by: 'proposer',
  });
  if (p.status !== 'proposed') throw new Error('setup failed');
  await expireMotion(p.motion_id);
  const res = await tallyMotion({ motion_id: p.motion_id });
  assert.equal(res.status, 'not_balloting');
});

test('T8: tallyMotion already-tallied motion → not_balloting', async () => {
  const { topicId } = await mkTopic();
  const body = await mkBody({ quorum: 0, threshold: 0.5, members: [['proposer', 1], ['seconder', 1], ['voterA', 1]] });
  const motionId = await mkBallotingMotion(topicId, body.body_id);
  await castVote({ motion_id: motionId, actor_id: 'voterA', choice: 'for' });
  await expireMotion(motionId);
  const first = await tallyMotion({ motion_id: motionId });
  assert.equal(first.status, 'carried');
  const second = await tallyMotion({ motion_id: motionId });
  assert.equal(second.status, 'not_balloting', 'a tallied motion cannot be re-tallied');
});

test('T8: tallyMotion unknown motion → not_found', async () => {
  const res = await tallyMotion({ motion_id: '00000000-0000-0000-0000-000000000000' });
  assert.equal(res.status, 'not_found');
});

test('T8: weight-snapshot — editing a member’s weight after they vote does not re-weight the cast ballot', async () => {
  const { topicId } = await mkTopic();
  const body = await mkBody({ quorum: 0, threshold: 0.6, members: [['proposer', 1], ['seconder', 1], ['voterA', 7], ['voterB', 3]] });
  const motionId = await mkBallotingMotion(topicId, body.body_id);
  await castVote({ motion_id: motionId, actor_id: 'voterA', choice: 'for' });    // snapshot weight 7
  await castVote({ motion_id: motionId, actor_id: 'voterB', choice: 'against' }); // snapshot weight 3

  // After voting, slash voterA's weight to 1 — must NOT affect the already-cast ballot
  await addBodyMember({ body_id: body.body_id, actor_id: 'voterA', vote_weight: 1 });

  await expireMotion(motionId);
  const res = await tallyMotion({ motion_id: motionId });
  // cast-time weights: for=7, against=3, base=10 → 7 >= 6 → carried
  assert.equal(res.status, 'carried');
  if (res.status !== 'carried') throw new Error('expected carried');
  assert.equal(Number(res.tally.for), 7, 'tally uses the cast-time weight, not the edited weight');
});

test('T8: tallyMotion counts a proxy-cast ballot at the principal weight (REVIEW-CODE LOW-5)', async () => {
  const { topicId } = await mkTopic();
  // voterA (weight 6) votes directly; voterB (weight 4) votes by proxy via 'seconder'.
  const body = await mkBody({
    quorum: 0, threshold: 0.5,
    members: [['proposer', 1], ['seconder', 1], ['voterA', 6], ['voterB', 4]],
  });
  const motionId = await mkBallotingMotion(topicId, body.body_id);
  await castVote({ motion_id: motionId, actor_id: 'voterA', choice: 'for' });
  await castVote({ motion_id: motionId, actor_id: 'voterB', choice: 'for', proxy_for: 'seconder' });
  await expireMotion(motionId);
  const res = await tallyMotion({ motion_id: motionId });
  // both ballots count — the proxy-cast row is NOT excluded from §4; for = 6 + 4 = 10
  assert.equal(res.status, 'carried');
  if (res.status !== 'carried') throw new Error('expected carried');
  assert.equal(Number(res.tally.for), 10, 'the proxy-cast ballot is counted at the principal weight');
  assert.equal(Number(res.tally.participating), 10, 'the proxy ballot counts toward participation');
});

// ════════════════════════════════════════════════════════════════════════════
// T9 — vetoMotion
// ════════════════════════════════════════════════════════════════════════════

test('T9: vetoMotion by a veto holder while balloting → vetoed + motion.vetoed', async () => {
  const { topicId } = await mkTopic(['proposer', 'seconder', 'voterA', 'governor']);
  const body = await mkBody({
    veto_holders: ['governor'],
    members: [['proposer', 1], ['seconder', 1], ['voterA', 1]],
  });
  const motionId = await mkBallotingMotion(topicId, body.body_id);
  const res = await vetoMotion({ motion_id: motionId, actor_id: 'governor' });
  assert.equal(res.status, 'vetoed');

  const pool = getDbPool();
  const m = await pool.query<{ status: string }>(
    `SELECT status FROM motions WHERE motion_id=$1`, [motionId],
  );
  assert.equal(m.rows[0].status, 'vetoed');

  const ev = await replayEvents({ topic_id: topicId });
  const vetoEv = ev.events.find((e) => e.type === 'motion.vetoed');
  assert.ok(vetoEv, 'motion.vetoed emitted');
  assert.equal(vetoEv!.payload.vetoed_by, 'governor');
});

test('T9: vetoMotion by a veto holder who is NOT a body member → vetoed (D8)', async () => {
  // a golden-share holder may hold veto without an ordinary ballot
  const { topicId } = await mkTopic(['proposer', 'seconder', 'voterA', 'goldenshare']);
  const body = await mkBody({
    veto_holders: ['goldenshare'],
    members: [['proposer', 1], ['seconder', 1], ['voterA', 1]], // goldenshare is NOT a member
  });
  const motionId = await mkBallotingMotion(topicId, body.body_id);
  const res = await vetoMotion({ motion_id: motionId, actor_id: 'goldenshare' });
  assert.equal(res.status, 'vetoed', 'veto holder need not be a body member');
});

test('T9: vetoMotion by a non-holder → not_veto_holder', async () => {
  const { topicId } = await mkTopic();
  const body = await mkBody({ veto_holders: ['governor'], members: [['proposer', 1], ['seconder', 1], ['voterA', 1]] });
  const motionId = await mkBallotingMotion(topicId, body.body_id);
  const res = await vetoMotion({ motion_id: motionId, actor_id: 'voterA' });
  assert.equal(res.status, 'not_veto_holder');
});

test('T9: vetoMotion on a non-balloting motion → not_balloting', async () => {
  const { topicId } = await mkTopic(['proposer', 'seconder', 'governor']);
  const body = await mkBody({ veto_holders: ['governor'], members: [['proposer', 1]] });
  // motion stays 'proposed'
  const p = await proposeMotion({
    topic_id: topicId, body_id: body.body_id, subject_ref: 'x', proposed_by: 'proposer',
  });
  if (p.status !== 'proposed') throw new Error('setup failed');
  const res = await vetoMotion({ motion_id: p.motion_id, actor_id: 'governor' });
  assert.equal(res.status, 'not_balloting', 'D6 — veto only during balloting');
});

test('T9: vetoMotion unknown motion → not_found', async () => {
  const res = await vetoMotion({ motion_id: '00000000-0000-0000-0000-000000000000', actor_id: 'governor' });
  assert.equal(res.status, 'not_found');
});

test('T9: mutual exclusion — a vetoed motion then tallyMotion → not_balloting', async () => {
  const { topicId } = await mkTopic(['proposer', 'seconder', 'voterA', 'governor']);
  const body = await mkBody({ veto_holders: ['governor'], members: [['proposer', 1], ['seconder', 1], ['voterA', 1]] });
  const motionId = await mkBallotingMotion(topicId, body.body_id);
  const veto = await vetoMotion({ motion_id: motionId, actor_id: 'governor' });
  assert.equal(veto.status, 'vetoed');
  await expireMotion(motionId);
  const tally = await tallyMotion({ motion_id: motionId });
  assert.equal(tally.status, 'not_balloting', 'a vetoed motion cannot be tallied');
});

test('T9: mutual exclusion — a tallied (carried/failed) motion then vetoMotion → not_balloting', async () => {
  const { topicId } = await mkTopic(['proposer', 'seconder', 'voterA', 'governor']);
  const body = await mkBody({ quorum: 0, threshold: 0.5, veto_holders: ['governor'], members: [['proposer', 1], ['seconder', 1], ['voterA', 1]] });
  const motionId = await mkBallotingMotion(topicId, body.body_id);
  await castVote({ motion_id: motionId, actor_id: 'voterA', choice: 'for' });
  await expireMotion(motionId);
  const tally = await tallyMotion({ motion_id: motionId });
  assert.equal(tally.status, 'carried');
  const veto = await vetoMotion({ motion_id: motionId, actor_id: 'governor' });
  assert.equal(veto.status, 'not_balloting', 'a tallied motion cannot be vetoed');
});

test('T9: vetoMotion — a whitespace-padded veto_holders entry still matches a trimmed actor_id (review-impl MED-1)', async () => {
  const { topicId } = await mkTopic(['proposer', 'seconder', 'voterA', 'governor']);
  // the body is created with a whitespace-padded veto holder — createBody must
  // trim it so it matches the trimmed actor_id vetoMotion compares against.
  const body = await mkBody({
    veto_holders: ['  governor  '],
    members: [['proposer', 1], ['seconder', 1], ['voterA', 1]],
  });
  const motionId = await mkBallotingMotion(topicId, body.body_id);
  const res = await vetoMotion({ motion_id: motionId, actor_id: 'governor' });
  assert.equal(res.status, 'vetoed', 'a whitespace-configured veto holder can still veto');
});

// ════════════════════════════════════════════════════════════════════════════
// T10 — getMotion / listMotions
// ════════════════════════════════════════════════════════════════════════════

test('T10: getMotion returns the motion + its votes', async () => {
  const { topicId } = await mkTopic();
  const body = await mkBody({ members: [['proposer', 1], ['seconder', 1], ['voterA', 2]] });
  const motionId = await mkBallotingMotion(topicId, body.body_id);
  await castVote({ motion_id: motionId, actor_id: 'voterA', choice: 'for' });

  const m = await getMotion({ motion_id: motionId });
  assert.ok(m, 'motion found');
  assert.equal(m!.motion_id, motionId);
  assert.equal(m!.status, 'balloting');
  assert.equal(m!.votes.length, 1);
  assert.equal(m!.votes[0].actor_id, 'voterA');
  assert.equal(m!.votes[0].choice, 'for');
});

test('T10: getMotion unknown id → null', async () => {
  const m = await getMotion({ motion_id: '00000000-0000-0000-0000-000000000000' });
  assert.equal(m, null);
});

test('T10: listMotions unknown topic → NOT_FOUND', async () => {
  await assert.rejects(
    () => listMotions({ topic_id: 'no-such-topic' }),
    (err: any) => { assert.equal(err.code, 'NOT_FOUND'); return true; },
  );
});

test('T10: listMotions returns the topic’s motions, status filter narrows', async () => {
  const { topicId } = await mkTopic();
  const body = await mkBody({ members: [['proposer', 1], ['seconder', 1], ['voterA', 1]] });
  // one balloting motion
  await mkBallotingMotion(topicId, body.body_id);
  // one proposed motion
  const p2 = await proposeMotion({
    topic_id: topicId, body_id: body.body_id, subject_ref: 'ref-2', proposed_by: 'proposer',
  });
  if (p2.status !== 'proposed') throw new Error('setup failed');

  const all = await listMotions({ topic_id: topicId });
  assert.equal(all.motions.length, 2);

  const balloting = await listMotions({ topic_id: topicId, status: 'balloting' });
  assert.equal(balloting.motions.length, 1);
  assert.equal(balloting.motions[0].status, 'balloting');

  const proposed = await listMotions({ topic_id: topicId, status: 'proposed' });
  assert.equal(proposed.motions.length, 1);
  assert.equal(proposed.motions[0].status, 'proposed');

  const carried = await listMotions({ topic_id: topicId, status: 'carried' });
  assert.equal(carried.motions.length, 0);
});

test('T10: listMotions empty topic → empty list (not 404)', async () => {
  const { topicId } = await mkTopic();
  const res = await listMotions({ topic_id: topicId });
  assert.deepEqual(res.motions, []);
});

test('T10: getMotion on a tallied motion returns the populated tally (review-impl COSMETIC-4)', async () => {
  const { topicId } = await mkTopic();
  const body = await mkBody({ quorum: 0, threshold: 0.5, members: [['proposer', 1], ['seconder', 1], ['voterA', 3]] });
  const motionId = await mkBallotingMotion(topicId, body.body_id);
  await castVote({ motion_id: motionId, actor_id: 'voterA', choice: 'for' });
  await expireMotion(motionId);
  const t = await tallyMotion({ motion_id: motionId });
  assert.equal(t.status, 'carried');

  const m = await getMotion({ motion_id: motionId });
  assert.ok(m, 'motion found');
  assert.equal(m!.status, 'carried');
  assert.ok(m!.tally, 'tally is populated after a tally');
  assert.equal(Number(m!.tally!.for), 3, 'getMotion round-trips the tally JSONB column');
});

// ── Sprint 15.7 — primitive-outcome chaining tests (DEFERRED-019) ──────────

test('15.7 AC2: tallyMotion carried → chain emits task.posted + motion.tallied.chain.kind=posted', async () => {
  const { topicId } = await mkTopic();
  const body = await mkBody({
    quorum: 0,
    threshold: 0.5,
    members: [['voterA', 1], ['voterB', 1], ['seconder', 1]],
  });
  const motionId = await mkBallotingMotion(topicId, body.body_id);
  await castVote({ motion_id: motionId, actor_id: 'voterA', choice: 'for' });
  await castVote({ motion_id: motionId, actor_id: 'voterB', choice: 'for' });
  await expireMotion(motionId);

  const t = await tallyMotion({ motion_id: motionId });
  assert.equal(t.status, 'carried');
  if (t.status !== 'carried') throw new Error('expected carried');
  assert.ok(t.chain, 'chain present on carried');
  assert.equal(t.chain!.kind, 'posted');
  if (t.chain!.kind !== 'posted') throw new Error('chain not posted');

  const pool = getDbPool();
  const taskRow = await pool.query(`SELECT title, raci FROM tasks WHERE task_id=$1`, [t.chain!.task_id]);
  assert.equal(taskRow.rows[0].title, 'Execute carried motion: ref-1');
  assert.equal(taskRow.rows[0].raci.source_motion, motionId);

  // motion.tallied event payload
  const ev = await replayEvents({ topic_id: topicId });
  const tallied = ev.events.find((e) => e.type === 'motion.tallied');
  assert.ok(tallied);
  assert.equal((tallied!.payload as { chain?: { kind: string } }).chain?.kind, 'posted');
});

test('15.7 AC4: tallyMotion carried with execution_task blob → chained task uses blob', async () => {
  const { topicId } = await mkTopic();
  const body = await mkBody({ quorum: 0, threshold: 0.5, members: [['voterA', 1], ['seconder', 1]] });
  const p = await proposeMotion({
    topic_id: topicId,
    body_id: body.body_id,
    subject_ref: 'topic-ref',
    proposed_by: 'proposer',
    execution_task: { title: 'Motion exec title', slot: 'mexec' },
  });
  assert.equal(p.status, 'proposed');
  if (p.status !== 'proposed') throw new Error('propose failed');
  await secondMotion({ motion_id: p.motion_id, actor_id: 'seconder' });
  await castVote({ motion_id: p.motion_id, actor_id: 'voterA', choice: 'for' });
  await expireMotion(p.motion_id);
  const t = await tallyMotion({ motion_id: p.motion_id });
  assert.equal(t.status, 'carried');
  if (t.status !== 'carried' || t.chain?.kind !== 'posted') throw new Error('expected carried+posted');

  const pool = getDbPool();
  const taskRow = await pool.query(`SELECT title FROM tasks WHERE task_id=$1`, [t.chain.task_id]);
  assert.equal(taskRow.rows[0].title, 'Motion exec title');
});

test('15.7 AC5/AC6: tallyMotion failed/lapsed/vetoed → no chain field', async () => {
  const { topicId } = await mkTopic();
  // threshold=0.99 (impossible to carry with 1 against vote)
  const body = await mkBody({ quorum: 0, threshold: 0.99, members: [['voterA', 1], ['seconder', 1]] });
  const motionId = await mkBallotingMotion(topicId, body.body_id);
  await castVote({ motion_id: motionId, actor_id: 'voterA', choice: 'against' });
  await expireMotion(motionId);
  const t = await tallyMotion({ motion_id: motionId });
  assert.equal(t.status, 'failed');
  if (t.status !== 'failed') throw new Error('expected failed');
  // @ts-expect-error — chain is optional, absent on failed
  assert.equal(t.chain, undefined, 'no chain on failed');

  const pool = getDbPool();
  const tasks = await pool.query(`SELECT task_id FROM tasks WHERE topic_id=$1`, [topicId]);
  assert.equal(tasks.rows.length, 0, 'no chained task on failed');
});

test('15.7 AC7: tallyMotion on closing topic → chain deferred', async () => {
  const { topicId } = await mkTopic();
  const body = await mkBody({ quorum: 0, threshold: 0.5, members: [['voterA', 1], ['seconder', 1]] });
  const motionId = await mkBallotingMotion(topicId, body.body_id);
  await castVote({ motion_id: motionId, actor_id: 'voterA', choice: 'for' });
  await expireMotion(motionId);

  // 15.6 test isolation pattern — direct UPDATE to 'closing'
  const pool = getDbPool();
  await pool.query(`UPDATE topics SET status='closing' WHERE topic_id=$1`, [topicId]);

  const t = await tallyMotion({ motion_id: motionId });
  // tallyMotion's existing topic_closed check rejects 'closed' only — so on 'closing' it
  // proceeds, and chain handler defers.
  assert.equal(t.status, 'carried');
  if (t.status !== 'carried' || t.chain?.kind !== 'deferred') {
    throw new Error('expected carried+deferred');
  }
  assert.equal(t.chain.reason, 'topic_closing');

  const tasks = await pool.query(`SELECT task_id FROM tasks WHERE topic_id=$1`, [topicId]);
  assert.equal(tasks.rows.length, 0, 'no chained task on closing');

  const ev = await replayEvents({ topic_id: topicId });
  const deferred = ev.events.find((e) => e.type === 'task.deferred');
  assert.ok(deferred);
  assert.equal(deferred!.subject_type, 'topic');
});

// ── Sprint 15.8 — collective request-step wiring (DEFERRED-018) ──────────

/**
 * Integration: full collective request flow via tallyMotion (not direct
 * applyMotionToStep). Verifies the motions.ts T7 wire-up routes outcomes to
 * applyMotionToStep correctly.
 */
test('15.8 motions.T7: tallyMotion on a motion linked to a request step → step endorsed', async () => {
  const { submitRequest } = await import('./requests.js');
  const { charterTopic: ct, joinTopic: jt } = await import('./topics.js');
  const { postTask, claimTask, completeTask } = await import('./board.js');

  // Setup topic + actors
  const t = await ct({ project_id: TEST_PROJECT, name: '15.8 m-int', charter: 'c', created_by: 'authority' });
  for (const [a, level] of [
    ['execution', 'execution'], ['authority', 'authority'],
  ] as const) {
    await jt({ topic_id: t.topic_id, actor_id: a, actor_type: 'human', display_name: a, level });
  }
  // Body + members
  const body = await createBody({ project_id: TEST_PROJECT, name: 'B', quorum: 0, threshold: 0.5, veto_holders: [], created_by: 'authority' });
  await addBodyMember({ body_id: body.body_id, actor_id: 'voter-a', vote_weight: 1 });
  await addBodyMember({ body_id: body.body_id, actor_id: 'seconder', vote_weight: 1 });
  // Collective matrix row
  const pool = getDbPool();
  await pool.query(
    `INSERT INTO doa_matrix (project_id, topic_id, kind, weight_min, weight_max, required_level, route_shape, procedure, body_id)
     VALUES ($1, NULL, 'm_int', 0, 49, 'authority', 'escalate_to_authority', 'collective', $2)`,
    [TEST_PROJECT, body.body_id],
  );

  // Bring an artifact to for_review
  const task = await postTask({ topic_id: t.topic_id, title: 'T', topology: 'parallel', slot: 'doc-mint', kind: 'doc', created_by: 'execution' });
  await claimTask({ task_id: task.task_id, actor_id: 'execution' });
  await completeTask({ task_id: task.task_id, actor_id: 'execution' });

  // Submit collective request — system auto-proposes motion
  const submit = await submitRequest({
    topic_id: t.topic_id, subject_type: 'artifact', subject_id: task.artifact_id,
    kind: 'm_int', weight: 10, procedure: 'unilateral', submitted_by: 'execution',
  });
  if (submit.status !== 'submitted') throw new Error('submit');

  // Find motion + second + vote + expire + tally
  const step = await pool.query<{ motion_id: string }>(
    `SELECT motion_id FROM request_steps WHERE request_id=$1 AND step_index=0`,
    [submit.request_id],
  );
  const motionId = step.rows[0].motion_id;
  await secondMotion({ motion_id: motionId, actor_id: 'seconder' });
  await castVote({ motion_id: motionId, actor_id: 'voter-a', choice: 'for' });
  await pool.query(`UPDATE motions SET deadline = now() - interval '10 minutes' WHERE motion_id=$1`, [motionId]);

  const t1 = await tallyMotion({ motion_id: motionId });
  assert.equal(t1.status, 'carried');

  // Step + request advanced (via applyMotionToStep called from tallyMotion)
  const after = await pool.query<{ status: string }>(
    `SELECT status FROM requests WHERE request_id=$1`, [submit.request_id],
  );
  assert.equal(after.rows[0].status, 'approved', 'request approved via collective tally');
  const stepAfter = await pool.query<{ status: string }>(
    `SELECT status FROM request_steps WHERE request_id=$1 AND step_index=0`,
    [submit.request_id],
  );
  assert.equal(stepAfter.rows[0].status, 'endorsed');
  // 15.7 chain fired
  const chainedTasks = await pool.query(
    `SELECT title FROM tasks WHERE topic_id=$1 AND title LIKE 'Execute approved%'`,
    [t.topic_id],
  );
  assert.equal(chainedTasks.rows.length, 1);

  // Cleanup motions test artifacts (the 15.7 chain + collective tests left request_steps with motion_id which the cleanup needs to clear).
  // The motions.test.ts cleanup doesn't handle requests/request_steps — handled inline.
  await pool.query(`UPDATE request_steps SET motion_id=NULL WHERE request_id=$1`, [submit.request_id]);
  await pool.query(`DELETE FROM request_steps WHERE request_id=$1`, [submit.request_id]);
  await pool.query(`DELETE FROM requests WHERE request_id=$1`, [submit.request_id]);
  await pool.query(`DELETE FROM doa_matrix WHERE project_id=$1`, [TEST_PROJECT]);
});

test('15.8 motions.T7-vetoed: vetoMotion on a motion linked to a request step → step rejected', async () => {
  const { submitRequest } = await import('./requests.js');
  const { charterTopic: ct, joinTopic: jt } = await import('./topics.js');
  const { postTask, claimTask, completeTask } = await import('./board.js');

  const t = await ct({ project_id: TEST_PROJECT, name: '15.8 m-veto', charter: 'c', created_by: 'authority' });
  for (const a of ['execution', 'authority', 'veto-holder']) {
    await jt({ topic_id: t.topic_id, actor_id: a, actor_type: 'human', display_name: a, level: 'coordination' });
  }
  const body = await createBody({
    project_id: TEST_PROJECT, name: 'B-veto', quorum: 0, threshold: 0.5,
    veto_holders: ['veto-holder'], created_by: 'authority',
  });
  await addBodyMember({ body_id: body.body_id, actor_id: 'voter-a', vote_weight: 1 });
  await addBodyMember({ body_id: body.body_id, actor_id: 'veto-holder', vote_weight: 1 });
  await addBodyMember({ body_id: body.body_id, actor_id: 'seconder', vote_weight: 1 });

  const pool = getDbPool();
  await pool.query(
    `INSERT INTO doa_matrix (project_id, topic_id, kind, weight_min, weight_max, required_level, route_shape, procedure, body_id)
     VALUES ($1, NULL, 'm_veto', 0, 49, 'authority', 'escalate_to_authority', 'collective', $2)`,
    [TEST_PROJECT, body.body_id],
  );

  const task = await postTask({ topic_id: t.topic_id, title: 'T', topology: 'parallel', slot: 'doc-mveto', kind: 'doc', created_by: 'execution' });
  await claimTask({ task_id: task.task_id, actor_id: 'execution' });
  await completeTask({ task_id: task.task_id, actor_id: 'execution' });

  const submit = await submitRequest({
    topic_id: t.topic_id, subject_type: 'artifact', subject_id: task.artifact_id,
    kind: 'm_veto', weight: 10, procedure: 'unilateral', submitted_by: 'execution',
  });
  if (submit.status !== 'submitted') throw new Error('submit');

  const step = await pool.query<{ motion_id: string }>(
    `SELECT motion_id FROM request_steps WHERE request_id=$1 AND step_index=0`,
    [submit.request_id],
  );
  const motionId = step.rows[0].motion_id;

  // Bring motion to balloting (second it) so veto is valid
  await secondMotion({ motion_id: motionId, actor_id: 'seconder' });

  // Veto
  const v = await vetoMotion({ motion_id: motionId, actor_id: 'veto-holder' });
  assert.equal(v.status, 'vetoed');

  // Step + request rejected
  const after = await pool.query<{ status: string }>(
    `SELECT status FROM requests WHERE request_id=$1`, [submit.request_id],
  );
  assert.equal(after.rows[0].status, 'rejected', 'request rejected via veto');

  // Cleanup
  await pool.query(`UPDATE request_steps SET motion_id=NULL WHERE request_id=$1`, [submit.request_id]);
  await pool.query(`DELETE FROM request_steps WHERE request_id=$1`, [submit.request_id]);
  await pool.query(`DELETE FROM requests WHERE request_id=$1`, [submit.request_id]);
  await pool.query(`DELETE FROM doa_matrix WHERE project_id=$1`, [TEST_PROJECT]);
});
