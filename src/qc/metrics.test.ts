/**
 * Phase 12 Sprint 12.0 — metrics module unit tests (RED-phase: these fail until
 * src/qc/metrics.ts exists and implements all 6 functions).
 *
 * Coverage axes per metric:
 *   - empty-input edge case
 *   - single-item case
 *   - all-zero case
 *   - ideal ordering
 *   - inverted / adversarial ordering
 *   - hand-computed fixture with precise expected value
 */

import assert from 'node:assert/strict';
import test from 'node:test';

import {
  recallAtK,
  mrr,
  ndcgAtK,
  duplicationRateAtK,
  latencySummary,
  coveragePct,
} from './metrics.js';

test('recallAtK (re-exported)', async (t) => {
  await t.test('empty ranks → 0', () => {
    assert.equal(recallAtK([], 5), 0);
  });
  await t.test('all zeros → 0', () => {
    assert.equal(recallAtK([0, 0, 0], 5), 0);
  });
  await t.test('hit within k → 1', () => {
    assert.equal(recallAtK([3], 5), 1);
  });
  await t.test('hit outside k → 0', () => {
    assert.equal(recallAtK([7], 5), 0);
  });
});

test('mrr (re-exported)', async (t) => {
  await t.test('empty → 0', () => {
    assert.equal(mrr([]), 0);
  });
  await t.test('all zeros → 0', () => {
    assert.equal(mrr([0, 0]), 0);
  });
  await t.test('best rank=1 → 1.0', () => {
    assert.equal(mrr([1]), 1);
  });
  await t.test('best rank=4 → 0.25', () => {
    assert.equal(mrr([0, 4, 0]), 0.25);
  });
});

test('ndcgAtK', async (t) => {
  await t.test('empty → 0', () => {
    assert.equal(ndcgAtK([], 5), 0);
  });
  await t.test('all zeros → 0', () => {
    assert.equal(ndcgAtK([0, 0, 0], 5), 0);
  });
  await t.test('ideal ordering → 1.0', () => {
    // grades sorted desc are themselves the input ordering
    assert.equal(ndcgAtK([2, 2, 1, 0], 4), 1);
  });
  await t.test('inverted ordering < 1.0', () => {
    const ideal = ndcgAtK([2, 2, 1, 0], 4);
    const inverted = ndcgAtK([0, 1, 2, 2], 4);
    assert.equal(ideal, 1);
    assert.ok(inverted < ideal);
    assert.ok(inverted > 0);
  });
  await t.test('hand-computed fixture [2,0,1] k=3', () => {
    // DCG = (2^2-1)/log2(2) + 0 + (2^1-1)/log2(4) = 3/1 + 0 + 1/2 = 3.5
    // IDCG = (2^2-1)/log2(2) + (2^1-1)/log2(3) + 0 = 3 + 1/1.58496... = 3.6309...
    // nDCG = 3.5 / 3.6309 ≈ 0.9640
    const got = ndcgAtK([2, 0, 1], 3);
    assert.ok(got > 0.96 && got < 0.97, `expected ~0.9640, got ${got}`);
  });
  await t.test('k truncates input — k=3 sees only top-3, k=4 sees the perfect rank-4 miss', () => {
    // Input [1,0,0,2]: a grade-2 hit is buried at rank 4.
    // At k=3 the retriever "looks perfect" within what's visible: DCG and IDCG
    //   both computed over [1,0,0] → nDCG=1.0.
    // At k=4 the ideal becomes [2,1,0,0] while the actual is [1,0,0,2] →
    //   nDCG drops substantially, exposing the rank-order problem.
    const atK3 = ndcgAtK([1, 0, 0, 2], 3);
    const atK4 = ndcgAtK([1, 0, 0, 2], 4);
    assert.equal(atK3, 1);
    assert.ok(atK4 < 0.75, `k=4 should penalize buried perfect hit, got ${atK4}`);
    assert.ok(atK4 > 0.55, `k=4 nDCG should still be positive, got ${atK4}`);
  });
});

test('duplicationRateAtK', async (t) => {
  await t.test('empty → 0', () => {
    assert.equal(duplicationRateAtK([], 5), 0);
  });
  await t.test('all distinct → 0', () => {
    const items = [{ key: 'a' }, { key: 'b' }, { key: 'c' }];
    assert.equal(duplicationRateAtK(items, 10), 0);
  });
  await t.test('all identical → 1.0', () => {
    const items = Array.from({ length: 10 }, () => ({ key: 'x' }));
    assert.equal(duplicationRateAtK(items, 10), 1);
  });
  await t.test('one pair in top-10 → 0.2', () => {
    const items = [
      { key: 'a' }, { key: 'b' }, { key: 'a' },
      { key: 'c' }, { key: 'd' }, { key: 'e' },
      { key: 'f' }, { key: 'g' }, { key: 'h' }, { key: 'i' },
    ];
    assert.equal(duplicationRateAtK(items, 10), 0.2);
  });
  await t.test('k smaller than items truncates', () => {
    const items = [{ key: 'a' }, { key: 'a' }, { key: 'b' }];
    // top-2 = [a, a] → both are dup-participants → 2/2 = 1.0
    assert.equal(duplicationRateAtK(items, 2), 1);
    // top-3 = [a, a, b] → 2 dup participants / 3 = 0.6667
    const r3 = duplicationRateAtK(items, 3);
    assert.ok(Math.abs(r3 - 2 / 3) < 1e-9, `expected 0.6667, got ${r3}`);
  });
});

test('latencySummary', async (t) => {
  await t.test('empty → all zeros, n=0', () => {
    const s = latencySummary([]);
    assert.deepEqual(s, { p50: 0, p95: 0, mean: 0, n: 0 });
  });
  await t.test('single sample → p50=p95=mean=sample', () => {
    const s = latencySummary([100]);
    assert.deepEqual(s, { p50: 100, p95: 100, mean: 100, n: 1 });
  });
  await t.test('1..100 → p50=50, p95=95', () => {
    const s = latencySummary(Array.from({ length: 100 }, (_, i) => i + 1));
    // Using nearest-rank percentile: p50 of 100 samples = index ceil(100*0.5)-1 = 49 → 50
    // p95 = index ceil(100*0.95)-1 = 94 → 95
    assert.equal(s.p50, 50);
    assert.equal(s.p95, 95);
    assert.equal(s.mean, 50.5);
    assert.equal(s.n, 100);
  });
  await t.test('unsorted input tolerated', () => {
    const s = latencySummary([5, 1, 3, 2, 4]);
    assert.equal(s.p50, 3);
    assert.equal(s.mean, 3);
    assert.equal(s.n, 5);
  });
});

test('coveragePct', async (t) => {
  await t.test('empty → 0', () => {
    assert.equal(coveragePct([]), 0);
  });
  await t.test('all true → 1.0', () => {
    assert.equal(coveragePct([true, true, true]), 1);
  });
  await t.test('all false → 0', () => {
    assert.equal(coveragePct([false, false]), 0);
  });
  await t.test('3/5 → 0.6', () => {
    assert.equal(coveragePct([true, false, true, true, false]), 0.6);
  });
});
