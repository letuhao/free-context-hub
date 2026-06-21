/**
 * Actor Data Boundary S1 — /api/bootstrap route tests (real DB).
 *
 * The bootstrap router is PRE-AUTH (mounted before bearerAuth) but ROOT_BOOTSTRAP_TOKEN-gated.
 * Verifies the token gate is the real gate (NOT the bearer gate):
 *   - no token            → 401
 *   - wrong token         → 401
 *   - GET /status w/ token → 200 (reachable with NO Authorization header — only the bootstrap token)
 *   - unconfigured token   → 400
 *
 * Does NOT exercise POST /root end-to-end (it mints the irreplaceable root credential against the
 * shared DB) — that path is covered by services/bootstrap.test.ts. Here we pin the route's gating.
 */

import assert from 'node:assert/strict';
import test, { before, after } from 'node:test';
import http from 'node:http';
import express from 'express';
import { bootstrapRouter } from './bootstrap.js';
import { errorHandler } from '../middleware/errorHandler.js';

const TOKEN = '__test_s1_bootstrap_token__';

let server: http.Server;
let baseUrl = '';
const savedToken = process.env.ROOT_BOOTSTRAP_TOKEN;

async function setToken(value: string | undefined) {
  if (value === undefined) delete process.env.ROOT_BOOTSTRAP_TOKEN;
  else process.env.ROOT_BOOTSTRAP_TOKEN = value;
  const env = await import('../../env.js');
  env._resetEnvCacheForTest();
}

before(async () => {
  await setToken(TOKEN);
  const app = express();
  app.use(express.json());
  app.use('/api/bootstrap', bootstrapRouter);
  app.use(errorHandler);
  server = http.createServer(app);
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', () => resolve()));
  const addr = server.address();
  baseUrl = `http://127.0.0.1:${typeof addr === 'object' && addr ? addr.port : 0}`;
});

after(async () => {
  await new Promise<void>((resolve) => server.close(() => resolve()));
  await setToken(savedToken);
});

function request(method: string, path: string, headers: Record<string, string> = {}, body?: unknown): Promise<{ status: number; json: any }> {
  return new Promise((resolve, reject) => {
    const payload = body === undefined ? undefined : JSON.stringify(body);
    const req = http.request(
      `${baseUrl}${path}`,
      { method, headers: { 'Content-Type': 'application/json', ...headers, ...(payload ? { 'Content-Length': Buffer.byteLength(payload) } : {}) } },
      (res) => {
        let raw = '';
        res.setEncoding('utf8');
        res.on('data', (c) => { raw += c; });
        res.on('end', () => { let json: any = null; try { json = raw ? JSON.parse(raw) : null; } catch { json = raw; } resolve({ status: res.statusCode ?? 0, json }); });
        res.on('error', reject);
      },
    );
    req.on('error', reject);
    req.setTimeout(8000, () => req.destroy(new Error('request timeout')));
    if (payload) req.write(payload);
    req.end();
  });
}

test('GET /status with no bootstrap token → 401', async () => {
  const r = await request('GET', '/api/bootstrap/status');
  assert.equal(r.status, 401);
});

test('GET /status with a wrong bootstrap token → 401', async () => {
  const r = await request('GET', '/api/bootstrap/status', { 'X-Bootstrap-Token': 'wrong' });
  assert.equal(r.status, 401);
});

test('GET /status with the correct token → 200 (no Authorization header needed)', async () => {
  const r = await request('GET', '/api/bootstrap/status', { 'X-Bootstrap-Token': TOKEN });
  assert.equal(r.status, 200);
  assert.equal(typeof r.json.has_root, 'boolean');
  assert.equal('enforce_ready' in r.json, true);
});

test('POST /operator without a token → 401', async () => {
  const r = await request('POST', '/api/bootstrap/operator', {}, { display_name: 'op' });
  assert.equal(r.status, 401);
});

test('POST /operator with token but no email → 400 [DEFERRED-063]', async () => {
  const r = await request('POST', '/api/bootstrap/operator', { 'X-Bootstrap-Token': TOKEN }, { display_name: 'op' });
  assert.equal(r.status, 400);
});

test('POST /operator with token + email → 201 issues a single-use invite [DEFERRED-063]', async () => {
  // The invite is attributed to root (its delegation origin); ensure one exists on the shared DB.
  const { getRootPrincipal, seedRootPrincipal } = await import('../../services/principals.js');
  if (!(await getRootPrincipal())) await seedRootPrincipal({ display_name: '__test_s1_root__' });
  const email = `__test_s1_op__${Math.random().toString(36).slice(2)}@example.com`;
  const r = await request('POST', '/api/bootstrap/operator', { 'X-Bootstrap-Token': TOKEN }, { email, display_name: 'op' });
  assert.equal(r.status, 201, JSON.stringify(r.json));
  assert.equal(r.json.status, 'invited');
  assert.ok(typeof r.json.invite_token === 'string' && r.json.invite_token.length > 0, 'returns a single-use invite token');
  assert.equal(r.json.email, email);
  const { getDbPool } = await import('../../db/client.js');
  await getDbPool().query(`DELETE FROM invites WHERE email = $1`, [email]);
});

test('GET /status with token unconfigured → 400', async () => {
  await setToken(undefined);
  try {
    const r = await request('GET', '/api/bootstrap/status', { 'X-Bootstrap-Token': TOKEN });
    assert.equal(r.status, 400);
  } finally {
    await setToken(TOKEN);
  }
});
