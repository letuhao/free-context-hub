import { randomUUID } from 'node:crypto';
import { getEnv } from '../env.js';
import { getDbPool } from '../db/client.js';
import { linkLessonToSymbols, upsertLessonNode } from '../kg/linker.js';
import { deleteProjectGraph } from '../kg/projectGraph.js';
import { embedTexts } from './embedder.js';
import { distillLesson } from './distiller.js';
import { rebuildProjectSnapshot } from './snapshot.js';
import { expandForFtsIndex, buildFtsQuery } from '../utils/ftsTokenizer.js';
import * as z from 'zod/v4';
import { createModuleLogger } from '../utils/logger.js';

const logger = createModuleLogger('lessons');

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

// ─── Lesson Reranker (generative + cross-encoder) ─────────────────────

const RerankOrderSchema = z.object({
  order: z.array(z.number().int().nonnegative()),
});

type RerankCandidate = { index: number; title: string; snippet: string };

function rerankBaseUrl(): string {
  const env = getEnv();
  return (env.RERANK_BASE_URL?.trim() || env.DISTILLATION_BASE_URL?.trim() || env.EMBEDDINGS_BASE_URL).replace(/\/$/, '');
}

function rerankHeaders(): Record<string, string> {
  const env = getEnv();
  const headers: Record<string, string> = { 'Content-Type': 'application/json' };
  const key = env.RERANK_API_KEY ?? env.DISTILLATION_API_KEY ?? env.EMBEDDINGS_API_KEY;
  if (key) headers.Authorization = `Bearer ${key}`;
  return headers;
}

/**
 * Generative reranker: sends all candidates to a chat model, gets JSON order back.
 * Works with: qwen3-reranker-4b, zerank-2, any chat/instruct model.
 */
async function rerankGenerative(query: string, candidates: RerankCandidate[]): Promise<number[]> {
  const env = getEnv();
  const model = env.RERANK_MODEL ?? env.DISTILLATION_MODEL;
  if (!model) return candidates.map(c => c.index);

  const url = `${rerankBaseUrl()}/v1/chat/completions`;
  const ac = new AbortController();
  const timeoutMs = (env.RERANK_TIMEOUT_MS ?? 10000) + 5000;
  const t = setTimeout(() => ac.abort(), timeoutMs);

  try {
    const system =
      'You are a ranking model. Re-rank the lesson candidates by how directly they answer the query. ' +
      'Output ONLY valid JSON: {"order":[...]} where order is an array of candidate indices (0-based), best match first. ' +
      'No extra keys, no markdown.';
    const user =
      `QUERY:\n${query}\n\nCANDIDATES:\n` +
      candidates.map((c, i) => `#${i} TITLE: ${c.title}\nSNIPPET: ${c.snippet}`).join('\n\n') +
      '\n\nReturn JSON.';

    const res = await fetch(url, {
      method: 'POST', headers: rerankHeaders(), signal: ac.signal,
      body: JSON.stringify({ model, messages: [{ role: 'system', content: system }, { role: 'user', content: user }], temperature: 0.0, max_tokens: env.RERANK_LLM_MAX_TOKENS }),
    });

    if (!res.ok) { logger.warn({ status: res.status }, 'generative rerank: HTTP error'); return candidates.map(c => c.index); }

    const json = (await res.json()) as any;
    const content = json?.choices?.[0]?.message?.content;
    if (typeof content !== 'string' || !content.trim()) return candidates.map(c => c.index);

    const raw = content.trim();
    const first = raw.indexOf('{');
    const last = raw.lastIndexOf('}');
    if (first < 0 || last <= first) return candidates.map(c => c.index);

    const parsed = JSON.parse(raw.slice(first, last + 1));
    const validated = RerankOrderSchema.safeParse(parsed);
    if (!validated.success) return candidates.map(c => c.index);

    const n = candidates.length;
    const seen = new Set<number>();
    const cleaned: number[] = [];
    for (const idx of validated.data.order) {
      if (idx >= 0 && idx < n && !seen.has(idx)) { seen.add(idx); cleaned.push(idx); }
    }
    for (let i = 0; i < n; i++) if (!seen.has(i)) cleaned.push(i);

    logger.info({ query: query.slice(0, 60), candidates: n, top3: cleaned.slice(0, 3), mode: 'generative' }, 'lesson rerank: done');
    return cleaned;
  } catch (err) {
    logger.warn({ error: err instanceof Error ? err.message : String(err) }, 'generative rerank: failed');
    return candidates.map(c => c.index);
  } finally { clearTimeout(t); }
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

/** Dispatch to the correct reranker based on RERANK_TYPE. */
async function rerankLessons(params: {
  query: string;
  candidates: RerankCandidate[];
}): Promise<number[]> {
  const env = getEnv();
  const model = env.RERANK_MODEL ?? env.DISTILLATION_MODEL;
  if (!model) return params.candidates.map(c => c.index);

  // For generative mode, DISTILLATION_ENABLED must be true (needs chat API).
  // For cross-encoder mode, only needs embedding API — no distillation required.
  if (env.RERANK_TYPE === 'cross-encoder') {
    return rerankCrossEncoder(params.query, params.candidates);
  }

  if (!env.DISTILLATION_ENABLED) return params.candidates.map(c => c.index);
  return rerankGenerative(params.query, params.candidates);
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
  const rerankBudget =
    totalLessons < 20 ? 0 :
    totalLessons < 50 ? 10 :
    totalLessons < 200 ? 20 :
    totalLessons < 500 ? 30 :
    30;

  // Fetch 2x rerank budget to ensure correct answer is in the pool.
  const fetchLimit = Math.max(limit, rerankBudget > 0 ? rerankBudget * 2 : limit * 3);
  sqlParams.push(Math.min(fetchLimit, 60)); // hard cap at 60
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

  // Build initial matches from DB results.
  let matches: SearchLessonsResult['matches'] = (res.rows ?? []).map((r: any) => {
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

  // LLM rerank: re-order top candidates for better ranking.
  // Dynamic budget: skip for small sets, scale up for large lesson bases.
  const env = getEnv();
  if (rerankBudget > 0 && matches.length >= 2 && (env.RERANK_MODEL || env.DISTILLATION_MODEL) && env.DISTILLATION_ENABLED) {
    try {
      const rerankCount = Math.min(matches.length, rerankBudget);
      const rerankCandidates = matches.slice(0, rerankCount).map((m, i) => ({
        index: i,
        title: m.title,
        snippet: m.content_snippet,
      }));

      const rerankedOrder = await rerankLessons({ query: params.query, candidates: rerankCandidates });

      // Apply reranked order to matches.
      const rerankedTop = rerankedOrder.map(i => matches[i]).filter(Boolean);
      const remaining = matches.slice(rerankCandidates.length);
      matches = [...rerankedTop, ...remaining];

      explanations.push(`reranked: top ${rerankCandidates.length}/${matches.length} candidates (budget=${rerankBudget}, total_lessons=${totalLessons})`);
    } catch (err) {
      explanations.push(`rerank skipped: ${err instanceof Error ? err.message : String(err)}`);
    }
  }

  // Trim to the originally requested limit after reranking.
  matches = matches.slice(0, limit);

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
