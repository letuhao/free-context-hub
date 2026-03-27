import * as dotenv from 'dotenv';
import { applyMigrations } from './db/applyMigrations.js';
import { getEnv } from './env.js';
import { runNextJob } from './services/jobExecutor.js';

dotenv.config();

async function sleep(ms: number) {
  await new Promise(resolve => setTimeout(resolve, ms));
}

async function main() {
  const env = getEnv();
  await applyMigrations();
  const queueName = env.JOB_QUEUE_NAME || 'default';
  console.log(`[worker] started queue=${queueName} backend=${env.QUEUE_BACKEND} enabled=${env.QUEUE_ENABLED}`);
  for (;;) {
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

