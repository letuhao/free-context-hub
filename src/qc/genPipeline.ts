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
import { promptHash, type GenContextUsed, type GenResult, type CoVeTrace } from './genEvalTypes.js';

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

// ─── CoVe templates (Phase 17.2) ───

let _coveTemplateCache: { planVerifications?: string; revise?: string } = {};

export async function loadCoVeTemplate(kind: 'plan-verifications' | 'revise'): Promise<string> {
  const key = kind === 'plan-verifications' ? 'planVerifications' : 'revise';
  if (_coveTemplateCache[key]) return _coveTemplateCache[key]!;
  const file = path.join(TEMPLATE_DIR, `cove.${kind}.txt`);
  const content = await fs.readFile(file, 'utf-8');
  _coveTemplateCache[key] = content;
  return content;
}

export async function allCoVeTemplateHashes(): Promise<{ plan_verifications: string; revise: string }> {
  const plan = await loadCoVeTemplate('plan-verifications');
  const revise = await loadCoVeTemplate('revise');
  return {
    plan_verifications: promptHash(plan),
    revise: promptHash(revise),
  };
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
    message?: {
      content?: string | null;
      role?: string;
      /** Reasoning-model field (qwen3.6, deepseek-r1, gemma-4 reasoning, o1).
       *  When the model uses extended reasoning, structured/short outputs may
       *  land here with `content` empty. We fall back to it. Mirrors the
       *  Python sidecar's _compat reasoning-content shim. */
      reasoning_content?: string | null;
    };
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
    // Disable extended-reasoning mode for reasoning models (Gemma-4, qwen3.6,
    // deepseek-r1, o1-class). When extended thinking is on, structured/short
    // outputs land in `reasoning_content` and `content` is empty. We want
    // direct answers in `content`. Non-reasoning models ignore this kwarg.
    chat_template_kwargs: { enable_thinking: false },
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
    // Reasoning-model fallback: when `content` is empty but `reasoning_content`
    // has the answer (qwen3.6 / gemma-4 reasoning / deepseek-r1 / o1 etc.),
    // promote it. Mirrors services/ragas-judge/_compat.py shim.
    const rawContent = (choice.message.content ?? '').trim();
    const rawReasoning = (choice.message.reasoning_content ?? '').trim();
    const content = rawContent || rawReasoning;
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

// ─── Chain-of-Verification (CoVe) — Phase 17.2 ───
//
// Meta paper: Dhuliawala et al, "Chain-of-Verification Reduces Hallucination
// in Large Language Models" (2023). Reported ~30% hallucination reduction on
// Llama-class models for long-form QA.
//
// Four steps:
//   1. Baseline response (draft) — reuse runGenPipeline's output
//   2. Plan verifications     — LLM generates 3-5 verification Qs about the draft
//   3. Execute verifications  — LLM answers each Q against contexts only
//   4. Final verified response — LLM revises the draft using verification answers
//
// Cost: ~3-4× the LLM calls vs standard mode. Worth it when faithfulness
// is the dominant production risk.

function parseVerificationQuestions(raw: string): string[] {
  // Split by newlines, strip surrounding whitespace, drop empty / bullet-prefix lines
  return raw
    .split(/\r?\n/)
    .map((l) => l.replace(/^[\s\-*•\d.)]+\s*/, '').trim())
    .filter((l) => l.length > 0 && l.length <= 300);
}

function fmtVerificationsBlock(
  entries: Array<{ question: string; answer: string }>,
): string {
  if (!entries.length) return '(no verification results)';
  return entries
    .map((e, i) => `Q${i + 1}: ${e.question}\nA${i + 1}: ${e.answer}`)
    .join('\n\n');
}

/** Run the 4-step CoVe pipeline for one query.
 *
 *  Returns a partial GenResult with `cove` trace populated. Caller fills in
 *  judge scores / reasons after calling judge.scoreOnce on the revised answer.
 *
 *  Per-step errors are captured into `error` and abort the pipeline early
 *  (e.g. if Step 2 fails, we don't attempt Steps 3-4).
 */
export async function runGenPipelineCoVe(
  input: GenPipelineInput,
  answerer: AnswererConfig,
  opts?: { fetchImpl?: typeof fetch; maxVerifications?: number },
): Promise<Pick<GenResult, 'generated_answer' | 'contexts_used' | 'prompt_used' | 'synth_ms' | 'error' | 'cove'>> {
  const maxVerifications = opts?.maxVerifications ?? 5;

  // ─── Step 1: Draft (reuse standard pipeline) ───
  const draft = await runGenPipeline(input, answerer, opts);
  if (draft.error) {
    return { ...draft }; // bail; no cove trace yet
  }

  const topK = input.topK ?? DEFAULT_TOP_K;
  const maxChars = input.maxCharsPerContext ?? DEFAULT_MAX_CHARS;
  const hits = input.retrievalHits.slice(0, topK);
  const numberedContexts = hits.length
    ? hits.map((c, i) => formatContext(c, i, maxChars)).join('\n\n---\n\n')
    : '(no retrieval hits)';

  // ─── Step 2: Plan verifications ───
  const t0_plan = Date.now();
  let plan_ms = 0;
  let questions: string[] = [];
  let trace_error: string | undefined = undefined;

  try {
    const planTemplate = await loadCoVeTemplate('plan-verifications');
    const planPrompt = planTemplate
      .replace('{question}', input.question)
      .replace('{draft_answer}', draft.generated_answer)
      .replace('{numbered_contexts}', numberedContexts);

    const { content: planOut } = await callAnswerer(planPrompt, answerer, opts?.fetchImpl);
    plan_ms = Date.now() - t0_plan;
    questions = parseVerificationQuestions(planOut).slice(0, maxVerifications);
    if (!questions.length) {
      // No verification questions — treat as if draft has no claims to audit
      // (likely a refusal). Skip to step 4 directly.
      questions = [];
    }
  } catch (err) {
    plan_ms = Date.now() - t0_plan;
    trace_error = `cove_plan_failed: ${err instanceof Error ? err.message : String(err)}`;
  }

  // ─── Step 3: Execute verifications ───
  const t0_verify = Date.now();
  let verify_ms = 0;
  const verification_answers: Array<{ question: string; answer: string }> = [];

  if (!trace_error && questions.length) {
    for (const q of questions) {
      const verifyPrompt = `Answer the following verification question using ONLY the contexts below.
Closed-book: do not use training knowledge.
If the contexts do not directly support the question's claim, answer exactly: "Not supported by contexts."
Be concise (1-2 sentences max).

VERIFICATION QUESTION:
${q}

CONTEXTS:
${numberedContexts}

ANSWER:`;
      try {
        const { content: vAnswer } = await callAnswerer(verifyPrompt, answerer, opts?.fetchImpl);
        verification_answers.push({ question: q, answer: vAnswer.trim() });
      } catch (err) {
        // Don't abort the whole pipeline on one verification failure;
        // record an error placeholder so the revise step sees it.
        verification_answers.push({
          question: q,
          answer: `(verification call failed: ${err instanceof Error ? err.message : String(err)})`,
        });
      }
    }
  }
  verify_ms = Date.now() - t0_verify;

  // ─── Step 4: Revise ───
  const t0_revise = Date.now();
  let revise_ms = 0;
  let revised_answer = draft.generated_answer; // fallback to draft

  if (!trace_error) {
    try {
      const reviseTemplate = await loadCoVeTemplate('revise');
      const revisePrompt = reviseTemplate
        .replace('{question}', input.question)
        .replace('{draft_answer}', draft.generated_answer)
        .replace('{verifications_block}', fmtVerificationsBlock(verification_answers))
        .replace('{numbered_contexts}', numberedContexts);

      const { content: revised } = await callAnswerer(revisePrompt, answerer, opts?.fetchImpl);
      revise_ms = Date.now() - t0_revise;
      revised_answer = revised.trim();
    } catch (err) {
      revise_ms = Date.now() - t0_revise;
      trace_error = `cove_revise_failed: ${err instanceof Error ? err.message : String(err)}`;
    }
  }

  const total_synth_ms = draft.synth_ms + plan_ms + verify_ms + revise_ms;

  const cove: CoVeTrace = {
    draft_answer: draft.generated_answer,
    verification_questions: questions,
    verification_answers,
    revised_answer,
    step_ms: { plan: plan_ms, verify: verify_ms, revise: revise_ms },
  };

  return {
    generated_answer: revised_answer,
    contexts_used: draft.contexts_used,
    prompt_used: draft.prompt_used, // draft's prompt; revise prompt is large + redundant
    synth_ms: total_synth_ms,
    error: trace_error,
    cove,
  };
}
