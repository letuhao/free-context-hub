/**
 * Actor Data Boundary F2f — DEFERRED-047 read-sweep: auth-ON enforcement for the project-read surfaces
 * that NEVER had a callerScope guard (so the domain-by-domain rollout was structurally blind to them).
 *
 * Wave 1 — clean project-scoped readers: activity.listActivity, auditLog.listAuditLog/getAuditStats,
 * analytics.* (getRetrievalStats et al.), agentTrust.getAgentTrust/listAgents/updateAgentTrust. Each now
 * asserts FIRST: reads → read@project (cross-tenant → NOT_FOUND; multi-project strict-reject),
 * updateAgentTrust → write@project (cross-tenant → FORBIDDEN). Real DB + auth-ON toggling.
 */

import assert from 'node:assert/strict';
import test, { before, after } from 'node:test';
import { listActivity } from './activity.js';
import { listAuditLog, getAuditStats } from './auditLog.js';
import { getRetrievalStats, getLessonsByType, getAgentActivity } from './analytics.js';
import { getAgentTrust, listAgents, updateAgentTrust } from './agentTrust.js';
import { createPrincipal } from './principals.js';
import { createGrant } from './grants.js';
import { ContextHubError } from '../core/errors.js';
import { getDbPool } from '../db/client.js';

const PREFIX = '__test_readsweep_authz__';
const P = `${PREFIX}projP`;
const Q = `${PREFIX}projQ`;

const isNotFound = (e: unknown) => e instanceof ContextHubError && e.code === 'NOT_FOUND';
const isForbidden = (e: unknown) => e instanceof ContextHubError && e.code === 'FORBIDDEN';

let reader: string;  // read@P
let writer: string;  // write@P
let grantor: string;
const saved = { auth: process.env.MCP_AUTH_ENABLED };

async function setAuth(on: boolean) {
  process.env.MCP_AUTH_ENABLED = on ? 'true' : 'false';
  const { _resetEnvCacheForTest } = await import('../env.js');
  _resetEnvCacheForTest();
}
async function cleanup() {
  const pool = getDbPool();
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
  grantor = (await createPrincipal({ kind: 'agent', display_name: `${PREFIX}grantor` })).principal_id;
  await createGrant({ grantee_principal: reader, scope_type: 'project', scope_id: P, capability: 'read', granted_by: grantor });
  await createGrant({ grantee_principal: writer, scope_type: 'project', scope_id: P, capability: 'write', granted_by: grantor });
  await setAuth(true);
});
after(async () => {
  await cleanup();
  if (saved.auth === undefined) delete process.env.MCP_AUTH_ENABLED;
  else process.env.MCP_AUTH_ENABLED = saved.auth;
  const { _resetEnvCacheForTest } = await import('../env.js');
  _resetEnvCacheForTest();
});

// ── reads: cross-tenant project Q → NOT_FOUND ────────────────────────────────
test('reader@P: listActivity cross-tenant → NOT_FOUND', async () => {
  await assert.rejects(listActivity({ projectId: Q, actingPrincipalId: reader }), isNotFound);
});
test('reader@P: listAuditLog cross-tenant → NOT_FOUND', async () => {
  await assert.rejects(listAuditLog({ projectId: Q, actingPrincipalId: reader }), isNotFound);
});
test('reader@P: getAuditStats cross-tenant → NOT_FOUND', async () => {
  await assert.rejects(getAuditStats(Q, { actingPrincipalId: reader }), isNotFound);
});
test('reader@P: getRetrievalStats cross-tenant → NOT_FOUND', async () => {
  await assert.rejects(getRetrievalStats({ projectId: Q, actingPrincipalId: reader }), isNotFound);
});
test('reader@P: getLessonsByType cross-tenant → NOT_FOUND', async () => {
  await assert.rejects(getLessonsByType({ projectId: Q, actingPrincipalId: reader }), isNotFound);
});
test('reader@P: getAgentActivity cross-tenant → NOT_FOUND', async () => {
  await assert.rejects(getAgentActivity({ projectId: Q, actingPrincipalId: reader }), isNotFound);
});
test('reader@P: getAgentTrust cross-tenant → NOT_FOUND', async () => {
  await assert.rejects(getAgentTrust({ agentId: 'a', projectId: Q, actingPrincipalId: reader }), isNotFound);
});
test('reader@P: listAgents cross-tenant → NOT_FOUND', async () => {
  await assert.rejects(listAgents({ projectId: Q, actingPrincipalId: reader }), isNotFound);
});

// ── multi-project strict-reject ──────────────────────────────────────────────
test('reader@P: listAuditLog multi (P,Q) → NOT_FOUND (strict-reject)', async () => {
  await assert.rejects(listAuditLog({ projectIds: [P, Q], actingPrincipalId: reader }), isNotFound);
});
test('reader@P: getRetrievalStats multi (P,Q) → NOT_FOUND (strict-reject)', async () => {
  await assert.rejects(getRetrievalStats({ projectIds: [P, Q], actingPrincipalId: reader }), isNotFound);
});

// ── write: updateAgentTrust cross-tenant → FORBIDDEN + over-capability ────────
test('writer@P: updateAgentTrust cross-tenant → FORBIDDEN', async () => {
  await assert.rejects(updateAgentTrust({ agentId: 'a', projectId: Q, actingPrincipalId: writer, trustLevel: 'trusted' }), isForbidden);
});
test('reader@P: updateAgentTrust on own project (read ⊅ write) → FORBIDDEN', async () => {
  await assert.rejects(updateAgentTrust({ agentId: 'a', projectId: P, actingPrincipalId: reader, trustLevel: 'trusted' }), isForbidden);
});

// ── allow + unknown ──────────────────────────────────────────────────────────
test('reader@P: listActivity on P → ALLOW (resolves through the gate)', async () => {
  const res = await listActivity({ projectId: P, actingPrincipalId: reader });
  assert.ok(Array.isArray(res.items));
});
test('reader@P: getAuditStats on P → ALLOW', async () => {
  const res = await getAuditStats(P, { actingPrincipalId: reader });
  assert.equal(typeof res.total_actions, 'number');
});
test('unknown principal: listAuditLog on P → NOT_FOUND', async () => {
  await assert.rejects(listAuditLog({ projectId: P, actingPrincipalId: '00000000-0000-0000-0000-000000000000' }), isNotFound);
});
