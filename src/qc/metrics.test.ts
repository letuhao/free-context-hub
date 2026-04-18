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
  normalizeForHash,
  nearSemanticKey,
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

test('normalizeForHash (Sprint 12.0.1)', async (t) => {
  await t.test('null/undefined/empty → empty string', () => {
    assert.equal(normalizeForHash(null), '');
    assert.equal(normalizeForHash(undefined), '');
    assert.equal(normalizeForHash(''), '');
  });
  await t.test('lowercases', () => {
    assert.equal(normalizeForHash('Global Search TEST'), 'global search test');
  });
  await t.test('collapses digit runs to single N (timestamp-invariant)', () => {
    assert.equal(normalizeForHash('impexp-1775368159562'), 'impexp-n');
    assert.equal(normalizeForHash('impexp-1775368419347'), 'impexp-n');
    // Two distinct numbers collapse to two separate Ns:
    assert.equal(normalizeForHash('foo 123 bar 456'), 'foo n bar n');
  });
  await t.test('collapses whitespace runs', () => {
    assert.equal(normalizeForHash('foo  \t\n  bar'), 'foo bar');
  });
  await t.test('trims leading/trailing whitespace', () => {
    assert.equal(normalizeForHash('  hello  '), 'hello');
  });
  await t.test('combined: timestamp + case + whitespace', () => {
    const a = 'Valid: impexp-1775368159562-extra';
    const b = 'VALID:    impexp-1775368419347-EXTRA';
    assert.equal(normalizeForHash(a), 'valid: impexp-n-extra');
    assert.equal(normalizeForHash(a), normalizeForHash(b));
  });
});

test('nearSemanticKey (Sprint 12.0.1)', async (t) => {
  await t.test('null inputs → empty-field key', () => {
    assert.equal(nearSemanticKey(null, null), '||');
    assert.equal(nearSemanticKey(undefined, undefined), '||');
    assert.equal(nearSemanticKey('', ''), '||');
  });
  await t.test('identical title + snippet → identical key', () => {
    const k1 = nearSemanticKey('Global search test retry pattern', 'Use exponential backoff for retry');
    const k2 = nearSemanticKey('Global search test retry pattern', 'Use exponential backoff for retry');
    assert.equal(k1, k2);
  });
  await t.test('timestamp-variant titles collapse to same key (the Valid: impexp cluster)', () => {
    const k1 = nearSemanticKey(
      'Valid: impexp-1775368159562-extra',
      'The provided text is a title and body for an issue or task.',
    );
    const k2 = nearSemanticKey(
      'Valid: impexp-1775368419347-extra',
      'The provided text is a title and body for an issue or task.',
    );
    assert.equal(k1, k2, 'timestamp-varying fixtures must collapse to one near-semantic key');
  });
  await t.test('different real content → different keys', () => {
    const k1 = nearSemanticKey('pg UUID cast returns canonical lowercase', 'map keys built from pg RETURNING need .toLowerCase()');
    const k2 = nearSemanticKey('undici userland version must match Node bundled', 'bumping to 7+ breaks the pinned Agent Dispatcher interface');
    assert.notEqual(k1, k2);
  });
  await t.test('delimiter prevents title/snippet collision', () => {
    // Without an unambiguous delimiter, hash("ab", "c") would equal hash("a", "bc").
    const k1 = nearSemanticKey('ab', 'c');
    const k2 = nearSemanticKey('a', 'bc');
    assert.notEqual(k1, k2);
  });
  await t.test('snippet truncated at 100 chars (characters past the cap do not affect key)', () => {
    const longA = 'x'.repeat(100) + 'tail-A';
    const longB = 'x'.repeat(100) + 'tail-B';
    assert.equal(nearSemanticKey('same title', longA), nearSemanticKey('same title', longB));
  });
  await t.test('snippet up-to-100-chars DOES affect key (cap is 100 not 0)', () => {
    const a = 'a'.repeat(99) + 'X';
    const b = 'a'.repeat(99) + 'Y';
    assert.notEqual(nearSemanticKey('same title', a), nearSemanticKey('same title', b));
  });
  await t.test('duplicationRateAtK with nearSemanticKey catches the v0-blind pathology', () => {
    // Simulated lesson-search top-5 where all titles are identical but UUIDs differ:
    const items = [
      { lesson_id: 'aaaa', title: 'Global search test retry pattern', snippet: 'Use exponential backoff for retry' },
      { lesson_id: 'bbbb', title: 'Global search test retry pattern', snippet: 'Use exponential backoff for retry' },
      { lesson_id: 'cccc', title: 'Global search test retry pattern', snippet: 'Use exponential backoff for retry' },
      { lesson_id: 'dddd', title: 'Real distinct lesson', snippet: 'Something genuinely different' },
      { lesson_id: 'eeee', title: 'Another real one', snippet: 'Also unique content here' },
    ];
    // v0 metric: keys are UUIDs, all distinct → 0
    const v0 = duplicationRateAtK(items.map((x) => ({ key: x.lesson_id })), 10);
    assert.equal(v0, 0, 'v0 should report 0 (UUIDs all distinct)');
    // v1 metric: keys are nearSemanticKey(title, snippet) → 3 dup participants out of 5 = 0.6
    const v1 = duplicationRateAtK(items.map((x) => ({ key: nearSemanticKey(x.title, x.snippet) })), 10);
    assert.equal(v1, 0.6, 'v1 should surface the 3-member cluster as 0.6 dup participation');
  });
});
