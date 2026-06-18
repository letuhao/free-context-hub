/**
 * Phase 17.3 — nli-judge TS client wiring tests (injected fetchImpl).
 *
 * Pins what the client sends THROUGH fetch: the /entail and /score routes, the JSON
 * body shape, response parsing, and that it retries a transient 5xx once but NOT a
 * 4xx. No live service needed.
 */

import assert from 'node:assert/strict';
import test from 'node:test';

import { nliEntail, nliScore, NliJudgeError } from './nliScore.js';

type Captured = { url: string; body: any };

function stub(responses: Array<{ status: number; json: any }>): {
  calls: Captured[];
  fetchImpl: typeof fetch;
} {
  const calls: Captured[] = [];
  let i = 0;
  const fetchImpl = (async (url: unknown, init: any) => {
    calls.push({ url: String(url), body: init?.body ? JSON.parse(String(init.body)) : undefined });
    const r = responses[Math.min(i, responses.length - 1)]!;
    i += 1;
    return new Response(JSON.stringify(r.json), {
      status: r.status,
      headers: { 'Content-Type': 'application/json' },
    });
  }) as unknown as typeof fetch;
  return { calls, fetchImpl };
}

test('nliEntail posts to /entail and parses the verdict', async () => {
  const { calls, fetchImpl } = stub([
    { status: 200, json: { label: 'entailment', scores: { contradiction: 0.0, entailment: 0.93, neutral: 0.07 } } },
  ]);
  const out = await nliEntail(
    { premise: 'P', hypothesis: 'H' },
    { baseUrl: 'http://nli-host:3006', fetchImpl },
  );
  assert.equal(calls.length, 1);
  assert.match(calls[0]!.url, /nli-host:3006\/entail$/);
  assert.deepEqual(calls[0]!.body, { premise: 'P', hypothesis: 'H' });
  assert.equal(out.label, 'entailment');
  assert.equal(out.scores.entailment, 0.93);
});

test('nliScore posts answer+contexts to /score and returns the aggregate', async () => {
  const { calls, fetchImpl } = stub([
    {
      status: 200,
      json: {
        n_claims: 2,
        nli_faithfulness_strict: 0.5,
        nli_faithfulness_lenient: 0.5,
        nli_contradiction_rate: 0.5,
        per_claim: [],
        model: 'cross-encoder/nli-deberta-v3-small',
      },
    },
  ]);
  const out = await nliScore(
    { answer: 'a. b.', contexts: ['ctx1', 'ctx2'] },
    { baseUrl: 'http://nli-host:3006', fetchImpl },
  );
  assert.match(calls[0]!.url, /\/score$/);
  assert.deepEqual(calls[0]!.body, { answer: 'a. b.', contexts: ['ctx1', 'ctx2'] });
  assert.equal(out.n_claims, 2);
  assert.equal(out.nli_contradiction_rate, 0.5);
});

test('retries once on a transient 5xx then succeeds', async () => {
  const { calls, fetchImpl } = stub([
    { status: 503, json: { error: 'loading' } },
    { status: 200, json: { label: 'neutral', scores: { contradiction: 0.1, entailment: 0.1, neutral: 0.8 } } },
  ]);
  const out = await nliEntail({ premise: 'P', hypothesis: 'H' }, { fetchImpl });
  assert.equal(calls.length, 2, 'one retry after the 503');
  assert.equal(out.label, 'neutral');
});

test('does NOT retry a 4xx client error', async () => {
  const { calls, fetchImpl } = stub([{ status: 422, json: { error: 'bad input' } }]);
  await assert.rejects(
    () => nliScore({ answer: '', contexts: [] }, { fetchImpl }),
    (e: unknown) => e instanceof NliJudgeError && e.status === 422,
  );
  assert.equal(calls.length, 1, 'no retry on 4xx');
});
