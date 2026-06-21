/**
 * Actor Data Boundary F-AUTH (Stream S3) — pre-auth reachability test (the §5 F4 mandatory check).
 *
 * The chicken-and-egg risk: if the integrator pastes `/api/auth` AFTER the blanket bearerAuth gate at
 * index.ts:101, login becomes unreachable (401 with no token) and humans can never authenticate — a
 * failure that compiles and passes isolated handler tests but breaks the live stack. This test pins
 * the mount contract: it builds a minimal app with the SAME ordering the integrator must use
 * (authRouter BEFORE bearerAuth, sessionAuth AFTER) and asserts `POST /api/auth/login` returns a
 * NON-401 (a validation 400 for a bad body, or an auth 401 for bad *credentials* — but reachable)
 * even under MCP_AUTH_ENABLED=true with NO Authorization header.
 *
 * No DB required: a malformed body short-circuits at the handler's 400 before any DB hit, which is
 * sufficient to prove the route is REACHABLE past the gate.
 */

import assert from 'node:assert/strict';
import test from 'node:test';
import http from 'node:http';
import express from 'express';
import { authRouter } from './auth.js';
import { bearerAuth } from '../middleware/auth.js';
import { sessionAuth } from '../middleware/sessionAuth.js';
import { errorHandler } from '../middleware/errorHandler.js';

/** Build the app with the FROZEN mount ordering (§2.1): pre-auth routes before the blanket gate. */
function buildApp() {
  const app = express();
  app.use(express.json());
  // PRE-AUTH: mounted BEFORE the blanket gate (this is the load-bearing order).
  app.use('/api/auth', authRouter);
  // The blanket gate + cooperative session auth, exactly as index.ts wires them.
  app.use('/api', bearerAuth);
  app.use('/api', sessionAuth);
  // A representative gated route to prove the gate actually bites everything AFTER it.
  app.get('/api/gated', (_req, res) => res.json({ ok: true }));
  app.use(errorHandler);
  return app;
}

function request(app: express.Express, method: string, path: string, body?: unknown, headers: Record<string, string> = {}): Promise<{ status: number; body: any }> {
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
            let parsed: any = undefined;
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

test('POST /api/auth/login is REACHABLE without a credential under MCP_AUTH_ENABLED=true', async () => {
  const prev = process.env.MCP_AUTH_ENABLED;
  const prevToken = process.env.CONTEXT_HUB_WORKSPACE_TOKEN;
  process.env.MCP_AUTH_ENABLED = 'true';
  process.env.CONTEXT_HUB_WORKSPACE_TOKEN = 'test-token-for-env-validation';
  try {
    const app = buildApp();
    // Bad body → the handler's own 400. The KEY assertion: it is NOT a 401 from the blanket gate,
    // proving the route is reachable WITHOUT an Authorization header.
    const res = await request(app, 'POST', '/api/auth/login', { email: 123 });
    assert.notEqual(res.status, 401, 'login must NOT be gated behind bearerAuth (got 401 → wrong mount order)');
    assert.equal(res.status, 400, 'reaches the handler and returns its validation error');
  } finally {
    process.env.MCP_AUTH_ENABLED = prev;
    if (prevToken === undefined) delete process.env.CONTEXT_HUB_WORKSPACE_TOKEN; else process.env.CONTEXT_HUB_WORKSPACE_TOKEN = prevToken;
  }
});

test('a route AFTER the gate IS blocked without a credential (proves the gate bites)', async () => {
  const prev = process.env.MCP_AUTH_ENABLED;
  const prevToken = process.env.CONTEXT_HUB_WORKSPACE_TOKEN;
  process.env.MCP_AUTH_ENABLED = 'true';
  process.env.CONTEXT_HUB_WORKSPACE_TOKEN = 'test-token-for-env-validation';
  try {
    const app = buildApp();
    const res = await request(app, 'GET', '/api/gated');
    assert.equal(res.status, 401, 'gated route is correctly blocked → the gate is real, login is a deliberate exclusion');
  } finally {
    process.env.MCP_AUTH_ENABLED = prev;
    if (prevToken === undefined) delete process.env.CONTEXT_HUB_WORKSPACE_TOKEN; else process.env.CONTEXT_HUB_WORKSPACE_TOKEN = prevToken;
  }
});
