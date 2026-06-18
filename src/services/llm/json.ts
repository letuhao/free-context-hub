/**
 * Robust JSON extraction from LLM output — Phase 17.2.
 *
 * Hardened for reasoning models whose output may contain multiple top-level
 * `{...}` / `[...]` blocks (intermediate thoughts before the final answer).
 * Relocated from the private `distiller.extractJsonObject` so every JSON-mode
 * caller (distiller, lessonImprover, documentLessonGenerator, lessons rerank,
 * retriever rerank) shares ONE parser instead of five divergent regexes.
 *
 * Strategy: strip a markdown code fence if present, otherwise scan all balanced
 * top-level blocks (respecting string literals) and try parsing longest-first.
 */

type Bracket = '{' | '[';
const CLOSE: Record<Bracket, string> = { '{': '}', '[': ']' };

function balancedBlocks(raw: string, open: Bracket): string[] {
  const close = CLOSE[open];
  const blocks: string[] = [];
  let depth = 0;
  let start = -1;
  let inStr = false;
  let escape = false;
  for (let i = 0; i < raw.length; i++) {
    const c = raw[i];
    if (escape) { escape = false; continue; }
    if (c === '\\') { escape = true; continue; }
    if (c === '"') { inStr = !inStr; continue; }
    if (inStr) continue;
    if (c === open) {
      if (depth === 0) start = i;
      depth++;
    } else if (c === close) {
      if (depth > 0) {
        depth--;
        if (depth === 0 && start >= 0) {
          blocks.push(raw.slice(start, i + 1));
          start = -1;
        }
      }
    }
  }
  return blocks;
}

function extract(text: string, open: Bracket): unknown {
  const raw = String(text ?? '').trim();
  const close = CLOSE[open];
  // Strip a fenced ```json … ``` block first.
  const fence = open === '{'
    ? raw.match(/```(?:json)?\s*(\{[\s\S]*?\})\s*```/)
    : raw.match(/```(?:json)?\s*(\[[\s\S]*?\])\s*```/);
  if (fence) {
    try { return JSON.parse(fence[1]); } catch { /* fall through */ }
  }
  // Balanced top-level blocks, longest first (usually the most complete).
  const candidates = balancedBlocks(raw, open).sort((a, b) => b.length - a.length);
  for (const cand of candidates) {
    try { return JSON.parse(cand); } catch { /* try next */ }
  }
  // Legacy fallback: first-open to last-close slice.
  const first = raw.indexOf(open);
  const last = raw.lastIndexOf(close);
  if (first >= 0 && last > first) {
    return JSON.parse(raw.slice(first, last + 1));
  }
  throw new Error(`No parseable JSON ${open === '{' ? 'object' : 'array'} found in model output`);
}

/** Extract the first/longest valid JSON object from model output. Throws if none. */
export function extractJsonObject(text: string): any {
  return extract(text, '{');
}

/** Extract the first/longest valid JSON array from model output. Throws if none. */
export function extractJsonArray(text: string): any {
  return extract(text, '[');
}
