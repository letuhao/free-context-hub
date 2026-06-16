/**
 * Sprint 12.1a — lessons dedup unit tests.
 *
 * Covers `dedupLessonMatches` (pure function) against the patterns the
 * Sprint 12.0.1 baseline surfaced:
 *   - identical-title-identical-snippet clusters ("Global search test
 *     retry pattern" x6+)
 *   - identical-title-identical-snippet guardrail clusters ("Max retry
 *     attempts must be 3" x5+)
 *   - timestamp-variant clusters ("Valid: impexp-<ts>-extra" x4+)
 *   - mixed top-k with both duplicates and distinct items (ordering
 *     preservation)
 */

import assert from 'node:assert/strict';
import test from 'node:test';

import { dedupLessonMatches } from './lessons.js';

type LessonMatch = {
  lesson_id: string;
  project_id?: string;
  lesson_type: string;
  title: string;
  content_snippet: string | undefined;
  score?: number;
};

/** Fixture helper. Defaults to `project_id='p'` and `lesson_type='decision'`
 *  so existing tests need no churn; new tests override when exercising
 *  project/type dimensions. */
function m(
  lesson_id: string,
  title: string,
  content_snippet: string | undefined = '',
  project_id = 'p',
  lesson_type = 'decision',
): LessonMatch {
  return { lesson_id, project_id, lesson_type, title, content_snippet, score: 1 };
}

test('dedupLessonMatches', async (t) => {
  await t.test('empty input → empty output', () => {
    assert.deepEqual(dedupLessonMatches([]), []);
  });

  await t.test('all distinct → all preserved in order', () => {
    const inp = [
      m('a', 'pg UUID casing', 'canonical lowercase'),
      m('b', 'undici version pinning', 'must match Node version'),
      m('c', 'pyenv python3 shim', 'multi-line -c args'),
    ];
    const out = dedupLessonMatches(inp);
    assert.equal(out.length, 3);
    assert.deepEqual(out.map((x) => x.lesson_id), ['a', 'b', 'c']);
  });

  await t.test('identical-title-identical-snippet cluster collapses to first', () => {
    // The motivating "Global search test retry pattern" pathology.
    const inp = [
      m('aaaa', 'Global search test retry pattern', 'Use exponential backoff for retry'),
      m('bbbb', 'Global search test retry pattern', 'Use exponential backoff for retry'),
      m('cccc', 'Global search test retry pattern', 'Use exponential backoff for retry'),
      m('dddd', 'Real distinct lesson', 'Distinct content'),
    ];
    const out = dedupLessonMatches(inp);
    assert.equal(out.length, 2, 'cluster of 3 collapses to 1; plus the distinct one = 2');
    assert.deepEqual(out.map((x) => x.lesson_id), ['aaaa', 'dddd'], 'first-seen cluster rep preserved');
  });

  await t.test('timestamp-variant cluster collapses (digit-collapse in normalizer)', () => {
    // The "Valid: impexp-<ts>-extra" cluster — titles differ by timestamp,
    // snippets share normalized prefix.
    const inp = [
      m('x1', 'Valid: impexp-1775368159562-extra', 'The provided text is a title and body.'),
      m('x2', 'Valid: impexp-1775368419347-extra', 'The provided text is a title and body.'),
      m('x3', 'Valid: impexp-1775320598400-extra', 'The provided text is a title and body.'),
      m('y',  'Multi-project color and description', 'on projects table schema additions'),
    ];
    const out = dedupLessonMatches(inp);
    assert.equal(out.length, 2, 'timestamp cluster collapses; distinct lesson preserved');
    assert.equal(out[0]!.lesson_id, 'x1');
    assert.equal(out[1]!.lesson_id, 'y');
  });

  await t.test('preserves ordering: first-seen representative wins even when a later cluster member has a higher score', () => {
    // Policy choice: dedup is order-preserving. The search pipeline has
    // already ranked items (semantic + FTS + optional rerank); dedup
    // respects that ordering and does not re-score.
    const inp = [
      m('lower-ranked-first', 'Same title', 'same snippet', /* score */),
      m('higher-score-later', 'Same title', 'same snippet'),
    ];
    const out = dedupLessonMatches(inp);
    assert.equal(out.length, 1);
    assert.equal(out[0]!.lesson_id, 'lower-ranked-first', 'first-seen wins — callers control rank order before calling dedup');
  });

  await t.test('distinct snippet saves distinct-content lessons from collapsing under title alone', () => {
    // Two lessons with the same title (unlikely but possible) but meaningfully
    // different bodies should NOT collapse under v1 — the `||` delimiter
    // requires both normalized fields to match.
    const inp = [
      m('r1', 'Retry strategy', 'Use exponential backoff with jitter and cap at 3 attempts.'),
      m('r2', 'Retry strategy', 'Dead-letter queue: after 3 attempts, route to DLQ for manual review.'),
    ];
    const out = dedupLessonMatches(inp);
    assert.equal(out.length, 2, 'distinct snippets prevent collapse under same title');
  });

  await t.test('undefined content_snippet is treated as empty string (defensive)', () => {
    const inp: LessonMatch[] = [
      m('a', 'Same title', undefined),
      m('b', 'Same title', undefined),
    ];
    const out = dedupLessonMatches(inp);
    assert.equal(out.length, 1);
  });

  await t.test('Sprint 12.1a MED-1: cross-project SAME-content items are preserved', () => {
    // Two projects may legitimately share a guardrail (e.g. via include_groups).
    // Dedup must NOT collapse them — each project keeps its representative.
    const inp = [
      m('a', 'Retry budget', 'Use exponential backoff, max 3 attempts', 'project-A', 'guardrail'),
      m('b', 'Retry budget', 'Use exponential backoff, max 3 attempts', 'project-B', 'guardrail'),
    ];
    const out = dedupLessonMatches(inp);
    assert.equal(out.length, 2, 'different project_id → different keys → both preserved');
    assert.deepEqual(out.map((x) => x.project_id), ['project-A', 'project-B']);
  });

  await t.test('Sprint 12.1a MED-2: same content but different lesson_type stays distinct', () => {
    // A guardrail "Retry strategy" (rule to enforce) and a decision "Retry
    // strategy" (architectural rationale) carry different downstream semantics
    // even if the text overlaps. Dedup must keep both.
    const inp = [
      m('gr', 'Retry strategy', 'Exponential backoff with jitter', 'p', 'guardrail'),
      m('dc', 'Retry strategy', 'Exponential backoff with jitter', 'p', 'decision'),
    ];
    const out = dedupLessonMatches(inp);
    assert.equal(out.length, 2, 'different lesson_type → different keys → both preserved');
    assert.deepEqual(out.map((x) => x.lesson_type), ['guardrail', 'decision']);
  });

  await t.test('within-project-within-type near-semantic cluster still collapses (the motivating pathology)', () => {
    // Full-stack check: same project, same type, cluster collapses as before.
    const inp = [
      m('a', 'Max retry attempts must be 3', 'Use retry with backoff', 'p', 'guardrail'),
      m('b', 'Max retry attempts must be 3', 'Use retry with backoff', 'p', 'guardrail'),
      m('c', 'Max retry attempts must be 3', 'Use retry with backoff', 'p', 'guardrail'),
      m('d', 'Distinct guardrail', 'Different content', 'p', 'guardrail'),
    ];
    const out = dedupLessonMatches(inp);
    assert.equal(out.length, 2);
    assert.deepEqual(out.map((x) => x.lesson_id), ['a', 'd']);
  });

  await t.test('input with 10 items, one 6-member cluster → 5 items out', () => {
    // Shape mirrors the real "lesson-dup-global-search-retry-pattern" query:
    // 6 members of the retry-pattern cluster + 4 distinct items.
    const cluster = Array.from({ length: 6 }, (_, i) =>
      m(`c${i}`, 'Global search test retry pattern', 'Use exponential backoff for retry'),
    );
    const distinct = [
      m('d1', 'pg UUID casing', 'canonical lowercase'),
      m('d2', 'undici version', 'dispatcher interface'),
      m('d3', 'pyenv shim', 'python3.bat bug'),
      m('d4', 'npm test skip', 'explicit files list'),
    ];
    const out = dedupLessonMatches([...cluster, ...distinct]);
    assert.equal(out.length, 5, '6 clustered → 1 rep + 4 distinct = 5');
    assert.deepEqual(out.map((x) => x.lesson_id), ['c0', 'd1', 'd2', 'd3', 'd4']);
  });
});

// ---- Sprint 12.1g — rerankExternalApi tests ----

import { rerankExternalApi, type RerankCandidate } from './lessons.js';

function candidates(n: number): RerankCandidate[] {
  return Array.from({ length: n }, (_, i) => ({
    index: i * 10,  // distinctive indices: 0, 10, 20, ... so we can verify mapping
    title: `title ${i}`,
    snippet: `snippet ${i}`,
  }));
}

function mockFetch(response: { status: number; body: any } | Error) {
  const calls: Array<{ url: string; body: any }> = [];
  const fetchMock = async (url: string, init: any) => {
    calls.push({ url, body: init?.body ? JSON.parse(init.body) : undefined });
    if (response instanceof Error) throw response;
    return {
      ok: response.status >= 200 && response.status < 300,
      status: response.status,
      json: async () => response.body,
    };
  };
  return { fetchMock, calls };
}

test('rerankExternalApi — happy path sorts by server score', async () => {
  const originalFetch = global.fetch;
  const { fetchMock, calls } = mockFetch({
    status: 200,
    body: [
      { index: 2, score: 0.9 },
      { index: 0, score: 0.5 },
      { index: 1, score: 0.1 },
    ],
  });
  global.fetch = fetchMock as any;
  try {
    const result = await rerankExternalApi('my query', candidates(3));
    // candidates have distinctive .index fields: 0, 10, 20
    // Server returned score order: texts[2], texts[0], texts[1]
    // That maps to caller indices: 20, 0, 10
    assert.deepEqual(result, [20, 0, 10]);
    assert.equal(calls.length, 1);
    assert.match(calls[0]!.url, /\/rerank$/);
    assert.equal(calls[0]!.body.query, 'my query');
    assert.deepEqual(calls[0]!.body.texts, ['title 0. snippet 0', 'title 1. snippet 1', 'title 2. snippet 2']);
  } finally {
    global.fetch = originalFetch;
  }
});

test('rerankExternalApi — HTTP 500 returns original index order', async () => {
  const originalFetch = global.fetch;
  const { fetchMock } = mockFetch({ status: 500, body: { error: 'oops' } });
  global.fetch = fetchMock as any;
  try {
    const result = await rerankExternalApi('q', candidates(3));
    assert.deepEqual(result, [0, 10, 20]);  // unchanged
  } finally {
    global.fetch = originalFetch;
  }
});

test('rerankExternalApi — fetch throws returns original order', async () => {
  const originalFetch = global.fetch;
  const { fetchMock } = mockFetch(new Error('network unreachable'));
  global.fetch = fetchMock as any;
  try {
    const result = await rerankExternalApi('q', candidates(3));
    assert.deepEqual(result, [0, 10, 20]);  // unchanged
  } finally {
    global.fetch = originalFetch;
  }
});

test('rerankExternalApi — empty response array returns original order', async () => {
  const originalFetch = global.fetch;
  const { fetchMock } = mockFetch({ status: 200, body: [] });
  global.fetch = fetchMock as any;
  try {
    const result = await rerankExternalApi('q', candidates(3));
    assert.deepEqual(result, [0, 10, 20]);
  } finally {
    global.fetch = originalFetch;
  }
});

// ── DEFERRED-027: malformed uuid → BAD_REQUEST (not a raw SQL 500) ──
// assertUuid throws before any DB query, so these run without a live DB.
import { updateLessonStatus, updateLesson } from './lessons.js';

test('DEFERRED-027: updateLessonStatus rejects a non-uuid lessonId with BAD_REQUEST', async () => {
  await assert.rejects(
    updateLessonStatus({ projectId: 'p', lessonId: 'undefined', status: 'active' as any }),
    /lessonId must be a valid UUID/,
  );
});

test('DEFERRED-027: updateLessonStatus rejects a non-uuid superseded_by with BAD_REQUEST', async () => {
  await assert.rejects(
    updateLessonStatus({
      projectId: 'p',
      lessonId: '11111111-1111-1111-1111-111111111111',
      status: 'superseded' as any,
      supersededBy: 'not-a-uuid',
    }),
    /superseded_by must be a valid UUID/,
  );
});

test('DEFERRED-027: updateLesson rejects a non-uuid lessonId with BAD_REQUEST', async () => {
  await assert.rejects(
    updateLesson({ projectId: 'p', lessonId: 'undefined' }),
    /lessonId must be a valid UUID/,
  );
});

// ── DEFERRED-029 PR B: cross-tenant scope must throw NOT_FOUND before any DB call.
// assertCallerScope fires at the top of each fn; tests do not need a live DB.
import { addLesson, listLessons, searchLessons, searchLessonsMulti, listLessonVersions, batchUpdateLessonStatus } from './lessons.js';
import { ContextHubError as _CHE } from '../core/errors.js';

const isNotFound = (err: unknown): boolean => err instanceof _CHE && (err as _CHE).code === 'NOT_FOUND';

test('DEFERRED-029: searchLessons cross-tenant → NOT_FOUND', async () => {
  await assert.rejects(
    searchLessons({ projectId: 'proj-A', callerScope: 'proj-B', query: 'x' }),
    isNotFound,
  );
});

test('DEFERRED-029: searchLessonsMulti cross-tenant → NOT_FOUND (strict-reject)', async () => {
  await assert.rejects(
    searchLessonsMulti({ projectIds: ['proj-A', 'proj-B'], callerScope: 'proj-A', query: 'x' }),
    isNotFound,
  );
});

test('DEFERRED-029: addLesson cross-tenant → NOT_FOUND', async () => {
  await assert.rejects(
    addLesson({ project_id: 'proj-A', callerScope: 'proj-B', lesson_type: 'decision' as any, title: 't', content: 'c' } as any),
    isNotFound,
  );
});

test('DEFERRED-029: updateLesson cross-tenant → NOT_FOUND (before assertUuid)', async () => {
  await assert.rejects(
    updateLesson({ projectId: 'proj-A', callerScope: 'proj-B', lessonId: '11111111-1111-1111-1111-111111111111' }),
    isNotFound,
  );
});

test('DEFERRED-029: updateLessonStatus cross-tenant → NOT_FOUND', async () => {
  await assert.rejects(
    updateLessonStatus({ projectId: 'proj-A', callerScope: 'proj-B', lessonId: '11111111-1111-1111-1111-111111111111', status: 'active' as any }),
    isNotFound,
  );
});

test('DEFERRED-029: batchUpdateLessonStatus cross-tenant → NOT_FOUND', async () => {
  await assert.rejects(
    batchUpdateLessonStatus({ projectId: 'proj-A', callerScope: 'proj-B', lessonIds: ['11111111-1111-1111-1111-111111111111'], status: 'archived' as any }),
    isNotFound,
  );
});

test('DEFERRED-029: listLessonVersions cross-tenant → NOT_FOUND', async () => {
  await assert.rejects(
    listLessonVersions({ projectId: 'proj-A', callerScope: 'proj-B', lessonId: '11111111-1111-1111-1111-111111111111' }),
    isNotFound,
  );
});

test('DEFERRED-029: listLessons cross-tenant (single projectId) → NOT_FOUND', async () => {
  await assert.rejects(
    listLessons({ projectId: 'proj-A', callerScope: 'proj-B' }),
    isNotFound,
  );
});

test('DEFERRED-029: listLessons cross-tenant (multi projectIds) → NOT_FOUND', async () => {
  await assert.rejects(
    listLessons({ projectIds: ['proj-A', 'proj-B'], callerScope: 'proj-A' }),
    isNotFound,
  );
});

// ── DEFERRED-030: min_rerank_score floor (pure-function helper) ──
import { applyRerankMinScore } from './lessons.js';

test('DEFERRED-030: applyRerankMinScore with minScore=0 is a pass-through', () => {
  const ranked = [
    { index: 0, relevanceScore: 0.8 },
    { index: 1, relevanceScore: 0.1 },
    { index: 2, relevanceScore: 0.5 },
  ];
  assert.deepEqual(applyRerankMinScore(ranked, 0), ranked);
});

test('DEFERRED-030: applyRerankMinScore filters strictly-below-threshold items', () => {
  const ranked = [
    { index: 0, relevanceScore: 0.95 },
    { index: 1, relevanceScore: 0.50 }, // exactly at floor → kept (inclusive)
    { index: 2, relevanceScore: 0.49 }, // below floor → dropped
    { index: 3, relevanceScore: 0.10 }, // dropped
  ];
  const out = applyRerankMinScore(ranked, 0.5);
  assert.equal(out.length, 2);
  assert.deepEqual(out.map(r => r.index), [0, 1]);
});

test('DEFERRED-030: applyRerankMinScore with minScore=1.0 drops everything below 1.0', () => {
  const ranked = [
    { index: 0, relevanceScore: 0.99 },
    { index: 1, relevanceScore: 1.00 },
  ];
  const out = applyRerankMinScore(ranked, 1.0);
  assert.deepEqual(out.map(r => r.index), [1]);
});

test('DEFERRED-030: applyRerankMinScore with negative or NaN minScore is a pass-through (defensive)', () => {
  const ranked = [{ index: 0, relevanceScore: 0.5 }];
  assert.deepEqual(applyRerankMinScore(ranked, -1), ranked);
  assert.deepEqual(applyRerankMinScore(ranked, NaN), ranked);
});

test('DEFERRED-030: applyRerankMinScore returns a NEW array (does not mutate input)', () => {
  const ranked = [{ index: 0, relevanceScore: 0.5 }];
  const out = applyRerankMinScore(ranked, 0);
  assert.notStrictEqual(out, ranked);
});

// ── DEFERRED-030 review LOW-1: shouldRunRerank decision (pure helper) ──
import { shouldRunRerank } from './lessons.js';

test('DEFERRED-030: shouldRunRerank — rerankParam=false wins over everything else', () => {
  // Even a "perfect" environment: rerank=false short-circuits.
  assert.equal(
    shouldRunRerank({ rerankParam: false, rerankBudget: 30, matchesLength: 50, rerankConfigured: true }),
    false,
  );
});

test('DEFERRED-030: shouldRunRerank — undefined rerankParam + healthy budget + configured → true', () => {
  assert.equal(
    shouldRunRerank({ rerankParam: undefined, rerankBudget: 30, matchesLength: 50, rerankConfigured: true }),
    true,
  );
});

test('DEFERRED-030: shouldRunRerank — rerankParam=true is equivalent to undefined (default behavior)', () => {
  assert.equal(
    shouldRunRerank({ rerankParam: true, rerankBudget: 30, matchesLength: 50, rerankConfigured: true }),
    true,
  );
});

test('DEFERRED-030: shouldRunRerank — budget=0 disables even when configured', () => {
  assert.equal(
    shouldRunRerank({ rerankParam: undefined, rerankBudget: 0, matchesLength: 50, rerankConfigured: true }),
    false,
  );
});

test('DEFERRED-030: shouldRunRerank — matchesLength<2 nothing to reorder', () => {
  assert.equal(
    shouldRunRerank({ rerankParam: undefined, rerankBudget: 30, matchesLength: 1, rerankConfigured: true }),
    false,
  );
  assert.equal(
    shouldRunRerank({ rerankParam: undefined, rerankBudget: 30, matchesLength: 0, rerankConfigured: true }),
    false,
  );
});

test('DEFERRED-030: shouldRunRerank — no reranker configured → false (even with healthy budget)', () => {
  assert.equal(
    shouldRunRerank({ rerankParam: undefined, rerankBudget: 30, matchesLength: 50, rerankConfigured: false }),
    false,
  );
});
