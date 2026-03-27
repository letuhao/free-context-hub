import fs from 'node:fs/promises';
import path from 'node:path';
import { getDbPool } from './client.js';
import { createModuleLogger } from '../utils/logger.js';

const logger = createModuleLogger('db.migrate');

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

  for (const file of sqlFiles) {
    const already = await pool.query('SELECT 1 FROM schema_migrations WHERE id = $1', [file]);
    if (already.rowCount && already.rowCount > 0) continue;

    const fullPath = path.join(migrationsDir, file);
    const sql = await fs.readFile(fullPath, 'utf8');

    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      await client.query(sql);
      await client.query('INSERT INTO schema_migrations (id) VALUES ($1)', [file]);
      await client.query('COMMIT');
      logger.info({ file }, 'migration applied');
    } catch (err) {
      await client.query('ROLLBACK');
      logger.error({ file, error: err instanceof Error ? err.message : String(err) }, 'migration failed');
      throw err;
    } finally {
      client.release();
    }
  }
}

