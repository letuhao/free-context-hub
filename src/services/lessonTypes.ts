import { getDbPool } from '../db/client.js';
import { ContextHubError } from '../core/errors.js';

export interface LessonType {
  type_key: string;
  display_name: string;
  description: string | null;
  color: string;
  template: string | null;
  is_builtin: boolean;
  created_at: string;
}

/** List all lesson types (built-in + custom). */
export async function listLessonTypes(): Promise<LessonType[]> {
  const pool = getDbPool();
  const res = await pool.query(
    `SELECT * FROM lesson_types ORDER BY is_builtin DESC, type_key`,
  );
  return res.rows ?? [];
}

/** Get a single lesson type by key. */
export async function getLessonType(typeKey: string): Promise<LessonType | null> {
  const pool = getDbPool();
  const res = await pool.query(`SELECT * FROM lesson_types WHERE type_key = $1`, [typeKey]);
  return res.rows?.[0] ?? null;
}

/** Create a custom lesson type. */
export async function createLessonType(params: {
  type_key: string;
  display_name: string;
  description?: string;
  color?: string;
  template?: string;
}): Promise<LessonType> {
  const pool = getDbPool();

  if (!/^[a-z][a-z0-9_]*$/.test(params.type_key)) {
    throw new ContextHubError('BAD_REQUEST', 'type_key must be lowercase letters, numbers, and underscores (start with letter).');
  }
  if (params.type_key.length > 64) {
    throw new ContextHubError('BAD_REQUEST', 'type_key must be 64 characters or fewer.');
  }
  if (params.display_name.length > 128) {
    throw new ContextHubError('BAD_REQUEST', 'display_name must be 128 characters or fewer.');
  }

  try {
    const res = await pool.query(
      `INSERT INTO lesson_types (type_key, display_name, description, color, template, is_builtin)
       VALUES ($1, $2, $3, $4, $5, false) RETURNING *`,
      [
        params.type_key,
        params.display_name,
        params.description ?? null,
        params.color ?? 'zinc',
        params.template ?? null,
      ],
    );
    return res.rows[0];
  } catch (err: any) {
    if (err?.code === '23505') {
      throw new ContextHubError('BAD_REQUEST', `Lesson type "${params.type_key}" already exists.`);
    }
    throw err;
  }
}

/** Update a lesson type (both built-in and custom can update display_name, description, color, template). */
export async function updateLessonType(
  typeKey: string,
  params: { display_name?: string; description?: string; color?: string; template?: string },
): Promise<LessonType> {
  const pool = getDbPool();

  const sets: string[] = [];
  const vals: unknown[] = [];
  let idx = 1;

  if (params.display_name !== undefined) { sets.push(`display_name = $${idx++}`); vals.push(params.display_name); }
  if (params.description !== undefined) { sets.push(`description = $${idx++}`); vals.push(params.description); }
  if (params.color !== undefined) { sets.push(`color = $${idx++}`); vals.push(params.color); }
  if (params.template !== undefined) { sets.push(`template = $${idx++}`); vals.push(params.template); }

  if (sets.length === 0) {
    throw new ContextHubError('BAD_REQUEST', 'No fields to update.');
  }

  vals.push(typeKey);
  const res = await pool.query(
    `UPDATE lesson_types SET ${sets.join(', ')} WHERE type_key = $${idx} RETURNING *`,
    vals,
  );

  if (!res.rows?.[0]) {
    throw new ContextHubError('NOT_FOUND', `Lesson type "${typeKey}" not found.`);
  }
  return res.rows[0];
}

/** Delete a custom lesson type (built-in types cannot be deleted). */
export async function deleteLessonType(typeKey: string): Promise<void> {
  const pool = getDbPool();

  // Check if built-in
  const existing = await pool.query(`SELECT is_builtin FROM lesson_types WHERE type_key = $1`, [typeKey]);
  if (!existing.rows?.[0]) {
    throw new ContextHubError('NOT_FOUND', `Lesson type "${typeKey}" not found.`);
  }
  if (existing.rows[0].is_builtin) {
    throw new ContextHubError('BAD_REQUEST', 'Built-in lesson types cannot be deleted.');
  }

  // Check if any lessons use this type
  const usageRes = await pool.query(`SELECT count(*)::int AS cnt FROM lessons WHERE lesson_type = $1`, [typeKey]);
  const usageCount = usageRes.rows?.[0]?.cnt ?? 0;
  if (usageCount > 0) {
    throw new ContextHubError('BAD_REQUEST', `Cannot delete: ${usageCount} lesson(s) still use type "${typeKey}".`);
  }

  await pool.query(`DELETE FROM lesson_types WHERE type_key = $1`, [typeKey]);
}
