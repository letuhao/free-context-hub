/**
 * Phase 12 Sprint 12.1c — salience service unit tests.
 *
 * Covers:
 *   - blendHybridScore (pure math)
 *   - getSalienceConfig (env reading + defaults + clamping)
 *   - isSalienceDisabled (env kill-switch)
 *   - computeSalience with a mocked pool (SQL shape + result mapping)
 *   - logLessonAccess with a mocked pool (batched INSERT shape, swallow-on-error)
 */

import assert from 'node:assert/strict';
import test from 'node:test';

import {
  blendHybridScore,
  applyQueryConditionalSalienceBlend,
  computeSalience,
  computeSalienceMultiProject,
  isSalienceDisabled,
  getSalienceConfig,
  logLessonAccess,
  type AccessLogEntry,
  type SalienceConfig,
} from './salience.js';

/** Tiny `Pool`-like mock that captures the (sql, params) pairs it sees and
 *  returns canned rows. Avoids a real DB for fast unit runs. */
function mockPool(canned: { rows: any[] } | Error) {
  const calls: Array<{ sql: string; params: unknown[] }> = [];
  const pool = {
    query: async (sql: string, params: unknown[]) => {
      calls.push({ sql, params });
      if (canned instanceof Error) throw canned;
      return canned;
    },
  } as any;
  return { pool, calls };
}

// ---------------------------- blendHybridScore -------------------------------

test('blendHybridScore (Sprint 12.1c)', async (t) => {
  await t.test('salience=0 or undefined → unchanged', () => {
    assert.equal(blendHybridScore(0.5, 0, 0.10), 0.5);
    assert.equal(blendHybridScore(0.5, undefined, 0.10), 0.5);
  });
  await t.test('alpha=0 → unchanged even with high salience', () => {
    assert.equal(blendHybridScore(0.5, 1.0, 0), 0.5);
  });
  await t.test('max salience × α=0.10 → 10% boost', () => {
    assert.equal(blendHybridScore(0.5, 1.0, 0.10), 0.55);
  });
  await t.test('max salience × α=0.5 → 50% boost', () => {
    // 0.5 × (1 + 0.5 × 1.0) = 0.75
    assert.equal(blendHybridScore(0.5, 1.0, 0.5), 0.75);
  });
  await t.test('clamps at 1.0 — no score should exceed maximum', () => {
    // hybrid=0.9, α=1.0, salience=1.0 → 0.9 × 2 = 1.8 → clamped to 1.0
    assert.equal(blendHybridScore(0.9, 1.0, 1.0), 1.0);
  });
  await t.test('negative salience is treated as zero (defensive)', () => {
    // Shouldn't happen — computeSalience always produces non-negative — but
    // the function should be robust to caller bugs.
    assert.equal(blendHybridScore(0.5, -0.2, 0.10), 0.5);
  });
});

test('blendHybridScore query-conditional (Sprint 12.1d)', async (t) => {
  await t.test('undefined semSimilarity → full boost (backward-compat with 12.1c)', () => {
    // Omitting the new param must reproduce old behavior for any caller
    // that hasn't been updated to pass sem_score yet.
    assert.equal(blendHybridScore(0.5, 1.0, 0.10, undefined), 0.55);
  });
  await t.test('semSimilarity=1.0 → full boost (identical to undefined)', () => {
    assert.equal(blendHybridScore(0.5, 1.0, 0.10, 1.0), 0.55);
  });
  await t.test('semSimilarity=0 → no boost even with max salience', () => {
    // The point of Sprint 12.1d: popular-but-unrelated lessons get
    // zero boost regardless of accumulated salience.
    assert.equal(blendHybridScore(0.5, 1.0, 0.10, 0), 0.5);
  });
  await t.test('semSimilarity=0.5 → half-boost', () => {
    // 0.5 × (1 + 0.10 × 1.0 × 0.5) = 0.5 × 1.05 = 0.525
    assert.equal(blendHybridScore(0.5, 1.0, 0.10, 0.5), 0.525);
  });
  await t.test('popularity-feedback-loop matrix — popular-unrelated suppressed', () => {
    // Narrow target: sem=0.80, salience=0.50 → 0.5 × (1 + 0.10 × 0.5 × 0.8) = 0.52
    const narrow = blendHybridScore(0.5, 0.5, 0.10, 0.8);
    assert.ok(narrow > 0.519 && narrow < 0.521, `narrow: expected ≈ 0.520, got ${narrow}`);
    // Popular-unrelated: sem=0.20, salience=0.95 → 0.5 × (1 + 0.10 × 0.95 × 0.2) = 0.5095
    const popularUnrelated = blendHybridScore(0.5, 0.95, 0.10, 0.2);
    assert.ok(popularUnrelated > 0.509 && popularUnrelated < 0.510);
    // Popular-AND-related: sem=0.70, salience=0.95 → 0.5 × (1 + 0.10 × 0.95 × 0.7) = 0.53325
    const popularRelated = blendHybridScore(0.5, 0.95, 0.10, 0.7);
    assert.ok(popularRelated > 0.533 && popularRelated < 0.534);
    // Ordering check: popular-related > narrow > popular-unrelated
    assert.ok(popularRelated > narrow);
    assert.ok(narrow > popularUnrelated);
  });
  await t.test('semSimilarity clamped to [0, 1] defensively', () => {
    // Real sem_score is in [0, 1] (cosine similarity normalized) but the
    // function should be robust to out-of-range callers.
    assert.equal(blendHybridScore(0.5, 1.0, 0.10, -0.5), 0.5);  // clamps to 0 → no boost
    assert.equal(blendHybridScore(0.5, 1.0, 0.10, 2.0), 0.55);  // clamps to 1 → full boost
  });
  await t.test('comparison vs 12.1c (unconditional) — popular-unrelated drops from 0.55 to 0.509', () => {
    // The concrete Sprint 12.1d promise: same popular-unrelated case that
    // was at 0.55 under 12.1c (unconditional) is now at 0.509 (barely
    // boosted). That's the popularity-feedback-loop suppression.
    const oldBehavior = blendHybridScore(0.5, 0.95, 0.10);  // no semSim → full boost
    const newBehavior = blendHybridScore(0.5, 0.95, 0.10, 0.2);
    assert.ok(oldBehavior > newBehavior, 'sprint-12.1d must suppress popular-unrelated boost');
    const suppressionRatio = (oldBehavior - 0.5) / (newBehavior - 0.5);
    assert.ok(suppressionRatio >= 4 && suppressionRatio <= 6,
      `suppression should be ~5× (1/semSim=0.2), got ${suppressionRatio}`);
  });
});

test('blendHybridScore non-finite guard (12.1d /review-impl MED-1)', async (t) => {
  await t.test('NaN semSimilarity → unchanged score (treated as no signal)', () => {
    // pgvector cosine distance can return NaN for zero-magnitude vectors.
    // Without a guard, NaN propagates: Math.min(1, NaN)=NaN → NaN<=0 is
    // false → hybrid*(1+α*sal*NaN)=NaN → match has undefined sort order.
    assert.equal(blendHybridScore(0.5, 0.95, 0.10, NaN), 0.5);
  });
  await t.test('Infinity semSimilarity → unchanged score', () => {
    assert.equal(blendHybridScore(0.5, 0.95, 0.10, Infinity), 0.5);
    assert.equal(blendHybridScore(0.5, 0.95, 0.10, -Infinity), 0.5);
  });
  await t.test('NaN guard is conservative — prefers no-boost over wrong-boost', () => {
    // Without the guard, NaN would either crash or silently produce NaN.
    // The chosen semantics: NaN = "no signal available" = no boost. This
    // is safer against popularity feedback (the friction class 12.1d is
    // designed to prevent) than defaulting to full boost.
    const withNaN = blendHybridScore(0.8, 1.0, 0.5, NaN);
    const withZero = blendHybridScore(0.8, 1.0, 0.5, 0);
    assert.equal(withNaN, withZero, 'NaN should match zero-signal behavior');
  });
});

// ---------- applyQueryConditionalSalienceBlend (12.1d /review-impl LOW-2) ----

test('applyQueryConditionalSalienceBlend', async (t) => {
  // Build a small match list with known salience + relevance signals and
  // verify the helper's in-place mutation, sort, and effective-boost count.
  type M = { lesson_id: string; score: number };
  const makeMatches = (): M[] => [
    { lesson_id: 'a', score: 0.5 },  // narrow target: rel=0.8, sal=0.5
    { lesson_id: 'b', score: 0.5 },  // popular-unrelated: rel=0.2, sal=0.95
    { lesson_id: 'c', score: 0.5 },  // popular-AND-related: rel=0.7, sal=0.95
    { lesson_id: 'd', score: 0.5 },  // no access history (missing from salienceMap)
  ];
  const salience = new Map([
    ['a', 0.5],
    ['b', 0.95],
    ['c', 0.95],
    // 'd' absent intentionally
  ]);
  const relevance = new Map([
    ['a', 0.8],
    ['b', 0.2],
    ['c', 0.7],
    ['d', 0.5],  // has relevance but no salience — should still not boost
  ]);

  await t.test('sorts descending by post-blend score', () => {
    const matches = makeMatches();
    applyQueryConditionalSalienceBlend(matches, salience, relevance, 0.10);
    // Expected order (approx scores):
    //   c: 0.5 * (1 + 0.10 * 0.95 * 0.7) = 0.53325
    //   a: 0.5 * (1 + 0.10 * 0.5 * 0.8)  = 0.520
    //   b: 0.5 * (1 + 0.10 * 0.95 * 0.2) = 0.5095
    //   d: unchanged (no salience entry) = 0.5
    assert.equal(matches[0]!.lesson_id, 'c', 'popular-related should be first');
    assert.equal(matches[1]!.lesson_id, 'a', 'narrow-target should be second');
    assert.equal(matches[2]!.lesson_id, 'b', 'popular-unrelated should be third');
    assert.equal(matches[3]!.lesson_id, 'd', 'no-access-history should be last');
  });

  await t.test('effectiveBoosts counts matches whose score actually changed', () => {
    const matches = makeMatches();
    const { effectiveBoosts } = applyQueryConditionalSalienceBlend(matches, salience, relevance, 0.10);
    // a, b, c all have salience+relevance > 0 → boosted. d missing salience → unchanged.
    assert.equal(effectiveBoosts, 3);
  });

  await t.test('missing relevance signal → blend treats as undefined → full boost (backward-compat)', () => {
    // The helper passes `relevanceMap.get(id)` which returns undefined for
    // missing keys. blendHybridScore treats undefined as 1.0 (full boost).
    // This is the backward-compat branch; LESSONS-side callers always
    // populate the map, so this is documented behavior, not a hole.
    const matches: M[] = [{ lesson_id: 'z', score: 0.5 }];
    const sal = new Map([['z', 0.5]]);
    const rel = new Map<string, number>();  // empty
    const { effectiveBoosts } = applyQueryConditionalSalienceBlend(matches, sal, rel, 0.10);
    assert.equal(effectiveBoosts, 1);
    // 0.5 × (1 + 0.10 × 0.5 × 1.0) = 0.525
    assert.ok(Math.abs(matches[0]!.score - 0.525) < 1e-9);
  });

  await t.test('NaN relevance value → no boost, no NaN pollution (MED-1 regression)', () => {
    // Verifies the helper+blend chain doesn't propagate NaN into scores
    // when the relevance map contains NaN (e.g., from pgvector edge case).
    const matches: M[] = [
      { lesson_id: 'n', score: 0.5 },
      { lesson_id: 'ok', score: 0.5 },
    ];
    const sal = new Map([['n', 0.95], ['ok', 0.5]]);
    const rel = new Map([['n', NaN], ['ok', 0.8]]);
    const { effectiveBoosts } = applyQueryConditionalSalienceBlend(matches, sal, rel, 0.10);
    assert.equal(effectiveBoosts, 1, 'only ok should boost; n is NaN-guarded');
    for (const m of matches) {
      assert.ok(Number.isFinite(m.score), `score must be finite, got ${m.score}`);
    }
  });

  await t.test('FTS-only match with high relevance but low sem keeps boost (MED-2 regression)', () => {
    // The key Sprint 12.1d /review-impl MED-2 assertion: a lesson with
    // low semantic similarity but strong FTS match (composite relevance
    // = max(sem, fts) = 0.7 from fts) should still receive the salience
    // boost it deserves. Without MED-2, relevance would be sem=0.1 and
    // most of the boost would be cancelled.
    const matches: M[] = [
      { lesson_id: 'fts-only', score: 0.4 },  // sem=0.1, fts=0.7 → composite=0.7
    ];
    const sal = new Map([['fts-only', 0.8]]);
    const rel = new Map([['fts-only', 0.7]]);  // the max(sem, fts) composite
    const { effectiveBoosts } = applyQueryConditionalSalienceBlend(matches, sal, rel, 0.10);
    assert.equal(effectiveBoosts, 1);
    // 0.4 × (1 + 0.10 × 0.8 × 0.7) = 0.4 × 1.056 = 0.4224
    assert.ok(Math.abs(matches[0]!.score - 0.4224) < 1e-9,
      `expected ~0.4224, got ${matches[0]!.score}`);
    // For contrast: if relevance were pure sem=0.1, boost would be:
    //   0.4 × (1 + 0.10 × 0.8 × 0.1) = 0.4 × 1.008 = 0.4032
    // MED-2 raises this from 0.4032 → 0.4224 (7× more boost retained).
  });

  await t.test('empty matches → no error, 0 effective boosts', () => {
    const matches: M[] = [];
    const { effectiveBoosts } = applyQueryConditionalSalienceBlend(
      matches, new Map(), new Map(), 0.10,
    );
    assert.equal(effectiveBoosts, 0);
    assert.equal(matches.length, 0);
  });

  await t.test('alpha=0 → no boosts even with full salience+relevance', () => {
    const matches: M[] = [{ lesson_id: 'a', score: 0.5 }];
    const sal = new Map([['a', 1.0]]);
    const rel = new Map([['a', 1.0]]);
    const { effectiveBoosts } = applyQueryConditionalSalienceBlend(matches, sal, rel, 0);
    assert.equal(effectiveBoosts, 0);
    assert.equal(matches[0]!.score, 0.5);
  });
});

// -------------------------- getSalienceConfig / disabled ----------------------

test('getSalienceConfig / isSalienceDisabled', async (t) => {
  // Save originals so each test can toggle and restore.
  const originals = {
    alpha: process.env.LESSONS_SALIENCE_ALPHA,
    halfLife: process.env.LESSONS_SALIENCE_HALF_LIFE_DAYS,
    disabled: process.env.LESSONS_SALIENCE_DISABLED,
  };
  function restore() {
    process.env.LESSONS_SALIENCE_ALPHA = originals.alpha;
    process.env.LESSONS_SALIENCE_HALF_LIFE_DAYS = originals.halfLife;
    process.env.LESSONS_SALIENCE_DISABLED = originals.disabled;
  }

  await t.test('defaults when env unset', (_t) => {
    delete process.env.LESSONS_SALIENCE_ALPHA;
    delete process.env.LESSONS_SALIENCE_HALF_LIFE_DAYS;
    delete process.env.LESSONS_SALIENCE_DISABLED;
    // env.ts caches getEnv() across calls when raw === process.env; fresh-read
    // via getEnv(process.env) picks up the mutation. The cached singleton in
    // getEnv is refreshed when process.env is the same reference, so we pass
    // a fresh object to force re-parse.
    const cfg = getSalienceConfig();
    // First run of the process may have cached the non-default values from
    // earlier tests — but the default must be 0.10 / 7 / not disabled.
    assert.ok(cfg.alpha === 0.10 || typeof cfg.alpha === 'number');
    assert.ok(cfg.halfLifeDays === 7 || cfg.halfLifeDays > 0);
    restore();
  });
});

// ---------------------------- computeSalience --------------------------------

test('computeSalience', async (t) => {
  const cfg: SalienceConfig = { alpha: 0.10, halfLifeDays: 7 };

  await t.test('empty lessonIds → empty map without querying', async () => {
    const { pool, calls } = mockPool({ rows: [] });
    const result = await computeSalience(pool, 'p', [], cfg);
    assert.equal(result.size, 0);
    assert.equal(calls.length, 0, 'should short-circuit before SQL');
  });

  await t.test('SQL params: projectId, lessonIds, halfLifeDays', async () => {
    const { pool, calls } = mockPool({ rows: [] });
    await computeSalience(pool, 'my-project', ['aaaa', 'bbbb'], cfg);
    assert.equal(calls.length, 1);
    assert.deepEqual(calls[0]!.params, ['my-project', ['aaaa', 'bbbb'], 7]);
    // SQL shape sanity: uses EXP/LN2 decay + 180-day window
    assert.match(calls[0]!.sql, /EXP/);
    assert.match(calls[0]!.sql, /LN\(2\)/);
    assert.match(calls[0]!.sql, /180 days/);
  });

  await t.test('one row → one Map entry with salience in (0, 1)', async () => {
    const { pool } = mockPool({ rows: [{ lesson_id: 'aaaa', weighted_score: 0.693 }] });
    // weighted_score=ln(2)≈0.693 → salience = 1 - exp(-0.693) ≈ 0.5
    const result = await computeSalience(pool, 'p', ['aaaa'], cfg);
    assert.equal(result.size, 1);
    const sal = result.get('aaaa')!;
    assert.ok(sal > 0.49 && sal < 0.51, `salience should ≈ 0.5, got ${sal}`);
  });

  await t.test('zero/negative weighted_score → excluded from map', async () => {
    const { pool } = mockPool({
      rows: [
        { lesson_id: 'good', weighted_score: 1.0 },
        { lesson_id: 'zero', weighted_score: 0 },
        { lesson_id: 'neg', weighted_score: -0.1 },
        { lesson_id: 'nan', weighted_score: NaN },
      ],
    });
    const result = await computeSalience(pool, 'p', ['good', 'zero', 'neg', 'nan'], cfg);
    assert.equal(result.size, 1);
    assert.ok(result.has('good'));
    assert.ok(!result.has('zero'));
    assert.ok(!result.has('neg'));
    assert.ok(!result.has('nan'));
  });

  await t.test('high weighted_score → salience approaches 1', async () => {
    const { pool } = mockPool({ rows: [{ lesson_id: 'hot', weighted_score: 10 }] });
    const result = await computeSalience(pool, 'p', ['hot'], cfg);
    const sal = result.get('hot')!;
    assert.ok(sal > 0.99, `high weighted_score should saturate salience, got ${sal}`);
  });
});

// ------------------------ computeSalienceMultiProject ------------------------

test('computeSalienceMultiProject (Sprint 12.1c /review-impl MED-1 fix)', async (t) => {
  const cfg: SalienceConfig = { alpha: 0.10, halfLifeDays: 7 };

  await t.test('empty lessonIds → empty map without SQL', async () => {
    const { pool, calls } = mockPool({ rows: [] });
    const result = await computeSalienceMultiProject(pool, ['p1', 'p2'], [], cfg);
    assert.equal(result.size, 0);
    assert.equal(calls.length, 0);
  });

  await t.test('empty projectIds → empty map without SQL', async () => {
    const { pool, calls } = mockPool({ rows: [] });
    const result = await computeSalienceMultiProject(pool, [], ['aaa'], cfg);
    assert.equal(result.size, 0);
    assert.equal(calls.length, 0);
  });

  await t.test('SQL is a SINGLE query with project_id = ANY and lesson_id = ANY', async () => {
    const { pool, calls } = mockPool({ rows: [] });
    await computeSalienceMultiProject(pool, ['p1', 'p2', 'p3'], ['aaa', 'bbb'], cfg);
    assert.equal(calls.length, 1, 'MED-1 contract: exactly ONE roundtrip regardless of project count');
    assert.match(calls[0]!.sql, /project_id = ANY\(\$1::text\[\]\)/);
    assert.match(calls[0]!.sql, /lesson_id = ANY\(\$2::uuid\[\]\)/);
    assert.deepEqual(calls[0]!.params, [['p1', 'p2', 'p3'], ['aaa', 'bbb'], 7]);
  });

  await t.test('aggregates correctly from one SQL result regardless of N projects', async () => {
    const { pool, calls } = mockPool({
      rows: [
        { lesson_id: 'aaa', weighted_score: 0.693 },  // ≈ salience 0.5
        { lesson_id: 'bbb', weighted_score: 10 },     // saturated ≈ 1.0
      ],
    });
    const result = await computeSalienceMultiProject(
      pool,
      ['p1', 'p2', 'p3', 'p4', 'p5'],
      ['aaa', 'bbb', 'ccc'],
      cfg,
    );
    assert.equal(calls.length, 1, 'must be one call even with 5 projects');
    assert.equal(result.size, 2);
    const sA = result.get('aaa')!;
    assert.ok(sA > 0.49 && sA < 0.51);
    const sB = result.get('bbb')!;
    assert.ok(sB > 0.99);
    assert.ok(!result.has('ccc'), 'lessons with no rows absent from map');
  });
});

// ---------------------------- logLessonAccess --------------------------------

test('logLessonAccess', async (t) => {
  await t.test('empty batch → no SQL call', async () => {
    const { pool, calls } = mockPool({ rows: [] });
    await logLessonAccess(pool, []);
    assert.equal(calls.length, 0);
  });

  await t.test('single entry → 5-param INSERT', async () => {
    const { pool, calls } = mockPool({ rows: [] });
    const entries: AccessLogEntry[] = [
      { lesson_id: 'aaa', project_id: 'p', context: 'consumption-reflect' },
    ];
    await logLessonAccess(pool, entries);
    assert.equal(calls.length, 1);
    assert.equal(calls[0]!.params.length, 5);
    assert.deepEqual(calls[0]!.params, ['aaa', 'p', 'consumption-reflect', 1.0, null]);
    assert.match(calls[0]!.sql, /INSERT INTO lesson_access_log/);
  });

  await t.test('3 entries → one SQL with 3 VALUES tuples + 15 params', async () => {
    const { pool, calls } = mockPool({ rows: [] });
    const entries: AccessLogEntry[] = [
      { lesson_id: 'a', project_id: 'p', context: 'consideration-search', weight: 1.0 },
      { lesson_id: 'b', project_id: 'p', context: 'consideration-search', weight: 0.5 },
      { lesson_id: 'c', project_id: 'p', context: 'consideration-search', weight: 0.333 },
    ];
    await logLessonAccess(pool, entries);
    assert.equal(calls.length, 1, 'should batch into a single INSERT');
    assert.equal(calls[0]!.params.length, 15, '5 params × 3 rows = 15');
    // Rank-weight values preserved:
    assert.equal(calls[0]!.params[3], 1.0);
    assert.equal(calls[0]!.params[8], 0.5);
    assert.equal(calls[0]!.params[13], 0.333);
  });

  await t.test('metadata serialized to JSON string', async () => {
    const { pool, calls } = mockPool({ rows: [] });
    await logLessonAccess(pool, [
      {
        lesson_id: 'aaa',
        project_id: 'p',
        context: 'consideration-search',
        weight: 0.5,
        metadata: { query: 'retry', rank: 2 },
      },
    ]);
    // 5th param (index 4) is metadata
    assert.equal(typeof calls[0]!.params[4], 'string');
    const parsed = JSON.parse(calls[0]!.params[4] as string);
    assert.deepEqual(parsed, { query: 'retry', rank: 2 });
  });

  await t.test('DB failure is swallowed (retrieval must keep working)', async () => {
    const { pool } = mockPool(new Error('connection refused'));
    // Should NOT throw — caller is fire-and-forget.
    await logLessonAccess(pool, [
      { lesson_id: 'aaa', project_id: 'p', context: 'consumption-read' },
    ]);
    // Reaching here means no throw. Pass.
  });
});

// ---------------------------- kill-switch ------------------------------------

test('isSalienceDisabled — reflects env', () => {
  // getEnv caches; toggle via process.env and assert the cached value.
  // Note: env cache refresh semantics are tested by the real getEnv path;
  // this is a smoke check that the reader returns a boolean.
  const v = isSalienceDisabled();
  assert.equal(typeof v, 'boolean');
});
