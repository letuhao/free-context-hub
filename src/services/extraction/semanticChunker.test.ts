/**
 * Phase 17.4 — semantic chunker unit tests.
 *
 * Pinned with a STUB embedder so boundaries are deterministic: sentences map to
 * cluster vectors, and we assert the splitter cuts at the topic shift, keeps a
 * uniform run together, force-splits at the token budget, and keeps code atomic.
 */

import assert from 'node:assert/strict';
import test from 'node:test';

import { chunkDocument, chunkDocumentSemantic, splitSentences, percentile } from './chunker.js';
import type { ExtractionResult } from './types.js';

const page = (content: string): ExtractionResult => ({
  mode: 'fast' as any,
  pages: [{ page_number: 1, content } as any],
  total_pages: 1,
});

/** Stub embedder: 'alpha' → cluster A, 'beta' → cluster B, else neutral. */
const clusterEmbed = async (texts: string[]): Promise<number[][]> =>
  texts.map((t) => {
    const s = t.toLowerCase();
    if (s.includes('alpha')) return [1, 0, 0];
    if (s.includes('beta')) return [0, 1, 0];
    return [0, 0, 1];
  });

test('hierarchical chunking is CRLF-robust (regression)', () => {
  // A CRLF document must still split on its `##` headings. Before the fix the
  // heading regex silently failed on `\r`-terminated lines → 0 headings → naive
  // fallback (the corpus 51→16-chunk regression that surfaced this).
  const md = '# Title\r\n\r\n## Section A\r\n\r\nAlpha body.\r\n\r\n## Section B\r\n\r\nBeta body.\r\n';
  const result: ExtractionResult = { mode: 'fast' as any, pages: [{ page_number: 1, content: md } as any], total_pages: 1 };
  const chunks = chunkDocument(result, { template: 'hierarchical' });
  const headings = chunks.map((c) => c.heading).filter(Boolean);
  assert.ok(headings.includes('Section A') && headings.includes('Section B'), `headings detected on CRLF, got ${JSON.stringify(headings)}`);
  // and no stray \r leaked into the chunk content
  assert.ok(!chunks.some((c) => c.content.includes('\r')), 'CRLF normalized out of chunk content');
});

test('splitSentences', () => {
  assert.deepEqual(splitSentences('A one. B two! C three?'), ['A one.', 'B two!', 'C three?']);
  assert.deepEqual(splitSentences('  '), []);
  assert.deepEqual(splitSentences('no terminator'), ['no terminator']);
});

test('percentile (nearest-rank)', () => {
  assert.equal(percentile([], 95), 0);
  assert.equal(percentile([0, 0, 0, 0, 1], 80), 0); // idx round(0.8*4)=3 → 0
  assert.equal(percentile([0, 0, 0, 0, 1], 100), 1);
});

test('chunkDocumentSemantic — splits at the topic shift, keeps each cluster together', async () => {
  const r = page('Alpha one. Alpha two. Alpha three. Beta one. Beta two. Beta three.');
  const chunks = await chunkDocumentSemantic(r, clusterEmbed, { breakpointPercentile: 80 });
  assert.equal(chunks.length, 2, 'one chunk per semantic cluster');
  assert.match(chunks[0]!.content, /Alpha one\. Alpha two\. Alpha three\./);
  assert.match(chunks[1]!.content, /Beta one\. Beta two\. Beta three\./);
  assert.ok(!/Beta/.test(chunks[0]!.content), 'no cross-cluster bleed');
});

test('chunkDocumentSemantic — a uniform run stays as one chunk', async () => {
  const r = page('Alpha one. Alpha two. Alpha three. Alpha four.');
  const chunks = await chunkDocumentSemantic(r, clusterEmbed, { breakpointPercentile: 95 });
  assert.equal(chunks.length, 1, 'no spurious split when all sentences cluster together');
});

test('chunkDocumentSemantic — force-splits at the token budget', async () => {
  // 6 identical-cluster sentences, but a tiny maxTokens forces budget splits.
  const r = page('Alpha aaaa. Alpha bbbb. Alpha cccc. Alpha dddd.');
  const chunks = await chunkDocumentSemantic(r, clusterEmbed, { maxTokens: 4, breakpointPercentile: 95 });
  // maxChars = 4*4 = 16 — each ~12-char sentence lands in its own chunk.
  assert.ok(chunks.length >= 3, `budget forced multiple chunks, got ${chunks.length}`);
});

test('chunkDocumentSemantic — code block stays atomic, text around it splits semantically', async () => {
  const r = page('Alpha one. Alpha two.\n\n```js\nconst x = 1;\n```\n\nBeta one. Beta two.');
  const chunks = await chunkDocumentSemantic(r, clusterEmbed, { breakpointPercentile: 80 });
  const code = chunks.find((c) => c.chunk_type === 'code');
  assert.ok(code, 'code block emitted as its own chunk');
  assert.match(code!.content, /const x = 1;/);
  const textChunks = chunks.filter((c) => c.chunk_type === 'text');
  assert.ok(textChunks.length >= 2, 'alpha and beta text runs are separate chunks');
});

test('chunkDocumentSemantic — empty content → no chunks', async () => {
  assert.deepEqual(await chunkDocumentSemantic(page('   '), clusterEmbed), []);
});
