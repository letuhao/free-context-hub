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

/** Phase 17.2: synthesizer mode.
 *  - 'standard' = single-shot answer (Phase 16.3 + 17.1 templates)
 *  - 'cove'     = Chain-of-Verification 4-step pipeline (Meta paper)
 */
export type SynthMode = 'standard' | 'cove';

/** Phase 17.2: per-step trace of a CoVe run, kept for full traceability +
 *  scorecard drilldown. Attached to GenResult.cove when synth_mode='cove'. */
export type CoVeTrace = {
  /** Step 1: initial draft answer (same as a 'standard' answer for the row). */
  draft_answer: string;
  /** Step 2: verification questions the LLM generated about its own draft. */
  verification_questions: string[];
  /** Step 3: per-question answer against contexts only. */
  verification_answers: Array<{ question: string; answer: string }>;
  /** Step 4: revised answer using draft + verification answers. This becomes
   *  the official GenResult.generated_answer for CoVe rows. */
  revised_answer: string;
  /** Per-step wall-clock in ms. */
  step_ms: { plan: number; verify: number; revise: number };
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
  /** Phase 17.2: full CoVe trace when synth_mode='cove'. Absent for 'standard'. */
  cove?: CoVeTrace;
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
  /** Phase 17.2: which synth mode this run used. 'standard' or 'cove'. */
  synth_mode: SynthMode;
  /** Phase 17.2: hashes of CoVe-specific templates.
   *  Phase 17.x added verify_one (was inline before).
   *  Present only when synth_mode='cove'. */
  cove_prompt_hashes?: {
    plan_verifications: string;
    verify_one: string;
    revise: string;
  };
};

/** Industry-target thresholds (WARN-only per Phase 16 D5). */
export const DEFAULT_THRESHOLDS = {
  faithfulness_min: 0.9,
  answer_relevancy_min: 0.85,
  context_precision_min: 0.8,
  context_recall_min: 0.75,
  refusal_correctness_min: 0.75,
  /** Phase 17.1 C3: second-judge groundedness. Same target as ragas faithfulness;
   *  divergence between the two signals a measurement issue. */
  groundedness_self_eval_min: 0.85,
  regression_pct_max: 0.05,
} as const;

export type GenThresholds = typeof DEFAULT_THRESHOLDS;

// ─── prompt-hash utility ───

/** Stable short hash of a text blob. Used to pin synthesizer prompts in
 *  baseline manifests so cross-baseline diffs catch silent prompt drift. */
export function promptHash(content: string): string {
  return createHash('sha256').update(content).digest('hex').slice(0, 16);
}
