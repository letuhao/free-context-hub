import fs from 'node:fs/promises';
import path from 'node:path';

import fg from 'fast-glob';

import { getEnv } from '../env.js';
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

const MAX_TOTAL_CHARS = 90_000;
const MAX_FILE_CHARS = 6000;
const MAX_FILES = 64;

async function sampleRepoForPrompt(root: string): Promise<string> {
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
      if (files.length >= MAX_FILES) break;
    }
    if (files.length >= MAX_FILES) break;
  }
  let total = 0;
  const parts: string[] = [];
  for (const rel of files) {
    const fp = path.join(resolved, rel);
    try {
      const raw = await fs.readFile(fp, 'utf8');
      const slice = raw.length > MAX_FILE_CHARS ? `${raw.slice(0, MAX_FILE_CHARS)}\n…` : raw;
      const block = `--- FILE: ${rel} ---\n${slice}`;
      if (total + block.length > MAX_TOTAL_CHARS) break;
      parts.push(block);
      total += block.length;
    } catch {
      /* skip */
    }
  }
  return parts.join('\n\n');
}

/** Shared OpenAI-compatible chat for single-pass and large-repo map-reduce steps. */
export async function builderChatCompletion(input: {
  system: string;
  user: string;
  maxTokens?: number;
}): Promise<string | null> {
  const model = builderModel();
  if (!model) {
    logger.info({}, 'builder memory: no BUILDER_AGENT_MODEL / DISTILLATION_MODEL; skip');
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
    if (!res.ok) {
      const txt = await res.text().catch(() => '');
      logger.warn({ status: res.status, body: txt.slice(0, 200) }, 'builder memory chat failed');
      return null;
    }
    const json = (await res.json()) as { choices?: Array<{ message?: { content?: string } }> };
    const out = json?.choices?.[0]?.message?.content;
    if (typeof out !== 'string' || !out.trim()) return null;
    return out.trim();
  } catch (e) {
    logger.warn({ error: e instanceof Error ? e.message : String(e) }, 'builder memory chat error');
    return null;
  } finally {
    clearTimeout(t);
  }
}

async function synthesizeMemory(repoSample: string): Promise<string | null> {
  const system =
    'You are a senior software engineer doing a deep read of a repository. ' +
    'Produce structured project memory for downstream RAG: sections Overview, Architecture, KeyEntrypoints, ' +
    'McpAndJobs, Phase6KnowledgeLoop, RisksAndGaps. Use concrete file paths and symbols. Markdown, no code fences around the whole output.';
  const user = `Repository sample (truncated):\n\n${repoSample}\n\nWrite the full memory document now.`;
  return builderChatCompletion({ system, user, maxTokens: 4096 });
}

/** Deep-loop step: LLM synthesizes a large “project memory” artifact; indexed on next index.run. */
export async function buildProjectMemoryArtifact(input: {
  projectId: string;
  root: string;
  correlationId?: string;
  sourceJobId?: string;
}): Promise<{ status: 'ok' | 'skipped'; doc_key?: string; reason?: string }> {
  const env = getEnv();
  if (!env.PHASE6_BUILDER_MEMORY_ENABLED) {
    return { status: 'skipped', reason: 'PHASE6_BUILDER_MEMORY_ENABLED=false' };
  }
  logger.info(
    { project_id: input.projectId, correlation_id: input.correlationId ?? null, root: input.root },
    'phase6 builder_memory begin',
  );
  const sample = await sampleRepoForPrompt(input.root);
  if (!sample.trim()) {
    return { status: 'skipped', reason: 'empty_repo_sample' };
  }
  const memory = await synthesizeMemory(sample);
  if (!memory) {
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
