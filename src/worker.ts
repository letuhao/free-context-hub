import * as dotenv from 'dotenv';
import { applyMigrations } from './db/applyMigrations.js';
import { getEnv } from './env.js';
import { runJobById, runNextJob } from './services/jobExecutor.js';
import { getRabbitConsumerChannel } from './services/jobQueue.js';
import { createModuleLogger } from './utils/logger.js';

dotenv.config();
const logger = createModuleLogger('worker');

async function sleep(ms: number) {
  await new Promise(resolve => setTimeout(resolve, ms));
}

async function startRabbitConsumer(queueName: string) {
  const consumer = await getRabbitConsumerChannel(queueName);
  if (!consumer) return { status: 'disabled' as const };
  const { ch, queue } = consumer;
  logger.info({ queue }, 'rabbitmq consumer active');
  await ch.prefetch(1);
  await ch.consume(
    queue,
    async (msg: any) => {
      if (!msg) return;
      const raw = msg.content?.toString('utf8') ?? '';
      let jobId = '';
      try {
        const parsed = JSON.parse(raw || '{}');
        jobId = String(parsed.job_id ?? msg.properties?.messageId ?? '');
      } catch {
        jobId = String(msg.properties?.messageId ?? '');
      }
      const corr = String(msg.properties?.correlationId ?? '');
      logger.info(
        { event: 'rabbitmq_job_delivery', job_id: jobId || null, correlation_id: corr || null },
        'rabbitmq message received',
      );
      try {
        if (jobId) {
          logger.info({ event: 'worker_invoke_runJobById', job_id: jobId }, 'rabbitmq invoking runJobById');
          await runJobById(jobId);
        }
        ch.ack(msg);
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        logger.error({ job_id: jobId || null, error: message }, 'rabbitmq handler error');
        // Requeue with backoff is handled via Postgres state; don't spin on poison messages.
        ch.nack(msg, false, false);
      }
    },
    { noAck: false },
  );
  return { status: 'ok' as const };
}

async function main() {
  const env = getEnv();
  await applyMigrations();
  const queueName = env.JOB_QUEUE_NAME || 'default';
  logger.info({ queue: queueName, backend: env.QUEUE_BACKEND, enabled: env.QUEUE_ENABLED }, 'worker started');
  if (env.QUEUE_ENABLED && env.QUEUE_BACKEND === 'rabbitmq') {
    await startRabbitConsumer(queueName);
  }
  for (;;) {
    // Always keep Postgres polling enabled as a fallback (and for postgres backend).
    const res = await runNextJob(queueName);
    if (res.status === 'idle') {
      await sleep(1000);
      continue;
    }
    if (res.status === 'error') {
      logger.error({ job_id: res.job_id, job_type: res.job_type, error: res.error }, 'job failed');
      await sleep(200);
      continue;
    }
    logger.info({ job_id: res.job_id, job_type: res.job_type }, 'job completed');
    await sleep(50);
  }
}

main().catch(err => {
  logger.fatal({ error: err instanceof Error ? err.message : String(err) }, 'worker fatal');
  process.exit(1);
});

