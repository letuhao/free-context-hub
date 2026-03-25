import { randomUUID } from 'node:crypto';
import { getDbPool } from '../db/client.js';
import { embedTexts } from './embedder.js';

export type LessonType = 'decision' | 'preference' | 'guardrail' | 'workaround' | 'general_note';

export type GuardrailRulePayload = {
  trigger: string;
  requirement: string;
  verification_method: 'recorded_test_event' | 'user_confirmation' | 'cli_exit_code' | string;
};

export type LessonPayload = {
  project_id: string;
  lesson_type: LessonType;
  title: string;
  content: string;
  tags?: string[];
  source_refs?: string[];
  captured_by?: string;
  guardrail?: GuardrailRulePayload;
};

export type LessonItem = {
  lesson_id: string;
  project_id: string;
  lesson_type: LessonType;
  title: string;
  content: string;
  tags: string[];
  source_refs: string[];
  created_at: any;
  updated_at: any;
  captured_by: string | null;
};

function mapLessonRow(r: any): LessonItem {
  return {
    lesson_id: String(r.lesson_id),
    project_id: String(r.project_id),
    lesson_type: String(r.lesson_type) as LessonType,
    title: String(r.title),
    content: String(r.content),
    tags: (r.tags ?? []) as string[],
    source_refs: (r.source_refs ?? []) as string[],
    created_at: r.created_at,
    updated_at: r.updated_at,
    captured_by: r.captured_by ?? null,
  };
}

function encodeCursor(createdAtIso: string, lessonId: string) {
  return Buffer.from(`${createdAtIso}|${lessonId}`, 'utf8').toString('base64');
}

function decodeCursor(cursor: string): { createdAtIso: string; lessonId: string } {
  const raw = Buffer.from(cursor, 'base64').toString('utf8');
  const idx = raw.indexOf('|');
  if (idx <= 0) throw new Error('Invalid cursor');
  const createdAtIso = raw.slice(0, idx);
  const lessonId = raw.slice(idx + 1);
  if (!createdAtIso || !lessonId) throw new Error('Invalid cursor');
  return { createdAtIso, lessonId };
}

export async function addLesson(payload: LessonPayload) {
  const pool = getDbPool();
  const lessonId = payload.lesson_type === 'guardrail' ? randomUUID() : randomUUID();

  const tags = payload.tags ?? [];
  const sourceRefs = payload.source_refs ?? [];

  // Embedding lessons enables later semantic retrieval of preferences/notes (optional in MVP).
  const [embedding] = await embedTexts([payload.content]);
  const embeddingLiteral = `[${embedding.join(',')}]`;

  await pool.query(
    `INSERT INTO projects(project_id, name)
     VALUES ($1, $2)
     ON CONFLICT (project_id) DO NOTHING;`,
    [payload.project_id, payload.project_id],
  );

  await pool.query(
    `INSERT INTO lessons(
      lesson_id, project_id, lesson_type, title, content, tags, source_refs,
      embedding, captured_by, created_at, updated_at
    ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8::vector,$9, now(), now());`,
    [
      lessonId,
      payload.project_id,
      payload.lesson_type,
      payload.title,
      payload.content,
      tags,
      sourceRefs,
      embeddingLiteral,
      payload.captured_by ?? null,
    ],
  );

  if (payload.lesson_type === 'guardrail' || payload.guardrail) {
    const rule = payload.guardrail;
    if (!rule) {
      // Guardrail without rule payload is a client error, but keep MVP forgiving.
      return { status: 'ok', lesson_id: lessonId, guardrail_inserted: false };
    }

    await pool.query(
      `INSERT INTO guardrails(rule_id, project_id, trigger, requirement, verification_method, created_at)
       VALUES ($1,$2,$3,$4,$5, now());`,
      [lessonId, payload.project_id, rule.trigger, rule.requirement, rule.verification_method],
    );
  }

  return { status: 'ok', lesson_id: lessonId };
}

export type ListLessonsParams = {
  projectId: string;
  limit?: number;
  after?: string;
  filters?: {
    lesson_type?: LessonType;
    tags_any?: string[];
  };
};

export type ListLessonsResult = {
  items: LessonItem[];
  next_cursor?: string;
  total_count: number;
};

export async function listLessons(params: ListLessonsParams): Promise<ListLessonsResult> {
  const pool = getDbPool();
  const limit = Math.min(Math.max(params.limit ?? 20, 1), 100);
  const lessonType = params.filters?.lesson_type;
  const tagsAny = (params.filters?.tags_any ?? []).filter(Boolean);

  const whereParts: string[] = ['project_id = $1'];
  const whereParams: any[] = [params.projectId];

  if (lessonType) {
    whereParams.push(lessonType);
    whereParts.push(`lesson_type = $${whereParams.length}`);
  }

  if (tagsAny.length > 0) {
    whereParams.push(tagsAny);
    whereParts.push(`tags && $${whereParams.length}::text[]`);
  }

  let cursorClause = '';
  if (params.after && params.after.trim().length > 0) {
    const { createdAtIso, lessonId } = decodeCursor(params.after.trim());
    whereParams.push(createdAtIso);
    const createdAtParam = `$${whereParams.length}::timestamptz`;
    whereParams.push(lessonId);
    const lessonIdParam = `$${whereParams.length}::uuid`;
    cursorClause = ` AND (created_at, lesson_id) < (${createdAtParam}, ${lessonIdParam})`;
  }

  const whereSql = whereParts.join(' AND ') + cursorClause;

  // total_count ignores pagination cursor (COUNT query separate).
  const countRes = await pool.query(
    `SELECT COUNT(*)::int AS total_count FROM lessons WHERE ${whereParts.join(' AND ')};`,
    whereParams.slice(0, 1 + (lessonType ? 1 : 0) + (tagsAny.length > 0 ? 1 : 0)),
  );
  const totalCount = Number(countRes.rows?.[0]?.total_count ?? 0);

  whereParams.push(limit);
  const limitParam = `$${whereParams.length}`;

  const res = await pool.query(
    `SELECT
      lesson_id,
      project_id,
      lesson_type,
      title,
      content,
      tags,
      source_refs,
      created_at,
      updated_at,
      captured_by
     FROM lessons
     WHERE ${whereSql}
     ORDER BY created_at DESC, lesson_id DESC
     LIMIT ${limitParam};`,
    whereParams,
  );

  const items = (res.rows ?? []).map(mapLessonRow);
  const last = items.length ? items[items.length - 1] : null;
  const next_cursor = last ? encodeCursor(new Date(last.created_at).toISOString(), last.lesson_id) : undefined;

  return { items, next_cursor, total_count: totalCount };
}

export type SearchLessonsParams = {
  projectId: string;
  query: string;
  limit?: number;
  filters?: {
    lesson_type?: LessonType;
    tags_any?: string[];
  };
};

export type SearchLessonsResult = {
  matches: Array<{
    lesson_id: string;
    lesson_type: LessonType;
    title: string;
    content_snippet: string;
    tags: string[];
    score: number;
  }>;
  explanations: string[];
};

function makeSnippet(s: string, maxChars: number) {
  const normalized = String(s ?? '').trim().replace(/\s+/g, ' ');
  if (normalized.length <= maxChars) return normalized;
  return normalized.slice(0, maxChars - 1) + '…';
}

export async function searchLessons(params: SearchLessonsParams): Promise<SearchLessonsResult> {
  const pool = getDbPool();
  const limit = Math.min(Math.max(params.limit ?? 10, 1), 50);
  const lessonType = params.filters?.lesson_type;
  const tagsAny = (params.filters?.tags_any ?? []).filter(Boolean);

  const [vec] = await embedTexts([params.query]);
  const vector = `[${vec.join(',')}]`;

  const sqlParams: any[] = [params.projectId, vector];
  const whereParts: string[] = ['l.project_id = $1'];

  if (lessonType) {
    sqlParams.push(lessonType);
    whereParts.push(`l.lesson_type = $${sqlParams.length}`);
  }

  if (tagsAny.length > 0) {
    sqlParams.push(tagsAny);
    whereParts.push(`l.tags && $${sqlParams.length}::text[]`);
  }

  sqlParams.push(limit);
  const limitParam = `$${sqlParams.length}`;

  const res = await pool.query(
    `SELECT
      l.lesson_id,
      l.lesson_type,
      l.title,
      l.content,
      l.tags,
      GREATEST(0, 1 - (l.embedding <=> $2::vector)) AS score
     FROM lessons l
     WHERE ${whereParts.join(' AND ')}
     ORDER BY l.embedding <=> $2::vector
     LIMIT ${limitParam};`,
    sqlParams,
  );

  const matches: SearchLessonsResult['matches'] = (res.rows ?? []).map((r: any) => ({
    lesson_id: String(r.lesson_id),
    lesson_type: String(r.lesson_type) as LessonType,
    title: String(r.title),
    content_snippet: makeSnippet(String(r.content), 280),
    tags: (r.tags ?? []) as string[],
    score: Number(r.score),
  }));

  return { matches, explanations: [] };
}

export async function deleteWorkspace(projectId: string) {
  const pool = getDbPool();

  await pool.query('BEGIN');
  try {
    // Delete in child-first order (no FKs in MVP schema, but keeps intent clear).
    await pool.query(`DELETE FROM guardrail_audit_logs WHERE project_id=$1`, [projectId]);
    await pool.query(`DELETE FROM guardrails WHERE project_id=$1`, [projectId]);
    await pool.query(`DELETE FROM chunks WHERE project_id=$1`, [projectId]);
    await pool.query(`DELETE FROM files WHERE project_id=$1`, [projectId]);
    await pool.query(`DELETE FROM lessons WHERE project_id=$1`, [projectId]);
    const deletedProjects = await pool.query(`DELETE FROM projects WHERE project_id=$1`, [projectId]);
    await pool.query('COMMIT');

    return {
      status: 'ok' as const,
      deleted: (deletedProjects.rowCount ?? 0) > 0,
      deleted_project_id: projectId,
    };
  } catch (err) {
    await pool.query('ROLLBACK');
    return {
      status: 'error' as const,
      deleted: false,
      deleted_project_id: projectId,
    };
  }
}

