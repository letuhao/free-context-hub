import { getDbPool } from '../db/client.js';

export interface GlobalSearchResults {
  query: string;
  lessons: { lesson_id: string; title: string; lesson_type: string; status: string; snippet: string }[];
  documents: { doc_id: string; name: string; doc_type: string; snippet: string }[];
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
    return { query: q, lessons: [], documents: [], guardrails: [], commits: [], total_count: 0 };
  }

  const limit = Math.min(params.limitPerGroup ?? 5, 10);
  const pattern = `%${q}%`;

  // Run all queries in parallel for speed.
  const [lessonsRes, guardrailsRes, docsRes, commitsRes] = await Promise.all([
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
    ).catch(() => ({ rows: [] })), // git_commits may not exist for all projects
  ]);

  const lessons = lessonsRes.rows;
  const guardrails = guardrailsRes.rows;
  const documents = docsRes.rows;
  const commits = commitsRes.rows;
  const total_count = lessons.length + guardrails.length + documents.length + commits.length;

  return { query: q, lessons, documents, guardrails, commits, total_count };
}
