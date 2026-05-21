/**
 * Phase 15 Sprint 15.12 — requireResourceScope / requireBodyProjectScope /
 * requireBodyTopicScope middleware unit tests (DEFERRED-009).
 *
 * Exercises the tenant-scope guards against the real test DB via a minimal
 * express app + an apiKeyScope shim header (x-test-key-scope).
 */

import assert from 'node:assert/strict';
import test, { before, after, beforeEach } from 'node:test';
import express from 'express';
import http from 'node:http';
import { requireResourceScope, requireBodyProjectScope, requireBodyTopicScope } from './requireResourceScope.js';
import { charterTopic } from '../../services/topics.js';
import { getDbPool } from '../../db/client.js';

const PROJ_A = '__test_scope_A__';
const PROJ_B = '__test_scope_B__';

let server: http.Server;
let baseUrl: string;
let topicA: string;
let topicB: string;

async function cleanup() {
  const pool = getDbPool();
  for (const p of [PROJ_A, PROJ_B]) {
    await pool.query(`DELETE FROM coordination_events WHERE topic_id IN (SELECT topic_id FROM topics WHERE project_id=$1)`, [p]);
    await pool.query(`DELETE FROM topics WHERE project_id=$1`, [p]);
    await pool.query(`DELETE FROM actors WHERE project_id=$1`, [p]);
  }
}

before(async () => {
  await cleanup();
  const a = await charterTopic({ project_id: PROJ_A, name: 'A', charter: 'a', created_by: 'owner-a' });
  const b = await charterTopic({ project_id: PROJ_B, name: 'B', charter: 'b', created_by: 'owner-b' });
  topicA = a.topic_id; topicB = b.topic_id;

  const app = express();
  app.use(express.json());
  // apiKeyScope shim — set req.apiKeyScope from x-test-key-scope (string), or null
  // when header === '__global__', or undefined when header absent (auth-off).
  app.use((req, _res, next) => {
    const h = req.headers['x-test-key-scope'];
    if (typeof h === 'string') {
      (req as { apiKeyScope?: string | null }).apiKeyScope = h === '__global__' ? null : h;
    }
    next();
  });
  app.get('/topic/:id', requireResourceScope('topic'), (_req, res) => res.json({ ok: true }));
  app.post('/create-body', requireBodyProjectScope(), (req, res) => res.json({ project_id: (req.body as { project_id?: string }).project_id }));
  app.post('/open-dispute', requireBodyTopicScope(), (_req, res) => res.json({ ok: true }));
  server = http.createServer(app);
  await new Promise<void>((r) => server.listen(0, '127.0.0.1', () => r()));
  const addr = server.address();
  baseUrl = `http://127.0.0.1:${typeof addr === 'object' && addr ? addr.port : 0}`;
});

after(async () => {
  await new Promise<void>((r) => server.close(() => r()));
  await cleanup();
});

beforeEach(() => {});

function req(method: string, path: string, body?: unknown, headers?: Record<string, string>): Promise<{ status: number; json: any }> {
  return new Promise((resolve, reject) => {
    const payload = body === undefined ? undefined : JSON.stringify(body);
    const r = http.request(`${baseUrl}${path}`, {
      method, headers: { 'Content-Type': 'application/json', ...(payload ? { 'Content-Length': Buffer.byteLength(payload) } : {}), ...(headers ?? {}) },
    }, (res) => {
      let raw = '';
      res.on('data', (c) => (raw += c));
      res.on('end', () => resolve({ status: res.statusCode ?? 0, json: raw ? JSON.parse(raw) : null }));
    });
    r.on('error', reject);
    if (payload) r.write(payload);
    r.end();
  });
}

// ── requireResourceScope ──────────────────────────────────────────────────

test('15.12 AC5: auth-off (no scope header) → unrestricted', async () => {
  const res = await req('GET', `/topic/${topicB}`);
  assert.equal(res.status, 200);
});

test('15.12 AC3: global-scope key → allowed for any project', async () => {
  const res = await req('GET', `/topic/${topicB}`, undefined, { 'x-test-key-scope': '__global__' });
  assert.equal(res.status, 200);
});

test('15.12 AC4: scoped key on its OWN project topic → allowed', async () => {
  const res = await req('GET', `/topic/${topicA}`, undefined, { 'x-test-key-scope': PROJ_A });
  assert.equal(res.status, 200);
});

test('15.12 AC1/AC2: scoped key on a CROSS-tenant topic → 404 NOT_FOUND', async () => {
  const res = await req('GET', `/topic/${topicB}`, undefined, { 'x-test-key-scope': PROJ_A });
  assert.equal(res.status, 404);
  assert.equal(res.json.code, 'NOT_FOUND');
});

test('15.12 AC6: scoped key on an UNKNOWN topic → 404 (indistinguishable from cross-tenant)', async () => {
  const res = await req('GET', `/topic/00000000-0000-0000-0000-000000000000`, undefined, { 'x-test-key-scope': PROJ_A });
  assert.equal(res.status, 404);
  assert.equal(res.json.code, 'NOT_FOUND');
});

// ── requireBodyProjectScope (F1 fix) ────────────────────────────────────────

test('15.12 body-project: scoped key omitting project_id → injected with key scope', async () => {
  const res = await req('POST', '/create-body', { name: 'x' }, { 'x-test-key-scope': PROJ_A });
  assert.equal(res.status, 200);
  assert.equal(res.json.project_id, PROJ_A, 'omitted project_id injected with the key scope (no DEFAULT_PROJECT_ID escape)');
});

test('15.12 body-project: scoped key declaring a CROSS-tenant project → 404', async () => {
  const res = await req('POST', '/create-body', { project_id: PROJ_B }, { 'x-test-key-scope': PROJ_A });
  assert.equal(res.status, 404);
});

test('15.12 body-project: scoped key declaring its OWN project → ok', async () => {
  const res = await req('POST', '/create-body', { project_id: PROJ_A }, { 'x-test-key-scope': PROJ_A });
  assert.equal(res.status, 200);
  assert.equal(res.json.project_id, PROJ_A);
});

test('15.12 body-project: auth-off → unrestricted (no injection)', async () => {
  const res = await req('POST', '/create-body', { name: 'x' });
  assert.equal(res.status, 200);
  assert.equal(res.json.project_id, undefined);
});

// ── requireBodyTopicScope ───────────────────────────────────────────────────

test('15.12 body-topic: scoped key referencing a cross-tenant topic_id → 404', async () => {
  const res = await req('POST', '/open-dispute', { topic_id: topicB }, { 'x-test-key-scope': PROJ_A });
  assert.equal(res.status, 404);
});

test('15.12 body-topic: scoped key referencing its own topic → ok', async () => {
  const res = await req('POST', '/open-dispute', { topic_id: topicA }, { 'x-test-key-scope': PROJ_A });
  assert.equal(res.status, 200);
});

test('15.12 body-topic: omitted topic_id → defers to handler (next)', async () => {
  const res = await req('POST', '/open-dispute', {}, { 'x-test-key-scope': PROJ_A });
  assert.equal(res.status, 200);
});
