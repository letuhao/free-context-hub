import { getDbPool } from '../db/client.js';

/** Retrieval stats — lessons retrieved count (approximated from search activity). */
export async function getRetrievalStats(params: {
  projectId: string;
  days?: number;
}): Promise<{
  total_retrievals: number;
  active_lessons: number;
  approval_rate: number;
  stale_lessons: number;
  stale_threshold_days: number;
}> {
  const pool = getDbPool();
  const days = params.days ?? 30;
  const staleDays = 90;

  // Active lessons count.
  const activeRes = await pool.query(
    `SELECT COUNT(*) AS cnt FROM lessons WHERE project_id = $1 AND status = 'active'`,
    [params.projectId],
  );
  const active_lessons = parseInt(activeRes.rows[0].cnt, 10);

  // Stale lessons (active but not updated in X days).
  const staleRes = await pool.query(
    `SELECT COUNT(*) AS cnt FROM lessons
     WHERE project_id = $1 AND status = 'active' AND updated_at < now() - interval '1 day' * $2`,
    [params.projectId, staleDays],
  );
  const stale_lessons = parseInt(staleRes.rows[0].cnt, 10);

  // Approval rate: active / (active + archived + superseded).
  const allRes = await pool.query(
    `SELECT status, COUNT(*) AS cnt FROM lessons WHERE project_id = $1 GROUP BY status`,
    [params.projectId],
  );
  const statusCounts: Record<string, number> = {};
  for (const row of allRes.rows) statusCounts[row.status] = parseInt(row.cnt, 10);
  const total = (statusCounts.active ?? 0) + (statusCounts.archived ?? 0) + (statusCounts.superseded ?? 0);
  const approval_rate = total > 0 ? Math.round(((statusCounts.active ?? 0) / total) * 100) : 0;

  // Total retrievals (from activity_log search events, if available).
  const retrievalRes = await pool.query(
    `SELECT COUNT(*) AS cnt FROM activity_log
     WHERE project_id = $1 AND created_at >= now() - interval '1 day' * $2`,
    [params.projectId, days],
  );
  const total_retrievals = parseInt(retrievalRes.rows[0].cnt, 10);

  return { total_retrievals, active_lessons, approval_rate, stale_lessons, stale_threshold_days: staleDays };
}

/** Lessons by type breakdown. */
export async function getLessonsByType(params: {
  projectId: string;
}): Promise<{ breakdown: { lesson_type: string; count: number; percentage: number }[] }> {
  const pool = getDbPool();
  const result = await pool.query(
    `SELECT lesson_type, COUNT(*) AS cnt FROM lessons
     WHERE project_id = $1 AND status = 'active'
     GROUP BY lesson_type ORDER BY cnt DESC`,
    [params.projectId],
  );
  const total = result.rows.reduce((sum: number, r: any) => sum + parseInt(r.cnt, 10), 0);
  const breakdown = result.rows.map((r: any) => ({
    lesson_type: r.lesson_type,
    count: parseInt(r.cnt, 10),
    percentage: total > 0 ? Math.round((parseInt(r.cnt, 10) / total) * 100) : 0,
  }));
  return { breakdown };
}

/** Most/least retrieved lessons (using feedback upvotes as proxy for "useful"). */
export async function getMostRetrievedLessons(params: {
  projectId: string;
  limit?: number;
}): Promise<{ items: any[] }> {
  const pool = getDbPool();
  const limit = Math.min(params.limit ?? 10, 50);
  const result = await pool.query(
    `SELECT l.lesson_id, l.title, l.lesson_type, l.status,
            COALESCE(f.ups, 0)::int AS upvotes,
            COALESCE(f.downs, 0)::int AS downvotes
     FROM lessons l
     LEFT JOIN (
       SELECT lesson_id,
              SUM(CASE WHEN vote = 1 THEN 1 ELSE 0 END) AS ups,
              SUM(CASE WHEN vote = -1 THEN 1 ELSE 0 END) AS downs
       FROM lesson_feedback GROUP BY lesson_id
     ) f ON f.lesson_id = l.lesson_id
     WHERE l.project_id = $1 AND l.status = 'active'
     ORDER BY COALESCE(f.ups, 0) DESC, l.created_at DESC
     LIMIT $2`,
    [params.projectId, limit],
  );
  return { items: result.rows };
}

/** Dead knowledge — lessons with zero feedback. */
export async function getDeadKnowledge(params: {
  projectId: string;
  limit?: number;
}): Promise<{ items: any[] }> {
  const pool = getDbPool();
  const limit = Math.min(params.limit ?? 10, 50);
  const result = await pool.query(
    `SELECT l.lesson_id, l.title, l.lesson_type, l.created_at
     FROM lessons l
     LEFT JOIN lesson_feedback f ON f.lesson_id = l.lesson_id
     WHERE l.project_id = $1 AND l.status = 'active' AND f.lesson_id IS NULL
     ORDER BY l.created_at ASC
     LIMIT $2`,
    [params.projectId, limit],
  );
  return { items: result.rows };
}

/** Agent activity — lessons created per actor with approval rates. */
export async function getAgentActivity(params: {
  projectId: string;
}): Promise<{ agents: any[] }> {
  const pool = getDbPool();
  const result = await pool.query(
    `SELECT
       COALESCE(captured_by, '(unknown)') AS agent,
       COUNT(*) AS total,
       SUM(CASE WHEN status = 'active' THEN 1 ELSE 0 END)::int AS active,
       SUM(CASE WHEN status = 'archived' THEN 1 ELSE 0 END)::int AS archived,
       SUM(CASE WHEN status = 'superseded' THEN 1 ELSE 0 END)::int AS superseded,
       MAX(created_at) AS last_active
     FROM lessons WHERE project_id = $1
     GROUP BY captured_by
     ORDER BY total DESC`,
    [params.projectId],
  );
  const agents = result.rows.map((r: any) => {
    const total = parseInt(r.total, 10);
    const active = parseInt(r.active, 10);
    return {
      agent: r.agent,
      total,
      active,
      archived: parseInt(r.archived, 10),
      superseded: parseInt(r.superseded, 10),
      approval_rate: total > 0 ? Math.round((active / total) * 100) : 0,
      last_active: r.last_active,
    };
  });
  return { agents };
}
