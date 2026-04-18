/**
 * Phase 12 Sprint 12.0 — RAG metrics module.
 *
 * Pure functions, no I/O. Deterministic (all inputs → same outputs) so baseline
 * runs compare cleanly across time. Latency aggregation is the only "fuzzy"
 * metric — reports p50/p95/mean across samples, excluding latency from
 * determinism guarantees in the scorecard docs.
 */

import { recallAtK, mrr } from './goldenTypes.js';
import type { GradedHit } from './goldenTypes.js';

export { recallAtK, mrr };
export type { GradedHit };

/**
 * Normalized Discounted Cumulative Gain @ k.
 *
 * DCG@k = Σ (2^rel_i - 1) / log2(rank_i + 1)   for rank i=1..k
 * IDCG@k = DCG@k computed on the ideal (descending-by-grade) ordering
 * nDCG@k = DCG / IDCG, or 0 if IDCG=0 (no relevant items).
 *
 * Input is grades *in rank order as produced by the retriever*, so position 0
 * is the top-1 result. Only the first k positions are scored.
 */
export function ndcgAtK(gradedHitsInRankOrder: ReadonlyArray<GradedHit>, k: number): number {
  if (k <= 0 || gradedHitsInRankOrder.length === 0) return 0;
  const sliced = gradedHitsInRankOrder.slice(0, k);
  const dcg = sliced.reduce<number>((acc, rel, i) => acc + (Math.pow(2, rel) - 1) / Math.log2(i + 2), 0);
  const ideal = [...sliced].sort((a, b) => b - a);
  const idcg = ideal.reduce<number>((acc, rel, i) => acc + (Math.pow(2, rel) - 1) / Math.log2(i + 2), 0);
  if (idcg === 0) return 0;
  return dcg / idcg;
}

/**
 * Duplication rate over the top-k: fraction of items whose `key` appears more
 * than once in the top-k slice. Denominator is the actual slice length
 * (min(items.length, k)) so small result sets aren't punished for being small.
 *
 * Example: top-10 with keys [a,b,a,c,d,e,f,g,h,i] → 2 items share key 'a' →
 * 2 dup-participants / 10 slots = 0.2.
 *
 * v0 uses exact-match on `key`. Near-duplicate detection (cosine on
 * char-3-gram TF-IDF, threshold 0.9) is a Phase-12 follow-up.
 */
export function duplicationRateAtK(
  items: ReadonlyArray<{ key: string }>,
  k: number,
): number {
  if (k <= 0 || items.length === 0) return 0;
  const sliced = items.slice(0, k);
  const denom = sliced.length;
  if (denom === 0) return 0;
  const counts = new Map<string, number>();
  for (const it of sliced) counts.set(it.key, (counts.get(it.key) ?? 0) + 1);
  let dupParticipants = 0;
  for (const it of sliced) {
    if ((counts.get(it.key) ?? 0) > 1) dupParticipants++;
  }
  return dupParticipants / denom;
}

/**
 * Latency summary across samples using nearest-rank percentile.
 *
 * p50/p95 at percentile p = samples_sorted[ceil(n * p) - 1].
 * For n=100, p=0.5 → idx 49 → value at 50th position.
 * For n=100, p=0.95 → idx 94 → value at 95th position.
 * Empty input → all zeros, n=0.
 */
export function latencySummary(samplesMs: ReadonlyArray<number>): {
  p50: number; p95: number; mean: number; n: number;
} {
  const n = samplesMs.length;
  if (n === 0) return { p50: 0, p95: 0, mean: 0, n: 0 };
  const sorted = [...samplesMs].sort((a, b) => a - b);
  const idxFor = (p: number) => Math.max(0, Math.ceil(n * p) - 1);
  const sum = sorted.reduce((a, b) => a + b, 0);
  return {
    p50: sorted[idxFor(0.5)]!,
    p95: sorted[idxFor(0.95)]!,
    mean: sum / n,
    n,
  };
}

/**
 * Coverage percentage: fraction of queries with ≥1 relevant hit in top-k
 * (caller decides k by constructing `hasRelevantHit` upstream).
 */
export function coveragePct(hasRelevantHit: ReadonlyArray<boolean>): number {
  if (hasRelevantHit.length === 0) return 0;
  const hits = hasRelevantHit.filter(Boolean).length;
  return hits / hasRelevantHit.length;
}

/**
 * Phase 12 Sprint 12.0.1 — near-semantic duplication helpers.
 *
 * Motivation: v0 duplicationRateAtK keyed on entity id (lesson_id etc.)
 * misses same-title-different-UUID noise. The lesson catalog in
 * free-context-hub contains 10+ rows titled "Global search test retry
 * pattern" with distinct UUIDs, and 6+ rows titled "Valid: impexp-<ts>-
 * extra" — the v0 metric reports dup@10=0 for both clusters.
 *
 * nearSemanticKey() + normalizeForHash() give the caller a content-based
 * key so duplicationRateAtK (unchanged) surfaces the real pathology.
 */

/** Normalize a text field for near-duplicate hashing.
 *  - lowercase
 *  - replace any run of digits with a single 'N' (collapses timestamps:
 *    "impexp-1775368159562" → "impexp-N")
 *  - collapse any run of whitespace to a single space
 *  - trim leading/trailing whitespace
 *  Intentionally aggressive: the point is to equate fixture timestamps
 *  and formatting differences that readers would call "the same thing."
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
