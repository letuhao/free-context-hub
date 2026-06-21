/**
 * Actor Data Boundary S1 — /api/authz route tests (real DB). **safety-sensitive.**
 *
 * Mirrors src/api/routes/board.test.ts's harness: a minimal Express app hosting authorizationRouter +
 * errorHandler, against the real test DB. Verifies:
 *   - admin gate under auth-ON: a caller with NO bound principal is FORBIDDEN (403) on every route
 *   - admin gate under auth-OFF: assertAuthorized no-ops → routes reachable (dev posture)
 *   - GET /decisions returns rows the agent half wrote to authz_decisions + the stats roll-up
 *   - GET /decisions filter validation → 400
 *   - POST /explain returns a decision (auth-off → AUTH_DISABLED) and validates its body → 400
 */

import assert from 'node:assert/strict';
import test, { before, after, beforeEach } from 'node:test';
import http from 'node:http';
import express from 'express';
import { randomUUID } from 'node:crypto';
import { authorizationRouter } from './authorization.js';
import { errorHandler } from '../middleware/errorHandler.js';
import { getDbPool } from '../../db/client.js';

const PRINCIPAL = randomUUID();

async function cleanup() {
  await getDbPool().query(`DELETE FROM authz_decisions WHERE principal_id = $1`, [PRINCIPAL]);
}

async function seedDecisions() {
  const pool = getDbPool();
  for (const [ts, allow, reason] of [
    ['2026-06-21T09:00:00Z', true, 'GRANT'],
    ['2026-06-21T09:01:00Z', false, 'NO_COVERING_GRANT'],
    ['2026-06-21T09:02:00Z', true, 'ROOT'],
  ] as const) {
    await pool.query(
      `INSERT INTO authz_decisions (ts, principal_id, action, resource_kind, resource_id, allow, reason, origin)
       VALUES ($1,$2,'read','project','projX',$3,$4,'access')`,
      [ts, PRINCIPAL, allow, reason],
    );
  }
}

let server: http.Server;
let baseUrl = '';

// Toggle MCP_AUTH_ENABLED + reset the env cache the same way the service tests do. Under auth-ON the
// env schema requires either CONTEXT_HUB_WORKSPACE_TOKEN or MCP_LEGACY_TOKEN_DISABLED=true; we use the
// api_keys-only posture (legacy token disabled) so getEnv() validates instead of throwing a 500.
async function setAuth(on: boolean) {
  process.env.MCP_AUTH_ENABLED = on ? 'true' : 'false';
  if (on) process.env.MCP_LEGACY_TOKEN_DISABLED = 'true';
  const env = await import('../../env.js');
  env._resetEnvCacheForTest();
}

const savedAuth = process.env.MCP_AUTH_ENABLED;
const savedLegacy = process.env.MCP_LEGACY_TOKEN_DISABLED;

before(async () => {
  await cleanup();
  await seedDecisions();
  const app = express();
  app.use(express.json());
  // Mirror the integrator's mount: an admin-gated router with the shared errorHandler last. The test
  // harness attaches no principal → callerPrincipalOf(req) === null.
  app.use('/api/authz', authorizationRouter);
  app.use(errorHandler);
  server = http.createServer(app);
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', () => resolve()));
  const addr = server.address();
  const port = typeof addr === 'object' && addr ? addr.port : 0;
  baseUrl = `http://127.0.0.1:${port}`;
});

after(async () => {
  await new Promise<void>((resolve) => server.close(() => resolve()));
  await cleanup();
  if (savedAuth === undefined) delete process.env.MCP_AUTH_ENABLED;
  else process.env.MCP_AUTH_ENABLED = savedAuth;
  if (savedLegacy === undefined) delete process.env.MCP_LEGACY_TOKEN_DISABLED;
  else process.env.MCP_LEGACY_TOKEN_DISABLED = savedLegacy;
  const env = await import('../../env.js');
  env._resetEnvCacheForTest();
});

beforeEach(async () => { await setAuth(false); });

function request(method: string, path: string, body?: unknown): Promise<{ status: number; json: any }> {
  return new Promise((resolve, reject) => {
    const payload = body === undefined ? undefined : JSON.stringify(body);
    const req = http.request(
      `${baseUrl}${path}`,
      { method, headers: { 'Content-Type': 'application/json', ...(payload ? { 'Content-Length': Buffer.byteLength(payload) } : {}) } },
      (res) => {
        let raw = '';
        res.setEncoding('utf8');
        res.on('data', (c) => { raw += c; });
        res.on('end', () => {
          let json: any = null;
          try { json = raw ? JSON.parse(raw) : null; } catch { json = raw; }
          resolve({ status: res.statusCode ?? 0, json });
        });
        res.on('error', reject);
      },
    );
    req.on('error', reject);
    req.setTimeout(8000, () => req.destroy(new Error('request timeout')));
    if (payload) req.write(payload);
    req.end();
  });
}

// ── admin gate (auth-ON) ─────────────────────────────────────────────────────

test('GET /decisions is FORBIDDEN (403) under auth-ON with no bound principal', async () => {
  await setAuth(true);
  const r = await request('GET', `/api/authz/decisions?principal_id=${PRINCIPAL}`);
  assert.equal(r.status, 403);
});

test('POST /explain is FORBIDDEN (403) under auth-ON with no bound principal', async () => {
  await setAuth(true);
  const r = await request('POST', '/api/authz/explain', { action: 'read', resource: { kind: 'global' } });
  assert.equal(r.status, 403);
});

// ── decisions read (auth-OFF, dev posture) ───────────────────────────────────

test('GET /decisions returns the rows the agent half wrote + stats', async () => {
  const r = await request('GET', `/api/authz/decisions?principal_id=${PRINCIPAL}`);
  assert.equal(r.status, 200);
  assert.equal(Array.isArray(r.json.decisions), true);
  assert.equal(r.json.decisions.length, 3);
  // newest-first
  assert.equal(r.json.decisions[0].reason, 'ROOT');
  assert.equal(r.json.next_cursor, null);
  // stats roll-up over the same window
  assert.equal(r.json.stats.total, 3);
  assert.equal(r.json.stats.allowed, 2);
  assert.equal(r.json.stats.denied, 1);
});

test('GET /decisions allow=false filters to denies', async () => {
  const r = await request('GET', `/api/authz/decisions?principal_id=${PRINCIPAL}&allow=false`);
  assert.equal(r.status, 200);
  assert.equal(r.json.decisions.length, 1);
  assert.equal(r.json.decisions[0].allow, false);
});

test('GET /decisions with an invalid action → 400', async () => {
  const r = await request('GET', `/api/authz/decisions?principal_id=${PRINCIPAL}&action=destroy`);
  assert.equal(r.status, 400);
});

// ── explain (auth-OFF) ───────────────────────────────────────────────────────

test('POST /explain returns AUTH_DISABLED under auth-OFF', async () => {
  const r = await request('POST', '/api/authz/explain', {
    principal_id: PRINCIPAL,
    action: 'read',
    resource: { kind: 'global' },
  });
  assert.equal(r.status, 200);
  assert.equal(r.json.decision.allow, true);
  assert.equal(r.json.decision.reason, 'AUTH_DISABLED');
});

test('POST /explain validates the body → 400 when resource.kind is missing', async () => {
  const r = await request('POST', '/api/authz/explain', { action: 'read' });
  assert.equal(r.status, 400);
});

test('POST /explain validates the body → 400 when action is missing', async () => {
  const r = await request('POST', '/api/authz/explain', { resource: { kind: 'global' } });
  assert.equal(r.status, 400);
});
