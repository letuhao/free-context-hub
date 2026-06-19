/**
 * Actor Data Boundary F2c — the delegation invariant. grant_capability: you may grant capability C
 * at scope S only if you hold `delegate` AND C (or higher) at a scope COVERING S (no upward/sideways,
 * no granting more than you hold). revoke_grant: granter, or admin/delegate over the scope, or root.
 * Real DB + auth-ON.
 */

import assert from 'node:assert/strict';
import test, { before, after } from 'node:test';
import { grantCapability, revokeGrantAuthorized } from './grantCapability.js';
import { createPrincipal, getRootPrincipal } from './principals.js';
import { createGrant, listGrants, getGrant } from './grants.js';
import { ContextHubError } from '../core/errors.js';
import { getDbPool } from '../db/client.js';

const PREFIX = '__test_grantcap__';
const P = `${PREFIX}P`;
const Q = `${PREFIX}Q`;

async function cleanup() {
  const pool = getDbPool();
  await pool.query(`DELETE FROM authz_decisions WHERE principal_id IN (SELECT principal_id::text FROM principals WHERE display_name LIKE $1)`, [`${PREFIX}%`]);
  await pool.query(
    `DELETE FROM grants WHERE grantee_principal IN (SELECT principal_id FROM principals WHERE display_name LIKE $1)
        OR granted_by IN (SELECT principal_id FROM principals WHERE display_name LIKE $1)`,
    [`${PREFIX}%`],
  );
  await pool.query(`DELETE FROM topics WHERE topic_id LIKE $1 OR project_id LIKE $1`, [`${PREFIX}%`]);
  await pool.query(`DELETE FROM principals WHERE display_name LIKE $1`, [`${PREFIX}%`]);
}

let resetEnv: () => void;
const saved = { auth: process.env.MCP_AUTH_ENABLED };
async function authOn() {
  process.env.MCP_AUTH_ENABLED = 'true';
  ({ _resetEnvCacheForTest: resetEnv } = await import('../env.js'));
  resetEnv();
}

let actor: string;     // grantee
let delegator: string; // holds various grants in setup
let topicInP: string;  // a real topic under project P (grant targets must resolve)
before(async () => {
  await cleanup();
  await authOn();
  actor = (await createPrincipal({ kind: 'agent', display_name: `${PREFIX}actor` })).principal_id;
  delegator = (await createPrincipal({ kind: 'agent', display_name: `${PREFIX}delegator` })).principal_id;
  topicInP = `${PREFIX}topicInP`;
  await getDbPool().query(
    `INSERT INTO topics (topic_id, project_id, name, charter, created_by) VALUES ($1,$2,'n','c',$3)`,
    [topicInP, P, delegator],
  );
});
after(async () => {
  await cleanup();
  if (saved.auth === undefined) delete process.env.MCP_AUTH_ENABLED; else process.env.MCP_AUTH_ENABLED = saved.auth;
  const { _resetEnvCacheForTest } = await import('../env.js');
  _resetEnvCacheForTest();
});

test('grant_capability: a delegate-holder grants WITHIN its subtree + capability (delegate+write -> can grant read on a child scope)', async () => {
  // delegator holds delegate@project:P and write@project:P
  await createGrant({ grantee_principal: delegator, scope_type: 'project', scope_id: P, capability: 'delegate', granted_by: delegator });
  await createGrant({ grantee_principal: delegator, scope_type: 'project', scope_id: P, capability: 'write', granted_by: delegator });
  // grants read@topic (a child of P) — needs delegate (yes) + read (write covers read) covering topic (project covers topic)
  const g = await grantCapability({ callerPrincipalId: delegator, grantee_principal: actor, scope_type: 'topic', scope_id: topicInP, capability: 'read' });
  assert.equal(g.capability, 'read');
  assert.equal(g.granted_by, delegator, 'grant attributed to the delegating caller');
});

test('grant_capability: cannot grant MORE than you hold (delegate+read, but tries to grant admin) -> FORBIDDEN', async () => {
  const d2 = (await createPrincipal({ kind: 'agent', display_name: `${PREFIX}d2` })).principal_id;
  await createGrant({ grantee_principal: d2, scope_type: 'project', scope_id: P, capability: 'delegate', granted_by: d2 });
  await createGrant({ grantee_principal: d2, scope_type: 'project', scope_id: P, capability: 'read', granted_by: d2 });
  await assert.rejects(
    () => grantCapability({ callerPrincipalId: d2, grantee_principal: actor, scope_type: 'project', scope_id: P, capability: 'admin' }),
    (e: unknown) => e instanceof ContextHubError && e.code === 'FORBIDDEN',
  );
});

test('grant_capability: holding the capability but NOT delegate -> FORBIDDEN (no re-grant flag)', async () => {
  const d3 = (await createPrincipal({ kind: 'agent', display_name: `${PREFIX}d3` })).principal_id;
  await createGrant({ grantee_principal: d3, scope_type: 'project', scope_id: P, capability: 'admin', granted_by: d3 });
  // has admin (covers write) but no delegate
  await assert.rejects(
    () => grantCapability({ callerPrincipalId: d3, grantee_principal: actor, scope_type: 'project', scope_id: P, capability: 'write' }),
    (e: unknown) => e instanceof ContextHubError && e.code === 'FORBIDDEN',
  );
});

test('grant_capability: cannot grant SIDEWAYS/UPWARD out of subtree (delegate@project:P, grant at project:Q or global) -> FORBIDDEN', async () => {
  const d4 = (await createPrincipal({ kind: 'agent', display_name: `${PREFIX}d4` })).principal_id;
  await createGrant({ grantee_principal: d4, scope_type: 'project', scope_id: P, capability: 'delegate', granted_by: d4 });
  await createGrant({ grantee_principal: d4, scope_type: 'project', scope_id: P, capability: 'admin', granted_by: d4 });
  await assert.rejects(
    () => grantCapability({ callerPrincipalId: d4, grantee_principal: actor, scope_type: 'project', scope_id: Q, capability: 'read' }),
    (e: unknown) => e instanceof ContextHubError && e.code === 'FORBIDDEN',
  );
  await assert.rejects(
    () => grantCapability({ callerPrincipalId: d4, grantee_principal: actor, scope_type: 'global', capability: 'read' }),
    (e: unknown) => e instanceof ContextHubError && e.code === 'FORBIDDEN',
  );
});

test('grant_capability: root may grant anything (short-circuit) — if a root exists', async () => {
  const root = await getRootPrincipal();
  if (!root) return;
  const g = await grantCapability({ callerPrincipalId: root.principal_id, grantee_principal: actor, scope_type: 'global', capability: 'admin' });
  assert.equal(g.capability, 'admin');
  assert.equal(g.scope_type, 'global');
  await getDbPool().query(`DELETE FROM grants WHERE grant_id = $1`, [g.grant_id]); // local cleanup (global scope, no prefix)
});

test('revoke_grant: the granter may revoke their own grant', async () => {
  const g = await createGrant({ grantee_principal: actor, scope_type: 'project', scope_id: P, capability: 'read', granted_by: delegator });
  const r = await revokeGrantAuthorized({ callerPrincipalId: delegator, grant_id: g.grant_id });
  assert.equal(r.status, 'revoked');
  assert.ok((await getGrant(g.grant_id))?.revoked_at);
});

test('revoke_grant: a stranger without admin/delegate over the scope -> FORBIDDEN', async () => {
  const g = await createGrant({ grantee_principal: actor, scope_type: 'project', scope_id: P, capability: 'read', granted_by: delegator });
  const stranger = (await createPrincipal({ kind: 'agent', display_name: `${PREFIX}stranger` })).principal_id;
  await assert.rejects(
    () => revokeGrantAuthorized({ callerPrincipalId: stranger, grant_id: g.grant_id }),
    (e: unknown) => e instanceof ContextHubError && e.code === 'FORBIDDEN',
  );
});

test('revoke_grant: an admin over the scope (not the granter) may revoke', async () => {
  const g = await createGrant({ grantee_principal: actor, scope_type: 'project', scope_id: P, capability: 'read', granted_by: delegator });
  const adminP = (await createPrincipal({ kind: 'agent', display_name: `${PREFIX}admin` })).principal_id;
  await createGrant({ grantee_principal: adminP, scope_type: 'project', scope_id: P, capability: 'admin', granted_by: adminP });
  const r = await revokeGrantAuthorized({ callerPrincipalId: adminP, grant_id: g.grant_id });
  assert.equal(r.status, 'revoked');
});

test('revoke_grant: unknown grant id -> idempotent noop (no leak, no throw)', async () => {
  const r = await revokeGrantAuthorized({ callerPrincipalId: delegator, grant_id: '00000000-0000-0000-0000-000000000000' });
  assert.equal(r.status, 'noop');
});
