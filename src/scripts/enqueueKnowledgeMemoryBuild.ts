/**
 * Enqueue **only** `knowledge.memory.build` (hierarchical / “large-repo” builder memory: manifest → leaf → module → global).
 * Does **not** run FAQ, RAPTOR, or `knowledge.loop.deep` quality rounds.
 *
 * Worker must be running (`worker` service). On success the executor also enqueues `index.run` for the same root.
 *
 *   QC_VERIFY_REPO_ROOT=/workspace npm run enqueue:knowledge.memory.build
 *
 * Wait for job to finish (poll DB, up to 2h):
 *   WAIT_FOR_JOB=1 QC_VERIFY_REPO_ROOT=/workspace npm run enqueue:knowledge.memory.build
 *
 * Compose:
 *   npm run enqueue:knowledge.memory.build:compose
 */
import * as dotenv from 'dotenv';
import { getDbPool } from '../db/client.js';
import { enqueueJob } from '../services/jobQueue.js';
import { qcVerifyProjectId, qcVerifyRepoRoot } from '../utils/qcVerifyEnv.js';

dotenv.config();

const DEFAULT_PROJECT = 'phase6-qc-free-context-hub';

async function sleep(ms: number) {
  await new Promise(r => setTimeout(r, ms));
}

async function waitJob(jobId: string, timeoutMs: number) {
  const pool = getDbPool();
  const started = Date.now();
  for (;;) {
    const r = await pool.query(`SELECT status, error_message FROM async_jobs WHERE job_id=$1`, [jobId]);
    const row = r.rows[0] as { status?: string; error_message?: string } | undefined;
    const st = row?.status;
    if (st === 'succeeded') {
      console.log(`[memory-build] job ok (${Math.round((Date.now() - started) / 1000)}s) job_id=${jobId}`);
      return;
    }
    if (st === 'failed' || st === 'dead_letter') {
      throw new Error(`[memory-build] job ${st}: ${row?.error_message ?? 'unknown'}`);
    }
    if (Date.now() - started > timeoutMs) {
      throw new Error(`[memory-build] timeout (${timeoutMs}ms) job_id=${jobId} status=${st}`);
    }
    await sleep(800);
  }
}

async function main() {
  const projectId = qcVerifyProjectId(DEFAULT_PROJECT);
  const root = qcVerifyRepoRoot();
  const correlationId =
    process.env.QC_VERIFY_CORRELATION_ID?.trim() || `memory-build-${new Date().toISOString().replace(/[:.]/g, '-')}`;

  const result = await enqueueJob({
    project_id: projectId,
    job_type: 'knowledge.memory.build',
    payload: {
      root,
      // strategy: 'directory' | 'language' — optional; default directory
      // max_shards: number — optional; default MEMORY_BUILD_MAX_SHARDS
    },
    correlation_id: correlationId,
  });

  console.log('[memory-build] enqueued', {
    job_id: result.job_id,
    backend: result.backend,
    project_id: projectId,
    root,
    correlation_id: correlationId,
  });
  console.log('[memory-build] hint: worker logs should show builder_memory_large; child index.run may follow.');

  if (process.env.WAIT_FOR_JOB === '1' || process.env.WAIT_FOR_JOB === 'true') {
    await waitJob(result.job_id, 2 * 60 * 60_000);
  }
}

main().catch(err => {
  console.error('[memory-build] FAILED:', err instanceof Error ? err.message : err);
  process.exit(1);
});
