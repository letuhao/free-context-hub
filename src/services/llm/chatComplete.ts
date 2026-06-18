/**
 * Shared OpenAI-compatible chat-completion transport — Phase 17.2.
 *
 * ONE request/response path for every LM-Studio-backed chat caller. Replaces
 * ~11 independent inline `fetch('/v1/chat/completions')` implementations that
 * each diverged on reasoning-suppression, output extraction, timeout, and
 * retry. The architectural fix for the chain-of-thought leak: a model that
 * reasons is fine, but its reasoning must never reach the "answer" — so every
 * request suppresses reasoning and every response is normalized here.
 *
 * Callers keep resolving their OWN base-url / api-key / model (each has its own
 * env fallback chain) and pass them in; this module owns transport + the two
 * normalization layers (request suppression + response extraction).
 */

import { extractAnswerText } from './extractAnswer.js';
import { retryOnTransient, type RetryOptions } from './resilience.js';

/** A chat message. `content` is a string, or a multimodal block array
 *  (vision: `[{type:'text',...},{type:'image_url',...}]`). */
export type ChatMessage = {
  role: 'system' | 'user' | 'assistant';
  content: string | Array<Record<string, unknown>>;
};

export type ChatCompleteParams = {
  baseUrl: string;
  apiKey?: string;
  model: string;
  messages: ChatMessage[];
  temperature?: number;
  seed?: number;
  maxTokens?: number;
  /** Per-request timeout. Ignored when `signal` is supplied. Default 120_000. */
  timeoutMs?: number;
  /** Caller-supplied abort signal (composed with the timeout). */
  signal?: AbortSignal;
  /** Suppress model reasoning so the token budget goes to the answer.
   *  Default true. Set false only for a deliberate reasoning capture. */
  suppressReasoning?: boolean;
  /** Extra top-level body fields (e.g. `response_format`). Merged last, so a
   *  caller can override the suppression defaults if it really must. */
  extraBody?: Record<string, unknown>;
  /** Retry transient LM Studio failures. `true` → default policy; an object →
   *  custom policy; omitted/false → no retry. */
  retry?: boolean | RetryOptions;
  /** Injectable fetch for tests. */
  fetchImpl?: typeof fetch;
};

export type ChatCompleteResult = {
  /** Clean answer text (reasoning stripped, reasoning_content fallback applied). */
  content: string;
  finish_reason?: string;
  usage?: { prompt_tokens?: number; completion_tokens?: number };
  /** Raw message, for callers that need finish_reason/usage diagnostics. */
  raw: Record<string, unknown>;
};

/** Cross-family reasoning-suppression knobs. `reasoning_effort:'none'` is the
 *  one LM Studio's gemma-4 honors (proven by the ragas-judge sidecar);
 *  `chat_template_kwargs.enable_thinking:false` covers the qwen3 family.
 *  Non-reasoning models (mistral-nemo etc.) ignore both.
 *
 *  PORTABILITY: both are LM-Studio / vLLM conventions, NOT OpenAI-standard
 *  (`reasoning_effort:'none'` is not a valid OpenAI enum value; OpenAI/Azure or a
 *  strict vLLM may 400 on either). The shared client therefore targets an
 *  LM-Studio-compatible endpoint that ignores unknown params. To point a caller
 *  at a strict endpoint, set `LLM_REASONING_SUPPRESS=off` (process-wide) or pass
 *  `suppressReasoning:false` per call. */
function reasoningSuppressionBody(): { reasoning_effort: string; chat_template_kwargs: Record<string, unknown> } {
  return {
    reasoning_effort: 'none',
    chat_template_kwargs: { enable_thinking: false },
  };
}

/** Process-wide default for reasoning suppression. Default ON (LM-Studio
 *  posture). Set `LLM_REASONING_SUPPRESS` to off/false/0/no to disable globally
 *  for a strict OpenAI/Azure/vLLM endpoint. Read from process.env directly (not
 *  the typed env) so this transport stays decoupled and test-safe. */
function suppressReasoningDefault(): boolean {
  const v = (process.env.LLM_REASONING_SUPPRESS ?? '').trim().toLowerCase();
  return !(v === 'off' || v === 'false' || v === '0' || v === 'no');
}

function buildUrl(baseUrl: string): string {
  const base = baseUrl.replace(/\/+$/, '');
  return base.endsWith('/v1') ? `${base}/chat/completions` : `${base}/v1/chat/completions`;
}

type ChatCompletionResponse = {
  choices?: Array<{
    message?: Record<string, unknown>;
    finish_reason?: string;
  }>;
  usage?: { prompt_tokens?: number; completion_tokens?: number };
  error?: { message?: string };
};

async function once(params: ChatCompleteParams): Promise<ChatCompleteResult> {
  const fetchImpl = params.fetchImpl ?? fetch;
  const url = buildUrl(params.baseUrl);

  const suppress = params.suppressReasoning ?? suppressReasoningDefault();
  const suppression = suppress ? reasoningSuppressionBody() : undefined;
  // Deep-merge chat_template_kwargs so an `extraBody` caller can ADD keys
  // without silently dropping the injected `enable_thinking:false`.
  const templateKwargs = {
    ...(suppression?.chat_template_kwargs ?? {}),
    ...((params.extraBody?.chat_template_kwargs as Record<string, unknown> | undefined) ?? {}),
  };
  const body: Record<string, unknown> = {
    model: params.model,
    messages: params.messages,
    ...(params.temperature !== undefined ? { temperature: params.temperature } : {}),
    ...(params.seed !== undefined ? { seed: params.seed } : {}),
    ...(params.maxTokens !== undefined ? { max_tokens: params.maxTokens } : {}),
    ...(suppression ? { reasoning_effort: suppression.reasoning_effort } : {}),
    ...(params.extraBody ?? {}),
    ...(Object.keys(templateKwargs).length ? { chat_template_kwargs: templateKwargs } : {}),
  };

  const headers: Record<string, string> = { 'Content-Type': 'application/json' };
  if (params.apiKey) headers.Authorization = `Bearer ${params.apiKey}`;

  // Compose timeout with any caller signal.
  const timeoutMs = params.timeoutMs ?? 120_000;
  const ctl = new AbortController();
  const timer = setTimeout(() => ctl.abort(), timeoutMs);
  const onCallerAbort = () => ctl.abort();
  if (params.signal) {
    if (params.signal.aborted) ctl.abort();
    else params.signal.addEventListener('abort', onCallerAbort, { once: true });
  }

  try {
    const res = await fetchImpl(url, {
      method: 'POST',
      headers,
      body: JSON.stringify(body),
      signal: ctl.signal,
    });
    if (!res.ok) {
      const text = await res.text().catch(() => '<unreadable>');
      const err = new Error(`chat HTTP ${res.status}: ${text.slice(0, 300)}`);
      (err as { status?: number }).status = res.status;
      throw err;
    }
    const data = (await res.json()) as ChatCompletionResponse;
    if (data.error) {
      throw new Error(`chat error: ${data.error.message ?? JSON.stringify(data.error)}`);
    }
    const choice = data.choices?.[0];
    if (!choice || !choice.message) throw new Error('chat returned no choices/message');
    return {
      content: extractAnswerText(choice.message),
      finish_reason: choice.finish_reason,
      usage: data.usage,
      raw: choice.message,
    };
  } finally {
    clearTimeout(timer);
    if (params.signal) params.signal.removeEventListener('abort', onCallerAbort);
  }
}

/**
 * Call an OpenAI-compatible chat endpoint with standardized reasoning
 * suppression + answer extraction. Returns the clean answer text in `content`.
 */
export async function chatComplete(params: ChatCompleteParams): Promise<ChatCompleteResult> {
  if (!params.retry) return once(params);
  const opts: RetryOptions = params.retry === true ? {} : params.retry;
  return retryOnTransient(() => once(params), opts);
}
