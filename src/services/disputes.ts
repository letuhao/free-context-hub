/**
 * Phase 15 Sprint 15.5 — Dispute resolution.
 *
 * Design ref: docs/specs/2026-05-18-phase-15-sprint-15.5-design.md §2.2
 * Spec hash:  a506ddd08a5c6dfc
 *
 * A `dispute` is a Request-Approval item routed to an arbiter (unilateral) or
 * a tribunal (collective). `openDispute` creates the dispute row and calls
 * `submitRequest` to create the resolution request. `resolveDispute` must be
 * called explicitly once the resolution request reaches a terminal state.
 *
 * Design D2: `under_resolution` state exists in the schema but is not actively
 * used in Sprint 15.5. Effective lifecycle: open → resolved.
 *
 * Design D4: `kind` defaults to 'dispute_resolution'; falls through to the
 * DoA matrix __default__ row (escalate_to_authority).
 *
 * Transaction contract: same pool.connect() / BEGIN / COMMIT / ROLLBACK pattern
 * as all other Phase 15 services. Lock order: `dispute → topics`.
 */

import type { PoolClient } from 'pg';
import { getDbPool } from '../db/client.js';
import { ContextHubError } from '../core/errors.js';
import { assertTopicScope, assertDisputeScope } from '../core/security/scopeResolvers.js';
import type { CallerScope } from '../core/security/callerScope.js';
import { appendEvent } from './coordinationEvents.js';
import { submitRequest } from './requests.js';
import { createModuleLogger } from '../utils/logger.js';

const logger = createModuleLogger('disputes');

// ── Types ─────────────────────────────────────────────────────────────────────

export type DisputeStatus = 'open' | 'under_resolution' | 'resolved';

export type Dispute = {
  dispute_id: string;
  topic_id: string;
  subject_ref: string;
  parties: string[];
  status: DisputeStatus;
  resolution_request_id: string | null;
  created_at: string;
};

export type RequestStep = {
  step_index: number;
  target_office: string;
  status: string;
  decided_by: string | null;
  decided_at: string | null;
};

export type DisputeDetail = Dispute & {
  resolution_request: {
    request_id: string;
    status: string;
    steps: RequestStep[];
  } | null;
};

// ── §2.2 openDispute ──────────────────────────────────────────────────────────

export async function openDispute(params: {
  topic_id: string;
  /** DEFERRED-029: caller's scope; enforced via the topic's derived project_id. */
  callerScope?: CallerScope;
  subject_ref: string;
  parties: string[];
  procedure: 'unilateral' | 'collective';
  submitted_by: string;
  kind?: string;
  weight?: number;
}): Promise<{ dispute: Dispute; resolution_request_id: string }> {
  const topicId = (params.topic_id ?? '').trim();
  const subjectRef = (params.subject_ref ?? '').trim();
  const parties = params.parties ?? [];
  const procedure = (params.procedure ?? '').trim() as 'unilateral' | 'collective';
  const submittedBy = (params.submitted_by ?? '').trim();
  const kind = (params.kind ?? 'dispute_resolution').trim();
  const weight = params.weight ?? 1;

  if (!topicId || !subjectRef || !submittedBy) {
    throw new ContextHubError('BAD_REQUEST', 'topic_id, subject_ref, submitted_by are required');
  }
  if (parties.length < 2) {
    throw new ContextHubError('BAD_REQUEST', 'parties must have at least 2 members (D7)');
  }
  if (procedure !== 'unilateral' && procedure !== 'collective') {
    throw new ContextHubError('BAD_REQUEST', `procedure must be 'unilateral' or 'collective'`);
  }
  // Sprint 15.5: collective procedure for disputes routes through a future motion-based step.
  // For now only 'unilateral' is supported (DEFERRED-018 — collective request steps).
  if (procedure === 'collective') {
    throw new ContextHubError('BAD_REQUEST', 'collective dispute procedure is Sprint 15.6 (DEFERRED-018)');
  }

  const pool = getDbPool();

  // DEFERRED-029: enforce tenant scope via the topic's derived project_id before any reads.
  await assertTopicScope(pool, params.callerScope, topicId);

  // Pre-check: topic exists and is active
  const topicRes = await pool.query<{ status: string }>(
    `SELECT status FROM topics WHERE topic_id=$1`,
    [topicId],
  );
  if (topicRes.rowCount === 0) {
    throw new ContextHubError('NOT_FOUND', `topic ${topicId} not found`);
  }
  if (topicRes.rows[0].status !== 'active') {
    throw new ContextHubError('TOPIC_NOT_ACTIVE', `topic ${topicId} is not active`);
  }

  // Step 1: INSERT dispute row (status='open', resolution_request_id=null initially)
  const insertRes = await pool.query<Dispute>(
    `INSERT INTO disputes (topic_id, subject_ref, parties, status)
     VALUES ($1, $2, $3, 'open')
     RETURNING dispute_id, topic_id, subject_ref, parties, status, resolution_request_id,
               created_at::text AS created_at`,
    [topicId, subjectRef, parties],
  );
  const dispute = insertRes.rows[0];
  const disputeId = dispute.dispute_id;

  // Step 2: submit the resolution request (uses its own connection/transaction).
  // callerScope is forwarded so submitRequest's own assertTopicScope is a no-op
  // (we already enforced above) but the contract is preserved end-to-end.
  const submitResult = await submitRequest({
    topic_id: topicId,
    callerScope: params.callerScope,
    subject_type: 'dispute',
    subject_id: disputeId,
    kind,
    weight,
    procedure,
    submitted_by: submittedBy,
  });

  if (submitResult.status === 'not_participant') {
    // Clean up the orphaned dispute row before throwing
    await pool.query(`DELETE FROM disputes WHERE dispute_id=$1`, [disputeId]);
    throw new ContextHubError('NOT_FOUND', `submitter '${submittedBy}' is not a participant of topic ${topicId}`);
  }
  if (submitResult.status === 'topic_closed') {
    await pool.query(`DELETE FROM disputes WHERE dispute_id=$1`, [disputeId]);
    throw new ContextHubError('TOPIC_NOT_ACTIVE', `topic ${topicId} is closed`);
  }
  if (submitResult.status !== 'submitted') {
    await pool.query(`DELETE FROM disputes WHERE dispute_id=$1`, [disputeId]);
    throw new ContextHubError('BAD_REQUEST', `submitRequest returned unexpected status: ${submitResult.status}`);
  }

  const resolutionRequestId = submitResult.request_id;

  // Step 3: update dispute with resolution_request_id.
  // If this UPDATE fails after submitRequest committed, compensate by deleting both rows.
  let updatedDispute: Dispute;
  try {
    const updateRes = await pool.query<Dispute>(
      `UPDATE disputes SET resolution_request_id=$1 WHERE dispute_id=$2
       RETURNING dispute_id, topic_id, subject_ref, parties, status, resolution_request_id,
                 created_at::text AS created_at`,
      [resolutionRequestId, disputeId],
    );
    updatedDispute = updateRes.rows[0];
  } catch (updateErr) {
    // Compensating cleanup: remove orphaned request + dispute to avoid irrecoverable state.
    await pool.query(`DELETE FROM request_steps WHERE request_id=$1`, [resolutionRequestId]).catch(() => {});
    await pool.query(`DELETE FROM requests WHERE request_id=$1`, [resolutionRequestId]).catch(() => {});
    await pool.query(`DELETE FROM disputes WHERE dispute_id=$1`, [disputeId]).catch(() => {});
    logger.error({ err: String(updateErr) }, 'openDispute Step 3 UPDATE failed — compensating cleanup attempted');
    throw updateErr;
  }

  // Step 4: emit dispute.opened event (inside its own transaction via client)
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    await appendEvent(client, {
      topic_id: topicId,
      actor_id: submittedBy,
      type: 'dispute.opened',
      subject_type: 'dispute',
      subject_id: disputeId,
      payload: {
        subject_ref: subjectRef,
        parties,
        procedure,
        resolution_request_id: resolutionRequestId,
      },
    });
    await client.query('COMMIT');
  } catch (err) {
    await client.query('ROLLBACK').catch(() => {});
    logger.error({ err: String(err) }, 'openDispute appendEvent failed');
    // Dispute + request already exist; the missing event is acceptable (log-gap semantics)
  } finally {
    client.release();
  }

  return { dispute: updatedDispute, resolution_request_id: resolutionRequestId };
}

// ── §2.2 resolveDispute ───────────────────────────────────────────────────────

const TERMINAL_REQUEST_STATUSES = new Set(['approved', 'returned', 'rejected']);

export async function resolveDispute(
  dispute_id: string,
  /** DEFERRED-029: caller's scope; enforced via the dispute's derived project_id. */
  opts?: { callerScope?: CallerScope },
): Promise<Dispute> {
  const disputeId = (dispute_id ?? '').trim();
  if (!disputeId) throw new ContextHubError('BAD_REQUEST', 'dispute_id is required');

  const pool = getDbPool();
  await assertDisputeScope(pool, opts?.callerScope, disputeId);
  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    // Lock dispute row to serialize concurrent resolveDispute calls
    const disputeRes = await client.query<Dispute>(
      `SELECT dispute_id, topic_id, subject_ref, parties, status, resolution_request_id,
              created_at::text AS created_at
         FROM disputes WHERE dispute_id=$1 FOR UPDATE`,
      [disputeId],
    );
    if (disputeRes.rowCount === 0) {
      await client.query('ROLLBACK');
      throw new ContextHubError('NOT_FOUND', `dispute ${disputeId} not found`);
    }
    const dispute = disputeRes.rows[0];

    if (dispute.status === 'resolved') {
      await client.query('ROLLBACK');
      throw new ContextHubError('ALREADY_RESOLVED', `dispute ${disputeId} is already resolved`);
    }

    // Check the resolution request is terminal
    if (!dispute.resolution_request_id) {
      await client.query('ROLLBACK');
      throw new ContextHubError('RESOLUTION_PENDING', `dispute ${disputeId} has no resolution request yet`);
    }

    const reqRes = await client.query<{ status: string }>(
      `SELECT status FROM requests WHERE request_id=$1`,
      [dispute.resolution_request_id],
    );
    if (reqRes.rowCount === 0) {
      await client.query('ROLLBACK');
      throw new ContextHubError('NOT_FOUND', `resolution request ${dispute.resolution_request_id} not found`);
    }
    const reqStatus = reqRes.rows[0].status;
    if (!TERMINAL_REQUEST_STATUSES.has(reqStatus)) {
      await client.query('ROLLBACK');
      throw new ContextHubError(
        'RESOLUTION_PENDING',
        `resolution request is still '${reqStatus}' — wait for approved/returned/rejected`,
      );
    }

    // Transition dispute to resolved
    const updateRes = await client.query<Dispute>(
      `UPDATE disputes SET status='resolved' WHERE dispute_id=$1
       RETURNING dispute_id, topic_id, subject_ref, parties, status, resolution_request_id,
                 created_at::text AS created_at`,
      [disputeId],
    );
    const resolved = updateRes.rows[0];

    await appendEvent(client, {
      topic_id: dispute.topic_id,
      actor_id: dispute.parties[0] ?? 'system:resolve',
      type: 'dispute.resolved',
      subject_type: 'dispute',
      subject_id: disputeId,
      payload: {
        resolution_request_id: dispute.resolution_request_id,
        request_status: reqStatus,
      },
    });

    await client.query('COMMIT');
    return resolved;
  } catch (err) {
    await client.query('ROLLBACK').catch(() => {});
    if (err instanceof ContextHubError) throw err;
    logger.error({ err: String(err) }, 'resolveDispute failed');
    throw err;
  } finally {
    client.release();
  }
}

// ── §2.2 getDispute ───────────────────────────────────────────────────────────

export async function getDispute(
  dispute_id: string,
  /** DEFERRED-029: caller's scope; enforced via the dispute's derived project_id. */
  opts?: { callerScope?: CallerScope },
): Promise<DisputeDetail> {
  const disputeId = (dispute_id ?? '').trim();
  if (!disputeId) throw new ContextHubError('BAD_REQUEST', 'dispute_id is required');

  const pool = getDbPool();
  await assertDisputeScope(pool, opts?.callerScope, disputeId);
  const disputeRes = await pool.query<Dispute>(
    `SELECT dispute_id, topic_id, subject_ref, parties, status, resolution_request_id,
            created_at::text AS created_at
       FROM disputes WHERE dispute_id=$1`,
    [disputeId],
  );
  if (disputeRes.rowCount === 0) {
    throw new ContextHubError('NOT_FOUND', `dispute ${disputeId} not found`);
  }
  const dispute = disputeRes.rows[0];

  let resolutionRequest = null;
  if (dispute.resolution_request_id) {
    const reqRes = await pool.query<{ request_id: string; status: string }>(
      `SELECT request_id, status FROM requests WHERE request_id=$1`,
      [dispute.resolution_request_id],
    );
    if ((reqRes.rowCount ?? 0) > 0) {
      const req = reqRes.rows[0];
      const stepsRes = await pool.query<RequestStep>(
        `SELECT step_index, target_office, status,
                decided_by, decided_at::text AS decided_at
           FROM request_steps WHERE request_id=$1 ORDER BY step_index`,
        [dispute.resolution_request_id],
      );
      resolutionRequest = {
        request_id: req.request_id,
        status: req.status,
        steps: stepsRes.rows,
      };
    }
  }

  return { ...dispute, resolution_request: resolutionRequest };
}

// ── §2.2 listDisputes ─────────────────────────────────────────────────────────

export async function listDisputes(
  topic_id: string,
  opts?: {
    status?: string;
    limit?: number;
    offset?: number;
    /** DEFERRED-029: caller's scope; enforced via the topic's derived project_id. */
    callerScope?: CallerScope;
  },
): Promise<{ disputes: Dispute[]; total: number }> {
  const topicId = (topic_id ?? '').trim();
  if (!topicId) throw new ContextHubError('BAD_REQUEST', 'topic_id is required');

  const pool = getDbPool();
  await assertTopicScope(pool, opts?.callerScope, topicId);
  const params: unknown[] = [topicId];
  const conditions: string[] = ['topic_id=$1'];

  if (opts?.status) {
    params.push(opts.status);
    conditions.push(`status=$${params.length}`);
  }

  const where = conditions.join(' AND ');
  const limit = Math.min(opts?.limit ?? 50, 200);
  const offset = opts?.offset ?? 0;

  const [disputesRes, countRes] = await Promise.all([
    pool.query<Dispute>(
      `SELECT dispute_id, topic_id, subject_ref, parties, status, resolution_request_id,
              created_at::text AS created_at
         FROM disputes
        WHERE ${where}
        ORDER BY created_at DESC
        LIMIT $${params.length + 1} OFFSET $${params.length + 2}`,
      [...params, limit, offset],
    ),
    pool.query<{ count: string }>(
      `SELECT COUNT(*) AS count FROM disputes WHERE ${where}`,
      params,
    ),
  ]);

  return {
    disputes: disputesRes.rows,
    total: parseInt(countRes.rows[0].count, 10),
  };
}
