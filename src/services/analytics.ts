import { getDbPool } from '../db/client.js';

/**
 * Helper: resolve project filter for SQL queries.
 * Returns { clause, params } where clause is "project_id = $N" or "project_id = ANY($N::text[])".
 */
function projectFilter(
  projectIdOrIds: string | string[],
  paramIndex: number,
): { clause: string; param: string | string[] } {
  if (Array.isArray(projectIdOrIds)) {
    return { clause: `project_id = ANY($${paramIndex}::text[])`, param: projectIdOrIds };
  }
  return { clause: `project_id = $${paramIndex}`, param: projectIdOrIds };
}

/** Retrieval stats — lessons retrieved count (approximated from search activity). */
export async function getRetrievalStats(params: {
  projectId?: string;
  projectIds?: string[];
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
  const pf = projectFilter(params.projectIds ?? params.projectId ?? '', 1);

  const activeRes = await pool.query(
    `SELECT COUNT(*) AS cnt FROM lessons WHERE ${pf.clause} AND status = 'active'`,
    [pf.param],
  );
  const active_lessons = parseInt(activeRes.rows[0]?.cnt ?? '0', 10);

  const staleRes = await pool.query(
    `SELECT COUNT(*) AS cnt FROM lessons
     WHERE ${pf.clause} AND status = 'active' AND updated_at < now() - interval '1 day' * $2`,
    [pf.param, staleDays],
  );
  const stale_lessons = parseInt(staleRes.rows[0]?.cnt ?? '0', 10);

  const allRes = await pool.query(
    `SELECT status, COUNT(*) AS cnt FROM lessons WHERE ${pf.clause} GROUP BY status`,
    [pf.param],
  );
  const statusCounts: Record<string, number> = {};
  for (const row of allRes.rows) statusCounts[row.status] = parseInt(row.cnt, 10);
  const total = (statusCounts.active ?? 0) + (statusCounts.archived ?? 0) + (statusCounts.superseded ?? 0);
  const approval_rate = total > 0 ? Math.round(((statusCounts.active ?? 0) / total) * 100) : 0;

  const retrievalRes = await pool.query(
    `SELECT COUNT(*) AS cnt FROM activity_log
     WHERE ${pf.clause} AND created_at >= now() - interval '1 day' * $2`,
    [pf.param, days],
  );
  const total_retrievals = parseInt(retrievalRes.rows[0]?.cnt ?? '0', 10);

  return { total_retrievals, active_lessons, approval_rate, stale_lessons, stale_threshold_days: staleDays };
}

/** Lessons by type breakdown. */
export async function getLessonsByType(params: {
  projectId?: string;
  projectIds?: string[];
}): Promise<{ breakdown: { lesson_type: string; count: number; percentage: number }[] }> {
  const pool = getDbPool();
  const pf = projectFilter(params.projectIds ?? params.projectId ?? '', 1);
  const result = await pool.query(
    `SELECT lesson_type, COUNT(*) AS cnt FROM lessons
     WHERE ${pf.clause} AND status = 'active'
     GROUP BY lesson_type ORDER BY cnt DESC`,
    [pf.param],
  );
  const total = result.rows.reduce((sum: number, r: any) => sum + parseInt(r.cnt, 10), 0);
  const breakdown = result.rows.map((r: any) => ({
    lesson_type: r.lesson_type,
    count: parseInt(r.cnt, 10),
    percentage: total > 0 ? Math.round((parseInt(r.cnt, 10) / total) * 100) : 0,
  }));
  return { breakdown };
}

/** Retrieval timeseries — daily activity counts for charting. */
export async function getRetrievalTimeseries(params: {
  projectId?: string;
  projectIds?: string[];
  days?: number;
}): Promise<{ points: { date: string; count: number }[] }> {
  const pool = getDbPool();
  const days = params.days ?? 30;
  const pf = projectFilter(params.projectIds ?? params.projectId ?? '', 1);
  const result = await pool.query(
    `SELECT d::date AS date, COALESCE(cnt, 0)::int AS count
     FROM generate_series(
       (now() - interval '1 day' * $2)::date,
       now()::date,
       '1 day'::interval
     ) d
     LEFT JOIN (
       SELECT created_at::date AS day, COUNT(*) AS cnt
       FROM activity_log
       WHERE ${pf.clause} AND created_at >= now() - interval '1 day' * $2
       GROUP BY created_at::date
     ) a ON a.day = d::date
     ORDER BY date ASC`,
    [pf.param, days],
  );
  return { points: result.rows.map((r: any) => ({
    date: r.date instanceof Date ? r.date.toISOString().slice(0, 10) : String(r.date).slice(0, 10),
    count: r.count,
  })) };
}

/** Most/least retrieved lessons (using feedback upvotes as proxy for "useful"). */
export async function getMostRetrievedLessons(params: {
  projectId?: string;
  projectIds?: string[];
  limit?: number;
}): Promise<{ items: any[] }> {
  const pool = getDbPool();
  const limit = Math.min(params.limit ?? 10, 50);
  const pf = projectFilter(params.projectIds ?? params.projectId ?? '', 1);
  const result = await pool.query(
    `SELECT l.lesson_id, l.title, l.lesson_type, l.status, l.project_id,
            COALESCE(f.ups, 0)::int AS upvotes,
            COALESCE(f.downs, 0)::int AS downvotes
     FROM lessons l
     LEFT JOIN (
       SELECT lesson_id,
              SUM(CASE WHEN vote = 1 THEN 1 ELSE 0 END) AS ups,
              SUM(CASE WHEN vote = -1 THEN 1 ELSE 0 END) AS downs
       FROM lesson_feedback GROUP BY lesson_id
     ) f ON f.lesson_id = l.lesson_id
     WHERE l.${pf.clause} AND l.status = 'active'
     ORDER BY COALESCE(f.ups, 0) DESC, l.created_at DESC
     LIMIT $2`,
    [pf.param, limit],
  );
  return { items: result.rows };
}

/** Dead knowledge — lessons with zero feedback. */
export async function getDeadKnowledge(params: {
  projectId?: string;
  projectIds?: string[];
  limit?: number;
}): Promise<{ items: any[] }> {
  const pool = getDbPool();
  const limit = Math.min(params.limit ?? 10, 50);
  const pf = projectFilter(params.projectIds ?? params.projectId ?? '', 1);
  const result = await pool.query(
    `SELECT l.lesson_id, l.title, l.lesson_type, l.created_at, l.project_id
     FROM lessons l
     LEFT JOIN lesson_feedback f ON f.lesson_id = l.lesson_id
     WHERE l.${pf.clause} AND l.status = 'active' AND f.lesson_id IS NULL
     ORDER BY l.created_at ASC
     LIMIT $2`,
    [pf.param, limit],
  );
  return { items: result.rows };
}

/** Agent activity — lessons created per actor with approval rates. */
export async function getAgentActivity(params: {
  projectId?: string;
  projectIds?: string[];
}): Promise<{ agents: any[] }> {
  const pool = getDbPool();
  const pf = projectFilter(params.projectIds ?? params.projectId ?? '', 1);
  const result = await pool.query(
    `SELECT
       COALESCE(captured_by, '(unknown)') AS agent,
       COUNT(*) AS total,
       SUM(CASE WHEN status = 'active' THEN 1 ELSE 0 END)::int AS active,
       SUM(CASE WHEN status = 'archived' THEN 1 ELSE 0 END)::int AS archived,
       SUM(CASE WHEN status = 'superseded' THEN 1 ELSE 0 END)::int AS superseded,
       MAX(created_at) AS last_active
     FROM lessons WHERE ${pf.clause}
     GROUP BY captured_by
     ORDER BY total DESC`,
    [pf.param],
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
