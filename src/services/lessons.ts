import { randomUUID } from 'node:crypto';
import { getEnv } from '../env.js';
import { ContextHubError } from '../core/index.js';
import { assertAuthorized } from './authorize.js';
import { canReadLessonsPartition } from './projectGroups.js';
import { getDbPool } from '../db/client.js';
import { linkLessonToSymbols, upsertLessonNode } from '../kg/linker.js';
import { deleteProjectGraph } from '../kg/projectGraph.js';
import { embedTexts } from './embedder.js';
import { cohereRerank } from './rerankClient.js';
import { chatComplete, extractJsonArray } from './llm/index.js';
import { distillLesson } from './distiller.js';
import { rebuildProjectSnapshot } from './snapshot.js';
import { expandForFtsIndex, buildFtsQuery } from '../utils/ftsTokenizer.js';
import { nearSemanticKey } from '../utils/nearSemanticKey.js';
import { GUARDRAIL_LESSON_TYPES } from '../constants/lessonTypes.js';
import { validateLessonType } from './taxonomyService.js';
import {
  logLessonAccess,
  isSalienceDisabled,
  computeSalience,
  computeSalienceMultiProject,
  applyQueryConditionalSalienceBlend,
  getSalienceConfig,
  type AccessLogEntry,
} from './salience.js';
import * as z from 'zod/v4';
import { createModuleLogger } from '../utils/logger.js';

const logger = createModuleLogger('lessons');

export type LessonType = string;
// Phase 13 Sprint 13.3: 'pending-review' added (reachable only via submit_for_review).
export type LessonStatus = 'draft' | 'pending-review' | 'active' | 'superseded' | 'archived';

export type GuardrailRulePayload = {
  trigger: string;
  requirement: string;
  verification_method: 'recorded_test_event' | 'user_confirmation' | 'cli_exit_code' | string;
};

export type LessonPayload = {
  project_id: string;
  /** Actor Data Boundary F2f — acting principal; authorize() is the tenant/authz gate. */
  actingPrincipalId?: string | null;
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
  feedback_up?: number;
  feedback_down?: number;
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
    feedback_up: r.feedback_up ?? 0,
    feedback_down: r.feedback_down ?? 0,
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

/**
 * Generate 3 alternative search phrasings for a lesson.
 * Helps bridge vocabulary gaps (e.g., "programming languages" ↔ "service language policy").
 */
async function generateSearchAliases(title: string, content: string): Promise<string> {
  const env = getEnv();
  if (!env.DISTILLATION_ENABLED) return '';

  const model = env.DISTILLATION_MODEL;
  if (!model) return '';

  const baseUrl = (env.DISTILLATION_BASE_URL?.trim() || env.EMBEDDINGS_BASE_URL).replace(/\/$/, '');
  const apiKey = env.DISTILLATION_API_KEY ?? env.EMBEDDINGS_API_KEY;

  try {
    // Phase 17.2: shared transport — reasoning-suppression + answer extraction.
    const { content: text } = await chatComplete({
      baseUrl,
      apiKey,
      model,
      messages: [
        { role: 'system', content: 'Generate 3 alternative search queries that would help find this lesson. Include: 1) a question form, 2) keywords only, 3) a synonym/paraphrase. Output ONLY a JSON array of 3 strings.' },
        { role: 'user', content: `Title: ${title}\nContent: ${content.slice(0, 500)}` },
      ],
      temperature: 0.3,
      // Phase 14 round-2 fix: bumped from 200 to 3000 to accommodate reasoning
      // models (nemotron-3-nano) that consume budget on chain-of-thought before
      // emitting the final JSON array. (Reasoning suppression now also applied.)
      maxTokens: 3000,
      timeoutMs: 180000,
    });
    if (!text) return '';
    let arr: unknown;
    try {
      arr = extractJsonArray(text);
    } catch {
      return '';
    }
    if (!Array.isArray(arr)) return '';
    const aliases = arr.filter((s: unknown) => typeof s === 'string').slice(0, 3).join(' | ');
    logger.info({ title: title.slice(0, 50), aliases: aliases.slice(0, 100) }, 'generated search aliases');
    return aliases;
  } catch (err) {
    logger.warn({ error: err instanceof Error ? err.message : String(err) }, 'search alias generation failed');
    return '';
  }
}

export async function addLesson(payload: LessonPayload): Promise<AddLessonResult> {
  // F2f: authorize() is the tenant/authz gate (REST + MCP inherit). write ⊃ read.
  await assertAuthorized(payload.actingPrincipalId, 'write', { kind: 'project', id: payload.project_id });
  // Phase 13 Sprint 13.5 — single source of truth for lesson_type validation.
  // Runs at the SERVICE layer so REST POST /api/lessons, REST /import, MCP
  // add_lesson, and any future caller all hit the same gate. Built-ins always
  // accepted; active taxonomy profile types additively accepted.
  await validateLessonType(payload.project_id, payload.lesson_type, { actingPrincipalId: payload.actingPrincipalId });

  const pool = getDbPool();
  const lessonId = randomUUID();

  const tags = payload.tags ?? [];
  const sourceRefs = payload.source_refs ?? [];

  // Generate search aliases (alternative phrasings) for better vocabulary coverage.
  const searchAliases = await generateSearchAliases(payload.title, payload.content);

  // Embed title + aliases + content together for maximum searchability.
  const embeddingText = searchAliases
    ? `${payload.title}. ${searchAliases}. ${payload.content}`
    : `${payload.title}. ${payload.content}`;
  const [embedding] = await embedTexts([embeddingText]);
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

  // Build FTS content: title + aliases + content with camelCase expansion.
  const ftsSource = searchAliases
    ? `${payload.title} ${searchAliases} ${payload.content}`
    : `${payload.title} ${payload.content}`;
  const ftsContent = expandForFtsIndex(ftsSource);

  await pool.query(
    `INSERT INTO lessons(
      lesson_id, project_id, lesson_type, title, content, tags, source_refs,
      embedding, captured_by, summary, quick_action, status, superseded_by, created_at, updated_at, fts, search_aliases
    ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8::vector,$9,$10,$11,$12,$13, now(), now(), to_tsvector('english', $14), $15);`,
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
      searchAliases || null,
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
  // Phase 13 Sprint 13.5: extended to fire on `codex-guardrail` lesson_type too.
  // Preserves the `|| payload.guardrail` OR-branch for legacy callers (spec r1 F3).
  if (
    (GUARDRAIL_LESSON_TYPES as readonly string[]).includes(payload.lesson_type) ||
    payload.guardrail
  ) {
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

export type LessonSortField = 'created_at' | 'title' | 'lesson_type' | 'status';
export type SortOrder = 'asc' | 'desc';

export type ListLessonsParams = {
  projectId?: string;
  projectIds?: string[];
  /** Actor Data Boundary F2f — acting principal; authorize() is the tenant/authz gate. */
  actingPrincipalId?: string | null;
  limit?: number;
  /** Cursor-based pagination (legacy, still supported). */
  after?: string;
  /** Offset-based pagination (for page-number navigation). */
  offset?: number;
  /** Sort field (default: created_at). */
  sort?: LessonSortField;
  /** Sort order (default: desc). */
  order?: SortOrder;
  /** Text search — filters by title/content substring (case-insensitive). */
  q?: string;
  filters?: {
    lesson_type?: LessonType;
    tags_any?: string[];
    status?: LessonStatus;
    include_all_statuses?: boolean;
  };
};

export type ListLessonsResult = {
  items: LessonItem[];
  next_cursor?: string;
  total_count: number;
  /** Current page number (1-based, only when offset pagination used). */
  page?: number;
  /** Total pages (only when offset pagination used). */
  total_pages?: number;
};

const VALID_SORT_FIELDS: Set<string> = new Set(['created_at', 'title', 'lesson_type', 'status']);

/** Escape ILIKE wildcards in user input so `%` and `_` are matched literally. */
function escapeIlike(s: string): string {
  return s.replace(/[%_\\]/g, '\\$&');
}

export async function listLessons(params: ListLessonsParams): Promise<ListLessonsResult> {
  // F2f: read authorization per project axis. Multi-project ⇒ authorize EACH (a caller granted on
  // several projects legitimately spans them; one scoped outside its grants gets NOT_FOUND). The
  // "all projects" axis (no projectId/Ids) requires global read — a project-scoped caller can't list
  // across every tenant.
  if (params.projectIds && params.projectIds.length > 0) {
    for (const id of params.projectIds) {
      await assertAuthorized(params.actingPrincipalId, 'read', { kind: 'project', id });
    }
  } else if (params.projectId) {
    await assertAuthorized(params.actingPrincipalId, 'read', { kind: 'project', id: params.projectId });
  } else {
    await assertAuthorized(params.actingPrincipalId, 'read', { kind: 'global' });
  }
  const pool = getDbPool();
  const limit = Math.min(Math.max(params.limit ?? 20, 1), 100);
  const lessonType = params.filters?.lesson_type;
  const tagsAny = (params.filters?.tags_any ?? []).filter(Boolean);
  const status = params.filters?.status;
  const includeAll = Boolean(params.filters?.include_all_statuses);
  const sortField = VALID_SORT_FIELDS.has(params.sort ?? '') ? params.sort! : 'created_at';
  const sortOrder = params.order === 'asc' ? 'ASC' : 'DESC';

  // ── Build WHERE clause (shared by count + data queries) ──
  const ids = params.projectIds ?? (params.projectId ? [params.projectId] : []);
  const projectClause = ids.length === 1 ? 'project_id = $1' : 'project_id = ANY($1::text[])';
  const projectClauseL = ids.length === 1 ? 'l.project_id = $1' : 'l.project_id = ANY($1::text[])';
  const whereParams: any[] = [ids.length === 1 ? ids[0] : ids];
  const whereParts: string[] = [projectClause];
  const wherePartsL: string[] = [projectClauseL];

  if (lessonType) {
    whereParams.push(lessonType);
    whereParts.push(`lesson_type = $${whereParams.length}`);
    wherePartsL.push(`l.lesson_type = $${whereParams.length}`);
  }

  if (tagsAny.length > 0) {
    whereParams.push(tagsAny);
    whereParts.push(`tags && $${whereParams.length}::text[]`);
    wherePartsL.push(`l.tags && $${whereParams.length}::text[]`);
  }

  if (status) {
    whereParams.push(status);
    whereParts.push(`status = $${whereParams.length}`);
    wherePartsL.push(`l.status = $${whereParams.length}`);
  } else if (!includeAll) {
    whereParts.push(`status NOT IN ('superseded', 'archived')`);
    wherePartsL.push(`l.status NOT IN ('superseded', 'archived')`);
  }

  if (params.q && params.q.trim().length > 0) {
    whereParams.push(`%${escapeIlike(params.q.trim())}%`);
    whereParts.push(`(title ILIKE $${whereParams.length} OR content ILIKE $${whereParams.length})`);
    wherePartsL.push(`(l.title ILIKE $${whereParams.length} OR l.content ILIKE $${whereParams.length})`);
  }

  const whereSql = whereParts.join(' AND ');
  const whereSqlL = wherePartsL.join(' AND ');

  // ── Count ──
  const countRes = await pool.query(
    `SELECT COUNT(*)::int AS total_count FROM lessons WHERE ${whereSql};`,
    [...whereParams],
  );
  const totalCount = Number(countRes.rows?.[0]?.total_count ?? 0);

  // ── Pagination: snapshot param count before adding pagination-specific params ──
  const dataParams = [...whereParams];
  const useOffset = params.offset !== undefined && params.offset >= 0;

  let dataWhereSql = whereSqlL;
  let paginationSql: string;

  if (useOffset) {
    dataParams.push(limit);
    dataParams.push(params.offset);
    paginationSql = `LIMIT $${dataParams.length - 1} OFFSET $${dataParams.length}`;
  } else {
    // Cursor-based (legacy)
    if (params.after && params.after.trim().length > 0) {
      const { createdAtIso, lessonId } = decodeCursor(params.after.trim());
      dataParams.push(createdAtIso);
      dataParams.push(lessonId);
      dataWhereSql += ` AND (l.created_at, l.lesson_id) < ($${dataParams.length - 1}::timestamptz, $${dataParams.length}::uuid)`;
    }
    dataParams.push(limit);
    paginationSql = `LIMIT $${dataParams.length}`;
  }

  const orderSql = `ORDER BY l.${sortField} ${sortOrder}, l.lesson_id ${sortOrder}`;

  const res = await pool.query(
    `SELECT l.lesson_id, l.project_id, l.lesson_type, l.title, l.content, l.tags, l.source_refs,
            l.created_at, l.updated_at, l.captured_by, l.summary, l.quick_action, l.status, l.superseded_by,
            COALESCE(fb.up_count, 0)::int AS feedback_up,
            COALESCE(fb.down_count, 0)::int AS feedback_down
     FROM lessons l
     LEFT JOIN (
       SELECT lesson_id,
              COUNT(*) FILTER (WHERE vote = 1) AS up_count,
              COUNT(*) FILTER (WHERE vote = -1) AS down_count
       FROM lesson_feedback GROUP BY lesson_id
     ) fb ON fb.lesson_id = l.lesson_id
     WHERE ${dataWhereSql}
     ${orderSql}
     ${paginationSql};`,
    dataParams,
  );

  const items = (res.rows ?? []).map(mapLessonRow);
  const last = items.length ? items[items.length - 1] : null;
  const next_cursor = last ? encodeCursor(new Date(last.created_at).toISOString(), last.lesson_id) : undefined;

  const result: ListLessonsResult = { items, next_cursor, total_count: totalCount };

  if (useOffset) {
    result.total_pages = Math.max(1, Math.ceil(totalCount / limit));
    result.page = Math.floor((params.offset ?? 0) / limit) + 1;
  }

  return result;
}

export type SearchLessonsParams = {
  projectId: string;
  /** Actor Data Boundary F2f — acting principal; authorize() is the tenant/authz gate. */
  actingPrincipalId?: string | null;
  query: string;
  limit?: number;
  /** DEFERRED-030: when explicitly `false`, skip the server-side rerank
   *  dispatcher and return raw retrieval order. Default `true` (preserve
   *  current behavior). Used by `src/qc/rerankBenchmark.ts` to fetch an
   *  uncontaminated candidate pool when measuring client-side rerankers. */
  rerank?: boolean;
  filters?: {
    lesson_type?: LessonType;
    tags_any?: string[];
    include_all_statuses?: boolean;
  };
  /** DEFERRED-038: width of `content_snippet` in chars. Default 280 (a display
   *  preview for the GUI / agent search lists). LLM-SYNTHESIS callers (the
   *  `reflect` tool, the chat `search_lessons` tool) must pass a wide value
   *  (e.g. 2000) so the answerer receives the full lesson, not a preview that
   *  truncates the decision/content away. Backward-compatible default. */
  snippetMaxChars?: number;
};

export type SearchLessonsResult = {
  matches: Array<{
    lesson_id: string;
    project_id?: string;
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

// ─── Lesson Reranker (generative + cross-encoder) ─────────────────────

const RerankOrderSchema = z.object({
  order: z.array(z.number().int().nonnegative()),
});

export type RerankCandidate = { index: number; title: string; snippet: string };

function rerankBaseUrl(): string {
  const env = getEnv();
  return (env.RERANK_BASE_URL?.trim() || env.DISTILLATION_BASE_URL?.trim() || env.EMBEDDINGS_BASE_URL).replace(/\/$/, '');
}

function rerankApiKey(): string | undefined {
  const env = getEnv();
  return env.RERANK_API_KEY ?? env.DISTILLATION_API_KEY ?? env.EMBEDDINGS_API_KEY;
}

// Headers for the cross-encoder embedding rerank path (/v1/embeddings, not chat).
function rerankHeaders(): Record<string, string> {
  const headers: Record<string, string> = { 'Content-Type': 'application/json' };
  const key = rerankApiKey();
  if (key) headers.Authorization = `Bearer ${key}`;
  return headers;
}

/**
 * Generative reranker: sends all candidates to a chat model, gets JSON order back.
 * Works with: qwen3-reranker-4b, zerank-2, any chat/instruct model.
 */
async function rerankGenerative(query: string, candidates: RerankCandidate[], fetchImpl?: typeof fetch): Promise<number[]> {
  const env = getEnv();
  const model = env.RERANK_MODEL ?? env.DISTILLATION_MODEL;
  if (!model) return candidates.map(c => c.index);

  const timeoutMs = (env.RERANK_TIMEOUT_MS ?? 10000) + 5000;

  try {
    const system =
      'You are RankLLM, an intelligent assistant that can rank passages based on their relevancy to the query. ' +
      'Rank ALL passages. Output format: either JSON {"order":[0,2,1]} (0-based) or [1] > [3] > [2] (1-based). ' +
      'Only respond with the ranking, no explanation.';
    const user =
      `I will provide you with ${candidates.length} passages, each indicated by number identifier [].\n` +
      `Rank the passages based on their relevance to query: ${query}\n\n` +
      candidates.map((c, i) => `[${i + 1}] ${c.title}. ${c.snippet}`).join('\n') +
      `\n\nThe search query is: ${query}\n` +
      `Rank the ${candidates.length} passages above. The most relevant passage should be listed first.`;

    // Phase 17.2: shared transport — reasoning-suppression + answer extraction.
    const { content } = await chatComplete({
      baseUrl: rerankBaseUrl(),
      apiKey: rerankApiKey(),
      model,
      messages: [{ role: 'system', content: system }, { role: 'user', content: user }],
      temperature: 0.0,
      maxTokens: env.RERANK_LLM_MAX_TOKENS,
      timeoutMs,
      fetchImpl,
    });
    if (!content) return candidates.map(c => c.index);

    const raw = content;
    const n = candidates.length;
    let order: number[] = [];

    // Try JSON format first: {"order":[1,0,2]}
    const first = raw.indexOf('{');
    const last = raw.lastIndexOf('}');
    if (first >= 0 && last > first) {
      try {
        const parsed = JSON.parse(raw.slice(first, last + 1));
        const validated = RerankOrderSchema.safeParse(parsed);
        if (validated.success) order = validated.data.order;
      } catch { /* fall through to RankGPT format */ }
    }

    // Try RankGPT listwise format: [1] > [2] > [3] (1-based indices)
    if (!order.length) {
      const rankMatches = raw.match(/\[(\d+)\]/g);
      if (rankMatches && rankMatches.length >= 2) {
        order = rankMatches.map(m => parseInt(m.slice(1, -1), 10) - 1); // convert 1-based to 0-based
      }
    }

    if (!order.length) return candidates.map(c => c.index);

    const seen = new Set<number>();
    const cleaned: number[] = [];
    for (const idx of order) {
      if (idx >= 0 && idx < n && !seen.has(idx)) { seen.add(idx); cleaned.push(idx); }
    }
    for (let i = 0; i < n; i++) if (!seen.has(i)) cleaned.push(i);

    logger.info({ query: query.slice(0, 60), candidates: n, top3: cleaned.slice(0, 3), mode: 'generative' }, 'lesson rerank: done');
    return cleaned;
  } catch (err) {
    logger.warn({ error: err instanceof Error ? err.message : String(err) }, 'generative rerank: failed');
    return candidates.map(c => c.index);
  }
}

/**
 * Cross-encoder reranker: embeds query and candidates with the reranker model,
 * then sorts by cosine similarity. Works with: bge-reranker, gte-reranker, jina-reranker.
 *
 * Uses the reranker model (not the main embedding model) for a second-pass scoring.
 * The reranker model's embeddings are trained for relevance discrimination,
 * giving different rankings than the initial retrieval embeddings.
 */
async function rerankCrossEncoder(query: string, candidates: RerankCandidate[]): Promise<number[]> {
  const env = getEnv();
  const model = env.RERANK_MODEL;
  if (!model) return candidates.map(c => c.index);

  const url = `${rerankBaseUrl()}/v1/embeddings`;
  const ac = new AbortController();
  const timeoutMs = (env.RERANK_TIMEOUT_MS ?? 10000) + 5000;
  const t = setTimeout(() => ac.abort(), timeoutMs);

  try {
    // Embed query + all candidates in one batch call.
    const texts = [query, ...candidates.map(c => `${c.title}. ${c.snippet}`)];

    const res = await fetch(url, {
      method: 'POST', headers: rerankHeaders(), signal: ac.signal,
      body: JSON.stringify({ model, input: texts }),
    });

    if (!res.ok) { logger.warn({ status: res.status }, 'cross-encoder rerank: HTTP error'); return candidates.map(c => c.index); }

    const json = (await res.json()) as any;
    const embeddings: number[][] = (json?.data ?? [])
      .sort((a: any, b: any) => a.index - b.index)
      .map((d: any) => d.embedding);

    if (embeddings.length < 2) return candidates.map(c => c.index);

    const queryVec = embeddings[0];
    const candidateVecs = embeddings.slice(1);

    // Compute cosine similarity between query and each candidate.
    const scored = candidateVecs.map((vec, i) => ({
      index: i,
      score: cosineSimilarity(queryVec, vec),
    }));

    // Sort by score descending.
    scored.sort((a, b) => b.score - a.score);
    const order = scored.map(s => s.index);

    logger.info({
      query: query.slice(0, 60),
      candidates: candidates.length,
      top3: order.slice(0, 3),
      top3_scores: scored.slice(0, 3).map(s => s.score.toFixed(3)),
      mode: 'cross-encoder',
    }, 'lesson rerank: done');

    return order;
  } catch (err) {
    logger.warn({ error: err instanceof Error ? err.message : String(err) }, 'cross-encoder rerank: failed');
    return candidates.map(c => c.index);
  } finally { clearTimeout(t); }
}

function cosineSimilarity(a: number[], b: number[]): number {
  const n = Math.min(a.length, b.length);
  let dot = 0, normA = 0, normB = 0;
  for (let i = 0; i < n; i++) {
    dot += a[i] * b[i];
    normA += a[i] * a[i];
    normB += b[i] * b[i];
  }
  const denom = Math.sqrt(normA) * Math.sqrt(normB);
  return denom > 0 ? dot / denom : 0;
}

/**
 * DEFERRED-030: pure helper — given cohereRerank's ranked output, drop items
 * whose relevance_score is strictly below `minScore`. `minScore=0` (or NaN/neg)
 * is the no-floor case and is a pass-through. Exported for unit testing.
 *
 * NOTE: defined ABOVE its first user (`rerankExternalApi`) for reading order.
 */
export function applyRerankMinScore<R extends { relevanceScore: number }>(
  ranked: ReadonlyArray<R>,
  minScore: number,
): R[] {
  if (!Number.isFinite(minScore) || minScore <= 0) return [...ranked];
  return ranked.filter(r => r.relevanceScore >= minScore);
}

/**
 * DEFERRED-030: pure helper — decide whether to run the rerank dispatcher.
 * Extracted so the gating logic has a unit-test surface independent of the
 * full searchLessons pipeline (DB + embeddings + dispatcher). Both
 * `searchLessons` and `searchLessonsMulti` call this exact decision.
 *
 * - `rerankParam === false` is an EXPLICIT bypass (benchmark / debug). Wins.
 * - Otherwise: require a positive budget, ≥2 matches to reorder, and a
 *   configured reranker.
 */
export function shouldRunRerank(opts: {
  rerankParam: boolean | undefined;
  rerankBudget: number;
  matchesLength: number;
  rerankConfigured: boolean;
}): boolean {
  if (opts.rerankParam === false) return false;
  return opts.rerankBudget > 0 && opts.matchesLength >= 2 && opts.rerankConfigured;
}

/**
 * Sprint 12.1g — External-API reranker.
 *
 * POSTs query + candidate texts to a Cohere/TEI-compatible /rerank endpoint
 * and returns the new index order sorted by server-side score. Unblocks
 * true cross-encoder rerank models (bge-reranker-v2-m3, jina-reranker-v3,
 * etc.) that can't be used via LM Studio's /v1/embeddings bi-encoder path
 * (Sprint 12.1f finding).
 *
 * Works with: HuggingFace text-embeddings-inference (TEI), Infinity, Cohere.
 *
 * Request body:  {query, texts: [string, ...]}
 * Response body: [{index: number, score: number}, ...]  (sorted score DESC)
 *
 * Default server URL: http://tei-rerank:80 (docker-compose tei-rerank
 * service). Override via RERANK_BASE_URL.
 *
 * Failure modes (network error, 5xx, malformed response) fall back to
 * `candidates.map(c => c.index)` — effectively no-op. Same pattern as the
 * sibling reranker functions.
 */
export async function rerankExternalApi(query: string, candidates: RerankCandidate[]): Promise<number[]> {
  const env = getEnv();
  const baseUrl = env.RERANK_BASE_URL ?? 'http://tei-rerank:80';

  const ac = new AbortController();
  const timeoutMs = (env.RERANK_TIMEOUT_MS ?? 10000) + 5000;
  const t = setTimeout(() => ac.abort(), timeoutMs);

  try {
    const texts = candidates.map(c => `${c.title}. ${c.snippet}`);
    const res = await fetch(`${baseUrl}/rerank`, {
      method: 'POST',
      headers: rerankHeaders(),
      signal: ac.signal,
      body: JSON.stringify({ query, texts }),
    });

    if (!res.ok) {
      logger.warn({ status: res.status, url: `${baseUrl}/rerank` },
        'external-api rerank: HTTP error — falling back to no-rerank. Ensure tei-rerank service is running: `docker compose --profile measurement up -d tei-rerank`');
      return candidates.map(c => c.index);
    }

    const json = (await res.json()) as Array<{ index: number; score: number }>;
    if (!Array.isArray(json) || json.length === 0) {
      logger.warn({ shape: typeof json, url: `${baseUrl}/rerank` },
        'external-api rerank: empty or malformed response — falling back to no-rerank');
      return candidates.map(c => c.index);
    }

    // DEFERRED-030: floor (TEI returns `{index, score}` — same semantics as Cohere).
    const ranked = json.map(r => ({ index: r.index, relevanceScore: r.score }));
    const filtered = applyRerankMinScore(ranked, env.RERANK_MIN_SCORE);
    const droppedByFloor = ranked.length - filtered.length;

    // filtered is sorted by score DESC; map server-side indices (into `texts`)
    // back to caller-supplied index fields.
    const order = filtered
      .map(r => candidates[r.index]?.index)
      .filter((v): v is number => v !== undefined);

    logger.info({
      query: query.slice(0, 60),
      candidates: candidates.length,
      top3: order.slice(0, 3),
      top3_scores: filtered.slice(0, 3).map(r => r.relevanceScore.toFixed(5)),
      dropped_by_floor: droppedByFloor,
      min_score: env.RERANK_MIN_SCORE,
      mode: 'external-api',
    }, 'lesson rerank: done');

    // See rerankCohereApi: honor full-drop floor; otherwise base-order fallback.
    if (order.length === 0 && droppedByFloor > 0) return [];
    return order;
  } catch (err) {
    logger.warn({ error: err instanceof Error ? err.message : String(err), url: `${baseUrl}/rerank` },
      'external-api rerank: network error — falling back to no-rerank. Ensure tei-rerank service is running: `docker compose --profile measurement up -d tei-rerank`');
    return candidates.map(c => c.index);
  } finally { clearTimeout(t); }
}

/**
 * Cohere-compatible external reranker (2026-06-16). Adapts lesson candidates to
 * the shared {@link cohereRerank} boundary used by local-rerank-service and any
 * Cohere/Jina/Voyage cloud endpoint. Document text = `title. snippet` (parity
 * with the TEI path). Maps server indices back to caller index fields. Failure
 * falls back to base order — same contract as the sibling rerankers.
 */
async function rerankCohereApi(query: string, candidates: RerankCandidate[]): Promise<number[]> {
  const env = getEnv();
  const baseUrl = env.RERANK_BASE_URL ?? 'http://127.0.0.1:28417';
  const model = env.RERANK_MODEL ?? 'bge-reranker-v2-m3';
  const documents = candidates.map(c => `${c.title}. ${c.snippet}`);
  try {
    const ranked = await cohereRerank({
      query,
      documents,
      baseUrl,
      apiKey: env.RERANK_API_KEY,
      model,
      timeoutMs: env.RERANK_API_TIMEOUT_MS,
    });
    // DEFERRED-030: enforce RERANK_MIN_SCORE floor before mapping — sub-floor
    // candidates are DROPPED entirely (caller `searchLessons` removes them
    // from the result set), not just demoted.
    const filtered = applyRerankMinScore(ranked, env.RERANK_MIN_SCORE);
    const droppedByFloor = ranked.length - filtered.length;
    const order = filtered
      .map(r => candidates[r.index]?.index)
      .filter((v): v is number => v !== undefined);
    logger.info({
      candidates: candidates.length,
      top3: order.slice(0, 3),
      top3_scores: filtered.slice(0, 3).map(r => r.relevanceScore.toFixed(4)),
      dropped_by_floor: droppedByFloor,
      min_score: env.RERANK_MIN_SCORE,
      mode: 'cohere-api',
    }, 'lesson rerank: done');
    // Empty post-floor result: if the floor filtered EVERYTHING out, honor
    // the filter (return empty → caller drops all reranked candidates).
    // Empty WITHOUT a floor (degenerate cohereRerank response) → fall back
    // to base order so we don't silently drop the entire pool.
    if (order.length === 0 && droppedByFloor > 0) return [];
    return order.length ? order : candidates.map(c => c.index);
  } catch (err) {
    logger.warn({ error: err instanceof Error ? err.message : String(err), url: `${baseUrl}/v1/rerank` },
      'cohere-api rerank: failed — falling back to no-rerank. Ensure local-rerank-service is running.');
    return candidates.map(c => c.index);
  }
}

/** Whether a usable reranker is configured. 2026-06-16 measurement-bug fix:
 *  the `api` (cross-encoder service) and `cross-encoder` (embedding-cosine) paths
 *  do NOT require DISTILLATION_ENABLED — that flag gates only the generative LLM
 *  path. Conflating them silently disabled cross-encoder lesson rerank whenever
 *  distillation was off, making rerank A/Bs measure no-rerank-vs-no-rerank. */
export function rerankConfigured(): boolean {
  const env = getEnv();
  if (env.RERANK_TYPE === 'api' || env.RERANK_TYPE === 'cross-encoder') return true;
  return Boolean((env.RERANK_MODEL || env.DISTILLATION_MODEL) && env.DISTILLATION_ENABLED);
}

/**
 * Dispatch to the correct reranker based on RERANK_TYPE.
 *
 * Generic over candidate kind: only reads `query` + `candidates`
 * (`{index,title,snippet}`). Shared with the chunks surface (DEFERRED-034) —
 * was named `rerankLessons` historically but is lesson-agnostic.
 */
export async function rerankCandidates(params: {
  query: string;
  candidates: RerankCandidate[];
  /** DEFERRED-035: injectable fetch for caller-wiring tests (generative path). */
  fetchImpl?: typeof fetch;
}): Promise<number[]> {
  const env = getEnv();

  // Sprint 12.1g — 'api' mode uses an external /rerank server (TEI, Infinity,
  // Cohere). No LM Studio model required; RERANK_BASE_URL alone determines
  // destination. Checked FIRST so the DISTILLATION_MODEL fallback below
  // doesn't suppress api mode when DISTILLATION_ENABLED=false.
  // 2026-06-16: RERANK_API_PROTOCOL selects the wire format — 'cohere' (default,
  // local-rerank-service + cloud) or 'tei' (legacy HuggingFace TEI).
  if (env.RERANK_TYPE === 'api') {
    return env.RERANK_API_PROTOCOL === 'tei'
      ? rerankExternalApi(params.query, params.candidates)
      : rerankCohereApi(params.query, params.candidates);
  }

  const model = env.RERANK_MODEL ?? env.DISTILLATION_MODEL;
  if (!model) return params.candidates.map(c => c.index);

  // For generative mode, DISTILLATION_ENABLED must be true (needs chat API).
  // For cross-encoder mode, only needs embedding API — no distillation required.
  if (env.RERANK_TYPE === 'cross-encoder') {
    return rerankCrossEncoder(params.query, params.candidates);
  }

  if (!env.DISTILLATION_ENABLED) return params.candidates.map(c => c.index);
  return rerankGenerative(params.query, params.candidates, params.fetchImpl);
}

/**
 * Sprint 12.1a — near-semantic dedup for lesson search results.
 *
 * Collapses matches that share a `(project_id, lesson_type, nearSemanticKey(title, content_snippet))`
 * tuple into a single representative: the first-seen (highest-ranked) item
 * from each cluster. Preserves input ordering; drops subsequent cluster
 * members. Pure function — no I/O.
 *
 * Motivation: the free-context-hub lesson catalog contains multiple
 * same-title-different-UUID clusters ("Global search test retry pattern"
 * x6+, "Max retry attempts must be 3" x5+, "Valid: impexp-<ts>-extra"
 * x4+). Sprint 12.0.1 baseline measured `dup@10 nearsem = 0.42` on
 * lessons via the content-level key. By deduplicating with the same
 * content component, we collapse each cluster to one representative;
 * the metric drops to 0 on the next baseline.
 *
 * Key tuple (Sprint 12.1a /review-impl MED-1 + MED-2):
 *   - `project_id` included → cross-project "same content" variants
 *     (e.g. shared guardrails in group-scoped projects) are NOT
 *     collapsed; each project keeps its own representative.
 *   - `lesson_type` included → a guardrail and a decision with
 *     identical title+snippet stay distinct because they carry
 *     different downstream roles.
 *   - `nearSemanticKey(title, content_snippet)` → catches timestamp-
 *     variant fixtures via normalizeForHash digit-collapse.
 *
 * Generic constraint uses `string | undefined` (not optional `?`) on
 * content_snippet so TypeScript catches silent narrowing if the field
 * is removed from the match type.
 *
 * Opt-out: `LESSONS_DEDUP_DISABLED=true` in the environment restores
 * legacy behavior (no dedup). Intended for A/B measurement and emergency
 * rollback, not as a permanent toggle.
 */
export function dedupLessonMatches<T extends {
  project_id?: string;
  lesson_type: string;
  title: string;
  content_snippet: string | undefined;
}>(matches: ReadonlyArray<T>): T[] {
  const seen = new Set<string>();
  const out: T[] = [];
  for (const m of matches) {
    // `project_id` is optional on SearchLessonsResult.matches for historical
    // reasons; always-populated-by-the-producer in practice but fall back to
    // '' for type safety. Items missing project_id collapse together within
    // same type+content — acceptable for the degenerate case (no known producer).
    const key = `${m.project_id ?? ''}|${m.lesson_type}|${nearSemanticKey(m.title, m.content_snippet)}`;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(m);
  }
  return out;
}

/** Env-driven opt-out for dedup. Read lazily so tests can toggle it. */
function isDedupDisabled(): boolean {
  return process.env.LESSONS_DEDUP_DISABLED === 'true';
}

export async function searchLessons(params: SearchLessonsParams): Promise<SearchLessonsResult> {
  // F2f: read authorization (REST + MCP inherit).
  await assertAuthorized(params.actingPrincipalId, 'read', { kind: 'project', id: params.projectId });
  const pool = getDbPool();
  const limit = Math.min(Math.max(params.limit ?? 10, 1), 50);
  const lessonType = params.filters?.lesson_type;
  const tagsAny = (params.filters?.tags_any ?? []).filter(Boolean);
  const includeAll = Boolean(params.filters?.include_all_statuses);

  // Extract tokens for FTS query.
  const queryTokens = params.query.match(/[A-Za-z_][A-Za-z0-9_]{1,}/g) ?? [];
  const ftsQuery = buildFtsQuery(queryTokens, 'or');

  // DEFERRED-025: degrade to FTS-only when embeddings are unavailable rather than
  // hard-failing the search (honors the Phase 6 tiered-search graceful-fallback design).
  let vector: string | null = null;
  try {
    const [vec] = await embedTexts([params.query]);
    vector = `[${vec.join(',')}]`;
  } catch (err) {
    logger.warn(
      { err: err instanceof Error ? err.message : String(err) },
      'searchLessons: embeddings unavailable — falling back to FTS-only ranking (DEFERRED-025)',
    );
  }

  // No semantic vector AND no FTS tokens → nothing to rank on.
  if (vector === null && !ftsQuery) {
    return { matches: [], explanations: ['embeddings unavailable and no FTS tokens in query — empty result'] };
  }

  const sqlParams: any[] = [params.projectId];
  let semParam: string | null = null;
  if (vector !== null) {
    sqlParams.push(vector);
    semParam = `$${sqlParams.length}`;
  }
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

  // ── Dynamic retrieval pool sizing ──
  // Count total lessons to scale the retrieval funnel.
  // Separate query — doesn't need the vector param.
  let totalLessons = 0;
  try {
    const countRes = await pool.query(
      `SELECT count(*)::int AS n FROM lessons WHERE project_id = $1`,
      [params.projectId],
    );
    totalLessons = Number(countRes.rows?.[0]?.n ?? 0);
  } catch { /* best-effort */ }

  // Rerank budget scales with lesson count (enterprise pattern: retrieve wide, rerank narrow).
  //   <20 lessons: no rerank needed (semantic alone is fine)
  //   <50 lessons: rerank top 10
  //   <200 lessons: rerank top 20
  //   <500 lessons: rerank top 30
  //   500+: cap at 30 (beyond this, reranker latency dominates)
  // Rerank budget: skip for small lesson sets where semantic order is already good.
  // At <50 lessons, reranking shuffles results without improving quality.
  // At 50+ lessons, noise increases and reranking helps surface the right answer.
  const rerankBudget =
    totalLessons < 50 ? 0 :
    totalLessons < 200 ? 15 :
    totalLessons < 500 ? 25 :
    30;

  // Fetch 2x rerank budget to ensure correct answer is in the pool.
  const fetchLimit = Math.max(limit, rerankBudget > 0 ? rerankBudget * 2 : limit * 3);
  sqlParams.push(Math.min(fetchLimit, 60)); // hard cap at 60
  const limitParam = `$${sqlParams.length}`;

  // Build hybrid scoring: semantic + FTS keyword boost.
  let ftsScoreExpr = '0';
  let ftsJoin = '';
  let ftsParam: string | null = null;
  if (ftsQuery) {
    sqlParams.push(ftsQuery);
    ftsParam = `$${sqlParams.length}`;
    // Use a LEFT JOIN subquery so FTS matches boost score but don't exclude non-FTS results.
    ftsJoin = `LEFT JOIN LATERAL (
      SELECT ts_rank(l.fts, to_tsquery('english', ${ftsParam})) AS fts_rank
      WHERE l.fts IS NOT NULL AND l.fts @@ to_tsquery('english', ${ftsParam})
    ) fts_sub ON true`;
    ftsScoreExpr = 'COALESCE(fts_sub.fts_rank, 0)';
  }

  // DEFERRED-025: in FTS-only fallback (no semantic vector) require an actual FTS
  // match, so we return relevant rows rather than the whole table ranked by sem=0.
  if (vector === null && ftsParam) {
    whereParts.push(`l.fts @@ to_tsquery('english', ${ftsParam})`);
  }

  // Semantic score term — '0' constant in FTS-only fallback (no vector param).
  const semScoreExpr = semParam
    ? `GREATEST(0, 1 - (l.embedding <=> ${semParam}::vector))`
    : '0';

  const whereClause = whereParts.join(' AND ');

  const res = await pool.query(
    `SELECT
      l.lesson_id,
      l.project_id,
      l.lesson_type,
      l.title,
      l.content,
      l.summary,
      l.tags,
      l.status,
      ${semScoreExpr} AS sem_score,
      ${ftsScoreExpr} AS fts_score,
      LEAST(1.0, ${semScoreExpr} + 0.40 * ${ftsScoreExpr}) AS score
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

  // Build initial matches from DB results.
  // Sprint 12.1d: retain a RELEVANCE SIGNAL per lesson so the salience blend
  // can condition its boost on how well the lesson matches the current
  // query. Sprint 12.1d /review-impl MED-2 — use `max(sem_score, fts_score)`
  // rather than pure sem_score so FTS-only relevant matches (specific
  // identifiers, short technical tokens) keep their legitimate boost instead
  // of being cancelled by low semantic similarity.
  //
  // MED-1 NaN guard: Number(NaN) = NaN; the downstream blendHybridScore
  // returns hybridScore unchanged when relevance is non-finite. Storing NaN
  // here is safe — the blend function handles it. Prefer not to replace NaN
  // with 0 at write-time so the signal path is debuggable.
  const relevanceSignalByLessonId = new Map<string, number>();
  let matches: SearchLessonsResult['matches'] = (res.rows ?? []).map((r: any) => {
    const sum = r.summary != null ? String(r.summary).trim() : '';
    const snippetSource = sum.length ? sum : String(r.content);
    const lessonId = String(r.lesson_id);
    const semScore = Number(r.sem_score);
    const ftsScore = Number(r.fts_score);
    // Composite: whichever signal is stronger. Both are in ~[0, 1];
    // ts_rank can rarely exceed 1 but the clamp in blendHybridScore caps it.
    const relevance = Math.max(
      Number.isFinite(semScore) ? semScore : 0,
      Number.isFinite(ftsScore) ? ftsScore : 0,
    );
    relevanceSignalByLessonId.set(lessonId, relevance);
    return {
      lesson_id: lessonId,
      project_id: String(r.project_id),
      lesson_type: String(r.lesson_type) as LessonType,
      title: String(r.title),
      content_snippet: makeSnippet(snippetSource, params.snippetMaxChars ?? 280),
      tags: (r.tags ?? []) as string[],
      score: Number(r.score),
      status: String(r.status ?? 'active') as LessonStatus,
    };
  });

  // Sprint 12.1c / 12.1d — salience blend (read path), query-conditional.
  // Runs BEFORE rerank so rerank can refine on the salience-adjusted order.
  // Multiplies each match's hybrid score by `(1 + α × salience × relevance)`.
  // The relevance factor addresses the 12.1c popularity feedback loop by
  // scaling boost with how well the lesson matches THIS query (semantic OR
  // keyword), not just historical access frequency.
  if (!isSalienceDisabled() && matches.length > 0) {
    try {
      const salienceConfig = getSalienceConfig();
      const candidateIds = matches.map((m) => m.lesson_id);
      const salienceMap = await computeSalience(
        pool,
        params.projectId,
        candidateIds,
        salienceConfig,
      );
      if (salienceMap.size > 0 && salienceConfig.alpha > 0) {
        const { effectiveBoosts } = applyQueryConditionalSalienceBlend(
          matches,
          salienceMap,
          relevanceSignalByLessonId,
          salienceConfig.alpha,
        );
        explanations.push(
          `salience: enabled query-conditional (α=${salienceConfig.alpha}, halfLife=${salienceConfig.halfLifeDays}d); ${salienceMap.size}/${matches.length} with access history, ${effectiveBoosts} effective after relevance-gating`,
        );
      } else {
        explanations.push(
          salienceConfig.alpha === 0
            ? 'salience: α=0, no boost applied (logging still active)'
            : `salience: no access history for any candidate (${matches.length} lessons)`,
        );
      }
    } catch (err) {
      // Salience is a boost, not a requirement — fail-open.
      explanations.push(
        `salience: skipped due to error (${err instanceof Error ? err.message : String(err)})`,
      );
    }
  } else if (isSalienceDisabled()) {
    explanations.push('salience: disabled via LESSONS_SALIENCE_DISABLED');
  }

  // LLM rerank: re-order top candidates for better ranking.
  // Dynamic budget: skip for small sets, scale up for large lesson bases.
  //
  // DEFERRED-030: `params.rerank === false` is an explicit opt-out (the benchmark
  // harness uses it to fetch a raw pre-rerank pool so client-side reranker A/Bs
  // measure the cross-encoder, not the cross-encoder on top of itself).
  const env = getEnv();
  if (params.rerank === false) {
    explanations.push('rerank: skipped (rerank=false on request)');
  } else if (shouldRunRerank({
    rerankParam: params.rerank,
    rerankBudget,
    matchesLength: matches.length,
    rerankConfigured: rerankConfigured(),
  })) {
    try {
      const rerankCount = Math.min(matches.length, rerankBudget);
      const rerankCandidateList = matches.slice(0, rerankCount).map((m, i) => ({
        index: i,
        title: m.title,
        snippet: m.content_snippet,
      }));

      const rerankedOrder = await rerankCandidates({ query: params.query, candidates: rerankCandidateList });

      // Apply reranked order to matches. DEFERRED-030: dispatcher MAY return
      // fewer indices than rerankCount — EITHER because `RERANK_MIN_SCORE>0`
      // filtered off-topic candidates, OR because the rerank server returned
      // a short response. Distinguish in the explanation so a debug reader
      // can tell which mechanism dropped items.
      const rerankedTop = rerankedOrder.map(i => matches[i]).filter(Boolean);
      const remaining = matches.slice(rerankCandidateList.length);
      const delta = rerankCount - rerankedTop.length;
      matches = [...rerankedTop, ...remaining];

      const note = delta > 0
        ? (env.RERANK_MIN_SCORE > 0
            ? `, dropped=${delta} (min_score=${env.RERANK_MIN_SCORE})`
            : `, partial_rerank=${rerankedTop.length}/${rerankCount}`)
        : '';
      explanations.push(`reranked: top ${rerankedTop.length}/${rerankCount} candidates (budget=${rerankBudget}, total_lessons=${totalLessons}${note})`);
    } catch (err) {
      explanations.push(`rerank skipped: ${err instanceof Error ? err.message : String(err)}`);
    }
  }

  // Sprint 12.1a — near-semantic dedup. Collapses same-(project,type,title,
  // snippet) clusters before trimming so unique items that were pushed below
  // cluster duplicates get surfaced. Opt-out via LESSONS_DEDUP_DISABLED=true
  // for A/B measurement and emergency rollback.
  //
  // Sprint 12.1a /review-impl LOW-3: always emit an explanation so operators
  // can distinguish "dedup ON and no dupes found" from "dedup OFF entirely."
  if (isDedupDisabled()) {
    explanations.push('dedup: disabled via LESSONS_DEDUP_DISABLED');
  } else {
    const before = matches.length;
    matches = dedupLessonMatches(matches);
    const dropped = before - matches.length;
    explanations.push(
      dropped > 0
        ? `dedup: enabled, collapsed ${dropped} near-semantic duplicate${dropped === 1 ? '' : 's'} (${before}→${matches.length})`
        : `dedup: enabled, 0 collapsed (all ${before} items already distinct)`,
    );
  }

  // Trim to the originally requested limit after reranking + dedup.
  matches = matches.slice(0, limit);

  // Sprint 12.1c — write path #1: consideration-search. Every returned
  // match contributes to salience, weighted inversely by rank so the
  // top-1 counts fully and rank-10 contributes just 0.1. Fire-and-forget:
  // a write failure must never break retrieval. Guarded by the salience
  // kill-switch so --control A/B measurement works cleanly.
  if (!isSalienceDisabled() && matches.length > 0) {
    const entries: AccessLogEntry[] = matches.map((m, i) => ({
      lesson_id: m.lesson_id,
      project_id: m.project_id ?? params.projectId,
      context: 'consideration-search',
      weight: 1.0 / (i + 1),
      metadata: { query: params.query, rank: i + 1 },
    }));
    void logLessonAccess(pool, entries);
  }

  return { matches, explanations };
}

// ── Multi-project search ──

export type SearchLessonsMultiParams = {
  projectIds: string[];
  /** Actor Data Boundary F2f — acting principal; authorize() is the tenant/authz gate. */
  actingPrincipalId?: string | null;
  query: string;
  limit?: number;
  /** DEFERRED-030: see {@link SearchLessonsParams.rerank}. */
  rerank?: boolean;
  filters?: {
    lesson_type?: LessonType;
    tags_any?: string[];
    include_all_statuses?: boolean;
  };
  /** DEFERRED-038: see {@link SearchLessonsParams.snippetMaxChars}. */
  snippetMaxChars?: number;
};

/**
 * Search lessons across multiple projects in a single query.
 * Uses `WHERE project_id = ANY($1::text[])` for efficient multi-project search.
 * Single embedding computation, single SQL query, single rerank pass.
 */
export async function searchLessonsMulti(params: SearchLessonsMultiParams): Promise<SearchLessonsResult> {
  const pool = getDbPool();
  const projectIds = [...new Set(params.projectIds.filter(Boolean))];

  // [DEFERRED-049] lessons-read UNION (canReadLessonsPartition): each id's lessons are a data partition
  // that may be a project, a group, or (legacy) both. Readable if read@project OR read@group — the group
  // arm fires ONLY for a real group id (adv REVIEW-CODE #1). Neither → NOT_FOUND (no existence oracle;
  // include_groups callers graceful-skip NOT_FOUND). Group TOPOLOGY stays strict `group`. auth-off → ALLOW.
  for (const id of projectIds) {
    if (!(await canReadLessonsPartition(params.actingPrincipalId, id))) {
      throw new ContextHubError('NOT_FOUND', `No readable lessons partition "${id}".`);
    }
  }

  // Single-id fast path — ONLY for a non-group id. searchLessons() re-authorizes its id strictly as
  // `{kind:'project'}`, which would reject a group-only reader, so a single GROUP id falls through to
  // the ANY() path below (already authorized via the union above).
  if (projectIds.length === 1) {
    const isGroup = ((await pool.query(`SELECT 1 FROM project_groups WHERE group_id = $1`, [projectIds[0]])).rowCount ?? 0) > 0;
    if (!isGroup) {
      return searchLessons({ projectId: projectIds[0], actingPrincipalId: params.actingPrincipalId, query: params.query, limit: params.limit, rerank: params.rerank, filters: params.filters, snippetMaxChars: params.snippetMaxChars });
    }
  }
  if (projectIds.length === 0) {
    return { matches: [], explanations: ['no project_ids provided'] };
  }

  const limit = Math.min(Math.max(params.limit ?? 10, 1), 50);
  const lessonType = params.filters?.lesson_type;
  const tagsAny = (params.filters?.tags_any ?? []).filter(Boolean);
  const includeAll = Boolean(params.filters?.include_all_statuses);

  const queryTokens = params.query.match(/[A-Za-z_][A-Za-z0-9_]{1,}/g) ?? [];
  const ftsQuery = buildFtsQuery(queryTokens, 'or');

  // DEFERRED-025: degrade to FTS-only when embeddings are unavailable.
  let vector: string | null = null;
  try {
    const [vec] = await embedTexts([params.query]);
    vector = `[${vec.join(',')}]`;
  } catch (err) {
    logger.warn(
      { err: err instanceof Error ? err.message : String(err) },
      'searchLessonsMulti: embeddings unavailable — falling back to FTS-only ranking (DEFERRED-025)',
    );
  }
  if (vector === null && !ftsQuery) {
    return { matches: [], explanations: ['embeddings unavailable and no FTS tokens in query — empty result'] };
  }

  // $1 = text[] of project IDs; $2 = vector (only when semantic is available)
  const sqlParams: any[] = [projectIds];
  let semParam: string | null = null;
  if (vector !== null) {
    sqlParams.push(vector);
    semParam = `$${sqlParams.length}`;
  }
  const whereParts: string[] = ['l.project_id = ANY($1::text[])'];

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

  // Dynamic retrieval pool sizing across all projects.
  let totalLessons = 0;
  try {
    const countRes = await pool.query(
      `SELECT count(*)::int AS n FROM lessons WHERE project_id = ANY($1::text[])`,
      [projectIds],
    );
    totalLessons = Number(countRes.rows?.[0]?.n ?? 0);
  } catch { /* best-effort */ }

  const rerankBudget =
    totalLessons < 50 ? 0 :
    totalLessons < 200 ? 15 :
    totalLessons < 500 ? 25 :
    30;

  const fetchLimit = Math.max(limit, rerankBudget > 0 ? rerankBudget * 2 : limit * 3);
  sqlParams.push(Math.min(fetchLimit, 60));
  const limitParam = `$${sqlParams.length}`;

  let ftsScoreExpr = '0';
  let ftsJoin = '';
  let ftsParam: string | null = null;
  if (ftsQuery) {
    sqlParams.push(ftsQuery);
    ftsParam = `$${sqlParams.length}`;
    ftsJoin = `LEFT JOIN LATERAL (
      SELECT ts_rank(l.fts, to_tsquery('english', ${ftsParam})) AS fts_rank
      WHERE l.fts IS NOT NULL AND l.fts @@ to_tsquery('english', ${ftsParam})
    ) fts_sub ON true`;
    ftsScoreExpr = 'COALESCE(fts_sub.fts_rank, 0)';
  }

  // DEFERRED-025: FTS-only fallback requires an actual FTS match.
  if (vector === null && ftsParam) {
    whereParts.push(`l.fts @@ to_tsquery('english', ${ftsParam})`);
  }

  const semScoreExpr = semParam
    ? `GREATEST(0, 1 - (l.embedding <=> ${semParam}::vector))`
    : '0';

  const whereClause = whereParts.join(' AND ');

  const res = await pool.query(
    `SELECT
      l.lesson_id,
      l.project_id,
      l.lesson_type,
      l.title,
      l.content,
      l.summary,
      l.tags,
      l.status,
      ${semScoreExpr} AS sem_score,
      ${ftsScoreExpr} AS fts_score,
      LEAST(1.0, ${semScoreExpr} + 0.40 * ${ftsScoreExpr}) AS score
     FROM lessons l
     ${ftsJoin}
     WHERE ${whereClause}
     ORDER BY score DESC, sem_score DESC
     LIMIT ${limitParam};`,
    sqlParams,
  );

  const explanations: string[] = [`multi_project: ${projectIds.length} projects searched`];
  if (ftsQuery) {
    const ftsHits = (res.rows ?? []).filter((r: any) => Number(r.fts_score) > 0).length;
    explanations.push(`hybrid: sem + 0.40*fts, fts_hits=${ftsHits}/${(res.rows ?? []).length}`);
  }

  // Sprint 12.1d: retain relevance signal (max sem/fts) for query-conditional
  // salience blend. See searchLessons for the MED-2 rationale.
  const relevanceSignalByLessonId = new Map<string, number>();
  let matches: SearchLessonsResult['matches'] = (res.rows ?? []).map((r: any) => {
    const sum = r.summary != null ? String(r.summary).trim() : '';
    const snippetSource = sum.length ? sum : String(r.content);
    const lessonId = String(r.lesson_id);
    const semScore = Number(r.sem_score);
    const ftsScore = Number(r.fts_score);
    const relevance = Math.max(
      Number.isFinite(semScore) ? semScore : 0,
      Number.isFinite(ftsScore) ? ftsScore : 0,
    );
    relevanceSignalByLessonId.set(lessonId, relevance);
    return {
      lesson_id: lessonId,
      project_id: String(r.project_id),
      lesson_type: String(r.lesson_type) as LessonType,
      title: String(r.title),
      content_snippet: makeSnippet(snippetSource, params.snippetMaxChars ?? 280),
      tags: (r.tags ?? []) as string[],
      score: Number(r.score),
      status: String(r.status ?? 'active') as LessonStatus,
    };
  });

  // Sprint 12.1c + 12.1d — salience blend (multi-project, query-conditional).
  // - MED-1 (12.1c review): batched via computeSalienceMultiProject (single
  //   SQL query for all projectIds).
  // - 12.1d: max(sem_score, fts_score) factor prevents popularity feedback
  //   loop without cancelling legitimate FTS-only matches.
  if (!isSalienceDisabled() && matches.length > 0) {
    try {
      const salienceConfig = getSalienceConfig();
      const candidateIds = matches.map((m) => m.lesson_id);
      const salienceMap = await computeSalienceMultiProject(
        pool,
        projectIds,
        candidateIds,
        salienceConfig,
      );
      if (salienceMap.size > 0 && salienceConfig.alpha > 0) {
        const { effectiveBoosts } = applyQueryConditionalSalienceBlend(
          matches,
          salienceMap,
          relevanceSignalByLessonId,
          salienceConfig.alpha,
        );
        explanations.push(
          `salience: enabled multi-project query-conditional (α=${salienceConfig.alpha}, halfLife=${salienceConfig.halfLifeDays}d); ${salienceMap.size}/${matches.length} with access history, ${effectiveBoosts} effective after relevance-gating`,
        );
      } else {
        explanations.push(
          salienceConfig.alpha === 0
            ? 'salience: α=0, no boost applied (logging still active)'
            : `salience: no access history (multi-project, ${matches.length} lessons)`,
        );
      }
    } catch (err) {
      explanations.push(
        `salience: skipped due to error (${err instanceof Error ? err.message : String(err)})`,
      );
    }
  } else if (isSalienceDisabled()) {
    explanations.push('salience: disabled via LESSONS_SALIENCE_DISABLED');
  }

  // Rerank pass (same logic as single-project). DEFERRED-030: rerank=false bypass.
  const env = getEnv();
  if (params.rerank === false) {
    explanations.push('rerank: skipped (rerank=false on request)');
  } else if (shouldRunRerank({
    rerankParam: params.rerank,
    rerankBudget,
    matchesLength: matches.length,
    rerankConfigured: rerankConfigured(),
  })) {
    try {
      const rerankCount = Math.min(matches.length, rerankBudget);
      const rerankCandidateList = matches.slice(0, rerankCount).map((m, i) => ({
        index: i,
        title: m.title,
        snippet: m.content_snippet,
      }));
      const rerankedOrder = await rerankCandidates({ query: params.query, candidates: rerankCandidateList });
      const rerankedTop = rerankedOrder.map(i => matches[i]).filter(Boolean);
      const remaining = matches.slice(rerankCandidateList.length);
      const delta = rerankCount - rerankedTop.length;
      matches = [...rerankedTop, ...remaining];
      const note = delta > 0
        ? (env.RERANK_MIN_SCORE > 0
            ? `, dropped=${delta} (min_score=${env.RERANK_MIN_SCORE})`
            : `, partial_rerank=${rerankedTop.length}/${rerankCount}`)
        : '';
      explanations.push(`reranked: top ${rerankedTop.length}/${rerankCount} candidates (budget=${rerankBudget}, total_lessons=${totalLessons}${note})`);
    } catch (err) {
      explanations.push(`rerank skipped: ${err instanceof Error ? err.message : String(err)}`);
    }
  }

  // Sprint 12.1a — near-semantic dedup (same treatment as single-project).
  if (!isDedupDisabled()) {
    const before = matches.length;
    matches = dedupLessonMatches(matches);
    const dropped = before - matches.length;
    if (dropped > 0) {
      explanations.push(`dedup: collapsed ${dropped} near-semantic duplicate${dropped === 1 ? '' : 's'} (${before}→${matches.length})`);
    }
  }

  matches = matches.slice(0, limit);

  // Sprint 12.1c — consideration-search logging for multi-project path too.
  if (!isSalienceDisabled() && matches.length > 0) {
    const entries: AccessLogEntry[] = matches.map((m, i) => ({
      lesson_id: m.lesson_id,
      project_id: m.project_id ?? projectIds[0] ?? 'unknown',
      context: 'consideration-search',
      weight: 1.0 / (i + 1),
      metadata: { query: params.query, rank: i + 1, multi_project: true },
    }));
    void logLessonAccess(pool, entries);
  }

  return { matches, explanations };
}

// DEFERRED-027: validate uuid inputs at the service boundary so a malformed id
// (e.g. the literal "undefined" interpolated into a URL) returns BAD_REQUEST (400)
// instead of leaking a raw Postgres "invalid input syntax for type uuid" 500.
// Single source of truth for REST + MCP + import callers.
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
function assertUuid(value: string | null | undefined, field: string): void {
  if (value === null || value === undefined) return; // optional fields handled by callers
  if (!UUID_RE.test(value)) {
    throw new ContextHubError('BAD_REQUEST', `${field} must be a valid UUID; got: ${String(value)}`);
  }
}

export async function updateLesson(params: {
  projectId: string;
  /** Actor Data Boundary F2f — acting principal; authorize() is the tenant/authz gate. */
  actingPrincipalId?: string | null;
  lessonId: string;
  title?: string;
  content?: string;
  tags?: string[];
  source_refs?: string[];
  changedBy?: string;
  changeSummary?: string;
}): Promise<{ status: 'ok' | 'error'; error?: string; re_embedded?: boolean; version_number?: number }> {
  const pool = getDbPool();

  // F2f: mutating a lesson ⇒ write over its project.
  await assertAuthorized(params.actingPrincipalId, 'write', { kind: 'project', id: params.projectId });
  // DEFERRED-027: reject malformed ids before they reach the uuid-typed query.
  assertUuid(params.lessonId, 'lessonId');

  const existing = await pool.query(
    `SELECT lesson_id, title, content, lesson_type, tags, source_refs FROM lessons WHERE project_id=$1 AND lesson_id=$2`,
    [params.projectId, params.lessonId],
  );
  if (!existing.rowCount) {
    return { status: 'error', error: 'lesson not found for project' };
  }

  const row = existing.rows[0];
  const newTitle = params.title ?? row.title;
  const newContent = params.content ?? row.content;
  const newTags = params.tags ?? row.tags;
  const newSourceRefs = params.source_refs ?? row.source_refs;

  const contentChanged = newTitle !== row.title || newContent !== row.content;
  let reEmbedded = false;

  // Save version snapshot before overwriting (only for content/title changes)
  if (contentChanged) {
    const versionRes = await pool.query(
      `SELECT COALESCE(MAX(version_number), 0) AS max_ver FROM lesson_versions WHERE lesson_id = $1`,
      [params.lessonId],
    );
    const nextVersion = (versionRes.rows[0]?.max_ver ?? 0) + 1;
    await pool.query(
      `INSERT INTO lesson_versions (lesson_id, version_number, title, content, tags, changed_by, change_summary)
       VALUES ($1, $2, $3, $4, $5, $6, $7)`,
      [params.lessonId, nextVersion, row.title, row.content, row.tags, params.changedBy ?? null, params.changeSummary ?? null],
    );
  }

  if (contentChanged) {
    const searchAliases = await generateSearchAliases(newTitle, newContent);
    const embeddingText = searchAliases
      ? `${newTitle}. ${searchAliases}. ${newContent}`
      : `${newTitle}. ${newContent}`;
    const [embedding] = await embedTexts([embeddingText]);
    const embeddingLiteral = `[${embedding.join(',')}]`;

    const ftsSource = searchAliases
      ? `${newTitle} ${searchAliases} ${newContent}`
      : `${newTitle} ${newContent}`;
    const ftsContent = expandForFtsIndex(ftsSource);

    await pool.query(
      `UPDATE lessons
       SET title=$3, content=$4, tags=$5, source_refs=$6,
           embedding=$7::vector, fts=to_tsvector('english', $8), search_aliases=$9,
           updated_at=now()
       WHERE project_id=$1 AND lesson_id=$2`,
      [params.projectId, params.lessonId, newTitle, newContent, newTags, newSourceRefs,
       embeddingLiteral, ftsContent, searchAliases || null],
    );

    await upsertLessonNode({
      projectId: params.projectId,
      lessonId: params.lessonId,
      title: newTitle,
      lessonType: row.lesson_type,
    }).catch(() => {});

    await linkLessonToSymbols({
      projectId: params.projectId,
      lessonId: params.lessonId,
      lessonType: row.lesson_type,
      sourceRefs: newSourceRefs,
    }).catch(() => {});

    reEmbedded = true;
  } else {
    await pool.query(
      `UPDATE lessons
       SET tags=$3, source_refs=$4, updated_at=now()
       WHERE project_id=$1 AND lesson_id=$2`,
      [params.projectId, params.lessonId, newTags, newSourceRefs],
    );
  }

  await rebuildProjectSnapshot(params.projectId).catch(() => {});

  // Get current version count for response
  const verCount = contentChanged
    ? await pool.query(`SELECT MAX(version_number) AS ver FROM lesson_versions WHERE lesson_id = $1`, [params.lessonId])
    : null;
  const versionNumber = verCount?.rows[0]?.ver ?? undefined;

  return { status: 'ok', re_embedded: reEmbedded, version_number: versionNumber };
}

export async function listLessonVersions(params: {
  projectId: string;
  /** Actor Data Boundary F2f — acting principal; authorize() is the tenant/authz gate. */
  actingPrincipalId?: string | null;
  lessonId: string;
}): Promise<{ status: 'ok' | 'error'; error?: string; versions?: any[]; total_count?: number }> {
  const pool = getDbPool();
  // F2f: reading version history ⇒ read over its project.
  await assertAuthorized(params.actingPrincipalId, 'read', { kind: 'project', id: params.projectId });

  const existing = await pool.query(
    `SELECT lesson_id FROM lessons WHERE project_id=$1 AND lesson_id=$2`,
    [params.projectId, params.lessonId],
  );
  if (!existing.rowCount) {
    return { status: 'error', error: 'lesson not found for project' };
  }

  const result = await pool.query(
    `SELECT version_number, title, content, tags, changed_by, changed_at, change_summary
     FROM lesson_versions
     WHERE lesson_id = $1
     ORDER BY version_number DESC`,
    [params.lessonId],
  );

  return {
    status: 'ok',
    versions: result.rows,
    total_count: result.rowCount ?? 0,
  };
}

export async function batchUpdateLessonStatus(params: {
  projectId: string;
  /** Actor Data Boundary F2f — acting principal; authorize() is the tenant/authz gate. */
  actingPrincipalId?: string | null;
  lessonIds: string[];
  status: LessonStatus;
}): Promise<{ status: 'ok' | 'error'; error?: string; updated_count?: number; failed_ids?: string[] }> {
  // F2f: batch status mutation ⇒ write over its project.
  await assertAuthorized(params.actingPrincipalId, 'write', { kind: 'project', id: params.projectId });
  if (!params.lessonIds.length) {
    return { status: 'error', error: 'lesson_ids is empty' };
  }
  if (params.lessonIds.length > 50) {
    return { status: 'error', error: 'max 50 lessons per batch' };
  }
  // Phase 13 review-impl finding: the pending-review gate that updateLessonStatus
  // enforces applies to this sibling write-path too. Reject batching INTO
  // pending-review, and never batch a lesson OUT of pending-review (the
  // `status <> 'pending-review'` predicate leaves those rows untouched — they
  // surface in failed_ids). A lesson leaves pending-review only via the
  // review-request approve/return flow.
  if (params.status === 'pending-review') {
    return {
      status: 'error',
      error: "Cannot batch-transition to 'pending-review'. Use submit_for_review to create a review request.",
    };
  }

  const pool = getDbPool();

  const result = await pool.query(
    `UPDATE lessons SET status = $3, updated_at = now()
     WHERE project_id = $1 AND lesson_id = ANY($2::uuid[])
       AND status <> 'pending-review'
     RETURNING lesson_id`,
    [params.projectId, params.lessonIds, params.status],
  );

  const updatedIds = new Set((result.rows as { lesson_id: string }[]).map(r => r.lesson_id));
  const failedIds = params.lessonIds.filter(id => !updatedIds.has(id));

  await rebuildProjectSnapshot(params.projectId).catch(() => {});

  return {
    status: 'ok',
    updated_count: updatedIds.size,
    failed_ids: failedIds.length > 0 ? failedIds : undefined,
  };
}

export async function updateLessonStatus(params: {
  projectId: string;
  lessonId: string;
  status: LessonStatus;
  supersededBy?: string | null;
  /** Actor Data Boundary F2f — acting principal; authorize() is the tenant/authz gate. */
  actingPrincipalId?: string | null;
}): Promise<{ status: 'ok' | 'error'; error?: string }> {
  const pool = getDbPool();

  // F2f: status transition ⇒ write over its project.
  await assertAuthorized(params.actingPrincipalId, 'write', { kind: 'project', id: params.projectId });
  // DEFERRED-027: reject malformed ids before they reach the uuid-typed query.
  assertUuid(params.lessonId, 'lessonId');
  assertUuid(params.supersededBy, 'superseded_by');

  // Phase 13 Sprint 13.7 r3 F1 fix: read current status as part of the existence check
  // so we can enforce the master design L275-281 ✗ transition table at the service
  // layer (single source of truth for REST + MCP + import).
  const existing = await pool.query<{ status: string }>(
    `SELECT status FROM lessons WHERE project_id=$1 AND lesson_id=$2`,
    [params.projectId, params.lessonId],
  );
  if (!existing.rowCount) {
    return { status: 'error', error: 'lesson not found for project' };
  }
  const currentStatus = existing.rows[0].status;
  const targetStatus = params.status;

  // ── Phase 13 status-transition guard (master design L275-281; review BUG-13.3-2 / 13.7-1) ──
  // 'pending-review' is a managed state: it is ENTERED only via submit_for_review
  // and LEFT only via the review-request approve/return flow (resolveRequest runs
  // its own guarded UPDATE and does NOT call updateLessonStatus). update_lesson_status
  // must therefore reject 'pending-review' on BOTH sides:
  //   (a) any → pending-review   ✗  use submit_for_review
  //   (b) pending-review → any   ✗  use the review-request approve/return flow
  // The 13.7 r3-F1 fix only blocked (b) for superseded/archived targets, leaving
  // pending-review → active/draft open — which bypassed review and orphaned the
  // review_requests row (BUG-13.7-1). This is the single source of truth for the
  // REST + MCP + import callers.
  if (targetStatus === 'pending-review') {
    return {
      status: 'error',
      error: `Cannot transition '${currentStatus}' → 'pending-review' via update_lesson_status. Use submit_for_review to create a review request.`,
    };
  }
  if (currentStatus === 'pending-review') {
    return {
      status: 'error',
      error: `Cannot transition 'pending-review' → '${targetStatus}' via update_lesson_status. A lesson under review leaves 'pending-review' only through the review-request approve/return flow.`,
    };
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

export async function deleteWorkspace(
  projectId: string,
  /** Actor Data Boundary F2f — acting principal; destructive ⇒ requires admin over the project. */
  opts?: { actingPrincipalId?: string | null },
) {
  await assertAuthorized(opts?.actingPrincipalId, 'admin', { kind: 'project', id: projectId });
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
