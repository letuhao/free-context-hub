/**
 * Phase 16 Sprint 16.2 D3 — unit tests for the ragas-judge TS client.
 *
 * Uses a stub `fetchImpl` so tests don't need the sidecar running. Covers:
 *   - happy path: 200 with scores → parsed JudgeResponse
 *   - 422 from sidecar → throws JudgeError with status=422
 *   - 5xx then 200: retries once, succeeds
 *   - 5xx then 5xx: throws JudgeError with status=500+
 *   - network error then 200: retries once
 *   - malformed JSON body: throws JudgeError
 *   - retryOnce=false: doesn't retry
 *   - health probe happy path
 *   - health probe sad path
 */

import assert from 'node:assert/strict';
import test from 'node:test';

import { scoreOnce, judgeHealthy, JudgeError, type JudgeRequest } from './judge.js';

function makeResp(status: number, body: unknown): Response {
  const text = typeof body === 'string' ? body : JSON.stringify(body);
  return new Response(text, { status });
}

const baseReq: JudgeRequest = {
  question: 'q',
  answer: 'a',
  contexts: [{ id: 'c1', text: 'ctx' }],
  ground_truth: 'gt',
  answer_category: 'standard',
  metrics: ['faithfulness', 'answer_relevancy'],
};

test('scoreOnce', async (t) => {
  await t.test('200 OK → returns parsed JudgeResponse', async () => {
    const stubFetch = async () =>
      makeResp(200, {
        request_id: 'r1',
        scores: { faithfulness: 0.91, answer_relevancy: 0.88 },
        reasons: {},
        skipped: [],
        skip_reason: null,
        errors: [],
        judge_call_count: 2,
        judge_latency_ms: 1230,
        cache_hit: false,
      });
    const r = await scoreOnce(baseReq, { fetchImpl: stubFetch as any });
    assert.equal(r.scores.faithfulness, 0.91);
    assert.equal(r.scores.answer_relevancy, 0.88);
    assert.equal(r.judge_call_count, 2);
  });

  await t.test('422 → throws JudgeError with status', async () => {
    const stubFetch = async () => makeResp(422, { detail: { error: 'empty_contexts' } });
    await assert.rejects(
      () => scoreOnce(baseReq, { fetchImpl: stubFetch as any }),
      (err: unknown) => {
        assert.ok(err instanceof JudgeError);
        assert.equal(err.status, 422);
        return true;
      },
    );
  });

  await t.test('5xx then 200 → retries once and succeeds', async () => {
    let n = 0;
    const stubFetch = async () => {
      n++;
      if (n === 1) return makeResp(503, { error: 'judge unreachable' });
      return makeResp(200, {
        scores: { faithfulness: 0.5 },
        reasons: {},
        skipped: [],
        errors: [],
        judge_call_count: 1,
        judge_latency_ms: 100,
        cache_hit: false,
      });
    };
    const r = await scoreOnce(baseReq, { fetchImpl: stubFetch as any });
    assert.equal(n, 2);
    assert.equal(r.scores.faithfulness, 0.5);
  });

  await t.test('5xx then 5xx → throws JudgeError after 3 attempts (Phase 17.x)', async () => {
    let n = 0;
    const stubFetch = async () => {
      n++;
      return makeResp(500, { error: 'down' });
    };
    await assert.rejects(
      () => scoreOnce(baseReq, { fetchImpl: stubFetch as any }),
      (err: unknown) => {
        assert.ok(err instanceof JudgeError);
        assert.equal(err.status, 500);
        return true;
      },
    );
    // Phase 17.x bumped from 1 retry → 2 retries (3 attempts total) for LM
    // Studio ECONNRESET resilience.
    assert.equal(n, 3);
  });

  await t.test('network error then 200 → retries once', async () => {
    let n = 0;
    const stubFetch = async () => {
      n++;
      if (n === 1) throw new TypeError('ECONNREFUSED');
      return makeResp(200, {
        scores: { faithfulness: 0.7 },
        reasons: {},
        skipped: [],
        errors: [],
        judge_call_count: 1,
        judge_latency_ms: 50,
        cache_hit: false,
      });
    };
    const r = await scoreOnce(baseReq, { fetchImpl: stubFetch as any });
    assert.equal(n, 2);
    assert.equal(r.scores.faithfulness, 0.7);
  });

  await t.test('malformed JSON → throws JudgeError', async () => {
    const stubFetch = async () => new Response('not json', { status: 200 });
    await assert.rejects(
      () => scoreOnce(baseReq, { fetchImpl: stubFetch as any }),
      (err: unknown) => {
        assert.ok(err instanceof JudgeError);
        assert.match(err.message, /malformed JSON/);
        return true;
      },
    );
  });

  await t.test('retryOnce=false → does not retry on 5xx', async () => {
    let n = 0;
    const stubFetch = async () => {
      n++;
      return makeResp(503, { error: 'down' });
    };
    await assert.rejects(() =>
      scoreOnce(baseReq, { fetchImpl: stubFetch as any, retryOnce: false }),
    );
    assert.equal(n, 1);
  });

  await t.test('passes request body verbatim', async () => {
    let seenBody = '';
    const stubFetch = async (_url: string | URL, init?: RequestInit) => {
      seenBody = init?.body as string;
      return makeResp(200, {
        scores: {},
        reasons: {},
        skipped: [],
        errors: [],
        judge_call_count: 0,
        judge_latency_ms: 0,
        cache_hit: false,
      });
    };
    await scoreOnce(baseReq, { fetchImpl: stubFetch as any });
    const sent = JSON.parse(seenBody);
    assert.equal(sent.question, 'q');
    assert.equal(sent.ground_truth, 'gt');
    assert.deepEqual(sent.metrics, ['faithfulness', 'answer_relevancy']);
  });

  await t.test('passes errors[] through unchanged', async () => {
    const stubFetch = async () =>
      makeResp(200, {
        scores: { faithfulness: null },
        reasons: {},
        skipped: [],
        errors: [{ metric: 'faithfulness', error: 'metric_failed', detail: 'boom' }],
        judge_call_count: 1,
        judge_latency_ms: 200,
        cache_hit: false,
      });
    const r = await scoreOnce(baseReq, { fetchImpl: stubFetch as any });
    assert.equal(r.scores.faithfulness, null);
    assert.equal(r.errors.length, 1);
    assert.equal(r.errors[0].metric, 'faithfulness');
  });
});

test('judgeHealthy', async (t) => {
  await t.test('200 + status=ok → true', async () => {
    const stubFetch = async () =>
      makeResp(200, { status: 'ok', ragas_version: '0.4.3' });
    assert.equal(await judgeHealthy({ fetchImpl: stubFetch as any }), true);
  });

  await t.test('200 + status=anything-else → false', async () => {
    const stubFetch = async () => makeResp(200, { status: 'degraded' });
    assert.equal(await judgeHealthy({ fetchImpl: stubFetch as any }), false);
  });

  await t.test('5xx → false', async () => {
    const stubFetch = async () => makeResp(503, { error: 'down' });
    assert.equal(await judgeHealthy({ fetchImpl: stubFetch as any }), false);
  });

  await t.test('network error → false (does not throw)', async () => {
    const stubFetch = async () => {
      throw new TypeError('ECONNREFUSED');
    };
    assert.equal(await judgeHealthy({ fetchImpl: stubFetch as any }), false);
  });
});
