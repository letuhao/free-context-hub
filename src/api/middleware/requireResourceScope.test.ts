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
import { requireResourceScope, requireBodyProjectScope, requireBodyTopicScope, requireProjectScope } from './requireResourceScope.js';
import { charterTopic } from '../../services/topics.js';
import { getDbPool } from '../../db/client.js';

const DOC_A = '00000000-0000-0000-0000-0000000000d4';
const LP_UNKNOWN = '00000000-0000-0000-0000-0000000000l4'.replace(/l/g, 'a');
const CONV_A = '00000000-0000-0000-0000-0000000000c4';

const PROJ_A = '__test_scope_A__';
const PROJ_B = '__test_scope_B__';

let server: http.Server;
let baseUrl: string;
let topicA: string;
let topicB: string;

async function cleanup() {
  const pool = getDbPool();
  await pool.query(`DELETE FROM documents WHERE doc_id=$1`, [DOC_A]).catch(() => {});
  await pool.query(`DELETE FROM chat_conversations WHERE conversation_id=$1`, [CONV_A]).catch(() => {});
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

  // DEFERRED-004 — seed PROJ_A-owned resources for the new resolvers.
  // (learning_path is tested via an UNKNOWN id → 404, avoiding its lesson_id FK seed.)
  const pool = getDbPool();
  await pool.query(`INSERT INTO projects (project_id, name) VALUES ($1,'A') ON CONFLICT DO NOTHING`, [PROJ_A]);
  await pool.query(`INSERT INTO documents (doc_id, project_id, name, doc_type) VALUES ($1,$2,'d','text') ON CONFLICT DO NOTHING`, [DOC_A, PROJ_A]);
  await pool.query(`INSERT INTO chat_conversations (conversation_id, project_id) VALUES ($1,$2) ON CONFLICT DO NOTHING`, [CONV_A, PROJ_A]);

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
  // DEFERRED-004 — requireProjectScope (collection) + new resolvers
  app.post('/coll-body', requireProjectScope('body'), (_req, res) => res.json({ ok: true }));
  app.get('/coll-query', requireProjectScope('query'), (_req, res) => res.json({ ok: true }));
  app.get('/coll-multi', requireProjectScope('query', { multi: true }), (_req, res) => res.json({ ok: true }));
  app.get('/doc/:id', requireResourceScope('document', 'id'), (_req, res) => res.json({ ok: true }));
  app.get('/lp/:pathId', requireResourceScope('learning_path', 'pathId'), (_req, res) => res.json({ ok: true }));
  app.get('/conv/:id', requireResourceScope('conversation', 'id'), (_req, res) => res.json({ ok: true }));
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

// ── DEFERRED-004: requireProjectScope (collection, strict-reject) ───────────

test('D004 coll-body: scoped key matching project_id → ok', async () => {
  const res = await req('POST', '/coll-body', { project_id: PROJ_A }, { 'x-test-key-scope': PROJ_A });
  assert.equal(res.status, 200);
});

test('D004 coll-body: scoped key cross-tenant project_id → 404', async () => {
  const res = await req('POST', '/coll-body', { project_id: PROJ_B }, { 'x-test-key-scope': PROJ_A });
  assert.equal(res.status, 404);
});

test('D004 coll-body: scoped key OMITTING project_id → 400 project_scope_required', async () => {
  const res = await req('POST', '/coll-body', {}, { 'x-test-key-scope': PROJ_A });
  assert.equal(res.status, 400);
  assert.match(res.json.error, /project_scope_required/);
});

test('D004 coll-body: auth-off → unrestricted (no project_id needed)', async () => {
  const res = await req('POST', '/coll-body', {});
  assert.equal(res.status, 200);
});

test('D004 coll-query: scoped key matching → ok; absent → 400; cross-tenant → 404', async () => {
  assert.equal((await req('GET', `/coll-query?project_id=${PROJ_A}`, undefined, { 'x-test-key-scope': PROJ_A })).status, 200);
  assert.equal((await req('GET', '/coll-query', undefined, { 'x-test-key-scope': PROJ_A })).status, 400);
  assert.equal((await req('GET', `/coll-query?project_id=${PROJ_B}`, undefined, { 'x-test-key-scope': PROJ_A })).status, 404);
});

test('D004 coll-multi: out-of-scope id in project_ids → 404; absent → 400; all-in-scope → ok', async () => {
  assert.equal((await req('GET', `/coll-multi?project_ids=${PROJ_A}`, undefined, { 'x-test-key-scope': PROJ_A })).status, 200);
  assert.equal((await req('GET', `/coll-multi?project_ids=${PROJ_A},${PROJ_B}`, undefined, { 'x-test-key-scope': PROJ_A })).status, 404);
  assert.equal((await req('GET', '/coll-multi', undefined, { 'x-test-key-scope': PROJ_A })).status, 400);
});

test('D004 coll-multi: global key → unrestricted', async () => {
  assert.equal((await req('GET', `/coll-multi?project_ids=${PROJ_A},${PROJ_B}`, undefined, { 'x-test-key-scope': '__global__' })).status, 200);
});

// ── DEFERRED-004: resource resolvers (derive from id) ───────────────────────

test('D004 document resolver: own → ok, cross-tenant → 404, unknown → 404', async () => {
  assert.equal((await req('GET', `/doc/${DOC_A}`, undefined, { 'x-test-key-scope': PROJ_A })).status, 200);
  assert.equal((await req('GET', `/doc/${DOC_A}`, undefined, { 'x-test-key-scope': PROJ_B })).status, 404);
  assert.equal((await req('GET', `/doc/00000000-0000-0000-0000-0000000000ff`, undefined, { 'x-test-key-scope': PROJ_A })).status, 404);
});

test('D004 learning_path resolver: unknown path_id → 404 (resolver runs, no row)', async () => {
  // exercises the learning_path resolver SQL without the lesson_id FK seed
  assert.equal((await req('GET', `/lp/${LP_UNKNOWN}`, undefined, { 'x-test-key-scope': PROJ_A })).status, 404);
});

test('D004 conversation resolver: own → ok, cross-tenant → 404', async () => {
  assert.equal((await req('GET', `/conv/${CONV_A}`, undefined, { 'x-test-key-scope': PROJ_A })).status, 200);
  assert.equal((await req('GET', `/conv/${CONV_A}`, undefined, { 'x-test-key-scope': PROJ_B })).status, 404);
});
