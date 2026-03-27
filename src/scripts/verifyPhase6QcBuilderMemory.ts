/**
 * Single-step probe: chỉ chạy single-pass `buildProjectMemoryArtifact` (cùng code path với worker),
 * không index / không FAQ / không RAPTOR — dùng trước `verify:phase6:qc` (~1h) để kiểm tra
 * BUILDER_AGENT_* + timeout + chat endpoint.
 *
 *   QC_VERIFY_REPO_ROOT=/workspace npm run verify:phase6:qc:builder-memory
 *
 * Compose (cùng DB với worker):
 *   npm run verify:phase6:qc:builder-memory:compose
 *
 * Nếu vẫn timeout: tăng `BUILDER_AGENT_TIMEOUT_MS` hoặc giảm `BUILDER_MEMORY_SAMPLE_*` / `BUILDER_MEMORY_SAMPLE_MAX_TOTAL_CHARS` trong env.
 */
import * as dotenv from 'dotenv';
import { getDbPool } from '../db/client.js';
import { getEnv } from '../env.js';
import { buildProjectMemoryArtifact } from '../services/builderMemory.js';
import { qcVerifyProjectId, qcVerifyRepoRoot } from '../utils/qcVerifyEnv.js';

dotenv.config();

const DEFAULT_PROJECT = 'phase6-qc-free-context-hub';

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
  const projectId = qcVerifyProjectId(DEFAULT_PROJECT);
  const root = qcVerifyRepoRoot();

  console.log('[builder-memory-probe] project_id=', projectId);
  console.log('[builder-memory-probe] root=', root);
  console.log('[builder-memory-probe] BUILDER_MEMORY_ENABLED=', env.BUILDER_MEMORY_ENABLED);
  console.log('[builder-memory-probe] BUILDER_AGENT_TIMEOUT_MS=', env.BUILDER_AGENT_TIMEOUT_MS);
  console.log('[builder-memory-probe] BUILDER_MEMORY_SAMPLE_MAX_TOTAL_CHARS=', env.BUILDER_MEMORY_SAMPLE_MAX_TOTAL_CHARS);
  console.log('[builder-memory-probe] BUILDER_MEMORY_MAP_CHUNK_MAX_CHARS=', env.BUILDER_MEMORY_MAP_CHUNK_MAX_CHARS);
  console.log('[builder-memory-probe] BUILDER_MEMORY_MAP_CONCURRENCY=', env.BUILDER_MEMORY_MAP_CONCURRENCY);

  if (!env.BUILDER_MEMORY_ENABLED) {
    throw new Error('BUILDER_MEMORY_ENABLED must be true for this probe');
  }

  await ensureProjectRow(projectId);

  const correlationId = `phase6-bm-probe-${new Date().toISOString().replace(/[:.]/g, '-')}`;
  const started = Date.now();
  const result = await buildProjectMemoryArtifact({
    projectId,
    root,
    correlationId,
  });
  const ms = Date.now() - started;

  if (result.status !== 'ok') {
    console.error('[builder-memory-probe] FAILED:', result);
    process.exit(1);
  }

  console.log(`[builder-memory-probe] OK in ${ms}ms doc_key=${result.doc_key}`);
}

main().catch(err => {
  console.error('[builder-memory-probe] FAILED:', err instanceof Error ? err.message : err);
  process.exit(1);
});
