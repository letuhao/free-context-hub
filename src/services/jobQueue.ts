import { randomUUID } from 'node:crypto';
import amqplib from 'amqplib';

import { getDbPool } from '../db/client.js';
import { getEnv } from '../env.js';
import { ContextHubError } from '../core/errors.js';
import { assertCallerScope } from '../core/security/callerScope.js';
import type { CallerScope } from '../core/security/callerScope.js';

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
  /** DEFERRED-029: caller's scope; enforced against project_id when both are set. */
  callerScope?: CallerScope;
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
  // PR F SEC-3 (Adversary HIGH #3): when a scoped caller omits project_id,
  // the previous code silently allowed an unscoped job to be enqueued. The
  // worker then runs it with callerScope=undefined (unrestricted by design)
  // — letting a scoped caller drive index.run / git.ingest against any
  // filesystem path via payload.root. Auto-bind project_id to the caller's
  // scope when scoped; throw if the caller declared a different project_id.
  if (typeof input.callerScope === 'string') {
    if (!input.project_id) {
      input = { ...input, project_id: input.callerScope };
    } else {
      assertCallerScope(input.callerScope, input.project_id);
    }
    // PR F SEC-6 (Adversary #3 HIGH): SEC-3 pinned the DB project_id to the
    // caller's scope, but the worker still reads `payload.root` verbatim and
    // walks that filesystem path. A scoped-A attacker could pass
    // payload.root='<path to projB cache>' and the indexer would write
    // proj-B's source into chunks tagged project_id='A' (then read it via
    // search_code). Same trick works for git.ingest / workspace.scan /
    // *.build / *.loop.* jobs. Defense: scoped callers cannot specify a
    // filesystem root — the worker auto-resolves from project_sources for
    // the bound project_id (see resolveProjectRoot). Admin/auth-off callers
    // (callerScope=null/undefined) keep full control by design.
    const payloadRoot = (input.payload as Record<string, unknown> | undefined)?.root;
    if (typeof payloadRoot === 'string' && payloadRoot.trim().length > 0) {
      throw new ContextHubError(
        'BAD_REQUEST',
        'scoped callers must omit payload.root — the worker resolves the root from project_sources for the bound project_id',
      );
    }
  } else if (input.project_id) {
    // auth-off / global key + explicit project_id → still enforce (no-op on
    // undefined/null but keeps the contract uniform).
    assertCallerScope(input.callerScope, input.project_id);
  }
  const pool = getDbPool();
  const jobId = randomUUID();
  const queueName = input.queue_name ?? 'default';
  const correlationId = input.correlation_id ?? randomUUID();
  const maxAttempts = Math.max(1, Math.trunc(input.max_attempts ?? 3));

  await pool.query(
    `INSERT INTO async_jobs(job_id, project_id, job_type, queue_name, payload, correlation_id, status, max_attempts, available_at, queued_at)
     VALUES ($1,$2,$3,$4,$5::jsonb,$6,'queued',$7, now(), now())`,
    [jobId, input.project_id ?? null, input.job_type, queueName, JSON.stringify(input.payload ?? {}), correlationId, maxAttempts],
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
  /** DEFERRED-029: caller's scope; enforced against projectId when both are set. */
  opts?: { callerScope?: CallerScope },
): Promise<boolean> {
  // PR F SEC-5 (Adversary #2 MEDIUM latent): the previous `if (projectId)`
  // guard was the same trap shape as SEC-3 — a scoped caller could call
  // cancelJob(jobId, undefined, {callerScope:'A'}) and the UPDATE would run
  // unscoped (cross-tenant cancel). Today's only caller passes a truthy
  // projectId, but the contract was a footgun for the next refactor / MCP
  // exposure. Fix: when callerScope is a string and projectId is absent,
  // auto-bind. Auth-off / global keys still allowed to cancel by job_id alone.
  if (typeof opts?.callerScope === 'string') {
    if (!projectId) projectId = opts.callerScope;
    else assertCallerScope(opts.callerScope, projectId);
  } else if (projectId) {
    assertCallerScope(opts?.callerScope, projectId);
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
  /** DEFERRED-029: caller's scope; enforced against projectId / projectIds when set. */
  callerScope?: CallerScope;
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
  if (params.projectId) {
    assertCallerScope(params.callerScope, params.projectId);
  } else if (params.projectIds && params.projectIds.length > 0) {
    // Multi-project listing: a scoped caller may only see its own project.
    const { assertCallerScopeMulti } = await import('../core/security/callerScope.js');
    assertCallerScopeMulti(params.callerScope, params.projectIds);
  } else if (typeof params.callerScope === 'string') {
    // PR F SEC-1 (Adversary CRITICAL #1): when a scoped caller omits both
    // projectId AND projectIds, the previous WHERE clause was unconstrained
    // ('1=1') → cross-tenant read of every project's jobs. Pin the listing to
    // the caller's scope. Auth-off (undefined) and global keys (null) still
    // see all projects — that path is unchanged.
    params = { ...params, projectId: params.callerScope };
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

