/**
 * Phase 15 Sprint 15.3 — Request-Approval lifecycle.
 *
 * Design ref: docs/specs/2026-05-17-phase-15-sprint-15.3-design.md §3
 * Spec hash:  6f79057f9e42e4fc
 *
 * A `request` routes an artifact-review decision through a multi-level
 * DoA-matrix-derived sequence of offices. Each office must endorse before
 * the next becomes active. The final endorsement approves the request and
 * advances the artifact to `final`; a `return` sends it back to `working`;
 * a `reject` closes the request leaving the artifact untouched.
 *
 * §0.1 Transaction & connection contract (verbatim Phase 13 / 15.1 / 15.2
 * pattern): every transactional fn does
 *   `const c = await pool.connect(); try { BEGIN … COMMIT } catch (e) {
 *    await c.query('ROLLBACK').catch(()=>{}); logger.error(...); throw e }
 *    finally { c.release() }`
 * with an explicit ROLLBACK before every early return.
 *
 * §0.2 Canonical lock order `request → request_step → artifact → topics`.
 * `appendEvent` does `UPDATE topics SET next_seq…` — it locks the topics row —
 * so it is always the final lock.
 *
 * Rev-2/rev-3 fixes implemented here:
 *   B1 — self_decision_forbidden: actor_id == submitted_by → rejected
 *   B2 — resolveArtifact takes actorId; artifact_versions INSERT has all columns
 *   B3 — submitRequest + decideStep plain-read topics.status; → topic_closed
 *   B4 — weight bounded to [0, 2147483647]; above → clean BAD_REQUEST
 *
 * Sprint 15.3.1 security fix-up:
 *   F3a — submitRequest requires artifact.topic_id == request topic; resolveArtifact
 *         derives the artifact's topic itself (no caller-passed topic)
 *   F5  — decideStep validates step_index is a non-negative integer
 *   F7  — submitRequest caps kind / subject_id length at 256
 */

import { randomUUID } from 'node:crypto';
import type { PoolClient } from 'pg';
import { getDbPool } from '../db/client.js';
import { ContextHubError } from '../core/errors.js';
import { createModuleLogger } from '../utils/logger.js';
import { appendEvent } from './coordinationEvents.js';
import { resolveMatrixRow, deriveRoute, STEP_DEADLINE_MINUTES, LEVELS_ASC, LEVEL_RANK } from './doaMatrix.js';
import {
  validateExecutionTask,
  buildChainedTaskParams,
  emitChain,
  type ChainResult,
  type ExecutionTaskBlob,
} from './chaining.js';

const logger = createModuleLogger('requests');

// ── Types ─────────────────────────────────────────────────────────────────────

export type SubmitResult =
  | { status: 'submitted'; request_id: string; route: string[]; current_step: number }
  | { status: 'topic_closed' }
  | { status: 'not_found' }
  | { status: 'not_participant' }
  | { status: 'no_route' };

export type DecideResult =
  | { status: 'step_endorsed'; current_step: number }
  | { status: 'approved'; chain: ChainResult }
  | { status: 'returned' }
  | { status: 'rejected' }
  | { status: 'not_found' }
  | { status: 'already_resolved' }
  | { status: 'not_current_step' }
  | { status: 'topic_closed' }
  | { status: 'conflict' }
  | { status: 'not_participant' }
  | { status: 'self_decision_forbidden' }
  | { status: 'not_authorized' }
  | { status: 'repeat_endorser' }
  | { status: 'procedure_is_collective' };

export type RequestStep = {
  step_index: number;
  target_office: string;
  doa_snapshot: string;
  procedure: string;
  deadline: string;
  status: string;
  decided_by: string | null;
  decided_at: string | null;
};

export type RequestRecord = {
  request_id: string;
  topic_id: string;
  subject_type: string;
  subject_id: string;
  kind: string;
  weight: number;
  procedure: string;
  route_shape: string;
  status: string;
  current_step: number;
  submitted_by: string;
  created_at: string;
  steps: RequestStep[];
};

export type ListRequestsResult = { requests: RequestRecord[] };

// ── §3.1 submitRequest ────────────────────────────────────────────────────────

/**
 * Submit a new approval request for an artifact. Validates input, resolves the
 * DoA matrix row, derives the route, and materializes the request + request_steps
 * rows in one transaction.
 *
 * Lock order: `topics` only (the INSERTs are fresh rows; pre-BEGIN reads are plain
 * unlocked selects). appendEvent takes the topics row lock last.
 */
export async function submitRequest(params: {
  topic_id: string;
  subject_type: string;
  subject_id: string;
  kind: string;
  weight: number;
  procedure: string;
  submitted_by: string;
  /** Sprint 15.7 — optional execution_task blob for chain handler. */
  execution_task?: unknown;
}): Promise<SubmitResult> {
  const topicId = (params.topic_id ?? '').trim();
  const subjectType = (params.subject_type ?? '').trim();
  const subjectId = (params.subject_id ?? '').trim();
  const kind = (params.kind ?? '').trim();
  const weight = params.weight;
  const procedure = (params.procedure ?? '').trim();
  const submittedBy = (params.submitted_by ?? '').trim();

  // Sprint 15.7 — validate execution_task structurally if provided. Chain-time
  // depends_on existence is re-checked at chain emit (decideStep approve branch).
  const executionTask = validateExecutionTask(params.execution_task);

  // Input validation
  if (!topicId || !subjectId || !kind || !submittedBy) {
    throw new ContextHubError(
      'BAD_REQUEST',
      'topic_id, subject_id, kind, submitted_by are all required',
    );
  }

  // F7 — bound the free-text fields written verbatim to rows + the request.submitted event
  const MAX_FIELD_LEN = 256;
  if (kind.length > MAX_FIELD_LEN || subjectId.length > MAX_FIELD_LEN || submittedBy.length > MAX_FIELD_LEN) {
    throw new ContextHubError(
      'BAD_REQUEST',
      `kind, subject_id, and submitted_by must each be at most ${MAX_FIELD_LEN} characters`,
    );
  }

  // B4 — weight must be an integer in [0, 2147483647]
  if (!Number.isInteger(weight) || weight < 0 || weight > 2_147_483_647) {
    throw new ContextHubError(
      'BAD_REQUEST',
      'weight must be an integer in [0, 2147483647]',
    );
  }

  if (!['unilateral', 'collective'].includes(procedure)) {
    throw new ContextHubError('BAD_REQUEST', `procedure must be 'unilateral' or 'collective'`);
  }

  // Sprint 15.8: per-request 'procedure' input is now informational only — the
  // authoritative per-step procedure is sourced from the DoA matrix. We keep the
  // input field for API back-compat; the value is not used for routing decisions.
  // (Collective-step support is wired through the matrix; see §2.2 of the design.)

  // D7 — subject_type must be 'artifact' or 'dispute' (Sprint 15.5 extends to 'dispute')
  if (subjectType !== 'artifact' && subjectType !== 'dispute') {
    throw new ContextHubError('BAD_REQUEST', `subject_type must be 'artifact' or 'dispute'; got: ${subjectType}`);
  }

  const pool = getDbPool();

  // ── Pre-BEGIN plain reads (no lock) ─────────────────────────────────────────

  // Look up topic + project_id, check status (B3)
  const topicRes = await pool.query<{ project_id: string; status: string }>(
    `SELECT project_id, status FROM topics WHERE topic_id=$1`,
    [topicId],
  );
  if (topicRes.rowCount === 0) {
    throw new ContextHubError('NOT_FOUND', `topic ${topicId} not found`);
  }
  const { project_id: projectId, status: topicStatus } = topicRes.rows[0];
  if (topicStatus === 'closed' || topicStatus === 'closing') {
    return { status: 'topic_closed' };
  }

  // For 'artifact' subject_type: check the artifact exists AND belongs to this topic (F3a).
  // For 'dispute' subject_type: subject_id is a dispute UUID — no artifact lookup.
  if (subjectType === 'artifact') {
    const artRes = await pool.query<{ topic_id: string }>(
      `SELECT topic_id FROM artifacts WHERE artifact_id=$1`,
      [subjectId],
    );
    if (artRes.rowCount === 0 || artRes.rows[0].topic_id !== topicId) {
      throw new ContextHubError('NOT_FOUND', `artifact ${subjectId} not found in topic ${topicId}`);
    }
  }

  // Check submitter is a participant
  const participantRes = await pool.query<{ level: string }>(
    `SELECT level FROM topic_participants WHERE topic_id=$1 AND actor_id=$2`,
    [topicId, submittedBy],
  );
  if (participantRes.rowCount === 0) {
    return { status: 'not_participant' };
  }
  const submitterLevel = participantRes.rows[0].level;

  // Resolve the DoA matrix row (pre-BEGIN plain read, then reuse client for transaction)
  const client = await pool.connect();
  try {
    const matrixRow = await resolveMatrixRow(client, {
      project_id: projectId,
      topic_id: topicId,
      kind,
      weight,
    });

    if (matrixRow === null) {
      // release happens in the finally block
      return { status: 'no_route' };
    }

    const route = deriveRoute(submitterLevel, matrixRow.required_level, matrixRow.route_shape);
    const requestId = randomUUID();
    const snapshot = matrixRow.doa_snapshot;
    const deadlineMs = STEP_DEADLINE_MINUTES * 60_000;

    // ── Transaction ───────────────────────────────────────────────────────────

    await client.query('BEGIN');

    // INSERT the request row. Sprint 15.7 — execution_task column added; passes
    // through as JSONB or NULL. (subject_type=artifact hardcoded predates 15.5
    // 'dispute' support; not changed in 15.7 to preserve 15.5 behavior.)
    await client.query(
      `INSERT INTO requests
         (request_id, topic_id, subject_type, subject_id, kind, weight,
          procedure, route_shape, status, current_step, submitted_by, execution_task)
       VALUES ($1, $2, 'artifact', $3, $4, $5, 'unilateral', $6, 'open', 0, $7, $8)`,
      [
        requestId, topicId, subjectId, kind, weight, matrixRow.route_shape, submittedBy,
        executionTask === null ? null : JSON.stringify(executionTask),
      ],
    );

    // Sprint 15.10 — per-step body resolution for collective routes.
    // Build a level→body Map: prefer matrix-table entries (doa_matrix_levels);
    // fall back to the single-body column for the required_level (15.8 compat).
    const bodyByLevel: Map<string, string> = matrixRow.body_by_level.size > 0
      ? new Map(matrixRow.body_by_level)
      : (matrixRow.procedure === 'collective' && matrixRow.body_id
          ? new Map([[matrixRow.required_level, matrixRow.body_id]])
          : new Map<string, string>());

    const stepBodies: Array<string | null> = [];
    for (let i = 0; i < route.length; i++) {
      const stepLevel = route[i];
      if (matrixRow.procedure === 'collective') {
        const body = bodyByLevel.get(stepLevel);
        if (!body) {
          await client.query('ROLLBACK');
          throw new ContextHubError(
            'BAD_REQUEST',
            `missing_collective_body: matrix has no body assigned for level '${stepLevel}' on this route`,
          );
        }
        stepBodies.push(body);
      } else {
        stepBodies.push(null);
      }
    }

    // Sprint 15.10 — distinct-body check for multi-step counter_sign+collective
    // (preserves the distinct-endorser principle for collective routes).
    if (matrixRow.procedure === 'collective'
        && matrixRow.route_shape === 'counter_sign'
        && route.length > 1) {
      const seen = new Set<string>();
      for (const b of stepBodies) {
        if (b && seen.has(b)) {
          await client.query('ROLLBACK');
          throw new ContextHubError(
            'BAD_REQUEST',
            `distinct_body_required: counter_sign+collective routes require a distinct body per step (duplicate body assigned to multiple steps)`,
          );
        }
        if (b) seen.add(b);
      }
    }

    // Materialize the route as request_steps. Sprint 15.8: per-step procedure +
    // body_id snapshotted from the matrix row (frozen for the request lifetime).
    // Sprint 15.10: per-step body_id from the body_by_level map (multi-tier).
    for (let i = 0; i < route.length; i++) {
      await client.query(
        `INSERT INTO request_steps
           (request_id, step_index, target_office, doa_snapshot, procedure, deadline, status, body_id)
         VALUES ($1, $2, $3, $4, $5, now() + $6::interval, 'pending', $7)`,
        [requestId, i, route[i], snapshot, matrixRow.procedure, `${deadlineMs} milliseconds`, stepBodies[i]],
      );
    }

    // Sprint 15.10 — snapshot the body_by_level map onto the request so lapsed-
    // escalation honors snapshot-the-rules (master design B.7).
    if (matrixRow.procedure === 'collective' && bodyByLevel.size > 0) {
      const snapshotObj: Record<string, string> = {};
      for (const [lvl, bid] of bodyByLevel.entries()) snapshotObj[lvl] = bid;
      await client.query(
        `UPDATE requests SET body_by_level = $1 WHERE request_id = $2`,
        [JSON.stringify(snapshotObj), requestId],
      );
    }

    // Emit request.submitted event (topics lock acquired last)
    await appendEvent(client, {
      topic_id: topicId,
      actor_id: submittedBy,
      type: 'request.submitted',
      subject_type: 'request',
      subject_id: requestId,
      payload: { subject_id: subjectId, kind, weight, route_shape: matrixRow.route_shape, route },
    });

    // Sprint 15.8 — if step 0 is collective, auto-propose its motion in the same txn.
    // Sprint 15.10 — step 0's body comes from stepBodies[0] (per-level resolution),
    // not the legacy matrixRow.body_id single column.
    if (matrixRow.procedure === 'collective') {
      await proposeStepMotion(client, {
        request_id: requestId,
        step_index: 0,
        body_id: stepBodies[0]!,
        topic_id: topicId,
        deadline_minutes: STEP_DEADLINE_MINUTES,
      });
    }

    await client.query('COMMIT');

    return { status: 'submitted', request_id: requestId, route, current_step: 0 };
  } catch (err) {
    await client.query('ROLLBACK').catch(() => {});
    logger.error({ err: String(err) }, 'submitRequest failed');
    throw err;
  } finally {
    client.release();
  }
}

// ── §3.2.1 proposeStepMotion (internal, Sprint 15.8) ───────────────────────

/**
 * Auto-propose a motion for a collective request step. Runs inside the caller's
 * transaction. Inserts a motions row + appendEvent motion.proposed + UPDATE
 * request_steps SET status='motion_proposed', motion_id=<new id>.
 *
 * The proposer is the reserved system actor 'system:request-step-proposer'. Body
 * members second + vote per existing 15.4 rules. Motion deadline is independent
 * of the step deadline (typically equal in 15.8 — both default to
 * STEP_DEADLINE_MINUTES from now).
 *
 * Lock order: caller already holds request lock; this fn does not lock additional
 * rows besides the motions INSERT + request_steps UPDATE (both via row-level locks
 * implicitly).
 */
async function proposeStepMotion(
  client: PoolClient,
  args: {
    request_id: string;
    step_index: number;
    body_id: string;
    topic_id: string;
    deadline_minutes: number;
  },
): Promise<{ motion_id: string }> {
  const subjectRef = `request_step:${args.request_id}:${args.step_index}`;
  const proposerId = 'system:request-step-proposer';
  const ins = await client.query<{ motion_id: string; deadline: Date }>(
    `INSERT INTO motions (body_id, topic_id, subject_ref, status, proposed_by, deadline)
     VALUES ($1, $2, $3, 'proposed', $4, now() + ($5 * interval '1 minute'))
     RETURNING motion_id, deadline`,
    [args.body_id, args.topic_id, subjectRef, proposerId, args.deadline_minutes],
  );
  const motionId = ins.rows[0].motion_id;
  const deadline = ins.rows[0].deadline.toISOString();
  await appendEvent(client, {
    topic_id: args.topic_id,
    actor_id: proposerId,
    type: 'motion.proposed',
    subject_type: 'motion',
    subject_id: motionId,
    payload: {
      body_id: args.body_id,
      subject_ref: subjectRef,
      deadline,
      source: 'request_step',
      request_id: args.request_id,
      step_index: args.step_index,
    },
  });
  await client.query(
    `UPDATE request_steps SET status='motion_proposed', motion_id=$1
       WHERE request_id=$2 AND step_index=$3`,
    [motionId, args.request_id, args.step_index],
  );
  return { motion_id: motionId };
}

// ── §3.3 resolveArtifact (internal) ──────────────────────────────────────────

/**
 * Internal helper: advance the subject artifact's state as a result of a
 * request decision (D8). Called inside an open transaction (client already holds
 * the `request → request_step` row locks; this fn acquires the `artifact` lock).
 *
 * Outcome-to-state mapping:
 *   'approve' → for_review → final
 *   'return'  → for_review → working
 *   'reject'  → (not called — artifact untouched)
 *
 * Uses a guarded `UPDATE … WHERE state='for_review' RETURNING version, content_ref,
 * topic_id` — the constant `from` state. On 0 rows (artifact not in for_review), emits
 * nothing; the request still resolves (best-effort, idempotent). The artifact's own
 * `topic_id` is read from that same locked UPDATE row (F3a) — never passed by the caller.
 *
 * Lock order position: `artifact` (after `request_step`, before `topics`).
 */
async function resolveArtifact(
  client: PoolClient,
  outcome: 'approve' | 'return',
  artifactId: string,
  actorId: string,
): Promise<{ artifact_advanced: boolean }> {
  const newState = outcome === 'approve' ? 'final' : 'working';
  const note = `request ${outcome === 'approve' ? 'approved' : 'returned'}`;

  // Guarded UPDATE — pins the from state to 'for_review' (§3.3)
  const upd = await client.query<{ version: number; content_ref: string | null; topic_id: string }>(
    `UPDATE artifacts SET state=$1, version=version+1
       WHERE artifact_id=$2 AND state='for_review'
       RETURNING version, content_ref, topic_id`,
    [newState, artifactId],
  );

  if ((upd.rowCount ?? 0) === 0) {
    // Artifact not in for_review — best-effort, do nothing
    return { artifact_advanced: false };
  }

  const { version, content_ref, topic_id } = upd.rows[0];

  // Fully column-specified artifact_versions INSERT (B2 — all NOT NULL columns explicit)
  await client.query(
    `INSERT INTO artifact_versions
       (artifact_id, version, state, content_ref, fencing_token, note, created_by)
     VALUES ($1, $2, $3, $4, NULL, $5, $6)`,
    [artifactId, version, newState, content_ref, note, actorId],
  );

  // artifact.versioned + artifact.state_changed events (artifact lock held; topics acquired next)
  await appendEvent(client, {
    topic_id,
    actor_id: actorId,
    type: 'artifact.versioned',
    subject_type: 'artifact',
    subject_id: artifactId,
    payload: { version },
  });
  await appendEvent(client, {
    topic_id,
    actor_id: actorId,
    type: 'artifact.state_changed',
    subject_type: 'artifact',
    subject_id: artifactId,
    payload: { from: 'for_review', to: newState },
  });

  return { artifact_advanced: true };
}

// ── §3.2 decideStep ───────────────────────────────────────────────────────────

/**
 * An officeholder decides a step (endorse / return / reject). The step must be
 * the request's current active step. Authorization: the actor must be a topic
 * participant at the step's target_office level AND must not be the request's
 * submitter (D5 — no self-approval; B1).
 *
 * Lock order: `request → request_step → artifact → topics` (§0.2).
 */
export async function decideStep(params: {
  request_id: string;
  step_index: number;
  actor_id: string;
  decision: string;
}): Promise<DecideResult> {
  const requestId = (params.request_id ?? '').trim();
  const actorId = (params.actor_id ?? '').trim();
  const decision = (params.decision ?? '').trim();
  const stepIndex = params.step_index;

  if (!requestId || !actorId || !decision) {
    throw new ContextHubError('BAD_REQUEST', 'request_id, actor_id, decision are required');
  }
  if (actorId.length > 256) {
    throw new ContextHubError('BAD_REQUEST', 'actor_id must be at most 256 characters');
  }
  if (!['endorse', 'return', 'reject'].includes(decision)) {
    throw new ContextHubError('BAD_REQUEST', `decision must be one of: endorse, return, reject`);
  }
  // F5 — step_index must be a non-negative integer (mirrors the B4 weight bound)
  if (!Number.isInteger(stepIndex) || stepIndex < 0) {
    throw new ContextHubError('BAD_REQUEST', 'step_index must be a non-negative integer');
  }

  const pool = getDbPool();
  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    // ── (request) row lock ───────────────────────────────────────────────────
    // Sprint 15.7 — also select kind + execution_task for chain handler.
    const reqRes = await client.query<{
      topic_id: string;
      status: string;
      current_step: number;
      subject_id: string;
      submitted_by: string;
      route_shape: string;
      kind: string;
      execution_task: ExecutionTaskBlob | null;
    }>(
      `SELECT topic_id, status, current_step, subject_id, submitted_by, route_shape, kind, execution_task
         FROM requests WHERE request_id=$1 FOR UPDATE`,
      [requestId],
    );
    if (reqRes.rowCount === 0) {
      await client.query('ROLLBACK');
      return { status: 'not_found' };
    }
    const req = reqRes.rows[0];
    if (req.status !== 'open') {
      await client.query('ROLLBACK');
      return { status: 'already_resolved' };
    }
    if (req.current_step !== stepIndex) {
      await client.query('ROLLBACK');
      return { status: 'not_current_step' };
    }
    const topicId = req.topic_id;
    const artifactId = req.subject_id;
    const submittedBy = req.submitted_by;
    const routeShape = req.route_shape;
    const requestKind = req.kind;
    const executionTaskBlob: ExecutionTaskBlob | null = req.execution_task;

    // B3 — closed-topic plain read (no lock — preserves lock order; the seal in
    // appendEvent is the authoritative guard for a mid-transaction close race)
    const topicRes = await client.query<{ status: string }>(
      `SELECT status FROM topics WHERE topic_id=$1`,
      [topicId],
    );
    if (topicRes.rows[0]?.status === 'closed') {
      await client.query('ROLLBACK');
      return { status: 'topic_closed' };
    }

    // ── (request_step) row lock ──────────────────────────────────────────────
    // Sprint 15.8 — also select `procedure` so we can early-reject collective.
    const stepRes = await client.query<{ target_office: string; status: string; procedure: string }>(
      `SELECT target_office, status, procedure FROM request_steps
         WHERE request_id=$1 AND step_index=$2 FOR UPDATE`,
      [requestId, stepIndex],
    );
    if (stepRes.rowCount === 0) {
      await client.query('ROLLBACK');
      return { status: 'conflict' };
    }
    // Sprint 15.8 — collective steps are decided by motion tally, not decideStep.
    // This check fires BEFORE the status check because a collective step's status
    // is 'motion_proposed' (not 'pending'), and the user needs the clearer error.
    if (stepRes.rows[0].procedure === 'collective') {
      await client.query('ROLLBACK');
      return { status: 'procedure_is_collective' };
    }
    if (stepRes.rows[0].status !== 'pending') {
      await client.query('ROLLBACK');
      return { status: 'conflict' };
    }
    const targetOffice = stepRes.rows[0].target_office;

    // ── Authorization (D5) ───────────────────────────────────────────────────
    const participantRes = await client.query<{ level: string }>(
      `SELECT level FROM topic_participants WHERE topic_id=$1 AND actor_id=$2`,
      [topicId, actorId],
    );
    if (participantRes.rowCount === 0) {
      await client.query('ROLLBACK');
      return { status: 'not_participant' };
    }
    // B1 — self-decision guard: submitter is never an officeholder for their own request
    if (actorId === submittedBy) {
      await client.query('ROLLBACK');
      return { status: 'self_decision_forbidden' };
    }
    const actorLevel = participantRes.rows[0].level;
    if (actorLevel !== targetOffice) {
      await client.query('ROLLBACK');
      return { status: 'not_authorized' };
    }

    // Sprint 15.6 — distinct-endorser: for counter_sign routes, reject if actor already
    // decided any prior step (DEFERRED-013).
    if (routeShape === 'counter_sign') {
      const prior = await client.query<{ decided_by: string }>(
        `SELECT decided_by FROM request_steps
           WHERE request_id=$1 AND step_index<$2 AND decided_by IS NOT NULL`,
        [requestId, stepIndex],
      );
      if (prior.rows.some((r) => r.decided_by === actorId)) {
        await client.query('ROLLBACK');
        return { status: 'repeat_endorser' };
      }
    }

    // ── Map decision → step status ───────────────────────────────────────────
    const stepStatus = decision === 'endorse' ? 'endorsed' : decision === 'return' ? 'returned' : 'rejected';

    // UPDATE request_step
    await client.query(
      `UPDATE request_steps SET status=$1, decided_by=$2, decided_at=now()
         WHERE request_id=$3 AND step_index=$4`,
      [stepStatus, actorId, requestId, stepIndex],
    );

    if (decision === 'endorse') {
      // Check if there is a next step
      const nextRes = await client.query(
        `SELECT 1 FROM request_steps WHERE request_id=$1 AND step_index=$2`,
        [requestId, stepIndex + 1],
      );

      if ((nextRes.rowCount ?? 0) > 0) {
        // Activate the next step: reset its deadline to now+60min
        await client.query(
          `UPDATE request_steps SET deadline = now() + interval '${STEP_DEADLINE_MINUTES} minutes'
             WHERE request_id=$1 AND step_index=$2`,
          [requestId, stepIndex + 1],
        );
        await client.query(
          `UPDATE requests SET current_step=$1 WHERE request_id=$2`,
          [stepIndex + 1, requestId],
        );
        await appendEvent(client, {
          topic_id: topicId,
          actor_id: actorId,
          type: 'request.step_decided',
          subject_type: 'request',
          subject_id: requestId,
          payload: { step_index: stepIndex, decision, decided_by: actorId },
        });
        await client.query('COMMIT');
        return { status: 'step_endorsed', current_step: stepIndex + 1 };
      } else {
        // Last step endorsed → approved
        await client.query(
          `UPDATE requests SET status='approved' WHERE request_id=$1`,
          [requestId],
        );
        // (artifact) advance — lock order: artifact after request_step, before topics
        const artResult = await resolveArtifact(client, 'approve', artifactId, actorId);
        await appendEvent(client, {
          topic_id: topicId,
          actor_id: actorId,
          type: 'request.step_decided',
          subject_type: 'request',
          subject_id: requestId,
          payload: { step_index: stepIndex, decision, decided_by: actorId },
        });
        // Sprint 15.7 — primitive-outcome chaining (DEFERRED-019). Build params,
        // emit chain (posted vs task.deferred), include result in request.resolved.
        // CHAINED_TASK_DEPENDENCY_INVALID throws → outer try/catch ROLLBACKs the
        // whole txn; the request remains 'open' (matches CLARIFY AC10).
        const chainParams = buildChainedTaskParams({
          source: 'request',
          source_id: requestId,
          topic_id: topicId,
          kind: requestKind,
          blob: executionTaskBlob,
          acting_actor: actorId,
        });
        const chainResult = await emitChain(client, {
          topic_id: topicId,
          source_event: { type: 'request.resolved', source_id: requestId },
          actor_id: actorId,
          params: chainParams,
        });
        await appendEvent(client, {
          topic_id: topicId,
          actor_id: actorId,
          type: 'request.resolved',
          subject_type: 'request',
          subject_id: requestId,
          payload: {
            outcome: 'approved',
            artifact_advanced: artResult.artifact_advanced,
            chain: chainResult,
          },
        });
        await client.query('COMMIT');
        return { status: 'approved', chain: chainResult };
      }
    } else if (decision === 'return') {
      await client.query(
        `UPDATE requests SET status='returned' WHERE request_id=$1`,
        [requestId],
      );
      const artResult = await resolveArtifact(client, 'return', artifactId, actorId);
      await appendEvent(client, {
        topic_id: topicId,
        actor_id: actorId,
        type: 'request.step_decided',
        subject_type: 'request',
        subject_id: requestId,
        payload: { step_index: stepIndex, decision, decided_by: actorId },
      });
      await appendEvent(client, {
        topic_id: topicId,
        actor_id: actorId,
        type: 'request.resolved',
        subject_type: 'request',
        subject_id: requestId,
        payload: { outcome: 'returned', artifact_advanced: artResult.artifact_advanced },
      });
      await client.query('COMMIT');
      return { status: 'returned' };
    } else {
      // reject — artifact untouched (D8)
      await client.query(
        `UPDATE requests SET status='rejected' WHERE request_id=$1`,
        [requestId],
      );
      await appendEvent(client, {
        topic_id: topicId,
        actor_id: actorId,
        type: 'request.step_decided',
        subject_type: 'request',
        subject_id: requestId,
        payload: { step_index: stepIndex, decision, decided_by: actorId },
      });
      await appendEvent(client, {
        topic_id: topicId,
        actor_id: actorId,
        type: 'request.resolved',
        subject_type: 'request',
        subject_id: requestId,
        payload: { outcome: 'rejected', artifact_advanced: false },
      });
      await client.query('COMMIT');
      return { status: 'rejected' };
    }
  } catch (err) {
    await client.query('ROLLBACK').catch(() => {});
    logger.error({ err: String(err) }, 'decideStep failed');
    throw err;
  } finally {
    client.release();
  }
}

// ── §3.4 getRequest / listRequests ───────────────────────────────────────────

/**
 * Get a single request + its steps.
 */
export async function getRequest(params: {
  request_id: string;
}): Promise<RequestRecord | null> {
  const pool = getDbPool();
  const reqRes = await pool.query<{
    request_id: string;
    topic_id: string;
    subject_type: string;
    subject_id: string;
    kind: string;
    weight: number;
    procedure: string;
    route_shape: string;
    status: string;
    current_step: number;
    submitted_by: string;
    created_at: Date;
  }>(
    `SELECT request_id, topic_id, subject_type, subject_id, kind, weight,
            procedure, route_shape, status, current_step, submitted_by, created_at
       FROM requests WHERE request_id=$1`,
    [params.request_id],
  );
  if (reqRes.rowCount === 0) return null;

  const stepsRes = await pool.query<{
    step_index: number;
    target_office: string;
    doa_snapshot: string;
    procedure: string;
    deadline: Date;
    status: string;
    decided_by: string | null;
    decided_at: Date | null;
  }>(
    `SELECT step_index, target_office, doa_snapshot, procedure, deadline,
            status, decided_by, decided_at
       FROM request_steps WHERE request_id=$1 ORDER BY step_index`,
    [params.request_id],
  );

  const r = reqRes.rows[0];
  return {
    request_id: r.request_id,
    topic_id: r.topic_id,
    subject_type: r.subject_type,
    subject_id: r.subject_id,
    kind: r.kind,
    weight: r.weight,
    procedure: r.procedure,
    route_shape: r.route_shape,
    status: r.status,
    current_step: r.current_step,
    submitted_by: r.submitted_by,
    created_at: r.created_at.toISOString(),
    steps: stepsRes.rows.map((s) => ({
      step_index: s.step_index,
      target_office: s.target_office,
      doa_snapshot: s.doa_snapshot,
      procedure: s.procedure,
      deadline: s.deadline.toISOString(),
      status: s.status,
      decided_by: s.decided_by,
      decided_at: s.decided_at ? s.decided_at.toISOString() : null,
    })),
  };
}

/**
 * List requests for a topic, optionally filtered by status.
 */
export async function listRequests(params: {
  topic_id: string;
  status?: string;
}): Promise<ListRequestsResult> {
  const pool = getDbPool();

  // DEFERRED-014 §3.1 — surface NOT_FOUND for unknown topic instead of silently returning []
  const topicCheck = await pool.query<{ topic_id: string }>(
    `SELECT topic_id FROM topics WHERE topic_id=$1`,
    [params.topic_id],
  );
  if ((topicCheck.rowCount ?? 0) === 0) {
    throw new ContextHubError('NOT_FOUND', `topic ${params.topic_id} not found`);
  }

  const args: unknown[] = [params.topic_id];
  let statusFilter = '';
  if (params.status) {
    args.push(params.status);
    statusFilter = ` AND r.status = $${args.length}`;
  }

  const reqRes = await pool.query<{
    request_id: string;
    topic_id: string;
    subject_type: string;
    subject_id: string;
    kind: string;
    weight: number;
    procedure: string;
    route_shape: string;
    status: string;
    current_step: number;
    submitted_by: string;
    created_at: Date;
  }>(
    `SELECT request_id, topic_id, subject_type, subject_id, kind, weight,
            procedure, route_shape, status, current_step, submitted_by, created_at
       FROM requests r WHERE topic_id=$1${statusFilter}
       ORDER BY created_at`,
    args,
  );

  if (reqRes.rows.length === 0) return { requests: [] };

  const requestIds = reqRes.rows.map((r) => r.request_id);
  const stepsRes = await pool.query<{
    request_id: string;
    step_index: number;
    target_office: string;
    doa_snapshot: string;
    procedure: string;
    deadline: Date;
    status: string;
    decided_by: string | null;
    decided_at: Date | null;
  }>(
    `SELECT request_id, step_index, target_office, doa_snapshot, procedure,
            deadline, status, decided_by, decided_at
       FROM request_steps WHERE request_id = ANY($1::uuid[])
       ORDER BY request_id, step_index`,
    [requestIds],
  );

  const stepsByRequest = new Map<string, RequestStep[]>();
  for (const s of stepsRes.rows) {
    const arr = stepsByRequest.get(s.request_id) ?? [];
    arr.push({
      step_index: s.step_index,
      target_office: s.target_office,
      doa_snapshot: s.doa_snapshot,
      procedure: s.procedure,
      deadline: s.deadline.toISOString(),
      status: s.status,
      decided_by: s.decided_by,
      decided_at: s.decided_at ? s.decided_at.toISOString() : null,
    });
    stepsByRequest.set(s.request_id, arr);
  }

  return {
    requests: reqRes.rows.map((r) => ({
      request_id: r.request_id,
      topic_id: r.topic_id,
      subject_type: r.subject_type,
      subject_id: r.subject_id,
      kind: r.kind,
      weight: r.weight,
      procedure: r.procedure,
      route_shape: r.route_shape,
      status: r.status,
      current_step: r.current_step,
      submitted_by: r.submitted_by,
      created_at: r.created_at.toISOString(),
      steps: stepsByRequest.get(r.request_id) ?? [],
    })),
  };
}

// ── §3.7 applyMotionToStep — Sprint 15.8 collective wiring (DEFERRED-018) ───

/**
 * Apply a motion's tally outcome to its linked request step. Called by
 * tallyMotion (user-driven) AND sweepExpiredMotions (auto-tally) AFTER they
 * emit `motion.tallied` — both hold the motion FOR UPDATE so we serialize.
 *
 * Outcome → step transition (DESIGN §2.8):
 *   carried → step.endorsed, advance to next step OR finalize approved (with 15.7 chain)
 *   failed  → step.returned, request.returned, resolveArtifact(return)
 *   lapsed  → DEGRADE-TO-UNILATERAL escalation (F1 fix): re-target step up one
 *             level, procedure='unilateral', body_id=NULL, fresh deadline.
 *             At authority tier → request.escalation_exhausted.
 *   vetoed  → step.rejected, request.rejected, artifact untouched
 *
 * Lock order: motion → request → request_step → artifact → topics (linear).
 * All inside the caller's transaction.
 */
export async function applyMotionToStep(
  client: PoolClient,
  args: {
    motion_id: string;
    request_id: string;
    step_index: number;
    target_office: string;
    outcome: 'carried' | 'failed' | 'lapsed' | 'vetoed';
    topic_id: string;
  },
): Promise<void> {
  const { motion_id, request_id, step_index, target_office, outcome, topic_id } = args;
  const motionRef = `motion:${motion_id}`;

  // Load the request — kind, subject_id, execution_task, submitted_by, route_shape.
  // Sprint 15.10 — also body_by_level for lapsed-escalation snapshot-read (F1 fix).
  const reqRes = await client.query<{
    status: string;
    kind: string;
    subject_id: string;
    submitted_by: string;
    route_shape: string;
    execution_task: ExecutionTaskBlob | null;
    body_by_level: Record<string, string> | null;
  }>(
    `SELECT status, kind, subject_id, submitted_by, route_shape, execution_task, body_by_level
       FROM requests WHERE request_id=$1 FOR UPDATE`,
    [request_id],
  );
  if (reqRes.rowCount === 0 || reqRes.rows[0].status !== 'open') {
    // Request already resolved by some other path (or vanished). Nothing to do.
    return;
  }
  const req = reqRes.rows[0];

  if (outcome === 'carried') {
    // step.endorsed
    await client.query(
      `UPDATE request_steps SET status='endorsed', decided_by=$1, decided_at=now()
         WHERE request_id=$2 AND step_index=$3`,
      [motionRef, request_id, step_index],
    );

    // Is there a next step?
    const nextRes = await client.query<{ procedure: string; body_id: string | null }>(
      `SELECT procedure, body_id FROM request_steps WHERE request_id=$1 AND step_index=$2`,
      [request_id, step_index + 1],
    );

    if ((nextRes.rowCount ?? 0) > 0) {
      // Activate next step with fresh deadline.
      await client.query(
        `UPDATE request_steps SET deadline = now() + interval '${STEP_DEADLINE_MINUTES} minutes'
           WHERE request_id=$1 AND step_index=$2`,
        [request_id, step_index + 1],
      );
      await client.query(
        `UPDATE requests SET current_step=$1 WHERE request_id=$2`,
        [step_index + 1, request_id],
      );
      await appendEvent(client, {
        topic_id,
        actor_id: motionRef,
        type: 'request.step_decided',
        subject_type: 'request',
        subject_id: request_id,
        payload: { step_index, decision: 'endorse', decided_by: motionRef },
      });
      // If next step is collective, propose its motion in the same txn.
      if (nextRes.rows[0].procedure === 'collective' && nextRes.rows[0].body_id) {
        await proposeStepMotion(client, {
          request_id,
          step_index: step_index + 1,
          body_id: nextRes.rows[0].body_id,
          topic_id,
          deadline_minutes: STEP_DEADLINE_MINUTES,
        });
      }
      return;
    }

    // Last step endorsed → approved + 15.7 chain.
    await client.query(`UPDATE requests SET status='approved' WHERE request_id=$1`, [request_id]);
    const artResult = await resolveArtifact(client, 'approve', req.subject_id, motionRef);
    await appendEvent(client, {
      topic_id,
      actor_id: motionRef,
      type: 'request.step_decided',
      subject_type: 'request',
      subject_id: request_id,
      payload: { step_index, decision: 'endorse', decided_by: motionRef },
    });
    // 15.7 chain
    const chainParams = buildChainedTaskParams({
      source: 'request',
      source_id: request_id,
      topic_id,
      kind: req.kind,
      blob: req.execution_task,
      acting_actor: motionRef,
    });
    const chainResult = await emitChain(client, {
      topic_id,
      source_event: { type: 'request.resolved', source_id: request_id },
      actor_id: motionRef,
      params: chainParams,
    });
    await appendEvent(client, {
      topic_id,
      actor_id: motionRef,
      type: 'request.resolved',
      subject_type: 'request',
      subject_id: request_id,
      payload: {
        outcome: 'approved',
        artifact_advanced: artResult.artifact_advanced,
        chain: chainResult,
      },
    });
    return;
  }

  if (outcome === 'failed') {
    await client.query(
      `UPDATE request_steps SET status='returned', decided_by=$1, decided_at=now()
         WHERE request_id=$2 AND step_index=$3`,
      [motionRef, request_id, step_index],
    );
    await client.query(`UPDATE requests SET status='returned' WHERE request_id=$1`, [request_id]);
    const artResult = await resolveArtifact(client, 'return', req.subject_id, motionRef);
    await appendEvent(client, {
      topic_id,
      actor_id: motionRef,
      type: 'request.step_decided',
      subject_type: 'request',
      subject_id: request_id,
      payload: { step_index, decision: 'return', decided_by: motionRef },
    });
    await appendEvent(client, {
      topic_id,
      actor_id: motionRef,
      type: 'request.resolved',
      subject_type: 'request',
      subject_id: request_id,
      payload: { outcome: 'returned', artifact_advanced: artResult.artifact_advanced },
    });
    return;
  }

  if (outcome === 'vetoed') {
    await client.query(
      `UPDATE request_steps SET status='rejected', decided_by=$1, decided_at=now()
         WHERE request_id=$2 AND step_index=$3`,
      [motionRef, request_id, step_index],
    );
    await client.query(`UPDATE requests SET status='rejected' WHERE request_id=$1`, [request_id]);
    // Artifact untouched (reject semantics).
    await appendEvent(client, {
      topic_id,
      actor_id: motionRef,
      type: 'request.step_decided',
      subject_type: 'request',
      subject_id: request_id,
      payload: { step_index, decision: 'reject', decided_by: motionRef, reason: 'vetoed' },
    });
    await appendEvent(client, {
      topic_id,
      actor_id: motionRef,
      type: 'request.resolved',
      subject_type: 'request',
      subject_id: request_id,
      payload: { outcome: 'rejected', artifact_advanced: false },
    });
    return;
  }

  // outcome === 'lapsed' — Sprint 15.10 re-propose-or-degrade escalation
  // (Sprint 15.8 F1 was degrade-only; 15.10 reads body_by_level snapshot
  // and re-proposes under the next level's body when available.)
  const currentRank = LEVEL_RANK[target_office];
  if (currentRank === LEVEL_RANK.authority) {
    // Already at top — escalation exhausted. Payload shape matches 15.3 sweep
    // `{ exhausted: true }` for consumer consistency.
    await client.query(
      `UPDATE request_steps SET status='escalated', decided_by=$1, decided_at=now()
         WHERE request_id=$2 AND step_index=$3`,
      [motionRef, request_id, step_index],
    );
    await client.query(
      `UPDATE requests SET status='escalation_exhausted' WHERE request_id=$1`,
      [request_id],
    );
    await appendEvent(client, {
      topic_id,
      actor_id: motionRef,
      type: 'request.step_escalated',
      subject_type: 'request',
      subject_id: request_id,
      // Sprint 15.10 — escalated_to replaces 15.8's degraded_to field (F2 unify).
      payload: { step_index, exhausted: true, reason: 'motion_lapsed', escalated_to: 'unilateral' },
    });
    await appendEvent(client, {
      topic_id,
      actor_id: motionRef,
      type: 'request.resolved',
      subject_type: 'request',
      subject_id: request_id,
      payload: { outcome: 'escalation_exhausted', artifact_advanced: false },
    });
    return;
  }
  // Non-top tier — degrade to unilateral at the next level.
  const newLevel = LEVELS_ASC[currentRank + 1];
  // Sprint 15.10 — read body_by_level snapshot to find next level's body.
  const snapshotMap = req.body_by_level ?? null;
  const nextBody = snapshotMap ? snapshotMap[newLevel] ?? null : null;

  if (nextBody) {
    // Q2 (a) — re-propose under next level's collective body.
    await client.query(
      `UPDATE request_steps SET status='motion_proposed', target_office=$1,
         procedure='collective', body_id=$2, motion_id=NULL,
         deadline=now() + interval '${STEP_DEADLINE_MINUTES} minutes',
         decided_by=NULL, decided_at=NULL
         WHERE request_id=$3 AND step_index=$4`,
      [newLevel, nextBody, request_id, step_index],
    );
    await appendEvent(client, {
      topic_id,
      actor_id: motionRef,
      type: 'request.step_escalated',
      subject_type: 'request',
      subject_id: request_id,
      payload: { step_index, from_office: target_office, to_office: newLevel, reason: 'motion_lapsed', escalated_to: 'collective', body_id: nextBody },
    });
    await proposeStepMotion(client, {
      request_id, step_index, body_id: nextBody, topic_id, deadline_minutes: STEP_DEADLINE_MINUTES,
    });
  } else {
    // Q2 fallback — degrade to unilateral (15.8 behavior).
    await client.query(
      `UPDATE request_steps SET status='pending', target_office=$1, procedure='unilateral',
         body_id=NULL, motion_id=NULL, deadline=now() + interval '${STEP_DEADLINE_MINUTES} minutes',
         decided_by=NULL, decided_at=NULL
         WHERE request_id=$2 AND step_index=$3`,
      [newLevel, request_id, step_index],
    );
    await appendEvent(client, {
      topic_id,
      actor_id: motionRef,
      type: 'request.step_escalated',
      subject_type: 'request',
      subject_id: request_id,
      // Sprint 15.10 — escalated_to replaces 15.8's degraded_to field (F2 unify).
      payload: { step_index, from_office: target_office, to_office: newLevel, reason: 'motion_lapsed', escalated_to: 'unilateral' },
    });
  }
}
