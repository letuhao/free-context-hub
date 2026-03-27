/**
 * Validates env + DB connectivity for Phase 6 verification (before verify:phase6:qc).
 *
 *   npm run verify:phase6:prereq
 */
import * as dotenv from 'dotenv';
import { getDbPool } from '../db/client.js';
import { getEnv } from '../env.js';

dotenv.config();

async function main() {
  const env = getEnv();
  const issues: string[] = [];

  if (!env.KNOWLEDGE_LOOP_ENABLED) {
    issues.push('KNOWLEDGE_LOOP_ENABLED must be true for verify:phase6:qc (knowledge.loop.deep)');
  }
  if (!env.QUEUE_ENABLED) {
    issues.push('QUEUE_ENABLED should be true when using enqueue_job from this script host');
  }
  if (env.BUILDER_MEMORY_ENABLED) {
    const hasModel = Boolean(
      (env.BUILDER_AGENT_MODEL ?? env.DISTILLATION_MODEL ?? '').trim(),
    );
    if (!hasModel) {
      issues.push('BUILDER_MEMORY_ENABLED but neither BUILDER_AGENT_MODEL nor DISTILLATION_MODEL is set');
    }
    const hasBase =
      Boolean((env.BUILDER_AGENT_BASE_URL ?? env.DISTILLATION_BASE_URL ?? '').trim()) ||
      Boolean(env.EMBEDDINGS_BASE_URL);
    if (!hasBase) {
      issues.push('Builder chat needs BUILDER_AGENT_BASE_URL or DISTILLATION_BASE_URL or EMBEDDINGS_BASE_URL');
    }
  }

  try {
    const pool = getDbPool();
    await pool.query('SELECT 1');
    const mig = await pool.query(`SELECT id FROM schema_migrations ORDER BY id`);
    const ids = (mig.rows as { id: string }[]).map(r => r.id);
    console.log('[phase6-prereq] DB ok; migrations applied:', ids.length);
    if (ids.length === 0) {
      issues.push('schema_migrations is empty — run: npm run migrate');
    }
  } catch (e) {
    issues.push(`DATABASE_URL connection failed: ${e instanceof Error ? e.message : String(e)}`);
  }

  if (issues.length) {
    console.error('[phase6-prereq] FAILED:');
    for (const i of issues) console.error('  -', i);
    process.exit(1);
  }

  console.log('[phase6-prereq] OK — ready for QC_VERIFY_REPO_ROOT=... npm run verify:phase6:qc');
}

main().catch(err => {
  console.error('[phase6-prereq]', err instanceof Error ? err.message : err);
  process.exit(1);
});
