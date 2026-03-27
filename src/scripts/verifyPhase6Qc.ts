/**
 * Full Phase 6 QC verification for project `phase6-qc-free-context-hub` (configurable).
 * Single correlation_id across jobs; asserts DB state before declaring success.
 *
 * Run (from repo root, same DB as worker):
 *   VERIFY_PHASE6_ROOT=/workspace npm run verify:phase6:qc
 *
 * On Windows host talking to Postgres on localhost, ensure RABBITMQ_URL uses 127.0.0.1 if enqueue uses RabbitMQ from host.
 */
import * as dotenv from 'dotenv';
import { getDbPool } from '../db/client.js';
import { getEnv } from '../env.js';
import { enqueueJob } from '../services/jobQueue.js';

dotenv.config();

const DEFAULT_PROJECT = 'phase6-qc-free-context-hub';

async function sleep(ms: number) {
  await new Promise(r => setTimeout(r, ms));
}

async function waitJob(jobId: string, label: string, timeoutMs: number) {
  const pool = getDbPool();
  const started = Date.now();
  for (;;) {
    const r = await pool.query(`SELECT status, error_message FROM async_jobs WHERE job_id=$1`, [jobId]);
    const row = r.rows[0] as { status?: string; error_message?: string } | undefined;
    const st = row?.status;
    if (st === 'succeeded') {
      console.log(`[verify-qc] ${label} ok (${Math.round((Date.now() - started) / 1000)}s) job_id=${jobId}`);
      return;
    }
    if (st === 'failed' || st === 'dead_letter') {
      throw new Error(`[verify-qc] ${label} ${st}: ${row?.error_message ?? 'unknown'}`);
    }
    if (Date.now() - started > timeoutMs) {
      throw new Error(`[verify-qc] ${label} timeout (${timeoutMs}ms) job_id=${jobId} status=${st}`);
    }
    await sleep(800);
  }
}

async function ensureProjectRow(projectId: string) {
  const pool = getDbPool();
  await pool.query(
    `INSERT INTO projects(project_id, name)
     VALUES ($1, $2)
     ON CONFLICT (project_id) DO NOTHING`,
    [projectId, projectId],
  );
}

async function assertNoFailedJobs(correlationId: string) {
  const pool = getDbPool();
  const bad = await pool.query(
    `SELECT job_id, job_type, status, error_message FROM async_jobs
     WHERE correlation_id=$1 AND status IN ('failed','dead_letter')`,
    [correlationId],
  );
  if (bad.rowCount && bad.rowCount > 0) {
    console.error('[verify-qc] failed jobs:', bad.rows);
    throw new Error(`[verify-qc] correlation ${correlationId} has failed/dead_letter jobs`);
  }
}

async function assertArtifacts(projectId: string) {
  const pool = getDbPool();
  const shallow = await pool.query(
    `SELECT 1 FROM generated_documents
     WHERE project_id=$1 AND doc_type='benchmark_artifact' AND metadata->>'kind' = 'shallow_loop' LIMIT 1`,
    [projectId],
  );
  if (!shallow.rowCount) {
    throw new Error('[verify-qc] missing shallow_loop benchmark_artifact');
  }
  const deep = await pool.query(
    `SELECT 1 FROM generated_documents
     WHERE project_id=$1 AND doc_type='benchmark_artifact' AND metadata->>'kind' = 'deep_loop_summary' LIMIT 1`,
    [projectId],
  );
  if (!deep.rowCount) {
    throw new Error('[verify-qc] missing deep_loop_summary benchmark_artifact');
  }
  const qe = await pool.query(
    `SELECT 1 FROM generated_documents
     WHERE project_id=$1 AND doc_type='benchmark_artifact' AND doc_key LIKE 'quality_eval/%' LIMIT 1`,
    [projectId],
  );
  if (!qe.rowCount) {
    throw new Error('[verify-qc] missing quality_eval/* benchmark_artifact');
  }
  const env = getEnv();
  if (env.PHASE6_BUILDER_MEMORY_ENABLED) {
    const bm = await pool.query(
      `SELECT 1 FROM generated_documents
       WHERE project_id=$1 AND metadata->>'kind' = 'builder_memory' LIMIT 1`,
      [projectId],
    );
    if (!bm.rowCount) {
      console.warn('[verify-qc] WARN: no builder_memory artifact (LLM may be unset or step skipped)');
    }
  }
}

async function main() {
  const env = getEnv();
  const projectId = process.env.VERIFY_PHASE6_QC_PROJECT_ID?.trim() || DEFAULT_PROJECT;
  const root = process.env.VERIFY_PHASE6_ROOT?.trim() || '/workspace';
  const correlationId =
    process.env.VERIFY_PHASE6_CORRELATION_ID?.trim() || `phase6-qc-${new Date().toISOString().replace(/[:.]/g, '-')}`;
  const maxDeepRounds = Math.min(
    5,
    Math.max(1, Number(process.env.VERIFY_PHASE6_DEEP_MAX_ROUNDS ?? 3)),
  );
  const skipBuilderMemory = String(process.env.VERIFY_PHASE6_SKIP_BUILDER_MEMORY ?? '').toLowerCase() === 'true';

  await ensureProjectRow(projectId);

  console.log('[verify-qc] Phase 6 QC run');
  console.log('[verify-qc] project_id=', projectId);
  console.log('[verify-qc] root=', root);
  console.log('[verify-qc] correlation_id=', correlationId);
  console.log('[verify-qc] PHASE6_KNOWLEDGE_LOOP_ENABLED=', env.PHASE6_KNOWLEDGE_LOOP_ENABLED);
  console.log('[verify-qc] PHASE6_BUILDER_MEMORY_ENABLED=', env.PHASE6_BUILDER_MEMORY_ENABLED);

  if (!env.PHASE6_KNOWLEDGE_LOOP_ENABLED) {
    throw new Error('PHASE6_KNOWLEDGE_LOOP_ENABLED must be true for shallow/deep verification');
  }

  const idx = await enqueueJob({
    project_id: projectId,
    job_type: 'index.run',
    payload: { root },
    correlation_id: correlationId,
  });
  await waitJob(idx.job_id, 'index.run', 30 * 60_000);

  const shallow = await enqueueJob({
    project_id: projectId,
    job_type: 'knowledge.loop.shallow',
    payload: { root, run_faq: true, run_raptor: true },
    correlation_id: correlationId,
  });
  await waitJob(shallow.job_id, 'knowledge.loop.shallow', 60 * 60_000);

  const deep = await enqueueJob({
    project_id: projectId,
    job_type: 'knowledge.loop.deep',
    payload: {
      root,
      max_rounds: maxDeepRounds,
      parent_run_id: 'verify-qc',
      run_shallow: false,
      builder_memory: skipBuilderMemory ? false : true,
    },
    correlation_id: correlationId,
  });
  await waitJob(deep.job_id, 'knowledge.loop.deep', 60 * 60_000);

  const baseline = await enqueueJob({
    project_id: projectId,
    job_type: 'quality.eval',
    payload: { queries_path: env.PHASE6_EVAL_QUERIES_PATH, set_baseline: true },
    correlation_id: correlationId,
  });
  await waitJob(baseline.job_id, 'quality.eval (set_baseline)', 30 * 60_000);

  await assertNoFailedJobs(correlationId);
  await assertArtifacts(projectId);

  const order = await getDbPool().query(
    `SELECT job_type, status, queued_at FROM async_jobs WHERE correlation_id=$1 ORDER BY queued_at ASC`,
    [correlationId],
  );
  console.log('[verify-qc] jobs for correlation_id (ordered):');
  console.table(order.rows);

  console.log('[verify-qc] OK — assertions passed. Next: npm run qc:rag:phase6 (MCP must be up; uses QC harness, not quality.eval).');
}

main().catch(err => {
  console.error('[verify-qc] FAILED:', err instanceof Error ? err.message : err);
  process.exit(1);
});
