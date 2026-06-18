/**
 * Hybrid semantic + FTS search over document_chunks.
 *
 * Mirrors the lesson search pattern (pgvector cosine + FTS keyword boost),
 * but returns chunks with their parent document name/page/heading so
 * callers (chat, global search, MCP agents) can cite and link back.
 *
 * No reranker here — chunks are retrieved wide and the caller decides
 * how to present them. Reranking happens at the chat/assistant layer
 * if at all, since chunks are already coarse enough.
 */

import { getDbPool } from '../db/client.js';
import { getEnv } from '../env.js';
import { embedTexts } from './embedder.js';
import { buildFtsQuery } from '../utils/ftsTokenizer.js';
import { createModuleLogger } from '../utils/logger.js';
import { nearSemanticKey } from '../utils/nearSemanticKey.js';
import { assertCallerScope, assertCallerScopeMulti } from '../core/security/callerScope.js';
import type { CallerScope } from '../core/security/callerScope.js';
// DEFERRED-034: reuse the shared (lesson-agnostic) rerank dispatcher so the
// chunks surface reranks like lessons/code. No cycle — lessons does not import
// this module.
import { rerankCandidates, rerankConfigured } from './lessons.js';

const logger = createModuleLogger('document-chunks-search');

/** DEFERRED-034 server-side kill-switch + A/B knob (mirrors CHUNKS_DEDUP_DISABLED). */
function isChunksRerankDisabled(): boolean {
  return process.env.CHUNKS_RERANK_DISABLED === 'true';
}

/** Candidate pool fetched before reranking down to `limit`. Wider = more room
 *  for the reranker to promote a buried-relevant chunk. */
function chunksRerankPool(): number {
  const raw = Number(process.env.CHUNKS_RERANK_POOL);
  return Number.isFinite(raw) && raw > 0 ? Math.floor(raw) : 30;
}

/**
 * DEFERRED-034 — apply a rerank dispatcher's index order to the candidate pool.
 *
 * `order` is a list of indices into `pool` (as returned by `rerankCandidates`).
 * Indices the dispatcher omits were evicted by `RERANK_MIN_SCORE` (off-topic) —
 * those chunks are dropped, which is the precision (cp) lever. Out-of-range and
 * duplicate indices are ignored defensively. On rerank failure the dispatcher
 * returns the identity order, so this returns the pool unchanged.
 *
 * Pure function — no I/O. Caller trims the result to `limit`.
 */
export function reorderByRerank<T>(pool: ReadonlyArray<T>, order: ReadonlyArray<number>): T[] {
  const seen = new Set<number>();
  const out: T[] = [];
  for (const i of order) {
    if (Number.isInteger(i) && i >= 0 && i < pool.length && !seen.has(i)) {
      seen.add(i);
      out.push(pool[i]!);
    }
  }
  return out;
}

export type ChunkTypeFilter = 'text' | 'table' | 'code' | 'diagram_description' | 'mermaid';

export interface SearchChunksParams {
  projectId: string;
  /** DEFERRED-029: caller's scope; enforced against projectId. */
  callerScope?: CallerScope;
  query: string;
  limit?: number;
  /** Restrict to specific chunk types (empty/undefined = all). */
  chunkTypes?: ChunkTypeFilter[];
  /** Restrict to specific documents. */
  docIds?: string[];
  /** Minimum semantic score (0..1) — filter out weak matches. */
  minScore?: number;
  /** DEFERRED-034: when explicitly `false`, skip the server-side rerank and
   *  return raw hybrid-retrieval order (used by the A/B harness for an
   *  uncontaminated pool). Default true (rerank when configured). */
  rerank?: boolean;
}

export interface ChunkMatch {
  chunk_id: string;
  doc_id: string;
  project_id: string;
  chunk_index: number;
  content_snippet: string;
  page_number: number | null;
  heading: string | null;
  chunk_type: string;
  extraction_mode: string | null;
  /** Parent document name (for display + citation). */
  doc_name: string;
  doc_type: string;
  /** Hybrid score in [0, 1]. */
  score: number;
  sem_score: number;
  fts_score: number;
}

export interface SearchChunksResult {
  matches: ChunkMatch[];
  explanations: string[];
}

function snippet(content: string, maxChars = 240): string {
  const trimmed = content.replace(/\s+/g, ' ').trim();
  if (trimmed.length <= maxChars) return trimmed;
  return trimmed.slice(0, maxChars - 1).trimEnd() + '…';
}

/**
 * Sprint 12.1b — near-semantic dedup for chunk search results.
 *
 * Collapses matches that share a `(project_id, chunk_type,
 * nearSemanticKey(doc_name+heading, content_snippet))` tuple into a
 * single representative (first-seen, respecting the hybrid semantic+FTS
 * rank). Pure function — no I/O.
 *
 * Motivating pathology (Sprint 12.0.1 baseline): `chunks dup@10 nearsem
 * = 0.29`. Primary driver is the three `sample.pdf` failed-extraction
 * chunks (same doc_name, null heading, identical `[extraction failed:
 * Vision model returned HTTP 400: ...]` content prefix) collapsing to
 * one nearSemanticKey — retrieving all three wastes top-k slots. Plus
 * smaller within-document clustering across sample.docx headings.
 *
 * Key composition mirrors Sprint 12.1a's lessons dedup (MED-1+2 lesson):
 *   - `project_id` preserves cross-project "same content" variants
 *     (e.g. a shared guardrail document replicated via include_groups).
 *   - `chunk_type` keeps table/text/code/mermaid/diagram distinct even
 *     when content overlaps — a table with numeric columns and a text
 *     paragraph quoting those numbers are different data.
 *   - `nearSemanticKey(doc_name + '/' + heading, content_snippet)` is
 *     the same key shape the baseline `dup@10 nearsem` metric measures
 *     with, so dedup drives the metric to 0 by construction.
 *
 * Opt-out: `CHUNKS_DEDUP_DISABLED=true` in the server environment
 * restores legacy behavior. Intended for A/B measurement and emergency
 * rollback, not a permanent toggle.
 */
/**
 * ORDERING CONTRACT (Sprint 12.1b /review-impl LOW-3):
 * Caller is responsible for sorting matches by desired retention priority
 * BEFORE invocation. Dedup preserves first-seen order; it does NOT re-score
 * or re-sort. `searchChunks`/`searchChunksMulti` both pass DB rows in
 * `ORDER BY score DESC` order, so the first-seen representative is the
 * highest-score cluster member. A future caller that passes matches in a
 * different order will get a correspondingly-different representative.
 *
 * KEY CONSTRUCTION NOTES (LOW-1 + LOW-2):
 *  - The `doc_name + ' / ' + heading` title is NOT injective: if either
 *    field literally contains ' / ', two different (doc_name, heading)
 *    pairs could produce the same title. Filesystem-unlikely (POSIX
 *    disallows `/` in filenames) but possible via the editable
 *    `documents.name` field. Acceptable risk for current data.
 *  - `nearSemanticKey` takes `content_snippet.slice(0, 100)` internally,
 *    and `searchChunks` already truncates content to 240 chars via
 *    `snippet()`. So the effective dedup window is the first ~100 chars
 *    of chunk content. Two chunks sharing a 100-char boilerplate prefix
 *    but differing meaningfully in chars 101–240 will collapse. Not an
 *    active issue for the current dataset; revisit if a real collision
 *    surfaces.
 */
export function dedupChunkMatches<T extends {
  project_id: string;
  chunk_type: string;
  doc_name: string;
  heading: string | null;
  content_snippet: string;
}>(matches: ReadonlyArray<T>): T[] {
  const seen = new Set<string>();
  const out: T[] = [];
  for (const m of matches) {
    const title = m.heading ? `${m.doc_name} / ${m.heading}` : m.doc_name;
    const key = `${m.project_id}|${m.chunk_type}|${nearSemanticKey(title, m.content_snippet)}`;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(m);
  }
  return out;
}

/** Env-driven opt-out for chunks dedup. Read lazily so tests can toggle it. */
function isChunksDedupDisabled(): boolean {
  return process.env.CHUNKS_DEDUP_DISABLED === 'true';
}

export async function searchChunks(params: SearchChunksParams): Promise<SearchChunksResult> {
  assertCallerScope(params.callerScope, params.projectId);
  const pool = getDbPool();
  // Hard-cap at 100 — chunks are shorter than lessons so a wider pool is
  // fine, and the GUI's "Load more" button walks up to this ceiling.
  const limit = Math.min(Math.max(params.limit ?? 10, 1), 100);
  const minScore = params.minScore ?? 0;

  // DEFERRED-034: rerank when configured and not opted out. When active, fetch a
  // WIDER candidate pool (so the reranker has room to promote a buried-relevant
  // chunk into the top `limit`), then rerank down to `limit` below.
  const rerankActive =
    params.rerank !== false && rerankConfigured() && !isChunksRerankDisabled();
  const fetchSize = rerankActive ? Math.min(Math.max(limit, chunksRerankPool()), 100) : limit;

  // Tokenize for FTS
  const queryTokens = params.query.match(/[A-Za-z_][A-Za-z0-9_]{1,}/g) ?? [];
  const ftsQuery = buildFtsQuery(queryTokens, 'or');

  // Embed query — if the embedding service is unavailable, degrade to
  // FTS-only ranking instead of 500'ing the whole request. Chunks still
  // return relevance-ordered results, just without semantic boost.
  let vector: string | null = null;
  let embedFailure: string | null = null;
  try {
    const [vec] = await embedTexts([params.query]);
    vector = `[${vec.join(',')}]`;
  } catch (err) {
    embedFailure = err instanceof Error ? err.message : String(err);
    logger.warn({ err: embedFailure }, 'chunk search: embedding failed, falling back to FTS-only');
    if (!ftsQuery) {
      // No embedding AND no keyword tokens → nothing to search on
      return {
        matches: [],
        explanations: [
          `embedding service unavailable (${embedFailure}) and no keyword tokens — cannot search`,
        ],
      };
    }
  }

  // Build param list: $1=project_id, [$2=vector if semantic], ...
  const sqlParams: any[] = [params.projectId];
  const whereParts: string[] = ['c.project_id = $1'];
  // Defense-in-depth: also enforce doc row is in same tenant (MED #8).
  // The FK makes this already true, but explicit filter protects against
  // any future schema drift.
  whereParts.push('d.project_id = c.project_id');

  let vectorParam = '';
  if (vector !== null) {
    sqlParams.push(vector);
    vectorParam = `$${sqlParams.length}`;
    whereParts.push('c.embedding IS NOT NULL');
  }

  if (params.chunkTypes && params.chunkTypes.length > 0) {
    sqlParams.push(params.chunkTypes);
    whereParts.push(`c.chunk_type = ANY($${sqlParams.length}::text[])`);
  }

  if (params.docIds && params.docIds.length > 0) {
    sqlParams.push(params.docIds);
    whereParts.push(`c.doc_id = ANY($${sqlParams.length}::uuid[])`);
  }

  sqlParams.push(fetchSize);
  const limitParam = `$${sqlParams.length}`;

  // Hybrid score: semantic + 0.30 * fts. If embedding failed, score is
  // FTS-only and we still return ordered results.
  let ftsScoreExpr = '0';
  let ftsJoin = '';
  if (ftsQuery) {
    sqlParams.push(ftsQuery);
    const ftsParam = `$${sqlParams.length}`;
    ftsJoin = `LEFT JOIN LATERAL (
      SELECT ts_rank(c.fts, to_tsquery('english', ${ftsParam})) AS fts_rank
      WHERE c.fts IS NOT NULL AND c.fts @@ to_tsquery('english', ${ftsParam})
    ) fts_sub ON true`;
    ftsScoreExpr = 'COALESCE(fts_sub.fts_rank, 0)';
    // If we're FTS-only, require at least one FTS hit so we don't return junk
    if (vector === null) {
      whereParts.push(`c.fts @@ to_tsquery('english', ${ftsParam})`);
    }
  }

  const whereClause = whereParts.join(' AND ');

  const semScoreExpr = vectorParam
    ? `GREATEST(0, 1 - (c.embedding <=> ${vectorParam}::vector))`
    : '0';
  const hybridScoreExpr = vectorParam
    ? `LEAST(1.0, ${semScoreExpr} + 0.30 * ${ftsScoreExpr})`
    : ftsScoreExpr;

  const sql = `
    SELECT
      c.chunk_id,
      c.doc_id,
      c.project_id,
      c.chunk_index,
      c.content,
      c.page_number,
      c.heading,
      c.chunk_type,
      c.extraction_mode,
      d.name AS doc_name,
      d.doc_type AS doc_type,
      ${semScoreExpr} AS sem_score,
      ${ftsScoreExpr} AS fts_score,
      ${hybridScoreExpr} AS score
    FROM document_chunks c
    JOIN documents d ON d.doc_id = c.doc_id
    ${ftsJoin}
    WHERE ${whereClause}
    ORDER BY score DESC${vectorParam ? `, sem_score DESC` : ''}
    LIMIT ${limitParam}`;

  const res = await pool.query(sql, sqlParams);

  const explanations: string[] = [];
  if (embedFailure) {
    explanations.push(`embedding service unavailable (${embedFailure}) — results ranked by FTS only`);
  } else if (ftsQuery) {
    const ftsHits = (res.rows ?? []).filter((r: any) => Number(r.fts_score) > 0).length;
    explanations.push(`hybrid: sem + 0.30*fts, fts_hits=${ftsHits}/${(res.rows ?? []).length}`);
  } else {
    explanations.push('semantic only (no keyword tokens)');
  }

  let matches: ChunkMatch[] = (res.rows ?? [])
    .map((r: any) => ({
      chunk_id: String(r.chunk_id),
      doc_id: String(r.doc_id),
      project_id: String(r.project_id),
      chunk_index: Number(r.chunk_index),
      content_snippet: snippet(String(r.content)),
      page_number: r.page_number !== null ? Number(r.page_number) : null,
      heading: r.heading ?? null,
      chunk_type: String(r.chunk_type),
      extraction_mode: r.extraction_mode ?? null,
      doc_name: String(r.doc_name),
      doc_type: String(r.doc_type),
      sem_score: Number(r.sem_score),
      fts_score: Number(r.fts_score),
      score: Number(r.score),
    }))
    .filter((m) => m.score >= minScore);

  // DEFERRED-034 — rerank the wide candidate pool, then trim to `limit`. Mirrors
  // the lessons/code surfaces (chunks was the only surface without rerank).
  // Reorders so a buried-relevant chunk is promoted into the top `limit`, and
  // drops candidates the dispatcher evicted via RERANK_MIN_SCORE (precision
  // lever). On rerank failure the dispatcher returns identity order → no-op.
  if (rerankActive && matches.length > 1) {
    try {
      const order = await rerankCandidates({
        query: params.query,
        candidates: matches.map((m, i) => ({
          index: i,
          title: m.heading ? `${m.doc_name} / ${m.heading}` : m.doc_name,
          snippet: m.content_snippet,
        })),
      });
      const before = matches.length;
      matches = reorderByRerank(matches, order);
      const dropped = before - matches.length;
      const env = getEnv();
      explanations.push(
        dropped > 0
          ? `reranked: ${matches.length}/${before} (dropped ${dropped} via min_score=${env.RERANK_MIN_SCORE})`
          : `reranked: ${matches.length} candidates (pool=${fetchSize})`,
      );
    } catch (err) {
      explanations.push(
        `rerank skipped: ${err instanceof Error ? err.message : String(err)}`,
      );
    }
  } else if (params.rerank === false) {
    explanations.push('rerank: skipped (rerank=false on request)');
  } else if (!rerankActive) {
    explanations.push(
      isChunksRerankDisabled()
        ? 'rerank: disabled via CHUNKS_RERANK_DISABLED'
        : 'rerank: not configured (RERANK_TYPE unset)',
    );
  }

  // Sprint 12.1b — near-semantic dedup. Collapses same-(project, chunk_type,
  // doc_name+heading, snippet) clusters. Opt-out via CHUNKS_DEDUP_DISABLED=true.
  // Always emit an explanation so operators can distinguish "dedup ON with no
  // collapses" from "dedup OFF" (mirrors lessons LOW-3 from 12.1a).
  if (isChunksDedupDisabled()) {
    explanations.push('dedup: disabled via CHUNKS_DEDUP_DISABLED');
  } else {
    const before = matches.length;
    matches = dedupChunkMatches(matches);
    const dropped = before - matches.length;
    explanations.push(
      dropped > 0
        ? `dedup: enabled, collapsed ${dropped} near-semantic duplicate${dropped === 1 ? '' : 's'} (${before}→${matches.length})`
        : `dedup: enabled, 0 collapsed (all ${before} chunks already distinct)`,
    );
  }

  // DEFERRED-034: trim the reranked + deduped pool down to the requested page
  // size. Dedup runs on the full pool first so unique chunks beyond `limit`
  // can fill slots vacated by collapsed near-duplicates. No-op when rerank is
  // inactive (fetchSize === limit).
  if (matches.length > limit) matches = matches.slice(0, limit);

  logger.info(
    { project: params.projectId, matches: matches.length, min_score: minScore },
    'chunk search complete',
  );

  return { matches, explanations };
}

/** Multi-project variant (mirrors searchLessonsMulti). */
export async function searchChunksMulti(params: {
  projectIds: string[];
  /** DEFERRED-029: caller's scope; strict-reject if request reaches outside it. */
  callerScope?: CallerScope;
  query: string;
  limit?: number;
  chunkTypes?: ChunkTypeFilter[];
}): Promise<SearchChunksResult> {
  const projectIds = [...new Set(params.projectIds.filter(Boolean))];
  if (projectIds.length === 0) return { matches: [], explanations: ['no project_ids provided'] };
  assertCallerScopeMulti(params.callerScope, projectIds);
  if (projectIds.length === 1) {
    return searchChunks({
      projectId: projectIds[0],
      callerScope: params.callerScope,
      query: params.query,
      limit: params.limit,
      chunkTypes: params.chunkTypes,
    });
  }

  const pool = getDbPool();
  const limit = Math.min(Math.max(params.limit ?? 10, 1), 50);
  const queryTokens = params.query.match(/[A-Za-z_][A-Za-z0-9_]{1,}/g) ?? [];
  const ftsQuery = buildFtsQuery(queryTokens, 'or');
  const [vec] = await embedTexts([params.query]);
  const vector = `[${vec.join(',')}]`;

  const sqlParams: any[] = [projectIds, vector];
  const whereParts: string[] = ['c.project_id = ANY($1::text[])', 'c.embedding IS NOT NULL'];

  if (params.chunkTypes && params.chunkTypes.length > 0) {
    sqlParams.push(params.chunkTypes);
    whereParts.push(`c.chunk_type = ANY($${sqlParams.length}::text[])`);
  }
  sqlParams.push(limit);
  const limitParam = `$${sqlParams.length}`;

  let ftsScoreExpr = '0';
  let ftsJoin = '';
  if (ftsQuery) {
    sqlParams.push(ftsQuery);
    const ftsParam = `$${sqlParams.length}`;
    ftsJoin = `LEFT JOIN LATERAL (
      SELECT ts_rank(c.fts, to_tsquery('english', ${ftsParam})) AS fts_rank
      WHERE c.fts IS NOT NULL AND c.fts @@ to_tsquery('english', ${ftsParam})
    ) fts_sub ON true`;
    ftsScoreExpr = 'COALESCE(fts_sub.fts_rank, 0)';
  }

  const res = await pool.query(
    `SELECT c.chunk_id, c.doc_id, c.project_id, c.chunk_index, c.content,
            c.page_number, c.heading, c.chunk_type, c.extraction_mode,
            d.name AS doc_name, d.doc_type AS doc_type,
            GREATEST(0, 1 - (c.embedding <=> $2::vector)) AS sem_score,
            ${ftsScoreExpr} AS fts_score,
            LEAST(1.0, GREATEST(0, 1 - (c.embedding <=> $2::vector)) + 0.30 * ${ftsScoreExpr}) AS score
     FROM document_chunks c
     JOIN documents d ON d.doc_id = c.doc_id
     ${ftsJoin}
     WHERE ${whereParts.join(' AND ')}
     ORDER BY score DESC, sem_score DESC
     LIMIT ${limitParam}`,
    sqlParams,
  );

  let matches: ChunkMatch[] = (res.rows ?? []).map((r: any) => ({
    chunk_id: String(r.chunk_id),
    doc_id: String(r.doc_id),
    project_id: String(r.project_id),
    chunk_index: Number(r.chunk_index),
    content_snippet: snippet(String(r.content)),
    page_number: r.page_number !== null ? Number(r.page_number) : null,
    heading: r.heading ?? null,
    chunk_type: String(r.chunk_type),
    extraction_mode: r.extraction_mode ?? null,
    doc_name: String(r.doc_name),
    doc_type: String(r.doc_type),
    sem_score: Number(r.sem_score),
    fts_score: Number(r.fts_score),
    score: Number(r.score),
  }));

  // Sprint 12.1b — same dedup treatment as single-project.
  const explanations: string[] = [`multi-project: ${projectIds.length} projects, ${matches.length} matches`];
  if (isChunksDedupDisabled()) {
    explanations.push('dedup: disabled via CHUNKS_DEDUP_DISABLED');
  } else {
    const before = matches.length;
    matches = dedupChunkMatches(matches);
    const dropped = before - matches.length;
    explanations.push(
      dropped > 0
        ? `dedup: enabled, collapsed ${dropped} near-semantic duplicate${dropped === 1 ? '' : 's'} (${before}→${matches.length})`
        : `dedup: enabled, 0 collapsed (all ${before} chunks already distinct)`,
    );
  }

  return { matches, explanations };
}
