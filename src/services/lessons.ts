import { randomUUID } from 'node:crypto';
import { getEnv } from '../env.js';
import { getDbPool } from '../db/client.js';
import { linkLessonToSymbols, upsertLessonNode } from '../kg/linker.js';
import { deleteProjectGraph } from '../kg/projectGraph.js';
import { embedTexts } from './embedder.js';
import { distillLesson } from './distiller.js';
import { rebuildProjectSnapshot } from './snapshot.js';
import { expandForFtsIndex, buildFtsQuery } from '../utils/ftsTokenizer.js';

export type LessonType = 'decision' | 'preference' | 'guardrail' | 'workaround' | 'general_note';
export type LessonStatus = 'draft' | 'active' | 'superseded' | 'archived';

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
  summary: string | null;
  quick_action: string | null;
  status: LessonStatus;
  superseded_by: string | null;
};

export type AddLessonResult = {
  status: 'ok';
  lesson_id: string;
  guardrail_inserted?: boolean;
  summary?: string | null;
  quick_action?: string | null;
  distillation?: { status: 'skipped' | 'ok' | 'failed'; reason?: string };
  conflict_suggestions?: Array<{ lesson_id: string; title: string; similarity: number }>;
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
    summary: r.summary != null ? String(r.summary) : null,
    quick_action: r.quick_action != null ? String(r.quick_action) : null,
    status: String(r.status ?? 'active') as LessonStatus,
    superseded_by: r.superseded_by != null ? String(r.superseded_by) : null,
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

async function findConflictSuggestions(
  projectId: string,
  embeddingLiteral: string,
): Promise<Array<{ lesson_id: string; title: string; similarity: number }>> {
  const pool = getDbPool();
  const res = await pool.query(
    `SELECT
      lesson_id,
      title,
      GREATEST(0, 1 - (embedding <=> $2::vector)) AS similarity
     FROM lessons
     WHERE project_id=$1
       AND status NOT IN ('superseded', 'archived')
     ORDER BY embedding <=> $2::vector ASC
     LIMIT 8;`,
    [projectId, embeddingLiteral],
  );

  const out: Array<{ lesson_id: string; title: string; similarity: number }> = [];
  for (const r of res.rows ?? []) {
    const sim = Number(r.similarity);
    if (!Number.isFinite(sim)) continue;
    if (sim < 0.62) continue; // threshold: likely related / possible conflict
    out.push({
      lesson_id: String(r.lesson_id),
      title: String(r.title ?? ''),
      similarity: sim,
    });
  }
  return out;
}

export async function addLesson(payload: LessonPayload): Promise<AddLessonResult> {
  const pool = getDbPool();
  const lessonId = randomUUID();

  const tags = payload.tags ?? [];
  const sourceRefs = payload.source_refs ?? [];

  const [embedding] = await embedTexts([payload.title + '. ' + payload.content]);
  // Note: title prepended to content for better query-document alignment.
  const embeddingLiteral = `[${embedding.join(',')}]`;

  const conflict_suggestions = await findConflictSuggestions(payload.project_id, embeddingLiteral);

  const env = getEnv();
  let summary: string | null = null;
  let quick_action: string | null = null;
  let lessonStatus: LessonStatus = 'active';
  let distillation: AddLessonResult['distillation'];

  if (!env.DISTILLATION_ENABLED) {
    distillation = { status: 'skipped', reason: 'DISTILLATION_ENABLED=false' };
  } else {
    try {
      const d = await distillLesson({ title: payload.title, content: payload.content });
      summary = d.summary;
      quick_action = d.quick_action;
      lessonStatus = 'active';
      distillation = { status: 'ok' };
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      distillation = { status: 'failed', reason: msg };
      lessonStatus = 'draft';
    }
  }

  await pool.query(
    `INSERT INTO projects(project_id, name)
     VALUES ($1, $2)
     ON CONFLICT (project_id) DO NOTHING;`,
    [payload.project_id, payload.project_id],
  );

  // Build FTS content with camelCase expansion for identifier-aware search.
  const ftsContent = expandForFtsIndex(payload.title + ' ' + payload.content);

  await pool.query(
    `INSERT INTO lessons(
      lesson_id, project_id, lesson_type, title, content, tags, source_refs,
      embedding, captured_by, summary, quick_action, status, superseded_by, created_at, updated_at, fts
    ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8::vector,$9,$10,$11,$12,$13, now(), now(), to_tsvector('english', $14));`,
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
      summary,
      quick_action,
      lessonStatus,
      null,
      ftsContent,
    ],
  );

  await upsertLessonNode({
    projectId: payload.project_id,
    lessonId,
    title: payload.title,
    lessonType: payload.lesson_type,
  }).catch(() => {});

  await linkLessonToSymbols({
    projectId: payload.project_id,
    lessonId,
    lessonType: payload.lesson_type,
    sourceRefs: sourceRefs,
  }).catch(() => {});

  let guardrail_inserted = false;
  if (payload.lesson_type === 'guardrail' || payload.guardrail) {
    const rule = payload.guardrail;
    if (!rule) {
      await rebuildProjectSnapshot(payload.project_id).catch(() => {});
      return {
        status: 'ok',
        lesson_id: lessonId,
        guardrail_inserted: false,
        summary,
        quick_action,
        distillation,
        conflict_suggestions: conflict_suggestions.length ? conflict_suggestions : undefined,
      };
    }

    await pool.query(
      `INSERT INTO guardrails(rule_id, project_id, trigger, requirement, verification_method, created_at)
       VALUES ($1,$2,$3,$4,$5, now());`,
      [lessonId, payload.project_id, rule.trigger, rule.requirement, rule.verification_method],
    );
    guardrail_inserted = true;
  }

  await rebuildProjectSnapshot(payload.project_id).catch(() => {});

  return {
    status: 'ok',
    lesson_id: lessonId,
    guardrail_inserted,
    summary,
    quick_action,
    distillation,
    conflict_suggestions: conflict_suggestions.length ? conflict_suggestions : undefined,
  };
}

export type ListLessonsParams = {
  projectId: string;
  limit?: number;
  after?: string;
  filters?: {
    lesson_type?: LessonType;
    tags_any?: string[];
    status?: LessonStatus;
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
  const status = params.filters?.status;

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

  if (status) {
    whereParams.push(status);
    whereParts.push(`status = $${whereParams.length}`);
  }

  const countRes = await pool.query(
    `SELECT COUNT(*)::int AS total_count FROM lessons WHERE ${whereParts.join(' AND ')};`,
    [...whereParams],
  );
  const totalCount = Number(countRes.rows?.[0]?.total_count ?? 0);

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
      captured_by,
      summary,
      quick_action,
      status,
      superseded_by
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
    include_all_statuses?: boolean;
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
    status: LessonStatus;
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
  const includeAll = Boolean(params.filters?.include_all_statuses);

  // Extract tokens for FTS query.
  const queryTokens = params.query.match(/[A-Za-z_][A-Za-z0-9_]{1,}/g) ?? [];
  const ftsQuery = buildFtsQuery(queryTokens, 'or');

  const [vec] = await embedTexts([params.query]);
  const vector = `[${vec.join(',')}]`;

  const sqlParams: any[] = [params.projectId, vector];
  const whereParts: string[] = ['l.project_id = $1'];

  if (!includeAll) {
    whereParts.push(`l.status NOT IN ('superseded', 'archived')`);
  }

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

  // Build hybrid scoring: semantic + FTS keyword boost.
  let ftsScoreExpr = '0';
  let ftsJoin = '';
  if (ftsQuery) {
    sqlParams.push(ftsQuery);
    const ftsParam = `$${sqlParams.length}`;
    // Use a LEFT JOIN subquery so FTS matches boost score but don't exclude non-FTS results.
    ftsJoin = `LEFT JOIN LATERAL (
      SELECT ts_rank(l.fts, to_tsquery('english', ${ftsParam})) AS fts_rank
      WHERE l.fts IS NOT NULL AND l.fts @@ to_tsquery('english', ${ftsParam})
    ) fts_sub ON true`;
    ftsScoreExpr = 'COALESCE(fts_sub.fts_rank, 0)';
  }

  const whereClause = whereParts.join(' AND ');

  const res = await pool.query(
    `SELECT
      l.lesson_id,
      l.lesson_type,
      l.title,
      l.content,
      l.summary,
      l.tags,
      l.status,
      GREATEST(0, 1 - (l.embedding <=> $2::vector)) AS sem_score,
      ${ftsScoreExpr} AS fts_score,
      LEAST(1.0, GREATEST(0, 1 - (l.embedding <=> $2::vector)) + 0.40 * ${ftsScoreExpr}) AS score
     FROM lessons l
     ${ftsJoin}
     WHERE ${whereClause}
     ORDER BY score DESC, sem_score DESC
     LIMIT ${limitParam};`,
    sqlParams,
  );

  const explanations: string[] = [];
  if (ftsQuery) {
    const ftsHits = (res.rows ?? []).filter((r: any) => Number(r.fts_score) > 0).length;
    explanations.push(`hybrid: sem + 0.40*fts, fts_hits=${ftsHits}/${(res.rows ?? []).length}`);
  }

  const matches: SearchLessonsResult['matches'] = (res.rows ?? []).map((r: any) => {
    const sum = r.summary != null ? String(r.summary).trim() : '';
    const snippetSource = sum.length ? sum : String(r.content);
    return {
      lesson_id: String(r.lesson_id),
      lesson_type: String(r.lesson_type) as LessonType,
      title: String(r.title),
      content_snippet: makeSnippet(snippetSource, 280),
      tags: (r.tags ?? []) as string[],
      score: Number(r.score),
      status: String(r.status ?? 'active') as LessonStatus,
    };
  });

  return { matches, explanations };
}

export async function updateLessonStatus(params: {
  projectId: string;
  lessonId: string;
  status: LessonStatus;
  supersededBy?: string | null;
}): Promise<{ status: 'ok' | 'error'; error?: string }> {
  const pool = getDbPool();

  const existing = await pool.query(`SELECT lesson_id FROM lessons WHERE project_id=$1 AND lesson_id=$2`, [
    params.projectId,
    params.lessonId,
  ]);
  if (!existing.rowCount) {
    return { status: 'error', error: 'lesson not found for project' };
  }

  if (params.supersededBy) {
    const other = await pool.query(`SELECT lesson_id FROM lessons WHERE project_id=$1 AND lesson_id=$2`, [
      params.projectId,
      params.supersededBy,
    ]);
    if (!other.rowCount) {
      return { status: 'error', error: 'superseded_by lesson not found for project' };
    }
  }

  await pool.query(
    `UPDATE lessons
     SET status=$3,
         superseded_by=$4,
         updated_at=now()
     WHERE project_id=$1 AND lesson_id=$2;`,
    [params.projectId, params.lessonId, params.status, params.supersededBy ?? null],
  );

  await rebuildProjectSnapshot(params.projectId).catch(() => {});

  return { status: 'ok' };
}

export async function deleteWorkspace(projectId: string) {
  const pool = getDbPool();

  await pool.query('BEGIN');
  try {
    await pool.query(`DELETE FROM workspace_deltas WHERE project_id=$1`, [projectId]);
    await pool.query(`DELETE FROM project_workspaces WHERE project_id=$1`, [projectId]);
    await pool.query(`DELETE FROM project_sources WHERE project_id=$1`, [projectId]);
    await pool.query(`DELETE FROM async_jobs WHERE project_id=$1`, [projectId]);
    await pool.query(`DELETE FROM git_lesson_proposals WHERE project_id=$1`, [projectId]);
    await pool.query(`DELETE FROM git_commit_files WHERE project_id=$1`, [projectId]);
    await pool.query(`DELETE FROM git_commits WHERE project_id=$1`, [projectId]);
    await pool.query(`DELETE FROM git_ingest_runs WHERE project_id=$1`, [projectId]);
    await pool.query(`DELETE FROM project_snapshots WHERE project_id=$1`, [projectId]);
    await pool.query(`DELETE FROM guardrail_audit_logs WHERE project_id=$1`, [projectId]);
    await pool.query(`DELETE FROM guardrails WHERE project_id=$1`, [projectId]);
    await pool.query(`DELETE FROM chunks WHERE project_id=$1`, [projectId]);
    await pool.query(`DELETE FROM files WHERE project_id=$1`, [projectId]);
    await pool.query(`DELETE FROM lessons WHERE project_id=$1`, [projectId]);
    const deletedProjects = await pool.query(`DELETE FROM projects WHERE project_id=$1`, [projectId]);
    await pool.query('COMMIT');

    await deleteProjectGraph(projectId).catch(err => {
      console.warn('[delete_workspace] deleteProjectGraph failed:', err instanceof Error ? err.message : err);
    });

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
