/**
 * Actor Data Boundary F2e — backfill grants from api_keys role/scope + the enforce-ready coverage
 * count. Real DB. Needs a root (grant origin); seeds a throwaway one under the shared ROOT_TEST_LOCK
 * if the DB has none. backfill mutates global state, so tests pass restrictToPrincipals to touch only
 * their own rows.
 */

import assert from 'node:assert/strict';
import test, { before, after, beforeEach } from 'node:test';
import type { PoolClient } from 'pg';
import { backfillGrantsFromApiKeys, countCredentialsWithoutGrants } from './backfillGrants.js';
import { createPrincipal, seedRootPrincipal, getRootPrincipal } from './principals.js';
import { createApiKey } from './apiKeys.js';
import { listGrants, createGrant, revokeGrant } from './grants.js';
import { getDbPool } from '../db/client.js';

const PREFIX = '__test_backfill__';

async function cleanup() {
  const pool = getDbPool();
  await pool.query(
    `DELETE FROM grants WHERE grantee_principal IN (SELECT principal_id FROM principals WHERE display_name LIKE $1)
        OR granted_by IN (SELECT principal_id FROM principals WHERE display_name LIKE $1)`,
    [`${PREFIX}%`],
  );
  await pool.query(`DELETE FROM api_keys WHERE name LIKE $1`, [`${PREFIX}%`]);
  await pool.query(`DELETE FROM principals WHERE display_name LIKE $1`, [`${PREFIX}%`]);
}

const ROOT_TEST_LOCK = 0x1c0b0064;
let rootLockClient: PoolClient | undefined;

// backfill needs a root (granted_by). Clean, then re-ensure a throwaway PREFIX root if the DB has
// none (cleanup deletes the PREFIX root, so this must run after every cleanup). A real (non-PREFIX)
// root is left untouched and used as-is.
async function cleanupAndEnsureRoot() {
  await cleanup();
  if (!(await getRootPrincipal())) {
    await seedRootPrincipal({ display_name: `${PREFIX}root` });
  }
}

before(async () => {
  rootLockClient = await getDbPool().connect();
  await rootLockClient.query('SELECT pg_advisory_lock($1)', [ROOT_TEST_LOCK]);
  await cleanupAndEnsureRoot();
});
after(async () => {
  await cleanup();
  if (rootLockClient) {
    await rootLockClient.query('SELECT pg_advisory_unlock($1)', [ROOT_TEST_LOCK]).catch(() => {});
    rootLockClient.release();
    rootLockClient = undefined;
  }
});
beforeEach(cleanupAndEnsureRoot);

test('backfill: a bound key with no grant is counted, then gets its mapped grant (writer+P -> write@project:P)', async () => {
  const p = (await createPrincipal({ kind: 'agent', display_name: `${PREFIX}p1` })).principal_id;
  await createApiKey({ name: `${PREFIX}k1`, role: 'writer', project_scope: 'projX', principal_id: p });

  assert.ok((await countCredentialsWithoutGrants(undefined, { restrictToPrincipals: [p] })) >= 1, 'counted before backfill');
  assert.equal((await listGrants({ grantee_principal: p })).length, 0);

  const res = await backfillGrantsFromApiKeys(undefined, { restrictToPrincipals: [p] });
  assert.equal(res.created, 1);

  const g = await listGrants({ grantee_principal: p });
  assert.equal(g.length, 1);
  assert.equal(g[0].capability, 'write');
  assert.equal(g[0].scope_type, 'project');
  assert.equal(g[0].scope_id, 'projX');

  assert.equal(await countCredentialsWithoutGrants(undefined, { restrictToPrincipals: [p] }), 0, 'covered after backfill');
});

test('backfill: role/scope mapping (admin+NULL -> admin@global; reader+P -> read@project:P) + idempotent', async () => {
  const a = (await createPrincipal({ kind: 'agent', display_name: `${PREFIX}adminp` })).principal_id;
  await createApiKey({ name: `${PREFIX}ka`, role: 'admin', principal_id: a }); // null scope -> global
  const r = (await createPrincipal({ kind: 'agent', display_name: `${PREFIX}readerp` })).principal_id;
  await createApiKey({ name: `${PREFIX}kr`, role: 'reader', project_scope: 'projY', principal_id: r });

  await backfillGrantsFromApiKeys(undefined, { restrictToPrincipals: [a, r] });

  const ag = await listGrants({ grantee_principal: a });
  assert.equal(ag[0].capability, 'admin');
  assert.equal(ag[0].scope_type, 'global');
  assert.equal(ag[0].scope_id, null);

  const rg = await listGrants({ grantee_principal: r });
  assert.equal(rg[0].capability, 'read');
  assert.equal(rg[0].scope_type, 'project');
  assert.equal(rg[0].scope_id, 'projY');

  // idempotent — re-run leaves exactly one grant each
  await backfillGrantsFromApiKeys(undefined, { restrictToPrincipals: [a, r] });
  assert.equal((await listGrants({ grantee_principal: a })).length, 1);
  assert.equal((await listGrants({ grantee_principal: r })).length, 1);
});

test('backfill: a revoked or expired credential is NOT counted/backfilled (only live credentials)', async () => {
  const p = (await createPrincipal({ kind: 'agent', display_name: `${PREFIX}exp` })).principal_id;
  await createApiKey({ name: `${PREFIX}kexp`, role: 'writer', project_scope: 'projZ', principal_id: p, expires_at: '2000-01-01T00:00:00Z' });
  assert.equal(await countCredentialsWithoutGrants(undefined, { restrictToPrincipals: [p] }), 0, 'expired credential is not a lockout risk');
  const res = await backfillGrantsFromApiKeys(undefined, { restrictToPrincipals: [p] });
  assert.equal(res.created, 0);
  assert.equal((await listGrants({ grantee_principal: p })).length, 0);
});

test('coverage gap: a writer@P key with only an unrelated read@Q grant is UNCOVERED (existence != coverage) [F2-adv2 #1]', async () => {
  const root = await getRootPrincipal();
  const p = (await createPrincipal({ kind: 'agent', display_name: `${PREFIX}cov1` })).principal_id;
  await createApiKey({ name: `${PREFIX}kcov1`, role: 'writer', project_scope: 'projP', principal_id: p });
  // an unrelated grant that the OLD existence check would have accepted as "covered"
  await createGrant({ grantee_principal: p, scope_type: 'project', scope_id: 'projQ', capability: 'read', granted_by: root!.principal_id });

  assert.equal(await countCredentialsWithoutGrants(undefined, { restrictToPrincipals: [p] }), 1, 'read@Q does not cover write@P');
  await backfillGrantsFromApiKeys(undefined, { restrictToPrincipals: [p] });
  assert.equal(await countCredentialsWithoutGrants(undefined, { restrictToPrincipals: [p] }), 0, 'covered after backfill');
  const g = await listGrants({ grantee_principal: p, scope_type: 'project', scope_id: 'projP' });
  assert.equal(g[0].capability, 'write');
});

test('coverage: a reader@P key already covered by a broader admin@global grant is NOT re-minted [F2-adv2 #1]', async () => {
  const root = await getRootPrincipal();
  const p = (await createPrincipal({ kind: 'agent', display_name: `${PREFIX}cov2` })).principal_id;
  await createApiKey({ name: `${PREFIX}kcov2`, role: 'reader', project_scope: 'projP', principal_id: p });
  await createGrant({ grantee_principal: p, scope_type: 'global', capability: 'admin', granted_by: root!.principal_id });

  assert.equal(await countCredentialsWithoutGrants(undefined, { restrictToPrincipals: [p] }), 0, 'admin@global covers reader@project:P');
  const res = await backfillGrantsFromApiKeys(undefined, { restrictToPrincipals: [p] });
  assert.equal(res.created, 0, 'no redundant grant minted when already covered by a broader grant');
});

test('backfill does NOT resurrect a deliberately-revoked grant on re-run [F2-adv2 #5]', async () => {
  const p = (await createPrincipal({ kind: 'agent', display_name: `${PREFIX}resurrect` })).principal_id;
  await createApiKey({ name: `${PREFIX}kres`, role: 'writer', project_scope: 'projR', principal_id: p });
  const first = await backfillGrantsFromApiKeys(undefined, { restrictToPrincipals: [p] });
  assert.equal(first.created, 1);

  const g = (await listGrants({ grantee_principal: p }))[0];
  await revokeGrant(g.grant_id); // operator deliberately removes it

  const second = await backfillGrantsFromApiKeys(undefined, { restrictToPrincipals: [p] });
  assert.equal(second.created, 0, 'did not re-mint');
  assert.equal(second.skippedRevoked, 1, 'reported as deliberately-revoked');
  assert.equal((await listGrants({ grantee_principal: p })).length, 0, 'no active grant resurrected');
});

test('backfill: an unbound (principal_id NULL) key is excluded structurally (no principal to grant)', async () => {
  const { entry } = await createApiKey({ name: `${PREFIX}unbound`, role: 'writer' }); // no principal_id
  assert.equal(entry.principal_id, null);
  // a global backfill restricted to no specific principals would process all eligible; the unbound
  // key never appears (the JOIN on principals drops it), so it can mint no grant.
  const res = await backfillGrantsFromApiKeys(undefined, { restrictToPrincipals: ['00000000-0000-0000-0000-000000000000'] });
  assert.equal(res.created, 0);
});
