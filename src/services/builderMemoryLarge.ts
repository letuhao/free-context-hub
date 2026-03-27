import fs from 'node:fs/promises';
import path from 'node:path';

import fg from 'fast-glob';

import { getDbPool } from '../db/client.js';
import { getEnv } from '../env.js';
import { upsertGeneratedDocument } from './generatedDocs.js';
import { builderChatCompletion } from './builderMemory.js';
import { loadIgnorePatternsFromRoot } from '../utils/ignore.js';
import { createModuleLogger } from '../utils/logger.js';

const logger = createModuleLogger('builderMemoryLarge');

/** Indexed for retrieval via `indexProject` → generated docs chunks. */
export type BuilderMemoryTier = 'manifest' | 'leaf' | 'module' | 'global';

export type BuilderMemoryKind =
  | 'builder_memory_manifest'
  | 'builder_memory_leaf'
  | 'builder_memory_module'
  | 'builder_memory_global';

export type ManifestEntry = {
  path: string;
  size: number;
  /** Exact for small files; omitted when estimated from size. */
  lines?: number;
};

export type RepoManifest = {
  root: string;
  files: ManifestEntry[];
  totalBytes: number;
  totalLines: number;
};

export type CodeShard = {
  shardIndex: number;
  /** Human-readable id: top-level dir, language bucket, or merged label. */
  shardId: string;
  files: string[];
};

const CODE_GLOB = '**/*.{ts,tsx,js,jsx,mjs,cjs,md,json,yml,yaml}';

function defaultIgnores(root: string): string[] {
  return ['**/node_modules/**', '**/dist/**', '**/.git/**', '**/build/**', '**/.next/**'];
}

/** ~avg chars per line for heuristic LOC from file size (fast path). */
const CHARS_PER_LINE_EST = 45;

export async function estimateRepoLinesByHeuristic(root: string): Promise<number> {
  const resolved = path.resolve(root);
  const ignore = [...(await loadIgnorePatternsFromRoot(resolved)), ...defaultIgnores(resolved)];
  const rels = await fg(CODE_GLOB, { cwd: resolved, onlyFiles: true, ignore, dot: true });
  let total = 0;
  for (const rel of rels) {
    try {
      const fp = path.join(resolved, rel);
      const st = await fs.stat(fp);
      if (st.size <= 0 || st.size > 2_000_000) continue;
      total += Math.max(1, Math.floor(st.size / CHARS_PER_LINE_EST));
    } catch {
      /* skip */
    }
  }
  return total;
}

async function countLinesInFile(fp: string, maxBytes: number): Promise<number> {
  const buf = await fs.readFile(fp);
  if (buf.length > maxBytes) return Math.max(1, Math.floor(buf.length / CHARS_PER_LINE_EST));
  let n = 0;
  for (let i = 0; i < buf.length; i++) if (buf[i] === 10) n++;
  return Math.max(1, n);
}

export async function scanRepoManifest(root: string): Promise<RepoManifest> {
  const resolved = path.resolve(root);
  const ignore = [...(await loadIgnorePatternsFromRoot(resolved)), ...defaultIgnores(resolved)];
  const rels = await fg(CODE_GLOB, { cwd: resolved, onlyFiles: true, ignore, dot: true });
  const files: ManifestEntry[] = [];
  let totalBytes = 0;
  let totalLines = 0;
  const maxRead = 512_000;

  for (const rel of rels) {
    try {
      const fp = path.join(resolved, rel);
      const st = await fs.stat(fp);
      if (st.size <= 0 || st.size > 2_000_000) continue;
      totalBytes += st.size;
      let lines: number;
      if (st.size <= maxRead) {
        lines = await countLinesInFile(fp, maxRead);
      } else {
        lines = Math.max(1, Math.floor(st.size / CHARS_PER_LINE_EST));
      }
      totalLines += lines;
      files.push({ path: rel.replaceAll('\\', '/'), size: st.size, lines });
    } catch {
      /* skip */
    }
  }

  files.sort((a, b) => a.path.localeCompare(b.path));
  return { root: resolved, files, totalBytes, totalLines };
}

function languageBucket(p: string): string {
  const lower = p.toLowerCase();
  if (/\.(ts|tsx)$/.test(lower)) return 'typescript';
  if (/\.(js|jsx|mjs|cjs)$/.test(lower)) return 'javascript';
  if (/\.md$/.test(lower)) return 'markdown';
  if (/\.(yml|yaml)$/.test(lower)) return 'yaml';
  if (/\.json$/.test(lower)) return 'json';
  return 'other';
}

function groupFilesByFirstSegment(files: ManifestEntry[]): Map<string, ManifestEntry[]> {
  const m = new Map<string, ManifestEntry[]>();
  for (const f of files) {
    const seg = f.path.split('/')[0] || '.';
    if (!m.has(seg)) m.set(seg, []);
    m.get(seg)!.push(f);
  }
  return m;
}

function groupFilesByLanguage(files: ManifestEntry[]): Map<string, ManifestEntry[]> {
  const m = new Map<string, ManifestEntry[]>();
  for (const f of files) {
    const b = languageBucket(f.path);
    if (!m.has(b)) m.set(b, []);
    m.get(b)!.push(f);
  }
  return m;
}

function sumLines(entries: ManifestEntry[]): number {
  return entries.reduce((s, e) => s + (e.lines ?? Math.max(1, Math.floor(e.size / CHARS_PER_LINE_EST))), 0);
}

/**
 * Partition manifest into at most `maxShards` shards.
 * - directory: top-level path segment; overflow merged into `__rest__`.
 * - language: extension/language bucket; merge small buckets if needed.
 */
export function partitionIntoShards(
  manifest: RepoManifest,
  strategy: 'directory' | 'language',
  maxShards: number,
): CodeShard[] {
  const maxS = Math.max(1, maxShards);
  let groups: Array<{ id: string; entries: ManifestEntry[] }>;

  if (strategy === 'language') {
    const m = groupFilesByLanguage(manifest.files);
    groups = [...m.entries()].map(([id, entries]) => ({ id, entries }));
  } else {
    const m = groupFilesByFirstSegment(manifest.files);
    groups = [...m.entries()].map(([id, entries]) => ({ id, entries }));
  }

  groups.sort((a, b) => sumLines(b.entries) - sumLines(a.entries));

  if (groups.length <= maxS) {
    return groups.map((g, shardIndex) => ({
      shardIndex,
      shardId: g.id,
      files: g.entries.map(e => e.path),
    }));
  }

  const shards: CodeShard[] = [];
  let i = 0;
  for (; i < maxS - 1 && i < groups.length; i++) {
    const g = groups[i]!;
    shards.push({
      shardIndex: shards.length,
      shardId: g.id,
      files: g.entries.map(e => e.path),
    });
  }
  const restEntries = groups.slice(i).flatMap(g => g.entries);
  shards.push({
    shardIndex: shards.length,
    shardId: '__merged_rest__',
    files: restEntries.map(e => e.path),
  });
  return shards.map((s, idx) => ({ ...s, shardIndex: idx }));
}

function moduleKeyForShard(shardId: string): string {
  const first = shardId.split('/')[0] ?? shardId;
  if (shardId === '__merged_rest__') return '__rest__';
  return first || 'root';
}

async function loadLeafBodiesFromDb(
  projectId: string,
  runId: string,
): Promise<Map<number, { shardId: string; moduleKey: string; text: string; docKey: string }>> {
  const pool = getDbPool();
  const prefix = `phase6/builder_memory/leaf/${runId}/`;
  const res = await pool.query<{ content: string; doc_key: string; metadata: Record<string, unknown> }>(
    `SELECT content, doc_key, metadata FROM generated_documents
     WHERE project_id=$1 AND doc_type='benchmark_artifact' AND doc_key LIKE $2`,
    [projectId, `${prefix}%`],
  );
  const m = new Map<number, { shardId: string; moduleKey: string; text: string; docKey: string }>();
  for (const row of res.rows ?? []) {
    const dk = String(row.doc_key ?? '');
    const match = dk.match(/\/s(\d+)$/);
    if (!match) continue;
    const idx = Number(match[1]);
    const meta = row.metadata ?? {};
    const shardId = String(meta.shard_id ?? '');
    const moduleKey =
      typeof meta.module_key === 'string' && meta.module_key
        ? meta.module_key
        : moduleKeyForShard(shardId);
    m.set(idx, {
      shardId,
      moduleKey,
      text: String(row.content ?? ''),
      docKey: dk,
    });
  }
  return m;
}

async function sampleShardForPrompt(
  root: string,
  relPaths: string[],
  maxFiles: number,
  maxTotalChars: number,
  maxFileChars: number,
): Promise<string> {
  const resolved = path.resolve(root);
  const sorted = [...relPaths].sort();
  let total = 0;
  const parts: string[] = [];
  for (const rel of sorted) {
    if (parts.length >= maxFiles) break;
    const fp = path.join(resolved, rel);
    try {
      const raw = await fs.readFile(fp, 'utf8');
      const slice = raw.length > maxFileChars ? `${raw.slice(0, maxFileChars)}\n…` : raw;
      const block = `--- FILE: ${rel} ---\n${slice}`;
      if (total + block.length > maxTotalChars) break;
      parts.push(block);
      total += block.length;
    } catch {
      /* skip */
    }
  }
  return parts.join('\n\n');
}

async function mergeTextsBatched(
  chunks: string[],
  maxInputChars: number,
  maxOutTokens: number,
  system: string,
  introUser: (batch: string) => string,
): Promise<string | null> {
  let layer = [...chunks].filter(c => c.trim());
  if (layer.length === 0) return null;
  if (layer.length === 1) return layer[0]!.trim();

  while (layer.length > 1) {
    const next: string[] = [];
    for (let i = 0; i < layer.length; i += 6) {
      const batch = layer.slice(i, i + 6);
      let text = batch.map((t, j) => `--- Part ${j + 1} ---\n${t}`).join('\n\n');
      if (text.length > maxInputChars) {
        text = `${text.slice(0, maxInputChars)}\n… [truncated]`;
      }
      const merged = await builderChatCompletion({
        system,
        user: introUser(text),
        maxTokens: maxOutTokens,
      });
      if (!merged) return null;
      next.push(merged);
    }
    layer = next;
  }
  return layer[0] ?? null;
}

export type BuildLargeRepoMemoryInput = {
  projectId: string;
  root: string;
  correlationId?: string;
  sourceJobId?: string;
  /** Defaults to timestamp-based id. */
  runId?: string;
  strategy?: 'directory' | 'language';
  maxShards?: number;
  resumeFromShardIndex?: number;
};

export type BuildLargeRepoMemoryResult = {
  status: 'ok' | 'skipped';
  reason?: string;
  run_id: string;
  manifest_doc_key?: string;
  leaf_doc_keys?: string[];
  module_doc_keys?: string[];
  global_doc_key?: string;
  checkpoint?: { next_shard_index: number; total_shards: number };
};

/**
 * Hierarchical builder memory: manifest → leaf per shard → module merge by first path segment → global rollup.
 * Persists `benchmark_artifact` rows with metadata.tier / metadata.kind for retrieval after `indexProject`.
 */
export async function buildLargeRepoProjectMemory(
  input: BuildLargeRepoMemoryInput,
): Promise<BuildLargeRepoMemoryResult> {
  const env = getEnv();
  if (!env.PHASE6_BUILDER_MEMORY_ENABLED) {
    return { status: 'skipped', reason: 'PHASE6_BUILDER_MEMORY_ENABLED=false', run_id: '' };
  }

  const runId =
    input.runId?.trim() ||
    new Date().toISOString().replace(/[:.]/g, '-');
  const strategy = input.strategy ?? 'directory';
  const maxShards = input.maxShards ?? env.MEMORY_BUILD_MAX_SHARDS;
  const resumeFrom = Math.max(0, Math.trunc(input.resumeFromShardIndex ?? 0));

  const maxFiles = env.MEMORY_BUILD_SHARD_MAX_FILES;
  const maxShardChars = env.MEMORY_BUILD_SHARD_MAX_CHARS;
  const maxFileChars = env.MEMORY_BUILD_SHARD_MAX_FILE_CHARS;
  const modIn = env.MEMORY_BUILD_MODULE_MAX_INPUT_CHARS;
  const globIn = env.MEMORY_BUILD_GLOBAL_MAX_INPUT_CHARS;

  logger.info(
    { project_id: input.projectId, run_id: runId, strategy, max_shards: maxShards, resume_from: resumeFrom },
    'builder_memory_large start',
  );

  const manifest = await scanRepoManifest(input.root);
  const shards = partitionIntoShards(manifest, strategy, maxShards);

  const existingLeaves =
    resumeFrom > 0
      ? await loadLeafBodiesFromDb(input.projectId, runId)
      : new Map<number, { shardId: string; moduleKey: string; text: string; docKey: string }>();

  await upsertGeneratedDocument({
    projectId: input.projectId,
    docType: 'benchmark_artifact',
    docKey: `phase6/builder_memory/manifest/${runId}`,
    title: `Builder memory manifest ${runId}`,
    content: JSON.stringify(
      {
        root: manifest.root,
        total_files: manifest.files.length,
        total_bytes: manifest.totalBytes,
        total_lines: manifest.totalLines,
        strategy,
        max_shards: maxShards,
        shards: shards.map(s => ({ shard_id: s.shardId, file_count: s.files.length })),
      },
      null,
      2,
    ),
    metadata: {
      phase6: true,
      tier: 'manifest' as BuilderMemoryTier,
      kind: 'builder_memory_manifest' as BuilderMemoryKind,
      run_id: runId,
      correlation_id: input.correlationId ?? null,
      status: 'draft',
    },
    sourceJobId: input.sourceJobId,
    correlationId: input.correlationId,
  });

  const leafKeys: string[] = [];
  const leafBodies: Array<{ shardId: string; moduleKey: string; text: string }> = [];

  for (let i = 0; i < shards.length; i++) {
    const sh = shards[i]!;
    if (i < resumeFrom) {
      const ex = existingLeaves.get(i);
      if (ex?.text.trim()) {
        leafKeys.push(ex.docKey);
        leafBodies.push({ shardId: ex.shardId, moduleKey: ex.moduleKey, text: ex.text });
        continue;
      }
      logger.warn({ run_id: runId, shard_index: i }, 'builder_memory_large resume: missing leaf, regenerating');
    }

    if (!sh.files.length) continue;
    const sample = await sampleShardForPrompt(input.root, sh.files, maxFiles, maxShardChars, maxFileChars);
    if (!sample.trim()) continue;

    const leafSystem =
      'You are a senior software engineer summarizing one slice of a large repository. ' +
      'Produce a concise leaf memory: Overview, NotablePaths, DependenciesAndConfig, Risks. ' +
      'Use only paths and symbols suggested by the sample; do not invent APIs. Markdown.';
    const leafUser =
      `Shard: ${sh.shardId} (index ${i})\n\n` +
      `Repository slice sample:\n\n${sample}\n\nWrite the leaf memory document.`;

    const leafText = await builderChatCompletion({
      system: leafSystem,
      user: leafUser,
      maxTokens: env.MEMORY_BUILD_LEAF_MAX_TOKENS,
    });
    if (!leafText) {
      logger.warn({ run_id: runId, shard: sh.shardId }, 'builder_memory_large leaf skipped: no LLM output');
      continue;
    }

    const docKey = `phase6/builder_memory/leaf/${runId}/s${i}`;
    leafKeys.push(docKey);
    const moduleKey = moduleKeyForShard(sh.shardId);
    leafBodies.push({ shardId: sh.shardId, moduleKey, text: leafText });

    await upsertGeneratedDocument({
      projectId: input.projectId,
      docType: 'benchmark_artifact',
      docKey,
      title: `Builder memory leaf ${runId} ${sh.shardId}`,
      content: leafText,
      metadata: {
        phase6: true,
        tier: 'leaf' as BuilderMemoryTier,
        kind: 'builder_memory_leaf' as BuilderMemoryKind,
        run_id: runId,
        shard_id: sh.shardId,
        shard_index: i,
        module_key: moduleKey,
        correlation_id: input.correlationId ?? null,
        status: 'draft',
      },
      sourceJobId: input.sourceJobId,
      correlationId: input.correlationId,
    });
  }

  if (leafBodies.length === 0) {
    return {
      status: 'skipped',
      reason: 'no_leaf_content',
      run_id: runId,
      manifest_doc_key: `phase6/builder_memory/manifest/${runId}`,
      checkpoint: { next_shard_index: shards.length, total_shards: shards.length },
    };
  }

  const byModule = new Map<string, typeof leafBodies>();
  for (const row of leafBodies) {
    if (!byModule.has(row.moduleKey)) byModule.set(row.moduleKey, []);
    byModule.get(row.moduleKey)!.push(row);
  }

  const modSystem =
    'You merge leaf summaries of one module/area of a codebase into a single coherent module memory. ' +
    'Deduplicate; keep concrete paths. Sections: Overview, Components, Entrypoints, Risks. Markdown.';
  const moduleKeys: string[] = [];
  const moduleTexts: string[] = [];
  let mi = 0;
  for (const [mkey, rows] of byModule) {
    const chunks = rows.map(
      r => `### Leaf (${r.shardId})\n${r.text}`,
    );
    const merged = await mergeTextsBatched(
      chunks,
      modIn,
      env.MEMORY_BUILD_MODULE_MAX_TOKENS,
      modSystem,
      batch =>
        `Module area: ${mkey}\n\nMerge the following leaf summaries:\n\n${batch}\n\nWrite the merged module memory.`,
    );
    if (!merged) continue;
    const mk = `phase6/builder_memory/module/${runId}/m${mi}`;
    moduleKeys.push(mk);
    moduleTexts.push(merged);
    await upsertGeneratedDocument({
      projectId: input.projectId,
      docType: 'benchmark_artifact',
      docKey: mk,
      title: `Builder memory module ${runId} ${mkey}`,
      content: merged,
      metadata: {
        phase6: true,
        tier: 'module' as BuilderMemoryTier,
        kind: 'builder_memory_module' as BuilderMemoryKind,
        run_id: runId,
        module_key: mkey,
        correlation_id: input.correlationId ?? null,
        status: 'draft',
      },
      sourceJobId: input.sourceJobId,
      correlationId: input.correlationId,
    });
    mi++;
  }

  const globalSystem =
    'You produce the final project memory for downstream RAG from module-level summaries of a large repo. ' +
    'Sections: Overview, Architecture, KeyEntrypoints, McpAndJobs, Phase6KnowledgeLoop, RisksAndGaps. ' +
    'Use concrete module areas and paths; do not invent APIs. Markdown, no outer code fence.';
  const globalMerged = await mergeTextsBatched(
    moduleTexts,
    globIn,
    env.MEMORY_BUILD_GLOBAL_MAX_TOKENS,
    globalSystem,
    batch =>
      `Module summaries to roll up into global project memory:\n\n${batch}\n\nWrite the global memory document.`,
  );

  let globalKey: string | undefined;
  if (globalMerged) {
    globalKey = `phase6/builder_memory/global/${runId}`;
    await upsertGeneratedDocument({
      projectId: input.projectId,
      docType: 'benchmark_artifact',
      docKey: globalKey,
      title: `Builder memory global ${runId}`,
      content: globalMerged,
      metadata: {
        phase6: true,
        tier: 'global' as BuilderMemoryTier,
        kind: 'builder_memory_global' as BuilderMemoryKind,
        run_id: runId,
        correlation_id: input.correlationId ?? null,
        status: 'draft',
      },
      sourceJobId: input.sourceJobId,
      correlationId: input.correlationId,
    });
  }

  logger.info(
    {
      project_id: input.projectId,
      run_id: runId,
      leaves: leafKeys.length,
      modules: moduleKeys.length,
      global: globalKey ?? null,
    },
    'builder_memory_large done',
  );

  return {
    status: 'ok',
    run_id: runId,
    manifest_doc_key: `phase6/builder_memory/manifest/${runId}`,
    leaf_doc_keys: leafKeys,
    module_doc_keys: moduleKeys,
    global_doc_key: globalKey,
    checkpoint: { next_shard_index: shards.length, total_shards: shards.length },
  };
}

/**
 * Deep loop: use hierarchical memory when explicitly requested or when estimated LOC exceeds threshold.
 */
export async function shouldUseLargeRepoBuilderMemory(input: {
  root: string;
  largeRepoPayload?: boolean;
}): Promise<boolean> {
  const env = getEnv();
  if (input.largeRepoPayload === true) return true;
  if (env.PHASE6_LARGE_REPO_LOC_THRESHOLD <= 0) return false;
  const est = await estimateRepoLinesByHeuristic(input.root);
  return est >= env.PHASE6_LARGE_REPO_LOC_THRESHOLD;
}
