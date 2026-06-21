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
import { assertAuthorized } from './authorize.js';
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

/** Phase 17.4 — fusion method for the hybrid sem+fts candidate pool. Default
 *  'weighted' (the `sem + 0.30*fts` sum the SQL computes). Set `CHUNKS_FUSION=rrf`
 *  to re-rank the pool by Reciprocal Rank Fusion instead (A/B knob). */
function chunksFusionMode(): 'weighted' | 'rrf' {
  return process.env.CHUNKS_FUSION === 'rrf' ? 'rrf' : 'weighted';
}

/**
 * Phase 17.4 — Reciprocal Rank Fusion. Re-rank a candidate pool by RRF rather
 * than the weighted-sum hybrid score. Each candidate scores
 *   Σ_list 1 / (k + rank_in_list)
 * over the lists it appears in: the sem list (candidates with `sem_score>0`,
 * ranked by sem_score desc) and the fts list (`fts_score>0`, ranked by fts_score
 * desc). Rank-based fusion is robust when sem/fts magnitudes aren't comparable
 * (the weighted sum can let a high-magnitude sem score swamp an exact keyword
 * hit). Returns indices into `items`, best-first; ties keep input order. Pure.
 *
 * NOTE: the pool is already top-N by weighted-sum (the SQL ORDER BY), so this
 * measures rank- vs score-fusion *ordering* on a shared candidate set, not a
 * from-scratch two-list fusion. Sufficient for the A/B; documented as such.
 */
export function rrfFuse(
  items: ReadonlyArray<{ sem_score: number; fts_score: number }>,
  k = 60,
): number[] {
  const rankIn = (key: 'sem_score' | 'fts_score'): Map<number, number> => {
    const idx = items.map((_, i) => i).filter((i) => items[i]![key] > 0);
    idx.sort((a, b) => items[b]![key] - items[a]![key] || a - b);
    const m = new Map<number, number>();
    idx.forEach((i, r) => m.set(i, r + 1)); // 1-based rank
    return m;
  };
  const semRank = rankIn('sem_score');
  const ftsRank = rankIn('fts_score');
  const rrf = (i: number): number =>
    (semRank.has(i) ? 1 / (k + semRank.get(i)!) : 0) +
    (ftsRank.has(i) ? 1 / (k + ftsRank.get(i)!) : 0);
  return items.map((_, i) => i).sort((a, b) => rrf(b) - rrf(a) || a - b);
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

/** DEFERRED-034 — is reranking active for a chunk search? Pure (env + request
 *  flag). Both single- and multi-project search call this BEFORE the SQL to size
 *  the candidate pool (`fetchSize`). */
export function chunkRerankActive(rerankRequested: boolean | undefined): boolean {
  return rerankRequested !== false && rerankConfigured() && !isChunksRerankDisabled();
}

/**
 * DEFERRED-034 — shared post-retrieval pipeline for BOTH single- and
 * multi-project chunk search: rerank the wide candidate pool → near-semantic
 * dedup → trim to `limit`, pushing identical `explanations`. Extracted so
 * `searchChunksMulti` has the same rerank+dedup as `searchChunks` (parity) and
 * neither can drift from the other. Mutates/returns `matches`.
 */
async function postProcessChunkMatches(opts: {
  query: string;
  matches: ChunkMatch[];
  /** chunk_id → wide (1000-char) text window the reranker scores on. */
  rerankTextByChunk: Map<string, string>;
  rerankActive: boolean;
  /** The caller's `rerank` request flag, for the right "skipped" explanation. */
  rerankRequested: boolean | undefined;
  fetchSize: number;
  limit: number;
  explanations: string[];
}): Promise<ChunkMatch[]> {
  let matches = opts.matches;
  const { explanations } = opts;

  // --- rerank (promote buried-relevant; drop junk via RERANK_MIN_SCORE) ---
  if (opts.rerankActive && matches.length > 1) {
    try {
      const order = await rerankCandidates({
        query: opts.query,
        candidates: matches.map((m, i) => ({
          index: i,
          title: m.heading ? `${m.doc_name} / ${m.heading}` : m.doc_name,
          snippet: opts.rerankTextByChunk.get(m.chunk_id) ?? m.content_snippet,
        })),
      });
      const before = matches.length;
      matches = reorderByRerank(matches, order);
      const dropped = before - matches.length;
      const env = getEnv();
      explanations.push(
        dropped > 0
          ? `reranked: ${matches.length}/${before} (dropped ${dropped} via min_score=${env.RERANK_MIN_SCORE})`
          : `reranked: ${matches.length} candidates (pool=${opts.fetchSize})`,
      );
    } catch (err) {
      explanations.push(`rerank skipped: ${err instanceof Error ? err.message : String(err)}`);
    }
  } else if (opts.rerankActive) {
    explanations.push(`rerank: skipped (${matches.length} candidate${matches.length === 1 ? '' : 's'})`);
  } else if (opts.rerankRequested === false) {
    explanations.push('rerank: skipped (rerank=false on request)');
  } else {
    explanations.push(
      isChunksRerankDisabled()
        ? 'rerank: disabled via CHUNKS_RERANK_DISABLED'
        : 'rerank: not configured (RERANK_TYPE unset)',
    );
  }

  // --- near-semantic dedup ---
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

  // --- trim reranked+deduped pool to the requested page size ---
  if (matches.length > opts.limit) matches = matches.slice(0, opts.limit);
  return matches;
}

export type ChunkTypeFilter = 'text' | 'table' | 'code' | 'diagram_description' | 'mermaid';

export interface SearchChunksParams {
  projectId: string;
  /** F2f — acting principal; authorize() gate (project scope). */
  actingPrincipalId?: string | null;
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
  /** DEFERRED-037: width of `content_snippet` in chars. Default 240 (a display
   *  preview for the GUI). The gen-eval / RAG path must pass a wide value (e.g.
   *  2000) so the SYNTHESIZER + JUDGE receive the full chunk, not a preview that
   *  truncates the grounding fact away (a chunk whose relevant passage sits past
   *  char 240 otherwise reads as "Not in context"). Backward-compatible default. */
  snippetMaxChars?: number;
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
  await assertAuthorized(params.actingPrincipalId, 'read', { kind: 'project', id: params.projectId });
  const pool = getDbPool();
  // Hard-cap at 100 — chunks are shorter than lessons so a wider pool is
  // fine, and the GUI's "Load more" button walks up to this ceiling.
  const limit = Math.min(Math.max(params.limit ?? 10, 1), 100);
  const minScore = params.minScore ?? 0;

  // DEFERRED-034: rerank when configured and not opted out. When active, fetch a
  // WIDER candidate pool (so the reranker has room to promote a buried-relevant
  // chunk into the top `limit`), then rerank down to `limit` below.
  const rerankActive = chunkRerankActive(params.rerank);
  // Phase 17.4: RRF re-ranks the wide pool too, so fetch wide when EITHER rerank
  // or RRF fusion is active (else RRF would only reorder the top-`limit`).
  const fusionRrf = chunksFusionMode() === 'rrf';
  const fetchSize =
    rerankActive || fusionRrf ? Math.min(Math.max(limit, chunksRerankPool()), 100) : limit;

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

  // DEFERRED-034 /review-impl MED-2: the reranker must score on the SAME text
  // window the judge/synthesizer see (buildJudgeContexts JUDGE_SNIPPET_MAX_CHARS
  // = 1000), not the 240-char display snippet — otherwise a chunk whose relevant
  // passage sits past char 240 gets mis-ranked. Capture the wide window here
  // (full `content` is dropped when we build the ChunkMatch below).
  const RERANK_SNIPPET_MAX_CHARS = 1000;
  const rerankTextByChunk = new Map<string, string>();

  let matches: ChunkMatch[] = (res.rows ?? [])
    .map((r: any) => {
      const chunkId = String(r.chunk_id);
      rerankTextByChunk.set(chunkId, String(r.content ?? '').slice(0, RERANK_SNIPPET_MAX_CHARS));
      return {
        chunk_id: chunkId,
        doc_id: String(r.doc_id),
        project_id: String(r.project_id),
        chunk_index: Number(r.chunk_index),
        content_snippet: snippet(String(r.content), params.snippetMaxChars ?? 240),
        page_number: r.page_number !== null ? Number(r.page_number) : null,
        heading: r.heading ?? null,
        chunk_type: String(r.chunk_type),
        extraction_mode: r.extraction_mode ?? null,
        doc_name: String(r.doc_name),
        doc_type: String(r.doc_type),
        sem_score: Number(r.sem_score),
        fts_score: Number(r.fts_score),
        score: Number(r.score),
      };
    })
    .filter((m) => m.score >= minScore);

  // Phase 17.4: when CHUNKS_FUSION=rrf, re-rank the pool by Reciprocal Rank Fusion
  // (rank-based) instead of the weighted-sum order the SQL produced. Runs BEFORE
  // rerank/dedup/trim so the downstream pipeline sees the RRF order.
  if (fusionRrf && matches.length > 1) {
    const order = rrfFuse(matches.map((m) => ({ sem_score: m.sem_score, fts_score: m.fts_score })));
    matches = order.map((i) => matches[i]!);
    explanations.push(`fusion: RRF (k=60) reordered ${matches.length} candidates`);
  }

  // DEFERRED-034 — rerank the wide candidate pool → near-semantic dedup → trim
  // to `limit`, via the shared post-retrieval pipeline (same one
  // searchChunksMulti uses, so the two can't drift).
  matches = await postProcessChunkMatches({
    query: params.query,
    matches,
    rerankTextByChunk,
    rerankActive,
    rerankRequested: params.rerank,
    fetchSize,
    limit,
    explanations,
  });

  logger.info(
    { project: params.projectId, matches: matches.length, min_score: minScore },
    'chunk search complete',
  );

  return { matches, explanations };
}

/** Multi-project variant (mirrors searchLessonsMulti). */
export async function searchChunksMulti(params: {
  projectIds: string[];
  /** F2f — acting principal; authorize() gate (per-project read). */
  actingPrincipalId?: string | null;
  query: string;
  limit?: number;
  chunkTypes?: ChunkTypeFilter[];
  /** DEFERRED-034: rerank parity with single-project. Default true (mirrors
   *  searchChunks); false = explicit bypass. */
  rerank?: boolean;
}): Promise<SearchChunksResult> {
  const projectIds = [...new Set(params.projectIds.filter(Boolean))];
  if (projectIds.length === 0) return { matches: [], explanations: ['no project_ids provided'] };
  for (const id of projectIds) {
    await assertAuthorized(params.actingPrincipalId, 'read', { kind: 'project', id });
  }
  if (projectIds.length === 1) {
    return searchChunks({
      projectId: projectIds[0],
      actingPrincipalId: params.actingPrincipalId,
      query: params.query,
      limit: params.limit,
      chunkTypes: params.chunkTypes,
      rerank: params.rerank,
    });
  }

  const pool = getDbPool();
  const limit = Math.min(Math.max(params.limit ?? 10, 1), 50);
  // DEFERRED-034: widen the candidate pool when reranking so the reranker has
  // room to promote a buried-relevant chunk into the top `limit`.
  const rerankActive = chunkRerankActive(params.rerank);
  const fetchSize = rerankActive ? Math.min(Math.max(limit, chunksRerankPool()), 50) : limit;
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
  sqlParams.push(fetchSize);
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

  // DEFERRED-034 /review-impl MED-2 parity: the reranker scores on the SAME wide
  // window the judge/synthesizer see (1000 chars), not the 240-char display
  // snippet. Capture it before `content` is dropped from ChunkMatch.
  const RERANK_SNIPPET_MAX_CHARS = 1000;
  const rerankTextByChunk = new Map<string, string>();

  let matches: ChunkMatch[] = (res.rows ?? []).map((r: any) => {
    const chunkId = String(r.chunk_id);
    rerankTextByChunk.set(chunkId, String(r.content ?? '').slice(0, RERANK_SNIPPET_MAX_CHARS));
    return {
      chunk_id: chunkId,
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
    };
  });

  // DEFERRED-034: same rerank → dedup → trim pipeline as single-project, via the
  // shared helper (parity; can't drift).
  const explanations: string[] = [`multi-project: ${projectIds.length} projects, ${matches.length} matches`];
  matches = await postProcessChunkMatches({
    query: params.query,
    matches,
    rerankTextByChunk,
    rerankActive,
    rerankRequested: params.rerank,
    fetchSize,
    limit,
    explanations,
  });

  return { matches, explanations };
}
