/**
 * Phase 17 — query-rewrite lever unit tests.
 *
 * Covers the pure `parseRewrittenQuery` post-processor (the byte-level contract
 * that decides what string actually hits the retriever) and `rewriteQuery`'s
 * graceful-degradation behavior (LLM error / empty completion → fall back to the
 * original query, never block a row).
 */

import assert from 'node:assert/strict';
import test from 'node:test';

import { parseRewriteMode, parseRewrittenQuery, rewriteQuery, HYDE_MAX_CHARS } from './queryRewrite.js';
import type { AnswererConfig } from './genPipeline.js';

const ANSWERER: AnswererConfig = {
  baseUrl: 'http://stub/v1',
  apiKey: 'stub',
  model: 'stub-model',
  temperature: 0.2,
  seed: 42,
  maxTokens: 512,
  timeoutMs: 5_000,
};

/** Build a fetch stub that returns one chat-completion with the given content. */
function fetchReturning(content: string): typeof fetch {
  return (async () =>
    new Response(JSON.stringify({ choices: [{ message: { content }, finish_reason: 'stop' }] }), {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    })) as unknown as typeof fetch;
}

function fetchFailing(status = 500): typeof fetch {
  return (async () => new Response('upstream boom', { status })) as unknown as typeof fetch;
}

test('parseRewriteMode', async (t) => {
  await t.test('recognizes expand/hyde (case-insensitive, trimmed)', () => {
    assert.equal(parseRewriteMode('expand'), 'expand');
    assert.equal(parseRewriteMode('HYDE'), 'hyde');
    assert.equal(parseRewriteMode('  expand  '), 'expand');
  });

  await t.test('undefined / none → none', () => {
    assert.equal(parseRewriteMode(undefined), 'none');
    assert.equal(parseRewriteMode('none'), 'none');
  });

  await t.test('unrecognized value → none (caller warns)', () => {
    assert.equal(parseRewriteMode('expnad'), 'none');
    assert.equal(parseRewriteMode('cove'), 'none');
  });
});

test('parseRewrittenQuery — expand', async (t) => {
  await t.test('single line passes through trimmed', () => {
    assert.equal(parseRewrittenQuery('retry backoff jitter max attempts', 'expand'), 'retry backoff jitter max attempts');
  });

  await t.test('strips a leading label', () => {
    assert.equal(parseRewrittenQuery('Rewritten query: retry backoff config', 'expand'), 'retry backoff config');
    assert.equal(parseRewrittenQuery('Search query: api key auth', 'expand'), 'api key auth');
    assert.equal(parseRewrittenQuery('Query: pgvector embeddings', 'expand'), 'pgvector embeddings');
  });

  await t.test('strips surrounding quotes and backticks', () => {
    assert.equal(parseRewrittenQuery('"retry strategy"', 'expand'), 'retry strategy');
    assert.equal(parseRewrittenQuery('`retry strategy`', 'expand'), 'retry strategy');
    assert.equal(parseRewrittenQuery("'retry strategy'", 'expand'), 'retry strategy');
  });

  await t.test('takes the first non-empty line for expand', () => {
    assert.equal(parseRewrittenQuery('\n\nfirst real line\nsecond line', 'expand'), 'first real line');
  });

  await t.test('empty / whitespace-only → null (caller falls back)', () => {
    assert.equal(parseRewrittenQuery('', 'expand'), null);
    assert.equal(parseRewrittenQuery('   \n  \t', 'expand'), null);
  });

  await t.test('label with empty body → null', () => {
    assert.equal(parseRewrittenQuery('Rewritten query:', 'expand'), null);
  });
});

test('parseRewrittenQuery — hyde', async (t) => {
  await t.test('joins multiple non-empty lines into one passage', () => {
    const out = parseRewrittenQuery('The retry count is 3.\n\nIt uses exponential backoff.', 'hyde');
    assert.equal(out, 'The retry count is 3. It uses exponential backoff.');
  });

  await t.test('strips a leading label but keeps the passage', () => {
    const out = parseRewrittenQuery('Hypothetical answer: The cap is 3 retries.', 'hyde');
    assert.equal(out, 'The cap is 3 retries.');
  });

  await t.test('caps length to HYDE_MAX_CHARS', () => {
    const long = 'x'.repeat(HYDE_MAX_CHARS + 500);
    const out = parseRewrittenQuery(long, 'hyde');
    assert.equal(out?.length, HYDE_MAX_CHARS);
  });

  await t.test('empty → null', () => {
    assert.equal(parseRewrittenQuery('   ', 'hyde'), null);
  });
});

test('rewriteQuery — happy path', async (t) => {
  await t.test('expand returns a trace with the rewritten query dispatched', async () => {
    const tr = await rewriteQuery('how do retries work', 'expand', ANSWERER, {
      fetchImpl: fetchReturning('retry backoff max attempts jitter'),
    });
    assert.equal(tr.mode, 'expand');
    assert.equal(tr.original_query, 'how do retries work');
    assert.equal(tr.rewritten_query, 'retry backoff max attempts jitter');
    assert.equal(tr.fallback, false);
    assert.equal(tr.error, undefined);
    assert.ok(tr.rewrite_ms >= 0);
  });

  await t.test('hyde returns the hypothetical passage as the query', async () => {
    const tr = await rewriteQuery('what is the retry cap', 'hyde', ANSWERER, {
      fetchImpl: fetchReturning('The retry cap is 3 attempts with exponential backoff.'),
    });
    assert.equal(tr.mode, 'hyde');
    assert.equal(tr.rewritten_query, 'The retry cap is 3 attempts with exponential backoff.');
    assert.equal(tr.fallback, false);
  });
});

test('rewriteQuery — graceful degradation', async (t) => {
  await t.test('LLM error → fallback to original query, error recorded', async () => {
    const tr = await rewriteQuery('how do retries work', 'expand', ANSWERER, {
      fetchImpl: fetchFailing(500),
    });
    assert.equal(tr.fallback, true);
    assert.equal(tr.rewritten_query, 'how do retries work', 'dispatches the original query on failure');
    assert.ok(tr.error && tr.error.length > 0);
  });

  await t.test('empty completion → fallback to original query (no error)', async () => {
    const tr = await rewriteQuery('how do retries work', 'expand', ANSWERER, {
      fetchImpl: fetchReturning('   '),
    });
    assert.equal(tr.fallback, true);
    assert.equal(tr.rewritten_query, 'how do retries work');
    assert.equal(tr.error, undefined, 'an empty parse is a fallback, not an error');
  });
});
