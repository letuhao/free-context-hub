/**
 * Phase 16 Sprint 16.3 — types + utilities for gen-eval data on baseline rows.
 *
 * Imported by genPipeline.ts (synthesizer) and runBaseline.ts (integration).
 * See docs/specs/2026-05-23-phase-16-rag-production-design.md §3.3 for the
 * baseline JSON shape.
 */

import { createHash } from 'node:crypto';

/** Per-metric numeric score in [0, 1] or null if the metric failed. */
export type GenScores = Record<string, number | null>;

export type GenContextUsed = {
  /** Stable id of the retrieved item (lesson_id / chunk_id / file path). */
  key: string;
  /** Optional title — useful for diagnostics in the scorecard. */
  title?: string;
  /** First N chars of the text actually passed to the synthesizer. */
  snippet_preview?: string;
  /** Length of the text passed (chars). */
  char_count: number;
};

/** Per-query gen-eval result, attached to PerQuery.generation when present. */
export type GenResult = {
  /** Full synthesizer output (kept for replay + scorecard drilldown). */
  generated_answer: string;
  /** Ordered list of contexts the synthesizer received. */
  contexts_used: GenContextUsed[];
  /** Prompt actually sent to the answerer LLM (for traceability). */
  prompt_used: string;
  /** Wall-clock from start of synth to end (does NOT include judge time). */
  synth_ms: number;
  /** Wall-clock of the judge sidecar call. */
  judge_ms: number;
  /** Scores returned by the judge sidecar; nulls preserved. */
  scores: GenScores;
  /** Judge's per-metric reasoning text (when include_reasons=true). */
  reasons?: Record<string, string>;
  /** Metric names the judge sidecar skipped (e.g. faithfulness on no_answer). */
  skipped?: string[];
  skip_reason?: string | null;
  /** Per-metric thresholds that were breached (WARN list). */
  fail_reasons?: string[];
  /** Set when the synth or judge errored on this row; scores will be null. */
  error?: string;
};

/** Aggregate stats for one metric across all rows on a surface. */
export type GenMetricSummary = {
  mean: number;
  std: number;
  p10: number;
  fail_count: number; // rows below threshold
};

/** Per-surface gen-eval rollup, parallel to SurfaceAggregate.metrics. */
export type GenSurfaceAggregate = {
  rows_with_gt: number; // rows that had ideal_answer
  rows_judged: number; // rows that produced numeric scores (no errors)
  rows_skipped: number; // rows where row had no ideal_answer
  metrics: Record<string, GenMetricSummary>;
};

/** Top-level judge / answerer manifest pinned in each baseline. */
export type GenManifest = {
  judge_endpoint: string;
  judge_model_id: string;
  judge_prompts_hash?: string | null;
  answerer_endpoint: string;
  answerer_model_id: string;
  answerer_temperature: number;
  answerer_seed: number;
  answerer_max_tokens: number;
  synthesizer_prompt_hashes: Record<string, string>; // surface → sha256 of template
};

/** Industry-target thresholds (WARN-only per Phase 16 D5). */
export const DEFAULT_THRESHOLDS = {
  faithfulness_min: 0.9,
  answer_relevancy_min: 0.85,
  context_precision_min: 0.8,
  context_recall_min: 0.75,
  refusal_correctness_min: 0.75,
  regression_pct_max: 0.05,
} as const;

export type GenThresholds = typeof DEFAULT_THRESHOLDS;

// ─── prompt-hash utility ───

/** Stable short hash of a text blob. Used to pin synthesizer prompts in
 *  baseline manifests so cross-baseline diffs catch silent prompt drift. */
export function promptHash(content: string): string {
  return createHash('sha256').update(content).digest('hex').slice(0, 16);
}
