/**
 * Actor Data Boundary S1 — /api/principals route tests (real DB).
 *
 * Verifies the admin gate (auth-ON → 403 with no bound principal) and, under auth-OFF (dev posture):
 *   - POST / creates a principal (201) and validates display_name (400)
 *   - GET /  lists principals
 *   - GET /:id returns the principal + its bound credentials + grants (404 when unknown)
 *   - PATCH /:id/status transitions status
 */

import assert from 'node:assert/strict';
import test, { before, after, beforeEach } from 'node:test';
import http from 'node:http';
import express from 'express';
import { principalsRouter } from './principals.js';
import { errorHandler } from '../middleware/errorHandler.js';
import { getDbPool } from '../../db/client.js';

const PREFIX = '__test_s1_principals__';

async function cleanup() {
  const pool = getDbPool();
  await pool.query(
    `DELETE FROM grants WHERE grantee_principal IN (SELECT principal_id FROM principals WHERE display_name LIKE $1)`,
    [`${PREFIX}%`],
  );
  await pool.query(`DELETE FROM principals WHERE display_name LIKE $1`, [`${PREFIX}%`]);
}

let server: http.Server;
let baseUrl = '';
const savedAuth = process.env.MCP_AUTH_ENABLED;
const savedLegacy = process.env.MCP_LEGACY_TOKEN_DISABLED;

async function setAuth(on: boolean) {
  process.env.MCP_AUTH_ENABLED = on ? 'true' : 'false';
  if (on) process.env.MCP_LEGACY_TOKEN_DISABLED = 'true';
  const env = await import('../../env.js');
  env._resetEnvCacheForTest();
}

before(async () => {
  await cleanup();
  const app = express();
  app.use(express.json());
  app.use('/api/principals', principalsRouter);
  app.use(errorHandler);
  server = http.createServer(app);
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', () => resolve()));
  const addr = server.address();
  baseUrl = `http://127.0.0.1:${typeof addr === 'object' && addr ? addr.port : 0}`;
});

after(async () => {
  await new Promise<void>((resolve) => server.close(() => resolve()));
  await cleanup();
  if (savedAuth === undefined) delete process.env.MCP_AUTH_ENABLED; else process.env.MCP_AUTH_ENABLED = savedAuth;
  if (savedLegacy === undefined) delete process.env.MCP_LEGACY_TOKEN_DISABLED; else process.env.MCP_LEGACY_TOKEN_DISABLED = savedLegacy;
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

test('admin gate: POST / is 403 under auth-ON with no bound principal', async () => {
  await setAuth(true);
  const r = await request('POST', '/api/principals', { kind: 'agent', display_name: `${PREFIX}x` });
  assert.equal(r.status, 403);
});

test('admin gate: GET / is 403 under auth-ON with no bound principal', async () => {
  await setAuth(true);
  const r = await request('GET', '/api/principals');
  assert.equal(r.status, 403);
});

test('POST / creates a principal (auth-OFF)', async () => {
  const r = await request('POST', '/api/principals', { kind: 'agent', display_name: `${PREFIX}alice` });
  assert.equal(r.status, 201);
  assert.equal(r.json.principal.display_name, `${PREFIX}alice`);
  assert.equal(r.json.principal.kind, 'agent');
  assert.equal(r.json.principal.is_root, false);
});

test('POST / validates display_name → 400', async () => {
  const r = await request('POST', '/api/principals', { kind: 'agent' });
  assert.equal(r.status, 400);
});

test('GET / lists principals', async () => {
  await request('POST', '/api/principals', { kind: 'agent', display_name: `${PREFIX}bob` });
  const r = await request('GET', '/api/principals');
  assert.equal(r.status, 200);
  assert.equal(Array.isArray(r.json.principals), true);
  assert.ok(r.json.principals.some((p: any) => p.display_name === `${PREFIX}bob`));
});

test('GET /:id returns principal + credentials + grants', async () => {
  const created = await request('POST', '/api/principals', { kind: 'agent', display_name: `${PREFIX}carol` });
  const id = created.json.principal.principal_id;
  const r = await request('GET', `/api/principals/${id}`);
  assert.equal(r.status, 200);
  assert.equal(r.json.principal.principal_id, id);
  assert.equal(Array.isArray(r.json.credentials), true);
  assert.equal(Array.isArray(r.json.grants), true);
});

test('GET /:id is 404 for an unknown principal', async () => {
  const r = await request('GET', '/api/principals/00000000-0000-0000-0000-000000000000');
  assert.equal(r.status, 404);
});

test('PATCH /:id/status transitions to suspended', async () => {
  const created = await request('POST', '/api/principals', { kind: 'agent', display_name: `${PREFIX}dave` });
  const id = created.json.principal.principal_id;
  const r = await request('PATCH', `/api/principals/${id}/status`, { status: 'suspended' });
  assert.equal(r.status, 200);
  assert.equal(r.json.principal.status, 'suspended');
});

test('PATCH /:id/status validates the body → 400', async () => {
  const created = await request('POST', '/api/principals', { kind: 'agent', display_name: `${PREFIX}erin` });
  const id = created.json.principal.principal_id;
  const r = await request('PATCH', `/api/principals/${id}/status`, {});
  assert.equal(r.status, 400);
});
