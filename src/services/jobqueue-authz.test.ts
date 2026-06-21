/**
 * Actor Data Boundary F2f — DEFERRED-045: jobQueue actor-native SEC-1/3/5/6.
 *
 * The legacy guard used callerScope as a DATA value (auto-bind project_id, block payload.root for
 * scoped callers). The actor model has no single "caller scope", so:
 *  - enqueueJob/cancelJob require write@project; project_id is REQUIRED unless the principal is GLOBALLY
 *    privileged (global-write grant or root). payload.root (arbitrary filesystem access) is a GLOBAL
 *    capability — only a globally-privileged principal may pass it (SEC-6).
 *  - listJobs requires read@project per filter (strict-reject); NO filter ⇒ all-projects read, allowed
 *    ONLY for a globally-privileged principal (closes SEC-1's WHERE 1=1).
 * Real DB + auth-ON toggling. (Replaces the DEFERRED-029 jobQueue cases in d3-scope.test.ts.)
 */

import assert from 'node:assert/strict';
import test, { before, after } from 'node:test';
import { enqueueJob, listJobs, cancelJob } from './jobQueue.js';
import { runNextJob } from './jobExecutor.js';
import { createPrincipal } from './principals.js';
import { createGrant } from './grants.js';
import { ContextHubError } from '../core/errors.js';
import { getDbPool } from '../db/client.js';

const PREFIX = '__test_jobqueue_authz__';
const P = `${PREFIX}projP`;
const Q = `${PREFIX}projQ`;
const UUID = '11111111-1111-1111-1111-111111111111';

const isNotFound = (e: unknown) => e instanceof ContextHubError && e.code === 'NOT_FOUND';
const isForbidden = (e: unknown) => e instanceof ContextHubError && e.code === 'FORBIDDEN';
const isBadRequest = (e: unknown) => e instanceof ContextHubError && e.code === 'BAD_REQUEST';

let reader: string;   // read@P
let writer: string;   // write@P (project-scoped, NOT global)
let gwriter: string;  // global write (globally privileged)
let grantor: string;
const saved = { auth: process.env.MCP_AUTH_ENABLED };

async function setAuth(on: boolean) {
  process.env.MCP_AUTH_ENABLED = on ? 'true' : 'false';
  const { _resetEnvCacheForTest } = await import('../env.js');
  _resetEnvCacheForTest();
}
async function cleanup() {
  const pool = getDbPool();
  await pool.query(`DELETE FROM async_jobs WHERE project_id LIKE $1`, [`${PREFIX}%`]);
  await pool.query(`DELETE FROM projects WHERE project_id LIKE $1`, [`${PREFIX}%`]);
  await pool.query(
    `DELETE FROM grants WHERE grantee_principal IN (SELECT principal_id FROM principals WHERE display_name LIKE $1)
        OR granted_by IN (SELECT principal_id FROM principals WHERE display_name LIKE $1)`,
    [`${PREFIX}%`],
  );
  await pool.query(`DELETE FROM principals WHERE display_name LIKE $1`, [`${PREFIX}%`]);
}

before(async () => {
  await cleanup();
  reader = (await createPrincipal({ kind: 'agent', display_name: `${PREFIX}reader` })).principal_id;
  writer = (await createPrincipal({ kind: 'agent', display_name: `${PREFIX}writer` })).principal_id;
  gwriter = (await createPrincipal({ kind: 'agent', display_name: `${PREFIX}gwriter` })).principal_id;
  grantor = (await createPrincipal({ kind: 'agent', display_name: `${PREFIX}grantor` })).principal_id;
  await createGrant({ grantee_principal: reader, scope_type: 'project', scope_id: P, capability: 'read', granted_by: grantor });
  await createGrant({ grantee_principal: writer, scope_type: 'project', scope_id: P, capability: 'write', granted_by: grantor });
  await createGrant({ grantee_principal: gwriter, scope_type: 'global', scope_id: null, capability: 'write', granted_by: grantor });
  // async_jobs.project_id has an FK to projects — seed P so the global-principal enqueue can insert.
  await getDbPool().query(`INSERT INTO projects (project_id, name) VALUES ($1, $1) ON CONFLICT DO NOTHING`, [P]);
  await setAuth(true);
});
after(async () => {
  await cleanup();
  if (saved.auth === undefined) delete process.env.MCP_AUTH_ENABLED;
  else process.env.MCP_AUTH_ENABLED = saved.auth;
  const { _resetEnvCacheForTest } = await import('../env.js');
  _resetEnvCacheForTest();
});

// ── enqueueJob ───────────────────────────────────────────────────────────────
test('writer@P: enqueueJob cross-tenant project → FORBIDDEN', async () => {
  await assert.rejects(enqueueJob({ project_id: Q, actingPrincipalId: writer, job_type: 'index.run', payload: {} }), isForbidden);
});
test('writer@P (non-global): enqueueJob with NO project_id → BAD_REQUEST (SEC-3)', async () => {
  await assert.rejects(enqueueJob({ actingPrincipalId: writer, job_type: 'index.run', payload: {} }), isBadRequest);
});
test('writer@P (non-global): enqueueJob with payload.root → BAD_REQUEST (SEC-6)', async () => {
  await assert.rejects(
    enqueueJob({ project_id: P, actingPrincipalId: writer, job_type: 'index.run', payload: { root: '/tmp/evil' } }),
    isBadRequest,
  );
});
test('gwriter (global): enqueueJob with payload.root on P → ALLOW (passes the gate; no SEC denial)', async () => {
  // The global grant passes both write@P AND the payload.root (SEC-6) gate. Past the gate, the enqueue
  // hits the DB/queue backend (rabbitmq is not up in the unit env → ENOTFOUND) — either outcome proves
  // no FORBIDDEN/BAD_REQUEST authz denial.
  try {
    const res = await enqueueJob({ project_id: P, actingPrincipalId: gwriter, job_type: 'index.run', payload: { root: '/tmp/ok' } });
    assert.equal(res.status, 'queued');
  } catch (e) {
    assert.ok(!isForbidden(e) && !isBadRequest(e), `expected a non-authz error past the gate, got ${String(e)}`);
  }
});

// ── listJobs ─────────────────────────────────────────────────────────────────
test('reader@P: listJobs cross-tenant → NOT_FOUND', async () => {
  await assert.rejects(listJobs({ projectId: Q, actingPrincipalId: reader }), isNotFound);
});
test('reader@P: listJobs multi (P,Q) → NOT_FOUND (strict-reject)', async () => {
  await assert.rejects(listJobs({ projectIds: [P, Q], actingPrincipalId: reader }), isNotFound);
});
test('reader@P (non-global): listJobs with NO filter → BAD_REQUEST (SEC-1, no WHERE 1=1)', async () => {
  await assert.rejects(listJobs({ actingPrincipalId: reader }), isBadRequest);
});
test('reader@P: listJobs on P → ALLOW', async () => {
  const res = await listJobs({ projectId: P, actingPrincipalId: reader });
  assert.ok(Array.isArray(res.items));
});
test('gwriter (global): listJobs with NO filter → ALLOW (globally privileged sees all)', async () => {
  const res = await listJobs({ actingPrincipalId: gwriter });
  assert.ok(Array.isArray(res.items));
});

// ── cancelJob ────────────────────────────────────────────────────────────────
test('writer@P: cancelJob cross-tenant → FORBIDDEN', async () => {
  await assert.rejects(cancelJob(UUID, Q, { actingPrincipalId: writer }), isForbidden);
});
test('writer@P (non-global): cancelJob with NO projectId → BAD_REQUEST (SEC-5)', async () => {
  await assert.rejects(cancelJob(UUID, undefined, { actingPrincipalId: writer }), isBadRequest);
});
test('unknown principal: enqueueJob on P → FORBIDDEN (write deny on resolvable project)', async () => {
  await assert.rejects(
    enqueueJob({ project_id: P, actingPrincipalId: '00000000-0000-0000-0000-000000000000', job_type: 'index.run', payload: {} }),
    isForbidden,
  );
});

// ── adversary-pass-2 fix: runNextJob (the execute path) is gated ──────────────
test('reader@P (non-global): runNextJob unscoped drain → BAD_REQUEST (no ungated all-projects execute)', async () => {
  await assert.rejects(runNextJob('default', undefined, { actingPrincipalId: reader }), isBadRequest);
});
test('writer@P: runNextJob scoped to cross-tenant project → FORBIDDEN', async () => {
  await assert.rejects(runNextJob('default', Q, { actingPrincipalId: writer }), isForbidden);
});
