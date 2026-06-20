import { randomUUID } from 'node:crypto';
import amqplib from 'amqplib';

import { getDbPool } from '../db/client.js';
import { getEnv } from '../env.js';
import { ContextHubError } from '../core/errors.js';
import { assertAuthorized, hasGlobalGrant } from './authorize.js';

export type JobType =
  | 'repo.sync'
  | 'workspace.scan'
  | 'workspace.delta_index'
  | 'index.run'
  | 'git.ingest'
  | 'quality.eval'
  | 'knowledge.refresh'
  | 'faq.build'
  | 'raptor.build'
  | 'knowledge.loop.shallow'
  | 'knowledge.loop.deep'
  | 'knowledge.memory.build'
  | 'document.extract.vision'
  | 'leases.sweep';

type JobStatus = 'queued' | 'running' | 'succeeded' | 'failed' | 'dead_letter' | 'cancelled';

type QueuePayload = {
  project_id?: string;
  /** F2f: acting principal; authorize() enforces write on project_id. */
  actingPrincipalId?: string | null;
  job_type: JobType;
  payload: Record<string, unknown>;
  correlation_id?: string;
  queue_name?: string;
  max_attempts?: number;
};

let rabbitConn: any | null = null;
let rabbitChannel: any | null = null;

async function getRabbit(): Promise<any | null> {
  const env = getEnv();
  if (!env.QUEUE_ENABLED || env.QUEUE_BACKEND !== 'rabbitmq' || !env.RABBITMQ_URL) return null;
  if (rabbitChannel) return rabbitChannel;
  rabbitConn = await amqplib.connect(env.RABBITMQ_URL);
  rabbitChannel = await rabbitConn.createChannel();
  const exchange = env.RABBITMQ_EXCHANGE || 'contexthub.jobs';
  await rabbitChannel.assertExchange(exchange, 'topic', { durable: true });
  return rabbitChannel;
}

function routingKey(jobType: JobType): string {
  return `jobs.${jobType.replace(/\./g, '_')}`;
}

function queueNameFor(queueName: string): string {
  return `contexthub.${queueName}`;
}

async function ensureRabbitQueue(queueName: string): Promise<void> {
  const env = getEnv();
  const ch = await getRabbit();
  if (!ch) return;
  const exchange = env.RABBITMQ_EXCHANGE || 'contexthub.jobs';
  const q = queueNameFor(queueName);
  await ch.assertQueue(q, { durable: true });
  // Bind all job types for this project queue.
  await ch.bindQueue(q, exchange, 'jobs.#');
}

export async function enqueueJob(input: QueuePayload): Promise<{ status: 'queued'; job_id: string; backend: 'postgres' | 'rabbitmq' }> {
  // [DEFERRED-045] actor-native re-implementation of PR F's SEC-1/3/5/6. The actor model has no single
  // "caller scope" to auto-bind to, so:
  //  - project_id is REQUIRED unless the caller is GLOBALLY privileged (a global-write grant or root);
  //    a project-scoped principal must name a project it can write (authorize() enforces it). This
  //    closes SEC-3 (no silently-unscoped job from a non-global caller).
  //  - SEC-6: payload.root walks an ARBITRARY filesystem path that the worker indexes under the bound
  //    project_id (a cross-tenant filesystem write). That is a GLOBAL capability — only a globally
  //    privileged principal may pass it; everyone else must let the worker resolve the root from
  //    project_sources for the bound project_id.
  const isGlobal = await hasGlobalGrant(input.actingPrincipalId, 'write');
  if (input.project_id) {
    await assertAuthorized(input.actingPrincipalId, 'write', { kind: 'project', id: input.project_id });
  } else if (!isGlobal) {
    throw new ContextHubError(
      'BAD_REQUEST',
      'project_id is required — only a globally-privileged principal may enqueue an unscoped job',
    );
  }
  const payloadRoot = (input.payload as Record<string, unknown> | undefined)?.root;
  const hasExplicitRoot = typeof payloadRoot === 'string' && payloadRoot.trim().length > 0;
  if (hasExplicitRoot && !isGlobal) {
    throw new ContextHubError(
      'BAD_REQUEST',
      'only a globally-privileged principal may specify payload.root — the worker resolves the root from project_sources for the bound project_id',
    );
  }
  // [DEFERRED-048 REVIEW-CODE #2] `payload.cache_root` is the SAME arbitrary-filesystem capability by a
  // different name: repo.sync computes `repo_root = resolve(cache_root, project)` and re-enqueues
  // index.run with that root stamped by the SYSTEM principal — so a non-global caller could launder an
  // attacker-chosen parent dir (`/`, `../..`) into a global stamp (confused deputy). Gate it identically:
  // only a globally-privileged principal may override the repo cache location.
  const payloadCacheRoot = (input.payload as Record<string, unknown> | undefined)?.cache_root;
  if (typeof payloadCacheRoot === 'string' && payloadCacheRoot.trim().length > 0 && !isGlobal) {
    throw new ContextHubError(
      'BAD_REQUEST',
      'only a globally-privileged principal may specify payload.cache_root — the worker uses the configured repo cache base for the bound project_id',
    );
  }
  // [DEFERRED-048] Stamp WHO authorized the arbitrary root (a global principal — guaranteed by the gate
  // above) so execution (resolveRoot) can re-verify across the durable-queue boundary. OVERWRITE any
  // caller-supplied value — never trust the payload's own authorizer claim — and strip it when no root
  // is set, so a forged stamp can never ride along. Under auth-off actingPrincipalId is null → the stamp
  // is null and the exec check is inert (honored as today).
  const stampedPayload: Record<string, unknown> = { ...((input.payload as Record<string, unknown>) ?? {}) };
  if (hasExplicitRoot) {
    stampedPayload.root_authorized_by = input.actingPrincipalId ?? null;
  } else {
    delete stampedPayload.root_authorized_by;
  }
  const pool = getDbPool();
  const jobId = randomUUID();
  const queueName = input.queue_name ?? 'default';
  const correlationId = input.correlation_id ?? randomUUID();
  const maxAttempts = Math.max(1, Math.trunc(input.max_attempts ?? 3));

  await pool.query(
    `INSERT INTO async_jobs(job_id, project_id, job_type, queue_name, payload, correlation_id, status, max_attempts, available_at, queued_at)
     VALUES ($1,$2,$3,$4,$5::jsonb,$6,'queued',$7, now(), now())`,
    [jobId, input.project_id ?? null, input.job_type, queueName, JSON.stringify(stampedPayload), correlationId, maxAttempts],
  );

  const env = getEnv();
  if (env.QUEUE_ENABLED && env.QUEUE_BACKEND === 'rabbitmq') {
    const ch = await getRabbit();
    if (ch) {
      await ensureRabbitQueue(queueName);
      const exchange = env.RABBITMQ_EXCHANGE || 'contexthub.jobs';
      const body = Buffer.from(JSON.stringify({ job_id: jobId, project_id: input.project_id ?? null, job_type: input.job_type }));
      ch.publish(exchange, routingKey(input.job_type), body, {
        persistent: true,
        correlationId,
        messageId: jobId,
        contentType: 'application/json',
      });
      return { status: 'queued', job_id: jobId, backend: 'rabbitmq' };
    }
  }

  return { status: 'queued', job_id: jobId, backend: 'postgres' };
}

export async function claimNextQueuedJob(
  queueName = 'default',
  projectScope?: string | null,
): Promise<{
  job_id: string;
  project_id: string | null;
  job_type: JobType;
  payload: Record<string, unknown>;
  attempts: number;
  max_attempts: number;
  correlation_id: string | null;
} | null> {
  const pool = getDbPool();
  // DEFERRED-024 — when a non-empty projectScope is supplied (a project-scoped api
  // key calling /run-next), the pop is restricted to that project's queue so a scoped
  // worker drains only its own jobs. undefined/null → pop across all projects (the
  // background worker + auth-off + global-scope keys are unchanged).
  const scoped = typeof projectScope === 'string' && projectScope.length > 0;
  const res = await pool.query(
    `WITH next_job AS (
       SELECT job_id
       FROM async_jobs
       WHERE status='queued' AND queue_name=$1 AND available_at <= now()
         ${scoped ? 'AND project_id = $2' : ''}
       ORDER BY queued_at ASC
       LIMIT 1
       FOR UPDATE SKIP LOCKED
     )
     UPDATE async_jobs j
     SET status='running', attempts=j.attempts + 1, started_at=now()
     FROM next_job
     WHERE j.job_id = next_job.job_id
     RETURNING j.job_id, j.project_id, j.job_type, j.payload, j.attempts, j.max_attempts, j.correlation_id`,
    scoped ? [queueName, projectScope] : [queueName],
  );
  if (!res.rowCount) return null;
  const row = res.rows[0] as any;
  return {
    job_id: String(row.job_id),
    project_id: row.project_id ? String(row.project_id) : null,
    job_type: String(row.job_type) as JobType,
    payload: (row.payload ?? {}) as Record<string, unknown>,
    attempts: Number(row.attempts ?? 0),
    max_attempts: Number(row.max_attempts ?? 3),
    correlation_id: row.correlation_id != null ? String(row.correlation_id) : null,
  };
}

export async function claimQueuedJobById(jobId: string): Promise<{
  job_id: string;
  project_id: string | null;
  job_type: JobType;
  payload: Record<string, unknown>;
  attempts: number;
  max_attempts: number;
  correlation_id: string | null;
} | null> {
  const pool = getDbPool();
  const res = await pool.query(
    `UPDATE async_jobs j
     SET status='running', attempts=j.attempts + 1, started_at=now()
     WHERE j.job_id=$1 AND j.status='queued' AND j.available_at <= now()
     RETURNING j.job_id, j.project_id, j.job_type, j.payload, j.attempts, j.max_attempts, j.correlation_id`,
    [jobId],
  );
  if (!res.rowCount) return null;
  const row = res.rows[0] as any;
  return {
    job_id: String(row.job_id),
    project_id: row.project_id ? String(row.project_id) : null,
    job_type: String(row.job_type) as JobType,
    payload: (row.payload ?? {}) as Record<string, unknown>,
    attempts: Number(row.attempts ?? 0),
    max_attempts: Number(row.max_attempts ?? 3),
    correlation_id: row.correlation_id != null ? String(row.correlation_id) : null,
  };
}

export async function getRabbitConsumerChannel(queueName = 'default'): Promise<{ ch: any; queue: string } | null> {
  const ch = await getRabbit();
  if (!ch) return null;
  await ensureRabbitQueue(queueName);
  return { ch, queue: queueNameFor(queueName) };
}

export async function completeJob(jobId: string): Promise<void> {
  const pool = getDbPool();
  await pool.query(
    `UPDATE async_jobs
     SET status='succeeded', finished_at=now(), error_message=NULL, progress_pct=100
     WHERE job_id=$1`,
    [jobId],
  );
}

/**
 * Update job progress (called by long-running job handlers).
 * progress is 0..100, message is a short human-readable status.
 */
export async function updateJobProgress(jobId: string, progress: number, message?: string): Promise<void> {
  const pool = getDbPool();
  await pool.query(
    `UPDATE async_jobs
     SET progress_pct = $2, progress_message = $3
     WHERE job_id = $1`,
    [jobId, Math.max(0, Math.min(100, progress)), message ?? null],
  );
}

/**
 * Check if a job has been cancelled. Long-running job handlers should call
 * this between expensive steps (e.g., between pages in vision extraction).
 * Returns true if the job is now in 'cancelled' status.
 */
export async function isJobCancelled(jobId: string): Promise<boolean> {
  const pool = getDbPool();
  const res = await pool.query(
    `SELECT status FROM async_jobs WHERE job_id = $1`,
    [jobId],
  );
  return res.rows[0]?.status === 'cancelled';
}

/**
 * Mark a job as cancelled. Idempotent — if the job is already in a terminal
 * state (succeeded/failed/dead_letter/cancelled), returns false.
 *
 * When `projectId` is supplied the update is scoped to that project so a
 * known job_id from another tenant cannot be cancelled cross-tenant.
 */
export async function cancelJob(
  jobId: string,
  projectId?: string,
  /** F2f: acting principal; authorize() enforces write on projectId. */
  opts?: { actingPrincipalId?: string | null },
): Promise<boolean> {
  // [DEFERRED-045] SEC-5 actor-native: cancelling is a write on the job's project. projectId is
  // REQUIRED unless the caller is globally privileged (who may cancel by job_id alone); a non-global
  // caller cannot cancel without naming a project it can write — no unscoped cross-tenant cancel.
  if (projectId) {
    await assertAuthorized(opts?.actingPrincipalId, 'write', { kind: 'project', id: projectId });
  } else if (!(await hasGlobalGrant(opts?.actingPrincipalId, 'write'))) {
    throw new ContextHubError(
      'BAD_REQUEST',
      'projectId is required to cancel a job — only a globally-privileged principal may cancel by job_id alone',
    );
  }
  const pool = getDbPool();
  const res = projectId
    ? await pool.query(
        `UPDATE async_jobs
         SET status = 'cancelled', finished_at = now(), error_message = 'Cancelled by user'
         WHERE job_id = $1 AND project_id = $2 AND status IN ('queued', 'running')`,
        [jobId, projectId],
      )
    : await pool.query(
        `UPDATE async_jobs
         SET status = 'cancelled', finished_at = now(), error_message = 'Cancelled by user'
         WHERE job_id = $1 AND status IN ('queued', 'running')`,
        [jobId],
      );
  return (res.rowCount ?? 0) > 0;
}

export async function failJob(jobId: string, attempts: number, maxAttempts: number, error: string): Promise<JobStatus> {
  const pool = getDbPool();
  const nextStatus: JobStatus = attempts >= maxAttempts ? 'dead_letter' : 'failed';
  await pool.query(
    `UPDATE async_jobs
     SET status=$2, error_message=$3, finished_at=now(), available_at=CASE WHEN $2='failed' THEN now() + interval '30 seconds' ELSE available_at END
     WHERE job_id=$1`,
    [jobId, nextStatus, error],
  );
  if (nextStatus === 'failed') {
    await pool.query(
      `UPDATE async_jobs
       SET status='queued', started_at=NULL, finished_at=NULL
       WHERE job_id=$1`,
      [jobId],
    );
  }
  return nextStatus;
}

export async function listJobs(params: {
  projectId?: string;
  projectIds?: string[];
  /** F2f: acting principal; authorize() enforces read on projectId / projectIds. */
  actingPrincipalId?: string | null;
  correlationId?: string;
  status?: JobStatus;
  limit?: number;
  offset?: number;
}): Promise<{
  items: Array<{
    job_id: string;
    project_id: string | null;
    job_type: JobType;
    correlation_id: string | null;
    status: JobStatus;
    attempts: number;
    max_attempts: number;
    queued_at: any;
    started_at: any;
    finished_at: any;
    error_message: string | null;
  }>;
  total_count: number;
}> {
  // [DEFERRED-045] SEC-1 actor-native: read on every named project (strict-reject). A caller with
  // NO project filter would otherwise hit `WHERE 1=1` (every project's jobs) — allow that ONLY for a
  // globally-privileged principal; everyone else MUST name a project filter.
  const ids = params.projectIds ?? (params.projectId ? [params.projectId] : []);
  if (ids.length > 0) {
    for (const pid of ids) {
      await assertAuthorized(params.actingPrincipalId, 'read', { kind: 'project', id: pid });
    }
  } else if (!(await hasGlobalGrant(params.actingPrincipalId, 'read'))) {
    throw new ContextHubError(
      'BAD_REQUEST',
      'a project_id or project_ids filter is required — only a globally-privileged principal may list jobs across all projects',
    );
  }
  const pool = getDbPool();
  const limit = Math.min(Math.max(params.limit ?? 50, 1), 200);
  const offset = Math.max(params.offset ?? 0, 0);
  const clauses = ['1=1'];
  const values: unknown[] = [];
  if (params.projectIds && params.projectIds.length > 0) {
    values.push(params.projectIds);
    clauses.push(`project_id = ANY($${values.length}::text[])`);
  } else if (params.projectId) {
    values.push(params.projectId);
    clauses.push(`project_id=$${values.length}`);
  }
  if (params.correlationId) {
    values.push(params.correlationId);
    clauses.push(`correlation_id=$${values.length}`);
  }
  if (params.status) {
    values.push(params.status);
    clauses.push(`status=$${values.length}`);
  }
  const whereClause = clauses.join(' AND ');
  const countRes = await pool.query(`SELECT COUNT(*) AS cnt FROM async_jobs WHERE ${whereClause}`, values.slice());
  const total_count = parseInt(countRes.rows[0]?.cnt ?? '0', 10);
  values.push(limit, offset);
  const res = await pool.query(
    `SELECT job_id, project_id, job_type, correlation_id, status, attempts, max_attempts, queued_at, started_at, finished_at, error_message
     FROM async_jobs
     WHERE ${whereClause}
     ORDER BY queued_at DESC
     LIMIT $${values.length - 1} OFFSET $${values.length}`,
    values,
  );
  return { items: (res.rows ?? []) as any, total_count };
}

