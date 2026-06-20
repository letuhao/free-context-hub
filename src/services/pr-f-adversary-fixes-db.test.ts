/**
 * DEFERRED-029 PR F — REAL-DB regression tests for the 3 highest-severity
 * adversary findings (SEC-1, SEC-2, SEC-3, SEC-6).
 *
 * The companion DB-free file `pr-f-adversary-fixes.test.ts` exercises the
 * scope-helper short-circuit (assertCallerScope fires before DB). These tests
 * exercise the FULL contract end-to-end against a live Postgres:
 *
 *   - SEC-1: scoped caller without project_id OR projectIds → the listJobs
 *     WHERE clause must be pinned to scope (not unconstrained '1=1').
 *     Concrete proof: insert jobs into proj-A AND proj-B, scopedA calls
 *     listJobs() without any project filter, must see ONLY proj-A jobs.
 *
 *   - SEC-2: scoped caller's intake (in proj-A) cannot triage with a
 *     route.topic_id from proj-B. The fix's assertTopicScope must throw
 *     NOT_FOUND before any UPDATE/appendEvent. Concrete proof: count
 *     coordination_events rows in proj-B's topic before + after the failed
 *     triage — must be identical (no event-log injection).
 *
 *   - SEC-3: scoped caller without project_id must NOT write a row with
 *     project_id=NULL. Concrete proof: count rows after enqueue, find row
 *     by job_id, assert project_id matches caller's scope.
 *
 *   - SEC-6: scoped caller with payload.root must be rejected BAD_REQUEST
 *     and NO row inserted. Concrete proof: row count unchanged after the
 *     rejected call.
 *
 * Requires DATABASE_URL — run via `npm test` against the dev stack.
 */

import assert from 'node:assert/strict';
import test, { before, after, beforeEach } from 'node:test';

// Force the postgres job backend BEFORE any module that reads env. Bypasses
// the RabbitMQ publish path inside enqueueJob — these tests only care about
// the async_jobs row, not the broker fan-out. The env cache (added in PR E)
// is reset in `before()` so the override actually takes effect.
process.env.QUEUE_ENABLED = 'false';
process.env.QUEUE_BACKEND = 'postgres';

import { enqueueJob, listJobs } from './jobQueue.js';
import { submitIntake, triageIntake } from './intake.js';
import { charterTopic, joinTopic } from './topics.js';
import { createPrincipal } from './principals.js';
import { createGrant } from './grants.js';
import { getDbPool } from '../db/client.js';
import { ContextHubError } from '../core/errors.js';
import { _resetEnvCacheForTest } from '../env.js';

const isForbidden = (err: unknown): boolean =>
  err instanceof ContextHubError && err.code === 'FORBIDDEN';

/** F2f: mint a principal granted `capability` over `project`, returning its id. */
async function grantedPrincipal(name: string, project: string, capability: 'read' | 'write' | 'admin'): Promise<string> {
  const p = (await createPrincipal({ kind: 'agent', display_name: name })).principal_id;
  await createGrant({ grantee_principal: p, scope_type: 'project', scope_id: project, capability, granted_by: p });
  return p;
}
async function dropPrincipal(id: string): Promise<void> {
  const pool = getDbPool();
  await pool.query(`DELETE FROM grants WHERE grantee_principal=$1 OR granted_by=$1`, [id]);
  await pool.query(`DELETE FROM principals WHERE principal_id=$1`, [id]);
}

const PROJ_A = '__sec_db_A__';
const PROJ_B = '__sec_db_B__';
const ACTOR_A = 'sec-db-actor-A';
const ACTOR_B = 'sec-db-actor-B';

const isNotFound = (err: unknown): boolean =>
  err instanceof ContextHubError && err.code === 'NOT_FOUND';

const isBadRequest = (err: unknown): boolean =>
  err instanceof ContextHubError && err.code === 'BAD_REQUEST';

// ── Fixture setup / teardown ─────────────────────────────────────────────────

async function purge(projectId: string) {
  const pool = getDbPool();
  // Jobs
  await pool.query(`DELETE FROM async_jobs WHERE project_id=$1`, [projectId]);
  // Topics + dependents
  const topicIds = await pool.query<{ topic_id: string }>(
    `SELECT topic_id FROM topics WHERE project_id=$1`,
    [projectId],
  );
  for (const { topic_id } of topicIds.rows) {
    await pool.query(`DELETE FROM intake_items WHERE topic_id=$1`, [topic_id]);
    await pool.query(`DELETE FROM coordination_events WHERE topic_id=$1`, [topic_id]);
    await pool.query(`DELETE FROM topic_participants WHERE topic_id=$1`, [topic_id]);
  }
  await pool.query(`DELETE FROM intake_items WHERE project_id=$1`, [projectId]);
  await pool.query(`DELETE FROM topics WHERE project_id=$1`, [projectId]);
  await pool.query(`DELETE FROM actors WHERE project_id=$1`, [projectId]);
  await pool.query(`DELETE FROM projects WHERE project_id=$1`, [projectId]);
}

async function makeProject(projectId: string) {
  const pool = getDbPool();
  await pool.query(
    `INSERT INTO projects (project_id, name) VALUES ($1, $2) ON CONFLICT DO NOTHING`,
    [projectId, `PR F SEC DB Test ${projectId}`],
  );
}

async function makeActiveTopic(projectId: string, actorId: string): Promise<string> {
  const result = await charterTopic({
    project_id: projectId,
    name: `topic-${projectId}`,
    charter: 'sec-db test',
    created_by: actorId,
  });
  // Topic starts in 'forming'. joinTopic with the chartered actor flips it
  // to 'active' (per Sprint 15.1 design).
  await joinTopic({
    topic_id: result.topic_id,
    actor_id: actorId,
    level: 'authority',
    actor_type: 'human',
    display_name: actorId,
  });
  return result.topic_id;
}

before(async () => {
  // Bust the env cache so the QUEUE_BACKEND override at the top of this file
  // actually takes effect when getEnv() is first called inside enqueueJob.
  _resetEnvCacheForTest();
  await purge(PROJ_A);
  await purge(PROJ_B);
  await makeProject(PROJ_A);
  await makeProject(PROJ_B);
});

after(async () => {
  await purge(PROJ_A);
  await purge(PROJ_B);
});

// Job count helper for SEC-1/SEC-3/SEC-6.
async function countJobs(projectId: string | null): Promise<number> {
  const pool = getDbPool();
  const r = projectId === null
    ? await pool.query<{ n: string }>(`SELECT COUNT(*) AS n FROM async_jobs WHERE project_id IS NULL`)
    : await pool.query<{ n: string }>(`SELECT COUNT(*) AS n FROM async_jobs WHERE project_id=$1`, [projectId]);
  return parseInt(r.rows[0]?.n ?? '0', 10);
}

beforeEach(async () => {
  // Clean async_jobs each test to keep counts predictable.
  const pool = getDbPool();
  await pool.query(`DELETE FROM async_jobs WHERE project_id IN ($1, $2) OR project_id IS NULL`, [PROJ_A, PROJ_B]);
});

// ─────────────────────────────────────────────────────────────────────────────
// SEC-1 — listJobs scoped + no projectId/projectIds must pin to scope
// ─────────────────────────────────────────────────────────────────────────────

test('SEC-1 DB: scoped listJobs without project filter sees ONLY own jobs (no cross-tenant leak)', async () => {
  // Plant 2 jobs in proj-A and 2 jobs in proj-B (admin-style enqueue, no scope).
  await enqueueJob({ project_id: PROJ_A, job_type: 'index.run' as any, payload: { marker: 'A1' } });
  await enqueueJob({ project_id: PROJ_A, job_type: 'index.run' as any, payload: { marker: 'A2' } });
  await enqueueJob({ project_id: PROJ_B, job_type: 'index.run' as any, payload: { marker: 'B1' } });
  await enqueueJob({ project_id: PROJ_B, job_type: 'index.run' as any, payload: { marker: 'B2' } });

  // Scoped-A calls listJobs with NEITHER projectId NOR projectIds. Pre-fix:
  // unconstrained WHERE → 4 rows returned. Post-fix: auto-bind to PROJ_A → 2 rows.
  const r = await listJobs({ callerScope: PROJ_A, limit: 100 });

  // Must see ONLY proj-A jobs (the SEC-1 fix's pin behavior)
  const projIds = new Set(r.items.map((j) => j.project_id));
  assert.deepEqual(
    [...projIds].sort(),
    [PROJ_A],
    `Scoped-A listJobs leaked cross-tenant project_ids: ${[...projIds].join(', ')}`,
  );
  // And we should see all proj-A jobs we planted.
  assert.equal(r.items.length, 2, `Expected 2 proj-A jobs, got ${r.items.length}`);
});

test('SEC-1 DB: scoped listJobs with cross-tenant explicit projectId → NOT_FOUND', async () => {
  await enqueueJob({ project_id: PROJ_B, job_type: 'index.run' as any, payload: {} });
  await assert.rejects(
    listJobs({ projectId: PROJ_B, callerScope: PROJ_A, limit: 100 }),
    isNotFound,
  );
});

// ─────────────────────────────────────────────────────────────────────────────
// SEC-3 — enqueueJob scoped + omitted project_id must auto-bind (not NULL)
// ─────────────────────────────────────────────────────────────────────────────

test('SEC-3 DB: scoped enqueueJob without project_id writes row with project_id=scope (not NULL)', async () => {
  const nullCountBefore = await countJobs(null);
  const projACountBefore = await countJobs(PROJ_A);

  const r = await enqueueJob({
    callerScope: PROJ_A,
    job_type: 'index.run' as any,
    payload: { marker: 'SEC-3-autobind' },
  } as any);
  assert.equal(r.status, 'queued');
  assert.ok(r.job_id);

  // Pre-fix: nullCountAfter would be +1. Post-fix: projACountAfter must be +1
  // AND nullCountAfter must equal nullCountBefore.
  const nullCountAfter = await countJobs(null);
  const projACountAfter = await countJobs(PROJ_A);

  assert.equal(nullCountAfter, nullCountBefore, `SEC-3 regressed: ${nullCountAfter - nullCountBefore} NULL-project rows written by scoped enqueue`);
  assert.equal(projACountAfter, projACountBefore + 1, `SEC-3 regressed: row not bound to scope's project_id`);

  // Direct read to confirm shape
  const pool = getDbPool();
  const row = await pool.query<{ project_id: string | null }>(
    `SELECT project_id FROM async_jobs WHERE job_id=$1`,
    [r.job_id],
  );
  assert.equal(row.rows[0]?.project_id, PROJ_A, 'job project_id must equal scoped callerScope');
});

test('SEC-3 DB: scoped enqueueJob with cross-tenant project_id → NOT_FOUND, no row written', async () => {
  const projBCountBefore = await countJobs(PROJ_B);

  await assert.rejects(
    enqueueJob({
      project_id: PROJ_B,
      callerScope: PROJ_A,
      job_type: 'index.run' as any,
      payload: {},
    }),
    isNotFound,
  );

  const projBCountAfter = await countJobs(PROJ_B);
  assert.equal(projBCountAfter, projBCountBefore, 'No row should be inserted on rejection');
});

// ─────────────────────────────────────────────────────────────────────────────
// SEC-6 — scoped enqueueJob + payload.root → BAD_REQUEST, no row written
// ─────────────────────────────────────────────────────────────────────────────

test('SEC-6 DB: scoped enqueueJob with payload.root → BAD_REQUEST, no row written', async () => {
  const projACountBefore = await countJobs(PROJ_A);
  const nullCountBefore = await countJobs(null);

  await assert.rejects(
    enqueueJob({
      project_id: PROJ_A,
      callerScope: PROJ_A,
      job_type: 'index.run' as any,
      payload: { root: '/path/to/proj-B/cache' },
    }),
    isBadRequest,
  );

  const projACountAfter = await countJobs(PROJ_A);
  const nullCountAfter = await countJobs(null);
  assert.equal(projACountAfter, projACountBefore, 'SEC-6 regressed: row written despite payload.root rejection');
  assert.equal(nullCountAfter, nullCountBefore, 'SEC-6 regressed: NULL-project row written despite rejection');
});

test('SEC-6 DB: admin enqueueJob (callerScope=null) WITH payload.root → allowed', async () => {
  // Admin / global key retains the worker-driving capability. Only scoped
  // callers are blocked from passing payload.root (SEC-6 fix is at the
  // typeof callerScope === 'string' branch).
  const r = await enqueueJob({
    project_id: PROJ_A,
    callerScope: null,
    job_type: 'index.run' as any,
    payload: { root: '/admin-supplied/path' },
  });
  assert.equal(r.status, 'queued');
});

// ─────────────────────────────────────────────────────────────────────────────
// SEC-2 — triageIntake cross-tenant route.topic_id rejected, NO event written
// ─────────────────────────────────────────────────────────────────────────────

test('SEC-2 DB: scoped intake triaged to cross-tenant topic → NOT_FOUND + no coordination_events injected', async () => {
  // Setup: active topic in PROJ_A (where intake lives) and active topic in
  // PROJ_B (the cross-tenant target the attacker wants to inject into).
  const topicA = await makeActiveTopic(PROJ_A, ACTOR_A);
  const topicB = await makeActiveTopic(PROJ_B, ACTOR_B);

  // Submit an intake owned by proj-A (setup runs auth-OFF; the gate is inert here).
  const intake = await submitIntake({
    project_id: PROJ_A,
    kind: 'suggestion',
    body: 'SEC-2 DB regression intake',
    submitted_by: ACTOR_A,
  });
  assert.equal(intake.status, 'received');

  // Snapshot proj-B's topic event count BEFORE the cross-tenant attempt.
  const pool = getDbPool();
  const beforeRes = await pool.query<{ n: string }>(
    `SELECT COUNT(*) AS n FROM coordination_events WHERE topic_id=$1`,
    [topicB],
  );
  const beforeCount = parseInt(beforeRes.rows[0]?.n ?? '0', 10);

  // F2f: scopedA is a principal granted write@PROJ_A only. Under auth-ON the cross-tenant triage
  // (route.topic_id in PROJ_B) is rejected by authorize() on the topic — a write-deny on a resolvable
  // cross-tenant topic → FORBIDDEN — BEFORE any UPDATE/appendEvent. (Pre-F2f the assertTopicScope
  // guard gave NOT_FOUND; the no-injection guarantee is identical.)
  const originalAuth = process.env.MCP_AUTH_ENABLED;
  const scopedA = await grantedPrincipal('__sec_db_scopedA__', PROJ_A, 'write');
  process.env.MCP_AUTH_ENABLED = 'true';
  _resetEnvCacheForTest();
  try {
    await assert.rejects(
      triageIntake(
        intake.intake_id,
        {
          route_kind: 'task' as const,
          actor_id: ACTOR_A,
          topic_id: topicB,
          routed_to: 'arbitrary-task-id',
        },
        { actingPrincipalId: scopedA },
      ),
      isForbidden,
    );
  } finally {
    if (originalAuth === undefined) delete process.env.MCP_AUTH_ENABLED;
    else process.env.MCP_AUTH_ENABLED = originalAuth;
    _resetEnvCacheForTest();
    await dropPrincipal(scopedA);
  }

  // Critical negative proof: proj-B's coordination_events count must be
  // unchanged. The attacker forged nothing into proj-B's append-only log.
  const afterRes = await pool.query<{ n: string }>(
    `SELECT COUNT(*) AS n FROM coordination_events WHERE topic_id=$1`,
    [topicB],
  );
  const afterCount = parseInt(afterRes.rows[0]?.n ?? '0', 10);
  assert.equal(
    afterCount,
    beforeCount,
    `SEC-2 regressed: ${afterCount - beforeCount} cross-tenant coordination_events row(s) injected into proj-B's topic ${topicB}`,
  );

  // Also confirm the intake row was NOT mutated to point at the cross-tenant
  // topic (the pre-fix UPDATE would have set intake.topic_id = topicB).
  const intakeRow = await pool.query<{ topic_id: string | null; status: string }>(
    `SELECT topic_id, status FROM intake_items WHERE intake_id=$1`,
    [intake.intake_id],
  );
  assert.equal(intakeRow.rows[0]?.topic_id, null, 'SEC-2 regressed: intake.topic_id flipped to cross-tenant');
  assert.equal(intakeRow.rows[0]?.status, 'received', 'SEC-2 regressed: intake.status flipped to triaged despite rejection');

  // Clean up the topics created in this test
  await pool.query(`DELETE FROM coordination_events WHERE topic_id IN ($1, $2)`, [topicA, topicB]);
  await pool.query(`DELETE FROM topic_participants WHERE topic_id IN ($1, $2)`, [topicA, topicB]);
  await pool.query(`DELETE FROM topics WHERE topic_id IN ($1, $2)`, [topicA, topicB]);
});

test('SEC-2 DB: scoped intake triaged to OWN-tenant topic still works (positive control)', async () => {
  // Sanity: make sure the SEC-2 fix didn't break the legitimate same-tenant
  // path. ScopedA triages own intake to own topic → must succeed.
  const topicA = await makeActiveTopic(PROJ_A, ACTOR_A);
  const intake = await submitIntake({
    project_id: PROJ_A,
    callerScope: PROJ_A,
    kind: 'suggestion',
    body: 'SEC-2 positive-control intake',
    submitted_by: ACTOR_A,
  });

  const result = await triageIntake(
    intake.intake_id,
    {
      route_kind: 'task' as const,
      actor_id: ACTOR_A,
      topic_id: topicA,
      routed_to: 'same-tenant-task',
    },
    { callerScope: PROJ_A },
  );
  assert.equal(result.status, 'triaged');
  assert.equal(result.routed_to, 'same-tenant-task');

  // Clean up
  const pool = getDbPool();
  await pool.query(`DELETE FROM coordination_events WHERE topic_id=$1`, [topicA]);
  await pool.query(`DELETE FROM topic_participants WHERE topic_id=$1`, [topicA]);
  await pool.query(`DELETE FROM topics WHERE topic_id=$1`, [topicA]);
});
