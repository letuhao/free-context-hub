import { getDbPool } from '../db/client.js';
import { embedTexts } from './embedder.js';
import { globToSqlLike } from '../utils/globToLike.js';
import { searchSymbols } from '../kg/query.js';

export type SearchCodeParams = {
  projectId: string;
  query: string;
  pathGlob?: string;
  includeTests?: boolean;
  lexicalBoost?: boolean;
  kgAssist?: boolean;
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

function extractLexicalTokens(query: string): string[] {
  // Prefer identifier-like tokens and quoted phrases; drop very short/common tokens.
  const raw = query
    .replace(/[`"'“”‘’]/g, ' ')
    .split(/[^A-Za-z0-9_./:-]+/g)
    .map(s => s.trim())
    .filter(Boolean);
  const tokens = raw.filter(t => /[A-Za-z]/.test(t) && t.length >= 4);
  return Array.from(new Set(tokens)).slice(0, 12);
}

function lexicalScore(tokens: string[], haystack: string): number {
  if (!tokens.length) return 0;
  const s = haystack.toLowerCase();
  let hits = 0;
  for (const t of tokens) {
    if (s.includes(t.toLowerCase())) hits += 1;
  }
  return hits / tokens.length; // 0..1
}

export async function searchCode({
  projectId,
  query,
  pathGlob,
  includeTests,
  lexicalBoost,
  kgAssist,
  limit,
  debug,
}: SearchCodeParams): Promise<SearchCodeResult> {
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

  const pg = (pathGlob ?? '').trim();
  const wantsTests = Boolean(includeTests) || /(^|\/)\*\*\/\*\.test\.ts$/.test(pg) || /\.test\.ts/.test(pg) || /__tests__/.test(pg);
  if (!wantsTests) {
    where += ` AND c.file_path NOT LIKE '%.test.ts' AND c.file_path NOT LIKE '%/__tests__/%'`;
  }

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

  const tokens = lexicalBoost === false ? [] : extractLexicalTokens(query);
  const kgFiles = new Set<string>();
  if (kgAssist) {
    try {
      // Heuristic: KG symbol search works best with identifier-like tokens, not full natural language queries.
      // Try the full query first, then fall back to token probes.
      const probes = [query.trim(), ...tokens].filter(Boolean).slice(0, 8);
      for (const p of probes) {
        const sym = await searchSymbols({ projectId, query: p, limit: 10 });
        for (const m of sym.matches ?? []) {
          if (m.file_path) kgFiles.add(String(m.file_path));
        }
        // Stop early if we already have a decent candidate set.
        if (kgFiles.size >= 12) break;
      }
    } catch {
      // best-effort
    }
  }

  const matches: SearchCodeResult['matches'] = (res.rows ?? []).map((r: any) => {
    const filePath = String(r.file_path);
    const content = String(r.content);
    const snippet = makeSnippet(content, maxChars);
    const sem = Number(r.score);
    const lex = tokens.length ? lexicalScore(tokens, `${filePath}\n${content}`) : 0;
    const kg = kgFiles.size && kgFiles.has(filePath) ? 0.15 : 0;
    const boosted = Math.min(1, sem + 0.25 * lex + kg);
    return {
      path: filePath,
      start_line: Number(r.start_line),
      end_line: Number(r.end_line),
      snippet,
      score: boosted,
      match_type: 'semantic',
    };
  });

  // Re-rank after boosting.
  matches.sort((a, b) => b.score - a.score);

  const explanations: string[] = [];
  if (debug) {
    explanations.push(`vector_query_dim=${vec.length}`);
    if (pathGlob) explanations.push(`pathGlob=${pathGlob}`);
    explanations.push(`includeTests=${Boolean(includeTests)}`);
    explanations.push(`lexicalBoost=${lexicalBoost !== false}`);
    explanations.push(`kgAssist=${Boolean(kgAssist)} kgFiles=${kgFiles.size}`);
  }

  return { matches, explanations };
}

