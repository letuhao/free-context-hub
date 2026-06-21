/**
 * Actor Data Boundary F2a — grants substrate CRUD (the delegation edges).
 *
 * F2a is JUST the substrate: shape/existence guards + idempotency. The delegation invariant
 * (granted_by must hold delegate covering the scope) is F2c; authorize() is F2b. Real DB.
 */

import assert from 'node:assert/strict';
import test, { before, after, beforeEach } from 'node:test';
import { validate as isUuid } from 'uuid';
import { createGrant, revokeGrant, listGrants, getGrant } from './grants.js';
import { createPrincipal } from './principals.js';
import { ContextHubError } from '../core/errors.js';
import { getDbPool } from '../db/client.js';

const PREFIX = '__test_grants__';

async function cleanup() {
  const pool = getDbPool();
  // Grants first (granted_by is ON DELETE RESTRICT), then the principals.
  await pool.query(
    `DELETE FROM grants WHERE grantee_principal IN (SELECT principal_id FROM principals WHERE display_name LIKE $1)
        OR granted_by IN (SELECT principal_id FROM principals WHERE display_name LIKE $1)`,
    [`${PREFIX}%`],
  );
  await pool.query(`DELETE FROM principals WHERE display_name LIKE $1`, [`${PREFIX}%`]);
}

let grantee: string;
let grantor: string;
before(async () => {
  await cleanup();
  grantee = (await createPrincipal({ kind: 'agent', display_name: `${PREFIX}grantee` })).principal_id;
  grantor = (await createPrincipal({ kind: 'agent', display_name: `${PREFIX}grantor` })).principal_id;
});
after(cleanup);

test('createGrant: project-scoped read grant — row shape', async () => {
  const g = await createGrant({ grantee_principal: grantee, scope_type: 'project', scope_id: 'projA', capability: 'read', granted_by: grantor });
  assert.ok(isUuid(g.grant_id));
  assert.equal(g.grantee_principal, grantee);
  assert.equal(g.scope_type, 'project');
  assert.equal(g.scope_id, 'projA');
  assert.equal(g.capability, 'read');
  assert.equal(g.granted_by, grantor);
  assert.equal(g.revoked_at, null);
});

test('createGrant: global grant has no scope_id', async () => {
  const g = await createGrant({ grantee_principal: grantee, scope_type: 'global', capability: 'admin', granted_by: grantor });
  assert.equal(g.scope_type, 'global');
  assert.equal(g.scope_id, null);
});

test('createGrant: global + scope_id supplied -> BAD_REQUEST (shape)', async () => {
  await assert.rejects(
    () => createGrant({ grantee_principal: grantee, scope_type: 'global', scope_id: 'nope', capability: 'read', granted_by: grantor }),
    (e: unknown) => e instanceof ContextHubError && e.code === 'BAD_REQUEST',
  );
});

test('createGrant: non-global without scope_id -> BAD_REQUEST (shape)', async () => {
  await assert.rejects(
    () => createGrant({ grantee_principal: grantee, scope_type: 'task', capability: 'write', granted_by: grantor }),
    (e: unknown) => e instanceof ContextHubError && e.code === 'BAD_REQUEST',
  );
});

test('createGrant: invalid capability / scope_type -> BAD_REQUEST', async () => {
  await assert.rejects(
    () => createGrant({ grantee_principal: grantee, scope_type: 'project', scope_id: 'p', capability: 'superuser' as never, granted_by: grantor }),
    (e: unknown) => e instanceof ContextHubError && e.code === 'BAD_REQUEST',
  );
  await assert.rejects(
    () => createGrant({ grantee_principal: grantee, scope_type: 'galaxy' as never, scope_id: 'p', capability: 'read', granted_by: grantor }),
    (e: unknown) => e instanceof ContextHubError && e.code === 'BAD_REQUEST',
  );
});

test('createGrant: malformed (non-UUID) grantee -> BAD_REQUEST, not a raw pg error', async () => {
  await assert.rejects(
    () => createGrant({ grantee_principal: 'not-a-uuid', scope_type: 'global', capability: 'read', granted_by: grantor }),
    (e: unknown) => e instanceof ContextHubError && e.code === 'BAD_REQUEST',
  );
});

test('createGrant: unknown grantee principal -> NOT_FOUND', async () => {
  await assert.rejects(
    () => createGrant({ grantee_principal: '00000000-0000-0000-0000-000000000000', scope_type: 'global', capability: 'read', granted_by: grantor }),
    (e: unknown) => e instanceof ContextHubError && e.code === 'NOT_FOUND',
  );
});

test('createGrant: idempotent — same edge twice returns ONE grant', async () => {
  const a = await createGrant({ grantee_principal: grantee, scope_type: 'project', scope_id: 'idem', capability: 'write', granted_by: grantor });
  const b = await createGrant({ grantee_principal: grantee, scope_type: 'project', scope_id: 'idem', capability: 'write', granted_by: grantor });
  assert.equal(a.grant_id, b.grant_id, 'same active edge -> same row, no duplicate');
  const rows = await listGrants({ grantee_principal: grantee, scope_type: 'project', scope_id: 'idem' });
  assert.equal(rows.filter((g) => g.capability === 'write').length, 1);
});

test('revokeGrant: sets revoked_at; idempotent; a re-grant of the same edge is allowed after revoke', async () => {
  const g = await createGrant({ grantee_principal: grantee, scope_type: 'topic', scope_id: 'tcycle', capability: 'read', granted_by: grantor });
  await revokeGrant(g.grant_id);
  const after = await getGrant(g.grant_id);
  assert.ok(after?.revoked_at, 'revoked_at set');
  await revokeGrant(g.grant_id); // idempotent — no throw
  // the unique active-edge index must not block re-granting the same edge once revoked
  const re = await createGrant({ grantee_principal: grantee, scope_type: 'topic', scope_id: 'tcycle', capability: 'read', granted_by: grantor });
  assert.notEqual(re.grant_id, g.grant_id, 'a fresh active grant after revoke');
});

test('revokeGrant: unknown grant id -> idempotent no-op (no throw)', async () => {
  await revokeGrant('00000000-0000-0000-0000-000000000000');
});

test('listGrants: filters by grantee, excludes revoked by default, include_revoked surfaces them', async () => {
  const g = await createGrant({ grantee_principal: grantee, scope_type: 'project', scope_id: 'lst', capability: 'admin', granted_by: grantor });
  await revokeGrant(g.grant_id);
  const active = await listGrants({ grantee_principal: grantee, scope_type: 'project', scope_id: 'lst' });
  assert.equal(active.length, 0, 'revoked grant excluded by default');
  const all = await listGrants({ grantee_principal: grantee, scope_type: 'project', scope_id: 'lst', include_revoked: true });
  assert.equal(all.length, 1, 'include_revoked surfaces it');
});
