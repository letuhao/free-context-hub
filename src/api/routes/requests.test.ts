/**
 * Phase 15 Sprint 15.3 — requests REST route tests.
 *
 * Design ref: docs/specs/2026-05-17-phase-15-sprint-15.3-design.md §5, §8.
 *
 * Harness mirrors src/api/routes/board.test.ts — minimal Express app hosting
 * requestsRouter against the real test DB. Asserts HTTP status for the key
 * result-status → HTTP mappings of §5:
 *
 *   submitted → 201
 *   topic_closed → 409
 *   self_decision_forbidden → 403
 *   no_route → 422
 *   weight out of range → 400 (BAD_REQUEST)
 *   not_found (unknown request) → 404
 */

import assert from 'node:assert/strict';
import test, { before, after } from 'node:test';
import http from 'node:http';
import express from 'express';
import { requestsRouter } from './requests.js';
import { charterTopic, joinTopic, grantLevel, closeTopic, postTask, claimTask, completeTask } from '../../core/index.js';
import { getDbPool } from '../../db/client.js';

const TEST_PROJECT = '__test_requests_routes__';

async function cleanup() {
  const pool = getDbPool();
  const topicIds = await pool.query<{ topic_id: string }>(
    `SELECT topic_id FROM topics WHERE project_id = $1`,
    [TEST_PROJECT],
  );
  for (const { topic_id } of topicIds.rows) {
    await pool.query(`DELETE FROM request_steps WHERE request_id IN
      (SELECT request_id FROM requests WHERE topic_id=$1)`, [topic_id]);
    await pool.query(`DELETE FROM requests WHERE topic_id = $1`, [topic_id]);
    await pool.query(`DELETE FROM claims WHERE topic_id = $1`, [topic_id]);
    await pool.query(
      `DELETE FROM artifact_versions WHERE artifact_id IN
         (SELECT artifact_id FROM artifacts WHERE topic_id = $1)`,
      [topic_id],
    );
    await pool.query(`DELETE FROM artifacts WHERE topic_id = $1`, [topic_id]);
    await pool.query(`DELETE FROM tasks WHERE topic_id = $1`, [topic_id]);
    await pool.query(`DELETE FROM coordination_events WHERE topic_id = $1`, [topic_id]);
  }
  await pool.query(`DELETE FROM topics WHERE project_id = $1`, [TEST_PROJECT]);
  await pool.query(`DELETE FROM actors WHERE project_id = $1`, [TEST_PROJECT]);
}

let server: http.Server;
let baseUrl = '';

before(async () => {
  await cleanup();
  const app = express();
  app.use(express.json());
  // Test-shim middleware (Sprint 15.3.1) — reproduces what bearerAuth attaches
  // (req.apiKeyName / req.apiKeyRole) from x-test-key-name / x-test-key-role headers,
  // so F1 (identity binding) and F4 (GET role gate) can be exercised without the full
  // auth stack. Inert when those headers are absent → the 6 original tests are unaffected.
  app.use((req, _res, next) => {
    const auth = req as unknown as { apiKeyName?: string; apiKeyRole?: string };
    const n = req.headers['x-test-key-name'];
    const r = req.headers['x-test-key-role'];
    if (typeof n === 'string' && n) auth.apiKeyName = n;
    if (typeof r === 'string' && r) auth.apiKeyRole = r;
    next();
  });
  app.use('/api', requestsRouter);
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

/** Issue a JSON request and collect the parsed body + status. */
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

/** Create an active topic with 3-level participants. */
async function mkTopicWithParticipants() {
  const t = await charterTopic({
    project_id: TEST_PROJECT, name: 'Request Route Test',
    charter: 'route test', created_by: 'authority-actor',
  });
  const topicId = t.topic_id;
  // Sprint 15.11 — owner (authority-actor = created_by) joins first as authority,
  // others join at execution, then the owner grants the coordinator its level.
  await joinTopic({ topic_id: topicId, actor_id: 'authority-actor', actor_type: 'human', display_name: 'Auth', level: 'authority' });
  await joinTopic({ topic_id: topicId, actor_id: 'execution-actor', actor_type: 'human', display_name: 'Exec', level: 'execution' });
  await joinTopic({ topic_id: topicId, actor_id: 'coordination-actor', actor_type: 'human', display_name: 'Coord', level: 'execution' });
  await grantLevel({ topic_id: topicId, actor_id: 'coordination-actor', level: 'coordination', granted_by: 'authority-actor' });
  return topicId;
}

/** Create a task + artifact in for_review state. */
async function mkForReviewArtifact(topicId: string, slot: string, actorId: string): Promise<string> {
  const task = await postTask({
    topic_id: topicId, title: `Task ${slot}`, topology: 'parallel',
    slot, kind: 'document', created_by: actorId,
  });
  const claim = await claimTask({ task_id: task.task_id, actor_id: actorId });
  if (claim.status !== 'claimed') throw new Error('setup: claim failed');
  const done = await completeTask({ task_id: task.task_id, actor_id: actorId });
  if (done.status !== 'completed') throw new Error('setup: complete failed');
  return task.artifact_id;
}

// ── submitted → 201 ──────────────────────────────────────────────────────

test('POST /api/topics/:id/requests → submitted → 201', async () => {
  const topicId = await mkTopicWithParticipants();
  const artifactId = await mkForReviewArtifact(topicId, 'doc-201', 'execution-actor');

  const res = await request('POST', `/api/topics/${topicId}/requests`, {
    subject_id: artifactId,
    kind: 'artifact_review',
    weight: 10,
    procedure: 'unilateral',
    submitted_by: 'execution-actor',
  });
  assert.equal(res.status, 201, `expected 201, got ${res.status}: ${JSON.stringify(res.json)}`);
  assert.equal(res.json.status, 'ok');
  assert.equal(res.json.data.status, 'submitted');
  assert.ok(res.json.data.request_id, 'request_id present');
});

// ── topic_closed → 409 ──────────────────────────────────────────────────

test('POST /api/topics/:id/requests → topic_closed → 409', async () => {
  const topicId = await mkTopicWithParticipants();
  const artifactId = await mkForReviewArtifact(topicId, 'doc-409', 'execution-actor');

  await closeTopic({ topic_id: topicId, actor_id: 'authority-actor' });

  const res = await request('POST', `/api/topics/${topicId}/requests`, {
    subject_id: artifactId,
    kind: 'artifact_review',
    weight: 10,
    procedure: 'unilateral',
    submitted_by: 'execution-actor',
  });
  assert.equal(res.status, 409, `expected 409, got ${res.status}`);
  assert.equal(res.json.data.status, 'topic_closed');
});

// ── self_decision_forbidden → 403 ──────────────────────────────────────

test('POST /api/requests/:id/steps/:n/decide → self_decision_forbidden → 403', async () => {
  const topicId = await mkTopicWithParticipants();
  const artifactId = await mkForReviewArtifact(topicId, 'doc-403', 'coordination-actor');

  const sub = await request('POST', `/api/topics/${topicId}/requests`, {
    subject_id: artifactId,
    kind: 'artifact_review',
    weight: 10,
    procedure: 'unilateral',
    submitted_by: 'coordination-actor',
  });
  assert.equal(sub.status, 201);
  const requestId = sub.json.data.request_id;

  const res = await request('POST', `/api/requests/${requestId}/steps/0/decide`, {
    actor_id: 'coordination-actor',
    decision: 'endorse',
  });
  assert.equal(res.status, 403, `expected 403, got ${res.status}: ${JSON.stringify(res.json)}`);
  assert.equal(res.json.data.status, 'self_decision_forbidden');
});

// ── no_route → 422 ─────────────────────────────────────────────────────

test('POST /api/topics/:id/requests → no_route → 422', async () => {
  const topicId = await mkTopicWithParticipants();
  const artifactId = await mkForReviewArtifact(topicId, 'doc-422', 'execution-actor');

  const res = await request('POST', `/api/topics/${topicId}/requests`, {
    subject_id: artifactId,
    kind: 'unknown_kind_that_has_no_matrix_row',
    weight: 10,
    procedure: 'unilateral',
    submitted_by: 'execution-actor',
  });
  assert.equal(res.status, 422, `expected 422, got ${res.status}`);
  assert.equal(res.json.data.status, 'no_route');
});

// ── weight out of range → 400 ─────────────────────────────────────────

test('POST /api/topics/:id/requests → weight out of range → 400', async () => {
  const topicId = await mkTopicWithParticipants();
  const artifactId = await mkForReviewArtifact(topicId, 'doc-400', 'execution-actor');

  const res = await request('POST', `/api/topics/${topicId}/requests`, {
    subject_id: artifactId,
    kind: 'artifact_review',
    weight: 3_000_000_000,
    procedure: 'unilateral',
    submitted_by: 'execution-actor',
  });
  assert.equal(res.status, 400, `expected 400, got ${res.status}`);
  assert.equal(res.json.code, 'BAD_REQUEST');
});

// ── not_found → 404 ────────────────────────────────────────────────────

test('GET /api/requests/:id → unknown request → 404', async () => {
  const res = await request('GET', '/api/requests/00000000-0000-0000-0000-000000000000');
  assert.equal(res.status, 404, `expected 404, got ${res.status}`);
});

// ════════════════════════════════════════════════════════════════════════════
// Sprint 15.3.1 — F1 (identity binding) + F4 (GET role gate) route tests
// ════════════════════════════════════════════════════════════════════════════

// ── F1: submit / decide identity is bound to the authenticated key ──────────

test('F1: POST submit — apiKeyName ≠ body submitted_by → 403 IDENTITY_MISMATCH', async () => {
  const topicId = await mkTopicWithParticipants();
  const artifactId = await mkForReviewArtifact(topicId, 'doc-f1a', 'execution-actor');
  const res = await request('POST', `/api/topics/${topicId}/requests`, {
    subject_id: artifactId, kind: 'artifact_review', weight: 10,
    procedure: 'unilateral', submitted_by: 'coordination-actor',
  }, { 'x-test-key-name': 'execution-actor' });
  assert.equal(res.status, 403, `expected 403, got ${res.status}: ${JSON.stringify(res.json)}`);
  assert.equal(res.json.code, 'IDENTITY_MISMATCH');
});

test('F1: POST submit — apiKeyName == body submitted_by → 201', async () => {
  const topicId = await mkTopicWithParticipants();
  const artifactId = await mkForReviewArtifact(topicId, 'doc-f1b', 'execution-actor');
  const res = await request('POST', `/api/topics/${topicId}/requests`, {
    subject_id: artifactId, kind: 'artifact_review', weight: 10,
    procedure: 'unilateral', submitted_by: 'execution-actor',
  }, { 'x-test-key-name': 'execution-actor' });
  assert.equal(res.status, 201, `expected 201, got ${res.status}: ${JSON.stringify(res.json)}`);
  assert.equal(res.json.data.status, 'submitted');
});

test('F1: POST submit — body submitted_by omitted, apiKeyName supplies the identity → 201', async () => {
  const topicId = await mkTopicWithParticipants();
  const artifactId = await mkForReviewArtifact(topicId, 'doc-f1c', 'execution-actor');
  const res = await request('POST', `/api/topics/${topicId}/requests`, {
    subject_id: artifactId, kind: 'artifact_review', weight: 10, procedure: 'unilateral',
  }, { 'x-test-key-name': 'execution-actor' });
  assert.equal(res.status, 201, `expected 201, got ${res.status}: ${JSON.stringify(res.json)}`);
  assert.equal(res.json.data.status, 'submitted');
});

test('F1: POST decide — apiKeyName ≠ body actor_id → 403 IDENTITY_MISMATCH', async () => {
  const topicId = await mkTopicWithParticipants();
  const artifactId = await mkForReviewArtifact(topicId, 'doc-f1d', 'execution-actor');
  const sub = await request('POST', `/api/topics/${topicId}/requests`, {
    subject_id: artifactId, kind: 'artifact_review', weight: 10,
    procedure: 'unilateral', submitted_by: 'execution-actor',
  });
  assert.equal(sub.status, 201);
  const requestId = sub.json.data.request_id;
  // body actor_id is the correct officeholder (coordination), but the authenticated
  // key name differs → F1 rejects before decideStep runs.
  const res = await request('POST', `/api/requests/${requestId}/steps/0/decide`, {
    actor_id: 'coordination-actor', decision: 'endorse',
  }, { 'x-test-key-name': 'execution-actor' });
  assert.equal(res.status, 403, `expected 403, got ${res.status}: ${JSON.stringify(res.json)}`);
  assert.equal(res.json.code, 'IDENTITY_MISMATCH');
});

test('F1: POST decide — apiKeyName == body actor_id → endorses (200)', async () => {
  const topicId = await mkTopicWithParticipants();
  const artifactId = await mkForReviewArtifact(topicId, 'doc-f1f', 'execution-actor');
  const sub = await request('POST', `/api/topics/${topicId}/requests`, {
    subject_id: artifactId, kind: 'artifact_review', weight: 10,
    procedure: 'unilateral', submitted_by: 'execution-actor',
  });
  assert.equal(sub.status, 201);
  const requestId = sub.json.data.request_id;
  // weight 10 → single coordination step; the coordination officeholder decides,
  // its key name matches the body actor_id → F1 admits, decideStep runs.
  const res = await request('POST', `/api/requests/${requestId}/steps/0/decide`, {
    actor_id: 'coordination-actor', decision: 'endorse',
  }, { 'x-test-key-name': 'coordination-actor' });
  assert.equal(res.status, 200, `expected 200, got ${res.status}: ${JSON.stringify(res.json)}`);
  assert.ok(['step_endorsed', 'approved'].includes(res.json.data.status),
    `expected endorsed/approved, got ${res.json.data.status}`);
});

test('F1 precondition (AC1b): a reader-role key POST is still 403 (requireRole writer gate)', async () => {
  const topicId = await mkTopicWithParticipants();
  const artifactId = await mkForReviewArtifact(topicId, 'doc-f1e', 'execution-actor');
  const res = await request('POST', `/api/topics/${topicId}/requests`, {
    subject_id: artifactId, kind: 'artifact_review', weight: 10,
    procedure: 'unilateral', submitted_by: 'execution-actor',
  }, { 'x-test-key-role': 'reader' });
  assert.equal(res.status, 403, `expected 403, got ${res.status}: ${JSON.stringify(res.json)}`);
});

// ── F4: the GET routes require the reader role ──────────────────────────────

test('F4: GET /api/topics/:id/requests with an unknown role → 403', async () => {
  const topicId = await mkTopicWithParticipants();
  const res = await request('GET', `/api/topics/${topicId}/requests`, undefined,
    { 'x-test-key-role': 'intruder' });
  assert.equal(res.status, 403, `expected 403, got ${res.status}: ${JSON.stringify(res.json)}`);
});

test('F4: GET /api/requests/:id with an unknown role → 403', async () => {
  const res = await request('GET', '/api/requests/00000000-0000-0000-0000-000000000000', undefined,
    { 'x-test-key-role': 'intruder' });
  assert.equal(res.status, 403, `expected 403, got ${res.status}: ${JSON.stringify(res.json)}`);
});

test('F4: GET /api/topics/:id/requests with role reader → not 403 (reader admitted)', async () => {
  const topicId = await mkTopicWithParticipants();
  const res = await request('GET', `/api/topics/${topicId}/requests`, undefined,
    { 'x-test-key-role': 'reader' });
  assert.notEqual(res.status, 403, `reader must pass the gate; got ${res.status}`);
});

// ── Sprint 15.9 (DEFERRED-020 LOW-7) — route-layer fractional step-index guard ──

test('15.9 LOW-7: POST decide with fractional step-index → 400 from route layer (not service)', async () => {
  const topicId = await mkTopicWithParticipants();
  const artifactId = await mkForReviewArtifact(topicId, 'doc-low7', 'execution-actor');
  const sub = await request('POST', `/api/topics/${topicId}/requests`, {
    subject_id: artifactId, kind: 'artifact_review', weight: 10,
    procedure: 'unilateral', submitted_by: 'execution-actor',
  });
  assert.equal(sub.status, 201);
  const requestId = sub.json.data.request_id;
  // Fractional step segment '1.5' — route layer's /^\d+$/ guard catches it BEFORE
  // parseInt would truncate to 1. Asserts 400 + BAD_REQUEST code from the route.
  const res = await request('POST', `/api/requests/${requestId}/steps/1.5/decide`, {
    actor_id: 'coordination-actor', decision: 'endorse',
  });
  assert.equal(res.status, 400, `expected 400, got ${res.status}: ${JSON.stringify(res.json)}`);
  assert.equal(res.json.code, 'BAD_REQUEST');
  assert.ok(res.json.error.includes('non-negative integer'),
    `error message should mention non-negative integer; got: ${res.json.error}`);
});

test('15.9 LOW-7: POST decide with negative step-index → 400 from route layer', async () => {
  const topicId = await mkTopicWithParticipants();
  const artifactId = await mkForReviewArtifact(topicId, 'doc-low7n', 'execution-actor');
  const sub = await request('POST', `/api/topics/${topicId}/requests`, {
    subject_id: artifactId, kind: 'artifact_review', weight: 10,
    procedure: 'unilateral', submitted_by: 'execution-actor',
  });
  assert.equal(sub.status, 201);
  const requestId = sub.json.data.request_id;
  const res = await request('POST', `/api/requests/${requestId}/steps/-1/decide`, {
    actor_id: 'coordination-actor', decision: 'endorse',
  });
  assert.equal(res.status, 400);
  assert.equal(res.json.code, 'BAD_REQUEST');
});
