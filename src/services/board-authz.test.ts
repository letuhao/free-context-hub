/**
 * Actor Data Boundary F2f domain 2 (coordination board) — auth-ON cross-actor enforcement.
 *
 * The board's assertTopicScope/assertTaskScope/assertArtifactScope/assertCallerScope guards are gone;
 * authorize() + grants is now the gate. A principal granted READ on project P is denied OUTSIDE its
 * grants (cross-tenant topic/lease read → NOT_FOUND) and ABOVE its capability (task/artifact/lease
 * write → FORBIDDEN). Also exercises the F2f artifact→task resolver. Real DB + auth-ON toggling
 * (node runs each test FILE in its own process, so the env flip is isolated).
 */

import assert from 'node:assert/strict';
import test, { before, after } from 'node:test';
import { getTopic } from './topics.js';
import { listBoard, claimTask } from './board.js';
import { writeArtifact } from './artifacts.js';
import { claimArtifact, listActiveClaims } from './artifactLeases.js';
import { createPrincipal } from './principals.js';
import { createGrant } from './grants.js';
import { ContextHubError } from '../core/errors.js';
import { getDbPool } from '../db/client.js';

const PREFIX = '__test_board_authz__';
const P = `${PREFIX}projP`;
const Q = `${PREFIX}projQ`;

const isNotFound = (e: unknown) => e instanceof ContextHubError && e.code === 'NOT_FOUND';
const isForbidden = (e: unknown) => e instanceof ContextHubError && e.code === 'FORBIDDEN';

let reader: string; // granted read@P only
let grantor: string;
let topicP: string;
let topicQ: string;
let taskP: string;
let artifactP: string;

async function cleanup() {
  const pool = getDbPool();
  await pool.query(`DELETE FROM artifacts WHERE topic_id LIKE $1`, [`${PREFIX}%`]);
  await pool.query(`DELETE FROM tasks WHERE topic_id LIKE $1`, [`${PREFIX}%`]);
  await pool.query(`DELETE FROM topics WHERE topic_id LIKE $1 OR project_id LIKE $1`, [`${PREFIX}%`]);
  await pool.query(
    `DELETE FROM grants WHERE grantee_principal IN (SELECT principal_id FROM principals WHERE display_name LIKE $1)
        OR granted_by IN (SELECT principal_id FROM principals WHERE display_name LIKE $1)`,
    [`${PREFIX}%`],
  );
  await pool.query(`DELETE FROM principals WHERE display_name LIKE $1`, [`${PREFIX}%`]);
}

async function setAuth(on: boolean) {
  process.env.MCP_AUTH_ENABLED = on ? 'true' : 'false';
  const { _resetEnvCacheForTest } = await import('../env.js');
  _resetEnvCacheForTest();
}
const saved = { auth: process.env.MCP_AUTH_ENABLED };

before(async () => {
  await cleanup();
  const pool = getDbPool();
  reader = (await createPrincipal({ kind: 'agent', display_name: `${PREFIX}reader` })).principal_id;
  grantor = (await createPrincipal({ kind: 'agent', display_name: `${PREFIX}grantor` })).principal_id;
  await createGrant({ grantee_principal: reader, scope_type: 'project', scope_id: P, capability: 'read', granted_by: grantor });

  topicP = `${PREFIX}topP`;
  topicQ = `${PREFIX}topQ`;
  await pool.query(`INSERT INTO topics (topic_id, project_id, name, charter, created_by) VALUES ($1,$2,'n','c',$3)`, [topicP, P, grantor]);
  await pool.query(`INSERT INTO topics (topic_id, project_id, name, charter, created_by) VALUES ($1,$2,'n','c',$3)`, [topicQ, Q, grantor]);
  const tr = await pool.query<{ task_id: string }>(
    `INSERT INTO tasks (topic_id, title, topology, status, created_by) VALUES ($1,'t','parallel','posted',$2) RETURNING task_id`,
    [topicP, grantor],
  );
  taskP = tr.rows[0].task_id;
  artifactP = `${topicP}:${taskP}:slotA`;
  await pool.query(
    `INSERT INTO artifacts (artifact_id, topic_id, task_id, slot, kind) VALUES ($1,$2,$3,'slotA','doc')`,
    [artifactP, topicP, taskP],
  );

  await setAuth(true);
});
after(async () => {
  await cleanup();
  if (saved.auth === undefined) delete process.env.MCP_AUTH_ENABLED;
  else process.env.MCP_AUTH_ENABLED = saved.auth;
  const { _resetEnvCacheForTest } = await import('../env.js');
  _resetEnvCacheForTest();
});

test('reader@P: cross-tenant topic READ (topic in Q) → NOT_FOUND', async () => {
  await assert.rejects(getTopic({ topic_id: topicQ, actingPrincipalId: reader }), isNotFound);
  await assert.rejects(listBoard({ topic_id: topicQ, actingPrincipalId: reader }), isNotFound);
});

test('reader@P: task WRITE on its own project (read ⊅ write) → FORBIDDEN', async () => {
  await assert.rejects(
    claimTask({ task_id: taskP, actingPrincipalId: reader, actor_id: 'a1' }),
    isForbidden,
  );
});

test('reader@P: artifact WRITE (resolver walks artifact→task→P) over read → FORBIDDEN', async () => {
  await assert.rejects(
    writeArtifact({ artifact_id: artifactP, actingPrincipalId: reader, claim_id: 'c', fencing_token: 1, content_ref: 'r', actor_id: 'a1' }),
    isForbidden,
  );
});

test('reader@P: project-scoped lease WRITE cross-tenant (project Q) → FORBIDDEN', async () => {
  await assert.rejects(
    claimArtifact({ project_id: Q, actingPrincipalId: reader, agent_id: 'a1', artifact_type: 'lesson', artifact_id: 'x', task_description: 't' }),
    isForbidden,
  );
});

test('reader@P: project-scoped lease READ cross-tenant (project Q) → NOT_FOUND', async () => {
  await assert.rejects(listActiveClaims({ project_id: Q, actingPrincipalId: reader }), isNotFound);
});

test('reader@P: granted topic READ on P resolves through the gate', async () => {
  const tr = await getTopic({ topic_id: topicP, actingPrincipalId: reader });
  assert.equal(tr.topic.topic_id, topicP);
});

test('unknown principal: topic READ → NOT_FOUND', async () => {
  await assert.rejects(
    getTopic({ topic_id: topicP, actingPrincipalId: '00000000-0000-0000-0000-000000000000' }),
    isNotFound,
  );
});
