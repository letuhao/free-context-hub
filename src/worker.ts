import * as dotenv from 'dotenv';
import { applyMigrations } from './db/applyMigrations.js';
import { getEnv } from './env.js';
import { runJobById, runNextJob } from './services/jobExecutor.js';
import { getRabbitConsumerChannel } from './services/jobQueue.js';

dotenv.config();

async function sleep(ms: number) {
  await new Promise(resolve => setTimeout(resolve, ms));
}

async function startRabbitConsumer(queueName: string) {
  const consumer = await getRabbitConsumerChannel(queueName);
  if (!consumer) return { status: 'disabled' as const };
  const { ch, queue } = consumer;
  console.log(`[worker] rabbitmq consumer active queue=${queue}`);
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
      console.log(`[worker] rabbitmq recv job_id=${jobId || '(missing)'} corr=${corr || '(none)'}`);
      try {
        if (jobId) {
          await runJobById(jobId);
        }
        ch.ack(msg);
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        console.error(`[worker] rabbitmq handler error job_id=${jobId} msg=${message}`);
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
  console.log(`[worker] started queue=${queueName} backend=${env.QUEUE_BACKEND} enabled=${env.QUEUE_ENABLED}`);
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
      console.error(`[worker] job failed id=${res.job_id} type=${res.job_type} error=${res.error}`);
      await sleep(200);
      continue;
    }
    console.log(`[worker] job ok id=${res.job_id} type=${res.job_type}`);
    await sleep(50);
  }
}

main().catch(err => {
  console.error('[worker] fatal', err instanceof Error ? err.message : err);
  process.exit(1);
});

