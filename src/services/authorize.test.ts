/**
 * Actor Data Boundary F2b — authorize() async wrapper: resolver (task→topic→project), the deny
 * ladder, the auth-OFF fast path, and best-effort decision logging. Real DB + env toggling.
 */

import assert from 'node:assert/strict';
import test, { before, after, beforeEach } from 'node:test';
import { authorize, resolveResourceScope, explainAuthorization } from './authorize.js';
import { createPrincipal, getRootPrincipal } from './principals.js';
import { createGrant } from './grants.js';
import { getDbPool } from '../db/client.js';

const PREFIX = '__test_authz__';
const P = `${PREFIX}projP`;
const Q = `${PREFIX}projQ`;

async function cleanup() {
  const pool = getDbPool();
  await pool.query(`DELETE FROM authz_decisions WHERE principal_id IN (SELECT principal_id::text FROM principals WHERE display_name LIKE $1)`, [`${PREFIX}%`]);
  await pool.query(`DELETE FROM tasks WHERE topic_id LIKE $1`, [`${PREFIX}%`]);
  await pool.query(`DELETE FROM topics WHERE topic_id LIKE $1 OR project_id LIKE $1`, [`${PREFIX}%`]);
  await pool.query(
    `DELETE FROM grants WHERE grantee_principal IN (SELECT principal_id FROM principals WHERE display_name LIKE $1)
        OR granted_by IN (SELECT principal_id FROM principals WHERE display_name LIKE $1)`,
    [`${PREFIX}%`],
  );
  await pool.query(`DELETE FROM principals WHERE display_name LIKE $1`, [`${PREFIX}%`]);
}

let resetEnv: () => void;
const saved = { auth: process.env.MCP_AUTH_ENABLED };
async function setAuth(on: boolean) {
  process.env.MCP_AUTH_ENABLED = on ? 'true' : 'false';
  ({ _resetEnvCacheForTest: resetEnv } = await import('../env.js'));
  resetEnv();
}

// shared fixtures
let actor: string;      // active non-root principal
let grantor: string;
let topicP: string;     // topic in project P
let topicQ: string;     // topic in project Q
let taskP: string;      // task under topicP

before(async () => {
  await cleanup();
  actor = (await createPrincipal({ kind: 'agent', display_name: `${PREFIX}actor` })).principal_id;
  grantor = (await createPrincipal({ kind: 'agent', display_name: `${PREFIX}grantor` })).principal_id;
  const pool = getDbPool();
  topicP = `${PREFIX}topP`;
  topicQ = `${PREFIX}topQ`;
  await pool.query(`INSERT INTO topics (topic_id, project_id, name, charter, created_by) VALUES ($1,$2,'n','c',$3)`, [topicP, P, grantor]);
  await pool.query(`INSERT INTO topics (topic_id, project_id, name, charter, created_by) VALUES ($1,$2,'n','c',$3)`, [topicQ, Q, grantor]);
  const tr = await pool.query<{ task_id: string }>(
    `INSERT INTO tasks (topic_id, title, topology, status, created_by) VALUES ($1,'t','parallel','posted',$2) RETURNING task_id`,
    [topicP, grantor],
  );
  taskP = tr.rows[0].task_id;
});
after(async () => {
  await cleanup();
  if (saved.auth === undefined) delete process.env.MCP_AUTH_ENABLED; else process.env.MCP_AUTH_ENABLED = saved.auth;
  const { _resetEnvCacheForTest } = await import('../env.js');
  _resetEnvCacheForTest();
});

// "does not log" assertions scope to a UNIQUE resource_id marker (never a global count) — node:test
// runs files concurrently and other suites write authz_decisions, so a global before/after delta is
// non-deterministic. A per-marker count is exact.
test('auth-OFF: authorize is a pass-through ALLOW/AUTH_DISABLED with no DB write', async () => {
  await setAuth(false);
  const marker = `${PREFIX}marker_off`;
  const d = await authorize(null, 'admin', { kind: 'project', id: marker });
  assert.deepEqual(d, { allow: true, reason: 'AUTH_DISABLED' });
  const n = (await getDbPool().query(`SELECT count(*)::int n FROM authz_decisions WHERE resource_id=$1`, [marker])).rows[0].n;
  assert.equal(n, 0, 'auth-off does not log');
});

test('resolveResourceScope: walks task -> topic -> project', async () => {
  const r = await resolveResourceScope({ kind: 'task', id: taskP });
  assert.deepEqual(r, { ok: { kind: 'task', project_id: P, topic_id: topicP, task_id: taskP } });
  const rt = await resolveResourceScope({ kind: 'topic', id: topicP });
  assert.deepEqual(rt, { ok: { kind: 'topic', project_id: P, topic_id: topicP } });
});

test('resolveResourceScope: unknown / malformed ids are unresolvable (no oracle, no 22P02)', async () => {
  assert.deepEqual(await resolveResourceScope({ kind: 'topic', id: `${PREFIX}nope` }), { unresolvable: 'NOT_FOUND' });
  assert.deepEqual(await resolveResourceScope({ kind: 'task', id: 'not-a-uuid' }), { unresolvable: 'NOT_FOUND' });
  assert.deepEqual(await resolveResourceScope({ kind: 'task', id: '00000000-0000-0000-0000-000000000000' }), { unresolvable: 'NOT_FOUND' });
});

test('auth-ON: null principal -> NO_PRINCIPAL (and logged)', async () => {
  await setAuth(true);
  const d = await authorize(null, 'read', { kind: 'project', id: P });
  assert.deepEqual(d, { allow: false, reason: 'NO_PRINCIPAL' });
  const row = (await getDbPool().query(`SELECT allow, reason FROM authz_decisions WHERE principal_id IS NULL AND action='read' ORDER BY ts DESC LIMIT 1`)).rows[0];
  assert.equal(row.allow, false);
  assert.equal(row.reason, 'NO_PRINCIPAL');
});

test('auth-ON: a covering project grant ALLOWs read on a topic AND a task in that project', async () => {
  await setAuth(true);
  await createGrant({ grantee_principal: actor, scope_type: 'project', scope_id: P, capability: 'read', granted_by: grantor });
  const onTopic = await authorize(actor, 'read', { kind: 'topic', id: topicP });
  assert.equal(onTopic.allow, true);
  assert.equal(onTopic.reason, 'GRANT');
  const onTask = await authorize(actor, 'read', { kind: 'task', id: taskP });
  assert.equal(onTask.allow, true, 'project grant covers the task via the resolved chain');
});

test('auth-ON: read grant does NOT cover a write, nor a sibling project', async () => {
  await setAuth(true);
  // actor holds read@project:P (from the prior test ran in same file? isolate by re-granting idempotently)
  await createGrant({ grantee_principal: actor, scope_type: 'project', scope_id: P, capability: 'read', granted_by: grantor });
  const wr = await authorize(actor, 'write', { kind: 'topic', id: topicP });
  assert.deepEqual(wr, { allow: false, reason: 'NO_COVERING_GRANT' }, 'read does not cover write');
  const sibling = await authorize(actor, 'read', { kind: 'topic', id: topicQ });
  assert.deepEqual(sibling, { allow: false, reason: 'NO_COVERING_GRANT' }, 'project P grant does not reach project Q');
});

test('auth-ON: inactive principal -> PRINCIPAL_INACTIVE without leaking resource existence', async () => {
  await setAuth(true);
  const sus = (await createPrincipal({ kind: 'agent', display_name: `${PREFIX}sus` })).principal_id;
  const { setPrincipalStatus } = await import('./principals.js');
  await setPrincipalStatus(sus, 'suspended');
  // even pointing at a NON-existent resource, the answer is PRINCIPAL_INACTIVE (resource not resolved)
  const d = await authorize(sus, 'read', { kind: 'topic', id: `${PREFIX}doesNotExist` });
  assert.deepEqual(d, { allow: false, reason: 'PRINCIPAL_INACTIVE' });
});

test('auth-ON: active principal + unresolvable resource -> OUT_OF_SCOPE', async () => {
  await setAuth(true);
  const d = await authorize(actor, 'read', { kind: 'task', id: '00000000-0000-0000-0000-000000000000' });
  assert.deepEqual(d, { allow: false, reason: 'OUT_OF_SCOPE' });
});

test('auth-ON: root principal short-circuits ALLOW (if a root exists)', async (t) => {
  await setAuth(true);
  const root = await getRootPrincipal();
  if (!root) { t.skip('no root principal in this DB (run bootstrap:root) — pure decide test covers the logic'); return; }
  const d = await authorize(root.principal_id, 'admin', { kind: 'global' });
  assert.deepEqual(d, { allow: true, reason: 'ROOT' });
});

test('auth-ON: a decision is logged with action + resource + matched grant', async () => {
  await setAuth(true);
  await createGrant({ grantee_principal: actor, scope_type: 'project', scope_id: P, capability: 'admin', granted_by: grantor });
  const d = await authorize(actor, 'admin', { kind: 'project', id: P });
  assert.equal(d.allow, true);
  const row = (await getDbPool().query(
    `SELECT action, resource_kind, resource_id, allow, reason, matched_grant_id
       FROM authz_decisions WHERE principal_id=$1 AND action='admin' ORDER BY ts DESC LIMIT 1`,
    [actor],
  )).rows[0];
  assert.equal(row.resource_kind, 'project');
  assert.equal(row.resource_id, P);
  assert.equal(row.allow, true);
  assert.equal(row.reason, 'GRANT');
  assert.ok(row.matched_grant_id, 'matched grant id recorded on allow');
});

test('explainAuthorization: read-only — never writes a decision log row', async () => {
  await setAuth(true);
  const marker = `${PREFIX}marker_explain`;
  const r = await explainAuthorization(actor, 'read', { kind: 'project', id: marker });
  assert.ok('allow' in r.decision);
  const n = (await getDbPool().query(`SELECT count(*)::int n FROM authz_decisions WHERE resource_id=$1`, [marker])).rows[0].n;
  assert.equal(n, 0, 'explain must not log');
});

test('explainAuthorization: returns the resolved scope_chain + matching decision', async () => {
  await setAuth(true);
  await createGrant({ grantee_principal: actor, scope_type: 'project', scope_id: P, capability: 'read', granted_by: grantor });
  const r = await explainAuthorization(actor, 'read', { kind: 'task', id: taskP });
  assert.equal(r.decision.allow, true);
  assert.deepEqual(r.scope_chain, { kind: 'task', project_id: P, topic_id: topicP, task_id: taskP });
});

test('auth-ON: a global grant authorizes a global resource; delegate flows end-to-end [review-impl #5]', async () => {
  await setAuth(true);
  const gp = (await createPrincipal({ kind: 'agent', display_name: `${PREFIX}globalholder` })).principal_id;
  await createGrant({ grantee_principal: gp, scope_type: 'global', capability: 'admin', granted_by: grantor });
  const d = await authorize(gp, 'admin', { kind: 'global' });
  assert.equal(d.allow, true);
  assert.equal(d.reason, 'GRANT');
  const dp = (await createPrincipal({ kind: 'agent', display_name: `${PREFIX}delegholder` })).principal_id;
  await createGrant({ grantee_principal: dp, scope_type: 'project', scope_id: P, capability: 'delegate', granted_by: grantor });
  const del = await authorize(dp, 'delegate', { kind: 'project', id: P });
  assert.equal(del.allow, true, 'delegate capability authorizes the delegate action end-to-end');
});

test('authorize: logs the origin discriminator (access by default) [review-impl #3]', async () => {
  await setAuth(true);
  const marker = `${PREFIX}originmark`;
  await authorize(actor, 'read', { kind: 'project', id: marker });
  const row = (await getDbPool().query(`SELECT origin FROM authz_decisions WHERE resource_id=$1 ORDER BY ts DESC LIMIT 1`, [marker])).rows[0];
  assert.equal(row.origin, 'access');
});

test('authorize: a decision-log WRITE FAILURE does not alter the decision (never fail-open) [review-impl #1]', async () => {
  await setAuth(true);
  const client = await getDbPool().connect();
  try {
    await client.query('BEGIN');
    await client.query('ALTER TABLE authz_decisions RENAME TO authz_decisions_tmp'); // make the log INSERT fail
    const d = await authorize(null, 'read', { kind: 'project', id: P }, client);
    assert.deepEqual(d, { allow: false, reason: 'NO_PRINCIPAL' }, 'decision returned despite the log INSERT failing');
  } finally {
    await client.query('ROLLBACK').catch(() => {});
    client.release();
  }
});

test('authorize: a grant-LOAD error PROPAGATES (fail closed, never a silent allow) [review-impl #1]', async () => {
  await setAuth(true);
  const client = await getDbPool().connect();
  try {
    await client.query('BEGIN');
    await client.query('ALTER TABLE grants RENAME TO grants_tmp'); // break the grant lookup
    await assert.rejects(() => authorize(actor, 'read', { kind: 'project', id: P }, client), 'a grant-load failure must reject, not allow');
  } finally {
    await client.query('ROLLBACK').catch(() => {});
    client.release();
  }
});

test('explainAuthorization: a DENY does NOT leak the resolved scope chain (no ancestry oracle) [F2-adv #3]', async () => {
  await setAuth(true);
  // actor has no grant covering topicQ (sibling project Q) -> deny. scope_chain must be null so the
  // caller can't learn topicQ exists / its project from an explain it isn't allowed.
  const r = await explainAuthorization(actor, 'admin', { kind: 'topic', id: topicQ });
  assert.equal(r.decision.allow, false);
  assert.equal(r.scope_chain, null, 'deny must not expose the resolved ancestry');
});

test('explainAuthorization: auth-off -> AUTH_DISABLED, null chain, no log', async () => {
  await setAuth(false);
  const marker = `${PREFIX}marker_explain_off`;
  const r = await explainAuthorization(actor, 'admin', { kind: 'project', id: marker });
  assert.deepEqual(r, { decision: { allow: true, reason: 'AUTH_DISABLED' }, scope_chain: null });
  const n = (await getDbPool().query(`SELECT count(*)::int n FROM authz_decisions WHERE resource_id=$1`, [marker])).rows[0].n;
  assert.equal(n, 0);
});
