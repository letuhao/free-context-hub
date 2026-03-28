/**
 * Tiered retrieval pipeline for coder agents.
 *
 * Instead of semantic-first search, this uses a deterministic-first approach:
 *   Tier 1: ripgrep (exact literal match on disk)         — near 100% precise
 *   Tier 2: symbol_name DB lookup                         — near 100% precise
 *   Tier 3: FTS + file path pattern matching              — high precision
 *   Tier 4: semantic vector search (fallback)             — moderate precision
 *
 * Returns ALL candidate files grouped by tier and chunk_kind,
 * so the coder agent can choose what to read.
 */
import { getDbPool } from '../db/client.js';
import { embedTexts } from './embedder.js';
import { getEnv } from '../env.js';
import { ripgrepMultiPattern } from '../utils/ripgrepSearch.js';
import { buildFtsQuery } from '../utils/ftsTokenizer.js';
import { createModuleLogger } from '../utils/logger.js';
import { detectLanguage } from '../utils/languageDetect.js';
import type { ChunkKind } from '../utils/languageDetect.js';
import { getProjectCacheVersion } from './cacheVersions.js';
import { redisGetJson, redisKey, redisSetJson } from './redisCache.js';
import { createHash } from 'node:crypto';

const logger = createModuleLogger('tiered-retriever');

// ─── Types ───────────────────────────────────────────────────────────────

export type SearchTier = 'exact_match' | 'symbol_match' | 'fts_match' | 'semantic';

export type FileCandidate = {
  path: string;
  tier: SearchTier;
  kind: ChunkKind;
  score: number;
  symbols: string[];
  /** Representative snippet lines from the best-matching chunk. */
  sample_lines: string[];
};

export type TieredSearchParams = {
  projectId: string;
  query: string;
  /** Filter results to specific kinds. Default: all kinds. */
  kind?: ChunkKind | ChunkKind[];
  /** Include test files. Default: false. Auto-set to true when kind includes 'test'. */
  includeTests?: boolean;
  /** Max files to return. Default: 50. */
  maxFiles?: number;
  /** Minimum unique files from deterministic tiers before skipping semantic. Default: 3. */
  semanticThreshold?: number;
  debug?: boolean;
};

export type TieredSearchResult = {
  files: FileCandidate[];
  total_files: number;
  tiers_executed: SearchTier[];
  tiers_skipped: SearchTier[];
  query_classification: 'identifier' | 'path' | 'natural_language' | 'mixed';
  explanations: string[];
  /** Non-empty when a tier failed or was degraded. Always included (not debug-only). */
  warnings: string[];
};

// ─── Query Classification ────────────────────────────────────────────────

/**
 * Classify the query to decide which tiers to emphasize.
 * - 'identifier': contains camelCase, snake_case, PascalCase tokens → ripgrep + symbol
 * - 'path': contains file paths or extensions → path matching
 * - 'natural_language': pure English question → semantic
 * - 'mixed': combination
 *
 * Priority: identifier > path > mixed > natural_language.
 * Identifier patterns take precedence because words like "get", "list", "find"
 * are common identifier prefixes (getUser, findById) — if the query contains
 * a code identifier, treat it as code-first.
 */
function classifyQuery(query: string): TieredSearchResult['query_classification'] {
  const hasIdentifier = /[a-z][A-Z]|[A-Z]{2,}[a-z]|_[a-z]|[a-z]_/.test(query);
  const hasPath = /[/\\]/.test(query) || /\.\w{1,4}$/.test(query.trim());
  // Only detect NL when the query has sentence-like structure, not just NL keywords
  // embedded in identifiers. Require a space-separated NL keyword that isn't part
  // of an identifier (e.g., "how does auth work" but not "getUser").
  const hasNaturalLanguage = /(?:^|\s)(how|where|what|which|why|when|does|is|are|can|should|could)\s/i.test(query);

  // Identifiers take absolute priority — even if NL words are present,
  // a query like "find getUserById" should use ripgrep on "getUserById".
  if (hasIdentifier) return hasNaturalLanguage ? 'mixed' : 'identifier';
  if (hasPath) return hasNaturalLanguage ? 'mixed' : 'path';
  if (hasNaturalLanguage) return 'natural_language';
  return 'mixed';
}

// ─── Token Extraction ────────────────────────────────────────────────────

/** Common English words that should NOT be treated as code identifiers. */
const EXTRACT_STOP_WORDS = new Set([
  'how', 'where', 'what', 'which', 'when', 'why', 'who',
  'does', 'find', 'show', 'list', 'with', 'from', 'this', 'that',
  'have', 'been', 'they', 'them', 'into', 'each', 'some', 'more',
  'most', 'also', 'just', 'only', 'about', 'after', 'before',
  'should', 'could', 'would', 'being', 'other', 'will', 'the',
  'and', 'for', 'are', 'but', 'not', 'all', 'can', 'had', 'her',
  'was', 'one', 'our', 'out', 'use', 'way', 'many', 'then',
  'like', 'long', 'make', 'thing', 'see', 'him', 'two', 'has',
  'look', 'new', 'now', 'old', 'get', 'set',
]);

/** Extract identifier-like tokens suitable for ripgrep literal search. */
function extractIdentifiers(query: string): string[] {
  const tokens: string[] = [];

  // Quoted strings → exact ripgrep targets.
  for (const m of query.matchAll(/"([^"]+)"|'([^']+)'|`([^`]+)`/g)) {
    const phrase = (m[1] ?? m[2] ?? m[3] ?? '').trim();
    if (phrase.length >= 2) tokens.push(phrase);
  }

  // camelCase/PascalCase/snake_case identifiers (min 2 chars).
  const identifiers = query.match(/[A-Za-z_][A-Za-z0-9_]{1,}/g) ?? [];
  for (const id of identifiers) {
    // Strong identifier signals: case transitions or underscores → always keep.
    if (/[a-z][A-Z]|[A-Z]{2,}[a-z]|_/.test(id)) {
      tokens.push(id);
    } else if (id.length >= 2 && !EXTRACT_STOP_WORDS.has(id.toLowerCase())) {
      // Short tokens (2-3 chars like "env", "db", "pg", "api") are kept
      // unless they're common English stop words.
      tokens.push(id);
    }
  }

  // File paths.
  const paths = query.match(/[\w./\\-]+\.\w{1,6}/g) ?? [];
  tokens.push(...paths.filter(p => p.length >= 3));

  return Array.from(new Set(tokens)).slice(0, 12);
}

// ─── Tier 1: Ripgrep (Exact Match on Disk) ───────────────────────────────

async function tier1Ripgrep(params: {
  root: string;
  tokens: string[];
  kindFilter: ChunkKind[] | null;
  maxFiles: number;
}): Promise<Map<string, { tier: SearchTier; sample_lines: string[]; hit_count: number }>> {
  const result = new Map<string, { tier: SearchTier; sample_lines: string[]; hit_count: number }>();
  if (!params.root || !params.tokens.length) return result;

  try {
    const rg = await ripgrepMultiPattern({
      root: params.root,
      patterns: params.tokens,
      maxFiles: params.maxFiles,
      timeoutMs: 5000,
    });

    for (const f of rg.files) {
      result.set(f.path, {
        tier: 'exact_match',
        sample_lines: f.sample_lines,
        hit_count: f.hit_count,
      });
    }

    logger.info({
      tokens: params.tokens.slice(0, 5),
      files_found: rg.files.length,
      duration_ms: rg.duration_ms,
    }, 'tier1:ripgrep');
  } catch (err) {
    logger.warn({ error: err instanceof Error ? err.message : String(err) }, 'tier1:ripgrep:error');
  }

  return result;
}

// ─── Tier 2: Symbol Name Lookup (DB) ─────────────────────────────────────

async function tier2SymbolLookup(params: {
  projectId: string;
  tokens: string[];
  kindFilter: ChunkKind[] | null;
  pool: ReturnType<typeof getDbPool>;
}): Promise<Map<string, { tier: SearchTier; symbols: string[]; sample_lines: string[] }>> {
  const result = new Map<string, { tier: SearchTier; symbols: string[]; sample_lines: string[] }>();
  if (!params.tokens.length) return result;

  try {
    // Build ILIKE patterns for symbol_name matching.
    const likePatterns = params.tokens
      .filter(t => t.length >= 3)
      .slice(0, 8)
      .map(t => `%${t.replace(/[%_\\]/g, '\\$&')}%`);

    if (!likePatterns.length) return result;

    let kindWhere = '';
    const queryParams: any[] = [params.projectId, likePatterns];
    if (params.kindFilter?.length) {
      queryParams.push(params.kindFilter);
      kindWhere = ` AND c.chunk_kind = ANY($${queryParams.length}::text[])`;
    }

    const res = await params.pool.query(
      `SELECT DISTINCT ON (c.file_path, c.symbol_name)
         c.file_path, c.symbol_name, c.symbol_type, c.chunk_kind,
         substring(c.content, 1, 200) AS sample
       FROM chunks c
       WHERE c.project_id = $1
         AND c.symbol_name IS NOT NULL
         AND c.symbol_name ILIKE ANY($2::text[])
         ${kindWhere}
       ORDER BY c.file_path, c.symbol_name
       LIMIT 100;`,
      queryParams,
    );

    for (const row of (res.rows ?? []) as any[]) {
      const fp = String(row.file_path);
      const entry = result.get(fp) ?? { tier: 'symbol_match' as const, symbols: [], sample_lines: [] };
      if (row.symbol_name) entry.symbols.push(String(row.symbol_name));
      if (row.sample && entry.sample_lines.length < 3) {
        entry.sample_lines.push(String(row.sample).trim().slice(0, 120));
      }
      result.set(fp, entry);
    }

    logger.info({
      tokens: params.tokens.slice(0, 5),
      files_found: result.size,
    }, 'tier2:symbol_lookup');
  } catch (err) {
    logger.warn({ error: err instanceof Error ? err.message : String(err) }, 'tier2:symbol_lookup:error');
  }

  return result;
}

// ─── Tier 3: FTS + Path Match (DB) ──────────────────────────────────────

async function tier3FtsPath(params: {
  projectId: string;
  tokens: string[];
  kindFilter: ChunkKind[] | null;
  pool: ReturnType<typeof getDbPool>;
  limit: number;
  /** Use AND mode for identifier queries to reduce over-broad matches. */
  ftsMode?: 'or' | 'and';
}): Promise<Map<string, { tier: SearchTier; fts_rank: number; sample_lines: string[] }>> {
  const result = new Map<string, { tier: SearchTier; fts_rank: number; sample_lines: string[] }>();

  try {
    const tsquery = buildFtsQuery(params.tokens.slice(0, 12), params.ftsMode ?? 'or');
    if (!tsquery) return result;

    let kindWhere = '';
    const queryParams: any[] = [params.projectId, tsquery, params.limit];
    if (params.kindFilter?.length) {
      queryParams.push(params.kindFilter);
      kindWhere = ` AND c.chunk_kind = ANY($${queryParams.length}::text[])`;
    }

    const res = await params.pool.query(
      `SELECT c.file_path, c.chunk_kind, c.symbol_name,
              ts_rank(c.fts, to_tsquery('english', $2)) AS rank,
              substring(c.content, 1, 200) AS sample
       FROM chunks c
       WHERE c.project_id = $1
         AND c.fts IS NOT NULL
         AND c.fts @@ to_tsquery('english', $2)
         ${kindWhere}
       ORDER BY rank DESC
       LIMIT $3;`,
      queryParams,
    );

    for (const row of (res.rows ?? []) as any[]) {
      const fp = String(row.file_path);
      if (result.has(fp)) continue; // keep highest rank
      result.set(fp, {
        tier: 'fts_match',
        fts_rank: Number(row.rank),
        sample_lines: [String(row.sample ?? '').trim().slice(0, 120)],
      });
    }

    // Also match file paths directly.
    const pathTokens = params.tokens
      .filter(t => t.length >= 3)
      .slice(0, 6)
      .map(t => `%${t.replace(/[%_\\]/g, '\\$&')}%`);

    if (pathTokens.length) {
      const pathParams: any[] = [params.projectId, pathTokens];
      let pathKindWhere = '';
      if (params.kindFilter?.length) {
        pathParams.push(params.kindFilter);
        pathKindWhere = ` AND chunk_kind = ANY($${pathParams.length}::text[])`;
      }

      const pathRes = await params.pool.query(
        `SELECT DISTINCT file_path, chunk_kind
         FROM chunks
         WHERE project_id = $1
           AND file_path ILIKE ANY($2::text[])
           ${pathKindWhere}
         LIMIT 50;`,
        pathParams,
      );

      for (const row of (pathRes.rows ?? []) as any[]) {
        const fp = String(row.file_path);
        if (!result.has(fp)) {
          result.set(fp, { tier: 'fts_match', fts_rank: 0.01, sample_lines: [] });
        }
      }
    }

    logger.info({
      tsquery,
      files_found: result.size,
    }, 'tier3:fts_path');
  } catch (err) {
    logger.warn({ error: err instanceof Error ? err.message : String(err) }, 'tier3:fts_path:error');
  }

  return result;
}

// ─── Tier 4: Semantic Vector Search (Fallback) ──────────────────────────

async function tier4Semantic(params: {
  projectId: string;
  query: string;
  kindFilter: ChunkKind[] | null;
  pool: ReturnType<typeof getDbPool>;
  limit: number;
}): Promise<Map<string, { tier: SearchTier; score: number; symbols: string[]; sample_lines: string[] }>> {
  const result = new Map<string, { tier: SearchTier; score: number; symbols: string[]; sample_lines: string[] }>();

  try {
    const vec = (await embedTexts([params.query]))[0];
    if (!vec) return result;

    const vector = `[${vec.join(',')}]`;
    const queryParams: any[] = [params.projectId, vector, params.limit];
    let kindWhere = '';
    if (params.kindFilter?.length) {
      queryParams.push(params.kindFilter);
      kindWhere = ` AND c.chunk_kind = ANY($${queryParams.length}::text[])`;
    }

    const res = await params.pool.query(
      `SELECT c.file_path, c.symbol_name, c.chunk_kind,
              GREATEST(0, 1 - (c.embedding <=> $2::vector)) AS score,
              substring(c.content, 1, 200) AS sample
       FROM chunks c
       WHERE c.project_id = $1 ${kindWhere}
       ORDER BY c.embedding <=> $2::vector
       LIMIT $3;`,
      queryParams,
    );

    for (const row of (res.rows ?? []) as any[]) {
      const fp = String(row.file_path);
      const existing = result.get(fp);
      const score = Number(row.score);
      if (!existing || score > existing.score) {
        result.set(fp, {
          tier: 'semantic',
          score,
          symbols: row.symbol_name ? [String(row.symbol_name)] : [],
          sample_lines: [String(row.sample ?? '').trim().slice(0, 120)],
        });
      } else if (existing && row.symbol_name) {
        if (!existing.symbols.includes(String(row.symbol_name))) {
          existing.symbols.push(String(row.symbol_name));
        }
      }
    }

    logger.info({
      files_found: result.size,
    }, 'tier4:semantic');
  } catch (err) {
    logger.warn({ error: err instanceof Error ? err.message : String(err) }, 'tier4:semantic:error');
  }

  return result;
}

// ─── Resolve Workspace Root ─────────────────────────────────────────────

import { resolve as pathResolve, normalize as pathNormalize } from 'node:path';

/** In-memory cache for workspace root per project (rarely changes). */
const rootCache = new Map<string, { root: string | null; ts: number }>();
const ROOT_CACHE_TTL_MS = 5 * 60 * 1000; // 5 minutes

/**
 * Validate that a workspace root is safe to use for ripgrep.
 * Rejects paths containing traversal patterns.
 */
function isValidRoot(root: string): boolean {
  const normalized = pathNormalize(root).replace(/\\/g, '/');
  // Reject obvious traversal patterns.
  if (normalized.includes('/../') || normalized.startsWith('../') || normalized === '..') {
    logger.warn({ root }, 'workspace root rejected: path traversal detected');
    return false;
  }
  // Reject root-level system directories on Unix.
  if (/^\/(etc|proc|sys|dev|boot|root)\b/.test(normalized)) {
    logger.warn({ root }, 'workspace root rejected: system directory');
    return false;
  }
  return true;
}

async function resolveWorkspaceRoot(projectId: string, pool: ReturnType<typeof getDbPool>): Promise<string | null> {
  // Check in-memory cache first.
  const cached = rootCache.get(projectId);
  if (cached && Date.now() - cached.ts < ROOT_CACHE_TTL_MS) return cached.root;

  let root: string | null = null;

  try {
    // Try project_workspaces first (Phase 5).
    const ws = await pool.query(
      `SELECT root_path FROM project_workspaces WHERE project_id = $1 LIMIT 1;`,
      [projectId],
    );
    if (ws.rows?.[0]?.root_path) root = String(ws.rows[0].root_path);
  } catch {
    // Table may not exist yet.
  }

  if (!root) {
    try {
      // Fall back to chunks.root (always available).
      const ch = await pool.query(
        `SELECT DISTINCT root FROM chunks WHERE project_id = $1 LIMIT 1;`,
        [projectId],
      );
      if (ch.rows?.[0]?.root) root = String(ch.rows[0].root);
    } catch { /* ignore */ }
  }

  // Validate before caching.
  if (root && !isValidRoot(root)) root = null;

  rootCache.set(projectId, { root, ts: Date.now() });
  return root;
}

// ─── Kind Resolution ────────────────────────────────────────────────────

async function resolveFileKind(
  projectId: string,
  filePaths: string[],
  pool: ReturnType<typeof getDbPool>,
): Promise<Map<string, ChunkKind>> {
  const result = new Map<string, ChunkKind>();
  if (!filePaths.length) return result;

  try {
    const res = await pool.query(
      `SELECT DISTINCT ON (file_path) file_path, chunk_kind
       FROM chunks
       WHERE project_id = $1 AND file_path = ANY($2::text[])
       ORDER BY file_path;`,
      [projectId, filePaths],
    );
    for (const row of (res.rows ?? []) as any[]) {
      result.set(String(row.file_path), (row.chunk_kind ?? 'code') as ChunkKind);
    }
  } catch { /* best-effort */ }

  return result;
}

// ─── Main Pipeline ──────────────────────────────────────────────────────

export async function tieredSearch(params: TieredSearchParams): Promise<TieredSearchResult> {
  const startMs = Date.now();
  const pool = getDbPool();
  const env = getEnv();
  const maxFiles = params.maxFiles ?? 50;
  const semanticThreshold = params.semanticThreshold ?? 3;

  // ── Redis cache check ──────────────────────────────────────────────────
  const cacheVersion = await getProjectCacheVersion(params.projectId).catch(() => 1);
  const kindKey = params.kind
    ? (Array.isArray(params.kind) ? params.kind.sort().join(',') : params.kind)
    : 'all';
  const cacheHash = createHash('md5').update(`${params.query}|${kindKey}|${maxFiles}|${semanticThreshold}`).digest('hex').slice(0, 12);
  const redisCacheKey = redisKey(['tiered', params.projectId, String(cacheVersion), cacheHash]);

  const cached = await redisGetJson<TieredSearchResult>(redisCacheKey).catch(() => null);
  if (cached && Array.isArray(cached.files)) {
    logger.info({ cache: 'hit', key: redisCacheKey, files: cached.files.length }, 'tiered_search:cache_hit');
    return cached;
  }

  const classification = classifyQuery(params.query);
  const tokens = extractIdentifiers(params.query);
  const kindFilter = params.kind
    ? (Array.isArray(params.kind) ? params.kind : [params.kind])
    : null;

  // Auto-enable test inclusion when kind filter explicitly requests tests.
  const includeTests = params.includeTests || (kindFilter?.includes('test') ?? false);

  logger.info({
    project_id: params.projectId,
    query: params.query,
    classification,
    tokens: tokens.slice(0, 8),
    kind_filter: kindFilter,
    max_files: maxFiles,
  }, 'tiered_search:start');

  // Resolve workspace root for ripgrep.
  const root = await resolveWorkspaceRoot(params.projectId, pool);

  const tiersExecuted: SearchTier[] = [];
  const tiersSkipped: SearchTier[] = [];
  const explanations: string[] = [];
  const warnings: string[] = [];

  // ── Execute Tier 1 + 2 + 3 in parallel ────────────────────────────────
  const [t1Result, t2Result, t3Result] = await Promise.all([
    // Tier 1: ripgrep (skip for pure natural language queries or if no root).
    (classification !== 'natural_language' && root && tokens.length > 0)
      ? tier1Ripgrep({ root, tokens, kindFilter, maxFiles })
          .then(r => { tiersExecuted.push('exact_match'); return r; })
          .catch(err => {
            warnings.push(`tier1_ripgrep failed: ${err instanceof Error ? err.message : String(err)}`);
            tiersSkipped.push('exact_match');
            return new Map() as Awaited<ReturnType<typeof tier1Ripgrep>>;
          })
      : Promise.resolve((() => {
          tiersSkipped.push('exact_match');
          if (!root && classification !== 'natural_language' && tokens.length > 0) {
            warnings.push('tier1_ripgrep skipped: workspace root not found');
          }
          return new Map() as Awaited<ReturnType<typeof tier1Ripgrep>>;
        })()),

    // Tier 2: symbol lookup (always run if tokens exist).
    tokens.length > 0
      ? tier2SymbolLookup({ projectId: params.projectId, tokens, kindFilter, pool })
          .then(r => { tiersExecuted.push('symbol_match'); return r; })
          .catch(err => {
            warnings.push(`tier2_symbol_lookup failed: ${err instanceof Error ? err.message : String(err)}`);
            tiersSkipped.push('symbol_match');
            return new Map() as Awaited<ReturnType<typeof tier2SymbolLookup>>;
          })
      : Promise.resolve((() => { tiersSkipped.push('symbol_match'); return new Map() as Awaited<ReturnType<typeof tier2SymbolLookup>>; })()),

    // Tier 3: FTS (always run). Use AND mode for identifier queries to reduce noise.
    tier3FtsPath({
      projectId: params.projectId, tokens, kindFilter, pool, limit: maxFiles,
      ftsMode: (classification === 'identifier' || classification === 'path') ? 'and' : 'or',
    })
      .then(r => { tiersExecuted.push('fts_match'); return r; })
      .catch(err => {
        warnings.push(`tier3_fts failed: ${err instanceof Error ? err.message : String(err)}`);
        tiersSkipped.push('fts_match');
        return new Map() as Awaited<ReturnType<typeof tier3FtsPath>>;
      }),
  ]);

  // Count unique files from deterministic tiers.
  const deterministicFiles = new Set([
    ...t1Result.keys(),
    ...t2Result.keys(),
    ...t3Result.keys(),
  ]);

  // ── Tier 4: Semantic (only if deterministic tiers found too few) ───────
  let t4Result = new Map<string, { tier: SearchTier; score: number; symbols: string[]; sample_lines: string[] }>();
  if (deterministicFiles.size < semanticThreshold || classification === 'natural_language') {
    try {
      t4Result = await tier4Semantic({
        projectId: params.projectId,
        query: params.query,
        kindFilter,
        pool,
        limit: maxFiles,
      });
      tiersExecuted.push('semantic');
    } catch (err) {
      warnings.push(`tier4_semantic failed: ${err instanceof Error ? err.message : String(err)}`);
      tiersSkipped.push('semantic');
    }
  } else {
    tiersSkipped.push('semantic');
    explanations.push(`semantic skipped: ${deterministicFiles.size} deterministic files >= threshold ${semanticThreshold}`);
  }

  // ── Merge Results ─────────────────────────────────────────────────────

  // Collect all unique file paths.
  const allPaths = new Set([
    ...t1Result.keys(),
    ...t2Result.keys(),
    ...t3Result.keys(),
    ...t4Result.keys(),
  ]);

  // Resolve kinds for ripgrep files (they don't come from DB).
  const rgOnlyPaths = Array.from(t1Result.keys()).filter(p => !t2Result.has(p) && !t3Result.has(p) && !t4Result.has(p));
  const kindMap = await resolveFileKind(params.projectId, rgOnlyPaths, pool);

  // Build file candidates with tier priority: exact > symbol > fts > semantic.
  const tierPriority: Record<SearchTier, number> = {
    exact_match: 4,
    symbol_match: 3,
    fts_match: 2,
    semantic: 1,
  };

  const candidates: FileCandidate[] = [];
  for (const path of allPaths) {
    const t1 = t1Result.get(path);
    const t2 = t2Result.get(path);
    const t3 = t3Result.get(path);
    const t4 = t4Result.get(path);

    // Determine best tier.
    let bestTier: SearchTier = 'semantic';
    let bestPriority = 0;
    for (const [tier, data] of [
      ['exact_match', t1],
      ['symbol_match', t2],
      ['fts_match', t3],
      ['semantic', t4],
    ] as const) {
      if (data && tierPriority[tier] > bestPriority) {
        bestTier = tier;
        bestPriority = tierPriority[tier];
      }
    }

    // Compute a composite score.
    let score = 0;
    if (t1) score += 0.5 + (t1.hit_count / tokens.length) * 0.5; // 0.5-1.0 for ripgrep
    if (t2) score += 0.4; // symbol match bonus
    if (t3) score += 0.1 + Math.min(0.3, t3.fts_rank); // FTS rank
    if (t4) score += t4.score * 0.3; // semantic (discounted)
    score = Math.min(1, score);

    // Collect symbols.
    const symbols: string[] = [];
    if (t2?.symbols) symbols.push(...t2.symbols);
    if (t4?.symbols) symbols.push(...t4.symbols);

    // Collect sample lines.
    const sampleLines: string[] = [];
    if (t1?.sample_lines) sampleLines.push(...t1.sample_lines);
    if (t2?.sample_lines?.length && sampleLines.length < 3) sampleLines.push(...t2.sample_lines);
    if (t3?.sample_lines?.length && sampleLines.length < 3) sampleLines.push(...t3.sample_lines);
    if (t4?.sample_lines?.length && sampleLines.length < 3) sampleLines.push(...t4.sample_lines);

    // Determine kind from DB or infer from path using the canonical classifier.
    let kind: ChunkKind = kindMap.get(path) ?? detectLanguage(path).kind;

    // Apply kind filter (for ripgrep results that didn't go through DB filter).
    if (kindFilter && !kindFilter.includes(kind)) continue;

    // Exclude tests unless requested (or kind filter includes 'test').
    if (!includeTests && kind === 'test') continue;

    candidates.push({
      path,
      tier: bestTier,
      kind,
      score,
      symbols: Array.from(new Set(symbols)).slice(0, 10),
      sample_lines: sampleLines.slice(0, 3),
    });
  }

  // Sort: by tier priority (desc), then by score (desc).
  candidates.sort((a, b) => {
    const ta = tierPriority[a.tier];
    const tb = tierPriority[b.tier];
    if (ta !== tb) return tb - ta;
    return b.score - a.score;
  });

  const totalFiles = candidates.length;
  const files = candidates.slice(0, maxFiles);

  const totalMs = Date.now() - startMs;
  logger.info({
    project_id: params.projectId,
    query: params.query,
    classification,
    total_ms: totalMs,
    tiers_executed: tiersExecuted,
    tiers_skipped: tiersSkipped,
    total_files: totalFiles,
    returned_files: files.length,
    by_tier: {
      exact_match: files.filter(f => f.tier === 'exact_match').length,
      symbol_match: files.filter(f => f.tier === 'symbol_match').length,
      fts_match: files.filter(f => f.tier === 'fts_match').length,
      semantic: files.filter(f => f.tier === 'semantic').length,
    },
    by_kind: Object.fromEntries(
      (['source', 'type_def', 'test', 'migration', 'config', 'dependency', 'api_spec', 'doc', 'script', 'infra', 'style', 'generated'] as const)
        .map(k => [k, files.filter(f => f.kind === k).length])
        .filter(([, count]) => (count as number) > 0)
    ),
  }, 'tiered_search:done');

  if (params.debug) {
    explanations.push(`classification=${classification}`);
    explanations.push(`tokens=[${tokens.join(', ')}]`);
    explanations.push(`workspace_root=${root ?? 'none'}`);
    explanations.push(`tiers_executed=[${tiersExecuted.join(', ')}]`);
    explanations.push(`deterministic_files=${deterministicFiles.size}`);
    explanations.push(`total_files=${totalFiles} returned=${files.length}`);
    explanations.push(`total_ms=${totalMs}`);
  }

  const result: TieredSearchResult = {
    files,
    total_files: totalFiles,
    tiers_executed: tiersExecuted,
    tiers_skipped: tiersSkipped,
    query_classification: classification,
    explanations,
    warnings,
  };

  // ── Redis cache write (best-effort, only if no warnings indicating degradation) ──
  if (!warnings.length) {
    await redisSetJson(redisCacheKey, result, env.REDIS_RETRIEVAL_TTL_SECONDS).catch(() => {});
  }

  return result;
}
