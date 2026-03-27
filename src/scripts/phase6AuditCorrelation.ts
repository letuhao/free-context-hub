/**
 * Prints async_jobs for a correlation_id (QC audit / "assert logs" without grep).
 *
 *   QC_AUDIT_CORRELATION_ID=phase6-qc-... npm run verify:phase6:audit
 */
import * as dotenv from 'dotenv';
import { getDbPool } from '../db/client.js';
import { qcAuditCorrelationId } from '../utils/qcVerifyEnv.js';

dotenv.config();

/** Jobs enqueued by verify:phase6:qc (not knowledge.memory.build unless run separately). */
const EXPECTED_VERIFY_TYPES = new Set(['index.run', 'knowledge.loop.deep', 'quality.eval']);

async function main() {
  const cid = process.argv[2]?.trim() || qcAuditCorrelationId();
  if (!cid) {
    console.error('Usage: QC_AUDIT_CORRELATION_ID=<id> npm run verify:phase6:audit');
    console.error('   or: npm run verify:phase6:audit -- <correlation_id>');
    process.exit(1);
  }

  const pool = getDbPool();
  const jobs = await pool.query(
    `SELECT job_id, job_type, status, queued_at, error_message
     FROM async_jobs WHERE correlation_id=$1 ORDER BY queued_at ASC`,
    [cid],
  );
  console.log(`[phase6-audit] correlation_id=${cid} rows=${jobs.rowCount ?? 0}`);
  console.table(jobs.rows);

  const bad = await pool.query(
    `SELECT COUNT(*)::int AS n FROM async_jobs
     WHERE correlation_id=$1 AND status IN ('failed','dead_letter')`,
    [cid],
  );
  const n = (bad.rows[0] as { n?: number })?.n ?? 0;
  if (n > 0) {
    console.error(`[phase6-audit] FAILED jobs: ${n}`);
    process.exit(1);
  }

  const types = new Set((jobs.rows as { job_type?: string }[]).map(r => r.job_type).filter(Boolean));
  const missing = [...EXPECTED_VERIFY_TYPES].filter(t => !types.has(t));
  if (missing.length) {
    console.warn('[phase6-audit] WARN: expected job types not all present:', missing.join(', '));
  }
  console.log('[phase6-audit] OK — no failed/dead_letter for this correlation_id');
}

main().catch(err => {
  console.error('[phase6-audit]', err instanceof Error ? err.message : err);
  process.exit(1);
});
