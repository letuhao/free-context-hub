import { getDbPool } from '../db/client.js';

export async function getProjectCacheVersion(projectId: string): Promise<number> {
  const pool = getDbPool();
  const res = await pool.query(
    `INSERT INTO project_cache_versions(project_id, version)
     VALUES ($1, 1)
     ON CONFLICT (project_id) DO NOTHING;`,
    [projectId],
  );
  void res;
  const out = await pool.query(`SELECT version FROM project_cache_versions WHERE project_id=$1;`, [projectId]);
  const v = Number(out.rows?.[0]?.version ?? 1);
  return Number.isFinite(v) && v > 0 ? v : 1;
}

export async function bumpProjectCacheVersion(projectId: string): Promise<number> {
  const pool = getDbPool();
  const res = await pool.query(
    `INSERT INTO project_cache_versions(project_id, version)
     VALUES ($1, 1)
     ON CONFLICT (project_id)
     DO UPDATE SET version = project_cache_versions.version + 1, updated_at = now()
     RETURNING version;`,
    [projectId],
  );
  const v = Number(res.rows?.[0]?.version ?? 1);
  return Number.isFinite(v) && v > 0 ? v : 1;
}

