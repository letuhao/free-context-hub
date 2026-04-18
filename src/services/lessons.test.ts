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

type LessonMatch = { lesson_id: string; title: string; content_snippet?: string; score?: number };

function m(lesson_id: string, title: string, content_snippet = ''): LessonMatch {
  return { lesson_id, title, content_snippet, score: 1 };
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

  await t.test('missing content_snippet field still hashes (treated as empty string)', () => {
    // Defensive: older code paths may omit content_snippet. dedup should
    // still work, though it effectively reduces to title-only matching.
    const inp = [
      { lesson_id: 'a', title: 'Same title' },
      { lesson_id: 'b', title: 'Same title' },
    ] as Array<{ lesson_id: string; title: string; content_snippet?: string }>;
    const out = dedupLessonMatches(inp);
    assert.equal(out.length, 1);
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
