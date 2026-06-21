/**
 * Phase 15 Sprint 15.4 — motions REST route tests.
 *
 * Design ref: docs/specs/2026-05-18-phase-15-sprint-15.4-design.md §6, §9.
 *
 * Harness mirrors src/api/routes/requests.test.ts — a minimal Express app hosting
 * motionsRouter against the real test DB. Asserts the result-status → HTTP map:
 *
 *   proposed → 201
 *   second / vote / veto → 200
 *   a past-deadline tally → 200
 *   a pre-deadline tally → balloting_open → 409
 *   a GET with an unknown role → 403; with role reader → not-403
 */

import assert from 'node:assert/strict';
import test, { before, after } from 'node:test';
import http from 'node:http';
import express from 'express';
import { motionsRouter } from './motions.js';
import { charterTopic, joinTopic, grantLevel, createBody, addBodyMember } from '../../core/index.js';
import { getDbPool } from '../../db/client.js';

const TEST_PROJECT = '__test_motions_routes__';

async function cleanup() {
  const pool = getDbPool();
  const topicIds = await pool.query<{ topic_id: string }>(
    `SELECT topic_id FROM topics WHERE project_id = $1`,
    [TEST_PROJECT],
  );
  for (const { topic_id } of topicIds.rows) {
    await pool.query(`DELETE FROM votes WHERE motion_id IN
      (SELECT motion_id FROM motions WHERE topic_id=$1)`, [topic_id]);
    await pool.query(`DELETE FROM motions WHERE topic_id = $1`, [topic_id]);
    // Sprint 15.7 — chain may have created tasks/artifacts on carried tallies.
    await pool.query(`DELETE FROM claims WHERE topic_id = $1`, [topic_id]);
    await pool.query(`DELETE FROM artifact_versions WHERE artifact_id IN
      (SELECT artifact_id FROM artifacts WHERE topic_id=$1)`, [topic_id]);
    await pool.query(`DELETE FROM artifacts WHERE topic_id = $1`, [topic_id]);
    await pool.query(`DELETE FROM tasks WHERE topic_id = $1`, [topic_id]);
    await pool.query(`DELETE FROM coordination_events WHERE topic_id = $1`, [topic_id]);
  }
  await pool.query(`DELETE FROM topics WHERE project_id = $1`, [TEST_PROJECT]);
  await pool.query(`DELETE FROM actors WHERE project_id = $1`, [TEST_PROJECT]);
  const bodyIds = await pool.query<{ body_id: string }>(
    `SELECT body_id FROM decision_bodies WHERE project_id = $1`,
    [TEST_PROJECT],
  );
  for (const { body_id } of bodyIds.rows) {
    await pool.query(`DELETE FROM body_members WHERE body_id = $1`, [body_id]);
  }
  await pool.query(`DELETE FROM decision_bodies WHERE project_id = $1`, [TEST_PROJECT]);
}

let server: http.Server;
let baseUrl = '';

before(async () => {
  await cleanup();
  const app = express();
  app.use(express.json());
  // Test-shim middleware — reproduces what bearerAuth attaches (apiKeyName /
  // apiKeyRole) from x-test-key-name / x-test-key-role headers, so the role
  // gates can be exercised without the full auth stack.
  app.use((req, _res, next) => {
    const auth = req as unknown as { apiKeyName?: string; apiKeyRole?: string };
    const n = req.headers['x-test-key-name'];
    const r = req.headers['x-test-key-role'];
    if (typeof n === 'string' && n) auth.apiKeyName = n;
    if (typeof r === 'string' && r) auth.apiKeyRole = r;
    next();
  });
  app.use('/api', motionsRouter);
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

/** Create an active topic with 4 coordination-level participants. */
async function mkTopic() {
  const t = await charterTopic({
    project_id: TEST_PROJECT, name: 'Motion Route Test',
    charter: 'route test', created_by: 'proposer',
  });
  // Sprint 15.11 — owner 'proposer' (created_by) bootstraps at coordination; the
  // non-owners join at execution then 'proposer' grants them coordination.
  await joinTopic({ topic_id: t.topic_id, actor_id: 'proposer', actor_type: 'human', display_name: 'proposer', level: 'coordination' });
  for (const a of ['seconder', 'voterA', 'governor']) {
    await joinTopic({ topic_id: t.topic_id, actor_id: a, actor_type: 'human', display_name: a, level: 'execution' });
    await grantLevel({ topic_id: t.topic_id, actor_id: a, level: 'coordination', granted_by: 'proposer' });
  }
  return t.topic_id;
}

/** Create a body with weighted members + a veto holder. */
async function mkBody() {
  const body = await createBody({
    project_id: TEST_PROJECT, name: 'Route Body',
    quorum: 0, threshold: 0.5, veto_holders: ['governor'], created_by: 'proposer',
  });
  await addBodyMember({ body_id: body.body_id, actor_id: 'proposer', vote_weight: 1 });
  await addBodyMember({ body_id: body.body_id, actor_id: 'seconder', vote_weight: 1 });
  await addBodyMember({ body_id: body.body_id, actor_id: 'voterA', vote_weight: 1 });
  return body.body_id;
}

/** Force a motion's deadline into the past via direct SQL. */
async function expireMotion(motionId: string) {
  const pool = getDbPool();
  await pool.query(
    `UPDATE motions SET deadline = now() - interval '10 minutes' WHERE motion_id = $1`,
    [motionId],
  );
}

// ── POST /api/decision-bodies → 201 ──────────────────────────────────────────

test('POST /api/decision-bodies → created → 201', async () => {
  const res = await request('POST', '/api/decision-bodies', {
    project_id: TEST_PROJECT, name: 'Committee', quorum: 0, threshold: 0.5, created_by: 'proposer',
  });
  assert.equal(res.status, 201, `expected 201, got ${res.status}: ${JSON.stringify(res.json)}`);
  assert.equal(res.json.status, 'ok');
  assert.ok(res.json.data.body_id, 'body_id present');
});

test('POST /api/decision-bodies/:id/members → ok → 200', async () => {
  const bodyId = await mkBody();
  const res = await request('POST', `/api/decision-bodies/${bodyId}/members`, {
    actor_id: 'newmember', vote_weight: 2,
  });
  assert.equal(res.status, 200, `expected 200, got ${res.status}: ${JSON.stringify(res.json)}`);
  assert.equal(res.json.data.status, 'ok');
});

test('POST /api/decision-bodies/:id/members unknown body → body_not_found → 422', async () => {
  const res = await request('POST', '/api/decision-bodies/00000000-0000-0000-0000-000000000000/members', {
    actor_id: 'x', vote_weight: 1,
  });
  assert.equal(res.status, 422, `expected 422, got ${res.status}`);
  assert.equal(res.json.data.status, 'body_not_found');
});

// ── POST /api/topics/:id/motions → proposed → 201 ────────────────────────────

test('POST /api/topics/:id/motions → proposed → 201', async () => {
  const topicId = await mkTopic();
  const bodyId = await mkBody();
  const res = await request('POST', `/api/topics/${topicId}/motions`, {
    body_id: bodyId, subject_ref: 'adopt-spec', proposed_by: 'proposer',
  });
  assert.equal(res.status, 201, `expected 201, got ${res.status}: ${JSON.stringify(res.json)}`);
  assert.equal(res.json.data.status, 'proposed');
  assert.ok(res.json.data.motion_id, 'motion_id present');
});

// ── second / vote → 200 ──────────────────────────────────────────────────────

test('POST /api/motions/:id/second → seconded → 200', async () => {
  const topicId = await mkTopic();
  const bodyId = await mkBody();
  const prop = await request('POST', `/api/topics/${topicId}/motions`, {
    body_id: bodyId, subject_ref: 'x', proposed_by: 'proposer',
  });
  const motionId = prop.json.data.motion_id;
  const res = await request('POST', `/api/motions/${motionId}/second`, { actor_id: 'seconder' });
  assert.equal(res.status, 200, `expected 200, got ${res.status}: ${JSON.stringify(res.json)}`);
  assert.equal(res.json.data.status, 'seconded');
});

test('POST /api/motions/:id/votes → vote_recorded → 200', async () => {
  const topicId = await mkTopic();
  const bodyId = await mkBody();
  const prop = await request('POST', `/api/topics/${topicId}/motions`, {
    body_id: bodyId, subject_ref: 'x', proposed_by: 'proposer',
  });
  const motionId = prop.json.data.motion_id;
  await request('POST', `/api/motions/${motionId}/second`, { actor_id: 'seconder' });
  const res = await request('POST', `/api/motions/${motionId}/votes`, { actor_id: 'voterA', choice: 'for' });
  assert.equal(res.status, 200, `expected 200, got ${res.status}: ${JSON.stringify(res.json)}`);
  assert.equal(res.json.data.status, 'vote_recorded');
});

// ── tally — pre-deadline → balloting_open → 409 ──────────────────────────────

test('POST /api/motions/:id/tally pre-deadline → balloting_open → 409', async () => {
  const topicId = await mkTopic();
  const bodyId = await mkBody();
  const prop = await request('POST', `/api/topics/${topicId}/motions`, {
    body_id: bodyId, subject_ref: 'x', proposed_by: 'proposer',
  });
  const motionId = prop.json.data.motion_id;
  await request('POST', `/api/motions/${motionId}/second`, { actor_id: 'seconder' });
  await request('POST', `/api/motions/${motionId}/votes`, { actor_id: 'voterA', choice: 'for' });
  // deadline NOT expired — tally must 409
  const res = await request('POST', `/api/motions/${motionId}/tally`);
  assert.equal(res.status, 409, `expected 409, got ${res.status}: ${JSON.stringify(res.json)}`);
  assert.equal(res.json.data.status, 'balloting_open');
});

// ── tally — past-deadline → carried → 200 ────────────────────────────────────

test('POST /api/motions/:id/tally past-deadline → carried → 200', async () => {
  const topicId = await mkTopic();
  const bodyId = await mkBody();
  const prop = await request('POST', `/api/topics/${topicId}/motions`, {
    body_id: bodyId, subject_ref: 'x', proposed_by: 'proposer',
  });
  const motionId = prop.json.data.motion_id;
  await request('POST', `/api/motions/${motionId}/second`, { actor_id: 'seconder' });
  await request('POST', `/api/motions/${motionId}/votes`, { actor_id: 'voterA', choice: 'for' });
  await expireMotion(motionId);
  const res = await request('POST', `/api/motions/${motionId}/tally`);
  assert.equal(res.status, 200, `expected 200, got ${res.status}: ${JSON.stringify(res.json)}`);
  assert.equal(res.json.data.status, 'carried');
});

// ── veto → vetoed → 200 ──────────────────────────────────────────────────────

test('POST /api/motions/:id/veto → vetoed → 200', async () => {
  const topicId = await mkTopic();
  const bodyId = await mkBody();
  const prop = await request('POST', `/api/topics/${topicId}/motions`, {
    body_id: bodyId, subject_ref: 'x', proposed_by: 'proposer',
  });
  const motionId = prop.json.data.motion_id;
  await request('POST', `/api/motions/${motionId}/second`, { actor_id: 'seconder' });
  const res = await request('POST', `/api/motions/${motionId}/veto`, { actor_id: 'governor' });
  assert.equal(res.status, 200, `expected 200, got ${res.status}: ${JSON.stringify(res.json)}`);
  assert.equal(res.json.data.status, 'vetoed');
});

test('POST /api/motions/:id/veto by a non-holder → not_veto_holder → 403', async () => {
  const topicId = await mkTopic();
  const bodyId = await mkBody();
  const prop = await request('POST', `/api/topics/${topicId}/motions`, {
    body_id: bodyId, subject_ref: 'x', proposed_by: 'proposer',
  });
  const motionId = prop.json.data.motion_id;
  await request('POST', `/api/motions/${motionId}/second`, { actor_id: 'seconder' });
  const res = await request('POST', `/api/motions/${motionId}/veto`, { actor_id: 'voterA' });
  assert.equal(res.status, 403, `expected 403, got ${res.status}: ${JSON.stringify(res.json)}`);
  assert.equal(res.json.data.status, 'not_veto_holder');
});

// ── second by the proposer → self_second_forbidden → 403 ─────────────────────

test('POST /api/motions/:id/second by the proposer → self_second_forbidden → 403', async () => {
  const topicId = await mkTopic();
  const bodyId = await mkBody();
  const prop = await request('POST', `/api/topics/${topicId}/motions`, {
    body_id: bodyId, subject_ref: 'x', proposed_by: 'proposer',
  });
  const motionId = prop.json.data.motion_id;
  const res = await request('POST', `/api/motions/${motionId}/second`, { actor_id: 'proposer' });
  assert.equal(res.status, 403, `expected 403, got ${res.status}: ${JSON.stringify(res.json)}`);
  assert.equal(res.json.data.status, 'self_second_forbidden');
});

// ── propose non-participant → not_participant → 422 ──────────────────────────

test('POST /api/topics/:id/motions by a non-participant → not_participant → 422', async () => {
  const topicId = await mkTopic();
  const bodyId = await mkBody();
  const res = await request('POST', `/api/topics/${topicId}/motions`, {
    body_id: bodyId, subject_ref: 'x', proposed_by: 'stranger',
  });
  assert.equal(res.status, 422, `expected 422, got ${res.status}`);
  assert.equal(res.json.data.status, 'not_participant');
});

// ── GET /api/motions/:id → unknown → 404 ─────────────────────────────────────

test('GET /api/motions/:id → unknown motion → 404', async () => {
  const res = await request('GET', '/api/motions/00000000-0000-0000-0000-000000000000');
  assert.equal(res.status, 404, `expected 404, got ${res.status}`);
});

test('GET /api/decision-bodies/:id → unknown body → 404', async () => {
  const res = await request('GET', '/api/decision-bodies/00000000-0000-0000-0000-000000000000');
  assert.equal(res.status, 404, `expected 404, got ${res.status}`);
});

// ── validation throw → 400 ───────────────────────────────────────────────────

test('POST /api/decision-bodies threshold>1 → 400', async () => {
  const res = await request('POST', '/api/decision-bodies', {
    project_id: TEST_PROJECT, name: 'X', quorum: 0, threshold: 2, created_by: 'proposer',
  });
  assert.equal(res.status, 400, `expected 400, got ${res.status}`);
  assert.equal(res.json.code, 'BAD_REQUEST');
});

// [Domain 8] REMOVED the GET role-gate tests — they asserted the deleted requireRole middleware via an
// x-test-key-role shim. Authorization is now authorize() over principal grants (motions/decision-body
// scope is covered by the decisions-authz / motions service suites). Functional GET coverage is below.

// ── GET list endpoints return data ───────────────────────────────────────────

test('GET /api/topics/:id/motions returns the motion list', async () => {
  const topicId = await mkTopic();
  const bodyId = await mkBody();
  await request('POST', `/api/topics/${topicId}/motions`, {
    body_id: bodyId, subject_ref: 'x', proposed_by: 'proposer',
  });
  const res = await request('GET', `/api/topics/${topicId}/motions`);
  assert.equal(res.status, 200);
  assert.equal(res.json.data.motions.length, 1);
});

test('GET /api/topics/:id/motions unknown topic → 404', async () => {
  const res = await request('GET', '/api/topics/no-such-topic/motions');
  assert.equal(res.status, 404, `expected 404, got ${res.status}`);
});
