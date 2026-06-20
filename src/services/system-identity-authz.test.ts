/**
 * Actor Data Boundary F2g — the system-worker identity (the prerequisite that lets the background
 * worker survive the auth-ON flip). Proves, under auth-ON:
 *   1. the system principal (global-write grant) is ALLOWED write/read on ANY project — so worker jobs
 *      (index/embed/knowledge across projects) don't NO_PRINCIPAL-deny;
 *   2. it is BOUNDED — admin / delegate DENY (it is NOT root, the whole point of Option B);
 *   3. it passes runNextJob's unscoped global-grant gate where a project-scoped principal is rejected;
 *   4. hasUsableSystemIdentity() flips false when the covering grant is revoked (the enforce-ready
 *      gate's real signal), and back to true when restored.
 * Real DB + auth-ON toggling. The system + root principals are deployment singletons (seeded
 * idempotently here, NOT torn down); only PREFIX fixtures are cleaned.
 */

import assert from 'node:assert/strict';
import test, { before, after } from 'node:test';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { assertAuthorized } from './authorize.js';
import { runNextJob, runJobById } from './jobExecutor.js';
import { createPrincipal, getRootPrincipal, seedRootPrincipal, getSystemPrincipal } from './principals.js';
import { createGrant } from './grants.js';
import { bootstrapSystem, hasUsableSystemIdentity } from './bootstrap.js';
import { ContextHubError } from '../core/errors.js';
import { getDbPool } from '../db/client.js';

const PREFIX = '__test_sysident_authz__';
const P = `${PREFIX}projP`;

const isForbidden = (e: unknown) => e instanceof ContextHubError && e.code === 'FORBIDDEN';
const isNotFound = (e: unknown) => e instanceof ContextHubError && e.code === 'NOT_FOUND';
const isBadRequest = (e: unknown) => e instanceof ContextHubError && e.code === 'BAD_REQUEST';

let sys: string;        // the system-worker principal (global write)
let projWriter: string; // write@P only (project-scoped, NOT global)
let grantor: string;
const saved = { auth: process.env.MCP_AUTH_ENABLED };

async function setAuth(on: boolean) {
  process.env.MCP_AUTH_ENABLED = on ? 'true' : 'false';
  const { _resetEnvCacheForTest } = await import('../env.js');
  _resetEnvCacheForTest();
}
async function cleanupPrefix() {
  const pool = getDbPool();
  await pool.query(`DELETE FROM async_jobs WHERE project_id LIKE $1`, [`${PREFIX}%`]);
  // index.run writes chunks/files keyed by project_id — clear before the projects FK parent.
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

before(async () => {
  await cleanupPrefix();
  // Deployment singletons — seed idempotently, never torn down (cleanup is PREFIX-scoped).
  if (!(await getRootPrincipal())) await seedRootPrincipal({ display_name: 'root' });
  await bootstrapSystem(); // seeds the system-worker principal + its global-write grant (idempotent)
  sys = (await getSystemPrincipal())!.principal_id;

  grantor = (await createPrincipal({ kind: 'agent', display_name: `${PREFIX}grantor` })).principal_id;
  projWriter = (await createPrincipal({ kind: 'agent', display_name: `${PREFIX}projwriter` })).principal_id;
  await createGrant({ grantee_principal: projWriter, scope_type: 'project', scope_id: P, capability: 'write', granted_by: grantor });
  await setAuth(true);
});
after(async () => {
  await cleanupPrefix();
  if (saved.auth === undefined) delete process.env.MCP_AUTH_ENABLED;
  else process.env.MCP_AUTH_ENABLED = saved.auth;
  const { _resetEnvCacheForTest } = await import('../env.js');
  _resetEnvCacheForTest();
});

// ── 1. the worker identity is ALLOWED across projects (global write) ──
test('system principal: write on an arbitrary project → ALLOW (no NO_PRINCIPAL)', async () => {
  await assert.doesNotReject(assertAuthorized(sys, 'write', { kind: 'project', id: P }));
  await assert.doesNotReject(assertAuthorized(sys, 'write', { kind: 'project', id: `${PREFIX}other` }));
});
test('system principal: read on an arbitrary project → ALLOW', async () => {
  await assert.doesNotReject(assertAuthorized(sys, 'read', { kind: 'project', id: P }));
});

// ── 2. BOUNDED: it is NOT root — admin / delegate are denied (the Option-B guarantee) ──
test('system principal: admin@global → DENY (global-write does not cover admin)', async () => {
  await assert.rejects(assertAuthorized(sys, 'admin', { kind: 'global' }), isForbidden);
});
test('system principal: delegate@global → DENY (no delegate grant; bounded, not root)', async () => {
  await assert.rejects(assertAuthorized(sys, 'delegate', { kind: 'global' }), isForbidden);
});

// ── 3. runNextJob's unscoped global gate: system passes; a project-scoped principal does not ──
// This is the worker's PRIMARY poll-loop path (worker.ts: runNextJob(queue, undefined, {system})).
// It exercises the global `hasGlobalGrant(system)` branch — which the project_id-bearing job tests
// below never reach (they take the write@project branch).
test('runNextJob unscoped drain with the system principal → passes the global gate (NOT BAD_REQUEST)', async () => {
  // Unique empty queue: the gate (hasGlobalGrant) runs BEFORE the claim, so this exercises the global
  // branch yet deterministically returns idle — without popping a foreign job off the shared 'default'
  // queue. A dropped/insufficient system grant would BAD_REQUEST here, breaking the worker's poll loop.
  const res = await runNextJob(`${PREFIX}unq`, undefined, { actingPrincipalId: sys });
  assert.equal(res.status, 'idle', 'global gate passed (hasGlobalGrant(system)=true) and the unique queue is empty');
});
test('runNextJob unscoped drain with a project-scoped principal → BAD_REQUEST (not globally privileged)', async () => {
  await assert.rejects(runNextJob('default', undefined, { actingPrincipalId: projWriter }), isBadRequest);
});
test('runNextJob scoped to a project the principal cannot write → FORBIDDEN', async () => {
  await assert.rejects(runNextJob('default', `${PREFIX}foreign`, { actingPrincipalId: projWriter }), isForbidden);
});

// ── 3b. END-TO-END: the system identity actually carries through executeByType into a guarded leaf.
// A real index.run job (empty temp dir → indexProject no-ops, no embedder) MUST run without an authz
// denial. If executeByType ever dropped actingPrincipalId, indexProject's write@project would
// NO_PRINCIPAL-deny under auth-ON and surface as an authz error — this is the regression guard the
// "idle" check could not provide. Also exercises the runJobById gate (the rabbit/by-id path).
// Seed a queued async_jobs row WITHOUT enqueueJob's rabbitmq publish (unreachable in the unit env).
async function seedQueuedJob(projectId: string, jobType: string, payload: Record<string, unknown>): Promise<string> {
  const r = await getDbPool().query<{ job_id: string }>(
    `INSERT INTO async_jobs(job_id, project_id, job_type, queue_name, payload, status, max_attempts, available_at, queued_at)
     VALUES (gen_random_uuid(), $1, $2, 'default', $3::jsonb, 'queued', 1, now(), now()) RETURNING job_id`,
    [projectId, jobType, JSON.stringify(payload)],
  );
  return r.rows[0].job_id;
}

test('runJobById(index.run) under the system identity → executes with NO authz denial (threading proof)', async () => {
  const pool = getDbPool();
  const idxProj = `${PREFIX}idxproj`;
  const tmp = await fs.mkdtemp(path.join(os.tmpdir(), 'f2g-idx-'));
  try {
    await pool.query(`INSERT INTO projects (project_id, name) VALUES ($1,$1) ON CONFLICT DO NOTHING`, [idxProj]);
    const jobId = await seedQueuedJob(idxProj, 'index.run', { root: tmp });
    const res = await runJobById(jobId, { actingPrincipalId: sys });
    // ok (empty dir indexed) — or a non-authz error (e.g. embedder/network). NEVER an authz denial.
    if (res.status === 'error') {
      // Match ONLY the authz denial shapes (assertAuthorized throws 'not authorized to <action> this
      // resource' / exactly 'not found'), not an incidental "...not found" from some other subsystem.
      assert.doesNotMatch(String(res.error ?? ''), /not authorized to|^not found$|NO_PRINCIPAL/i, res.error);
    } else {
      assert.equal(res.status, 'ok');
    }
  } finally {
    await fs.rm(tmp, { recursive: true, force: true }).catch(() => {});
  }
});
test('runJobById(index.run) with a principal that cannot write the job project → FORBIDDEN up front (gate)', async () => {
  const pool = getDbPool();
  const idxProj = `${PREFIX}idxproj2`;
  await pool.query(`INSERT INTO projects (project_id, name) VALUES ($1,$1) ON CONFLICT DO NOTHING`, [idxProj]);
  const jobId = await seedQueuedJob(idxProj, 'index.run', { root: '/tmp/none' });
  // projWriter holds write@P, NOT write@idxProj → the runJobById gate denies before executeByType.
  await assert.rejects(runJobById(jobId, { actingPrincipalId: projWriter }), isForbidden);
});

// ── 4. hasUsableSystemIdentity is the enforce-ready signal: revoke the grant → false → restore ──
test('hasUsableSystemIdentity: true when present, false when the global-write grant is revoked', async () => {
  assert.equal(await hasUsableSystemIdentity(), true);
  const pool = getDbPool();
  await pool.query(
    `UPDATE grants SET revoked_at = now()
       WHERE grantee_principal = $1 AND scope_type = 'global' AND capability IN ('write','admin') AND revoked_at IS NULL`,
    [sys],
  );
  try {
    assert.equal(await hasUsableSystemIdentity(), false);
  } finally {
    // restore the singleton's grant so the worker / other suites stay healthy
    await pool.query(
      `UPDATE grants SET revoked_at = NULL
         WHERE grantee_principal = $1 AND scope_type = 'global' AND capability IN ('write','admin')`,
      [sys],
    );
  }
  assert.equal(await hasUsableSystemIdentity(), true);
});

// ── unknown principal stays denied (sanity: the gate isn't trivially open) ──
test('unknown principal: write@project → FORBIDDEN; read@project → NOT_FOUND', async () => {
  const ghost = '00000000-0000-0000-0000-000000000000';
  await assert.rejects(assertAuthorized(ghost, 'write', { kind: 'project', id: P }), isForbidden);
  await assert.rejects(assertAuthorized(ghost, 'read', { kind: 'project', id: P }), isNotFound);
});
