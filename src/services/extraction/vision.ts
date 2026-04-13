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
}

/**
 * Extract content from a single page image using a vision model.
 * Throws on network failure or non-200 response.
 */
export async function extractPageVision(params: {
  imagePng: Buffer;
  /** Optional custom prompt; defaults to the structured-markdown prompt */
  prompt?: string;
  /** Optional max tokens for the response (default 4096) */
  maxTokens?: number;
  /** AbortSignal for cancellation */
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
    temperature: 0.2,
    max_tokens: params.maxTokens ?? 4096,
  };

  const url = `${baseUrl}/v1/chat/completions`;
  logger.info(
    { model, url, imageBytes: params.imagePng.length, maxTokens: params.maxTokens ?? 4096 },
    'vision extraction request',
  );

  const res = await fetch(url, {
    method: 'POST',
    headers,
    body: JSON.stringify(body),
    signal: params.signal,
  });

  if (!res.ok) {
    const txt = await res.text().catch(() => '');
    throw new Error(`Vision model returned HTTP ${res.status}: ${txt.slice(0, 300)}`);
  }

  const json = (await res.json()) as any;
  // Some thinking models put text in content, others in reasoning_content.
  // We prefer content if non-empty, otherwise fall back to reasoning_content.
  let markdown: string =
    json?.choices?.[0]?.message?.content ??
    json?.choices?.[0]?.message?.reasoning_content ??
    '';
  markdown = String(markdown).trim();

  // Strip outer ```markdown ... ``` fences if the model wrapped its output
  if (markdown.startsWith('```')) {
    const lines = markdown.split('\n');
    if (lines[0].match(/^```\w*$/) && lines[lines.length - 1].trim() === '```') {
      markdown = lines.slice(1, -1).join('\n');
    }
  }

  if (!markdown) {
    throw new Error('Vision model returned empty response');
  }

  const usage = json?.usage;
  logger.info(
    { model, chars: markdown.length, usage },
    'vision extraction complete',
  );

  return {
    markdown,
    usage: usage ? { prompt_tokens: usage.prompt_tokens, completion_tokens: usage.completion_tokens, total_tokens: usage.total_tokens } : undefined,
  };
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
