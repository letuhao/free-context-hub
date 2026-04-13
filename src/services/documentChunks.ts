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
import { embedTexts } from './embedder.js';
import { buildFtsQuery } from '../utils/ftsTokenizer.js';
import { createModuleLogger } from '../utils/logger.js';

const logger = createModuleLogger('document-chunks-search');

export type ChunkTypeFilter = 'text' | 'table' | 'code' | 'diagram_description' | 'mermaid';

export interface SearchChunksParams {
  projectId: string;
  query: string;
  limit?: number;
  /** Restrict to specific chunk types (empty/undefined = all). */
  chunkTypes?: ChunkTypeFilter[];
  /** Restrict to specific documents. */
  docIds?: string[];
  /** Minimum semantic score (0..1) — filter out weak matches. */
  minScore?: number;
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

export async function searchChunks(params: SearchChunksParams): Promise<SearchChunksResult> {
  const pool = getDbPool();
  // Hard-cap at 100 — chunks are shorter than lessons so a wider pool is
  // fine, and the GUI's "Load more" button walks up to this ceiling.
  const limit = Math.min(Math.max(params.limit ?? 10, 1), 100);
  const minScore = params.minScore ?? 0;

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

  sqlParams.push(limit);
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

  const matches: ChunkMatch[] = (res.rows ?? [])
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

  logger.info(
    { project: params.projectId, matches: matches.length, min_score: minScore },
    'chunk search complete',
  );

  return { matches, explanations };
}

/** Multi-project variant (mirrors searchLessonsMulti). */
export async function searchChunksMulti(params: {
  projectIds: string[];
  query: string;
  limit?: number;
  chunkTypes?: ChunkTypeFilter[];
}): Promise<SearchChunksResult> {
  const projectIds = [...new Set(params.projectIds.filter(Boolean))];
  if (projectIds.length === 0) return { matches: [], explanations: ['no project_ids provided'] };
  if (projectIds.length === 1) {
    return searchChunks({
      projectId: projectIds[0],
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

  const matches: ChunkMatch[] = (res.rows ?? []).map((r: any) => ({
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

  return {
    matches,
    explanations: [`multi-project: ${projectIds.length} projects, ${matches.length} matches`],
  };
}
