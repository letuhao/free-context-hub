/**
 * Sprint 12.0.2 /review-impl LOW-4: extracted noise-floor helpers into
 * their own module so they can be unit-tested without importing
 * runBaseline.ts (which has a top-level `main()` invocation — importing
 * it from a test file would fire the CLI).
 *
 * Consumers:
 *   - src/qc/runBaseline.ts (generates noise_floor on --control)
 *   - src/qc/diffBaselines.ts (Sprint 12.0.2 review-impl MED-1: use
 *     noise_floor as the signal/noise threshold when both archives
 *     carry it)
 *   - src/qc/noiseFloor.test.ts (unit tests)
 *
 * Pure functions, no I/O.
 */

import type { Surface } from './goldenTypes.js';

/** Per-surface per-metric noise-floor value. null if either run had a
 *  null value for that metric (e.g. zero-sample latency). Values are
 *  absolute deltas: |run2 - run1| between two back-to-back same-code runs. */
export type NoiseFloorPerSurface = {
  recall_at_5: number | null;
  recall_at_10: number | null;
  mrr: number | null;
  ndcg_at_5: number | null;
  ndcg_at_10: number | null;
  duplication_rate_at_10: number | null;
  duplication_rate_nearsemantic_at_10: number | null;
  coverage_pct: number | null;
  latency_p50_ms: number | null;
  latency_p95_ms: number | null;
  latency_mean_ms: number | null;
};

/** Minimal surface-aggregate shape needed for noise-floor computation.
 *  Real shape is richer (per_query, project_id, query_count, etc.) but
 *  only `metrics` is used here; the looser constraint keeps this module
 *  reusable and the unit tests cheap. */
export type NoiseFloorInput = {
  metrics: NoiseFloorPerSurface;
};

/** Pure: compute |second - first| per metric per surface.
 *
 *  Sprint 12.0.2 /review-impl LOW-2: this is defined for N=2 runs only.
 *  A future N-run generalization should switch to max-min or stddev and
 *  live alongside this function as `computeNoiseFloorAcross(runs[])`.
 *
 *  null handling: if either run has a null value for a metric, the
 *  noise-floor for that (surface, metric) is null — no data to compare. */
export function computeNoiseFloor(
  runControl: Partial<Record<Surface, NoiseFloorInput>>,
  runNew: Partial<Record<Surface, NoiseFloorInput>>,
): Partial<Record<Surface, NoiseFloorPerSurface>> {
  const out: Partial<Record<Surface, NoiseFloorPerSurface>> = {};
  const surfaces = new Set<Surface>([
    ...(Object.keys(runControl) as Surface[]),
    ...(Object.keys(runNew) as Surface[]),
  ]);
  for (const s of surfaces) {
    const a = runControl[s];
    const b = runNew[s];
    if (!a || !b) continue;
    const metricKeys = Object.keys(a.metrics) as Array<keyof NoiseFloorPerSurface>;
    const perSurface = {} as NoiseFloorPerSurface;
    for (const key of metricKeys) {
      const v1 = a.metrics[key];
      const v2 = b.metrics[key];
      if (v1 === null || v2 === null) {
        (perSurface as any)[key] = null;
      } else {
        (perSurface as any)[key] = Math.abs(v2 - v1);
      }
    }
    out[s] = perSurface;
  }
  return out;
}

/** Format a metric value for Markdown output.
 *  Integers render plainly (`52`), non-integers get 4 decimal places
 *  (`0.4350`), null/undefined renders as em-dash.
 *  Sprint 12.0.2 /review-impl COSMETIC-2: previously `toFixed(4)` always,
 *  producing `52.0000` for integer latencies. */
export function fmtNoiseFloorValue(v: number | null | undefined): string {
  if (v === null || v === undefined) return '—';
  return Number.isInteger(v) ? String(v) : v.toFixed(4);
}
