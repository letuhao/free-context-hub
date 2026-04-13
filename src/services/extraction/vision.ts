/**
 * Vision-based extraction service.
 * Sends a page image to a vision-capable LLM via the OpenAI-compatible
 * chat completions API and returns structured markdown.
 *
 * Configuration: uses VISION_MODEL + VISION_BASE_URL + VISION_API_KEY env
 * vars (falls back to DISTILLATION_* and EMBEDDINGS_BASE_URL like other
 * services in this project).
 */

import { getEnv } from '../../env.js';
import { createModuleLogger } from '../../utils/logger.js';

const logger = createModuleLogger('extraction:vision');

const DEFAULT_PROMPT = `Extract all content from this document page as structured markdown.

Rules:
- Tables: reproduce as markdown tables with pipe syntax (| Col | Col |)
- Code blocks: wrap in fenced code blocks with a language hint (\`\`\`language)
- Diagrams/flowcharts: describe in a > [DIAGRAM] block with a structured description (nodes, edges, flow)
- Mark any uncertain text with [?]
- Preserve heading hierarchy (#, ##, ###) when visible

Output ONLY the markdown content. No commentary, no explanations, no code fences around the whole output.`;

export interface VisionResult {
  markdown: string;
  /** Token usage if reported by the model */
  usage?: { prompt_tokens?: number; completion_tokens?: number; total_tokens?: number };
  /** "stop" | "length" | etc — "length" means the response was truncated. */
  finish_reason?: string;
  /** True if we had to fall back to reasoning_content because content was empty. */
  used_reasoning_fallback?: boolean;
}

/**
 * Extract content from a single page image using a vision model.
 * Throws on network failure or non-200 response. Retries on transient errors
 * with exponential backoff (configured via VISION_PAGE_RETRIES).
 */
export async function extractPageVision(params: {
  imagePng: Buffer;
  /** Optional custom prompt; defaults to the structured-markdown prompt */
  prompt?: string;
  /** Optional max tokens for the response (defaults to env.VISION_MAX_TOKENS) */
  maxTokens?: number;
  /** AbortSignal for cancellation (defaults to env.VISION_TIMEOUT_MS) */
  signal?: AbortSignal;
}): Promise<VisionResult> {
  const env = getEnv();
  const maxTokens = params.maxTokens ?? env.VISION_MAX_TOKENS;
  const maxRetries = env.VISION_PAGE_RETRIES;

  let lastErr: unknown = null;
  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    try {
      return await callVisionOnce({ ...params, maxTokens });
    } catch (err) {
      lastErr = err;
      const isTransient = isTransientError(err);
      if (!isTransient || attempt === maxRetries) throw err;
      // Exponential backoff: 1s, 2s, 4s, ...
      const delay = 1000 * Math.pow(2, attempt);
      logger.warn(
        { attempt: attempt + 1, maxRetries: maxRetries + 1, delay, err: err instanceof Error ? err.message : String(err) },
        'vision call failed, retrying',
      );
      await sleep(delay);
    }
  }
  throw lastErr instanceof Error ? lastErr : new Error(String(lastErr));
}

/** Single vision call, no retry. */
async function callVisionOnce(params: {
  imagePng: Buffer;
  prompt?: string;
  maxTokens: number;
  signal?: AbortSignal;
}): Promise<VisionResult> {
  const env = getEnv();
  const model = env.VISION_MODEL || env.DISTILLATION_MODEL;
  if (!model) {
    throw new Error('No vision model configured. Set VISION_MODEL env var.');
  }

  const baseUrl = (
    env.VISION_BASE_URL ||
    env.DISTILLATION_BASE_URL ||
    env.EMBEDDINGS_BASE_URL ||
    ''
  ).replace(/\/$/, '');
  if (!baseUrl) {
    throw new Error('No vision base URL configured. Set VISION_BASE_URL env var.');
  }

  const headers: Record<string, string> = { 'Content-Type': 'application/json' };
  const apiKey = env.VISION_API_KEY || env.DISTILLATION_API_KEY || env.EMBEDDINGS_API_KEY;
  if (apiKey) headers.Authorization = `Bearer ${apiKey}`;

  // Convert PNG buffer to base64 data URI for the image_url content block
  const base64 = params.imagePng.toString('base64');
  const dataUri = `data:image/png;base64,${base64}`;

  const body = {
    model,
    messages: [
      {
        role: 'user',
        content: [
          { type: 'text', text: params.prompt ?? DEFAULT_PROMPT },
          { type: 'image_url', image_url: { url: dataUri } },
        ],
      },
    ],
    temperature: env.VISION_TEMPERATURE,
    max_tokens: params.maxTokens,
  };

  // Compose timeout signal with caller signal
  const timeoutSignal = AbortSignal.timeout(env.VISION_TIMEOUT_MS);
  const signal = params.signal
    ? anySignal([params.signal, timeoutSignal])
    : timeoutSignal;

  const url = `${baseUrl}/v1/chat/completions`;
  logger.info(
    { model, url, imageBytes: params.imagePng.length, maxTokens: params.maxTokens, timeout_ms: env.VISION_TIMEOUT_MS },
    'vision extraction request',
  );

  const res = await fetch(url, {
    method: 'POST',
    headers,
    body: JSON.stringify(body),
    signal,
  });

  if (!res.ok) {
    const txt = await res.text().catch(() => '');
    const err: any = new Error(`Vision model returned HTTP ${res.status}: ${txt.slice(0, 300)}`);
    err.statusCode = res.status;
    throw err;
  }

  const json = (await res.json()) as any;
  const message = json?.choices?.[0]?.message ?? {};
  const finishReason: string | undefined = json?.choices?.[0]?.finish_reason;

  // Issue #2 fix: empty content (not just nullish) falls back to reasoning_content.
  // Thinking models like glm-4.6v-flash sometimes burn the whole token budget on
  // reasoning and return content="" — we still want to use reasoning_content as a
  // last resort rather than fail.
  let markdown = String(message.content ?? '').trim();
  let usedReasoningFallback = false;
  if (!markdown) {
    markdown = String(message.reasoning_content ?? '').trim();
    if (markdown) usedReasoningFallback = true;
  }

  // Strip outer ```markdown ... ``` fences if the model wrapped its output
  if (markdown.startsWith('```')) {
    const lines = markdown.split('\n');
    if (lines[0].match(/^```\w*$/) && lines[lines.length - 1].trim() === '```') {
      markdown = lines.slice(1, -1).join('\n');
    }
  }

  if (!markdown) {
    throw new Error('Vision model returned empty response (both content and reasoning_content)');
  }

  // Issue #3 fix: detect truncation and warn loudly so it's visible in logs and
  // so we could later surface this to the user.
  if (finishReason === 'length') {
    logger.warn(
      {
        model,
        max_tokens: params.maxTokens,
        chars: markdown.length,
        usage: json?.usage,
        used_reasoning_fallback: usedReasoningFallback,
      },
      'vision response truncated by max_tokens — extraction may be incomplete',
    );
  }
  if (usedReasoningFallback) {
    logger.warn(
      { model, chars: markdown.length },
      'vision content was empty, fell back to reasoning_content (model may need more tokens)',
    );
  }

  const usage = json?.usage;
  logger.info(
    { model, chars: markdown.length, usage, finish_reason: finishReason, fallback: usedReasoningFallback },
    'vision extraction complete',
  );

  return {
    markdown,
    usage: usage ? { prompt_tokens: usage.prompt_tokens, completion_tokens: usage.completion_tokens, total_tokens: usage.total_tokens } : undefined,
    finish_reason: finishReason,
    used_reasoning_fallback: usedReasoningFallback,
  };
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/** Combine multiple AbortSignals into one (any aborts → result aborts). */
function anySignal(signals: AbortSignal[]): AbortSignal {
  const ctrl = new AbortController();
  for (const s of signals) {
    if (s.aborted) {
      ctrl.abort(s.reason);
      return ctrl.signal;
    }
    s.addEventListener('abort', () => ctrl.abort(s.reason), { once: true });
  }
  return ctrl.signal;
}

/** Decide whether a vision error is worth retrying. */
function isTransientError(err: unknown): boolean {
  if (!(err instanceof Error)) return false;
  const msg = err.message.toLowerCase();
  const status = (err as any).statusCode as number | undefined;
  // 5xx, network errors, timeouts are transient
  if (status && status >= 500) return true;
  if (msg.includes('timeout') || msg.includes('aborted')) return true;
  if (msg.includes('network') || msg.includes('econnreset') || msg.includes('econnrefused')) return true;
  if (msg.includes('fetch failed')) return true;
  return false;
}

/**
 * Heuristic cost estimate for vision extraction.
 * Returns null for local/free providers, otherwise rough USD estimate.
 */
export function estimateVisionCost(pageCount: number, model?: string): { estimated_usd: number | null; per_page: number | null; provider: string } {
  const env = getEnv();
  const m = (model || env.VISION_MODEL || env.DISTILLATION_MODEL || '').toLowerCase();

  // Known model pricing (USD per page, rough estimate based on typical token counts)
  // These are approximations — actual cost varies with content density.
  const pricing: Record<string, number> = {
    'claude-opus': 0.15,
    'claude-sonnet': 0.03,
    'claude-haiku': 0.003,
    'gpt-4o': 0.025,
    'gpt-4o-mini': 0.0015,
  };

  for (const [key, price] of Object.entries(pricing)) {
    if (m.includes(key)) {
      return {
        estimated_usd: price * pageCount,
        per_page: price,
        provider: m,
      };
    }
  }

  // Local model or unknown — assume free
  return {
    estimated_usd: null,
    per_page: null,
    provider: m || 'unknown',
  };
}
