import { applyMigrations } from './db/applyMigrations.js';
import { getEnv } from './env.js';
import { runJobById, runNextJob } from './services/jobExecutor.js';
import { getRabbitConsumerChannel } from './services/jobQueue.js';
import { getSystemPrincipal } from './services/principals.js';
import { hasUsableSystemIdentity } from './services/bootstrap.js';
import { createModuleLogger } from './utils/logger.js';
const logger = createModuleLogger('worker');

async function sleep(ms: number) {
  await new Promise(resolve => setTimeout(resolve, ms));
}

async function startRabbitConsumer(queueName: string, actingPrincipalId: string | null) {
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
          await runJobById(jobId, { actingPrincipalId });
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

  // [F2g] Mirror the server's boot-posture guard (src/index.ts) so both processes apply the IDENTICAL
  // gate — not a narrower subset. Under DEPLOYMENT_PROFILE=production: refuse to start auth-off, and run
  // assertEnforceReady() (root + system identity + migrations + every credential granted) as a hard
  // boot gate. Runs after applyMigrations so the DB checks see a ready schema; the narrower system-
  // identity check below still covers non-production auth-ON test rigs.
  {
    const { evaluateBootPosture } = await import('./services/bootPosture.js');
    const posture = evaluateBootPosture(env);
    if (posture.kind === 'refuse') {
      logger.fatal({ event: 'worker_refuse_unauthenticated_production' }, posture.reason);
      process.exit(1);
    }
    if (posture.kind === 'enforce-ready-required') {
      try {
        const { assertEnforceReady } = await import('./services/bootstrap.js');
        await assertEnforceReady();
      } catch (e) {
        logger.fatal(
          { event: 'worker_not_enforce_ready', error: e instanceof Error ? e.message : String(e) },
          'worker: not enforce-ready — refusing to start under production auth-ON. Resolve the reason above.',
        );
        process.exit(1);
      }
    }
  }

  // [F2g] The worker authenticates every guarded leaf as the system-worker principal. Under auth-off
  // this is null and authorize() short-circuits ALLOW (dev posture unchanged). Under auth-on it MUST
  // exist with its global-write grant, or every job would NO_PRINCIPAL-deny — so fail fast and loud
  // here (a clean "run bootstrap:system") rather than letting each job die silently in failJob.
  const systemPrincipalId = (await getSystemPrincipal())?.principal_id ?? null;
  if (env.MCP_AUTH_ENABLED && !(await hasUsableSystemIdentity())) {
    logger.fatal(
      { event: 'worker_no_system_identity' },
      'MCP_AUTH_ENABLED=true but no usable system-worker identity (missing principal or its global-write grant). Run `npm run bootstrap:system` before starting the worker under enforcement.',
    );
    process.exit(1);
  }

  const queueName = env.JOB_QUEUE_NAME || 'default';
  logger.info(
    { queue: queueName, backend: env.QUEUE_BACKEND, enabled: env.QUEUE_ENABLED, system_principal: systemPrincipalId ?? null },
    'worker started',
  );
  if (env.QUEUE_ENABLED && env.QUEUE_BACKEND === 'rabbitmq') {
    await startRabbitConsumer(queueName, systemPrincipalId);
  }
  for (;;) {
    // Always keep Postgres polling enabled as a fallback (and for postgres backend).
    const res = await runNextJob(queueName, undefined, { actingPrincipalId: systemPrincipalId });
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

