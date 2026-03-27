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
  const memory = await synthesizeMemory(sample);
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
