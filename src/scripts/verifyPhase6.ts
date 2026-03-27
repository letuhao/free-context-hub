/**
 * One-shot Phase 6 verification (run inside Docker: `docker compose exec mcp npx tsx src/scripts/verifyPhase6.ts`).
 * 1) index.run on /workspace
 * 2) quality.eval (golden set)
 * 3) optional knowledge.loop.shallow when PHASE6_KNOWLEDGE_LOOP_ENABLED=true
 */
import * as dotenv from 'dotenv';
import { getDbPool } from '../db/client.js';
import { getEnv } from '../env.js';
import { enqueueJob } from '../services/jobQueue.js';

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
  const projectId = process.env.VERIFY_PHASE6_PROJECT_ID?.trim() || 'phase6-verify';
  const root = process.env.VERIFY_PHASE6_ROOT?.trim() || '/workspace';
  const queriesPath = env.PHASE6_EVAL_QUERIES_PATH || 'qc/queries.json';

  await ensureProjectRow(projectId);

  console.log('[verify] Phase 6 smoke');
  console.log('[verify] project_id=', projectId, 'root=', root, 'queries=', queriesPath);
  console.log('[verify] PHASE6_KNOWLEDGE_LOOP_ENABLED=', env.PHASE6_KNOWLEDGE_LOOP_ENABLED);

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

  if (env.PHASE6_KNOWLEDGE_LOOP_ENABLED) {
    const sh = await enqueueJob({
      project_id: projectId,
      job_type: 'knowledge.loop.shallow',
      payload: { root, run_faq: false, run_raptor: false },
      correlation_id: `verify-phase6-shallow-${Date.now()}`,
    });
    console.log('[verify] enqueued knowledge.loop.shallow (faq/raptor off for speed) job_id=', sh.job_id);
    await waitJob(sh.job_id, 'knowledge.loop.shallow', 30 * 60_000);
  } else {
    console.log('[verify] skip knowledge.loop.shallow (PHASE6_KNOWLEDGE_LOOP_ENABLED=false)');
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
