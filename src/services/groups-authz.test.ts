/**
 * Actor Data Boundary F2f — DEFERRED-046: project-group membership authorizes the GROUP, not just the
 * member project. A group IS a projects-table row, so it authorizes via the `project` kind.
 *
 * Splicing project P into group G widens cross-project knowledge flow (group ids fold into search scope),
 * so add/remove require write on BOTH the member project AND the group (strict-reject). createGroup needs
 * write@group; deleteGroup needs admin@group. This test proves a principal with write on the member
 * project but NO authority over the group is denied, while a group-authorized principal succeeds.
 */

import assert from 'node:assert/strict';
import test, { before, after } from 'node:test';
import { createGroup, deleteGroup, addProjectToGroup, removeProjectFromGroup, listGroupMembers } from './projectGroups.js';
import { createPrincipal } from './principals.js';
import { createGrant } from './grants.js';
import { ContextHubError } from '../core/errors.js';
import { getDbPool } from '../db/client.js';

const PREFIX = '__test_groups_authz__';
const P = `${PREFIX}projP`;   // member project
const G = `${PREFIX}groupG`;  // group (also a projects-table row)
const NG = `${PREFIX}newgrp`; // a group neither principal controls

const isForbidden = (e: unknown) => e instanceof ContextHubError && e.code === 'FORBIDDEN';

let gadmin: string;  // write@P + admin@G  (can create/add/remove/delete the group)
let pwriter: string; // write@P only       (can touch P but NOT the group)
let grantor: string;
const saved = { auth: process.env.MCP_AUTH_ENABLED };

async function setAuth(on: boolean) {
  process.env.MCP_AUTH_ENABLED = on ? 'true' : 'false';
  const { _resetEnvCacheForTest } = await import('../env.js');
  _resetEnvCacheForTest();
}
async function cleanup() {
  const pool = getDbPool();
  await pool.query(`DELETE FROM project_group_members WHERE group_id LIKE $1 OR project_id LIKE $1`, [`${PREFIX}%`]);
  await pool.query(`DELETE FROM project_groups WHERE group_id LIKE $1`, [`${PREFIX}%`]);
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
  gadmin = (await createPrincipal({ kind: 'agent', display_name: `${PREFIX}gadmin` })).principal_id;
  pwriter = (await createPrincipal({ kind: 'agent', display_name: `${PREFIX}pwriter` })).principal_id;
  grantor = (await createPrincipal({ kind: 'agent', display_name: `${PREFIX}grantor` })).principal_id;
  await createGrant({ grantee_principal: gadmin, scope_type: 'project', scope_id: P, capability: 'write', granted_by: grantor });
  await createGrant({ grantee_principal: gadmin, scope_type: 'project', scope_id: G, capability: 'admin', granted_by: grantor });
  await createGrant({ grantee_principal: pwriter, scope_type: 'project', scope_id: P, capability: 'write', granted_by: grantor });
  await setAuth(true);
});
after(async () => {
  await cleanup();
  if (saved.auth === undefined) delete process.env.MCP_AUTH_ENABLED;
  else process.env.MCP_AUTH_ENABLED = saved.auth;
  const { _resetEnvCacheForTest } = await import('../env.js');
  _resetEnvCacheForTest();
});

// ── the DEFERRED-046 fix: write on the member project is NOT enough to touch the group ──
test('pwriter (write@P, no group authority): createGroup → FORBIDDEN', async () => {
  await assert.rejects(createGroup({ group_id: NG, name: 'x', actingPrincipalId: pwriter }), isForbidden);
});
test('pwriter (write@P): addProjectToGroup(G, P) → FORBIDDEN (group gate denies)', async () => {
  await assert.rejects(addProjectToGroup(G, P, { actingPrincipalId: pwriter }), isForbidden);
});
test('pwriter (write@P): deleteGroup(G) → FORBIDDEN (needs admin@group)', async () => {
  await assert.rejects(deleteGroup(G, { actingPrincipalId: pwriter }), isForbidden);
});

// ── a group-authorized principal can run the full lifecycle ──
test('gadmin (write@P + admin@G): create → add → remove → delete the group', async () => {
  const g = await createGroup({ group_id: G, name: 'G', actingPrincipalId: gadmin });
  assert.equal(g.group_id, G);
  const added = await addProjectToGroup(G, P, { actingPrincipalId: gadmin });
  assert.equal(added.added, true);
  const removed = await removeProjectFromGroup(G, P, { actingPrincipalId: gadmin });
  assert.equal(removed.removed, true);
  const del = await deleteGroup(G, { actingPrincipalId: gadmin });
  assert.equal(del.deleted, true);
});

// ── the old "Group X not found" existence oracle is now gated by group authz ──
test('pwriter (write@P): addProjectToGroup to a non-existent group → FORBIDDEN, not a NOT_FOUND oracle', async () => {
  await assert.rejects(addProjectToGroup(NG, P, { actingPrincipalId: pwriter }), isForbidden);
});

// ── adversary-pass-2 fix: group composition reads are gated on read@group ──
test('pwriter (write@P, no read on group G): listGroupMembers(G) → NOT_FOUND', async () => {
  const isNotFound = (e: unknown) => e instanceof ContextHubError && e.code === 'NOT_FOUND';
  await assert.rejects(listGroupMembers(G, { actingPrincipalId: pwriter }), isNotFound);
});
