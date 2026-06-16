/**
 * Cohere-compatible rerank client — boundary transport tests.
 *
 * Covers the contract every caller relies on: correct request shape, results
 * mapped + sorted, and a thrown error (never a silent wrong order) on every
 * failure mode so the caller's fallback-to-base-order path engages.
 */

import assert from 'node:assert/strict';
import test, { afterEach } from 'node:test';
import { cohereRerank } from './rerankClient.js';

const realFetch = global.fetch;
afterEach(() => { global.fetch = realFetch; });

const baseParams = {
  query: 'how does auth work',
  documents: ['doc a', 'doc b', 'doc c'],
  baseUrl: 'http://127.0.0.1:28417',
  apiKey: 'secret',
  model: 'bge-reranker-v2-m3',
  timeoutMs: 300,
};

test('sends Cohere /v1/rerank request and maps + sorts results DESC', async () => {
  let captured: { url: string; init: any } | null = null;
  global.fetch = (async (url: string, init: any) => {
    captured = { url, init };
    return {
      ok: true,
      status: 200,
      json: async () => ({
        model: 'bge-reranker-v2-m3',
        results: [
          { index: 2, relevance_score: 0.91 },
          { index: 0, relevance_score: 0.40 },
          { index: 1, relevance_score: 0.05 },
        ],
      }),
    };
  }) as any;

  const out = await cohereRerank({ ...baseParams, topN: 3 });

  // request shape
  assert.equal(captured!.url, 'http://127.0.0.1:28417/v1/rerank');
  assert.equal(captured!.init.method, 'POST');
  assert.equal(captured!.init.headers.Authorization, 'Bearer secret');
  const sent = JSON.parse(captured!.init.body);
  assert.equal(sent.model, 'bge-reranker-v2-m3');
  assert.deepEqual(sent.documents, ['doc a', 'doc b', 'doc c']);
  assert.equal(sent.return_documents, false);
  assert.equal(sent.top_n, 3);

  // mapped + sorted
  assert.deepEqual(out.map(i => i.index), [2, 0, 1]);
  assert.equal(out[0].relevanceScore, 0.91);
});

test('omits Authorization header when no apiKey', async () => {
  let headers: any = null;
  global.fetch = (async (_url: string, init: any) => {
    headers = init.headers;
    return { ok: true, status: 200, json: async () => ({ results: [{ index: 0, relevance_score: 1 }] }) };
  }) as any;

  await cohereRerank({ ...baseParams, apiKey: undefined });
  assert.equal(headers.Authorization, undefined);
});

test('returns [] for empty documents without calling fetch', async () => {
  let called = false;
  global.fetch = (async () => { called = true; return { ok: true, status: 200, json: async () => ({}) }; }) as any;
  const out = await cohereRerank({ ...baseParams, documents: [] });
  assert.deepEqual(out, []);
  assert.equal(called, false);
});

test('throws on non-2xx (caller falls back to base order)', async () => {
  global.fetch = (async () => ({ ok: false, status: 503, text: async () => 'model loading' })) as any;
  await assert.rejects(cohereRerank(baseParams), /HTTP 503/);
});

test('throws on empty results array', async () => {
  global.fetch = (async () => ({ ok: true, status: 200, json: async () => ({ results: [] }) })) as any;
  await assert.rejects(cohereRerank(baseParams), /empty or malformed/);
});

test('drops out-of-range indices and throws if none valid', async () => {
  global.fetch = (async () => ({
    ok: true, status: 200,
    json: async () => ({ results: [{ index: 99, relevance_score: 0.9 }] }),
  })) as any;
  await assert.rejects(cohereRerank(baseParams), /no valid indices/);
});
