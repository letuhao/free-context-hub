import { randomUUID } from 'node:crypto';
import amqplib from 'amqplib';

import { getDbPool } from '../db/client.js';
import { getEnv } from '../env.js';

export type JobType =
  | 'repo.sync'
  | 'workspace.scan'
  | 'workspace.delta_index'
  | 'index.run'
  | 'git.ingest'
  | 'quality.eval'
  | 'knowledge.refresh';

type JobStatus = 'queued' | 'running' | 'succeeded' | 'failed' | 'dead_letter';

type QueuePayload = {
  project_id?: string;
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

export async function enqueueJob(input: QueuePayload): Promise<{ status: 'queued'; job_id: string; backend: 'postgres' | 'rabbitmq' }> {
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

export async function claimNextQueuedJob(queueName = 'default'): Promise<{
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
    `WITH next_job AS (
       SELECT job_id
       FROM async_jobs
       WHERE status='queued' AND queue_name=$1 AND available_at <= now()
       ORDER BY queued_at ASC
       LIMIT 1
       FOR UPDATE SKIP LOCKED
     )
     UPDATE async_jobs j
     SET status='running', attempts=j.attempts + 1, started_at=now()
     FROM next_job
     WHERE j.job_id = next_job.job_id
     RETURNING j.job_id, j.project_id, j.job_type, j.payload, j.attempts, j.max_attempts, j.correlation_id`,
    [queueName],
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

export async function completeJob(jobId: string): Promise<void> {
  const pool = getDbPool();
  await pool.query(
    `UPDATE async_jobs
     SET status='succeeded', finished_at=now(), error_message=NULL
     WHERE job_id=$1`,
    [jobId],
  );
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
  correlationId?: string;
  status?: JobStatus;
  limit?: number;
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
}> {
  const pool = getDbPool();
  const limit = Math.min(Math.max(params.limit ?? 50, 1), 200);
  const clauses = ['1=1'];
  const values: unknown[] = [];
  if (params.projectId) {
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
  values.push(limit);
  const res = await pool.query(
    `SELECT job_id, project_id, job_type, correlation_id, status, attempts, max_attempts, queued_at, started_at, finished_at, error_message
     FROM async_jobs
     WHERE ${clauses.join(' AND ')}
     ORDER BY queued_at DESC
     LIMIT $${values.length}`,
    values,
  );
  return { items: (res.rows ?? []) as any };
}

