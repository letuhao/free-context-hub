import fs from 'node:fs/promises';
import path from 'node:path';

import fg from 'fast-glob';

import { getEnv, type Env } from '../env.js';
import { upsertGeneratedDocument } from './generatedDocs.js';
import { createModuleLogger } from '../utils/logger.js';

const logger = createModuleLogger('builderMemory');

function builderBaseUrl(): string {
  const env = getEnv();
  return (
    env.BUILDER_AGENT_BASE_URL?.trim() ||
    env.DISTILLATION_BASE_URL?.trim() ||
    env.EMBEDDINGS_BASE_URL
  ).replace(/\/$/, '');
}

function builderHeaders(): Record<string, string> {
  const env = getEnv();
  const headers: Record<string, string> = { 'Content-Type': 'application/json' };
  const key = env.BUILDER_AGENT_API_KEY ?? env.DISTILLATION_API_KEY ?? env.EMBEDDINGS_API_KEY;
  if (key) headers.Authorization = `Bearer ${key}`;
  return headers;
}

function builderModel(): string | null {
  const env = getEnv();
  return env.BUILDER_AGENT_MODEL ?? env.DISTILLATION_MODEL ?? null;
}

function builderTimeoutMs(): number {
  return getEnv().BUILDER_AGENT_TIMEOUT_MS;
}

async function sampleRepoForPrompt(root: string): Promise<string> {
  const env = getEnv();
  const maxTotal = env.BUILDER_MEMORY_SAMPLE_MAX_TOTAL_CHARS;
  const maxFileChars = env.BUILDER_MEMORY_SAMPLE_MAX_FILE_CHARS;
  const maxFiles = env.BUILDER_MEMORY_SAMPLE_MAX_FILES;
  const resolved = path.resolve(root);
  const patterns = ['src/**/*.{ts,tsx}', '*.md', 'package.json', 'README.md'];
  const files: string[] = [];
  for (const p of patterns) {
    const hits = await fg(p, {
      cwd: resolved,
      onlyFiles: true,
      ignore: ['**/node_modules/**', '**/dist/**', '**/.git/**'],
      absolute: false,
    });
    for (const h of hits) {
      if (!files.includes(h)) files.push(h);
      if (files.length >= maxFiles) break;
    }
    if (files.length >= maxFiles) break;
  }
  let total = 0;
  const parts: string[] = [];
  for (const rel of files) {
    const fp = path.join(resolved, rel);
    try {
      const raw = await fs.readFile(fp, 'utf8');
      const slice = raw.length > maxFileChars ? `${raw.slice(0, maxFileChars)}\n…` : raw;
      const block = `--- FILE: ${rel} ---\n${slice}`;
      if (total + block.length > maxTotal) break;
      parts.push(block);
      total += block.length;
    } catch {
      /* skip */
    }
  }
  return parts.join('\n\n');
}

type ChatCompletionJson = {
  error?: { message?: string; type?: string; code?: string };
  choices?: Array<{
    message?: { content?: string };
    finish_reason?: string;
  }>;
};

/** Shared OpenAI-compatible chat for single-pass and large-repo map-reduce steps. */
export async function builderChatCompletion(input: {
  system: string;
  user: string;
  maxTokens?: number;
}): Promise<string | null> {
  const model = builderModel();
  if (!model) {
    logger.warn(
      {
        hint: 'Set BUILDER_AGENT_MODEL or DISTILLATION_MODEL; builder memory will not run without a chat model.',
      },
      'builder memory: no chat model configured',
    );
    return null;
  }
  const base = builderBaseUrl().endsWith('/') ? builderBaseUrl() : `${builderBaseUrl()}/`;
  const url = new URL('v1/chat/completions', base).toString();
  const ac = new AbortController();
  const t = setTimeout(() => ac.abort(), builderTimeoutMs());
  const maxTokens = input.maxTokens ?? 4096;
  try {
    const res = await fetch(url, {
      method: 'POST',
      headers: builderHeaders(),
      signal: ac.signal,
      body: JSON.stringify({
        model,
        messages: [
          { role: 'system', content: input.system },
          { role: 'user', content: input.user },
        ],
        temperature: 0.2,
        max_tokens: maxTokens,
      }),
    });
    const rawText = await res.text().catch(() => '');
    if (!res.ok) {
      let detail = rawText.slice(0, 400);
      try {
        const err = JSON.parse(rawText) as ChatCompletionJson;
        if (err?.error?.message) detail = err.error.message;
      } catch {
        /* keep raw */
      }
      logger.warn(
        {
          status: res.status,
          model,
          chat_url: url,
          error_detail: detail,
        },
        'builder memory chat HTTP error — no artifact will be written for this step',
      );
      return null;
    }
    let json: ChatCompletionJson;
    try {
      json = JSON.parse(rawText) as ChatCompletionJson;
    } catch {
      logger.warn({ model, chat_url: url, body_preview: rawText.slice(0, 200) }, 'builder memory chat invalid JSON body');
      return null;
    }
    if (json?.error) {
      logger.warn(
        { model, chat_url: url, api_error: json.error },
        'builder memory chat error object in 200 body — no artifact for this step',
      );
      return null;
    }
    const choice0 = json?.choices?.[0];
    const out = choice0?.message?.content;
    const finishReason = choice0?.finish_reason;
    if (typeof out !== 'string' || !out.trim()) {
      logger.warn(
        {
          model,
          chat_url: url,
          finish_reason: finishReason ?? null,
          choices_length: json?.choices?.length ?? 0,
        },
        'builder memory chat empty or missing message.content — check model / context length / API',
      );
      return null;
    }
    return out.trim();
  } catch (e) {
    const err = e instanceof Error ? e : new Error(String(e));
    const isAbort = err.name === 'AbortError' || /abort/i.test(err.message);
    logger.warn(
      {
        error: err.message,
        is_timeout: isAbort,
        timeout_ms: builderTimeoutMs(),
        model,
        chat_url: url,
      },
      isAbort
        ? 'builder memory chat aborted (timeout) — increase BUILDER_AGENT_TIMEOUT_MS or reduce prompt size'
        : 'builder memory chat network/runtime error',
    );
    return null;
  } finally {
    clearTimeout(t);
  }
}

/** Split concatenated `--- FILE: ...` sample into chunks that fit the model context per map call. */
function splitRepoSampleIntoChunks(sample: string, maxChunkChars: number): string[] {
  if (sample.length <= maxChunkChars) return [sample];
  const blocks = sample.split(/\n\n(?=--- FILE:)/g).filter(Boolean);
  const chunks: string[] = [];
  let buf = '';
  const flush = () => {
    if (buf.trim()) chunks.push(buf);
    buf = '';
  };
  for (const block of blocks) {
    const b = block.trimEnd();
    if (!b) continue;
    if (b.length > maxChunkChars) {
      flush();
      for (let i = 0; i < b.length; i += maxChunkChars) {
        chunks.push(b.slice(i, i + maxChunkChars));
      }
      continue;
    }
    const sep = buf ? '\n\n' : '';
    if (buf.length + sep.length + b.length <= maxChunkChars) {
      buf = buf ? buf + sep + b : b;
    } else {
      flush();
      buf = b;
    }
  }
  flush();
  return chunks.length ? chunks : [sample.slice(0, maxChunkChars)];
}

async function parallelMapLimit<T, R>(items: T[], limit: number, fn: (item: T, index: number) => Promise<R>): Promise<R[]> {
  const results: R[] = new Array(items.length);
  let next = 0;
  async function worker(): Promise<void> {
    for (;;) {
      const i = next++;
      if (i >= items.length) return;
      results[i] = await fn(items[i], i);
    }
  }
  const n = Math.min(Math.max(1, limit), items.length);
  await Promise.all(Array.from({ length: n }, () => worker()));
  return results;
}

/** One map step: notes from a repo slice (fits context window). */
async function mapChunkToPartialNotes(chunk: string, index: number, total: number, mapMaxTokens: number): Promise<string | null> {
  const system =
    `You extract repository facts from slice ${index + 1} of ${total} (chunked for context limits). ` +
    'Output concise Markdown: bullet lists of paths, symbols, imports, MCP/tools/jobs if visible, config, risks. ' +
    'No full document yet — another step will merge slices.';
  const user = `Repository slice:\n\n${chunk}`;
  return builderChatCompletion({ system, user, maxTokens: mapMaxTokens });
}

function clampPartialForMerge(p: string, maxChars: number): string {
  if (p.length <= maxChars) return p;
  return `${p.slice(0, Math.max(0, maxChars - 80))}\n\n[… truncated …]`;
}

/** Group partials so each batch stays under merge input budget. */
function batchPartialsForMerge(partials: string[], maxInputChars: number): string[][] {
  const batches: string[][] = [];
  let cur: string[] = [];
  let len = 0;
  const overhead = 24;
  for (const raw of partials) {
    const p = raw.trim();
    if (!p) continue;
    const add = p.length + (cur.length ? overhead : 0);
    if (cur.length && len + add > maxInputChars) {
      batches.push(cur);
      cur = [p];
      len = p.length;
    } else {
      cur.push(p);
      len += add;
    }
  }
  if (cur.length) batches.push(cur);
  return batches;
}

/** Merge several partial notes into one block (intermediate or final). */
async function mergeNoteBatch(
  batch: string[],
  mergeMaxTokens: number,
  intermediate: boolean,
  maxPartialChars: number,
): Promise<string | null> {
  const safe = batch.map(p => clampPartialForMerge(p, maxPartialChars));
  const system = intermediate
    ? 'You merge partial repository notes into one coherent Markdown section. Deduplicate; keep paths and symbols. Intermediate merge.'
    : 'You merge partial repository notes into one coherent Markdown document. Deduplicate; preserve structure.';
  const user = `Notes (${batch.length} parts):\n\n${safe.join('\n\n---\n\n')}`;
  return builderChatCompletion({ system, user, maxTokens: mergeMaxTokens });
}

/** Reduce partials to one string (may take multiple merge rounds if inputs are large). */
async function reducePartialsToOne(
  partials: string[],
  maxInputChars: number,
  mergeMaxTokens: number,
): Promise<string | null> {
  const cleaned = partials.map(p => p.trim()).filter(Boolean);
  if (!cleaned.length) return null;
  if (cleaned.length === 1) return cleaned[0];
  let layer = cleaned;
  let round = 0;
  const maxRounds = 32;
  while (layer.length > 1 && round < maxRounds) {
    round += 1;
    const batches = batchPartialsForMerge(layer, maxInputChars);
    // If every partial is too large to co-pack, batching yields one item per batch → no progress unless we pair-merge.
    if (batches.length === layer.length && batches.every(b => b.length === 1)) {
      const perSide = Math.max(2000, Math.floor(maxInputChars / 2) - 400);
      const next: string[] = [];
      for (let i = 0; i < layer.length; i += 2) {
        const a = layer[i];
        const b = layer[i + 1];
        if (b === undefined) {
          next.push(clampPartialForMerge(a, maxInputChars));
          continue;
        }
        const pair = [clampPartialForMerge(a, perSide), clampPartialForMerge(b, perSide)];
        const m = await mergeNoteBatch(pair, mergeMaxTokens, true, perSide);
        if (!m) return null;
        next.push(m);
      }
      layer = next;
      continue;
    }
    const next: string[] = [];
    for (const batch of batches) {
      if (batch.length === 1) {
        next.push(batch[0]);
      } else {
        const per = Math.max(2000, Math.floor(maxInputChars / batch.length) - 200);
        const m = await mergeNoteBatch(batch, mergeMaxTokens, true, per);
        if (!m) return null;
        next.push(m);
      }
    }
    layer = next;
  }
  if (layer.length > 1) {
    const per = Math.max(2000, Math.floor(maxInputChars / layer.length) - 200);
    const fallback = await mergeNoteBatch(
      layer,
      mergeMaxTokens,
      true,
      per,
    );
    return fallback;
  }
  return layer[0] ?? null;
}

/** Single-shot full document (small repo sample). */
async function synthesizeMemoryOneShot(repoSample: string, mergeMaxTokens: number): Promise<string | null> {
  const system =
    'You are a senior software engineer doing a deep read of a repository. ' +
    'Produce structured project memory for downstream RAG: sections Overview, Architecture, KeyEntrypoints, ' +
    'McpAndJobs, Phase6KnowledgeLoop, RisksAndGaps. Use concrete file paths and symbols. Markdown, no code fences around the whole output.';
  const user = `Repository sample (truncated):\n\n${repoSample}\n\nWrite the full memory document now.`;
  return builderChatCompletion({ system, user, maxTokens: mergeMaxTokens });
}

/** Final polish: structured memory from consolidated notes (after map-reduce). */
async function synthesizeMemoryFromMergedNotes(mergedNotes: string, mergeMaxTokens: number): Promise<string | null> {
  const system =
    'You are a senior software engineer. You are given consolidated notes from a chunked scan of a repository. ' +
    'Produce structured project memory for downstream RAG: sections Overview, Architecture, KeyEntrypoints, ' +
    'McpAndJobs, Phase6KnowledgeLoop, RisksAndGaps. Use concrete file paths and symbols. Markdown, no code fences around the whole output.';
  const user = `Consolidated notes:\n\n${mergedNotes}\n\nWrite the full memory document now.`;
  return builderChatCompletion({ system, user, maxTokens: mergeMaxTokens });
}

async function synthesizeMemoryChunked(sample: string, env: Env): Promise<string | null> {
  const maxChunk = env.BUILDER_MEMORY_MAP_CHUNK_MAX_CHARS;
  const chunks = splitRepoSampleIntoChunks(sample, maxChunk);
  if (chunks.length === 1) {
    return synthesizeMemoryOneShot(chunks[0], env.BUILDER_MEMORY_MERGE_MAX_TOKENS);
  }

  logger.info(
    {
      map_chunks: chunks.length,
      map_concurrency: env.BUILDER_MEMORY_MAP_CONCURRENCY,
      map_chunk_max_chars: maxChunk,
    },
    'builder_memory: map-reduce (multiple LLM calls)',
  );

  const partials = await parallelMapLimit(chunks, env.BUILDER_MEMORY_MAP_CONCURRENCY, (chunk, i) =>
    mapChunkToPartialNotes(chunk, i, chunks.length, env.BUILDER_MEMORY_MAP_MAX_TOKENS),
  );
  const ok = partials.filter((p): p is string => typeof p === 'string' && p.trim().length > 0);
  if (!ok.length) return null;

  const merged = await reducePartialsToOne(ok, env.BUILDER_MEMORY_MERGE_MAX_INPUT_CHARS, env.BUILDER_MEMORY_MERGE_MAX_TOKENS);
  if (!merged) return null;

  return synthesizeMemoryFromMergedNotes(merged, env.BUILDER_MEMORY_MERGE_MAX_TOKENS);
}

/** Deep-loop step: LLM synthesizes a large “project memory” artifact; indexed on next index.run. */
export async function buildProjectMemoryArtifact(input: {
  projectId: string;
  root: string;
  correlationId?: string;
  sourceJobId?: string;
}): Promise<{ status: 'ok' | 'skipped'; doc_key?: string; reason?: string }> {
  const env = getEnv();
  if (!env.BUILDER_MEMORY_ENABLED) {
    return { status: 'skipped', reason: 'BUILDER_MEMORY_ENABLED=false' };
  }
  logger.info(
    { project_id: input.projectId, correlation_id: input.correlationId ?? null, root: input.root },
    'phase6 builder_memory begin',
  );
  const sample = await sampleRepoForPrompt(input.root);
  if (!sample.trim()) {
    return { status: 'skipped', reason: 'empty_repo_sample' };
  }
  const memory = await synthesizeMemoryChunked(sample, env);
  if (!memory) {
    logger.warn(
      {
        project_id: input.projectId,
        reason: 'no_llm_output',
        hint:
          'Set BUILDER_AGENT_MODEL or DISTILLATION_MODEL and an OpenAI-compatible POST /v1/chat/completions endpoint (BUILDER_AGENT_BASE_URL or DISTILLATION_BASE_URL or EMBEDDINGS_BASE_URL). Embeddings-only servers will skip builder memory.',
      },
      'phase6 builder_memory skipped',
    );
    return { status: 'skipped', reason: 'no_llm_output' };
  }
  const stamp = new Date().toISOString().replace(/[:.]/g, '-');
  const docKey = `phase6/builder_memory/${stamp}`;
  await upsertGeneratedDocument({
    projectId: input.projectId,
    docType: 'benchmark_artifact',
    docKey,
    title: `Phase6 builder memory ${stamp}`,
    content: memory,
    metadata: {
      phase6: true,
      kind: 'builder_memory',
      correlation_id: input.correlationId ?? null,
      status: 'draft',
    },
    sourceJobId: input.sourceJobId,
    correlationId: input.correlationId,
  });
  logger.info(
    { project_id: input.projectId, doc_key: docKey, correlation_id: input.correlationId ?? null },
    'phase6 builder_memory persisted',
  );
  return { status: 'ok', doc_key: docKey };
}
