/**
 * Sprint 12.1b — chunks dedup unit tests.
 *
 * Covers `dedupChunkMatches` (pure function) against:
 *   - identical-content clusters (the "sample.pdf failed-extraction"
 *     pathology: 3 chunks with same doc_name + null heading + same
 *     content prefix)
 *   - within-document same-heading clusters
 *   - cross-project + cross-chunk-type preservation (MED-1/MED-2 lesson
 *     from Sprint 12.1a ported to chunks)
 *   - null-heading handling (distinct from "heading = ''")
 */

import assert from 'node:assert/strict';
import test from 'node:test';

import { dedupChunkMatches } from './documentChunks.js';

type ChunkFixture = {
  chunk_id: string;
  project_id: string;
  chunk_type: string;
  doc_name: string;
  heading: string | null;
  content_snippet: string;
  score?: number;
};

function c(
  chunk_id: string,
  doc_name: string,
  heading: string | null,
  content_snippet: string,
  project_id = 'p',
  chunk_type = 'text',
): ChunkFixture {
  return { chunk_id, project_id, chunk_type, doc_name, heading, content_snippet, score: 0.8 };
}

test('dedupChunkMatches', async (t) => {
  await t.test('empty input → empty output', () => {
    assert.deepEqual(dedupChunkMatches([]), []);
  });

  await t.test('all distinct → all preserved in order', () => {
    const inp = [
      c('c1', 'sample.docx', '1. Retry Strategy', 'All external API calls must retry'),
      c('c2', 'sample.docx', '2. Authentication', 'All endpoints require an API key'),
      c('c3', 'sample.docx', '3. Data Storage', 'Lessons are stored in pgvector'),
    ];
    const out = dedupChunkMatches(inp);
    assert.equal(out.length, 3);
    assert.deepEqual(out.map((x) => x.chunk_id), ['c1', 'c2', 'c3']);
  });

  await t.test('sample.pdf failed-extraction cluster collapses (the motivating pathology)', () => {
    // 3 chunks with identical doc_name + null heading + identical failed-
    // extraction content prefix. This is the concrete 12.0.1 baseline
    // observation — `chunks dup@10 nearsem = 0.29` is largely driven by
    // these three collapsing to one key under the baseline metric.
    const inp = [
      c('pdf1', 'sample.pdf', null, '> [extraction failed: Vision model returned HTTP 400: {...}'),
      c('pdf2', 'sample.pdf', null, '> [extraction failed: Vision model returned HTTP 400: {...}'),
      c('pdf3', 'sample.pdf', null, '> [extraction failed: Vision model returned HTTP 400: {...}'),
      c('good', 'sample.docx', '1. Retry', 'Distinct real content'),
    ];
    const out = dedupChunkMatches(inp);
    assert.equal(out.length, 2, 'cluster collapses to 1 rep + 1 distinct = 2');
    assert.deepEqual(out.map((x) => x.chunk_id), ['pdf1', 'good']);
  });

  await t.test('cross-document SAME heading+content stay distinct (doc_name is part of key)', () => {
    // sample.docx "Architecture Decision Records" vs sample.png "Architecture
    // Decision Records" with same intro text. Policy choice (Sprint 12.1a
    // consistent): preserve different doc_name → one representative per doc.
    // Users searching see both docs surfaced.
    const inp = [
      c('docx-adr', 'sample.docx', 'Architecture Decision Records', '# Architecture Decision Records\n\nThis document captures key architectural decisions.'),
      c('png-adr', 'sample.png', 'Architecture Decision Records', '# Architecture Decision Records\n\nThis document captures key architectural decisions.'),
    ];
    const out = dedupChunkMatches(inp);
    assert.equal(out.length, 2, 'different doc_name → different keys → both preserved');
  });

  await t.test('MED-1 port: different project_id → both preserved', () => {
    const inp = [
      c('a', 'guardrails.md', 'Max retries', 'Cap retries at 3', 'project-A'),
      c('b', 'guardrails.md', 'Max retries', 'Cap retries at 3', 'project-B'),
    ];
    const out = dedupChunkMatches(inp);
    assert.equal(out.length, 2);
  });

  await t.test('MED-2 port: different chunk_type → both preserved even with same heading+content', () => {
    // A `table` chunk with rows and a `text` chunk quoting those rows are
    // different data types. Dedup must not collapse across chunk_type.
    const inp = [
      c('tbl', 'sample.docx', 'Retry config', 'retry_count|3', 'p', 'table'),
      c('txt', 'sample.docx', 'Retry config', 'retry_count|3', 'p', 'text'),
    ];
    const out = dedupChunkMatches(inp);
    assert.equal(out.length, 2, 'different chunk_type → different keys → both preserved');
  });

  await t.test('null vs empty heading: both normalize to empty, so same content collapses (defensive)', () => {
    // Edge case — if two rows somehow have (null heading) vs ('' heading)
    // with otherwise identical fields, the fallback `doc_name` title is
    // the same ('sample.docx'), content_snippet is the same, so they
    // collapse. Documented behavior: null and '' are treated alike.
    const inp = [
      c('a', 'sample.docx', null, 'same content'),
      c('b', 'sample.docx', '', 'same content'),
    ];
    const out = dedupChunkMatches(inp);
    assert.equal(out.length, 1);
  });

  await t.test('preserves input ordering: first-seen representative wins', () => {
    const inp = [
      c('first', 'doc.md', 'Section', 'identical'),
      c('second', 'doc.md', 'Section', 'identical'),
      c('third', 'doc.md', 'Section', 'identical'),
    ];
    const out = dedupChunkMatches(inp);
    assert.equal(out.length, 1);
    assert.equal(out[0]!.chunk_id, 'first', 'highest-ranked cluster member is kept');
  });

  await t.test('mixed: 10 items with a 3-member cluster and 7 distinct → 8 out', () => {
    // Non-numeric distinguishers because digit-collapse in normalizeForHash
    // would equate "Section 1" / "Section 2" (both → "section n"). Same
    // trap as the Sprint 12.1a metrics.test.ts `numeric-suffix file paths`
    // lesson. Real data naturally has words, but fixtures need care.
    const cluster = Array.from({ length: 3 }, (_, i) =>
      c(`dup${i}`, 'sample.pdf', null, 'extraction failed'),
    );
    const names = ['alpha', 'beta', 'gamma', 'delta', 'epsilon', 'zeta', 'eta'];
    const distinct = names.map((name) =>
      c(`uniq-${name}`, 'sample.docx', `Section ${name}`, `Content block ${name}`),
    );
    const out = dedupChunkMatches([...cluster, ...distinct]);
    assert.equal(out.length, 8);
    assert.deepEqual(
      out.map((x) => x.chunk_id),
      ['dup0', 'uniq-alpha', 'uniq-beta', 'uniq-gamma', 'uniq-delta', 'uniq-epsilon', 'uniq-zeta', 'uniq-eta'],
    );
  });
});
