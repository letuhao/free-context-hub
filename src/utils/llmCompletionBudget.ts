/**
 * Shared completion token / summary length budgets for FAQ, RAPTOR, distiller compression, etc.
 * Uses rough heuristics (chars/token) — not a tokenizer.
 */

/** Typical mixed code/English; slightly conservative vs 4 chars/token. */
const DEFAULT_CHARS_PER_COMPLETION_TOKEN = 2.75;

export type CompletionBudgetOpts = {
  /** Minimum completion tokens (avoid tiny budgets). */
  minTokens?: number;
  /** Hard cap (VRAM / cost). */
  maxTokens?: number;
  /** Chars per completion token for budgeting. */
  charsPerToken?: number;
};

/**
 * Maps a desired max **output character** length to a completion `max_tokens` budget.
 * Replaces fixed `ceil(maxChars/3)` capped at 1200.
 */
export function completionTokensForOutputChars(
  maxOutputChars: number,
  opts?: CompletionBudgetOpts,
): number {
  const minT = opts?.minTokens ?? 256;
  const maxT = opts?.maxTokens ?? 4096;
  const cpt = opts?.charsPerToken ?? DEFAULT_CHARS_PER_COMPLETION_TOKEN;
  const raw = Math.ceil(Math.max(0, maxOutputChars) / cpt);
  return Math.max(minT, Math.min(maxT, raw));
}

/**
 * Scale how long we want the summary to be based on source document size (characters).
 * Small files → `minOut`; very large files → approach `maxOut` (log curve).
 */
export type ScaledSummaryBudgetOpts = {
  /** Cap source length when scaling (default 2_000_000; set via LLM_SUMMARY_SOURCE_CHAR_CEILING). */
  sourceCharCeiling?: number;
};

export function scaledSummaryCharBudget(
  sourceChars: number,
  minOut: number,
  maxOut: number,
  opts?: ScaledSummaryBudgetOpts,
): number {
  const ceiling = opts?.sourceCharCeiling ?? 2_000_000;
  const lo = Math.max(200, minOut);
  const hi = Math.max(lo, maxOut);
  if (sourceChars <= 0) return lo;
  const s = Math.min(sourceChars, ceiling);
  const t = Math.log10(1 + s / 3500) / Math.log10(1 + 600_000 / 3500);
  const clamped = Math.max(0, Math.min(1, t));
  return Math.round(lo + clamped * (hi - lo));
}

export type ExcerptResult = { text: string; truncated: boolean; omittedChars: number };

/**
 * Keeps head + tail so huge files (e.g. 50k LOC) still fit in one summarization call.
 */
export function excerptForSummarization(fullText: string, maxInputChars: number): ExcerptResult {
  if (fullText.length <= maxInputChars) {
    return { text: fullText, truncated: false, omittedChars: 0 };
  }
  const markerLen = 80;
  const budget = maxInputChars - markerLen;
  const head = Math.floor(budget * 0.72);
  const tail = budget - head;
  const omitted = fullText.length - head - tail;
  const text =
    fullText.slice(0, head) +
    `\n\n[… ${omitted.toLocaleString()} characters omitted from middle …]\n\n` +
    fullText.slice(fullText.length - tail);
  return { text, truncated: true, omittedChars: omitted };
}
