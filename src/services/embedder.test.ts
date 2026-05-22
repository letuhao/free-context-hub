/**
 * DEFERRED-025 — embedder error classification.
 *
 * When the embeddings server is down / the model is unloaded, embedTexts must throw a
 * typed ContextHubError('SERVICE_UNAVAILABLE') rather than a generic Error. This is what
 * lets read paths (searchLessons) catch-and-fall-back to FTS and write paths surface a
 * clean 503 instead of leaking a raw "HTTP 400" as an unhandled 500.
 */

import assert from 'node:assert/strict';
import test, { afterEach } from 'node:test';
import { embedTexts } from './embedder.js';
import { ContextHubError } from '../core/errors.js';

const realFetch = global.fetch;
afterEach(() => { global.fetch = realFetch; });

test('DEFERRED-025: embedTexts throws SERVICE_UNAVAILABLE when the model is unavailable', async () => {
  global.fetch = (async () => ({
    ok: false,
    status: 400,
    text: async () => '{"error":"Model has not started loading/has been unloaded.."}',
  })) as any;

  await assert.rejects(
    embedTexts(['probe']),
    (err: unknown) => {
      assert.ok(err instanceof ContextHubError, 'must be a ContextHubError');
      assert.equal((err as ContextHubError).code, 'SERVICE_UNAVAILABLE');
      return true;
    },
  );
});
