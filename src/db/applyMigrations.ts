import fs from 'node:fs/promises';
import path from 'node:path';
import { getDbPool } from './client.js';
import { createModuleLogger } from '../utils/logger.js';

const logger = createModuleLogger('db.migrate');

// Stable advisory lock key for migration serialization.
// Prevents race conditions when multiple processes (mcp + worker) start concurrently.
const MIGRATION_LOCK_ID = 839_201_741;

export async function applyMigrations() {
  const pool = getDbPool();

  await pool.query(`
    CREATE TABLE IF NOT EXISTS schema_migrations (
      id TEXT PRIMARY KEY,
      applied_at TIMESTAMPTZ NOT NULL DEFAULT now()
    );
  `);

  const migrationsDir = path.resolve(process.cwd(), 'migrations');
  const entries = await fs.readdir(migrationsDir);
  const sqlFiles = entries.filter(f => f.endsWith('.sql')).sort();

  // Acquire a session-level advisory lock so only one process runs migrations at a time.
  const lockClient = await pool.connect();
  try {
    await lockClient.query('SELECT pg_advisory_lock($1)', [MIGRATION_LOCK_ID]);
    logger.info('migration lock acquired');

    for (const file of sqlFiles) {
      const already = await lockClient.query('SELECT 1 FROM schema_migrations WHERE id = $1', [file]);
      if (already.rowCount && already.rowCount > 0) continue;

      const fullPath = path.join(migrationsDir, file);
      const sql = await fs.readFile(fullPath, 'utf8');

      try {
        await lockClient.query('BEGIN');
        await lockClient.query(sql);
        await lockClient.query('INSERT INTO schema_migrations (id) VALUES ($1)', [file]);
        await lockClient.query('COMMIT');
        logger.info({ file }, 'migration applied');
      } catch (err) {
        await lockClient.query('ROLLBACK');
        logger.error({ file, error: err instanceof Error ? err.message : String(err) }, 'migration failed');
        throw err;
      }
    }
  } finally {
    await lockClient.query('SELECT pg_advisory_unlock($1)', [MIGRATION_LOCK_ID]);
    lockClient.release();
  }
}

