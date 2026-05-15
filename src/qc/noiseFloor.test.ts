/**
 * Sprint 12.0.2 /review-impl LOW-4: unit tests for computeNoiseFloor.
 *
 * The function was previously only exercised by the end-to-end --control
 * smoke. If the math silently flipped (e.g. `v2 - v1` instead of
 * `|v2 - v1|`), smoke tests would still pass when back-to-back quality
 * metrics are identical (Δ=0). These tests force differing inputs so a
 * regression can be caught by `npm test`.
 */

import assert from 'node:assert/strict';
import test from 'node:test';

import {
  computeNoiseFloor,
  fmtNoiseFloorValue,
  type NoiseFloorPerSurface,
  type NoiseFloorInput,
} from './noiseFloor.js';

const ZERO_METRICS: NoiseFloorPerSurface = {
  recall_at_5: 0,
  recall_at_10: 0,
  mrr: 0,
  ndcg_at_5: 0,
  ndcg_at_10: 0,
  duplication_rate_at_10: 0,
  duplication_rate_nearsemantic_at_10: 0,
  coverage_pct: 0,
  latency_p50_ms: 0,
  latency_p95_ms: 0,
  latency_mean_ms: 0,
};

function surface(overrides: Partial<NoiseFloorPerSurface> = {}): NoiseFloorInput {
  return { metrics: { ...ZERO_METRICS, ...overrides } };
}

test('computeNoiseFloor: empty inputs → empty output', () => {
  assert.deepEqual(computeNoiseFloor({}, {}), {});
});

test('computeNoiseFloor: both runs identical → all zeros', () => {
  const a = surface({ recall_at_10: 0.9, mrr: 0.76, latency_p95_ms: 500 });
  const result = computeNoiseFloor({ lessons: a }, { lessons: a });
  assert.equal(result.lessons?.recall_at_10, 0);
  assert.equal(result.lessons?.mrr, 0);
  assert.equal(result.lessons?.latency_p95_ms, 0);
});

test('computeNoiseFloor: uses absolute value, not signed delta', () => {
  // Sprint 12.0.2 LOW-4 rationale: a signed-delta bug would pass the
  // "both runs identical" test but fail here. v2 < v1 should still give
  // a POSITIVE noise-floor.
  const a = surface({ recall_at_10: 0.9, latency_p95_ms: 500 });
  const b = surface({ recall_at_10: 0.7, latency_p95_ms: 300 });
  const result = computeNoiseFloor({ lessons: a }, { lessons: b });
  // Floating-point: |0.9 - 0.7| = 0.2 ± ε; use tolerance instead of strictEqual.
  assert.ok(Math.abs((result.lessons?.recall_at_10 ?? -1) - 0.2) < 1e-9, 'must be |0.9 - 0.7| = 0.2, not -0.2');
  assert.equal(result.lessons?.latency_p95_ms, 200, 'integer: must be |500 - 300| = 200');
  // Also verify the reverse direction gives same result (symmetric).
  const reverse = computeNoiseFloor({ lessons: b }, { lessons: a });
  assert.ok(Math.abs((reverse.lessons?.recall_at_10 ?? -1) - 0.2) < 1e-9);
  assert.equal(reverse.lessons?.latency_p95_ms, 200);
});

test('computeNoiseFloor: null in either run → null in output', () => {
  const a = surface({ latency_p95_ms: 500 });
  const b = surface({ latency_p95_ms: null });
  const result = computeNoiseFloor({ lessons: a }, { lessons: b });
  assert.equal(result.lessons?.latency_p95_ms, null);
  // Non-null metrics still compute:
  assert.equal(result.lessons?.recall_at_10, 0);
});

test('computeNoiseFloor: surface missing from one run → surface dropped', () => {
  // Asymmetric surfaces — e.g. control ran `lessons,code` but new only
  // ran `lessons`. Noise-floor is only computed for surfaces in BOTH.
  const lessonsA = surface({ recall_at_10: 0.9 });
  const lessonsB = surface({ recall_at_10: 0.95 });
  const codeA = surface({ recall_at_10: 0.5 });
  const result = computeNoiseFloor(
    { lessons: lessonsA, code: codeA },
    { lessons: lessonsB },
  );
  assert.ok(result.lessons, 'lessons should be computed (present in both)');
  // Floating-point: |0.95 - 0.9| = 0.04999999... — use tolerance
  assert.ok(Math.abs((result.lessons?.recall_at_10 ?? -1) - 0.05) < 1e-9);
  assert.ok(!result.code, 'code should be absent (missing from new run)');
});

test('computeNoiseFloor: multiple surfaces compute independently', () => {
  const result = computeNoiseFloor(
    {
      lessons: surface({ recall_at_10: 0.90, latency_p95_ms: 500 }),
      chunks: surface({ recall_at_10: 1.00, latency_p95_ms: 30 }),
    },
    {
      lessons: surface({ recall_at_10: 0.85, latency_p95_ms: 520 }),
      chunks: surface({ recall_at_10: 1.00, latency_p95_ms: 35 }),
    },
  );
  // Lessons: quality moved, latency moved
  assert.ok(Math.abs((result.lessons?.recall_at_10 ?? -1) - 0.05) < 1e-9);
  assert.equal(result.lessons?.latency_p95_ms, 20);
  // Chunks: quality stable, latency moved
  assert.equal(result.chunks?.recall_at_10, 0);
  assert.equal(result.chunks?.latency_p95_ms, 5);
});

test('computeNoiseFloor: realistic Sprint 12.1a-style numbers', () => {
  // Approximates the 12.1a A/B: quality Δ near-zero, latency Δ ~hundreds of ms
  const control = surface({
    recall_at_10: 0.9412,
    mrr: 0.8971,
    ndcg_at_10: 0.9077,
    duplication_rate_nearsemantic_at_10: 0.4350,
    latency_p95_ms: 6766,
  });
  const anew = surface({
    recall_at_10: 0.9412,
    mrr: 0.8908,
    ndcg_at_10: 0.9020,
    duplication_rate_nearsemantic_at_10: 0,
    latency_p95_ms: 7025,
  });
  const r = computeNoiseFloor({ lessons: control }, { lessons: anew });
  assert.equal(r.lessons?.recall_at_10, 0);
  assert.ok(Math.abs((r.lessons?.mrr ?? -1) - 0.0063) < 1e-9);
  assert.ok(Math.abs((r.lessons?.ndcg_at_10 ?? -1) - 0.0057) < 1e-9);
  assert.equal(r.lessons?.duplication_rate_nearsemantic_at_10, 0.4350);
  assert.equal(r.lessons?.latency_p95_ms, 259);
});

test('fmtNoiseFloorValue: null/undefined → em-dash', () => {
  assert.equal(fmtNoiseFloorValue(null), '—');
  assert.equal(fmtNoiseFloorValue(undefined), '—');
});

test('fmtNoiseFloorValue: integer → no decimal (COSMETIC-2 fix)', () => {
  // Pre-fix: latency_p95 Δ=52 rendered as "52.0000" — odd for integer ms
  assert.equal(fmtNoiseFloorValue(52), '52');
  assert.equal(fmtNoiseFloorValue(0), '0');
  assert.equal(fmtNoiseFloorValue(7025), '7025');
});

test('fmtNoiseFloorValue: fractional → 4 decimals', () => {
  assert.equal(fmtNoiseFloorValue(0.4350), '0.4350');
  assert.equal(fmtNoiseFloorValue(0.000123), '0.0001');
  assert.equal(fmtNoiseFloorValue(1.5), '1.5000');
});
