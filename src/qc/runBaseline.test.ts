/**
 * DEFERRED-035 (addendum) — runBaseline.evalQuery query-rewrite wiring tests.
 *
 * `queryRewrite.ts` itself is unit-tested (parseRewrittenQuery, rewriteQuery
 * fallback). The UNTESTED part was the call SITE: that `evalQuery` computes the
 * rewrite ONCE per query (not once per latency-sample), dispatches the REWRITTEN
 * string (not the original), and attaches the trace to the row. A refactor moving
 * `rewriteQuery` inside the sample loop (→ N× LLM calls/query) or dispatching
 * `q.query` instead of the rewritten string would pass `tsc` + the rest of the
 * suite — these catch it by injecting a counting `fetchImpl` and recording every
 * string `dispatch` receives.
 *
 * Importing `evalQuery` here is only possible because `main()` is entry-point-
 * guarded (isEntryPoint) — importing this module no longer fires the runner.
 */

import assert from 'node:assert/strict';
import test from 'node:test';

import { evalQuery } from './runBaseline.js';
import type { SurfaceResult } from './surfaces.js';
import type { AnswererConfig } from './genPipeline.js';

const ANSWERER: AnswererConfig = {
  baseUrl: 'http://fake-host:1234/v1',
  apiKey: 'fake-key',
  model: 'fake-model',
  temperature: 0,
  seed: 1,
  maxTokens: 64,
  timeoutMs: 5000,
};

/** Counting stub fetch returning a canned chat-completion. `content: ''` makes
 *  parseRewrittenQuery yield null → rewriteQuery falls back (no exception, no
 *  retry), so the fallback test stays fast. */
function captureFetch(content: string): { calls: number; fetchImpl: typeof fetch } {
  const state = { calls: 0 };
  const fetchImpl = (async () => {
    state.calls += 1;
    return new Response(
      JSON.stringify({ choices: [{ message: { content }, finish_reason: 'stop' }] }),
      { status: 200, headers: { 'Content-Type': 'application/json' } },
    );
  }) as unknown as typeof fetch;
  return {
    get calls() {
      return state.calls;
    },
    fetchImpl,
  };
}

/** A dispatch that records every query string it is asked to retrieve. */
function recordingDispatch(): {
  queries: string[];
  dispatch: (query: string, k: number) => Promise<SurfaceResult>;
} {
  const queries: string[] = [];
  const dispatch = async (query: string, _k: number): Promise<SurfaceResult> => {
    queries.push(query);
    return { items: [], latencyMs: 1 };
  };
  return { queries, dispatch };
}

const Q = { id: 'q1', group: 'g', query: 'how do retries work' };

test('evalQuery computes the rewrite ONCE per query and dispatches the rewritten string', async () => {
  const cap = captureFetch('expanded retry backoff keywords');
  const { queries, dispatch } = recordingDispatch();

  const { row } = await evalQuery('lessons', dispatch, Q, 5, 3 /* samples */, undefined, {
    mode: 'expand',
    answerer: ANSWERER,
    fetchImpl: cap.fetchImpl,
  });

  // Invariant 1: the LLM rewrite fired exactly once, NOT once per sample.
  assert.equal(cap.calls, 1, 'rewriteQuery called once per query, not per latency-sample');
  // Invariant 2: every sample dispatched the REWRITTEN string (not the original).
  assert.deepEqual(
    queries,
    ['expanded retry backoff keywords', 'expanded retry backoff keywords', 'expanded retry backoff keywords'],
    'all 3 samples dispatched the rewritten query',
  );
  // Invariant 3: the trace is attached to the row.
  assert.ok(row.rewrite, 'rewrite trace attached to the row');
  assert.equal(row.rewrite!.mode, 'expand');
  assert.equal(row.rewrite!.rewritten_query, 'expanded retry backoff keywords');
  assert.equal(row.rewrite!.fallback, false);
  assert.equal(row.rewrite!.original_query, Q.query);
});

test('evalQuery falls back to the ORIGINAL query when the rewrite yields nothing', async () => {
  const cap = captureFetch(''); // empty completion → parse null → fallback
  const { queries, dispatch } = recordingDispatch();

  const { row } = await evalQuery('lessons', dispatch, Q, 5, 2 /* samples */, undefined, {
    mode: 'expand',
    answerer: ANSWERER,
    fetchImpl: cap.fetchImpl,
  });

  assert.equal(cap.calls, 1, 'one rewrite attempt (empty parse → fallback, no retry storm)');
  assert.deepEqual(queries, [Q.query, Q.query], 'fallback dispatches the original query for every sample');
  assert.ok(row.rewrite, 'fallback still records a trace');
  assert.equal(row.rewrite!.fallback, true);
  assert.equal(row.rewrite!.rewritten_query, Q.query, 'rewritten_query === original on fallback');
});

test('evalQuery with no rewrite dispatches the original query and attaches no trace', async () => {
  const cap = captureFetch('should never be called');
  const { queries, dispatch } = recordingDispatch();

  const { row } = await evalQuery('lessons', dispatch, Q, 5, 2 /* samples */, undefined, undefined);

  assert.equal(cap.calls, 0, 'no rewrite mode → no LLM call');
  assert.deepEqual(queries, [Q.query, Q.query], 'dispatches the raw query unchanged');
  assert.equal(row.rewrite, undefined, 'no trace on the no-rewrite path');
});
