/**
 * Output normalization for OpenAI-compatible chat completions — Phase 17.2.
 *
 * ONE place that turns a raw `choices[0].message` into the clean answer text.
 * Previously every caller (distiller, vision, lessons rerank, qc answerer, …)
 * did its own ad-hoc `content ?? reasoning_content` with no reasoning stripping
 * — so a reasoning model's chain-of-thought could land in the "answer" that
 * downstream code (or a RAGAS judge) then scored.
 *
 * TWO layers defend against reasoning leak:
 *   1. REQUEST side (chatComplete): send `reasoning_effort:'none'` etc. so the
 *      model spends its token budget on the answer, not the reasoning. This is
 *      the ONLY thing that helps models which dump UNDELIMITED chain-of-thought
 *      into `content` (e.g. LM Studio's gemma-4 freeform markdown reasoning) —
 *      once the budget is gone there is no answer left to recover.
 *   2. RESPONSE side (this module): strip DELIMITED reasoning (`<think>…</think>`,
 *      `reasoning_content`) that some families still emit even with suppression
 *      on (qwen3 / deepseek-r1 / o1-class).
 *
 * extractAnswerText canNOT rescue undelimited reasoning — that is the request
 * layer's job. It handles the delimited/`reasoning_content` cases uniformly.
 *
 * ASSUMPTION: `<think>` / `<reasoning>` / `<thinking>` / `<thought>` tags are
 * reasoning DELIMITERS, never literal answer content. An answer that legitimately
 * discusses such a tag (e.g. a doc about the `<think>` element) would be stripped.
 * Acceptable for technical-RAG answers in this codebase; revisit if a surface
 * starts returning markup-about-reasoning-tags as the substantive answer.
 */

export type RawChatMessage = {
  content?: unknown;
  reasoning_content?: unknown;
} | null | undefined;

const REASONING_TAGS = 'think|thinking|reasoning|thought';

/**
 * Remove delimited reasoning blocks from model text:
 *   - well-formed pairs `<think>…</think>`, `<reasoning>…</reasoning>`, etc.
 *   - a dangling UNCLOSED opener `<think>…` (model truncated mid-thought) →
 *     drop from the opener to end-of-string.
 *
 * Case-insensitive; tags may carry attributes (`<think foo="bar">`). A
 * well-formed answer never contains a lone unclosed reasoning tag, so the
 * unclosed-opener rule is safe.
 */
export function stripReasoningBlocks(text: string): string {
  if (!text) return '';
  // 1. well-formed pairs (non-greedy, dotall via [\s\S]); backref keeps tags matched.
  let out = text.replace(
    new RegExp(`<(${REASONING_TAGS})\\b[^>]*>[\\s\\S]*?<\\/\\1>`, 'gi'),
    '',
  );
  // 2. dangling unclosed opener → strip to end.
  out = out.replace(new RegExp(`<(${REASONING_TAGS})\\b[^>]*>[\\s\\S]*$`, 'i'), '');
  return out;
}

/**
 * Extract the clean answer text from a chat-completion message.
 *
 * Order:
 *   1. `content` with reasoning blocks stripped — the normal path.
 *   2. if that is empty (content was absent OR pure-reasoning), fall back to
 *      `reasoning_content` (also stripped) — last resort for models that put
 *      the whole response there when the budget runs out mid-reasoning.
 *
 * Returns '' when there is nothing usable (caller decides whether that's an
 * error). Never returns the reasoning trace as the answer when real content
 * exists.
 */
export function extractAnswerText(message: RawChatMessage): string {
  if (!message || typeof message !== 'object') return '';
  const rawContent = typeof message.content === 'string' ? message.content : '';
  const cleaned = stripReasoningBlocks(rawContent).trim();
  if (cleaned) return cleaned;
  const rawReasoning =
    typeof message.reasoning_content === 'string' ? message.reasoning_content : '';
  return stripReasoningBlocks(rawReasoning).trim();
}
