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
import { resolveMatrixRow, deriveRoute, STEP_DEADLINE_MINUTES } from './doaMatrix.js';

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
  | { status: 'approved' }
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
  | { status: 'repeat_endorser' };

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
}): Promise<SubmitResult> {
  const topicId = (params.topic_id ?? '').trim();
  const subjectType = (params.subject_type ?? '').trim();
  const subjectId = (params.subject_id ?? '').trim();
  const kind = (params.kind ?? '').trim();
  const weight = params.weight;
  const procedure = (params.procedure ?? '').trim();
  const submittedBy = (params.submitted_by ?? '').trim();

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

  // D6 — collective steps are not implemented yet
  if (procedure === 'collective') {
    throw new ContextHubError('BAD_REQUEST', 'collective steps are Sprint 15.4');
  }

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

    // INSERT the request row
    await client.query(
      `INSERT INTO requests
         (request_id, topic_id, subject_type, subject_id, kind, weight,
          procedure, route_shape, status, current_step, submitted_by)
       VALUES ($1, $2, 'artifact', $3, $4, $5, 'unilateral', $6, 'open', 0, $7)`,
      [requestId, topicId, subjectId, kind, weight, matrixRow.route_shape, submittedBy],
    );

    // Materialize the route as request_steps (all pending; only step 0 is active)
    for (let i = 0; i < route.length; i++) {
      await client.query(
        `INSERT INTO request_steps
           (request_id, step_index, target_office, doa_snapshot, procedure, deadline, status)
         VALUES ($1, $2, $3, $4, 'unilateral', now() + $5::interval, 'pending')`,
        [requestId, i, route[i], snapshot, `${deadlineMs} milliseconds`],
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
    const reqRes = await client.query<{
      topic_id: string;
      status: string;
      current_step: number;
      subject_id: string;
      submitted_by: string;
      route_shape: string;
    }>(
      `SELECT topic_id, status, current_step, subject_id, submitted_by, route_shape
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
    const stepRes = await client.query<{ target_office: string; status: string }>(
      `SELECT target_office, status FROM request_steps
         WHERE request_id=$1 AND step_index=$2 FOR UPDATE`,
      [requestId, stepIndex],
    );
    if (stepRes.rowCount === 0 || stepRes.rows[0].status !== 'pending') {
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
        await appendEvent(client, {
          topic_id: topicId,
          actor_id: actorId,
          type: 'request.resolved',
          subject_type: 'request',
          subject_id: requestId,
          payload: { outcome: 'approved', artifact_advanced: artResult.artifact_advanced },
        });
        await client.query('COMMIT');
        return { status: 'approved' };
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
