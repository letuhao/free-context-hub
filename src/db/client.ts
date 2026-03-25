import { Pool } from 'pg';
import { getEnv } from '../env.js';

let pool: Pool | null = null;

export function getDbPool() {
  if (!pool) {
    const env = getEnv();
    pool = new Pool({
      connectionString: env.DATABASE_URL,
      // MVP: allow slightly longer statements during embedding/indexing
      statement_timeout: 0,
    });
  }
  return pool;
}

