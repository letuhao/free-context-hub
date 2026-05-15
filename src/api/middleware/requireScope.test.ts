/**
 * Phase 13 Sprint 13.2 — requireScope middleware unit tests.
 */

import assert from 'node:assert/strict';
import test from 'node:test';
import { requireScope } from './requireScope.js';

function mockReqRes(req: Record<string, unknown>): {
  req: Record<string, unknown>;
  res: { statusValue: number; jsonValue: unknown; status: (n: number) => any; json: (v: unknown) => any };
  nextCalled: boolean;
} {
  const ctx = {
    req,
    res: {
      statusValue: 0,
      jsonValue: null as unknown,
      status(n: number) { this.statusValue = n; return this; },
      json(v: unknown) { this.jsonValue = v; return this; },
    },
    nextCalled: false,
  };
  return ctx;
}

test('requireScope allows when no scope attached (auth disabled / env-var token)', () => {
  const m = requireScope();
  const ctx = mockReqRes({ params: { id: 'proj-A' } });
  m(ctx.req as any, ctx.res as any, () => { ctx.nextCalled = true; });
  assert.equal(ctx.nextCalled, true);
  assert.equal(ctx.res.statusValue, 0);
});

// r2 F1 fix: verify the fallback is keyed on scope, not role
test('requireScope rejects when scope is attached even if role is not (future auth shapes)', () => {
  const m = requireScope();
  const ctx = mockReqRes({ params: { id: 'proj-B' }, apiKeyScope: 'proj-A' });
  m(ctx.req as any, ctx.res as any, () => { ctx.nextCalled = true; });
  assert.equal(ctx.nextCalled, false, 'must NOT pass through when scope is set without role');
  assert.equal(ctx.res.statusValue, 403);
});

test('requireScope allows when apiKeyScope is null (global key)', () => {
  const m = requireScope();
  const ctx = mockReqRes({ params: { id: 'proj-A' }, apiKeyRole: 'admin', apiKeyScope: null });
  m(ctx.req as any, ctx.res as any, () => { ctx.nextCalled = true; });
  assert.equal(ctx.nextCalled, true);
});

test('requireScope allows when apiKeyScope matches URL param', () => {
  const m = requireScope();
  const ctx = mockReqRes({ params: { id: 'proj-A' }, apiKeyRole: 'admin', apiKeyScope: 'proj-A' });
  m(ctx.req as any, ctx.res as any, () => { ctx.nextCalled = true; });
  assert.equal(ctx.nextCalled, true);
});

test('requireScope rejects 403 when scope mismatches URL param', () => {
  const m = requireScope();
  const ctx = mockReqRes({ params: { id: 'proj-B' }, apiKeyRole: 'admin', apiKeyScope: 'proj-A' });
  m(ctx.req as any, ctx.res as any, () => { ctx.nextCalled = true; });
  assert.equal(ctx.nextCalled, false);
  assert.equal(ctx.res.statusValue, 403);
  const body = ctx.res.jsonValue as { error: string };
  assert.match(body.error, /scoped to 'proj-A'/);
  assert.match(body.error, /cannot access 'proj-B'/);
});

test('requireScope 400s when URL param missing', () => {
  const m = requireScope('id');
  const ctx = mockReqRes({ params: {}, apiKeyRole: 'admin', apiKeyScope: 'proj-A' });
  m(ctx.req as any, ctx.res as any, () => { ctx.nextCalled = true; });
  assert.equal(ctx.nextCalled, false);
  assert.equal(ctx.res.statusValue, 400);
});

test('requireScope supports custom paramName', () => {
  const m = requireScope('projectId');
  const ctx = mockReqRes({ params: { projectId: 'proj-A' }, apiKeyRole: 'admin', apiKeyScope: 'proj-A' });
  m(ctx.req as any, ctx.res as any, () => { ctx.nextCalled = true; });
  assert.equal(ctx.nextCalled, true);
});
