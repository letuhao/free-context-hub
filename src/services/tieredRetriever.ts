/**
 * Tiered retrieval pipeline for coder agents.
 *
 * Three search profiles adapt tier ordering to the data kind:
 *
 *   code-search (default):  ripgrep → symbol → FTS → semantic fallback
 *   relationship (test):    convention paths → KG imports → filtered ripgrep → semantic
 *   semantic-first (doc):   semantic + FTS parallel → ripgrep conditional
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
import { normalize as pathNormalize } from 'node:path';
import { searchSymbols, getSymbolNeighbors } from '../kg/query.js';

const logger = createModuleLogger('tiered-retriever');

// ─── Types ───────────────────────────────────────────────────────────────

export type SearchTier = 'exact_match' | 'symbol_match' | 'fts_match' | 'semantic' | 'convention_match';

export type SearchProfile = 'code-search' | 'relationship' | 'semantic-first';

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
  query_classification: QueryClassification;
  search_profile: SearchProfile;
  explanations: string[];
  /** Non-empty when a tier failed or was degraded. Always included (not debug-only). */
  warnings: string[];
};

type QueryClassification = 'identifier' | 'path' | 'natural_language' | 'mixed';

/** Shared context passed to each profile executor. */
type ProfileContext = {
  projectId: string;
  query: string;
  classification: QueryClassification;
  tokens: string[];
  kindFilter: ChunkKind[] | null;
  includeTests: boolean;
  maxFiles: number;
  semanticThreshold: number;
  root: string | null;
  pool: ReturnType<typeof getDbPool>;
  debug: boolean;
};

/** Result returned by each profile executor. */
type ProfileResult = {
  candidates: FileCandidate[];
  tiersExecuted: SearchTier[];
  tiersSkipped: SearchTier[];
  explanations: string[];
  warnings: string[];
};

// ─── Profile Selection ──────────────────────────────────────────────────

const KIND_TO_PROFILE: Record<ChunkKind, SearchProfile> = {
  source: 'code-search',
  type_def: 'code-search',
  config: 'code-search',
  dependency: 'code-search',
  migration: 'code-search',
  infra: 'code-search',
  style: 'code-search',
  generated: 'code-search',
  api_spec: 'code-search',
  test: 'relationship',
  doc: 'semantic-first',
  script: 'semantic-first',
};

/**
 * Select the optimal search profile based on kind filter.
 * When kinds map to different profiles (mixed), fall back to code-search.
 */
function selectProfile(kindFilter: ChunkKind[] | null): SearchProfile {
  if (!kindFilter || kindFilter.length === 0) return 'code-search';
  const profiles = new Set(kindFilter.map(k => KIND_TO_PROFILE[k]));
  if (profiles.size === 1) return profiles.values().next().value!;
  // Mixed kinds → default to code-search (general purpose).
  return 'code-search';
}

// ─── Query Classification ────────────────────────────────────────────────

function classifyQuery(query: string): QueryClassification {
  const hasIdentifier = /[a-z][A-Z]|[A-Z]{2,}[a-z]|_[a-z]|[a-z]_/.test(query);
  const hasPath = /[/\\]/.test(query) || /\.\w{1,4}$/.test(query.trim());
  const hasNaturalLanguage = /(?:^|\s)(how|where|what|which|why|when|does|is|are|can|should|could)\s/i.test(query);

  if (hasIdentifier) return hasNaturalLanguage ? 'mixed' : 'identifier';
  if (hasPath) return hasNaturalLanguage ? 'mixed' : 'path';
  if (hasNaturalLanguage) return 'natural_language';
  return 'mixed';
}

// ─── Token Extraction ────────────────────────────────────────────────────

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

function extractIdentifiers(query: string): string[] {
  const tokens: string[] = [];

  for (const m of query.matchAll(/"([^"]+)"|'([^']+)'|`([^`]+)`/g)) {
    const phrase = (m[1] ?? m[2] ?? m[3] ?? '').trim();
    if (phrase.length >= 2) tokens.push(phrase);
  }

  const identifiers = query.match(/[A-Za-z_][A-Za-z0-9_]{1,}/g) ?? [];
  for (const id of identifiers) {
    if (/[a-z][A-Z]|[A-Z]{2,}[a-z]|_/.test(id)) {
      tokens.push(id);
    } else if (id.length >= 2 && !EXTRACT_STOP_WORDS.has(id.toLowerCase())) {
      tokens.push(id);
    }
  }

  const paths = query.match(/[\w./\\-]+\.\w{1,6}/g) ?? [];
  tokens.push(...paths.filter(p => p.length >= 3));

  return Array.from(new Set(tokens)).slice(0, 12);
}

// ═══════════════════════════════════════════════════════════════════════════
// SHARED TIER FUNCTIONS (used by multiple profiles)
// ═══════════════════════════════════════════════════════════════════════════

// ─── Tier 1: Ripgrep ────────────────────────────────────────────────────

async function tier1Ripgrep(params: {
  root: string;
  tokens: string[];
  kindFilter: ChunkKind[] | null;
  maxFiles: number;
}): Promise<Map<string, { tier: SearchTier; sample_lines: string[]; hit_count: number }>> {
  const result = new Map<string, { tier: SearchTier; sample_lines: string[]; hit_count: number }>();
  if (!params.root || !params.tokens.length) return result;

  const rg = await ripgrepMultiPattern({
    root: params.root,
    patterns: params.tokens,
    maxFiles: params.maxFiles,
    timeoutMs: 5000,
  });

  for (const f of rg.files) {
    result.set(f.path, { tier: 'exact_match', sample_lines: f.sample_lines, hit_count: f.hit_count });
  }

  logger.info({ tokens: params.tokens.slice(0, 5), files_found: rg.files.length, duration_ms: rg.duration_ms }, 'tier1:ripgrep');
  return result;
}

// ─── Tier 2: Symbol Name Lookup ─────────────────────────────────────────

async function tier2SymbolLookup(params: {
  projectId: string;
  tokens: string[];
  kindFilter: ChunkKind[] | null;
  pool: ReturnType<typeof getDbPool>;
}): Promise<Map<string, { tier: SearchTier; symbols: string[]; sample_lines: string[] }>> {
  const result = new Map<string, { tier: SearchTier; symbols: string[]; sample_lines: string[] }>();
  if (!params.tokens.length) return result;

  const likePatterns = params.tokens
    .filter(t => t.length >= 3).slice(0, 8)
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
    const entry = result.get(fp) ?? { tier: 'symbol_match' as SearchTier, symbols: [], sample_lines: [] };
    if (row.symbol_name) entry.symbols.push(String(row.symbol_name));
    if (row.sample && entry.sample_lines.length < 3) entry.sample_lines.push(String(row.sample).trim().slice(0, 120));
    result.set(fp, entry);
  }

  logger.info({ tokens: params.tokens.slice(0, 5), files_found: result.size }, 'tier2:symbol_lookup');
  return result;
}

// ─── Tier 3: FTS + Path Match ───────────────────────────────────────────

async function tier3FtsPath(params: {
  projectId: string;
  tokens: string[];
  kindFilter: ChunkKind[] | null;
  pool: ReturnType<typeof getDbPool>;
  limit: number;
  ftsMode?: 'or' | 'and';
}): Promise<Map<string, { tier: SearchTier; fts_rank: number; sample_lines: string[] }>> {
  const result = new Map<string, { tier: SearchTier; fts_rank: number; sample_lines: string[] }>();

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
    if (result.has(fp)) continue;
    result.set(fp, {
      tier: 'fts_match',
      fts_rank: Number(row.rank),
      sample_lines: [String(row.sample ?? '').trim().slice(0, 120)],
    });
  }

  // Also match file paths directly.
  const pathTokens = params.tokens.filter(t => t.length >= 3).slice(0, 6)
    .map(t => `%${t.replace(/[%_\\]/g, '\\$&')}%`);

  if (pathTokens.length) {
    const pathParams: any[] = [params.projectId, pathTokens];
    let pathKindWhere = '';
    if (params.kindFilter?.length) {
      pathParams.push(params.kindFilter);
      pathKindWhere = ` AND chunk_kind = ANY($${pathParams.length}::text[])`;
    }

    const pathRes = await params.pool.query(
      `SELECT DISTINCT file_path, chunk_kind FROM chunks
       WHERE project_id = $1 AND file_path ILIKE ANY($2::text[]) ${pathKindWhere} LIMIT 50;`,
      pathParams,
    );

    for (const row of (pathRes.rows ?? []) as any[]) {
      const fp = String(row.file_path);
      if (!result.has(fp)) result.set(fp, { tier: 'fts_match', fts_rank: 0.01, sample_lines: [] });
    }
  }

  logger.info({ tsquery, files_found: result.size }, 'tier3:fts_path');
  return result;
}

// ─── Tier 4: Semantic Vector Search ─────────────────────────────────────

async function tier4Semantic(params: {
  projectId: string;
  query: string;
  kindFilter: ChunkKind[] | null;
  pool: ReturnType<typeof getDbPool>;
  limit: number;
}): Promise<Map<string, { tier: SearchTier; score: number; symbols: string[]; sample_lines: string[] }>> {
  const result = new Map<string, { tier: SearchTier; score: number; symbols: string[]; sample_lines: string[] }>();

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
    } else if (existing && row.symbol_name && !existing.symbols.includes(String(row.symbol_name))) {
      existing.symbols.push(String(row.symbol_name));
    }
  }

  logger.info({ files_found: result.size }, 'tier4:semantic');
  return result;
}

// ═══════════════════════════════════════════════════════════════════════════
// WORKSPACE ROOT + KIND RESOLUTION (shared utilities)
// ═══════════════════════════════════════════════════════════════════════════

const rootCache = new Map<string, { root: string | null; ts: number }>();
const ROOT_CACHE_TTL_MS = 5 * 60 * 1000;

function isValidRoot(root: string): boolean {
  const normalized = pathNormalize(root).replace(/\\/g, '/');
  if (normalized.includes('/../') || normalized.startsWith('../') || normalized === '..') {
    logger.warn({ root }, 'workspace root rejected: path traversal detected');
    return false;
  }
  if (/^\/(etc|proc|sys|dev|boot|root)\b/.test(normalized)) {
    logger.warn({ root }, 'workspace root rejected: system directory');
    return false;
  }
  return true;
}

async function resolveWorkspaceRoot(projectId: string, pool: ReturnType<typeof getDbPool>): Promise<string | null> {
  const cached = rootCache.get(projectId);
  if (cached && Date.now() - cached.ts < ROOT_CACHE_TTL_MS) return cached.root;

  let root: string | null = null;
  try {
    const ws = await pool.query(`SELECT root_path FROM project_workspaces WHERE project_id = $1 LIMIT 1;`, [projectId]);
    if (ws.rows?.[0]?.root_path) root = String(ws.rows[0].root_path);
  } catch { /* table may not exist */ }

  if (!root) {
    try {
      const ch = await pool.query(`SELECT DISTINCT root FROM chunks WHERE project_id = $1 LIMIT 1;`, [projectId]);
      if (ch.rows?.[0]?.root) root = String(ch.rows[0].root);
    } catch { /* ignore */ }
  }

  if (root && !isValidRoot(root)) root = null;
  rootCache.set(projectId, { root, ts: Date.now() });
  return root;
}

async function resolveFileKind(
  projectId: string, filePaths: string[], pool: ReturnType<typeof getDbPool>,
): Promise<Map<string, ChunkKind>> {
  const result = new Map<string, ChunkKind>();
  if (!filePaths.length) return result;
  try {
    const res = await pool.query(
      `SELECT DISTINCT ON (file_path) file_path, chunk_kind FROM chunks
       WHERE project_id = $1 AND file_path = ANY($2::text[]) ORDER BY file_path;`,
      [projectId, filePaths],
    );
    for (const row of (res.rows ?? []) as any[]) {
      result.set(String(row.file_path), (row.chunk_kind ?? 'source') as ChunkKind);
    }
  } catch { /* best-effort */ }
  return result;
}

// ═══════════════════════════════════════════════════════════════════════════
// SHARED MERGE + SORT HELPERS
// ═══════════════════════════════════════════════════════════════════════════

type TierResults = {
  t1: Map<string, { tier: SearchTier; sample_lines: string[]; hit_count: number }>;
  t2: Map<string, { tier: SearchTier; symbols: string[]; sample_lines: string[] }>;
  t3: Map<string, { tier: SearchTier; fts_rank: number; sample_lines: string[] }>;
  t4: Map<string, { tier: SearchTier; score: number; symbols: string[]; sample_lines: string[] }>;
  /** Convention-based matches (relationship profile only). */
  tConvention: Map<string, { tier: SearchTier; sample_lines: string[] }>;
};

function mergeTierResults(
  tiers: TierResults,
  ctx: ProfileContext,
  tokens: string[],
  tierPriority: Record<SearchTier, number>,
  scoring: {
    ripgrepWeight?: number;
    symbolWeight?: number;
    ftsWeight?: number;
    semanticWeight?: number;
    conventionWeight?: number;
  },
  /** DB-resolved kinds for files not in DB tier results (e.g., ripgrep-only). */
  kindOverrides?: Map<string, ChunkKind>,
): FileCandidate[] {
  const { t1, t2, t3, t4, tConvention } = tiers;

  const allPaths = new Set([
    ...tConvention.keys(), ...t1.keys(), ...t2.keys(), ...t3.keys(), ...t4.keys(),
  ]);

  const candidates: FileCandidate[] = [];
  for (const path of allPaths) {
    const c = tConvention.get(path);
    const r1 = t1.get(path);
    const r2 = t2.get(path);
    const r3 = t3.get(path);
    const r4 = t4.get(path);

    // Best tier.
    let bestTier: SearchTier = 'semantic';
    let bestPriority = 0;
    for (const [tier, data] of [
      ['convention_match', c], ['exact_match', r1], ['symbol_match', r2], ['fts_match', r3], ['semantic', r4],
    ] as [SearchTier, unknown][]) {
      if (data && (tierPriority[tier] ?? 0) > bestPriority) {
        bestTier = tier;
        bestPriority = tierPriority[tier] ?? 0;
      }
    }

    // Composite score.
    let score = 0;
    if (c) score += scoring.conventionWeight ?? 1.0;
    if (r1) score += (scoring.ripgrepWeight ?? 0.5) + (tokens.length > 0 ? (r1.hit_count / tokens.length) : 1) * 0.5;
    if (r2) score += scoring.symbolWeight ?? 0.4;
    if (r3) score += (scoring.ftsWeight ?? 0.1) + Math.min(0.3, r3.fts_rank);
    if (r4) score += r4.score * (scoring.semanticWeight ?? 0.3);
    score = Math.min(1, score);

    // Symbols.
    const symbols: string[] = [];
    if (r2?.symbols) symbols.push(...r2.symbols);
    if (r4?.symbols) symbols.push(...r4.symbols);

    // Sample lines.
    const sampleLines: string[] = [];
    if (c?.sample_lines?.length) sampleLines.push(...c.sample_lines);
    if (r1?.sample_lines?.length && sampleLines.length < 3) sampleLines.push(...r1.sample_lines);
    if (r2?.sample_lines?.length && sampleLines.length < 3) sampleLines.push(...r2.sample_lines);
    if (r3?.sample_lines?.length && sampleLines.length < 3) sampleLines.push(...r3.sample_lines);
    if (r4?.sample_lines?.length && sampleLines.length < 3) sampleLines.push(...r4.sample_lines);

    // Kind: prefer DB-stored kind, fall back to path-based classifier.
    const kind: ChunkKind = kindOverrides?.get(path) ?? detectLanguage(path).kind;
    if (ctx.kindFilter && !ctx.kindFilter.includes(kind)) continue;
    if (!ctx.includeTests && kind === 'test') continue;

    candidates.push({
      path, tier: bestTier, kind, score,
      symbols: Array.from(new Set(symbols)).slice(0, 10),
      sample_lines: sampleLines.slice(0, 3),
    });
  }

  candidates.sort((a, b) => {
    const ta = tierPriority[a.tier] ?? 0;
    const tb = tierPriority[b.tier] ?? 0;
    if (ta !== tb) return tb - ta;
    return b.score - a.score;
  });

  return candidates;
}

/** Wrap a tier call with .catch that pushes to warnings. */
function tierWithCatch<T>(
  tierPromise: Promise<T>,
  tierName: string,
  tiersExecuted: SearchTier[],
  tiersSkipped: SearchTier[],
  warnings: string[],
  executedTier: SearchTier,
  emptyValue: T,
): Promise<T> {
  return tierPromise
    .then(r => { tiersExecuted.push(executedTier); return r; })
    .catch(err => {
      warnings.push(`${tierName} failed: ${err instanceof Error ? err.message : String(err)}`);
      tiersSkipped.push(executedTier);
      return emptyValue;
    });
}

// ═══════════════════════════════════════════════════════════════════════════
// PROFILE 1: CODE-SEARCH (existing behavior, extracted)
// ═══════════════════════════════════════════════════════════════════════════

async function executeCodeSearch(ctx: ProfileContext): Promise<ProfileResult> {
  const tiersExecuted: SearchTier[] = [];
  const tiersSkipped: SearchTier[] = [];
  const explanations: string[] = [];
  const warnings: string[] = [];
  const empty1 = new Map() as Awaited<ReturnType<typeof tier1Ripgrep>>;
  const empty2 = new Map() as Awaited<ReturnType<typeof tier2SymbolLookup>>;
  const empty3 = new Map() as Awaited<ReturnType<typeof tier3FtsPath>>;

  const [t1, t2, t3] = await Promise.all([
    (ctx.classification !== 'natural_language' && ctx.root && ctx.tokens.length > 0)
      ? tierWithCatch(tier1Ripgrep({ root: ctx.root, tokens: ctx.tokens, kindFilter: ctx.kindFilter, maxFiles: ctx.maxFiles }),
          'tier1_ripgrep', tiersExecuted, tiersSkipped, warnings, 'exact_match', empty1)
      : Promise.resolve((() => {
          tiersSkipped.push('exact_match');
          if (!ctx.root && ctx.classification !== 'natural_language' && ctx.tokens.length > 0)
            warnings.push('tier1_ripgrep skipped: workspace root not found');
          return empty1;
        })()),

    ctx.tokens.length > 0
      ? tierWithCatch(tier2SymbolLookup({ projectId: ctx.projectId, tokens: ctx.tokens, kindFilter: ctx.kindFilter, pool: ctx.pool }),
          'tier2_symbol', tiersExecuted, tiersSkipped, warnings, 'symbol_match', empty2)
      : Promise.resolve((() => { tiersSkipped.push('symbol_match'); return empty2; })()),

    tierWithCatch(tier3FtsPath({
      projectId: ctx.projectId, tokens: ctx.tokens, kindFilter: ctx.kindFilter, pool: ctx.pool,
      limit: ctx.maxFiles, ftsMode: (ctx.classification === 'identifier' || ctx.classification === 'path') ? 'and' : 'or',
    }), 'tier3_fts', tiersExecuted, tiersSkipped, warnings, 'fts_match', empty3),
  ]);

  const deterministicCount = new Set([...t1.keys(), ...t2.keys(), ...t3.keys()]).size;
  let t4 = new Map() as Awaited<ReturnType<typeof tier4Semantic>>;
  if (deterministicCount < ctx.semanticThreshold || ctx.classification === 'natural_language') {
    try {
      t4 = await tier4Semantic({ projectId: ctx.projectId, query: ctx.query, kindFilter: ctx.kindFilter, pool: ctx.pool, limit: ctx.maxFiles });
      tiersExecuted.push('semantic');
    } catch (err) {
      warnings.push(`tier4_semantic failed: ${err instanceof Error ? err.message : String(err)}`);
      tiersSkipped.push('semantic');
    }
  } else {
    tiersSkipped.push('semantic');
    explanations.push(`semantic skipped: ${deterministicCount} deterministic files >= threshold ${ctx.semanticThreshold}`);
  }

  // Resolve DB-stored kinds for ripgrep-only files (not in DB tier results).
  const rgOnly = Array.from(t1.keys()).filter(p => !t2.has(p) && !t3.has(p) && !t4.has(p));
  const kindMap = await resolveFileKind(ctx.projectId, rgOnly, ctx.pool);

  const tierPriority: Record<SearchTier, number> = {
    convention_match: 5, exact_match: 4, symbol_match: 3, fts_match: 2, semantic: 1,
  };

  const tiers: TierResults = { t1, t2, t3, t4, tConvention: new Map() };
  const candidates = mergeTierResults(tiers, ctx, ctx.tokens, tierPriority, {
    ripgrepWeight: 0.5, symbolWeight: 0.4, ftsWeight: 0.1, semanticWeight: 0.3,
  }, kindMap);

  return { candidates, tiersExecuted, tiersSkipped, explanations, warnings };
}

// ═══════════════════════════════════════════════════════════════════════════
// PROFILE 2: RELATIONSHIP (test file discovery)
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Generate convention-based test file path patterns from source file paths.
 * Given source paths found by symbol lookup, infer where tests would live.
 */
function generateTestPathPatterns(sourcePaths: string[]): string[] {
  const patterns: string[] = [];

  for (const src of sourcePaths.slice(0, 10)) {
    const normalized = src.replace(/\\/g, '/');
    // Extract directory and base name without extension.
    const lastSlash = normalized.lastIndexOf('/');
    const dir = lastSlash >= 0 ? normalized.slice(0, lastSlash) : '';
    const fileName = lastSlash >= 0 ? normalized.slice(lastSlash + 1) : normalized;
    const dotIdx = fileName.lastIndexOf('.');
    const baseName = dotIdx > 0 ? fileName.slice(0, dotIdx) : fileName;
    const ext = dotIdx > 0 ? fileName.slice(dotIdx) : '';

    // Language-specific test conventions.
    if (ext === '.go') {
      // Go: auth.go → auth_test.go (same directory)
      patterns.push(`%${baseName}_test.go`);
    } else if (ext === '.py') {
      // Python: auth.py → test_auth.py, auth_test.py
      patterns.push(`%test_${baseName}.py`);
      patterns.push(`%${baseName}_test.py`);
    } else if (ext === '.java' || ext === '.kt' || ext === '.scala') {
      // Java/Kotlin: Auth.java → AuthTest.java, AuthSpec.java
      patterns.push(`%${baseName}Test${ext}`);
      patterns.push(`%${baseName}Spec${ext}`);
    } else if (ext === '.rb') {
      // Ruby: auth.rb → auth_spec.rb, auth_test.rb
      patterns.push(`%${baseName}_spec.rb`);
      patterns.push(`%${baseName}_test.rb`);
    } else {
      // JS/TS and others: auth.ts → auth.test.ts, auth.spec.ts
      patterns.push(`%${baseName}.test${ext}`);
      patterns.push(`%${baseName}.spec${ext}`);
    }

    // Common test directory patterns (all languages).
    if (dir) {
      patterns.push(`%__tests__/${baseName}%`);
      // Mirror source path under tests/ or test/ directory.
      // e.g., src/services/auth.ts → tests/services/auth.test.ts
      const dirParts = dir.split('/');
      const subPath = dirParts.slice(1).join('/');
      if (subPath) {
        patterns.push(`%tests/${subPath}/${baseName}%`);
        patterns.push(`%test/${subPath}/${baseName}%`);
      }
    }
  }

  return Array.from(new Set(patterns)).slice(0, 30);
}

/**
 * Convention-based test path discovery — find test files by path convention.
 * Accepts pre-resolved source paths to avoid duplicate symbol lookups.
 */
async function tierConventionMatch(params: {
  projectId: string;
  tokens: string[];
  /** Pre-resolved source file paths (from shared symbol lookup). Empty = use token-based fallback. */
  sourcePaths: string[];
  pool: ReturnType<typeof getDbPool>;
}): Promise<Map<string, { tier: SearchTier; sample_lines: string[] }>> {
  const result = new Map<string, { tier: SearchTier; sample_lines: string[] }>();

  if (!params.sourcePaths.length) {
    // No source files found — try path-based patterns from tokens directly.
    const directPatterns = params.tokens.slice(0, 5).flatMap(t => [
      `%${t}.test.%`, `%${t}.spec.%`, `%${t}_test.%`, `%test_${t}.%`, `%${t}Test.%`,
    ]);
    if (directPatterns.length) {
      const res = await params.pool.query(
        `SELECT DISTINCT file_path, substring(content, 1, 200) AS sample FROM chunks
         WHERE project_id = $1 AND chunk_kind = 'test' AND file_path ILIKE ANY($2::text[]) LIMIT 50;`,
        [params.projectId, directPatterns],
      );
      for (const row of (res.rows ?? []) as any[]) {
        result.set(String(row.file_path), {
          tier: 'convention_match',
          sample_lines: row.sample ? [String(row.sample).trim().slice(0, 120)] : [],
        });
      }
    }
    logger.info({ files_found: result.size, source: 'direct_patterns' }, 'tier_convention:match');
    return result;
  }

  // Generate test path patterns from source paths.
  const testPatterns = generateTestPathPatterns(params.sourcePaths);
  if (!testPatterns.length) return result;

  const res = await params.pool.query(
    `SELECT DISTINCT file_path, substring(content, 1, 200) AS sample FROM chunks
     WHERE project_id = $1 AND chunk_kind = 'test' AND file_path ILIKE ANY($2::text[]) LIMIT 50;`,
    [params.projectId, testPatterns],
  );

  for (const row of (res.rows ?? []) as any[]) {
    result.set(String(row.file_path), {
      tier: 'convention_match',
      sample_lines: row.sample ? [String(row.sample).trim().slice(0, 120)] : [],
    });
  }

  logger.info({ files_found: result.size, source_files: params.sourcePaths.length, patterns: testPatterns.length }, 'tier_convention:match');
  return result;
}

/**
 * KG-based test discovery — find test files that import/call the target symbol.
 */
async function tierKgTestDiscovery(params: {
  projectId: string;
  tokens: string[];
}): Promise<Map<string, { tier: SearchTier; symbols: string[]; sample_lines: string[] }>> {
  const result = new Map<string, { tier: SearchTier; symbols: string[]; sample_lines: string[] }>();
  const env = getEnv();
  if (!env.KG_ENABLED) return result;

  try {
    // Step 1: Find symbols matching all tokens in parallel.
    const symbolResults = await Promise.all(
      params.tokens.slice(0, 3).map(t =>
        searchSymbols({ projectId: params.projectId, query: t, limit: 5 })
      ),
    );
    const allSymbols = symbolResults.flatMap(r => r.matches).slice(0, 6);
    if (!allSymbols.length) return result;

    // Step 2: Get neighbors for all symbols in parallel.
    const neighborResults = await Promise.all(
      allSymbols.map(sym =>
        getSymbolNeighbors({ projectId: params.projectId, symbolId: sym.symbol_id, depth: 2, limit: 30 })
          .then(r => ({ sym, neighbors: r.neighbors }))
      ),
    );

    // Step 3: Filter to test files.
    for (const { sym, neighbors } of neighborResults) {
      for (const neighbor of neighbors) {
        if (neighbor.file_path && detectLanguage(neighbor.file_path).isTest) {
          const entry = result.get(neighbor.file_path) ?? {
            tier: 'symbol_match' as SearchTier, symbols: [], sample_lines: [],
          };
          if (!entry.symbols.includes(sym.name)) entry.symbols.push(sym.name);
          result.set(neighbor.file_path, entry);
        }
      }
    }

    logger.info({ files_found: result.size, symbols_checked: allSymbols.length }, 'tier_kg:test_discovery');
  } catch (err) {
    logger.warn({ error: err instanceof Error ? err.message : String(err) }, 'tier_kg:test_discovery:error');
  }

  return result;
}

async function executeRelationship(ctx: ProfileContext): Promise<ProfileResult> {
  const tiersExecuted: SearchTier[] = [];
  const tiersSkipped: SearchTier[] = [];
  const explanations: string[] = [];
  const warnings: string[] = [];

  explanations.push('profile=relationship: convention paths → KG imports → filtered ripgrep → semantic');

  // Force kind filter to test and enable test inclusion.
  const testKindFilter: ChunkKind[] = ['test'];

  // ── Step 1: Shared symbol lookup (used by both convention match and as context) ──
  let sourcePaths: string[] = [];
  if (ctx.tokens.length > 0) {
    try {
      const symbolResult = await tier2SymbolLookup({
        projectId: ctx.projectId, tokens: ctx.tokens, kindFilter: null, pool: ctx.pool,
      });
      sourcePaths = Array.from(symbolResult.keys()).filter(p => !detectLanguage(p).isTest);
    } catch { /* best-effort — convention match falls back to direct patterns */ }
  }

  // ── Step 2: Convention match + KG + ripgrep in parallel ──
  const [tConvention, tKg, t1Raw] = await Promise.all([
    // Convention-based test path inference (uses shared sourcePaths).
    ctx.tokens.length > 0
      ? tierWithCatch(
          tierConventionMatch({ projectId: ctx.projectId, tokens: ctx.tokens, sourcePaths, pool: ctx.pool }),
          'tier_convention', tiersExecuted, tiersSkipped, warnings, 'convention_match',
          new Map() as Awaited<ReturnType<typeof tierConventionMatch>>)
      : Promise.resolve((() => { tiersSkipped.push('convention_match'); return new Map() as Awaited<ReturnType<typeof tierConventionMatch>>; })()),

    // KG import graph (optional).
    ctx.tokens.length > 0
      ? tierKgTestDiscovery({ projectId: ctx.projectId, tokens: ctx.tokens })
          .then(r => { if (r.size > 0) tiersExecuted.push('symbol_match'); return r; })
      : Promise.resolve(new Map() as Awaited<ReturnType<typeof tierKgTestDiscovery>>),

    // Ripgrep — search all files, we'll filter to test files after.
    (ctx.classification !== 'natural_language' && ctx.root && ctx.tokens.length > 0)
      ? tierWithCatch(tier1Ripgrep({ root: ctx.root, tokens: ctx.tokens, kindFilter: null, maxFiles: ctx.maxFiles }),
          'tier1_ripgrep', tiersExecuted, tiersSkipped, warnings, 'exact_match',
          new Map() as Awaited<ReturnType<typeof tier1Ripgrep>>)
      : Promise.resolve((() => { tiersSkipped.push('exact_match'); return new Map() as Awaited<ReturnType<typeof tier1Ripgrep>>; })()),
  ]);

  // Filter ripgrep results to test files only.
  const t1Filtered = new Map<string, { tier: SearchTier; sample_lines: string[]; hit_count: number }>();
  for (const [path, data] of t1Raw) {
    if (detectLanguage(path).isTest) t1Filtered.set(path, data);
  }

  // Merge KG results into t2 slot.
  const t2 = tKg;

  // Count deterministic results.
  const deterministicCount = new Set([...tConvention.keys(), ...t1Filtered.keys(), ...t2.keys()]).size;

  // Semantic fallback (only if we found too few).
  let t4 = new Map() as Awaited<ReturnType<typeof tier4Semantic>>;
  if (deterministicCount < ctx.semanticThreshold) {
    try {
      t4 = await tier4Semantic({
        projectId: ctx.projectId, query: ctx.query, kindFilter: testKindFilter, pool: ctx.pool, limit: ctx.maxFiles,
      });
      tiersExecuted.push('semantic');
    } catch (err) {
      warnings.push(`tier4_semantic failed: ${err instanceof Error ? err.message : String(err)}`);
      tiersSkipped.push('semantic');
    }
  } else {
    tiersSkipped.push('semantic');
    explanations.push(`semantic skipped: ${deterministicCount} deterministic test files found`);
  }

  const tierPriority: Record<SearchTier, number> = {
    convention_match: 5, exact_match: 4, symbol_match: 3, fts_match: 2, semantic: 1,
  };

  // Override ctx to include tests.
  const testCtx: ProfileContext = { ...ctx, includeTests: true, kindFilter: testKindFilter };
  const tiers: TierResults = { t1: t1Filtered, t2, t3: new Map(), t4, tConvention };
  const candidates = mergeTierResults(tiers, testCtx, ctx.tokens, tierPriority, {
    conventionWeight: 1.0, ripgrepWeight: 0.3, symbolWeight: 0.8, ftsWeight: 0.1, semanticWeight: 0.3,
  });

  return { candidates, tiersExecuted, tiersSkipped, explanations, warnings };
}

// ═══════════════════════════════════════════════════════════════════════════
// PROFILE 3: SEMANTIC-FIRST (doc/script search)
// ═══════════════════════════════════════════════════════════════════════════

async function executeSemanticFirst(ctx: ProfileContext): Promise<ProfileResult> {
  const tiersExecuted: SearchTier[] = [];
  const tiersSkipped: SearchTier[] = [];
  const explanations: string[] = [];
  const warnings: string[] = [];

  explanations.push('profile=semantic-first: semantic + FTS parallel → ripgrep conditional');

  // ── Semantic + FTS in parallel (both always run) ──
  const [t4, t3] = await Promise.all([
    // Semantic — always run, not conditional.
    tierWithCatch(
      tier4Semantic({ projectId: ctx.projectId, query: ctx.query, kindFilter: ctx.kindFilter, pool: ctx.pool, limit: ctx.maxFiles }),
      'tier4_semantic', tiersExecuted, tiersSkipped, warnings, 'semantic',
      new Map() as Awaited<ReturnType<typeof tier4Semantic>>),

    // FTS — always OR mode for natural language doc queries.
    tierWithCatch(
      tier3FtsPath({ projectId: ctx.projectId, tokens: ctx.tokens, kindFilter: ctx.kindFilter, pool: ctx.pool, limit: ctx.maxFiles, ftsMode: 'or' }),
      'tier3_fts', tiersExecuted, tiersSkipped, warnings, 'fts_match',
      new Map() as Awaited<ReturnType<typeof tier3FtsPath>>),
  ]);

  // ── Ripgrep — only if query contains identifiers ──
  let t1 = new Map() as Awaited<ReturnType<typeof tier1Ripgrep>>;
  if ((ctx.classification === 'identifier' || ctx.classification === 'mixed') && ctx.root && ctx.tokens.length > 0) {
    t1 = await tierWithCatch(
      tier1Ripgrep({ root: ctx.root, tokens: ctx.tokens, kindFilter: ctx.kindFilter, maxFiles: ctx.maxFiles }),
      'tier1_ripgrep', tiersExecuted, tiersSkipped, warnings, 'exact_match',
      new Map() as Awaited<ReturnType<typeof tier1Ripgrep>>);
  } else {
    tiersSkipped.push('exact_match');
  }

  // Symbol lookup — skip for docs (they don't have symbols).
  tiersSkipped.push('symbol_match');

  // Reversed tier priority: semantic is highest for docs.
  const tierPriority: Record<SearchTier, number> = {
    convention_match: 1, exact_match: 2, symbol_match: 1, fts_match: 3, semantic: 4,
  };

  const tiers: TierResults = { t1, t2: new Map(), t3, t4, tConvention: new Map() };
  const candidates = mergeTierResults(tiers, ctx, ctx.tokens, tierPriority, {
    ripgrepWeight: 0.15, symbolWeight: 0, ftsWeight: 0.1, semanticWeight: 1.0, conventionWeight: 0,
  });

  return { candidates, tiersExecuted, tiersSkipped, explanations, warnings };
}

// ═══════════════════════════════════════════════════════════════════════════
// MAIN PIPELINE DISPATCHER
// ═══════════════════════════════════════════════════════════════════════════

export async function tieredSearch(params: TieredSearchParams): Promise<TieredSearchResult> {
  const startMs = Date.now();
  const pool = getDbPool();
  const env = getEnv();
  const maxFiles = params.maxFiles ?? 50;
  const semanticThreshold = params.semanticThreshold ?? 3;

  const kindFilter = params.kind
    ? (Array.isArray(params.kind) ? params.kind : [params.kind])
    : null;
  const profile = selectProfile(kindFilter);
  const includeTests = params.includeTests || (kindFilter?.includes('test') ?? false);

  // ── Redis cache check ──
  const cacheVersion = await getProjectCacheVersion(params.projectId).catch(() => 1);
  const kindKey = params.kind
    ? (Array.isArray(params.kind) ? [...params.kind].sort().join(',') : params.kind)
    : 'all';
  const includeTestsKey = includeTests ? '1' : '0';
  const cacheHash = createHash('md5')
    .update(`${params.query}|${kindKey}|${maxFiles}|${semanticThreshold}|${includeTestsKey}|${profile}`)
    .digest('hex').slice(0, 12);
  const redisCacheKey = redisKey(['tiered', params.projectId, String(cacheVersion), cacheHash]);

  const cached = await redisGetJson<TieredSearchResult>(redisCacheKey).catch(() => null);
  if (cached && Array.isArray(cached.files)) {
    logger.info({ cache: 'hit', key: redisCacheKey, files: cached.files.length, profile }, 'tiered_search:cache_hit');
    return cached;
  }

  // ── Shared context ──
  const classification = classifyQuery(params.query);
  const tokens = extractIdentifiers(params.query);
  const root = await resolveWorkspaceRoot(params.projectId, pool);

  const ctx: ProfileContext = {
    projectId: params.projectId,
    query: params.query,
    classification,
    tokens,
    kindFilter,
    includeTests,
    maxFiles,
    semanticThreshold,
    root,
    pool,
    debug: params.debug ?? false,
  };

  logger.info({
    project_id: ctx.projectId, query: ctx.query, profile, classification,
    tokens: tokens.slice(0, 8), kind_filter: kindFilter, max_files: maxFiles,
  }, 'tiered_search:start');

  // ── Dispatch to profile ──
  let profileResult: ProfileResult;
  switch (profile) {
    case 'relationship':
      profileResult = await executeRelationship(ctx);
      break;
    case 'semantic-first':
      profileResult = await executeSemanticFirst(ctx);
      break;
    case 'code-search':
    default:
      profileResult = await executeCodeSearch(ctx);
      break;
  }

  const { candidates, tiersExecuted, tiersSkipped, explanations, warnings } = profileResult;
  const totalFiles = candidates.length;
  const files = candidates.slice(0, maxFiles);

  // ── Logging ──
  const totalMs = Date.now() - startMs;
  logger.info({
    project_id: ctx.projectId, query: ctx.query, profile, classification,
    total_ms: totalMs, tiers_executed: tiersExecuted, tiers_skipped: tiersSkipped,
    total_files: totalFiles, returned_files: files.length,
    by_tier: Object.fromEntries(
      (['convention_match', 'exact_match', 'symbol_match', 'fts_match', 'semantic'] as const)
        .map(t => [t, files.filter(f => f.tier === t).length]).filter(([, c]) => (c as number) > 0)),
  }, 'tiered_search:done');

  if (params.debug) {
    explanations.push(`profile=${profile}`, `classification=${classification}`);
    explanations.push(`tokens=[${tokens.join(', ')}]`);
    explanations.push(`workspace_root=${root ?? 'none'}`);
    explanations.push(`total_files=${totalFiles} returned=${files.length} total_ms=${totalMs}`);
  }

  const result: TieredSearchResult = {
    files, total_files: totalFiles,
    tiers_executed: tiersExecuted, tiers_skipped: tiersSkipped,
    query_classification: classification, search_profile: profile,
    explanations, warnings,
  };

  if (!warnings.length) {
    await redisSetJson(redisCacheKey, result, env.REDIS_RETRIEVAL_TTL_SECONDS).catch(() => {});
  }

  return result;
}
