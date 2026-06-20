/**
 * errorHandler — ContextHubError → HTTP status mapping. Guards the F2 FORBIDDEN→403 addition
 * (review-impl #6) plus the existing codes and the unknown-error no-leak path.
 */

import assert from 'node:assert/strict';
import test from 'node:test';
import type { Request, Response, NextFunction } from 'express';
import { errorHandler } from './errorHandler.js';
import { ContextHubError } from '../../core/index.js';

function mockRes() {
  const res: { statusCode: number; body: { error?: string } | null; status: (c: number) => typeof res; json: (b: unknown) => typeof res } = {
    statusCode: 0,
    body: null,
    status(c: number) { this.statusCode = c; return this; },
    json(b: unknown) { this.body = b as { error?: string }; return this; },
  };
  return res;
}

const noop: NextFunction = () => {};

test('errorHandler maps ContextHubError codes to HTTP status (incl. FORBIDDEN→403)', () => {
  const cases: Array<[string, number]> = [
    ['FORBIDDEN', 403],
    ['UNAUTHORIZED', 401],
    ['NOT_FOUND', 404],
    ['CONFLICT', 409],
    ['BAD_REQUEST', 400],
    ['ASSERTED_IDENTITY_REJECTED', 403],
    ['CREDENTIAL_EXPIRED', 401],
    ['SERVICE_UNAVAILABLE', 503],
  ];
  for (const [code, status] of cases) {
    const res = mockRes();
    errorHandler(new ContextHubError(code as never, 'msg'), {} as Request, res as unknown as Response, noop);
    assert.equal(res.statusCode, status, `${code} should map to ${status}`);
    assert.equal(res.body?.error, 'msg', 'ContextHubError message is surfaced');
  }
});

test('errorHandler maps an unknown Error to 500 without leaking internals', () => {
  const res = mockRes();
  errorHandler(new Error('secret stack details'), {} as Request, res as unknown as Response, noop);
  assert.equal(res.statusCode, 500);
  assert.equal(res.body?.error, 'Internal server error', 'internal message not leaked');
});
