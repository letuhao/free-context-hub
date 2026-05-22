/**
 * DEFERRED-024 — claimNextQueuedJob project-scope filter.
 *
 * A scoped pop (a project-scoped api key calling /run-next) drains only its own
 * project's queue; an unscoped pop (worker / auth-off / global key) drains any.
 */

import assert from 'node:assert/strict';
import test, { before, after, beforeEach } from 'node:test';
import { claimNextQueuedJob } from './jobQueue.js';
import { getDbPool } from '../db/client.js';

const QUEUE = '__test_d024_queue__';
const PROJ_A = '__test_d024_A__';
const PROJ_B = '__test_d024_B__';

async function cleanup() {
  const pool = getDbPool();
  await pool.query(`DELETE FROM async_jobs WHERE queue_name = $1`, [QUEUE]);
  await pool.query(`DELETE FROM projects WHERE project_id = ANY($1::text[])`, [[PROJ_A, PROJ_B]]);
}

async function seedProjects() {
  const pool = getDbPool();
  await pool.query(`INSERT INTO projects (project_id, name) VALUES ($1,'A'),($2,'B') ON CONFLICT DO NOTHING`, [PROJ_A, PROJ_B]);
}

async function seedJob(projectId: string | null): Promise<string> {
  const pool = getDbPool();
  const r = await pool.query<{ job_id: string }>(
    `INSERT INTO async_jobs (project_id, job_type, queue_name, status, available_at, payload)
     VALUES ($1, 'quality.eval', $2, 'queued', now() - interval '1 minute', '{}'::jsonb)
     RETURNING job_id`,
    [projectId, QUEUE],
  );
  return r.rows[0].job_id;
}

before(async () => { await cleanup(); await seedProjects(); });
after(cleanup);
beforeEach(async () => { await cleanup(); await seedProjects(); });

test('D024 AC1: a scoped pop claims only its own project job', async () => {
  await seedJob(PROJ_A);
  const jobB = await seedJob(PROJ_B);

  // scoped to A → must claim the A job, never B
  const claimed = await claimNextQueuedJob(QUEUE, PROJ_A);
  assert.ok(claimed, 'a project-A job is claimed');
  assert.equal(claimed!.project_id, PROJ_A);

  // the B job is still queued (a scoped-to-A pop must not have touched it)
  const pool = getDbPool();
  const bStatus = await pool.query<{ status: string }>(`SELECT status FROM async_jobs WHERE job_id=$1`, [jobB]);
  assert.equal(bStatus.rows[0].status, 'queued', 'project-B job untouched by an A-scoped pop');
});

test('D024 AC1: a scoped pop with no matching job → null (does NOT steal another project)', async () => {
  await seedJob(PROJ_B); // only a B job exists
  const claimed = await claimNextQueuedJob(QUEUE, PROJ_A); // scoped to A
  assert.equal(claimed, null, 'no A job → idle; the B job is not claimed cross-tenant');

  const pool = getDbPool();
  const cnt = await pool.query<{ n: string }>(`SELECT count(*)::text n FROM async_jobs WHERE queue_name=$1 AND status='queued'`, [QUEUE]);
  assert.equal(cnt.rows[0].n, '1', 'the B job remains queued');
});

test('D024 AC2: an unscoped pop (no projectScope) claims any project job', async () => {
  await seedJob(PROJ_A);
  const claimed = await claimNextQueuedJob(QUEUE); // no scope → worker behavior
  assert.ok(claimed, 'unscoped pop claims the next job');
  assert.equal(claimed!.project_id, PROJ_A);
});

test('D024 AC2: null/empty projectScope behaves as unscoped', async () => {
  await seedJob(PROJ_B);
  const claimedNull = await claimNextQueuedJob(QUEUE, null);
  assert.ok(claimedNull, 'null scope → unscoped pop');
  assert.equal(claimedNull!.project_id, PROJ_B);
});

test('D024 AC3: a scoped pop skips a null-project (global) job', async () => {
  await seedJob(null); // a global/null-project job
  const claimed = await claimNextQueuedJob(QUEUE, PROJ_A); // scoped to A
  assert.equal(claimed, null, 'a scoped worker does not drain null-project (global) jobs');

  // an unscoped pop DOES claim it
  const claimedGlobal = await claimNextQueuedJob(QUEUE);
  assert.ok(claimedGlobal, 'unscoped pop claims the null-project job');
  assert.equal(claimedGlobal!.project_id, null);
});
