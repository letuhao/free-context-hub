/**
 * Phase 15 Sprint 15.5 — intake REST route tests.
 *
 * Design ref: docs/specs/2026-05-18-phase-15-sprint-15.5-design.md §3
 * Spec hash:  a506ddd08a5c6dfc
 *
 * Harness: minimal Express app hosting intakeRouter against the real test DB.
 * Asserts HTTP status + envelope for each route:
 *
 *   POST /api/intake → received → 200
 *   POST /api/intake invalid kind → 400
 *   GET  /api/intake/:id → 200
 *   GET  /api/intake/:id unknown → 404
 *   POST /api/intake/:id/dismiss → dismissed → 200
 *   POST /api/intake/:id/dismiss twice → 409
 *   POST /api/intake/:id/triage → triaged → 200
 *   GET  /api/projects/:id/intake → list → 200
 *   Role gate: GET with unknown role → 403; reader → not 403
 */

import assert from 'node:assert/strict';
import test, { before, after } from 'node:test';
import http from 'node:http';
import express from 'express';
import { intakeRouter } from './intake.js';
import { charterTopic, joinTopic } from '../../core/index.js';
import { getDbPool } from '../../db/client.js';

const TEST_PROJECT = '__test_intake_routes__';
const TEST_ACTOR = 'intake-route-actor';

async function cleanup() {
  const pool = getDbPool();
  const topicIds = await pool.query<{ topic_id: string }>(
    `SELECT topic_id FROM topics WHERE project_id=$1`, [TEST_PROJECT],
  );
  for (const { topic_id } of topicIds.rows) {
    const disputeIds = await pool.query<{ dispute_id: string }>(
      `SELECT dispute_id FROM disputes WHERE topic_id=$1`, [topic_id],
    );
    for (const { dispute_id } of disputeIds.rows) {
      await pool.query(`DELETE FROM request_steps WHERE request_id IN
        (SELECT request_id FROM requests WHERE subject_id=$1)`, [dispute_id]);
      await pool.query(`DELETE FROM requests WHERE subject_id=$1`, [dispute_id]);
    }
    await pool.query(`DELETE FROM disputes WHERE topic_id=$1`, [topic_id]);
    await pool.query(`DELETE FROM intake_items WHERE topic_id=$1`, [topic_id]);
    await pool.query(`DELETE FROM coordination_events WHERE topic_id=$1`, [topic_id]);
    await pool.query(`DELETE FROM topic_participants WHERE topic_id=$1`, [topic_id]);
  }
  await pool.query(`DELETE FROM intake_items WHERE project_id=$1 AND topic_id IS NULL`, [TEST_PROJECT]);
  await pool.query(`DELETE FROM topics WHERE project_id=$1`, [TEST_PROJECT]);
  await pool.query(`DELETE FROM actors WHERE project_id=$1`, [TEST_PROJECT]);
  await pool.query(`DELETE FROM projects WHERE project_id=$1`, [TEST_PROJECT]);
}

let server: http.Server;
let baseUrl = '';

before(async () => {
  await cleanup();
  const pool = getDbPool();
  await pool.query(
    `INSERT INTO projects (project_id, name) VALUES ($1, $2) ON CONFLICT DO NOTHING`,
    [TEST_PROJECT, 'Intake Route Test Project'],
  );

  const app = express();
  app.use(express.json());
  app.use((req, _res, next) => {
    const auth = req as unknown as { apiKeyName?: string; apiKeyRole?: string };
    const n = req.headers['x-test-key-name'];
    const r = req.headers['x-test-key-role'];
    if (typeof n === 'string' && n) auth.apiKeyName = n;
    if (typeof r === 'string' && r) auth.apiKeyRole = r;
    next();
  });
  app.use('/api', intakeRouter);
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

function request(
  method: string,
  path: string,
  body?: unknown,
  extraHeaders?: Record<string, string>,
): Promise<{ status: number; json: any }> {
  return new Promise((resolve, reject) => {
    const payload = body === undefined ? undefined : JSON.stringify(body);
    const req = http.request(
      `${baseUrl}${path}`,
      {
        method,
        headers: {
          'Content-Type': 'application/json',
          ...(payload ? { 'Content-Length': Buffer.byteLength(payload) } : {}),
          ...(extraHeaders ?? {}),
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
    req.setTimeout(8000, () => req.destroy(new Error('request timeout')));
    if (payload) req.write(payload);
    req.end();
  });
}

async function makeTopic(): Promise<string> {
  const result = await charterTopic({
    project_id: TEST_PROJECT,
    name: 'Intake Route Topic',
    charter: 'test',
    created_by: TEST_ACTOR,
  });
  await joinTopic({ topic_id: result.topic_id, actor_id: TEST_ACTOR, level: 'authority', actor_type: 'human', display_name: 'Actor' });
  return result.topic_id;
}

// ── POST /api/intake ──────────────────────────────────────────────────────────

test('POST /api/intake → received → 200', async () => {
  const res = await request('POST', '/api/intake', {
    project_id: TEST_PROJECT, kind: 'suggestion', body: 'a suggestion', submitted_by: TEST_ACTOR,
  });
  assert.equal(res.status, 200, `expected 200, got ${res.status}: ${JSON.stringify(res.json)}`);
  assert.equal(res.json.status, 'ok');
  assert.ok(res.json.data.intake_id, 'intake_id present');
  assert.equal(res.json.data.status, 'received');
});

test('POST /api/intake invalid kind → 400', async () => {
  const res = await request('POST', '/api/intake', {
    project_id: TEST_PROJECT, kind: 'nonsense', body: 'x', submitted_by: TEST_ACTOR,
  });
  assert.equal(res.status, 400, `expected 400, got ${res.status}`);
  assert.equal(res.json.code, 'BAD_REQUEST');
});

test('POST /api/intake unknown project → 404', async () => {
  const res = await request('POST', '/api/intake', {
    project_id: '__nonexistent__', kind: 'suggestion', body: 'x', submitted_by: TEST_ACTOR,
  });
  assert.equal(res.status, 404, `expected 404, got ${res.status}`);
  assert.equal(res.json.code, 'NOT_FOUND');
});

// ── GET /api/intake/:id ───────────────────────────────────────────────────────

test('GET /api/intake/:id → existing → 200', async () => {
  const submit = await request('POST', '/api/intake', {
    project_id: TEST_PROJECT, kind: 'request', body: 'get me', submitted_by: TEST_ACTOR,
  });
  const id = submit.json.data.intake_id;
  const res = await request('GET', `/api/intake/${id}`);
  assert.equal(res.status, 200, `expected 200, got ${res.status}`);
  assert.equal(res.json.data.intake_id, id);
});

test('GET /api/intake/:id unknown → 404', async () => {
  const res = await request('GET', '/api/intake/00000000-0000-0000-0000-000000000001');
  assert.equal(res.status, 404, `expected 404, got ${res.status}`);
  assert.equal(res.json.code, 'NOT_FOUND');
});

// ── POST /api/intake/:id/dismiss ──────────────────────────────────────────────

test('POST /api/intake/:id/dismiss → dismissed → 200', async () => {
  const submit = await request('POST', '/api/intake', {
    project_id: TEST_PROJECT, kind: 'suggestion', body: 'dismiss me', submitted_by: TEST_ACTOR,
  });
  const id = submit.json.data.intake_id;
  const res = await request('POST', `/api/intake/${id}/dismiss`);
  assert.equal(res.status, 200, `expected 200, got ${res.status}`);
  assert.equal(res.json.data.status, 'dismissed');
});

test('POST /api/intake/:id/dismiss twice → 409 INTAKE_ALREADY_DISMISSED', async () => {
  const submit = await request('POST', '/api/intake', {
    project_id: TEST_PROJECT, kind: 'suggestion', body: 'dismiss twice', submitted_by: TEST_ACTOR,
  });
  const id = submit.json.data.intake_id;
  await request('POST', `/api/intake/${id}/dismiss`);
  const res = await request('POST', `/api/intake/${id}/dismiss`);
  assert.equal(res.status, 409, `expected 409, got ${res.status}`);
  assert.equal(res.json.code, 'INTAKE_ALREADY_DISMISSED');
});

// ── POST /api/intake/:id/triage ───────────────────────────────────────────────

test('POST /api/intake/:id/triage task route → triaged → 200', async () => {
  const topicId = await makeTopic();
  const submit = await request('POST', '/api/intake', {
    project_id: TEST_PROJECT, topic_id: topicId, kind: 'suggestion',
    body: 'triage me', submitted_by: TEST_ACTOR,
  });
  const id = submit.json.data.intake_id;
  const res = await request('POST', `/api/intake/${id}/triage`, {
    route_kind: 'task',
    actor_id: TEST_ACTOR,
    topic_id: topicId,
    routed_to: '00000000-0000-0000-0000-aaaaaaaaaaaa',
  });
  assert.equal(res.status, 200, `expected 200, got ${res.status}: ${JSON.stringify(res.json)}`);
  assert.equal(res.json.data.status, 'triaged');
});

test('POST /api/intake/:id/triage invalid route_kind → 400', async () => {
  const submit = await request('POST', '/api/intake', {
    project_id: TEST_PROJECT, kind: 'suggestion', body: 'x', submitted_by: TEST_ACTOR,
  });
  const id = submit.json.data.intake_id;
  const res = await request('POST', `/api/intake/${id}/triage`, {
    route_kind: 'unknown_kind',
    actor_id: TEST_ACTOR,
    topic_id: 'any',
    routed_to: 'x',
  });
  assert.equal(res.status, 400, `expected 400, got ${res.status}`);
  assert.equal(res.json.code, 'BAD_REQUEST');
});

// ── GET /api/projects/:id/intake ─────────────────────────────────────────────

test('GET /api/projects/:id/intake → list → 200', async () => {
  const res = await request('GET', `/api/projects/${TEST_PROJECT}/intake`);
  assert.equal(res.status, 200, `expected 200, got ${res.status}`);
  assert.ok(Array.isArray(res.json.data.items), 'items is an array');
  assert.ok(typeof res.json.data.total === 'number', 'total is a number');
});

// ── Role gate ─────────────────────────────────────────────────────────────────

test('GET /api/intake/:id with unknown role → 403', async () => {
  const submit = await request('POST', '/api/intake', {
    project_id: TEST_PROJECT, kind: 'suggestion', body: 'role test', submitted_by: TEST_ACTOR,
  });
  const id = submit.json.data.intake_id;
  const res = await request('GET', `/api/intake/${id}`, undefined, { 'x-test-key-role': 'intruder' });
  assert.equal(res.status, 403, `expected 403, got ${res.status}`);
});

test('GET /api/intake/:id with role reader → not 403', async () => {
  const submit = await request('POST', '/api/intake', {
    project_id: TEST_PROJECT, kind: 'suggestion', body: 'reader test', submitted_by: TEST_ACTOR,
  });
  const id = submit.json.data.intake_id;
  const res = await request('GET', `/api/intake/${id}`, undefined, { 'x-test-key-role': 'reader' });
  assert.notEqual(res.status, 403, `reader must pass the gate; got ${res.status}`);
});
