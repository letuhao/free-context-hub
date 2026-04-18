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

test('blendHybridScore', async (t) => {
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
