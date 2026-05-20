/**
 * Phase 15 Sprint 15.4 — The motion lifecycle.
 *
 * Design ref: docs/specs/2026-05-18-phase-15-sprint-15.4-design.md §3, §4
 * Spec hash:  a12f419578588e6d
 *
 * A `motion` is a topic-scoped AND body-scoped proposition put to a decision
 * body. Its lifecycle: propose → second (→ balloting) → vote* → tally|veto. All
 * five operations emit `coordination_events` on the motion's `topic_id` (D3).
 *
 * §0.1 Transaction & connection contract — verbatim the Phase 13 / 15.1 / 15.2 /
 * 15.3 pattern: every transactional fn does
 *   `const c = await pool.connect(); try { BEGIN … COMMIT } catch (e) {
 *    await c.query('ROLLBACK').catch(()=>{}); logger.error(...); throw e }
 *    finally { c.release() }`
 * with an explicit ROLLBACK before every early return.
 *
 * §0.2 Canonical lock order — `… → motion → vote → topics`. Every motion txn
 * locks `motion` (FOR UPDATE) before `appendEvent` touches `topics`.
 *
 * Window model (BLOCK-1, §3.5):
 *   castVote   = status='balloting' ∧ now() <  deadline
 *   vetoMotion = status='balloting'              (the whole live window)
 *   tallyMotion/sweep = status='balloting' ∧ now() >= deadline
 * A ballot is tallied ONLY post-deadline — no early-tally forgery.
 */

import type { PoolClient } from 'pg';
import { getDbPool } from '../db/client.js';
import { ContextHubError } from '../core/errors.js';
import { createModuleLogger } from '../utils/logger.js';
import { appendEvent } from './coordinationEvents.js';
import {
  validateExecutionTask,
  buildChainedTaskParams,
  emitChain,
  type ChainResult,
  type ExecutionTaskBlob,
} from './chaining.js';

const logger = createModuleLogger('motions');

// ── Constants ─────────────────────────────────────────────────────────────────

export const MOTION_DEADLINE_DEFAULT_MINUTES = 1440; // 24 h
export const MOTION_DEADLINE_MIN_MINUTES = 5;
export const MOTION_DEADLINE_MAX_MINUTES = 43200;    // 30 d

const MAX_FIELD_LEN = 256;

// ── Types ─────────────────────────────────────────────────────────────────────

export type MotionVoteChoice = 'for' | 'against' | 'abstain';

export type MotionTally = {
  for: number;
  against: number;
  abstain: number;
  participating: number;
  base: number;
  quorum: number;
  threshold: number;
  quorum_met: boolean;
};

export type MotionVote = {
  actor_id: string;
  choice: string;
  weight: number;
  proxy_for: string | null;
  cast_at: string;
};

export type MotionRecord = {
  motion_id: string;
  body_id: string;
  topic_id: string;
  subject_ref: string;
  status: string;
  proposed_by: string;
  seconded_by: string | null;
  deadline: string;
  tally: MotionTally | null;
  created_at: string;
  votes: MotionVote[];
};

export type ProposeResult =
  | { status: 'proposed'; motion_id: string; deadline: string }
  | { status: 'topic_closed' }
  | { status: 'body_not_found' }
  | { status: 'not_participant' };

export type SecondResult =
  | { status: 'seconded'; motion_status: 'balloting' }
  | { status: 'not_found' }
  | { status: 'conflict' }
  | { status: 'topic_closed' }
  | { status: 'self_second_forbidden' }
  | { status: 'not_member' };

export type VoteResult =
  | { status: 'vote_recorded' }
  | { status: 'not_found' }
  | { status: 'not_balloting' }
  | { status: 'balloting_closed' }
  | { status: 'topic_closed' }
  | { status: 'not_member' }
  | { status: 'already_voted' };

export type VetoResult =
  | { status: 'vetoed' }
  | { status: 'not_found' }
  | { status: 'not_balloting' }
  | { status: 'topic_closed' }
  | { status: 'not_veto_holder' };

export type TallyOutcome = 'carried' | 'failed' | 'lapsed';

export type TallyResult =
  | { status: TallyOutcome; tally: MotionTally; chain?: ChainResult }
  | { status: 'not_found' }
  | { status: 'not_balloting' }
  | { status: 'balloting_open' }
  | { status: 'topic_closed' };

export type ListMotionsResult = { motions: MotionRecord[] };

// ── §4 — the tally algorithm (exact, computed in Postgres NUMERIC) ─────────────

/**
 * The §4 aggregate-and-decide query. ALL arithmetic is Postgres exact NUMERIC —
 * never JavaScript float (no `==` drift at a 2/3 boundary). `carried` is the
 * inclusive-threshold rule `for >= threshold·base` with a `base>0` guard so
 * an all-abstain ballot (base 0) yields `carried=false` with no divide.
 *
 * Returns the raw aggregate row; `decideOutcome` maps the booleans → an outcome.
 * Runs on the caller's transaction client (the `motion … FOR UPDATE` lock the
 * caller already holds serializes `castVote`, so the SELECT sees a stable set).
 */
async function aggregateVotes(
  client: PoolClient,
  motionId: string,
  quorum: number,
  threshold: number,
): Promise<{
  f: number; a: number; ab: number;
  participating: number; base: number;
  quorum_met: boolean; carried: boolean;
}> {
  const res = await client.query<{
    f: string; a: string; ab: string;
    participating: string; base: string;
    quorum_met: boolean; carried: boolean;
  }>(
    `WITH agg AS (
       SELECT
         COALESCE(SUM(weight) FILTER (WHERE choice = 'for'),     0) AS f,
         COALESCE(SUM(weight) FILTER (WHERE choice = 'against'), 0) AS a,
         COALESCE(SUM(weight) FILTER (WHERE choice = 'abstain'), 0) AS ab
       FROM votes WHERE motion_id = $1
     )
     SELECT f, a, ab,
            (f + a + ab)               AS participating,
            (f + a)                    AS base,
            ((f + a + ab) >= $2)       AS quorum_met,
            ((f + a) > 0 AND f >= $3 * (f + a)) AS carried
       FROM agg`,
    [motionId, quorum, threshold],
  );
  const row = res.rows[0];
  return {
    f: Number(row.f),
    a: Number(row.a),
    ab: Number(row.ab),
    participating: Number(row.participating),
    base: Number(row.base),
    quorum_met: row.quorum_met,
    carried: row.carried,
  };
}

/**
 * Run the §4 tally for a motion and map it to (outcome, tally_json). Exported so
 * the sweep (`sweepExpiredMotions`) can tally a `balloting` motion under the same
 * exact-NUMERIC algorithm — the caller must already hold the `motion … FOR UPDATE`
 * lock (which serializes `castVote`). The single source of truth for §4.
 */
export async function computeMotionTally(
  client: PoolClient,
  motionId: string,
  quorum: number,
  threshold: number,
): Promise<{ outcome: TallyOutcome; tally: MotionTally }> {
  const agg = await aggregateVotes(client, motionId, quorum, threshold);
  return decideOutcome(agg, quorum, threshold);
}

/**
 * Map the §4 aggregate booleans → (outcome, tally_json). The outcome table (§4):
 *   quorum_met=false                → lapsed (turnout too low)
 *   quorum_met=true, carried=true   → carried
 *   quorum_met=true, carried=false  → failed (threshold unmet or base 0)
 */
function decideOutcome(
  agg: { f: number; a: number; ab: number; participating: number; base: number; quorum_met: boolean; carried: boolean },
  quorum: number,
  threshold: number,
): { outcome: TallyOutcome; tally: MotionTally } {
  const tally: MotionTally = {
    for: agg.f,
    against: agg.a,
    abstain: agg.ab,
    participating: agg.participating,
    base: agg.base,
    quorum,
    threshold,
    quorum_met: agg.quorum_met,
  };
  let outcome: TallyOutcome;
  if (!agg.quorum_met) {
    outcome = 'lapsed';
  } else if (agg.carried) {
    outcome = 'carried';
  } else {
    outcome = 'failed';
  }
  return { outcome, tally };
}

// ── §3.1 proposeMotion ─────────────────────────────────────────────────────────

/**
 * Propose a motion. Validates input, plain-reads the topic + body + participant
 * (pre-BEGIN, no lock), then INSERTs the motion row + emits `motion.proposed`.
 *
 * Lock order: `topics` only (the INSERT is a fresh row; the pre-checks are
 * unlocked reads). A cross-project body → `body_not_found` (one status for
 * "missing" and "in another project" — the 15.3.1 F3a id-probing defense).
 */
export async function proposeMotion(params: {
  topic_id: string;
  body_id: string;
  subject_ref: string;
  proposed_by: string;
  deadline_minutes?: number;
  /** Sprint 15.7 — optional execution_task blob for chain handler on carried. */
  execution_task?: unknown;
}): Promise<ProposeResult> {
  const topicId = (params.topic_id ?? '').trim();
  const bodyId = (params.body_id ?? '').trim();
  const subjectRef = (params.subject_ref ?? '').trim();
  const proposedBy = (params.proposed_by ?? '').trim();
  const executionTask = validateExecutionTask(params.execution_task);

  if (!topicId || !bodyId || !subjectRef || !proposedBy) {
    throw new ContextHubError(
      'BAD_REQUEST',
      'topic_id, body_id, subject_ref, proposed_by are all required',
    );
  }
  if (subjectRef.length > MAX_FIELD_LEN) {
    throw new ContextHubError('BAD_REQUEST', `subject_ref must be at most ${MAX_FIELD_LEN} characters`);
  }

  let deadlineMinutes = MOTION_DEADLINE_DEFAULT_MINUTES;
  if (params.deadline_minutes !== undefined && params.deadline_minutes !== null) {
    const dm = params.deadline_minutes;
    if (
      !Number.isInteger(dm) ||
      dm < MOTION_DEADLINE_MIN_MINUTES ||
      dm > MOTION_DEADLINE_MAX_MINUTES
    ) {
      throw new ContextHubError(
        'BAD_REQUEST',
        `deadline_minutes must be an integer in [${MOTION_DEADLINE_MIN_MINUTES}, ${MOTION_DEADLINE_MAX_MINUTES}]`,
      );
    }
    deadlineMinutes = dm;
  }

  const pool = getDbPool();

  // ── Pre-BEGIN plain reads (no lock) ─────────────────────────────────────────
  const topicRes = await pool.query<{ project_id: string; status: string }>(
    `SELECT project_id, status FROM topics WHERE topic_id=$1`,
    [topicId],
  );
  if (topicRes.rowCount === 0) {
    throw new ContextHubError('NOT_FOUND', `topic ${topicId} not found`);
  }
  const { project_id: topicProjectId, status: topicStatus } = topicRes.rows[0];
  if (topicStatus === 'closed' || topicStatus === 'closing') {
    return { status: 'topic_closed' };
  }

  // The body must exist AND belong to the topic's project (cross-project rejected;
  // one status for "missing" and "in another project" — 15.3.1 F3a id-probing defense).
  const bodyRes = await pool.query<{ project_id: string }>(
    `SELECT project_id FROM decision_bodies WHERE body_id=$1`,
    [bodyId],
  );
  if (bodyRes.rowCount === 0 || bodyRes.rows[0].project_id !== topicProjectId) {
    return { status: 'body_not_found' };
  }

  const participantRes = await pool.query<{ one: number }>(
    `SELECT 1 AS one FROM topic_participants WHERE topic_id=$1 AND actor_id=$2`,
    [topicId, proposedBy],
  );
  if (participantRes.rowCount === 0) {
    return { status: 'not_participant' };
  }

  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    const ins = await client.query<{ motion_id: string; deadline: Date }>(
      `INSERT INTO motions (body_id, topic_id, subject_ref, status, proposed_by, deadline, execution_task)
       VALUES ($1, $2, $3, 'proposed', $4, now() + ($5 * interval '1 minute'), $6)
       RETURNING motion_id, deadline`,
      [
        bodyId, topicId, subjectRef, proposedBy, deadlineMinutes,
        executionTask === null ? null : JSON.stringify(executionTask),
      ],
    );
    const motionId = ins.rows[0].motion_id;
    const deadline = ins.rows[0].deadline.toISOString();

    await appendEvent(client, {
      topic_id: topicId,
      actor_id: proposedBy,
      type: 'motion.proposed',
      subject_type: 'motion',
      subject_id: motionId,
      payload: { body_id: bodyId, subject_ref: subjectRef, deadline },
    });

    await client.query('COMMIT');
    return { status: 'proposed', motion_id: motionId, deadline };
  } catch (err) {
    await client.query('ROLLBACK').catch(() => {});
    logger.error({ err: String(err) }, 'proposeMotion failed');
    throw err;
  } finally {
    client.release();
  }
}

// ── §3.2 secondMotion ──────────────────────────────────────────────────────────

/**
 * Second a motion: `proposed → balloting` directly (D4). The seconder must be a
 * DISTINCT body member (not the proposer — Robert's Rules; D4).
 *
 * Lock order: `motion → topics`.
 */
export async function secondMotion(params: {
  motion_id: string;
  actor_id: string;
}): Promise<SecondResult> {
  const motionId = (params.motion_id ?? '').trim();
  const actorId = (params.actor_id ?? '').trim();
  if (!motionId || !actorId) {
    throw new ContextHubError('BAD_REQUEST', 'motion_id and actor_id are required');
  }

  const pool = getDbPool();
  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    // ── (motion) row lock ───────────────────────────────────────────────────
    const motionRes = await client.query<{
      body_id: string; topic_id: string; status: string; proposed_by: string;
    }>(
      `SELECT body_id, topic_id, status, proposed_by FROM motions WHERE motion_id=$1 FOR UPDATE`,
      [motionId],
    );
    if (motionRes.rowCount === 0) {
      await client.query('ROLLBACK');
      return { status: 'not_found' };
    }
    const motion = motionRes.rows[0];
    if (motion.status !== 'proposed') {
      await client.query('ROLLBACK');
      return { status: 'conflict' };
    }

    // closed-topic plain read (no lock — preserves lock order; appendEvent's
    // seal is the authoritative mid-transaction guard)
    const topicRes = await client.query<{ status: string }>(
      `SELECT status FROM topics WHERE topic_id=$1`,
      [motion.topic_id],
    );
    if (topicRes.rows[0]?.status === 'closed') {
      await client.query('ROLLBACK');
      return { status: 'topic_closed' };
    }

    if (actorId === motion.proposed_by) {
      await client.query('ROLLBACK');
      return { status: 'self_second_forbidden' };
    }

    const memberRes = await client.query<{ one: number }>(
      `SELECT 1 AS one FROM body_members WHERE body_id=$1 AND actor_id=$2`,
      [motion.body_id, actorId],
    );
    if (memberRes.rowCount === 0) {
      await client.query('ROLLBACK');
      return { status: 'not_member' };
    }

    await client.query(
      `UPDATE motions SET status='balloting', seconded_by=$1 WHERE motion_id=$2`,
      [actorId, motionId],
    );

    await appendEvent(client, {
      topic_id: motion.topic_id,
      actor_id: actorId,
      type: 'motion.seconded',
      subject_type: 'motion',
      subject_id: motionId,
      payload: { seconded_by: actorId },
    });

    await client.query('COMMIT');
    return { status: 'seconded', motion_status: 'balloting' };
  } catch (err) {
    await client.query('ROLLBACK').catch(() => {});
    logger.error({ err: String(err) }, 'secondMotion failed');
    throw err;
  } finally {
    client.release();
  }
}

// ── §3.3 castVote ──────────────────────────────────────────────────────────────

/**
 * Cast a ballot. `actor_id` is the PRINCIPAL. `votes.weight` snapshots the
 * principal's `body_members.vote_weight` at cast time (D7). A proxy ballot is
 * still the principal's row — `proxy_for` records the holder (audit-only,
 * unverified — CLARIFY Q8 / §0.5). `proxy_for == actor_id` → BAD_REQUEST.
 *
 * Lock order: `motion → vote → topics`.
 */
export async function castVote(params: {
  motion_id: string;
  actor_id: string;
  choice: MotionVoteChoice;
  proxy_for?: string;
}): Promise<VoteResult> {
  const motionId = (params.motion_id ?? '').trim();
  const actorId = (params.actor_id ?? '').trim();
  const choice = (params.choice ?? '') as string;
  const proxyForRaw = params.proxy_for !== undefined && params.proxy_for !== null
    ? String(params.proxy_for).trim()
    : '';

  if (!motionId || !actorId) {
    throw new ContextHubError('BAD_REQUEST', 'motion_id and actor_id are required');
  }
  if (!['for', 'against', 'abstain'].includes(choice)) {
    throw new ContextHubError('BAD_REQUEST', `choice must be one of: for, against, abstain`);
  }
  // A self-proxy is a direct vote — store proxy_for only when it differs.
  if (proxyForRaw && proxyForRaw === actorId) {
    throw new ContextHubError(
      'BAD_REQUEST',
      'proxy_for must differ from actor_id (a self-proxy is a direct vote)',
    );
  }
  const proxyFor = proxyForRaw || null;

  const pool = getDbPool();
  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    // ── (motion) row lock ───────────────────────────────────────────────────
    const motionRes = await client.query<{
      body_id: string; topic_id: string; status: string; deadline: Date;
    }>(
      `SELECT body_id, topic_id, status, deadline FROM motions WHERE motion_id=$1 FOR UPDATE`,
      [motionId],
    );
    if (motionRes.rowCount === 0) {
      await client.query('ROLLBACK');
      return { status: 'not_found' };
    }
    const motion = motionRes.rows[0];
    if (motion.status !== 'balloting') {
      await client.query('ROLLBACK');
      return { status: 'not_balloting' };
    }
    // same-txn deadline check (master C.2) — a vote is allowed only before deadline
    const nowRes = await client.query<{ closed: boolean }>(
      `SELECT (now() >= $1::timestamptz) AS closed`,
      [motion.deadline],
    );
    if (nowRes.rows[0].closed) {
      await client.query('ROLLBACK');
      return { status: 'balloting_closed' };
    }

    // closed-topic plain read
    const topicRes = await client.query<{ status: string }>(
      `SELECT status FROM topics WHERE topic_id=$1`,
      [motion.topic_id],
    );
    if (topicRes.rows[0]?.status === 'closed') {
      await client.query('ROLLBACK');
      return { status: 'topic_closed' };
    }

    // the PRINCIPAL must be a body member — capture their weight (D7 snapshot)
    const memberRes = await client.query<{ vote_weight: string }>(
      `SELECT vote_weight FROM body_members WHERE body_id=$1 AND actor_id=$2`,
      [motion.body_id, actorId],
    );
    if (memberRes.rowCount === 0) {
      await client.query('ROLLBACK');
      return { status: 'not_member' };
    }
    const voteWeight = memberRes.rows[0].vote_weight;

    // ── (vote) row insert — one immutable ballot per principal (Q12) ─────────
    const ins = await client.query(
      `INSERT INTO votes (motion_id, actor_id, choice, weight, proxy_for)
       VALUES ($1, $2, $3, $4, $5)
       ON CONFLICT (motion_id, actor_id) DO NOTHING`,
      [motionId, actorId, choice, voteWeight, proxyFor],
    );
    if ((ins.rowCount ?? 0) === 0) {
      await client.query('ROLLBACK');
      return { status: 'already_voted' };
    }

    await appendEvent(client, {
      topic_id: motion.topic_id,
      actor_id: proxyFor ?? actorId,
      type: 'vote.cast',
      subject_type: 'motion',
      subject_id: motionId,
      payload: { principal: actorId, choice, weight: Number(voteWeight), proxy_for: proxyFor },
    });

    await client.query('COMMIT');
    return { status: 'vote_recorded' };
  } catch (err) {
    await client.query('ROLLBACK').catch(() => {});
    logger.error({ err: String(err) }, 'castVote failed');
    throw err;
  } finally {
    client.release();
  }
}

// ── §3.4 vetoMotion ────────────────────────────────────────────────────────────

/**
 * Veto a motion. The actor must be in `decision_bodies.veto_holders`; a veto
 * holder need NOT be a body member (D8 — a golden-share holder). The veto window
 * is `balloting` only (D6). Veto / tally are mutually exclusive — both take
 * `motion … FOR UPDATE` first; the loser sees `status ≠ 'balloting'`.
 *
 * Lock order: `motion → topics`.
 */
export async function vetoMotion(params: {
  motion_id: string;
  actor_id: string;
}): Promise<VetoResult> {
  const motionId = (params.motion_id ?? '').trim();
  const actorId = (params.actor_id ?? '').trim();
  if (!motionId || !actorId) {
    throw new ContextHubError('BAD_REQUEST', 'motion_id and actor_id are required');
  }

  const pool = getDbPool();
  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    // ── (motion) row lock — serializes vs tally ─────────────────────────────
    const motionRes = await client.query<{
      body_id: string; topic_id: string; status: string;
    }>(
      `SELECT body_id, topic_id, status FROM motions WHERE motion_id=$1 FOR UPDATE`,
      [motionId],
    );
    if (motionRes.rowCount === 0) {
      await client.query('ROLLBACK');
      return { status: 'not_found' };
    }
    const motion = motionRes.rows[0];
    if (motion.status !== 'balloting') {
      await client.query('ROLLBACK');
      return { status: 'not_balloting' };
    }

    const topicRes = await client.query<{ status: string }>(
      `SELECT status FROM topics WHERE topic_id=$1`,
      [motion.topic_id],
    );
    if (topicRes.rows[0]?.status === 'closed') {
      await client.query('ROLLBACK');
      return { status: 'topic_closed' };
    }

    const bodyRes = await client.query<{ veto_holders: string[] }>(
      `SELECT veto_holders FROM decision_bodies WHERE body_id=$1`,
      [motion.body_id],
    );
    const vetoHolders = bodyRes.rows[0]?.veto_holders ?? [];
    if (!vetoHolders.includes(actorId)) {
      await client.query('ROLLBACK');
      return { status: 'not_veto_holder' };
    }

    await client.query(
      `UPDATE motions SET status='vetoed' WHERE motion_id=$1`,
      [motionId],
    );

    await appendEvent(client, {
      topic_id: motion.topic_id,
      actor_id: actorId,
      type: 'motion.vetoed',
      subject_type: 'motion',
      subject_id: motionId,
      payload: { vetoed_by: actorId },
    });

    await client.query('COMMIT');
    return { status: 'vetoed' };
  } catch (err) {
    await client.query('ROLLBACK').catch(() => {});
    logger.error({ err: String(err) }, 'vetoMotion failed');
    throw err;
  } finally {
    client.release();
  }
}

// ── §3.5 tallyMotion ───────────────────────────────────────────────────────────

/**
 * Tally a motion. Rejects `now() < deadline` → `balloting_open` (BLOCK-1 — a
 * ballot is tallied ONLY post-deadline; no early-tally forgery). Runs the §4
 * aggregate, maps the outcome, freezes `motions.tally`, emits `motion.tallied`.
 *
 * Lock order: `motion → topics` (the votes aggregate is unlocked — the
 * `motion … FOR UPDATE` lock already serializes `castVote`).
 */
export async function tallyMotion(params: { motion_id: string }): Promise<TallyResult> {
  const motionId = (params.motion_id ?? '').trim();
  if (!motionId) {
    throw new ContextHubError('BAD_REQUEST', 'motion_id is required');
  }

  const pool = getDbPool();
  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    // ── (motion) row lock ───────────────────────────────────────────────────
    // Sprint 15.7 — also select subject_ref + execution_task for chain handler.
    const motionRes = await client.query<{
      body_id: string; topic_id: string; status: string; expired: boolean;
      subject_ref: string; execution_task: ExecutionTaskBlob | null;
    }>(
      `SELECT body_id, topic_id, status, (now() >= deadline) AS expired,
              subject_ref, execution_task
         FROM motions WHERE motion_id=$1 FOR UPDATE`,
      [motionId],
    );
    if (motionRes.rowCount === 0) {
      await client.query('ROLLBACK');
      return { status: 'not_found' };
    }
    const motion = motionRes.rows[0];
    if (motion.status !== 'balloting') {
      await client.query('ROLLBACK');
      return { status: 'not_balloting' };
    }
    // BLOCK-1 — a ballot is tallied only post-deadline
    if (!motion.expired) {
      await client.query('ROLLBACK');
      return { status: 'balloting_open' };
    }

    const topicRes = await client.query<{ status: string }>(
      `SELECT status FROM topics WHERE topic_id=$1`,
      [motion.topic_id],
    );
    if (topicRes.rows[0]?.status === 'closed') {
      await client.query('ROLLBACK');
      return { status: 'topic_closed' };
    }

    const bodyRes = await client.query<{ quorum: string; threshold: string }>(
      `SELECT quorum, threshold FROM decision_bodies WHERE body_id=$1`,
      [motion.body_id],
    );
    const quorum = Number(bodyRes.rows[0].quorum);
    const threshold = Number(bodyRes.rows[0].threshold);

    const { outcome, tally } = await computeMotionTally(client, motionId, quorum, threshold);

    await client.query(
      `UPDATE motions SET status=$1, tally=$2 WHERE motion_id=$3`,
      [outcome, JSON.stringify(tally), motionId],
    );

    // Sprint 15.7 — primitive-outcome chaining (DEFERRED-019) on carried only.
    // For other outcomes (failed/lapsed/vetoed), no chain — motion.tallied
    // payload has no `chain` field. carried path may throw
    // CHAINED_TASK_DEPENDENCY_INVALID → outer try/catch ROLLBACKs the whole txn
    // (motion stays balloting; matches CLARIFY AC10 for motions).
    let chainResult: ChainResult | undefined;
    if (outcome === 'carried') {
      const chainParams = buildChainedTaskParams({
        source: 'motion',
        source_id: motionId,
        topic_id: motion.topic_id,
        kind: motion.subject_ref,
        blob: motion.execution_task,
        acting_actor: 'system:tally',
      });
      chainResult = await emitChain(client, {
        topic_id: motion.topic_id,
        source_event: { type: 'motion.tallied', source_id: motionId },
        actor_id: 'system:tally',
        params: chainParams,
      });
    }

    await appendEvent(client, {
      topic_id: motion.topic_id,
      actor_id: 'system:tally',
      type: 'motion.tallied',
      subject_type: 'motion',
      subject_id: motionId,
      payload: chainResult ? { outcome, ...tally, chain: chainResult } : { outcome, ...tally },
    });

    await client.query('COMMIT');
    return chainResult ? { status: outcome, tally, chain: chainResult } : { status: outcome, tally };
  } catch (err) {
    await client.query('ROLLBACK').catch(() => {});
    logger.error({ err: String(err) }, 'tallyMotion failed');
    throw err;
  } finally {
    client.release();
  }
}

// ── §3.6 getMotion / listMotions ───────────────────────────────────────────────

/** Map a DB motion row (+ aggregated votes) to a MotionRecord. */
function mapMotionRow(r: {
  motion_id: string;
  body_id: string;
  topic_id: string;
  subject_ref: string;
  status: string;
  proposed_by: string;
  seconded_by: string | null;
  deadline: Date;
  tally: MotionTally | null;
  created_at: Date;
  votes: Array<{ actor_id: string; choice: string; weight: string | number; proxy_for: string | null; cast_at: string }>;
}): MotionRecord {
  return {
    motion_id: r.motion_id,
    body_id: r.body_id,
    topic_id: r.topic_id,
    subject_ref: r.subject_ref,
    status: r.status,
    proposed_by: r.proposed_by,
    seconded_by: r.seconded_by,
    deadline: r.deadline.toISOString(),
    tally: r.tally,
    created_at: r.created_at.toISOString(),
    votes: r.votes.map((v) => ({
      actor_id: v.actor_id,
      choice: v.choice,
      weight: Number(v.weight),
      proxy_for: v.proxy_for,
      cast_at: v.cast_at,
    })),
  };
}

const MOTION_SELECT = `
  SELECT m.motion_id, m.body_id, m.topic_id, m.subject_ref, m.status,
         m.proposed_by, m.seconded_by, m.deadline, m.tally, m.created_at,
         COALESCE(
           json_agg(json_build_object(
             'actor_id', v.actor_id, 'choice', v.choice, 'weight', v.weight,
             'proxy_for', v.proxy_for, 'cast_at', v.cast_at
           ) ORDER BY v.cast_at) FILTER (WHERE v.actor_id IS NOT NULL),
           '[]'
         ) AS votes
    FROM motions m
    LEFT JOIN votes v ON v.motion_id = m.motion_id`;

/**
 * Get a single motion + its votes in ONE query. Returns null when no row matches.
 */
export async function getMotion(params: { motion_id: string }): Promise<MotionRecord | null> {
  const pool = getDbPool();
  const res = await pool.query(
    `${MOTION_SELECT}
      WHERE m.motion_id = $1
      GROUP BY m.motion_id`,
    [params.motion_id],
  );
  if (res.rowCount === 0) return null;
  return mapMotionRow(res.rows[0]);
}

/**
 * List a topic's motions, each with its votes; optional `status` filter.
 *
 * First `SELECT 1 FROM topics` → none → NOT_FOUND (the DEFERRED-014(a) lesson —
 * a 404 vs an empty list, applied forward).
 */
export async function listMotions(params: {
  topic_id: string;
  status?: string;
}): Promise<ListMotionsResult> {
  const pool = getDbPool();
  const topicRes = await pool.query(
    `SELECT 1 FROM topics WHERE topic_id=$1`,
    [params.topic_id],
  );
  if (topicRes.rowCount === 0) {
    throw new ContextHubError('NOT_FOUND', `topic ${params.topic_id} not found`);
  }

  const args: unknown[] = [params.topic_id];
  let statusFilter = '';
  if (params.status) {
    args.push(params.status);
    statusFilter = ` AND m.status = $${args.length}`;
  }

  const res = await pool.query(
    `${MOTION_SELECT}
      WHERE m.topic_id = $1${statusFilter}
      GROUP BY m.motion_id
      ORDER BY m.created_at`,
    args,
  );
  return { motions: res.rows.map(mapMotionRow) };
}
