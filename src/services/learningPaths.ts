import { getDbPool } from '../db/client.js';

export interface LearningPathItem {
  path_id: string;
  section: string;
  lesson_id: string;
  sort_order: number;
  title?: string;
  lesson_type?: string;
  completed?: boolean;
}

/** Add a lesson to the learning path. */
export async function addToLearningPath(params: {
  projectId: string;
  section: string;
  lessonId: string;
  sortOrder?: number;
}): Promise<LearningPathItem> {
  const pool = getDbPool();
  const result = await pool.query(
    `INSERT INTO learning_paths (project_id, section, lesson_id, sort_order)
     VALUES ($1, $2, $3, $4)
     ON CONFLICT (project_id, lesson_id) DO UPDATE SET section = $2, sort_order = $4
     RETURNING *`,
    [params.projectId, params.section, params.lessonId, params.sortOrder ?? 0],
  );
  return result.rows[0];
}

/** Remove a lesson from the learning path. */
export async function removeFromLearningPath(params: {
  pathId: string;
}): Promise<boolean> {
  const pool = getDbPool();
  const result = await pool.query(`DELETE FROM learning_paths WHERE path_id = $1`, [params.pathId]);
  return (result.rowCount ?? 0) > 0;
}

/** Get full learning path with progress for a user. */
export async function getLearningPath(params: {
  projectId: string;
  userId: string;
}): Promise<{
  sections: { name: string; items: LearningPathItem[] }[];
  total: number;
  completed: number;
}> {
  const pool = getDbPool();
  const result = await pool.query(
    `SELECT lp.path_id, lp.section, lp.lesson_id, lp.sort_order,
            l.title, l.lesson_type,
            (prog.user_id IS NOT NULL) AS completed
     FROM learning_paths lp
     JOIN lessons l ON l.lesson_id = lp.lesson_id
     LEFT JOIN learning_progress prog ON prog.path_id = lp.path_id AND prog.user_id = $2
     WHERE lp.project_id = $1
     ORDER BY lp.section, lp.sort_order`,
    [params.projectId, params.userId],
  );

  const sectionMap = new Map<string, LearningPathItem[]>();
  let total = 0;
  let completed = 0;
  for (const row of result.rows) {
    const item: LearningPathItem = {
      path_id: row.path_id,
      section: row.section,
      lesson_id: row.lesson_id,
      sort_order: row.sort_order,
      title: row.title,
      lesson_type: row.lesson_type,
      completed: row.completed,
    };
    if (!sectionMap.has(row.section)) sectionMap.set(row.section, []);
    sectionMap.get(row.section)!.push(item);
    total++;
    if (row.completed) completed++;
  }

  const sections = Array.from(sectionMap.entries()).map(([name, items]) => ({ name, items }));
  return { sections, total, completed };
}

/** Mark a learning path item as completed. */
export async function markCompleted(params: {
  userId: string;
  pathId: string;
}): Promise<{ status: 'ok' }> {
  const pool = getDbPool();
  await pool.query(
    `INSERT INTO learning_progress (user_id, path_id) VALUES ($1, $2) ON CONFLICT DO NOTHING`,
    [params.userId, params.pathId],
  );
  return { status: 'ok' };
}

/** Unmark a learning path item. */
export async function unmarkCompleted(params: {
  userId: string;
  pathId: string;
}): Promise<boolean> {
  const pool = getDbPool();
  const result = await pool.query(
    `DELETE FROM learning_progress WHERE user_id = $1 AND path_id = $2`,
    [params.userId, params.pathId],
  );
  return (result.rowCount ?? 0) > 0;
}
