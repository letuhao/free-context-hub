/**
 * Actor Data Boundary — Stream S5 (NHI hardening) REST route tests.
 * COMPLETION-plan §4 (S5) + §5 N1 (key-binding contract).
 *
 * Minimal Express app hosting apiKeysRouter (at /api/api-keys) and
 * accessReviewRouter (at /api/access-review), mirroring board.test.ts. Auth is
 * disabled in this harness (no apiKeyRole → assertAuthorized is a no-op), so the
 * tests exercise the route wiring + status mapping, not the admin gate.
 *
 * Asserts:
 *   - GET  /api/access-review            → 200 + stats/keys shape
 *   - POST /api/api-keys {principal_id}   → 201 AND the binding is persisted
 *                                           (N1: a route that silently dropped
 *                                           the field would lose the binding).
 *   - POST /api/api-keys/ephemeral        → 201 + expires_at
 *   - POST /api/api-keys/:id/rotate       → 201 + successor + previous_key_id
 *   - rotate unknown id                   → 404
 */

import assert from 'node:assert/strict';
import test, { before, after, beforeEach } from 'node:test';
import http from 'node:http';
import express from 'express';
import { apiKeysRouter, accessReviewRouter } from './apiKeys.js';
import { errorHandler } from '../middleware/errorHandler.js';
import { createPrincipal } from '../../services/principals.js';
import { getDbPool } from '../../db/client.js';

const PREFIX = '__test_nhi_route__';

async function cleanup() {
  const pool = getDbPool();
  await pool.query(`DELETE FROM api_keys WHERE name LIKE $1`, [`${PREFIX}%`]);
  await pool.query(`DELETE FROM principals WHERE display_name LIKE $1`, [`${PREFIX}%`]);
}

let server: http.Server;
let baseUrl = '';

before(async () => {
  await cleanup();
  const app = express();
  app.use(express.json());
  app.use('/api/api-keys', apiKeysRouter);
  app.use('/api/access-review', accessReviewRouter);
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
});

beforeEach(cleanup);

function request(method: string, path: string, body?: unknown): Promise<{ status: number; json: any }> {
  return new Promise((resolve, reject) => {
    const payload = body === undefined ? undefined : JSON.stringify(body);
    const req = http.request(
      `${baseUrl}${path}`,
      {
        method,
        headers: {
          'Content-Type': 'application/json',
          ...(payload ? { 'Content-Length': Buffer.byteLength(payload) } : {}),
        },
      },
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
    if (payload) req.write(payload);
    req.end();
  });
}

test('GET /api/access-review → 200 with stats + keys', async () => {
  await request('POST', '/api/api-keys', { name: `${PREFIX}review1` });
  const res = await request('GET', '/api/access-review');
  assert.equal(res.status, 200);
  assert.ok(res.json.stats, 'has stats');
  assert.ok(Array.isArray(res.json.keys), 'has keys array');
  assert.equal(typeof res.json.stats.total_active, 'number');
  assert.equal(typeof res.json.stats.ownerless, 'number');
});

test('POST /api/api-keys with principal_id → 201 AND binding persisted (N1 contract)', async () => {
  const p = await createPrincipal({ kind: 'agent', display_name: `${PREFIX}bound` });
  const create = await request('POST', '/api/api-keys', { name: `${PREFIX}boundkey`, principal_id: p.principal_id });
  assert.equal(create.status, 201);
  assert.equal(create.json.principal_id, p.principal_id, 'route did not drop principal_id');

  // Re-read through the list endpoint: the binding must be non-null and correct.
  const list = await request('GET', '/api/api-keys');
  const mine = list.json.keys.find((k: any) => k.name === `${PREFIX}boundkey`);
  assert.ok(mine, 'key listed');
  assert.equal(mine.principal_id, p.principal_id, 'binding survived the round-trip');
});

test('POST /api/api-keys/ephemeral → 201 with expires_at', async () => {
  const res = await request('POST', '/api/api-keys/ephemeral', { name: `${PREFIX}eph`, ttl_ms: 3600000 });
  assert.equal(res.status, 201);
  assert.ok(res.json.key, 'returns the full key once');
  assert.ok(res.json.expires_at, 'returns the effective expiry');
});

test('POST /api/api-keys/:id/rotate → 201 with successor + previous_key_id', async () => {
  const create = await request('POST', '/api/api-keys', { name: `${PREFIX}rotme` });
  const id = create.json.key_id;
  const res = await request('POST', `/api/api-keys/${id}/rotate`, { overlap_ms: 86400000 });
  assert.equal(res.status, 201);
  assert.equal(res.json.status, 'rotated');
  assert.equal(res.json.previous_key_id, id);
  assert.ok(res.json.key, 'returns the successor key once');
  assert.notEqual(res.json.key, create.json.key);
});

test('POST /api/api-keys/:id/rotate unknown id → 404', async () => {
  const res = await request('POST', '/api/api-keys/00000000-0000-0000-0000-000000000000/rotate', {});
  assert.equal(res.status, 404);
});
