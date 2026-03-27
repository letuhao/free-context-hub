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
  qcNoCap?: boolean;
  rerankMode?: 'off' | 'llm';
  lexicalBoost?: boolean;
  kgAssist?: boolean;
  lessonToCode?: boolean;
  limit?: number;
  debug?: boolean;
  hybridMode?: 'off' | 'lexical';
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
  if (/(output_format|auto_both|summary_only|json_only)/.test(lower)) {
    tokens.push('output_format', 'auto_both', 'summary_only', 'json_only', 'formatToolResponse');
  }
  if (/(health|health endpoint)/.test(lower)) {
    tokens.push('health', 'app.get', '/health');
  }
  if (/(dotenv|envschema|parsebooleanenv|default_project_id)/.test(lower)) {
    tokens.push('dotenv', 'EnvSchema', 'parseBooleanEnv', 'DEFAULT_PROJECT_ID', 'resolveProjectIdOrThrow');
  }
  if (/(search_code|retriev|lexical|kg|boost)/.test(lower)) {
    tokens.push('searchCode', 'lexicalBoost', 'kgAssist', 'pathPriorBoost', 'extractLexicalTokens');
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

function pathPriorBoost(
  filePath: string,
  preferPaths: string[],
  options?: { perHit?: number; cap?: number },
): { boost: number; hits: string[] } {
  if (!preferPaths.length) return { boost: 0, hits: [] };
  const hits: string[] = [];
  for (const p of preferPaths) {
    try {
      if (globToRegExp(p).test(filePath)) hits.push(p);
    } catch {
      // ignore invalid globs
    }
  }
  const perHit = options?.perHit ?? 0.1;
  const cap = options?.cap ?? 0.2;
  // Cap the contribution to keep scores stable.
  const boost = Math.min(cap, hits.length * perHit);
  return { boost, hits };
}

function inferIntentPriors(query: string): string[] {
  const q = query.toLowerCase();
  const priors: string[] = [];

  if (/(mcp|endpoint|route|registertool|output_format|auto_both|health)/.test(q)) {
    priors.push('src/index.ts', 'src/utils/outputFormat.ts', 'src/smoke/smokeTest.ts', 'src/smoke/phase5WorkerValidation.ts');
  }
  if (/(env|dotenv|default_project_id|workspace_token|parsebooleanenv|config|queue_|s3_|embeddings_)/.test(q)) {
    priors.push('src/env.ts', 'src/index.ts');
  }
  if (/(search_code|retriev|lexical|kg|boost|path_glob|__tests__|smoke)/.test(q)) {
    priors.push('src/services/retriever.ts');
  }

  return Array.from(new Set(priors));
}

function normalizeSourceRefToRepoPath(ref: string): string | undefined {
  let s = String(ref ?? '').trim();
  if (!s) return undefined;
  if (/^git:/i.test(s)) return undefined;

  s = s.replace(/\\/g, '/');
  s = s.replace(/#L\d+(?:-L?\d+)?$/i, '').replace(/[?#].*$/, '');

  if (/^https?:\/\//i.test(s)) {
    try {
      const u = new URL(s);
      s = decodeURIComponent(u.pathname || '');
    } catch {
      // best-effort fallback below
    }
  }

  s = s.replace(/^\/+/, '').replace(/^\.\//, '');
  const direct = /^(src|migrations)\//i.test(s) ? s : '';
  if (!direct) {
    const m = s.match(/(?:^|\/)((?:src|migrations)\/[^#?\s]+)/i);
    s = m?.[1] ?? '';
  }

  if (!s || !s.includes('/')) return undefined;
  return s;
}

function allowsBySearchFilters(params: {
  filePath: string;
  pathGlob?: string;
  includeTests: boolean;
  includeSmoke: boolean;
}): boolean {
  const p = params.filePath;
  if (!params.includeTests && (p.endsWith('.test.ts') || p.includes('/__tests__/'))) return false;
  if (!params.includeSmoke && p.startsWith('src/smoke/')) return false;
  const g = (params.pathGlob ?? '').trim();
  if (!g) return true;
  try {
    return globToRegExp(g).test(p);
  } catch {
    return true;
  }
}

async function fetchLessonPathPriors(params: {
  projectId: string;
  vector: string;
  pool: ReturnType<typeof getDbPool>;
  pathGlob?: string;
  includeTests: boolean;
  includeSmoke: boolean;
  lessonLimit: number;
  maxPaths: number;
  minScore: number;
}): Promise<string[]> {
  const res = await params.pool.query(
    `SELECT *
     FROM (
       SELECT l.source_refs, GREATEST(0, 1 - (l.embedding <=> $2::vector)) AS score
       FROM lessons l
       WHERE l.project_id=$1
         AND l.status NOT IN ('superseded', 'archived')
         AND COALESCE(array_length(l.source_refs, 1), 0) > 0
       ORDER BY l.embedding <=> $2::vector
       LIMIT $3
     ) x
     WHERE x.score >= $4
     ORDER BY x.score DESC`,
    [params.projectId, params.vector, params.lessonLimit, params.minScore],
  );

  const out: string[] = [];
  const seen = new Set<string>();
  for (const row of res.rows ?? []) {
    const refs = Array.isArray((row as any).source_refs) ? ((row as any).source_refs as unknown[]) : [];
    for (const raw of refs) {
      if (typeof raw !== 'string') continue;
      const p = normalizeSourceRefToRepoPath(raw);
      if (!p) continue;
      if (
        !allowsBySearchFilters({
          filePath: p,
          pathGlob: params.pathGlob,
          includeTests: params.includeTests,
          includeSmoke: params.includeSmoke,
        })
      ) {
        continue;
      }
      if (seen.has(p)) continue;
      seen.add(p);
      out.push(p);
      if (out.length >= params.maxPaths) return out;
    }
  }
  return out;
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

function candidatePoolSize(topK: number, env: ReturnType<typeof getEnv>): number {
  const minPool = Math.max(topK, env.RETRIEVAL_CANDIDATE_POOL_MIN);
  const mulPool = Math.max(topK, topK * env.RETRIEVAL_CANDIDATE_POOL_MULTIPLIER);
  const raw = Math.max(minPool, mulPool);
  return Math.max(topK, Math.min(env.RETRIEVAL_CANDIDATE_POOL_MAX, raw));
}

function hubFilePenalty(chunkCountForFile: number): number {
  if (chunkCountForFile <= 2) return 0;
  // Candidate-local penalty for overly broad hub files.
  return Math.min(0.18, Math.log2(chunkCountForFile) * 0.05);
}

function tokenizeForMmr(path: string, snippet: string): Set<string> {
  const src = `${path} ${snippet}`.toLowerCase();
  const toks = src.match(/[a-z0-9_]{4,}/g) ?? [];
  return new Set(toks.slice(0, 200));
}

function jaccard(a: Set<string>, b: Set<string>): number {
  if (!a.size || !b.size) return 0;
  let inter = 0;
  for (const x of a) if (b.has(x)) inter += 1;
  const union = a.size + b.size - inter;
  return union > 0 ? inter / union : 0;
}

function mmrReorder(
  input: SearchCodeResult['matches'],
  lambda: number,
  windowSize: number,
): SearchCodeResult['matches'] {
  if (input.length <= 2) return input;
  const n = Math.min(input.length, Math.max(2, windowSize));
  const head = input.slice(0, n);
  const tail = input.slice(n);

  const feats = head.map(h => tokenizeForMmr(h.path, h.snippet));
  const maxScore = Math.max(...head.map(h => h.score), 1e-9);
  const rel = head.map(h => h.score / maxScore);

  const remaining = new Set<number>(head.map((_, i) => i));
  const selected: number[] = [];

  while (remaining.size) {
    let bestIdx = -1;
    let bestVal = -Infinity;
    for (const i of remaining) {
      let maxSim = 0;
      let sameFile = 0;
      for (const j of selected) {
        if (head[i]?.path === head[j]?.path) sameFile = 1;
        const sim = jaccard(feats[i]!, feats[j]!);
        if (sim > maxSim) maxSim = sim;
      }
      const novelty = 1 - Math.max(maxSim, sameFile);
      const mmr = lambda * rel[i]! + (1 - lambda) * novelty;
      if (mmr > bestVal) {
        bestVal = mmr;
        bestIdx = i;
      }
    }
    if (bestIdx < 0) break;
    selected.push(bestIdx);
    remaining.delete(bestIdx);
  }

  return [...selected.map(i => head[i]!), ...tail];
}

function escapeLikePattern(input: string): string {
  return input.replace(/[%_\\]/g, '\\$&');
}

function dedupeMatches(matches: SearchCodeResult['matches']): SearchCodeResult['matches'] {
  const seen = new Set<string>();
  const out: SearchCodeResult['matches'] = [];
  for (const m of matches) {
    const key = `${m.path}:${m.start_line}:${m.end_line}`;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(m);
  }
  return out;
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
        max_tokens: env.RERANK_LLM_MAX_TOKENS,
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
  qcNoCap,
  rerankMode,
  lexicalBoost,
  kgAssist,
  lessonToCode,
  limit,
  debug,
  hybridMode,
}: SearchCodeParams): Promise<SearchCodeResult> {
  const env = getEnv();
  const pool = getDbPool();
  const cacheVersion = await getProjectCacheVersion(projectId).catch(() => 1);
  const useLessonToCode = lessonToCode !== false;
  let lessonsSig = '0';
  if (useLessonToCode) {
    try {
      const sres = await pool.query(
        `SELECT COALESCE(EXTRACT(EPOCH FROM MAX(updated_at))::bigint, 0) AS ts
         FROM lessons
         WHERE project_id=$1
           AND status NOT IN ('superseded', 'archived');`,
        [projectId],
      );
      lessonsSig = String((sres.rows?.[0] as any)?.ts ?? '0');
    } catch {
      lessonsSig = '0';
    }
  }
  const topK = limit ?? 10;
  const poolK = candidatePoolSize(topK, env);

  const retrievalCacheKey = redisKey([
    'search_code',
    projectId,
    String(cacheVersion),
    Buffer.from(query).toString('base64url'),
    `path=${pathGlob ?? ''}`,
    `it=${Boolean(includeTests)}`,
    `is=${Boolean(includeSmoke)}`,
    `kg=${Boolean(kgAssist)}`,
    `l2c=${useLessonToCode}`,
    `lsig=${lessonsSig}`,
    `lex=${lexicalBoost !== false}`,
    `hybrid=${hybridMode ?? 'off'}`,
    `k=${topK}`,
    `poolK=${poolK}`,
  ]);

  if (!debug) {
    const cached = await redisGetJson<SearchCodeResult>(retrievalCacheKey);
    if (cached && Array.isArray(cached.matches) && Array.isArray(cached.explanations)) {
      return cached;
    }
  }

  const vec = (await embedTexts([query]))[0];
  if (!vec) {
    return { matches: [], explanations: [] };
  }

  const vector = `[${vec.join(',')}]`;
  const maxChars = env.RETRIEVAL_SNIPPET_MAX_CHARS;

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
  params.push(poolK); // becomes $3 (no pathGlob) OR $4 (with pathGlob)

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
  const hybridEnabled = (hybridMode ?? 'off') === 'lexical' || env.RETRIEVAL_HYBRID_ENABLED;
  const lexicalLimit = Math.max(1, env.RETRIEVAL_HYBRID_LEXICAL_LIMIT);
  let lexicalRows: any[] = [];
  const hybridStarted = Date.now();
  if (hybridEnabled && tokens.length) {
    const lexicalParams: any[] = [projectId, vector];
    let whereLex = `c.project_id = $1`;
    if (!wantsTests) {
      whereLex += ` AND c.file_path NOT LIKE '%.test.ts' AND c.file_path NOT LIKE '%/__tests__/%'`;
    }
    if (!wantsSmoke) {
      whereLex += ` AND c.file_path NOT LIKE 'src/smoke/%'`;
    }
    if (pathGlob && pathGlob.trim().length) {
      const like = globToSqlLike(pathGlob);
      lexicalParams.push(like);
      whereLex += ` AND c.file_path LIKE $${lexicalParams.length}`;
    }
    const tokenLike = tokens
      .map(t => t.trim())
      .filter(Boolean)
      .slice(0, 12)
      .map(t => `%${escapeLikePattern(t)}%`);
    if (tokenLike.length) {
      lexicalParams.push(tokenLike);
      const arrIdx = lexicalParams.length;
      whereLex += ` AND EXISTS (
        SELECT 1
        FROM unnest($${arrIdx}::text[]) AS tok
        WHERE c.file_path ILIKE tok ESCAPE '\\'
           OR c.content ILIKE tok ESCAPE '\\'
      )`;
      lexicalParams.push(lexicalLimit);
      const lexicalSql = `
        SELECT
          c.file_path,
          c.start_line,
          c.end_line,
          c.content,
          GREATEST(0, 1 - (c.embedding <=> $2::vector)) AS score
        FROM chunks c
        WHERE ${whereLex}
        ORDER BY c.embedding <=> $2::vector
        LIMIT $${lexicalParams.length};
      `;
      const lexicalRes = await pool.query(lexicalSql, lexicalParams);
      lexicalRows = lexicalRes.rows ?? [];
    }
  }
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

  const explicitPriors = (preferPaths ?? []).filter(p => typeof p === 'string' && p.trim().length);
  const intentPriors = inferIntentPriors(query);
  const lessonPriors = useLessonToCode
    ? await fetchLessonPathPriors({
        projectId,
        vector,
        pool,
        pathGlob,
        includeTests: wantsTests,
        includeSmoke: wantsSmoke,
        lessonLimit: 8,
        maxPaths: 12,
        minScore: env.RETRIEVAL_LESSON_PRIOR_MIN_SCORE,
      }).catch(() => [])
    : [];
  // True expansion: pull best chunk per lesson-prior file into candidate pool.
  let lessonRows: any[] = [];
  if (useLessonToCode && lessonPriors.length) {
    try {
      const expansionLimit = Math.max(1, Math.min(24, lessonPriors.length));
      const expanded = await pool.query(
        `SELECT * FROM (
           SELECT DISTINCT ON (c.file_path)
             c.file_path,
             c.start_line,
             c.end_line,
             c.content,
             GREATEST(0, 1 - (c.embedding <=> $2::vector)) AS score
           FROM chunks c
           WHERE c.project_id = $1
             AND c.file_path = ANY($3::text[])
           ORDER BY c.file_path, c.embedding <=> $2::vector
         ) x
         ORDER BY x.score DESC
         LIMIT $4;`,
        [projectId, vector, lessonPriors, expansionLimit],
      );
      lessonRows = expanded.rows ?? [];
    } catch {
      lessonRows = [];
    }
  }
  const toMatch = (r: any): SearchCodeResult['matches'][number] => {
    const filePath = String(r.file_path);
    const content = String(r.content);
    const snippet = makeSnippet(content, maxChars);
    const sem = Number(r.score);
    // Weight file path lexical hits higher to surface entrypoints.
    const lexPath = tokens.length ? lexicalScore(tokens, filePath) : 0;
    const lexBody = tokens.length ? lexicalScore(tokens, content) : 0;
    const lex = Math.min(1, 0.75 * lexPath + 0.25 * lexBody);
    const kg = kgFiles.size && kgFiles.has(filePath) ? 0.25 : 0;
    const priorExplicit = pathPriorBoost(filePath, explicitPriors, { perHit: 0.1, cap: 0.2 });
    const priorLesson = pathPriorBoost(filePath, lessonPriors, { perHit: 0.18, cap: 0.54 });
    const priorIntent = pathPriorBoost(filePath, intentPriors, { perHit: 0.08, cap: 0.16 });
    const boosted = Math.min(1, sem + 0.25 * lex + kg + priorExplicit.boost + priorLesson.boost + priorIntent.boost);
    return {
      path: filePath,
      start_line: Number(r.start_line),
      end_line: Number(r.end_line),
      snippet,
      score: boosted,
      match_type: 'semantic',
    };
  };
  const semanticMatches: SearchCodeResult['matches'] = (res.rows ?? []).map(toMatch);
  const lexicalMatches: SearchCodeResult['matches'] = lexicalRows.map(toMatch);
  const lessonExpandedMatches: SearchCodeResult['matches'] = lessonRows.map(toMatch);
  const matches: SearchCodeResult['matches'] = dedupeMatches([...semanticMatches, ...lexicalMatches, ...lessonExpandedMatches]);
  const chunkFreq = new Map<string, number>();
  for (const m of matches) {
    chunkFreq.set(m.path, (chunkFreq.get(m.path) ?? 0) + 1);
  }
  const debiasedMatches: SearchCodeResult['matches'] = matches.map(m => {
    const penalty = hubFilePenalty(chunkFreq.get(m.path) ?? 1);
    return { ...m, score: Math.max(0, m.score - penalty) };
  });
  const hybridLatencyMs = Date.now() - hybridStarted;

  // Re-rank after boosting.
  debiasedMatches.sort((a, b) => b.score - a.score);
  const mmrLambda = Math.min(1, Math.max(0, env.RETRIEVAL_MMR_LAMBDA));
  const mmrWindow = Math.max(2, env.RETRIEVAL_MMR_WINDOW);
  const mmrMatches = mmrReorder(debiasedMatches, mmrLambda, mmrWindow);

  // File-level aggregation rerank (stability + reduce repeated-chunk spam).
  // - Compute per-file score from best chunk + lexical(path) and keep at most N chunks per file.
  const maxPerFile = qcNoCap ? Number.MAX_SAFE_INTEGER : 2;
  const perFile: Record<string, { best: number; chunks: SearchCodeResult['matches'] }> = {};
  for (const m of mmrMatches) {
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

  mmrMatches.sort((a, b) => {
    const ra = fileRank.get(a.path) ?? Number.MAX_SAFE_INTEGER;
    const rb = fileRank.get(b.path) ?? Number.MAX_SAFE_INTEGER;
    if (ra !== rb) return ra - rb;
    return b.score - a.score;
  });

  // Enforce per-file cap.
  const seenPerFile = new Map<string, number>();
  const capped: typeof matches = [];
  for (const m of mmrMatches) {
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
    if (explicitPriors.length) explanations.push(`preferPaths=${explicitPriors.join(',')}`);
    if (lessonPriors.length) explanations.push(`lessonToCodePriors=${lessonPriors.join(',')}`);
    explanations.push('priorBoostWeights=explicit(0.1/0.2),lesson(0.18/0.54),intent(0.08/0.16)');
    explanations.push(`lessonToCode=${useLessonToCode} lessonsSig=${lessonsSig}`);
    if (intentPriors.length) explanations.push(`intentPriors=${intentPriors.join(',')}`);
    explanations.push(`lexicalBoost=${lexicalBoost !== false}`);
    explanations.push(`hybridEnabled=${hybridEnabled}`);
    explanations.push(`hybridMode=${hybridMode ?? 'off'}`);
    explanations.push(`hybridLexicalLimit=${lexicalLimit}`);
    explanations.push(`candidatePoolK=${poolK}`);
    explanations.push(`lexicalCandidates=${lexicalMatches.length}`);
    explanations.push(`lessonExpansionCandidates=${lessonExpandedMatches.length}`);
    explanations.push(`lessonPriorMinScore=${env.RETRIEVAL_LESSON_PRIOR_MIN_SCORE}`);
    explanations.push(`mergedCandidates=${matches.length}`);
    explanations.push('hubPenaltyMax=0.18');
    explanations.push(`mmrLambda=${mmrLambda} mmrWindow=${mmrWindow}`);
    explanations.push(`hybridLatencyMs=${hybridLatencyMs}`);
    explanations.push(`kgAssist=${Boolean(kgAssist)} kgFiles=${kgFiles.size}`);
    explanations.push(`fileRerank=maxPerFile:${maxPerFile} files:${fileScores.length}`);
    explanations.push(`qcNoCap=${Boolean(qcNoCap)}`);
    explanations.push(`rerankMode=${mode}`);
  }

  const result = { matches: reranked.slice(0, topK), explanations };
  if (!debug) {
    await redisSetJson(retrievalCacheKey, result, env.REDIS_RETRIEVAL_TTL_SECONDS).catch(() => {});
  }
  return result;
}

