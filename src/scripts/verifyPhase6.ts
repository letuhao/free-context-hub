/**
 * One-shot Phase 6 verification (run inside Docker: `docker compose exec mcp npx tsx src/scripts/verifyPhase6.ts`).
 * 1) index.run on /workspace
 * 2) quality.eval (golden set)
 * 3) optional knowledge.loop.deep (lightweight: one round, no FAQ/RAPTOR/builder) when KNOWLEDGE_LOOP_ENABLED=true
 */
import * as dotenv from 'dotenv';
import { getDbPool } from '../db/client.js';
import { getEnv } from '../env.js';
import { enqueueJob } from '../services/jobQueue.js';
import { qcVerifyProjectId, qcVerifyRepoRoot } from '../utils/qcVerifyEnv.js';

dotenv.config();

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
      console.log(`[verify] ${label} succeeded (${Math.round((Date.now() - started) / 1000)}s)`);
      return row;
    }
    if (st === 'failed' || st === 'dead_letter') {
      throw new Error(`[verify] ${label} ${st}: ${row?.error_message ?? 'unknown'}`);
    }
    if (Date.now() - started > timeoutMs) {
      throw new Error(`[verify] ${label} timeout after ${timeoutMs}ms (status=${st ?? 'unknown'})`);
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

async function main() {
  const env = getEnv();
  const projectId = qcVerifyProjectId('phase6-verify');
  const root = qcVerifyRepoRoot();
  const queriesPath = env.QUALITY_EVAL_QUERIES_PATH || 'qc/queries.json';

  await ensureProjectRow(projectId);

  console.log('[verify] Phase 6 smoke');
  console.log('[verify] project_id=', projectId, 'root=', root, 'queries=', queriesPath);
  console.log('[verify] KNOWLEDGE_LOOP_ENABLED=', env.KNOWLEDGE_LOOP_ENABLED);

  const idx = await enqueueJob({
    project_id: projectId,
    job_type: 'index.run',
    payload: { root },
    correlation_id: `verify-phase6-${Date.now()}`,
  });
  console.log('[verify] enqueued index.run job_id=', idx.job_id);
  await waitJob(idx.job_id, 'index.run', 20 * 60_000);

  const qe = await enqueueJob({
    project_id: projectId,
    job_type: 'quality.eval',
    payload: { queries_path: queriesPath },
    correlation_id: `verify-phase6-qe-${Date.now()}`,
  });
  console.log('[verify] enqueued quality.eval job_id=', qe.job_id);
  await waitJob(qe.job_id, 'quality.eval', 30 * 60_000);

  const pool = getDbPool();
  const last = await pool.query(
    `SELECT job_id, job_type, status, payload::text
     FROM async_jobs WHERE project_id=$1 AND job_type='quality.eval'
     ORDER BY queued_at DESC LIMIT 1`,
    [projectId],
  );
  console.log('[verify] latest quality.eval row:', last.rows[0]);

  if (env.KNOWLEDGE_LOOP_ENABLED) {
    const dp = await enqueueJob({
      project_id: projectId,
      job_type: 'knowledge.loop.deep',
      payload: {
        root,
        max_rounds: 1,
        parent_run_id: 'verify-phase6',
        run_shallow: false,
        run_faq: false,
        run_raptor: false,
        builder_memory: false,
      },
      correlation_id: `verify-phase6-deep-${Date.now()}`,
    });
    console.log('[verify] enqueued knowledge.loop.deep (minimal smoke: index+eval only in loop) job_id=', dp.job_id);
    await waitJob(dp.job_id, 'knowledge.loop.deep', 45 * 60_000);
  } else {
    console.log('[verify] skip knowledge.loop.deep (KNOWLEDGE_LOOP_ENABLED=false)');
  }

  const docs = await pool.query(
    `SELECT doc_key, doc_type, title, metadata->>'status' AS doc_status, updated_at
     FROM generated_documents
     WHERE project_id=$1 AND doc_type='benchmark_artifact' AND doc_key LIKE 'quality_eval/%'
     ORDER BY updated_at DESC
     LIMIT 5`,
    [projectId],
  );
  console.log('[verify] recent benchmark_artifact (quality_eval/*):');
  console.table(docs.rows);

  console.log('[verify] OK — Phase 6 pipeline completed.');
}

main().catch(err => {
  console.error('[verify] FAILED:', err instanceof Error ? err.message : err);
  process.exit(1);
});
