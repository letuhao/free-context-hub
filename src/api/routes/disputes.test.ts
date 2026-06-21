/**
 * Phase 15 Sprint 15.5 — disputes REST route tests.
 *
 * Design ref: docs/specs/2026-05-18-phase-15-sprint-15.5-design.md §3
 * Spec hash:  a506ddd08a5c6dfc
 *
 * Harness: minimal Express app hosting disputesRouter against the real test DB.
 * Asserts HTTP status + envelope for each route:
 *
 *   POST /api/disputes → open → 200
 *   POST /api/disputes parties<2 → 400
 *   GET  /api/disputes/:id → 200
 *   GET  /api/disputes/:id unknown → 404
 *   POST /api/disputes/:id/resolve approved → resolved → 200
 *   POST /api/disputes/:id/resolve open request → RESOLUTION_PENDING → 409
 *   POST /api/disputes/:id/resolve already resolved → ALREADY_RESOLVED → 409
 *   GET  /api/topics/:id/disputes → list → 200
 *   Role gate: GET with unknown role → 403; reader → not 403
 */

import assert from 'node:assert/strict';
import test, { before, after } from 'node:test';
import http from 'node:http';
import express from 'express';
import { disputesRouter } from './disputes.js';
import { charterTopic, joinTopic, grantLevel } from '../../core/index.js';
import { getDbPool } from '../../db/client.js';

const TEST_PROJECT = '__test_disputes_routes__';
const ACTOR_A = 'dispute-route-actor-a';
const ACTOR_B = 'dispute-route-actor-b';

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
    await pool.query(`DELETE FROM doa_matrix WHERE project_id=$1`, [TEST_PROJECT]);
    await pool.query(`DELETE FROM coordination_events WHERE topic_id=$1`, [topic_id]);
    await pool.query(`DELETE FROM topic_participants WHERE topic_id=$1`, [topic_id]);
  }
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
    [TEST_PROJECT, 'Dispute Route Test Project'],
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
  app.use('/api', disputesRouter);
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
    name: 'Dispute Route Topic',
    charter: 'test',
    created_by: ACTOR_A,
  });
  // Sprint 15.11 — owner ACTOR_A (created_by) bootstraps at authority; non-owner
  // ACTOR_B joins at execution then ACTOR_A grants it coordination.
  await joinTopic({ topic_id: result.topic_id, actor_id: ACTOR_A, level: 'authority', actor_type: 'human', display_name: 'Actor A' });
  await joinTopic({ topic_id: result.topic_id, actor_id: ACTOR_B, level: 'execution', actor_type: 'human', display_name: 'Actor B' });
  await grantLevel({ topic_id: result.topic_id, actor_id: ACTOR_B, level: 'coordination', granted_by: ACTOR_A });
  return result.topic_id;
}

// ── POST /api/disputes ────────────────────────────────────────────────────────

test('POST /api/disputes → open → 200', async () => {
  const topicId = await makeTopic();
  const res = await request('POST', '/api/disputes', {
    topic_id: topicId, subject_ref: 'artifact/route/1',
    parties: [ACTOR_A, ACTOR_B], procedure: 'unilateral', submitted_by: ACTOR_A,
  });
  assert.equal(res.status, 200, `expected 200, got ${res.status}: ${JSON.stringify(res.json)}`);
  assert.equal(res.json.status, 'ok');
  assert.ok(res.json.data.dispute.dispute_id, 'dispute_id present');
  assert.equal(res.json.data.dispute.status, 'open');
  assert.ok(res.json.data.resolution_request_id, 'resolution_request_id present');
});

test('POST /api/disputes parties < 2 → 400', async () => {
  const topicId = await makeTopic();
  const res = await request('POST', '/api/disputes', {
    topic_id: topicId, subject_ref: 'x', parties: [ACTOR_A], procedure: 'unilateral', submitted_by: ACTOR_A,
  });
  assert.equal(res.status, 400, `expected 400, got ${res.status}`);
  assert.equal(res.json.code, 'BAD_REQUEST');
});

test('POST /api/disputes unknown topic → 404', async () => {
  const res = await request('POST', '/api/disputes', {
    topic_id: 'no-such-topic', subject_ref: 'x',
    parties: [ACTOR_A, ACTOR_B], procedure: 'unilateral', submitted_by: ACTOR_A,
  });
  assert.equal(res.status, 404, `expected 404, got ${res.status}`);
  assert.equal(res.json.code, 'NOT_FOUND');
});

// ── GET /api/disputes/:id ─────────────────────────────────────────────────────

test('GET /api/disputes/:id → existing → 200', async () => {
  const topicId = await makeTopic();
  const open = await request('POST', '/api/disputes', {
    topic_id: topicId, subject_ref: 'get-test',
    parties: [ACTOR_A, ACTOR_B], procedure: 'unilateral', submitted_by: ACTOR_A,
  });
  const disputeId = open.json.data.dispute.dispute_id;
  const res = await request('GET', `/api/disputes/${disputeId}`);
  assert.equal(res.status, 200, `expected 200, got ${res.status}`);
  assert.equal(res.json.data.dispute_id, disputeId);
  assert.ok(res.json.data.resolution_request !== undefined, 'resolution_request field present');
});

test('GET /api/disputes/:id unknown → 404', async () => {
  const res = await request('GET', '/api/disputes/00000000-0000-0000-0000-000000000002');
  assert.equal(res.status, 404, `expected 404, got ${res.status}`);
  assert.equal(res.json.code, 'NOT_FOUND');
});

// ── POST /api/disputes/:id/resolve ────────────────────────────────────────────

test('POST /api/disputes/:id/resolve open request → RESOLUTION_PENDING → 409', async () => {
  const topicId = await makeTopic();
  const open = await request('POST', '/api/disputes', {
    topic_id: topicId, subject_ref: 'pending-test',
    parties: [ACTOR_A, ACTOR_B], procedure: 'unilateral', submitted_by: ACTOR_A,
  });
  const disputeId = open.json.data.dispute.dispute_id;
  // request is still 'open' — must 409
  const res = await request('POST', `/api/disputes/${disputeId}/resolve`);
  assert.equal(res.status, 409, `expected 409, got ${res.status}: ${JSON.stringify(res.json)}`);
  assert.equal(res.json.code, 'RESOLUTION_PENDING');
});

test('POST /api/disputes/:id/resolve approved → resolved → 200', async () => {
  const pool = getDbPool();
  const topicId = await makeTopic();
  const open = await request('POST', '/api/disputes', {
    topic_id: topicId, subject_ref: 'resolve-test',
    parties: [ACTOR_A, ACTOR_B], procedure: 'unilateral', submitted_by: ACTOR_A,
  });
  const disputeId = open.json.data.dispute.dispute_id;
  const reqId = open.json.data.resolution_request_id;
  // Force request to 'approved'
  await pool.query(`UPDATE requests SET status='approved' WHERE request_id=$1`, [reqId]);
  const res = await request('POST', `/api/disputes/${disputeId}/resolve`);
  assert.equal(res.status, 200, `expected 200, got ${res.status}: ${JSON.stringify(res.json)}`);
  assert.equal(res.json.data.status, 'resolved');
});

test('POST /api/disputes/:id/resolve already resolved → ALREADY_RESOLVED → 409', async () => {
  const pool = getDbPool();
  const topicId = await makeTopic();
  const open = await request('POST', '/api/disputes', {
    topic_id: topicId, subject_ref: 'already-resolved',
    parties: [ACTOR_A, ACTOR_B], procedure: 'unilateral', submitted_by: ACTOR_A,
  });
  const disputeId = open.json.data.dispute.dispute_id;
  const reqId = open.json.data.resolution_request_id;
  await pool.query(`UPDATE requests SET status='approved' WHERE request_id=$1`, [reqId]);
  await request('POST', `/api/disputes/${disputeId}/resolve`);
  // Second resolve
  const res = await request('POST', `/api/disputes/${disputeId}/resolve`);
  assert.equal(res.status, 409, `expected 409, got ${res.status}`);
  assert.equal(res.json.code, 'ALREADY_RESOLVED');
});

// ── GET /api/topics/:id/disputes ──────────────────────────────────────────────

test('GET /api/topics/:id/disputes → list → 200', async () => {
  const topicId = await makeTopic();
  await request('POST', '/api/disputes', {
    topic_id: topicId, subject_ref: 'list-route-1',
    parties: [ACTOR_A, ACTOR_B], procedure: 'unilateral', submitted_by: ACTOR_A,
  });
  const res = await request('GET', `/api/topics/${topicId}/disputes`);
  assert.equal(res.status, 200, `expected 200, got ${res.status}`);
  assert.ok(Array.isArray(res.json.data.disputes), 'disputes is an array');
  assert.ok(res.json.data.disputes.length >= 1, 'at least one dispute');
  assert.ok(typeof res.json.data.total === 'number', 'total is a number');
});

// [Domain 8] REMOVED the role-gate tests — they asserted the deleted requireRole middleware via an
// x-test-key-role shim. Authorization is now authorize() over principal grants (disputes-authz suite).
