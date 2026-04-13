import { getDbPool } from '../db/client.js';
import { createModuleLogger } from '../utils/logger.js';

const logger = createModuleLogger('global-search');

export interface GlobalSearchResults {
  query: string;
  lessons: { lesson_id: string; title: string; lesson_type: string; status: string; snippet: string }[];
  documents: { doc_id: string; name: string; doc_type: string; snippet: string }[];
  chunks: {
    chunk_id: string;
    doc_id: string;
    doc_name: string;
    chunk_type: string;
    page_number: number | null;
    heading: string | null;
    snippet: string;
  }[];
  guardrails: { lesson_id: string; title: string; status: string }[];
  commits: { sha: string; message: string; author: string; date: string }[];
  total_count: number;
}

/**
 * Fast cross-entity text search for the Cmd+K command palette.
 * Uses ILIKE for broad matching — no embeddings, fast response.
 */
export async function globalSearch(params: {
  projectId: string;
  query: string;
  limitPerGroup?: number;
}): Promise<GlobalSearchResults> {
  const pool = getDbPool();
  const q = params.query.trim();
  if (!q) {
    return { query: q, lessons: [], documents: [], chunks: [], guardrails: [], commits: [], total_count: 0 };
  }

  const limit = Math.min(params.limitPerGroup ?? 5, 10);
  const pattern = `%${q}%`;

  // Run all queries in parallel for speed.
  const [lessonsRes, guardrailsRes, docsRes, commitsRes, chunksRes] = await Promise.all([
    // Lessons (non-guardrail)
    pool.query(
      `SELECT lesson_id, title, lesson_type, status,
              LEFT(content, 120) AS snippet
       FROM lessons
       WHERE project_id = $1
         AND lesson_type != 'guardrail'
         AND (title ILIKE $2 OR content ILIKE $2)
       ORDER BY updated_at DESC
       LIMIT $3`,
      [params.projectId, pattern, limit],
    ),
    // Guardrails (separate group)
    pool.query(
      `SELECT lesson_id, title, status
       FROM lessons
       WHERE project_id = $1
         AND lesson_type = 'guardrail'
         AND (title ILIKE $2 OR content ILIKE $2)
       ORDER BY updated_at DESC
       LIMIT $3`,
      [params.projectId, pattern, limit],
    ),
    // Documents
    pool.query(
      `SELECT doc_id, name, doc_type,
              LEFT(content, 120) AS snippet
       FROM documents
       WHERE project_id = $1
         AND (name ILIKE $2 OR content ILIKE $2 OR description ILIKE $2)
       ORDER BY updated_at DESC
       LIMIT $3`,
      [params.projectId, pattern, limit],
    ),
    // Commits
    pool.query(
      `SELECT sha, message, author, committed_at AS date
       FROM git_commits
       WHERE project_id = $1
         AND (message ILIKE $2 OR sha ILIKE $2)
       ORDER BY committed_at DESC
       LIMIT $3`,
      [params.projectId, pattern, limit],
    ).catch((err) => {
      logger.warn({ error: err instanceof Error ? err.message : String(err) }, 'git_commits query failed (table may not exist)');
      return { rows: [] };
    }),
    // Document chunks — FTS-only for speed (Cmd+K must stay snappy).
    // Semantic chunk search is available via POST /api/documents/chunks/search
    // for higher-quality retrieval from the dedicated panel / chat / MCP.
    pool.query(
      `SELECT c.chunk_id, c.doc_id, c.chunk_type, c.page_number, c.heading,
              LEFT(c.content, 160) AS snippet,
              d.name AS doc_name
       FROM document_chunks c
       JOIN documents d ON d.doc_id = c.doc_id
       WHERE c.project_id = $1 AND c.content ILIKE $2
       ORDER BY c.chunk_index ASC
       LIMIT $3`,
      [params.projectId, pattern, limit],
    ).catch((err) => {
      logger.warn({ error: err instanceof Error ? err.message : String(err) }, 'document_chunks query failed');
      return { rows: [] };
    }),
  ]);

  const lessons = lessonsRes.rows;
  const guardrails = guardrailsRes.rows;
  const documents = docsRes.rows;
  const commits = commitsRes.rows;
  const chunks = chunksRes.rows;
  const total_count =
    lessons.length + guardrails.length + documents.length + commits.length + chunks.length;

  return { query: q, lessons, documents, chunks, guardrails, commits, total_count };
}
