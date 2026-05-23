/**
 * Phase 16 Sprint 16.3 — gen-eval synthesizer pipeline.
 *
 * Given a query + top-K retrieval hits, produces a synthesized answer using
 * the ANSWERER_AGENT LLM with a surface-specific pinned prompt template.
 *
 * Path A (controlled) per DESIGN §5: same retriever + same synthesizer prompt
 * across baseline runs, so A/B'ing retrieval changes is fair. Path B
 * (production-fidelity) is a Sprint 16.5 candidate.
 *
 * The LLM is called via OpenAI-compatible HTTP (LM Studio default). No ragas
 * involvement here — that lives in the judge sidecar (src/qc/judge.ts).
 */

import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import type { Surface } from './goldenTypes.js';
import type { SurfaceItem } from './surfaces.js';
import { promptHash, type GenContextUsed, type GenResult } from './genEvalTypes.js';

// Resolve template directory relative to THIS file so the pipeline works
// regardless of CWD (tsx run from project root, vitest from anywhere, etc.).
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const TEMPLATE_DIR = path.join(__dirname, 'templates');

export type AnswererConfig = {
  baseUrl: string;
  apiKey: string;
  model: string;
  temperature: number;
  seed: number;
  maxTokens: number;
  timeoutMs: number;
};

export type GenPipelineInput = {
  surface: Surface;
  question: string;
  /** Top-K retrieval hits (from surfaces.ts callX functions). */
  retrievalHits: SurfaceItem[];
  /** How many top hits to feed into the synthesizer (default 5). */
  topK?: number;
  /** Truncate per-context snippet to this many chars before sending. */
  maxCharsPerContext?: number;
};

// ─── template loading (with one-shot cache) ───

const _templateCache = new Map<Surface, string>();
const _hashCache = new Map<Surface, string>();

export async function loadTemplate(surface: Surface): Promise<string> {
  const cached = _templateCache.get(surface);
  if (cached !== undefined) return cached;
  const file = path.join(TEMPLATE_DIR, `synthesizer.${surface}.txt`);
  const content = await fs.readFile(file, 'utf-8');
  _templateCache.set(surface, content);
  return content;
}

export async function templateHash(surface: Surface): Promise<string> {
  const cached = _hashCache.get(surface);
  if (cached !== undefined) return cached;
  const t = await loadTemplate(surface);
  const h = promptHash(t);
  _hashCache.set(surface, h);
  return h;
}

/** Read all surface template hashes — used to pin in baseline manifest. */
export async function allTemplateHashes(): Promise<Record<string, string>> {
  const surfaces: Surface[] = ['lessons', 'code', 'chunks', 'global'];
  const out: Record<string, string> = {};
  for (const s of surfaces) out[s] = await templateHash(s);
  return out;
}

// ─── context formatting ───

function formatContext(item: SurfaceItem, idx: number, maxChars: number): string {
  const title = item.title ? ` — ${item.title}` : '';
  const type = item.type ? ` [${item.type}]` : '';
  const snippet = item.snippet ? item.snippet.slice(0, maxChars) : '(empty snippet)';
  const truncated = item.snippet && item.snippet.length > maxChars ? '\n[...truncated]' : '';
  return `[${idx + 1}]${type}${title}\nkey: ${item.key}\n${snippet}${truncated}`;
}

function renderPrompt(
  template: string,
  question: string,
  contexts: SurfaceItem[],
  maxChars: number,
): string {
  const numbered = contexts.length
    ? contexts.map((c, i) => formatContext(c, i, maxChars)).join('\n\n---\n\n')
    : '(no retrieval hits — answer should say "Not in context")';
  return template.replace('{question}', question).replace('{numbered_contexts}', numbered);
}

// ─── answerer LLM call (OpenAI-compatible) ───

type ChatMessage = { role: 'system' | 'user' | 'assistant'; content: string };
type ChatCompletionResponse = {
  choices?: Array<{
    message?: { content?: string | null; role?: string };
    finish_reason?: string;
  }>;
  usage?: { prompt_tokens?: number; completion_tokens?: number };
  error?: { message?: string };
};

async function callAnswerer(
  prompt: string,
  cfg: AnswererConfig,
  fetchImpl: typeof fetch = fetch,
): Promise<{ content: string; finish_reason?: string }> {
  const baseUrl = cfg.baseUrl.replace(/\/$/, '');
  const url = baseUrl.endsWith('/v1') ? `${baseUrl}/chat/completions` : `${baseUrl}/v1/chat/completions`;

  const ctl = new AbortController();
  const timer = setTimeout(() => ctl.abort(), cfg.timeoutMs);

  const body = JSON.stringify({
    model: cfg.model,
    messages: [{ role: 'user', content: prompt }] satisfies ChatMessage[],
    temperature: cfg.temperature,
    seed: cfg.seed,
    max_tokens: cfg.maxTokens,
  });

  try {
    const res = await fetchImpl(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${cfg.apiKey}` },
      body,
      signal: ctl.signal,
    });
    if (!res.ok) {
      const text = await res.text().catch(() => '<unreadable>');
      throw new Error(`answerer HTTP ${res.status}: ${text.slice(0, 200)}`);
    }
    const data = (await res.json()) as ChatCompletionResponse;
    if (data.error) throw new Error(`answerer error: ${data.error.message ?? JSON.stringify(data.error)}`);
    const choice = data.choices?.[0];
    if (!choice || !choice.message) throw new Error('answerer returned no choices/message');
    const content = (choice.message.content ?? '').trim();
    return { content, finish_reason: choice.finish_reason };
  } finally {
    clearTimeout(timer);
  }
}

// ─── public pipeline ───

const DEFAULT_TOP_K = 5;
const DEFAULT_MAX_CHARS = 1000;

/** Run the gen pipeline for one query.
 *
 *  Returns a partial GenResult — caller is expected to fill in `scores`,
 *  `reasons`, `skipped`, `skip_reason`, `judge_ms` after calling judge.scoreOnce.
 *  This split keeps the synthesizer + judge concerns separate.
 */
export async function runGenPipeline(
  input: GenPipelineInput,
  answerer: AnswererConfig,
  opts?: { fetchImpl?: typeof fetch },
): Promise<Pick<GenResult, 'generated_answer' | 'contexts_used' | 'prompt_used' | 'synth_ms' | 'error'>> {
  const topK = input.topK ?? DEFAULT_TOP_K;
  const maxChars = input.maxCharsPerContext ?? DEFAULT_MAX_CHARS;
  const hits = input.retrievalHits.slice(0, topK);

  const contexts_used: GenContextUsed[] = hits.map((h) => ({
    key: h.key,
    title: h.title,
    snippet_preview: h.snippet?.slice(0, 200),
    char_count: h.snippet?.length ?? 0,
  }));

  let template: string;
  try {
    template = await loadTemplate(input.surface);
  } catch (err) {
    return {
      generated_answer: '',
      contexts_used,
      prompt_used: '',
      synth_ms: 0,
      error: `template_load_failed: ${err instanceof Error ? err.message : String(err)}`,
    };
  }

  const prompt = renderPrompt(template, input.question, hits, maxChars);

  const t0 = Date.now();
  try {
    const { content } = await callAnswerer(prompt, answerer, opts?.fetchImpl);
    const synth_ms = Date.now() - t0;
    return {
      generated_answer: content,
      contexts_used,
      prompt_used: prompt,
      synth_ms,
    };
  } catch (err) {
    const synth_ms = Date.now() - t0;
    return {
      generated_answer: '',
      contexts_used,
      prompt_used: prompt,
      synth_ms,
      error: `answerer_failed: ${err instanceof Error ? err.message : String(err)}`,
    };
  }
}
