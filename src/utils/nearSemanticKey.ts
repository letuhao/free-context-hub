/**
 * Near-semantic duplication key shared between retrieval (service layer)
 * and quality metrics (qc layer). Extracted from src/qc/metrics.ts in
 * Sprint 12.1a so the lessons service can dedup using the same key shape
 * the baseline scorecard measures with — then by construction, after
 * Sprint 12.1a's dedup lands, lessons `dup@10 nearsem` drops to 0.
 *
 * Kept in src/utils/ (not src/services or src/qc) so both layers can
 * depend on it without creating a services→qc dependency inversion.
 *
 * Pure functions, no I/O.
 */

/** Normalize a text field for near-duplicate hashing.
 *  - lowercase
 *  - replace any run of digits with a single 'n' (collapses timestamps:
 *    "impexp-1775368159562" → "impexp-n")
 *  - collapse any run of whitespace to a single space
 *  - trim leading/trailing whitespace
 *  Intentionally aggressive: the point is to equate fixture timestamps
 *  and formatting differences that readers would call "the same thing."
 *
 *  Trade-off: "Phase 10"/"Phase 11" both collapse to "phase n"; "v1.2.3"
 *  to "vn.n.n"; numeric-suffix file paths like step1.ts / step2.ts
 *  collapse to "step-n.ts". See friction-classes.md
 *  `digit-collapse-false-positive` for the documented trade-off.
 */
export function normalizeForHash(s: string | null | undefined): string {
  if (s === null || s === undefined) return '';
  return String(s)
    .toLowerCase()
    .replace(/\d+/g, 'n')
    .replace(/\s+/g, ' ')
    .trim();
}

/** Combine title + the first 100 chars of snippet into one near-semantic
 *  key. Both fields go through normalizeForHash. A two-char delimiter
 *  `||` separates the fields so "a||b" and "a|" + "|b" don't collide.
 *
 *  Using snippet[:100] (pre-normalization length) keeps the key stable
 *  when the retriever truncates snippets slightly differently across
 *  runs while still capturing enough content for a meaningful match.
 *
 *  Trap for callers: if BOTH title and snippet are null/undefined, this
 *  returns `"||"` — the same key for every item. Callers that route
 *  empty-content items through `duplicationRateAtK` will see a spurious
 *  100% dup-rate. Adapters must populate at least one field from a
 *  distinguishing source (path, entity id) when the retriever doesn't
 *  return content. See Sprint 12.0.1 HIGH-1 for the cautionary tale.
 */
export function nearSemanticKey(
  title: string | null | undefined,
  snippet: string | null | undefined,
): string {
  const t = normalizeForHash(title);
  const snippetPrefix = (snippet ?? '').slice(0, 100);
  const s = normalizeForHash(snippetPrefix);
  return `${t}||${s}`;
}
