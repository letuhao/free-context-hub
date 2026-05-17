/**
 * Phase 15 Sprint 15.1 — topics REST/SSE route tests.
 *
 * Design ref: docs/specs/2026-05-16-phase-15-sprint-15.1-design.md §5.1; CLARIFY AC9.
 * Added in design rev 5 — REVIEW-CODE r1 WARN-3: the SSE handler had no automated test.
 *
 * Covers the SSE handler (GET /api/topics/:id/stream):
 *   - a closed topic streams the backlog and ends with stream_end
 *   - an unknown topic returns 404 (not a hung 200 text/event-stream)
 *   - a client disconnect runs cleanup exactly once (timer cleared, response ended)
 *
 * Real test DB via DATABASE_URL; a minimal Express app hosts topicsRouter.
 */

import assert from 'node:assert/strict';
import test, { before, after } from 'node:test';
import http from 'node:http';
import express from 'express';
import { topicsRouter, _activeStreamCountForTest } from './topics.js';
import { charterTopic, joinTopic, closeTopic } from '../../core/index.js';
import { getDbPool } from '../../db/client.js';

const TEST_PROJECT = '__test_topics_routes__';

async function cleanup() {
  const pool = getDbPool();
  await pool.query(
    `DELETE FROM coordination_events WHERE topic_id IN
       (SELECT topic_id FROM topics WHERE project_id = $1)`,
    [TEST_PROJECT],
  );
  await pool.query(`DELETE FROM topics WHERE project_id = $1`, [TEST_PROJECT]);
  await pool.query(`DELETE FROM actors WHERE project_id = $1`, [TEST_PROJECT]);
}

let server: http.Server;
let baseUrl = '';

before(async () => {
  await cleanup();
  const app = express();
  app.use(express.json());
  app.use('/api/topics', topicsRouter);
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

/** GET a path and collect the full body — for a self-ending response. */
function getText(path: string): Promise<{ status: number; body: string }> {
  return new Promise((resolve, reject) => {
    const req = http.get(`${baseUrl}${path}`, (res) => {
      let body = '';
      res.setEncoding('utf8');
      res.on('data', (c) => { body += c; });
      res.on('end', () => resolve({ status: res.statusCode ?? 0, body }));
      res.on('error', reject);
    });
    req.on('error', reject);
    req.setTimeout(8000, () => req.destroy(new Error('getText timeout')));
  });
}

test('SSE stream of a closed topic delivers the backlog and ends with stream_end', async () => {
  const t = await charterTopic({
    project_id: TEST_PROJECT, name: 'n', charter: 'c', created_by: 'creator',
  });
  await joinTopic({
    topic_id: t.topic_id, actor_id: 'a1', actor_type: 'ai',
    display_name: 'A1', level: 'execution',
  });
  await closeTopic({ topic_id: t.topic_id, actor_id: 'a1' });

  const { status, body } = await getText(`/api/topics/${t.topic_id}/stream`);
  assert.equal(status, 200);
  assert.match(body, /event: topic\.chartered/);
  assert.match(body, /event: topic\.actor_joined/);
  assert.match(body, /event: topic\.closed/);
  assert.match(body, /event: stream_end/);
});

test('SSE stream of an unknown topic returns 404 (not a hung 200)', async () => {
  const { status } = await getText('/api/topics/no-such-topic-xyz/stream');
  assert.equal(status, 404);
});

test('SSE stream runs cleanup exactly once on client disconnect', async () => {
  const t = await charterTopic({
    project_id: TEST_PROJECT, name: 'n', charter: 'c', created_by: 'creator',
  });
  await joinTopic({
    topic_id: t.topic_id, actor_id: 'a1', actor_type: 'ai',
    display_name: 'A1', level: 'execution',
  });
  // an OPEN topic (not closed) — the SSE stream stays open, polling
  const baseline = _activeStreamCountForTest();
  const req = http.get(`${baseUrl}/api/topics/${t.topic_id}/stream`);
  // wait until the stream is armed (the client has received the initial backlog)
  await new Promise<void>((resolve, reject) => {
    const to = setTimeout(() => reject(new Error('no SSE data within 5s')), 5000);
    req.on('response', (res) => {
      res.once('data', () => { clearTimeout(to); resolve(); });
      res.on('error', () => {});
    });
    req.on('error', (e) => { clearTimeout(to); reject(e); });
  });
  assert.equal(_activeStreamCountForTest(), baseline + 1, 'stream is live and counted');
  // client disconnects
  req.destroy();
  // give the server a moment to process req.on('close')
  await new Promise((r) => setTimeout(r, 400));
  assert.equal(
    _activeStreamCountForTest(), baseline,
    'cleanup ran on disconnect — live-stream count is back to baseline',
  );
});
