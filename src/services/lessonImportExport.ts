import { getDbPool } from '../db/client.js';
import { addLesson } from './lessons.js';
import { createModuleLogger } from '../utils/logger.js';

const logger = createModuleLogger('lesson-import-export');

export interface ExportedLesson {
  lesson_id: string;
  lesson_type: string;
  title: string;
  content: string;
  tags: string[];
  source_refs: string[];
  status: string;
  captured_by: string | null;
  created_at: string;
}

/** Export lessons as JSON array. */
export async function exportLessons(params: {
  projectId: string;
  format?: 'json' | 'csv';
  status?: string;
}): Promise<{ items: ExportedLesson[]; total_count: number; format: string }> {
  const pool = getDbPool();
  let where = 'WHERE project_id = $1';
  const args: any[] = [params.projectId];

  if (params.status) {
    where += ` AND status = $2`;
    args.push(params.status);
  }

  const result = await pool.query(
    `SELECT lesson_id, lesson_type, title, content, tags, source_refs, status, captured_by, created_at
     FROM lessons ${where} ORDER BY created_at DESC`,
    args,
  );

  const format = params.format ?? 'json';

  return {
    items: result.rows,
    total_count: result.rowCount ?? 0,
    format,
  };
}

export interface ImportResult {
  status: 'ok';
  imported: number;
  skipped: number;
  errors: string[];
  details: { title: string; status: 'imported' | 'skipped' | 'error'; reason?: string }[];
}

/** Import lessons from JSON array. Skips duplicates (same title + project). */
export async function importLessons(params: {
  projectId: string;
  lessons: Array<{
    lesson_type: string;
    title: string;
    content: string;
    tags?: string[];
    source_refs?: string[];
    captured_by?: string;
  }>;
  skipDuplicates?: boolean;
}): Promise<ImportResult> {
  const pool = getDbPool();
  const skipDuplicates = params.skipDuplicates ?? true;
  const result: ImportResult = { status: 'ok', imported: 0, skipped: 0, errors: [], details: [] };

  // Get existing titles for duplicate detection.
  let existingTitles = new Set<string>();
  if (skipDuplicates) {
    const existing = await pool.query(
      `SELECT LOWER(title) AS t FROM lessons WHERE project_id = $1`,
      [params.projectId],
    );
    existingTitles = new Set(existing.rows.map((r: any) => r.t));
  }

  const validTypes = ['decision', 'preference', 'guardrail', 'workaround', 'general_note'];

  for (const lesson of params.lessons) {
    const title = lesson.title?.trim();
    const content = lesson.content?.trim();
    const lessonType = lesson.lesson_type?.trim();

    if (!title || !content || !lessonType) {
      result.errors.push(`Missing required fields for "${title ?? '(no title)'}"`);
      result.details.push({ title: title ?? '(no title)', status: 'error', reason: 'missing fields' });
      continue;
    }

    if (!validTypes.includes(lessonType)) {
      result.errors.push(`Invalid lesson_type "${lessonType}" for "${title}"`);
      result.details.push({ title, status: 'error', reason: `invalid type: ${lessonType}` });
      continue;
    }

    if (skipDuplicates && existingTitles.has(title.toLowerCase())) {
      result.skipped++;
      result.details.push({ title, status: 'skipped', reason: 'duplicate title' });
      continue;
    }

    try {
      await addLesson({
        project_id: params.projectId,
        lesson_type: lessonType as any,
        title,
        content,
        tags: lesson.tags,
        source_refs: lesson.source_refs,
        captured_by: lesson.captured_by ?? 'import',
      });
      result.imported++;
      result.details.push({ title, status: 'imported' });
      existingTitles.add(title.toLowerCase());
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      result.errors.push(`Failed to import "${title}": ${msg}`);
      result.details.push({ title, status: 'error', reason: msg });
    }
  }

  logger.info({ projectId: params.projectId, imported: result.imported, skipped: result.skipped, errors: result.errors.length }, 'import complete');
  return result;
}
