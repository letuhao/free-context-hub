/**
 * Actor Data Boundary S1 — /api/grants route tests (real DB).
 *
 * Verifies the admin gate (auth-ON → 403) and, under auth-OFF (dev posture):
 *   - GET / lists grants (with filters)
 *   - POST / is FORBIDDEN under auth-OFF (grantCapability refuses delegated granting while auth is
 *     off — initial grants are seeded via the backfill/CLI, NOT this policy path; grantCapability.ts)
 *   - DELETE /:id is idempotent (unknown id → noop)
 *   - POST / validates grantee_principal → 400
 */

import assert from 'node:assert/strict';
import test, { before, after, beforeEach } from 'node:test';
import http from 'node:http';
import express from 'express';
import { grantsRouter } from './grants.js';
import { errorHandler } from '../middleware/errorHandler.js';
import { getDbPool } from '../../db/client.js';
import { createPrincipal, getRootPrincipal } from '../../services/principals.js';
import { createGrant } from '../../services/grants.js';

const PREFIX = '__test_s1_grants__';
const SCOPE = `${PREFIX}projG`;

async function cleanup() {
  const pool = getDbPool();
  await pool.query(
    `DELETE FROM grants WHERE grantee_principal IN (SELECT principal_id FROM principals WHERE display_name LIKE $1)
        OR scope_id = $2`,
    [`${PREFIX}%`, SCOPE],
  );
  await pool.query(`DELETE FROM principals WHERE display_name LIKE $1`, [`${PREFIX}%`]);
}

let server: http.Server;
let baseUrl = '';
let granteeId = '';
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
  // Seed a grantee + one grant (granted_by root) directly via the service (the auth-off seed path).
  const grantee = await createPrincipal({ kind: 'agent', display_name: `${PREFIX}grantee` });
  granteeId = grantee.principal_id;
  const root = await getRootPrincipal();
  if (root) {
    await createGrant({
      grantee_principal: granteeId,
      scope_type: 'project',
      scope_id: SCOPE,
      capability: 'read',
      granted_by: root.principal_id,
    });
  }
  const app = express();
  app.use(express.json());
  app.use('/api/grants', grantsRouter);
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

test('admin gate: GET / is 403 under auth-ON with no bound principal', async () => {
  await setAuth(true);
  const r = await request('GET', '/api/grants');
  assert.equal(r.status, 403);
});

test('GET / lists grants, filterable by grantee_principal', async () => {
  const r = await request('GET', `/api/grants?grantee_principal=${granteeId}`);
  assert.equal(r.status, 200);
  assert.equal(Array.isArray(r.json.grants), true);
  assert.ok(r.json.grants.some((g: any) => g.grantee_principal === granteeId && g.scope_id === SCOPE));
});

test('POST / is FORBIDDEN under auth-OFF (delegated granting needs an enforced identity)', async () => {
  const r = await request('POST', '/api/grants', {
    grantee_principal: granteeId,
    scope_type: 'project',
    scope_id: SCOPE,
    capability: 'write',
  });
  assert.equal(r.status, 403);
});

test('POST / validates grantee_principal → 400', async () => {
  const r = await request('POST', '/api/grants', { scope_type: 'global', capability: 'read' });
  assert.equal(r.status, 400);
});

test('DELETE /:id is idempotent for an unknown grant (noop)', async () => {
  const r = await request('DELETE', '/api/grants/00000000-0000-0000-0000-000000000000');
  assert.equal(r.status, 200);
  assert.equal(r.json.status, 'noop');
});
