/**
 * Actor Data Boundary F2g / DEFERRED-048 — re-validate `payload.root` at job EXECUTION time, not only
 * at enqueue. The enqueue gate blocks a non-global principal from SETTING payload.root, but that is a
 * write-time-only check across the durable queue: rows enqueued before the flip (or while auth was OFF)
 * carry arbitrary roots, and execution honored them unconditionally. So:
 *   - enqueue STAMPS the authorizing global principal into `payload.root_authorized_by` (overwriting any
 *     caller-supplied value);
 *   - execution (resolveRoot via runJobById) honors an explicit root ONLY if the stamp's principal still
 *     holds global write — else FORBIDDEN (fail closed + loud), never a silent fallback.
 * Real DB + auth-ON toggling.
 */

import assert from 'node:assert/strict';
import test, { before, after } from 'node:test';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { runJobById } from './jobExecutor.js';
import { enqueueJob } from './jobQueue.js';
import { resolveProjectRoot } from '../utils/resolveProjectRoot.js';
import { hasGlobalGrant } from './authorize.js';
import { ContextHubError } from '../core/errors.js';
import { createPrincipal, getRootPrincipal, seedRootPrincipal, getSystemPrincipal } from './principals.js';
import { createGrant } from './grants.js';
import { bootstrapSystem } from './bootstrap.js';
import { getDbPool } from './../db/client.js';

const PREFIX = '__test_payloadroot_authz__';
const P = `${PREFIX}proj`;

let sys: string; // global write (covering)
let projWriter: string; // write@P only (NOT global)
let grantor: string;
const saved: Record<string, string | undefined> = {};

async function setEnv(patch: Record<string, string>) {
  for (const k of Object.keys(patch)) {
    if (!(k in saved)) saved[k] = process.env[k];
    process.env[k] = patch[k];
  }
  const { _resetEnvCacheForTest } = await import('../env.js');
  _resetEnvCacheForTest();
}
async function restoreEnv() {
  for (const [k, v] of Object.entries(saved)) {
    if (v === undefined) delete process.env[k];
    else process.env[k] = v;
  }
  const { _resetEnvCacheForTest } = await import('../env.js');
  _resetEnvCacheForTest();
}
async function cleanup() {
  const pool = getDbPool();
  await pool.query(`DELETE FROM async_jobs WHERE project_id LIKE $1`, [`${PREFIX}%`]);
  await pool.query(`DELETE FROM chunks WHERE project_id LIKE $1`, [`${PREFIX}%`]).catch(() => {});
  await pool.query(`DELETE FROM files WHERE project_id LIKE $1`, [`${PREFIX}%`]).catch(() => {});
  await pool.query(`DELETE FROM projects WHERE project_id LIKE $1`, [`${PREFIX}%`]);
  await pool.query(
    `DELETE FROM grants WHERE grantee_principal IN (SELECT principal_id FROM principals WHERE display_name LIKE $1)
        OR granted_by IN (SELECT principal_id FROM principals WHERE display_name LIKE $1)`,
    [`${PREFIX}%`],
  );
  await pool.query(`DELETE FROM principals WHERE display_name LIKE $1`, [`${PREFIX}%`]);
}

/** Seed a queued index.run async_jobs row directly (skip enqueueJob's rabbit publish). */
async function seedJobFor(projectId: string, payload: Record<string, unknown>): Promise<string> {
  const r = await getDbPool().query<{ job_id: string }>(
    `INSERT INTO async_jobs(job_id, project_id, job_type, queue_name, payload, status, max_attempts, available_at, queued_at)
     VALUES (gen_random_uuid(), $1, 'index.run', 'default', $2::jsonb, 'queued', 1, now(), now()) RETURNING job_id`,
    [projectId, JSON.stringify(payload)],
  );
  return r.rows[0].job_id;
}
const seedJob = (payload: Record<string, unknown>) => seedJobFor(P, payload);
const isPayloadRootDenial = (err: unknown) => /explicit root path is a global capability/i.test(String(err ?? ''));

before(async () => {
  await cleanup();
  if (!(await getRootPrincipal())) await seedRootPrincipal({ display_name: 'root' });
  await bootstrapSystem();
  sys = (await getSystemPrincipal())!.principal_id;
  grantor = (await createPrincipal({ kind: 'agent', display_name: `${PREFIX}grantor` })).principal_id;
  projWriter = (await createPrincipal({ kind: 'agent', display_name: `${PREFIX}pw` })).principal_id;
  await createGrant({ grantee_principal: projWriter, scope_type: 'project', scope_id: P, capability: 'write', granted_by: grantor });
  await getDbPool().query(`INSERT INTO projects (project_id, name) VALUES ($1,$1) ON CONFLICT DO NOTHING`, [P]);
  await setEnv({ MCP_AUTH_ENABLED: 'true' });
});
after(async () => {
  await cleanup();
  await restoreEnv();
});

// ── exec-time re-validation (auth-ON) ────────────────────────────────────────
test('exec: payload.root stamped by a global principal → HONORED and actually used (status ok)', async () => {
  const tmp = await fs.mkdtemp(path.join(os.tmpdir(), 'd048-ok-'));
  try {
    const jobId = await seedJob({ root: tmp, root_authorized_by: sys });
    const res = await runJobById(jobId, { actingPrincipalId: sys });
    // P has NO configured root (no project_sources/workspace/chunks). If the explicit root were NOT
    // honored — a silent fallback (AC-2's failure mode) — resolveProjectRoot would throw "root path is
    // required" and the job would ERROR. So status 'ok' proves `tmp` was the root actually indexed.
    assert.equal(res.status, 'ok', `the stamped root must be honored and used; got ${res.status}: ${res.error ?? ''}`);
  } finally {
    await fs.rm(tmp, { recursive: true, force: true }).catch(() => {});
  }
});

// ── the SINGLE chokepoint covers SYNCHRONOUS callers too (index_project / git.ingest / workspace tools
//    + REST routes), not just the job path [REVIEW-CODE #1] ──
test('resolveProjectRoot: explicit root by a NON-global principal → FORBIDDEN (sync-path chokepoint)', async () => {
  const tmp = await fs.mkdtemp(path.join(os.tmpdir(), 'd048-sync-'));
  try {
    await assert.rejects(
      resolveProjectRoot(P, tmp, projWriter),
      (e: unknown) => e instanceof ContextHubError && e.code === 'FORBIDDEN',
    );
  } finally {
    await fs.rm(tmp, { recursive: true, force: true }).catch(() => {});
  }
});
test('resolveProjectRoot: explicit root by the global system principal → honored', async () => {
  const tmp = await fs.mkdtemp(path.join(os.tmpdir(), 'd048-syncok-'));
  try {
    const resolved = await resolveProjectRoot(P, tmp, sys);
    assert.equal(resolved, tmp);
  } finally {
    await fs.rm(tmp, { recursive: true, force: true }).catch(() => {});
  }
});

test('exec: payload.root with NO stamp → FORBIDDEN (fail closed, not a silent fallback)', async () => {
  const tmp = await fs.mkdtemp(path.join(os.tmpdir(), 'd048-nostamp-'));
  try {
    const jobId = await seedJob({ root: tmp }); // no root_authorized_by (pre-flip / auth-off legacy row)
    const res = await runJobById(jobId, { actingPrincipalId: sys });
    assert.equal(res.status, 'error');
    assert.ok(isPayloadRootDenial(res.error), `expected a payload.root denial, got: ${res.error}`);
  } finally {
    await fs.rm(tmp, { recursive: true, force: true }).catch(() => {});
  }
});

test('exec: payload.root stamped by a NON-global (project-scoped) principal → FORBIDDEN', async () => {
  const tmp = await fs.mkdtemp(path.join(os.tmpdir(), 'd048-badstamp-'));
  try {
    const jobId = await seedJob({ root: tmp, root_authorized_by: projWriter });
    const res = await runJobById(jobId, { actingPrincipalId: sys });
    assert.equal(res.status, 'error');
    assert.ok(isPayloadRootDenial(res.error), `expected a payload.root denial, got: ${res.error}`);
  } finally {
    await fs.rm(tmp, { recursive: true, force: true }).catch(() => {});
  }
});

// ── enqueue stamping (auth-ON) ───────────────────────────────────────────────
test('enqueue: a global principal setting payload.root → stamps root_authorized_by, OVERWRITING any forged value', async () => {
  await setEnv({ QUEUE_ENABLED: 'false' }); // skip the rabbit publish; the INSERT (stamp) still runs
  const { job_id } = await enqueueJob({
    project_id: P,
    actingPrincipalId: sys,
    job_type: 'index.run',
    payload: { root: '/some/global/root', root_authorized_by: '11111111-1111-1111-1111-111111111111' /* forged */ },
  });
  const row = await getDbPool().query<{ authby: string | null }>(
    `SELECT payload->>'root_authorized_by' AS authby FROM async_jobs WHERE job_id = $1`,
    [job_id],
  );
  assert.equal(row.rows[0].authby, sys, 'stamp is the real enqueuer (system), not the forged value');
});

test('enqueue: no payload.root → root_authorized_by is stripped (no forged stamp rides along)', async () => {
  await setEnv({ QUEUE_ENABLED: 'false' });
  const { job_id } = await enqueueJob({
    project_id: P,
    actingPrincipalId: sys,
    job_type: 'index.run',
    payload: { root_authorized_by: '11111111-1111-1111-1111-111111111111' /* forged, no root */ },
  });
  const row = await getDbPool().query<{ authby: string | null }>(
    `SELECT payload->>'root_authorized_by' AS authby FROM async_jobs WHERE job_id = $1`,
    [job_id],
  );
  assert.equal(row.rows[0].authby, null, 'no root ⇒ the stamp is stripped');
});

// ── end-to-end: a STORED (stamped) repo_root resolves through the worker with NO payload.root, proving
//    resolveRoot→resolveProjectRoot branch-2 wiring under enforcement [/review-impl #2] ──
test('exec: a stored stamped repo_root resolves end-to-end via the worker (no payload.root)', async () => {
  const pool = getDbPool();
  const SP = `${PREFIX}stored`;
  const tmp = await fs.mkdtemp(path.join(os.tmpdir(), 'd048-stored-'));
  try {
    await pool.query(`INSERT INTO projects (project_id, name) VALUES ($1,$1) ON CONFLICT DO NOTHING`, [SP]);
    // a global-stamped repo_root (empty dir → indexProject no-ops → 'ok' iff the stored root was honored)
    await pool.query(
      `INSERT INTO project_sources(project_id, source_type, repo_root, repo_root_authorized_by, enabled, updated_at)
       VALUES ($1,'local_workspace',$2,$3,true, now())`,
      [SP, tmp, sys],
    );
    const jobId = await seedJobFor(SP, {}); // index.run, NO payload.root → must resolve the stored root
    const res = await runJobById(jobId, { actingPrincipalId: sys });
    assert.equal(res.status, 'ok', `stored stamped repo_root must resolve via branch 2; got ${res.status}: ${res.error ?? ''}`);
  } finally {
    await pool.query(`DELETE FROM project_sources WHERE project_id=$1`, [SP]).catch(() => {});
    await pool.query(`DELETE FROM async_jobs WHERE project_id=$1`, [SP]).catch(() => {});
    await pool.query(`DELETE FROM projects WHERE project_id=$1`, [SP]).catch(() => {});
    await fs.rm(tmp, { recursive: true, force: true }).catch(() => {});
  }
});

// ── enqueue: cache_root is the same arbitrary-FS capability → gated like root [REVIEW-CODE #2] ──
test('enqueue: a NON-global principal setting payload.cache_root → BAD_REQUEST (no confused-deputy laundering)', async () => {
  await setEnv({ QUEUE_ENABLED: 'false' });
  await assert.rejects(
    enqueueJob({
      project_id: P,
      actingPrincipalId: projWriter, // write@P, NOT global
      job_type: 'repo.sync',
      payload: { git_url: 'https://example.com/x.git', cache_root: '/' },
    }),
    (e: unknown) => e instanceof ContextHubError && e.code === 'BAD_REQUEST',
  );
});

// ── DEFERRED-048 note: explicit hasGlobalGrant scope assertion ────────────────
test('hasGlobalGrant: a project-scope grant ⇒ false; the global-write system principal ⇒ true', async () => {
  assert.equal(await hasGlobalGrant(projWriter, 'write'), false, 'project-scope grant is NOT global');
  assert.equal(await hasGlobalGrant(sys, 'write'), true, 'the system principal holds global write');
});
