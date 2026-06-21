/**
 * Actor Data Boundary completion (warp) — INTEGRATION security regression test (review-impl #2).
 *
 * The slice-level suite (1302 tests) exercises handlers/services in isolation; NOTHING tested the
 * reconcile-node WIRING in src/api/index.ts. So a regression that re-opens the cookie-defer recon hole
 * (adversary A1), reorders the pre-auth mounts (F4), or unmounts csrfGuard (A2) would keep the whole
 * suite green. Unlike auth.reachability.test.ts (which hand-builds a parallel app), this drives the
 * REAL assembled app via `createApiApp`, so it pins the actual artifact.
 *
 * Runs under MCP_AUTH_ENABLED=true (set at module scope; node's test runner isolates each file in its
 * own process, so this does not leak to other suites). A valid env requires CONTEXT_HUB_WORKSPACE_TOKEN
 * under auth-ON. No human/session credential is needed: every assertion resolves at a 401/400 boundary
 * before any authenticated work.
 */

import assert from 'node:assert/strict';
import test from 'node:test';
import http from 'node:http';
import type { Express } from 'express';
import { _resetEnvCacheForTest } from '../env.js';
import { csrfGuard } from './middleware/sessionAuth.js';

process.env.MCP_AUTH_ENABLED = 'true';
process.env.CONTEXT_HUB_WORKSPACE_TOKEN = 'test-token-for-env-validation';
_resetEnvCacheForTest();

function request(
  app: Express,
  method: string,
  path: string,
  headers: Record<string, string> = {},
  body?: unknown,
): Promise<{ status: number; body: unknown }> {
  return new Promise((resolve, reject) => {
    const server = app.listen(0, () => {
      const addr = server.address();
      const port = typeof addr === 'object' && addr ? addr.port : 0;
      const data = body !== undefined ? JSON.stringify(body) : undefined;
      const req = http.request(
        { host: '127.0.0.1', port, path, method, headers: { 'Content-Type': 'application/json', ...headers } },
        (res) => {
          let buf = '';
          res.on('data', (c) => (buf += c));
          res.on('end', () => {
            server.close();
            let parsed: unknown;
            try { parsed = buf ? JSON.parse(buf) : undefined; } catch { parsed = buf; }
            resolve({ status: res.statusCode ?? 0, body: parsed });
          });
        },
      );
      req.on('error', (e) => { server.close(); reject(e); });
      if (data) req.write(data);
      req.end();
    });
  });
}

async function realApp(): Promise<Express> {
  const { createApiApp } = await import('./index.js');
  return createApiApp();
}

test('REAL app (F4): POST /api/auth/login is reachable with no credential under auth-ON', async () => {
  const res = await request(await realApp(), 'POST', '/api/auth/login', {}, { email: 123 });
  assert.notEqual(res.status, 401, 'login must mount BEFORE bearerAuth (401 → wrong mount order in index.ts)');
  assert.equal(res.status, 400, 'reaches the login handler → its own validation 400');
});

test('REAL app (A1): GET /api/system/info → 401 with a junk session cookie + no auth header', async () => {
  const res = await request(await realApp(), 'GET', '/api/system/info', { Cookie: 'chub_session=not-a-real-session' });
  assert.equal(res.status, 401, 'the cookie-defer must not expose /info recon to an unauthenticated junk cookie');
});

test('REAL app (A1): GET /api/system/info → 401 with no credential at all', async () => {
  const res = await request(await realApp(), 'GET', '/api/system/info');
  assert.equal(res.status, 401, '/info is authenticated-only under auth-ON');
});

test('REAL app (gate bites): GET /api/lessons → 401 without a credential', async () => {
  const res = await request(await realApp(), 'GET', '/api/lessons');
  assert.equal(res.status, 401, 'the blanket bearerAuth gate must still block a normal data route');
});

test('REAL app (DEFERRED-060): GET /api/me → 401 with a junk session cookie + no auth header', async () => {
  const res = await request(await realApp(), 'GET', '/api/me', { Cookie: 'chub_session=not-a-real-session' });
  assert.equal(res.status, 401, 'a junk cookie must not get the env-token admin identity from /api/me');
});

test('REAL app (DEFERRED-060): GET /api/me → 401 with no credential at all', async () => {
  const res = await request(await realApp(), 'GET', '/api/me');
  assert.equal(res.status, 401, '/api/me is authenticated-only under auth-ON');
});

// ── csrfGuard unit (A2) — DB-free; verifies the guard logic the global mount relies on ──

function runGuard(req: Record<string, unknown>): { status: number | null; nexted: boolean } {
  let status: number | null = null;
  let nexted = false;
  const res = {
    status(code: number) { status = code; return this; },
    json() { return this; },
  };
  csrfGuard(req as never, res as never, () => { nexted = true; });
  return { status, nexted };
}

test('csrfGuard (A2): cookie-session mutation WITHOUT X-CSRF-Token → 403', () => {
  const r = runGuard({ method: 'POST', headers: {}, session: { csrf_token: 'good' }, authMethod: 'session' });
  assert.equal(r.status, 403);
  assert.equal(r.nexted, false);
});

test('csrfGuard (A2): cookie-session mutation WITH matching X-CSRF-Token → passes', () => {
  const r = runGuard({ method: 'POST', headers: { 'x-csrf-token': 'good' }, session: { csrf_token: 'good' }, authMethod: 'session' });
  assert.equal(r.nexted, true);
  assert.equal(r.status, null);
});

test('csrfGuard (A2): Bearer/agent (non-session) mutation is exempt → passes', () => {
  const r = runGuard({ method: 'POST', headers: {}, authMethod: undefined });
  assert.equal(r.nexted, true);
});

test('csrfGuard (A2): safe method (GET) is exempt even for a session → passes', () => {
  const r = runGuard({ method: 'GET', headers: {}, session: { csrf_token: 'good' }, authMethod: 'session' });
  assert.equal(r.nexted, true);
});
