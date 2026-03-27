import { getDbPool } from '../db/client.js';
import { embedTexts } from './embedder.js';
import { globToSqlLike } from '../utils/globToLike.js';
import { searchSymbols } from '../kg/query.js';
import { getEnv } from '../env.js';
import * as z from 'zod/v4';
import { getProjectCacheVersion } from './cacheVersions.js';
import { redisGetJson, redisKey, redisSetJson } from './redisCache.js';

export type SearchCodeParams = {
  projectId: string;
  query: string;
  pathGlob?: string;
  includeTests?: boolean;
  includeSmoke?: boolean;
  preferPaths?: string[];
  rerankMode?: 'off' | 'llm';
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
  // Goal: surface entrypoints/config by extracting identifier-ish tokens, routes, and quoted phrases.
  const q = query.trim();

  const tokens: string[] = [];

  // Quoted phrases (keep as-is; useful for exact config keys like "workspace_token").
  for (const m of q.matchAll(/"([^"]+)"|'([^']+)'|`([^`]+)`/g)) {
    const phrase = (m[1] ?? m[2] ?? m[3] ?? '').trim();
    if (phrase.length >= 3) tokens.push(phrase);
  }

  // Identifier-ish / path-ish tokens.
  const raw = q
    .replace(/[`"'“”‘’]/g, ' ')
    .split(/[^A-Za-z0-9_./:-]+/g)
    .map(s => s.trim())
    .filter(Boolean);

  for (const r of raw) {
    const t = r.replace(/^\/+/, '').replace(/[:.,;!?]+$/g, '');
    if (!t) continue;
    // Keep obvious identifiers and route-ish pieces.
    if (/[A-Za-z]/.test(t) && (t.length >= 4 || /[_./-]/.test(t))) tokens.push(t);
    // Add de-punctuated variants for things like "/mcp" -> "mcp".
    if (t !== r && t.length >= 3) tokens.push(t);
    if (t.includes('/')) {
      for (const part of t.split('/').filter(Boolean)) {
        if (/[A-Za-z]/.test(part) && part.length >= 3) tokens.push(part);
      }
    }
  }

  // Intent-specific probes to help entrypoints like src/index.ts bubble up.
  const lower = q.toLowerCase();
  if (/(endpoint|route|router|mcp)/.test(lower)) {
    tokens.push('registerTool', 'createMcp', 'express', '/mcp', 'index.ts');
  }
  if (/(workspace_token|auth|unauthorized|token)/.test(lower)) {
    tokens.push('assertWorkspaceToken', 'workspace_token', 'MCP_AUTH_ENABLED');
  }
  if (/(embeddings|vector|pgvector)/.test(lower)) {
    tokens.push('embed', 'embedTexts', 'EMBEDDINGS', 'pgvector');
  }

  // Normalize + de-dupe.
  const normalized = tokens
    .map(s => s.trim())
    .filter(Boolean)
    .filter(s => /[A-Za-z]/.test(s))
    .filter(s => s.length >= 3);

  return Array.from(new Set(normalized)).slice(0, 18);
}

function globToRegExp(glob: string): RegExp {
  // Very small glob subset: **, *, ?, and path separators.
  // Stored file paths are POSIX-like.
  const s = glob.trim().replace(/\\/g, '/');
  const escaped = s.replace(/[.+^${}()|[\]\\]/g, '\\$&');
  const withTokens = escaped
    .replace(/\\\*\\\*/g, '§§DOUBLESTAR§§')
    .replace(/\\\*/g, '[^/]*')
    .replace(/\\\?/g, '[^/]');
  const finalRe = withTokens.replace(/§§DOUBLESTAR§§/g, '.*');
  return new RegExp(`^${finalRe}$`, 'i');
}

function pathPriorBoost(filePath: string, preferPaths: string[]): { boost: number; hits: string[] } {
  if (!preferPaths.length) return { boost: 0, hits: [] };
  const hits: string[] = [];
  for (const p of preferPaths) {
    try {
      if (globToRegExp(p).test(filePath)) hits.push(p);
    } catch {
      // ignore invalid globs
    }
  }
  // Cap the contribution to keep scores stable.
  const boost = Math.min(0.2, hits.length * 0.1);
  return { boost, hits };
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

const RerankOrderSchema = z.object({
  order: z.array(z.number().int().nonnegative()),
});

type RerankCacheEntry = { expiresAt: number; order: number[] };
const rerankCache = new Map<string, RerankCacheEntry>();

function chatBaseUrl(): string {
  const env = getEnv();
  return (env.RERANK_BASE_URL?.trim() || env.DISTILLATION_BASE_URL?.trim() || env.EMBEDDINGS_BASE_URL).replace(/\/$/, '');
}

function chatHeaders(): Record<string, string> {
  const env = getEnv();
  const headers: Record<string, string> = { 'Content-Type': 'application/json' };
  const key = env.RERANK_API_KEY ?? env.DISTILLATION_API_KEY ?? env.EMBEDDINGS_API_KEY;
  if (key) headers.Authorization = `Bearer ${key}`;
  return headers;
}

async function llmRerank(params: {
  query: string;
  candidates: Array<{ path: string; snippet: string }>;
  timeoutMs: number;
}): Promise<number[]> {
  const env = getEnv();
  const model = env.RERANK_MODEL ?? env.DISTILLATION_MODEL;
  if (!model) throw new Error('RERANK_MODEL or DISTILLATION_MODEL must be configured for rerank_mode=llm');

  const base = chatBaseUrl().endsWith('/') ? chatBaseUrl() : `${chatBaseUrl()}/`;
  const url = new URL('v1/chat/completions', base).toString();
  const ac = new AbortController();
  const t = setTimeout(() => ac.abort(), params.timeoutMs);
  try {
    const system =
      'You are a ranking model. Re-rank candidates by how directly they answer the query. ' +
      'Output ONLY valid JSON: {"order":[...]} where order is an array of candidate indices (0-based), ' +
      'a permutation (or prefix) of 0..N-1. No extra keys, no markdown.';
    const user =
      `QUERY:\n${params.query}\n\nCANDIDATES:\n` +
      params.candidates.map((c, i) => `#${i} PATH: ${c.path}\nSNIPPET: ${c.snippet}`).join('\n\n') +
      `\n\nReturn JSON.`;

    const res = await fetch(url, {
      method: 'POST',
      headers: chatHeaders(),
      signal: ac.signal,
      body: JSON.stringify({
        model,
        messages: [
          { role: 'system', content: system },
          { role: 'user', content: user },
        ],
        temperature: 0.0,
        max_tokens: 250,
      }),
    });
    if (!res.ok) {
      const txt = await res.text().catch(() => '');
      throw new Error(`[rerank] HTTP ${res.status}: ${txt}`);
    }
    const json = (await res.json()) as any;
    const content = json?.choices?.[0]?.message?.content;
    if (typeof content !== 'string') throw new Error('[rerank] missing content');
    const raw = content.trim();
    const first = raw.indexOf('{');
    const last = raw.lastIndexOf('}');
    if (first < 0 || last <= first) throw new Error('[rerank] no JSON object found');
    const parsed = JSON.parse(raw.slice(first, last + 1)) as unknown;
    const validated = RerankOrderSchema.safeParse(parsed);
    if (!validated.success) throw new Error('[rerank] invalid schema');
    const order = validated.data.order;
    const n = params.candidates.length;
    const seen = new Set<number>();
    const cleaned: number[] = [];
    for (const idx of order) {
      if (idx >= 0 && idx < n && !seen.has(idx)) {
        seen.add(idx);
        cleaned.push(idx);
      }
    }
    // Fallback: if model returns empty, keep base order.
    if (!cleaned.length) return Array.from({ length: n }, (_, i) => i);
    // Append any missing indices to keep deterministic permutation.
    for (let i = 0; i < n; i++) if (!seen.has(i)) cleaned.push(i);
    return cleaned;
  } finally {
    clearTimeout(t);
  }
}

export async function searchCode({
  projectId,
  query,
  pathGlob,
  includeTests,
  includeSmoke,
  preferPaths,
  rerankMode,
  lexicalBoost,
  kgAssist,
  limit,
  debug,
}: SearchCodeParams): Promise<SearchCodeResult> {
  const env = getEnv();
  const cacheVersion = await getProjectCacheVersion(projectId).catch(() => 1);
  const topK = limit ?? 10;

  const retrievalCacheKey = redisKey([
    'search_code',
    projectId,
    String(cacheVersion),
    Buffer.from(query).toString('base64url'),
    `path=${pathGlob ?? ''}`,
    `it=${Boolean(includeTests)}`,
    `is=${Boolean(includeSmoke)}`,
    `kg=${Boolean(kgAssist)}`,
    `lex=${lexicalBoost !== false}`,
    `k=${topK}`,
  ]);

  if (!debug) {
    const cached = await redisGetJson<SearchCodeResult>(retrievalCacheKey);
    if (cached && Array.isArray(cached.matches) && Array.isArray(cached.explanations)) {
      return cached;
    }
  }

  const pool = getDbPool();
  const vec = (await embedTexts([query]))[0];
  if (!vec) {
    return { matches: [], explanations: [] };
  }

  const vector = `[${vec.join(',')}]`;
  const maxChars = 400;

  const params: any[] = [projectId, vector];
  let where = `c.project_id = $1`;

  const pg = (pathGlob ?? '').trim();
  const wantsTests = Boolean(includeTests) || /(^|\/)\*\*\/\*\.test\.ts$/.test(pg) || /\.test\.ts/.test(pg) || /__tests__/.test(pg);
  if (!wantsTests) {
    where += ` AND c.file_path NOT LIKE '%.test.ts' AND c.file_path NOT LIKE '%/__tests__/%'`;
  }

  const wantsSmoke = Boolean(includeSmoke) || /(^|\/)src\/smoke\//.test(pg);
  if (!wantsSmoke) {
    where += ` AND c.file_path NOT LIKE 'src/smoke/%'`;
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
      const base = query.trim();
      const symbolish = tokens.filter(t => /[_]/.test(t) || /[A-Z]/.test(t) || /\(\)$/.test(t)).slice(0, 8);
      const normalizedRoute = base.toLowerCase().includes('/mcp') ? ['mcp', '/mcp'] : [];
      const intentProbes =
        /(endpoint|route|router|mcp)/i.test(base) ? ['registerTool', 'createMcp', 'createMcpExpressApp', 'app.post'] : [];
      const probes = Array.from(new Set([base, ...symbolish, ...normalizedRoute, ...intentProbes].filter(Boolean))).slice(0, 10);
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

  const priors = (preferPaths ?? []).filter(p => typeof p === 'string' && p.trim().length).slice(0, 12);
  const matches: SearchCodeResult['matches'] = (res.rows ?? []).map((r: any) => {
    const filePath = String(r.file_path);
    const content = String(r.content);
    const snippet = makeSnippet(content, maxChars);
    const sem = Number(r.score);
    // Weight file path lexical hits higher to surface entrypoints.
    const lexPath = tokens.length ? lexicalScore(tokens, filePath) : 0;
    const lexBody = tokens.length ? lexicalScore(tokens, content) : 0;
    const lex = Math.min(1, 0.75 * lexPath + 0.25 * lexBody);
    const kg = kgFiles.size && kgFiles.has(filePath) ? 0.25 : 0;
    const prior = pathPriorBoost(filePath, priors);
    const boosted = Math.min(1, sem + 0.25 * lex + kg + prior.boost);
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

  // File-level aggregation rerank (stability + reduce repeated-chunk spam).
  // - Compute per-file score from best chunk + lexical(path) and keep at most N chunks per file.
  const maxPerFile = 2;
  const perFile: Record<string, { best: number; chunks: SearchCodeResult['matches'] }> = {};
  for (const m of matches) {
    const key = m.path;
    const entry = (perFile[key] ??= { best: 0, chunks: [] });
    entry.best = Math.max(entry.best, m.score);
    entry.chunks.push(m);
  }
  const fileLexTokens = tokens;
  const fileScores = Object.entries(perFile).map(([path, v]) => {
    const lex = fileLexTokens.length ? lexicalScore(fileLexTokens, path) : 0;
    const fileScore = v.best + 0.15 * lex;
    return { path, fileScore };
  });
  fileScores.sort((a, b) => b.fileScore - a.fileScore);
  const fileRank = new Map<string, number>();
  fileScores.forEach((f, i) => fileRank.set(f.path, i));

  matches.sort((a, b) => {
    const ra = fileRank.get(a.path) ?? Number.MAX_SAFE_INTEGER;
    const rb = fileRank.get(b.path) ?? Number.MAX_SAFE_INTEGER;
    if (ra !== rb) return ra - rb;
    return b.score - a.score;
  });

  // Enforce per-file cap.
  const seenPerFile = new Map<string, number>();
  const capped: typeof matches = [];
  for (const m of matches) {
    const n = (seenPerFile.get(m.path) ?? 0) + 1;
    seenPerFile.set(m.path, n);
    if (n <= maxPerFile) capped.push(m);
  }

  // Optional sync LLM rerank (online path).
  let reranked = capped;
  const mode = rerankMode ?? 'off';
  if (mode === 'llm') {
    const ttlMs = env.RERANK_CACHE_TTL_SECONDS * 1000;
    const topN = Math.min(20, reranked.length);
    const candidates = reranked.slice(0, topN).map(m => ({ path: m.path, snippet: m.snippet }));
    const cacheKey = redisKey([
      'rerank',
      projectId,
      String(cacheVersion),
      Buffer.from(query).toString('base64url'),
      candidates.map(c => c.path).join('|'),
    ]);
    const now = Date.now();
    const redisOrder = await redisGetJson<number[]>(cacheKey);
    if (redisOrder && Array.isArray(redisOrder) && redisOrder.length) {
      reranked = redisOrder.map(i => reranked[i]).filter(Boolean);
    } else {
      const cached = rerankCache.get(cacheKey);
      if (cached && cached.expiresAt > now) {
        const order = cached.order;
        reranked = order.map(i => reranked[i]).filter(Boolean);
      } else {
        try {
          const order = await llmRerank({ query, candidates, timeoutMs: env.RERANK_TIMEOUT_MS });
          rerankCache.set(cacheKey, { expiresAt: now + ttlMs, order });
          await redisSetJson(cacheKey, order, env.REDIS_RERANK_TTL_SECONDS).catch(() => {});
          reranked = order.map(i => reranked[i]).filter(Boolean);
        } catch {
          // best-effort: keep base order
        }
      }
    }
  }

  const explanations: string[] = [];
  if (debug) {
    explanations.push(`vector_query_dim=${vec.length}`);
    if (pathGlob) explanations.push(`pathGlob=${pathGlob}`);
    explanations.push(`includeTests=${Boolean(includeTests)}`);
    explanations.push(`includeSmoke=${Boolean(includeSmoke)}`);
    if (priors.length) explanations.push(`preferPaths=${priors.join(',')}`);
    explanations.push(`lexicalBoost=${lexicalBoost !== false}`);
    explanations.push(`kgAssist=${Boolean(kgAssist)} kgFiles=${kgFiles.size}`);
    explanations.push(`fileRerank=maxPerFile:${maxPerFile} files:${fileScores.length}`);
    explanations.push(`rerankMode=${mode}`);
  }

  const result = { matches: reranked, explanations };
  if (!debug) {
    await redisSetJson(retrievalCacheKey, result, env.REDIS_RETRIEVAL_TTL_SECONDS).catch(() => {});
  }
  return result;
}

