/**
 * Phase 15 Sprint 15.2.1 — board REST route tests.
 *
 * Added in the post-review fix-up (review-impl MED-3): the 15.2 design §8 plan
 * listed only service tests (T1–T17), so `statusToHttp` and every REST error
 * branch in boardRouter were exercised by nothing. This file mirrors
 * src/api/routes/topics.test.ts's harness — a minimal Express app hosting
 * boardRouter against the real test DB — and asserts the HTTP status code for
 * one success path per verb plus each error mapping:
 *
 *   - post_task success                  → 201
 *   - list_board success                 → 200
 *   - claim conflict (held task)         → 409
 *   - release not_owner                  → 403
 *   - claim not_found (unknown task)     → 404
 *   - post_task validation (bad slot)    → 400  (BAD_REQUEST)
 */

import assert from 'node:assert/strict';
import test, { before, after } from 'node:test';
import http from 'node:http';
import express from 'express';
import { boardRouter } from './board.js';
import { charterTopic, joinTopic, postTask, claimTask } from '../../core/index.js';
import { getDbPool } from '../../db/client.js';

const TEST_PROJECT = '__test_board_routes__';

async function cleanup() {
  const pool = getDbPool();
  const topicIds = await pool.query<{ topic_id: string }>(
    `SELECT topic_id FROM topics WHERE project_id = $1`,
    [TEST_PROJECT],
  );
  for (const { topic_id } of topicIds.rows) {
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
  // No auth middleware — requireRole('writer') allows everything when
  // apiKeyRole is unset (auth disabled), mirroring topics.test.ts.
  app.use('/api', boardRouter);
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

/** Charter + join an active topic; returns its topic_id. */
async function mkActiveTopic(): Promise<string> {
  const t = await charterTopic({
    project_id: TEST_PROJECT, name: 'Board Route Test',
    charter: 'route the board', created_by: 'creator-1',
  });
  await joinTopic({
    topic_id: t.topic_id, actor_id: 'creator-1', actor_type: 'ai',
    display_name: 'Creator', level: 'coordination',
  });
  return t.topic_id;
}

// ── post_task success → 201 ──────────────────────────────────────────────────

test('POST /api/topics/:id/tasks → 201 on success', async () => {
  const topicId = await mkActiveTopic();
  const { status, json } = await request('POST', `/api/topics/${topicId}/tasks`, {
    title: 'Write the doc', topology: 'parallel',
    slot: 'spec', kind: 'document', created_by: 'creator-1',
  });
  assert.equal(status, 201, 'post_task success maps to 201');
  assert.equal(json.status, 'ok');
  assert.ok(json.data.task_id, 'returns the task record');
});

// ── list_board success → 200 ─────────────────────────────────────────────────

test('GET /api/topics/:id/board → 200 on success', async () => {
  const topicId = await mkActiveTopic();
  await postTask({
    topic_id: topicId, title: 'a task', topology: 'parallel',
    slot: 'lb', kind: 'document', created_by: 'creator-1',
  });
  const { status, json } = await request('GET', `/api/topics/${topicId}/board`);
  assert.equal(status, 200, 'list_board maps to 200');
  assert.equal(json.status, 'ok');
  assert.equal(json.data.tasks.length, 1);
});

// ── claim conflict → 409 ─────────────────────────────────────────────────────

test('POST /api/tasks/:id/claim → 409 when the task is already claimed (conflict)', async () => {
  const topicId = await mkActiveTopic();
  const task = await postTask({
    topic_id: topicId, title: 'contended', topology: 'parallel',
    slot: 'cf', kind: 'document', created_by: 'creator-1',
  });
  // first claim wins outside the router
  const first = await claimTask({ task_id: task.task_id, actor_id: 'incumbent' });
  assert.equal(first.status, 'claimed');
  // a second claim over HTTP → conflict → 409
  const { status, json } = await request('POST', `/api/tasks/${task.task_id}/claim`, {
    actor_id: 'latecomer',
  });
  assert.equal(status, 409, 'a claim conflict maps to 409');
  assert.equal(json.data.status, 'conflict');
});

// ── release not_owner → 403 ──────────────────────────────────────────────────

test('POST /api/tasks/:id/release → 403 when the caller is not the holder (not_owner)', async () => {
  const topicId = await mkActiveTopic();
  const task = await postTask({
    topic_id: topicId, title: 'held', topology: 'parallel',
    slot: 'no', kind: 'document', created_by: 'creator-1',
  });
  await claimTask({ task_id: task.task_id, actor_id: 'holder' });
  const { status, json } = await request('POST', `/api/tasks/${task.task_id}/release`, {
    actor_id: 'imposter',
  });
  assert.equal(status, 403, 'not_owner maps to 403');
  assert.equal(json.data.status, 'not_owner');
});

// ── claim not_found → 404 ────────────────────────────────────────────────────

test('POST /api/tasks/:id/claim → 404 for an unknown task (not_found)', async () => {
  const { status, json } = await request(
    'POST', '/api/tasks/00000000-0000-0000-0000-000000000000/claim',
    { actor_id: 'worker-1' },
  );
  assert.equal(status, 404, 'not_found maps to 404');
  assert.equal(json.data.status, 'not_found');
});

// ── BAD_REQUEST → 400 ────────────────────────────────────────────────────────

test('POST /api/topics/:id/tasks → 400 on a validation failure (BAD_REQUEST)', async () => {
  const topicId = await mkActiveTopic();
  const { status, json } = await request('POST', `/api/topics/${topicId}/tasks`, {
    title: 't', topology: 'parallel',
    slot: 'Bad Slot', kind: 'document', created_by: 'creator-1',
  });
  assert.equal(status, 400, 'a ContextHubError(BAD_REQUEST) maps to 400');
  assert.equal(json.status, 'error');
  assert.equal(json.code, 'BAD_REQUEST');
});
