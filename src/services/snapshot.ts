import { getDbPool } from '../db/client.js';

export async function getProjectSnapshotBody(projectId: string): Promise<string | null> {
  const pool = getDbPool();
  const res = await pool.query(`SELECT body FROM project_snapshots WHERE project_id=$1`, [projectId]);
  const row = res.rows?.[0];
  if (!row) return null;
  const body = String(row.body ?? '');
  return body.length ? body : null;
}

export async function rebuildProjectSnapshot(projectId: string): Promise<void> {
  const pool = getDbPool();

  const lessonsRes = await pool.query(
    `SELECT title, lesson_type, summary, content, status
     FROM lessons
     WHERE project_id=$1 AND status='active'
     ORDER BY updated_at DESC, created_at DESC
     LIMIT 200;`,
    [projectId],
  );

  const lines: string[] = [];
  lines.push(`# Project snapshot: ${projectId}`);
  lines.push('');
  lines.push(`Generated: ${new Date().toISOString()}`);
  lines.push('');

  const rows = lessonsRes.rows ?? [];
  if (rows.length === 0) {
    lines.push('(No active lessons yet.)');
  } else {
    for (const r of rows as any[]) {
      const title = String(r.title ?? '');
      const lt = String(r.lesson_type ?? '');
      const summary = r.summary ? String(r.summary) : '';
      const content = String(r.content ?? '');
      const excerpt = summary || content.replace(/\s+/g, ' ').trim().slice(0, 320);
      lines.push(`- **${title}** (${lt}): ${excerpt}`);
    }
  }

  const body = lines.join('\n');

  await pool.query(
    `INSERT INTO project_snapshots(project_id, body, updated_at)
     VALUES ($1, $2, now())
     ON CONFLICT (project_id)
     DO UPDATE SET body=EXCLUDED.body, updated_at=now();`,
    [projectId, body],
  );
}
