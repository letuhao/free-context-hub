/**
 * Actor Data Boundary F2f domain 3 (decisions) — auth-ON cross-actor enforcement.
 *
 * decisionBodies/motions/proxies/requests/intake/disputes lost their assertBodyScope/assertMotionScope/
 * assertDisputeScope/assertRequestScope/assertIntakeScope/assertCallerScope guards; authorize() + grants
 * is the gate. A principal granted READ on project P is denied OUTSIDE its grants (cross-tenant body/
 * intake read → NOT_FOUND) and ABOVE its capability (createBody/addBodyMember admin, secondMotion
 * write → FORBIDDEN). Exercises the F2f entity resolvers: body/intake → project, motion → topic (a
 * project-P grant covers a topic-in-P resource via the lattice). Real DB + auth-ON toggling.
 */

import assert from 'node:assert/strict';
import test, { before, after } from 'node:test';
import { createBody, addBodyMember, getBody, listBodies } from './decisionBodies.js';
import { getMotion, secondMotion } from './motions.js';
import { submitIntake, listIntake, getIntake } from './intake.js';
import { createPrincipal } from './principals.js';
import { createGrant } from './grants.js';
import { ContextHubError } from '../core/errors.js';
import { getDbPool } from '../db/client.js';

const PREFIX = '__test_decisions_authz__';
const P = `${PREFIX}projP`;
const Q = `${PREFIX}projQ`;

const isNotFound = (e: unknown) => e instanceof ContextHubError && e.code === 'NOT_FOUND';
const isForbidden = (e: unknown) => e instanceof ContextHubError && e.code === 'FORBIDDEN';

let reader: string; // granted read@P only
let grantor: string;
let bodyP: string;
let bodyQ: string;
let topicP: string;
let motionP: string;
const saved = { auth: process.env.MCP_AUTH_ENABLED };

async function setAuth(on: boolean) {
  process.env.MCP_AUTH_ENABLED = on ? 'true' : 'false';
  const { _resetEnvCacheForTest } = await import('../env.js');
  _resetEnvCacheForTest();
}

async function cleanup() {
  const pool = getDbPool();
  await pool.query(`DELETE FROM motions WHERE topic_id LIKE $1`, [`${PREFIX}%`]);
  await pool.query(`DELETE FROM body_members WHERE body_id IN (SELECT body_id FROM decision_bodies WHERE project_id LIKE $1)`, [`${PREFIX}%`]);
  await pool.query(`DELETE FROM decision_bodies WHERE project_id LIKE $1`, [`${PREFIX}%`]);
  await pool.query(`DELETE FROM topics WHERE topic_id LIKE $1 OR project_id LIKE $1`, [`${PREFIX}%`]);
  await pool.query(
    `DELETE FROM grants WHERE grantee_principal IN (SELECT principal_id FROM principals WHERE display_name LIKE $1)
        OR granted_by IN (SELECT principal_id FROM principals WHERE display_name LIKE $1)`,
    [`${PREFIX}%`],
  );
  await pool.query(`DELETE FROM principals WHERE display_name LIKE $1`, [`${PREFIX}%`]);
}

before(async () => {
  await cleanup();
  const pool = getDbPool();
  reader = (await createPrincipal({ kind: 'agent', display_name: `${PREFIX}reader` })).principal_id;
  grantor = (await createPrincipal({ kind: 'agent', display_name: `${PREFIX}grantor` })).principal_id;
  await createGrant({ grantee_principal: reader, scope_type: 'project', scope_id: P, capability: 'read', granted_by: grantor });

  const bp = await pool.query<{ body_id: string }>(
    `INSERT INTO decision_bodies (project_id, name, threshold, created_by) VALUES ($1,'bp',0.5,$2) RETURNING body_id`,
    [P, grantor],
  );
  bodyP = bp.rows[0].body_id;
  const bq = await pool.query<{ body_id: string }>(
    `INSERT INTO decision_bodies (project_id, name, threshold, created_by) VALUES ($1,'bq',0.5,$2) RETURNING body_id`,
    [Q, grantor],
  );
  bodyQ = bq.rows[0].body_id;

  topicP = `${PREFIX}topP`;
  await pool.query(`INSERT INTO topics (topic_id, project_id, name, charter, created_by) VALUES ($1,$2,'n','c',$3)`, [topicP, P, grantor]);
  const m = await pool.query<{ motion_id: string }>(
    `INSERT INTO motions (body_id, topic_id, subject_ref, proposed_by, deadline)
     VALUES ($1,$2,'ref',$3, now() + interval '1 day') RETURNING motion_id`,
    [bodyP, topicP, grantor],
  );
  motionP = m.rows[0].motion_id;

  await setAuth(true);
});
after(async () => {
  await cleanup();
  if (saved.auth === undefined) delete process.env.MCP_AUTH_ENABLED;
  else process.env.MCP_AUTH_ENABLED = saved.auth;
  const { _resetEnvCacheForTest } = await import('../env.js');
  _resetEnvCacheForTest();
});

test('reader@P: createBody ADMIN cross-tenant (project Q) → FORBIDDEN', async () => {
  await assert.rejects(
    createBody({ project_id: Q, actingPrincipalId: reader, name: 'x', quorum: 0, threshold: 0.5, created_by: 'a' }),
    isForbidden,
  );
});

test('reader@P: createBody ADMIN on own project (read ⊅ admin) → FORBIDDEN', async () => {
  await assert.rejects(
    createBody({ project_id: P, actingPrincipalId: reader, name: 'x', quorum: 0, threshold: 0.5, created_by: 'a' }),
    isForbidden,
  );
});

test('reader@P: listBodies READ cross-tenant (project Q) → NOT_FOUND', async () => {
  await assert.rejects(listBodies({ project_id: Q, actingPrincipalId: reader }), isNotFound);
});

test('reader@P: getBody READ cross-tenant (body in Q, via body→project resolver) → NOT_FOUND', async () => {
  await assert.rejects(getBody({ body_id: bodyQ, actingPrincipalId: reader }), isNotFound);
});

test('reader@P: addBodyMember ADMIN on a body in P (read ⊅ admin) → FORBIDDEN', async () => {
  await assert.rejects(
    addBodyMember({ body_id: bodyP, actingPrincipalId: reader, actor_id: 'm1', vote_weight: 1 }),
    isForbidden,
  );
});

test('reader@P: getMotion READ (motion→topic resolver; project-P grant covers topic-in-P) → ALLOW', async () => {
  const m = await getMotion({ motion_id: motionP, actingPrincipalId: reader });
  assert.equal(m?.motion_id, motionP);
});

test('reader@P: secondMotion WRITE (read ⊅ write) → FORBIDDEN', async () => {
  await assert.rejects(
    secondMotion({ motion_id: motionP, actingPrincipalId: reader, actor_id: 'a1' }),
    isForbidden,
  );
});

test('reader@P: submitIntake WRITE cross-tenant (project Q) → FORBIDDEN', async () => {
  await assert.rejects(
    submitIntake({ project_id: Q, actingPrincipalId: reader, kind: 'suggestion', body: 'b', submitted_by: 'a' }),
    isForbidden,
  );
});

test('reader@P: listIntake READ cross-tenant (project Q) → NOT_FOUND', async () => {
  await assert.rejects(listIntake(Q, { actingPrincipalId: reader }), isNotFound);
});

test('reader@P: getIntake on a non-existent intake → NOT_FOUND (resolver unresolvable, no oracle)', async () => {
  await assert.rejects(
    getIntake('00000000-0000-0000-0000-000000000000', { actingPrincipalId: reader }),
    isNotFound,
  );
});

test('reader@P: getBody READ on a body in P → ALLOW (resolves through the gate)', async () => {
  const b = await getBody({ body_id: bodyP, actingPrincipalId: reader });
  assert.equal(b?.body_id, bodyP);
});

test('unknown principal: getBody READ → NOT_FOUND', async () => {
  await assert.rejects(
    getBody({ body_id: bodyP, actingPrincipalId: '00000000-0000-0000-0000-000000000000' }),
    isNotFound,
  );
});
