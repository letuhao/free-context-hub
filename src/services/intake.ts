/**
 * Phase 15 Sprint 15.5 — Intake mailbox.
 *
 * Design ref: docs/specs/2026-05-18-phase-15-sprint-15.5-design.md §2.1
 * Spec hash:  a506ddd08a5c6dfc
 *
 * An `intake_item` is an inbound item that belongs to no current task (design B.8).
 * It is triaged into an existing task/request/motion or a new dispute.
 *
 * Transaction contract: every fn that emits a coordination event does
 *   `const c = await pool.connect(); try { BEGIN … appendEvent(c,…) … COMMIT }
 *    catch (e) { await c.query('ROLLBACK').catch(()=>{}); throw e }
 *    finally { c.release() }`
 *
 * Lock order: `dispute → topics`. triageIntake FOR UPDATEs intake_items before
 * calling openDispute (which acquires its own connections).
 */

import type { PoolClient } from 'pg';
import { getDbPool } from '../db/client.js';
import { ContextHubError } from '../core/errors.js';
import { assertAuthorized } from './authorize.js';
import { appendEvent } from './coordinationEvents.js';
import { createModuleLogger } from '../utils/logger.js';

const logger = createModuleLogger('intake');

// ── Types ─────────────────────────────────────────────────────────────────────

export type IntakeKind = 'violation_report' | 'suggestion' | 'request';
export type IntakeStatus = 'received' | 'triaged' | 'dismissed';

export type IntakeItem = {
  intake_id: string;
  project_id: string;
  topic_id: string | null;
  kind: IntakeKind;
  body: string;
  submitted_by: string;
  status: IntakeStatus;
  routed_to: string | null;
  created_at: string;
};

type TriageRouteLinkOnly = {
  route_kind: 'task' | 'request' | 'motion';
  actor_id: string;
  topic_id: string;
  routed_to: string;
};

type TriageRouteDispute = {
  route_kind: 'dispute';
  actor_id: string;
  topic_id: string;
  subject_ref: string;
  parties: string[];
  procedure: 'unilateral' | 'collective';
  submitted_by: string;
  kind?: string;
  weight?: number;
};

export type TriageRoute = TriageRouteLinkOnly | TriageRouteDispute;

export type TriageResult = {
  intake_id: string;
  status: IntakeStatus;
  routed_to: string;
  dispute_id?: string;
  resolution_request_id?: string;
};

const VALID_KINDS: ReadonlySet<string> = new Set(['violation_report', 'suggestion', 'request']);

// ── §2.1 submitIntake ─────────────────────────────────────────────────────────

export async function submitIntake(params: {
  project_id: string;
  /** F2f — acting principal; authorize() gate (project scope). */
  actingPrincipalId?: string | null;
  topic_id?: string;
  kind: string;
  body: string;
  submitted_by: string;
}): Promise<IntakeItem> {
  const projectId = (params.project_id ?? '').trim();
  const topicId = params.topic_id ? params.topic_id.trim() : null;
  const kind = (params.kind ?? '').trim();
  const body = (params.body ?? '').trim();
  const submittedBy = (params.submitted_by ?? '').trim();

  if (!projectId || !kind || !body || !submittedBy) {
    throw new ContextHubError('BAD_REQUEST', 'project_id, kind, body, submitted_by are required');
  }
  await assertAuthorized(params.actingPrincipalId, 'write', { kind: 'project', id: projectId });
  if (!VALID_KINDS.has(kind)) {
    throw new ContextHubError(
      'BAD_REQUEST',
      `kind must be one of: violation_report, suggestion, request; got: ${kind}`,
    );
  }
  const MAX_BODY_LEN = 16_384;
  if (body.length > MAX_BODY_LEN) {
    throw new ContextHubError('BAD_REQUEST', `body must be at most ${MAX_BODY_LEN} characters`);
  }

  const pool = getDbPool();

  // Pre-checks (plain pool — no lock needed)
  const projRes = await pool.query(`SELECT 1 FROM projects WHERE project_id=$1`, [projectId]);
  if (projRes.rowCount === 0) {
    throw new ContextHubError('NOT_FOUND', `project ${projectId} not found`);
  }

  if (topicId) {
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
  }

  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    const insertRes = await client.query<IntakeItem>(
      `INSERT INTO intake_items (project_id, topic_id, kind, body, submitted_by)
       VALUES ($1, $2, $3, $4, $5)
       RETURNING intake_id, project_id, topic_id, kind, body, submitted_by, status, routed_to,
                 created_at::text AS created_at`,
      [projectId, topicId, kind, body, submittedBy],
    );
    const row = insertRes.rows[0];

    if (topicId) {
      await appendEvent(client, {
        topic_id: topicId,
        actor_id: submittedBy,
        type: 'intake.received',
        subject_type: 'intake',
        subject_id: row.intake_id,
        payload: { project_id: projectId, kind, submitted_by: submittedBy },
      });
    }

    await client.query('COMMIT');
    return row;
  } catch (err) {
    await client.query('ROLLBACK').catch(() => {});
    logger.error({ err: String(err) }, 'submitIntake failed');
    throw err;
  } finally {
    client.release();
  }
}

// ── §2.1 triageIntake ─────────────────────────────────────────────────────────

export async function triageIntake(
  intake_id: string,
  route: TriageRoute,
  /** DEFERRED-029: caller's scope; enforced via the intake's project_id (and propagated to openDispute). */
  opts?: { actingPrincipalId?: string | null },
): Promise<TriageResult> {
  const intakeId = (intake_id ?? '').trim();
  const topicId = (route.topic_id ?? '').trim();
  const actorId = (route.actor_id ?? '').trim();
  if (!intakeId || !topicId || !actorId) {
    throw new ContextHubError('BAD_REQUEST', 'intake_id, topic_id, actor_id are required');
  }

  const pool = getDbPool();
  await assertAuthorized(opts?.actingPrincipalId, 'write', { kind: 'intake', id: intakeId });
  // PR F SEC-2 (Adversary CRITICAL #2): route.topic_id is caller-supplied
  // and was NEVER scope-checked on the link-only path. A scoped-A attacker
  // could pass a cross-tenant topic_id and have triageIntake write an
  // intake.triaged event into proj-B's coordination_events log (and
  // corrupt the intake row's topic_id FK). Gate on assertTopicScope BEFORE
  // any read/write that uses route.topic_id. Dispute path also benefits
  // (openDispute would re-check, but here we stop earlier with same shape).
  await assertAuthorized(opts?.actingPrincipalId, 'write', { kind: 'topic', id: topicId });

  // Validate topic is active before acquiring the intake row lock
  const topicCheck = await pool.query<{ status: string }>(
    `SELECT status FROM topics WHERE topic_id=$1`,
    [topicId],
  );
  if (topicCheck.rowCount === 0) {
    throw new ContextHubError('NOT_FOUND', `topic ${topicId} not found`);
  }
  if (topicCheck.rows[0].status !== 'active') {
    throw new ContextHubError('TOPIC_NOT_ACTIVE', `topic ${topicId} is not active`);
  }

  // D9 (WARN-2 fix): FOR UPDATE serializes concurrent triage calls.
  // openDispute is called inside the try block but uses its own pool connection.
  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    // Lock the intake row to prevent concurrent triage
    const lockRes = await client.query<IntakeItem>(
      `SELECT * FROM intake_items WHERE intake_id=$1 FOR UPDATE`,
      [intakeId],
    );
    if (lockRes.rowCount === 0) {
      await client.query('ROLLBACK');
      throw new ContextHubError('NOT_FOUND', `intake item ${intakeId} not found`);
    }
    const current = lockRes.rows[0];
    if (current.status !== 'received') {
      await client.query('ROLLBACK');
      if (current.status === 'triaged') {
        throw new ContextHubError('INTAKE_ALREADY_TRIAGED', `intake item ${intakeId} is already triaged`);
      }
      throw new ContextHubError('INTAKE_ALREADY_DISMISSED', `intake item ${intakeId} is already dismissed`);
    }

    let routedTo: string;
    let disputeId: string | undefined;
    let resolutionRequestId: string | undefined;

    if (route.route_kind === 'dispute') {
      // openDispute uses its own pool connection (separate transaction).
      // Partial-failure risk: if UPDATE below fails after openDispute commits,
      // intake stays 'received' but dispute exists (documented in design D9 note).
      const { openDispute } = await import('./disputes.js');
      const disputeRes = await openDispute({
        topic_id: topicId,
        actingPrincipalId: opts?.actingPrincipalId,
        subject_ref: route.subject_ref,
        parties: route.parties,
        procedure: route.procedure,
        submitted_by: route.submitted_by,
        kind: route.kind,
        weight: route.weight,
      });
      disputeId = disputeRes.dispute.dispute_id;
      resolutionRequestId = disputeRes.resolution_request_id;
      routedTo = disputeId;
    } else {
      const routed = (route.routed_to ?? '').trim();
      if (!routed) {
        await client.query('ROLLBACK');
        throw new ContextHubError('BAD_REQUEST', 'routed_to is required for link-only routes');
      }
      routedTo = routed;
    }

    const updateRes = await client.query<IntakeItem>(
      `UPDATE intake_items
          SET status='triaged', topic_id=$2, routed_to=$3
        WHERE intake_id=$1
        RETURNING intake_id, project_id, topic_id, kind, body, submitted_by, status, routed_to,
                  created_at::text AS created_at`,
      [intakeId, topicId, routedTo],
    );

    await appendEvent(client, {
      topic_id: topicId,
      actor_id: actorId,
      type: 'intake.triaged',
      subject_type: 'intake',
      subject_id: intakeId,
      payload: {
        route_kind: route.route_kind,
        routed_to: routedTo,
        ...(disputeId ? { dispute_id: disputeId } : {}),
      },
    });

    await client.query('COMMIT');
    return {
      intake_id: intakeId,
      status: 'triaged',
      routed_to: routedTo,
      ...(disputeId ? { dispute_id: disputeId, resolution_request_id: resolutionRequestId } : {}),
    };
  } catch (err) {
    await client.query('ROLLBACK').catch(() => {});
    if (err instanceof ContextHubError) throw err;
    logger.error({ err: String(err) }, 'triageIntake failed');
    throw err;
  } finally {
    client.release();
  }
}

// ── §2.1 dismissIntake ────────────────────────────────────────────────────────

export async function dismissIntake(
  intake_id: string,
  /** DEFERRED-029: caller's scope; enforced via the intake's project_id. */
  opts?: { actingPrincipalId?: string | null },
): Promise<IntakeItem> {
  const intakeId = (intake_id ?? '').trim();
  if (!intakeId) {
    throw new ContextHubError('BAD_REQUEST', 'intake_id is required');
  }

  const pool = getDbPool();
  await assertAuthorized(opts?.actingPrincipalId, 'write', { kind: 'intake', id: intakeId });
  const res = await pool.query<IntakeItem>(
    `UPDATE intake_items
        SET status='dismissed'
      WHERE intake_id=$1 AND status='received'
      RETURNING intake_id, project_id, topic_id, kind, body, submitted_by, status, routed_to,
                created_at::text AS created_at`,
    [intakeId],
  );

  if (res.rowCount === 0) {
    // Distinguish: not found vs already processed
    const existing = await pool.query<{ status: string }>(
      `SELECT status FROM intake_items WHERE intake_id=$1`,
      [intakeId],
    );
    if (existing.rowCount === 0) {
      throw new ContextHubError('NOT_FOUND', `intake item ${intakeId} not found`);
    }
    const status = existing.rows[0].status;
    if (status === 'triaged') {
      throw new ContextHubError('INTAKE_ALREADY_TRIAGED', `intake item ${intakeId} is already triaged`);
    }
    throw new ContextHubError('INTAKE_ALREADY_DISMISSED', `intake item ${intakeId} is already dismissed`);
  }

  return res.rows[0];
}

// ── §2.1 getIntake ────────────────────────────────────────────────────────────

export async function getIntake(
  intake_id: string,
  /** DEFERRED-029: caller's scope; enforced via the intake's project_id. */
  opts?: { actingPrincipalId?: string | null },
): Promise<IntakeItem> {
  const intakeId = (intake_id ?? '').trim();
  if (!intakeId) throw new ContextHubError('BAD_REQUEST', 'intake_id is required');

  const pool = getDbPool();
  await assertAuthorized(opts?.actingPrincipalId, 'read', { kind: 'intake', id: intakeId });
  const res = await pool.query<IntakeItem>(
    `SELECT intake_id, project_id, topic_id, kind, body, submitted_by, status, routed_to,
            created_at::text AS created_at
       FROM intake_items WHERE intake_id=$1`,
    [intakeId],
  );

  if (res.rowCount === 0) {
    throw new ContextHubError('NOT_FOUND', `intake item ${intakeId} not found`);
  }
  return res.rows[0];
}

// ── §2.1 listIntake ───────────────────────────────────────────────────────────

export async function listIntake(
  project_id: string,
  opts?: {
    kind?: string;
    status?: string;
    limit?: number;
    offset?: number;
    /** F2f — acting principal; authorize() gate (project scope). */
    actingPrincipalId?: string | null;
  },
): Promise<{ items: IntakeItem[]; total: number }> {
  const projectId = (project_id ?? '').trim();
  if (!projectId) throw new ContextHubError('BAD_REQUEST', 'project_id is required');
  await assertAuthorized(opts?.actingPrincipalId, 'read', { kind: 'project', id: projectId });

  const pool = getDbPool();
  const params: unknown[] = [projectId];
  const conditions: string[] = ['project_id=$1'];

  if (opts?.kind) {
    params.push(opts.kind);
    conditions.push(`kind=$${params.length}`);
  }
  if (opts?.status) {
    params.push(opts.status);
    conditions.push(`status=$${params.length}`);
  }

  const where = conditions.join(' AND ');
  const limit = Math.min(opts?.limit ?? 50, 200);
  const offset = opts?.offset ?? 0;

  const [itemsRes, countRes] = await Promise.all([
    pool.query<IntakeItem>(
      `SELECT intake_id, project_id, topic_id, kind, body, submitted_by, status, routed_to,
              created_at::text AS created_at
         FROM intake_items
        WHERE ${where}
        ORDER BY created_at DESC
        LIMIT $${params.length + 1} OFFSET $${params.length + 2}`,
      [...params, limit, offset],
    ),
    pool.query<{ count: string }>(
      `SELECT COUNT(*) AS count FROM intake_items WHERE ${where}`,
      params,
    ),
  ]);

  return {
    items: itemsRes.rows,
    total: parseInt(countRes.rows[0].count, 10),
  };
}
