/**
 * Phase 17 Bug 2 fix — buildJudgeContexts unit tests.
 *
 * The runBaseline.ts gen-eval pipeline sends retrieval hits to the ragas-judge
 * sidecar. Bug 2 was that we sent the 200-char snippet_preview but the
 * synthesizer saw the full snippet (~1000 chars) — asymmetric evidence
 * caused systematic "context does not contain X" rejections from ragas.
 *
 * The fix lives in buildJudgeContexts(). These tests pin the contract:
 *   - slice to topKContexts
 *   - cap each text to JUDGE_SNIPPET_MAX_CHARS
 *   - preserve key as id
 *   - handle missing snippet (e.g. retrieval surfaced a key with no body)
 */

import assert from 'node:assert/strict';
import test from 'node:test';

import { buildJudgeContexts, JUDGE_SNIPPET_MAX_CHARS } from './judgeContexts.js';

test('buildJudgeContexts: empty hits → empty array', () => {
  assert.deepEqual(buildJudgeContexts([], 5), []);
});

test('buildJudgeContexts: respects topKContexts cap', () => {
  const hits = Array.from({ length: 10 }, (_, i) => ({
    key: `key-${i}`,
    snippet: `body-${i}`,
  }));
  const out = buildJudgeContexts(hits, 3);
  assert.equal(out.length, 3);
  assert.deepEqual(
    out.map(c => c.id),
    ['key-0', 'key-1', 'key-2'],
  );
});

test('buildJudgeContexts: topKContexts > hits length → returns all hits', () => {
  const hits = [{ key: 'a', snippet: 'A' }, { key: 'b', snippet: 'B' }];
  const out = buildJudgeContexts(hits, 10);
  assert.equal(out.length, 2);
});

test('buildJudgeContexts: preserves key as id', () => {
  const out = buildJudgeContexts([{ key: 'src/foo.ts', snippet: 'x' }], 1);
  assert.equal(out[0]!.id, 'src/foo.ts');
});

test('buildJudgeContexts: caps text to JUDGE_SNIPPET_MAX_CHARS', () => {
  const longBody = 'x'.repeat(JUDGE_SNIPPET_MAX_CHARS + 500);
  const out = buildJudgeContexts([{ key: 'k', snippet: longBody }], 1);
  assert.equal(out[0]!.text.length, JUDGE_SNIPPET_MAX_CHARS);
});

test('buildJudgeContexts: short snippets pass through unchanged', () => {
  const shortBody = 'short body';
  const out = buildJudgeContexts([{ key: 'k', snippet: shortBody }], 1);
  assert.equal(out[0]!.text, shortBody);
});

test('buildJudgeContexts: missing snippet → empty string (not undefined)', () => {
  const out = buildJudgeContexts([{ key: 'k' }], 1);
  assert.equal(out[0]!.text, '');
});

test('JUDGE_SNIPPET_MAX_CHARS matches synthesizer DEFAULT_MAX_CHARS', () => {
  // Symmetry invariant — judge and synth must see the same window so the
  // judge can entail what the synth was allowed to cite. If you change the
  // synthesizer's DEFAULT_MAX_CHARS in genPipeline.ts, change this too AND
  // re-baseline (the judge will see different evidence and scores will shift).
  assert.equal(JUDGE_SNIPPET_MAX_CHARS, 1000);
});
