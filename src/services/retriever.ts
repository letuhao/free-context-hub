import { getDbPool } from '../db/client.js';
import { embedTexts } from './embedder.js';
import { globToSqlLike } from '../utils/globToLike.js';

export type SearchCodeParams = {
  projectId: string;
  query: string;
  pathGlob?: string;
  limit?: number;
  debug?: boolean;
};

export type SearchCodeResult = {
  matches: Array<{
    path: string;
    start_line: number;
    end_line: number;
    snippet: string;
    score: number;
    match_type: 'semantic';
  }>;
  explanations: string[];
};

function makeSnippet(content: string, maxChars: number) {
  const normalized = content.trim().replace(/\s+/g, ' ');
  if (normalized.length <= maxChars) return normalized;
  return normalized.slice(0, maxChars - 1) + '…';
}

export async function searchCode({ projectId, query, pathGlob, limit, debug }: SearchCodeParams): Promise<SearchCodeResult> {
  const pool = getDbPool();
  const vec = (await embedTexts([query]))[0];
  if (!vec) {
    return { matches: [], explanations: [] };
  }

  const vector = `[${vec.join(',')}]`;
  const topK = limit ?? 10;
  const maxChars = 400;

  const params: any[] = [projectId, vector];
  let where = `c.project_id = $1`;

  if (pathGlob && pathGlob.trim().length) {
    // The DB stores POSIX-like relative paths.
    const like = globToSqlLike(pathGlob);
    params.push(like);
    where += ` AND c.file_path LIKE $${params.length}`;
  }

  const limitParamIndex = pathGlob && pathGlob.trim().length ? 4 : 3;
  params.push(topK); // becomes $3 (no pathGlob) OR $4 (with pathGlob)

  const sql = `
    SELECT
      c.file_path,
      c.start_line,
      c.end_line,
      c.content,
      GREATEST(0, 1 - (c.embedding <=> $2::vector)) AS score
    FROM chunks c
    WHERE ${where}
    ORDER BY c.embedding <=> $2::vector
    LIMIT $${limitParamIndex};
  `;
  const res = await pool.query(sql, params);

  const matches: SearchCodeResult['matches'] = (res.rows ?? []).map((r: any) => ({
    path: String(r.file_path),
    start_line: Number(r.start_line),
    end_line: Number(r.end_line),
    snippet: makeSnippet(String(r.content), maxChars),
    score: Number(r.score),
    match_type: 'semantic',
  }));

  const explanations: string[] = [];
  if (debug) {
    explanations.push(`vector_query_dim=${vec.length}`);
    if (pathGlob) explanations.push(`pathGlob=${pathGlob}`);
  }

  return { matches, explanations };
}

