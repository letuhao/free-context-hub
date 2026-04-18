/**
 * Phase 12 Sprint 12.0 — diffBaselines unit tests (MED-6 from adversarial review).
 *
 * The diff generator is pure logic + file I/O. It will be cited by every
 * downstream Phase-12 sprint as evidence of improvement. A silent drift in
 * DIRECTION / regression rules / emoji mapping / pctChange math would
 * invalidate every delta we post. These tests lock the semantics.
 */

import assert from 'node:assert/strict';
import test from 'node:test';

import {
  emoji,
  fmt,
  pctChange,
  breachedRegression,
  diffSurface,
  renderDiff,
  DIRECTION,
  REGRESSION_RULES,
  type Metrics,
  type SurfaceAggregate,
  type Archive,
} from './diffBaselines.js';

const ZERO_METRICS: Metrics = {
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

function fixtureAggregate(overrides: Partial<Metrics> = {}, extras: Partial<SurfaceAggregate> = {}): SurfaceAggregate {
  return {
    query_count: 10,
    errors: 0,
    metrics: { ...ZERO_METRICS, ...overrides },
    ...extras,
  };
}

function fixtureArchive(surfaces: Record<string, SurfaceAggregate>, tagSuffix = 'a', schema = '1.0'): Archive {
  return {
    schema_version: schema,
    tag: `fixture-${tagSuffix}`,
    git_commit: `abc${tagSuffix}`,
    surfaces,
  };
}

test('emoji: direction × delta-sign × abs-pct decision table', async (t) => {
  await t.test('<1% absolute change → unchanged (regardless of direction)', () => {
    assert.equal(emoji(+0.5, +1, 0.5), '⚪');
    assert.equal(emoji(-0.5, -1, 0.5), '⚪');
    assert.equal(emoji(0, +1, 0), '⚪');
  });
  await t.test('improve-up metric, positive delta → green', () => {
    assert.equal(emoji(+0.1, +1, 10), '🟢');
  });
  await t.test('improve-up metric, negative delta → red', () => {
    assert.equal(emoji(-0.1, +1, 10), '🔴');
  });
  await t.test('improve-down metric (latency), negative delta → green', () => {
    assert.equal(emoji(-20, -1, 20), '🟢');
  });
  await t.test('improve-down metric (latency), positive delta → red', () => {
    assert.equal(emoji(+20, -1, 20), '🔴');
  });
});

test('DIRECTION map invariants', async (t) => {
  await t.test('all quality metrics are improve-up (+1)', () => {
    const up = ['recall_at_5', 'recall_at_10', 'mrr', 'ndcg_at_5', 'ndcg_at_10', 'coverage_pct'] as const;
    for (const k of up) assert.equal(DIRECTION[k], 1, `${k} should be +1 (higher is better)`);
  });
  await t.test('all latency + dup-rate metrics are improve-down (-1)', () => {
    const down = [
      'duplication_rate_at_10',
      'duplication_rate_nearsemantic_at_10',
      'latency_p50_ms',
      'latency_p95_ms',
      'latency_mean_ms',
    ] as const;
    for (const k of down) assert.equal(DIRECTION[k], -1, `${k} should be -1 (lower is better)`);
  });
});

test('fmt: nulls and integers', async (t) => {
  await t.test('null → em-dash', () => assert.equal(fmt(null), '—'));
  await t.test('undefined → em-dash (old archive missing new field)', () => assert.equal(fmt(undefined), '—'));
  await t.test('integer → no decimal', () => assert.equal(fmt(42), '42'));
  await t.test('zero → "0"', () => assert.equal(fmt(0), '0'));
  await t.test('fraction → 4 decimals', () => assert.equal(fmt(0.1234567), '0.1235'));
});

test('pctChange: edge cases', async (t) => {
  await t.test('null input → null', () => {
    assert.equal(pctChange(null, 1), null);
    assert.equal(pctChange(1, null), null);
    assert.equal(pctChange(null, null), null);
  });
  await t.test('undefined input → null (forward-compat with older archives)', () => {
    assert.equal(pctChange(undefined, 1), null);
    assert.equal(pctChange(1, undefined), null);
    assert.equal(pctChange(undefined, undefined), null);
  });
  await t.test('from=0, to=0 → 0 (no change)', () => {
    assert.equal(pctChange(0, 0), 0);
  });
  await t.test('from=0, to≠0 → null (∞; undefined pct)', () => {
    assert.equal(pctChange(0, 0.5), null);
    assert.equal(pctChange(0, -0.5), null);
  });
  await t.test('50% rise', () => {
    assert.equal(pctChange(100, 150), 50);
  });
  await t.test('50% drop', () => {
    assert.equal(pctChange(100, 50), -50);
  });
  await t.test('negative-from baseline uses |from| in denominator', () => {
    // Guards against sign flip when a metric is allowed to go negative in future.
    assert.equal(pctChange(-10, -5), 50);
  });
});

test('breachedRegression: threshold rules', async (t) => {
  await t.test('nDCG@10 drop of exactly 0.05 → breach (<=)', () => {
    assert.equal(breachedRegression('ndcg_at_10', 0.80, 0.75), true);
  });
  await t.test('nDCG@10 drop of 0.04 → no breach', () => {
    assert.equal(breachedRegression('ndcg_at_10', 0.80, 0.76), false);
  });
  await t.test('nDCG@10 improvement → no breach', () => {
    assert.equal(breachedRegression('ndcg_at_10', 0.70, 0.90), false);
  });
  await t.test('recall@10 drop of 0.07 → breach', () => {
    assert.equal(breachedRegression('recall_at_10', 1.0, 0.93), true);
  });
  await t.test('p95 rise from 100→120 (+20%) → breach (>=)', () => {
    assert.equal(breachedRegression('latency_p95_ms', 100, 120), true);
  });
  await t.test('p95 rise from 100→119 (+19%) → no breach', () => {
    assert.equal(breachedRegression('latency_p95_ms', 100, 119), false);
  });
  await t.test('p95 improvement (drop) → no breach', () => {
    assert.equal(breachedRegression('latency_p95_ms', 100, 50), false);
  });
  await t.test('metric without a rule → never breach', () => {
    assert.equal(breachedRegression('mrr', 1, 0), false);
  });
  await t.test('null values → no breach (insufficient data)', () => {
    assert.equal(breachedRegression('latency_p95_ms', null, 100), false);
    assert.equal(breachedRegression('ndcg_at_10', 0.8, null), false);
  });
});

test('diffSurface: missing / new / removed surface rendering', async (t) => {
  await t.test('both missing', () => {
    const { md, regressions } = diffSurface('x', undefined, undefined);
    assert.match(md, /missing from both archives/);
    assert.deepEqual(regressions, []);
  });
  await t.test('new in to', () => {
    const { md } = diffSurface('x', undefined, fixtureAggregate());
    assert.match(md, /new in `to`/);
  });
  await t.test('removed in to', () => {
    const { md } = diffSurface('x', fixtureAggregate(), undefined);
    assert.match(md, /removed in `to`/);
  });
});

test('diffSurface: regressions propagate up', () => {
  const from = fixtureAggregate({ ndcg_at_10: 0.80, recall_at_10: 1.0, latency_p95_ms: 100 });
  const to = fixtureAggregate({ ndcg_at_10: 0.70, recall_at_10: 0.90, latency_p95_ms: 130 });
  const { regressions } = diffSurface('lessons', from, to);
  assert.equal(regressions.length, 3);
  assert.ok(regressions.some((r) => r.includes('ndcg_at_10')));
  assert.ok(regressions.some((r) => r.includes('recall_at_10')));
  assert.ok(regressions.some((r) => r.includes('latency_p95_ms')));
});

test('diffSurface: clean improvement produces no regressions', () => {
  const from = fixtureAggregate({ ndcg_at_10: 0.50, recall_at_10: 0.60, latency_p95_ms: 200 });
  const to = fixtureAggregate({ ndcg_at_10: 0.80, recall_at_10: 0.90, latency_p95_ms: 100 });
  const { regressions } = diffSurface('lessons', from, to);
  assert.deepEqual(regressions, []);
});

test('diffSurface: per-surface project_id line rendered when present', () => {
  const from = fixtureAggregate({}, { project_id: 'proj-a' });
  const to = fixtureAggregate({}, { project_id: 'proj-b' });
  const { md } = diffSurface('lessons', from, to);
  assert.match(md, /project_id: proj-a → proj-b/);
});

test('diffSurface: ∞ rendering when from=0, to≠0', () => {
  const from = fixtureAggregate({ recall_at_10: 0 });
  const to = fixtureAggregate({ recall_at_10: 0.5 });
  const { md } = diffSurface('code', from, to);
  // ∞ in the pct column, 🟢 for improvement (delta sign + direction) even
  // though pct itself is undefined.
  assert.match(md, /\| recall_at_10 \| 0 \| 0\.5000 \| \+0\.5000 \| ∞ \| 🟢 \|/);
});

test('diffSurface: ∞ rendering with regression direction (dup-rate 0→0.5 is 🔴)', () => {
  const from = fixtureAggregate({ duplication_rate_at_10: 0 });
  const to = fixtureAggregate({ duplication_rate_at_10: 0.5 });
  const { md } = diffSurface('lessons', from, to);
  assert.match(md, /\| duplication_rate_at_10 \| 0 \| 0\.5000 \| \+0\.5000 \| ∞ \| 🔴 \|/);
});

test('diffSurface: null latency (no samples) renders as em-dash', () => {
  const from = fixtureAggregate({ latency_p50_ms: null, latency_p95_ms: null, latency_mean_ms: null });
  const to = fixtureAggregate({ latency_p50_ms: 100, latency_p95_ms: 200, latency_mean_ms: 150 });
  const { md } = diffSurface('empty', from, to);
  assert.match(md, /\| latency_p50_ms \| — \| 100 \|/);
});

test('renderDiff: schema-version mismatch banner', () => {
  const a = fixtureArchive({ lessons: fixtureAggregate() }, 'A', '1.0');
  const b = fixtureArchive({ lessons: fixtureAggregate() }, 'B', '2.0');
  const out = renderDiff(a, b);
  assert.match(out, /Schema-version mismatch/);
  assert.match(out, /from=`1\.0` to=`2\.0`/);
});

test('renderDiff: same schema, no banner', () => {
  const a = fixtureArchive({ lessons: fixtureAggregate() }, 'A', '1.0');
  const b = fixtureArchive({ lessons: fixtureAggregate() }, 'B', '1.0');
  const out = renderDiff(a, b);
  assert.doesNotMatch(out, /Schema-version mismatch/);
});

test('renderDiff: no regressions → "(none)"', () => {
  const a = fixtureArchive({ lessons: fixtureAggregate({ ndcg_at_10: 0.80 }) }, 'A');
  const b = fixtureArchive({ lessons: fixtureAggregate({ ndcg_at_10: 0.85 }) }, 'B');
  const out = renderDiff(a, b);
  assert.match(out, /## Regressions flagged\n\n_\(none\)_/);
});

test('REGRESSION_RULES: direction coherence', () => {
  // Rule keys must exist in DIRECTION map; verify no typos.
  for (const k of Object.keys(REGRESSION_RULES)) {
    assert.ok(k in DIRECTION, `regression rule ${k} missing from DIRECTION map`);
  }
});
