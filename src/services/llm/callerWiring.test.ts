/**
 * DEFERRED-035 — per-caller wiring regression tests for the shared LLM client.
 *
 * `chatComplete` itself is unit-tested. These tests pin what each CALLER actually
 * sends THROUGH it: the right model var, base-url/key, and message shape (vision's
 * multimodal image block, the generative reranker's ranking prompt). A future edit
 * that mis-wires a caller (wrong model env, dropped apiKey, broken multimodal block)
 * would pass `tsc` + the rest of the suite — these catch it by asserting the real
 * HTTP request body via an injected `fetchImpl`.
 */

import assert from 'node:assert/strict';
import test from 'node:test';

import { distillLesson } from '../distiller.js';
import { extractPageVision } from '../extraction/vision.js';
import { rerankCandidates } from '../lessons.js';
import { _resetEnvCacheForTest } from '../../env.js';

type Captured = { url: string; headers: Record<string, string>; body: any };

/** Stub fetch that records the request and returns a canned chat-completion. */
function captureFetch(content: string): { calls: Captured[]; fetchImpl: typeof fetch } {
  const calls: Captured[] = [];
  const fetchImpl = (async (url: unknown, init: any) => {
    calls.push({
      url: String(url),
      headers: (init?.headers ?? {}) as Record<string, string>,
      body: init?.body ? JSON.parse(String(init.body)) : undefined,
    });
    return new Response(
      JSON.stringify({ choices: [{ message: { content }, finish_reason: 'stop' }] }),
      { status: 200, headers: { 'Content-Type': 'application/json' } },
    );
  }) as unknown as typeof fetch;
  return { calls, fetchImpl };
}

/** Set env vars + bust the typed-env cache; returns a restore fn. */
function withEnv(vars: Record<string, string | undefined>): () => void {
  const prev: Record<string, string | undefined> = {};
  for (const k of Object.keys(vars)) prev[k] = process.env[k];
  for (const [k, v] of Object.entries(vars)) {
    if (v === undefined) delete process.env[k];
    else process.env[k] = v;
  }
  _resetEnvCacheForTest();
  return () => {
    for (const [k, v] of Object.entries(prev)) {
      if (v === undefined) delete process.env[k];
      else process.env[k] = v;
    }
    _resetEnvCacheForTest();
  };
}

test('distiller wiring — distillLesson sends DISTILLATION_MODEL + base-url/key', async () => {
  const restore = withEnv({
    DISTILLATION_MODEL: 'distill-model-x',
    DISTILLATION_BASE_URL: 'http://distill-host:1234/v1',
    DISTILLATION_API_KEY: 'distill-key',
    DISTILLATION_TIMEOUT_MS: '5000',
  });
  try {
    const { calls, fetchImpl } = captureFetch('{"summary":"a short summary","quick_action":"do the thing"}');
    const out = await distillLesson({ title: 'My Title', content: 'My Body Content' }, { fetchImpl });

    assert.equal(calls.length, 1, 'exactly one chat call');
    const { url, headers, body } = calls[0]!;
    assert.match(url, /distill-host:1234\/v1\/chat\/completions/, 'uses DISTILLATION_BASE_URL');
    assert.equal(body.model, 'distill-model-x', 'uses DISTILLATION_MODEL — not a hardcoded/wrong model');
    assert.equal(headers.Authorization, 'Bearer distill-key', 'passes DISTILLATION_API_KEY');
    // prompt carries the lesson title + body so the model has the input
    const userMsg = body.messages.find((m: any) => m.role === 'user');
    assert.ok(userMsg && /My Title/.test(userMsg.content) && /My Body Content/.test(userMsg.content));
    // and the result is parsed from the JSON the model returned
    assert.deepEqual(out, { summary: 'a short summary', quick_action: 'do the thing' });
  } finally {
    restore();
  }
});

test('vision wiring — extractPageVision sends the multimodal image_url block', async () => {
  const restore = withEnv({
    VISION_MODEL: 'vision-model-x',
    VISION_BASE_URL: 'http://vision-host:1234/v1',
    VISION_API_KEY: 'vision-key',
    VISION_MAX_TOKENS: '256',
    VISION_PAGE_RETRIES: '0',
  });
  try {
    const { calls, fetchImpl } = captureFetch('# Extracted markdown');
    const png = Buffer.from('fake-png-bytes');
    await extractPageVision({ imagePng: png, fetchImpl });

    assert.equal(calls.length, 1);
    const { url, headers, body } = calls[0]!;
    assert.match(url, /vision-host:1234\/v1\/chat\/completions/, 'uses VISION_BASE_URL');
    assert.equal(body.model, 'vision-model-x', 'uses VISION_MODEL');
    assert.equal(headers.Authorization, 'Bearer vision-key', 'passes VISION_API_KEY');
    // The defining vision wiring: content is a multimodal array (text + image_url).
    const content = body.messages[0].content;
    assert.ok(Array.isArray(content), 'message content is a multimodal block array');
    assert.equal(content[0].type, 'text');
    assert.equal(content[1].type, 'image_url');
    assert.match(content[1].image_url.url, /^data:image\/png;base64,/, 'image is a base64 PNG data URI');
    assert.equal(content[1].image_url.url, `data:image/png;base64,${png.toString('base64')}`);
  } finally {
    restore();
  }
});

test('lessons rerank wiring — generative path sends the ranking prompt + RERANK/DISTILLATION model', async () => {
  const restore = withEnv({
    RERANK_TYPE: 'generative',
    RERANK_MODEL: 'rerank-model-x',
    DISTILLATION_MODEL: 'distill-fallback',
    DISTILLATION_ENABLED: 'true',
    DISTILLATION_BASE_URL: 'http://rerank-host:1234/v1',
    DISTILLATION_API_KEY: 'rerank-key',
  });
  try {
    const { calls, fetchImpl } = captureFetch('{"order":[1,0]}');
    const order = await rerankCandidates({
      query: 'how do retries work',
      candidates: [
        { index: 0, title: 'Alpha', snippet: 'alpha snippet' },
        { index: 1, title: 'Beta', snippet: 'beta snippet' },
      ],
      fetchImpl,
    });

    assert.equal(calls.length, 1, 'generative rerank made exactly one chat call');
    const { body } = calls[0]!;
    assert.equal(body.model, 'rerank-model-x', 'uses RERANK_MODEL (not the DISTILLATION fallback)');
    const userMsg = body.messages.find((m: any) => m.role === 'user');
    assert.ok(userMsg && /how do retries work/.test(userMsg.content), 'prompt carries the query');
    assert.ok(/Alpha/.test(userMsg.content) && /Beta/.test(userMsg.content), 'prompt lists the candidates');
    // the JSON order the model returned is applied to candidate indices
    assert.deepEqual(order, [1, 0]);
  } finally {
    restore();
  }
});
