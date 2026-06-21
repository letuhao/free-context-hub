/**
 * Actor Data Boundary F2f — adversary-pass regression: joinTopic's txn-2 induction read must forward
 * the caller's principal to replayEvents.
 *
 * joinTopic authorizes write@topic up front, then does a coherent induction read via
 * replayEvents(..., client). F2f migrated replayEvents to re-assert read@topic, but the joinTopic
 * caller was initially NOT updated — so under auth-ON the induction read denied with NO_PRINCIPAL →
 * NOT_FOUND, breaking EVERY authorized join after txn-1 had already committed the join writes. This
 * test charters + joins as a grant-covered principal under auth-ON and asserts the induction pack
 * returns (not NOT_FOUND). (Cold-start adversary finding, F2f domain 7 pass.)
 */

import assert from 'node:assert/strict';
import test, { before, after } from 'node:test';
import { charterTopic, joinTopic } from './topics.js';
import { createPrincipal } from './principals.js';
import { createGrant } from './grants.js';
import { ContextHubError } from '../core/errors.js';
import { getDbPool } from '../db/client.js';

const PREFIX = '__test_joininduction_authz__';
const P = `${PREFIX}projP`;

const isNotFound = (e: unknown) => e instanceof ContextHubError && e.code === 'NOT_FOUND';
const isForbidden = (e: unknown) => e instanceof ContextHubError && e.code === 'FORBIDDEN';

let actor: string;   // write@P (covers topics in P)
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
    `DELETE FROM coordination_events WHERE topic_id IN (SELECT topic_id FROM topics WHERE project_id = $1)`,
    [P],
  );
  await pool.query(`DELETE FROM topics WHERE project_id = $1`, [P]);
  await pool.query(`DELETE FROM actors WHERE project_id = $1`, [P]);
  await pool.query(
    `DELETE FROM grants WHERE grantee_principal IN (SELECT principal_id FROM principals WHERE display_name LIKE $1)
        OR granted_by IN (SELECT principal_id FROM principals WHERE display_name LIKE $1)`,
    [`${PREFIX}%`],
  );
  await pool.query(`DELETE FROM principals WHERE display_name LIKE $1`, [`${PREFIX}%`]);
}

before(async () => {
  await cleanup();
  actor = (await createPrincipal({ kind: 'agent', display_name: `${PREFIX}actor` })).principal_id;
  grantor = (await createPrincipal({ kind: 'agent', display_name: `${PREFIX}grantor` })).principal_id;
  await createGrant({ grantee_principal: actor, scope_type: 'project', scope_id: P, capability: 'write', granted_by: grantor });
  await setAuth(true);
});
after(async () => {
  await cleanup();
  if (saved.auth === undefined) delete process.env.MCP_AUTH_ENABLED;
  else process.env.MCP_AUTH_ENABLED = saved.auth;
  const { _resetEnvCacheForTest } = await import('../env.js');
  _resetEnvCacheForTest();
});

test('write@P actor: charter + join succeeds under auth-ON — induction pack returns, not NOT_FOUND', async () => {
  const t = await charterTopic({
    project_id: P, name: 'Induction Regression', charter: 'c', created_by: 'actor-A', actingPrincipalId: actor,
  });
  const pack = await joinTopic({
    topic_id: t.topic_id, actor_id: 'actor-A', actor_type: 'ai', display_name: 'Actor A',
    level: 'execution', actingPrincipalId: actor,
  });
  // The induction read (replayEvents in txn-2) resolved through the gate with the forwarded principal.
  assert.equal(pack.topic.status, 'active');
  assert.ok(pack.events.length >= 2, 'induction pack carries chartered + actor_joined events');
  assert.deepEqual(pack.events.map((e) => e.type), ['topic.chartered', 'topic.actor_joined']);
});

test('ungranted principal: joinTopic on a P topic → FORBIDDEN (outer write@topic gate)', async () => {
  const t = await charterTopic({
    project_id: P, name: 'Gate', charter: 'c', created_by: 'actor-A', actingPrincipalId: actor,
  });
  const stranger = (await createPrincipal({ kind: 'agent', display_name: `${PREFIX}stranger` })).principal_id;
  await assert.rejects(
    joinTopic({ topic_id: t.topic_id, actor_id: 'actor-Z', actor_type: 'ai', display_name: 'Z', level: 'execution', actingPrincipalId: stranger }),
    isForbidden,
  );
});

test('unknown principal: joinTopic → NOT_FOUND mapping is consistent (write deny on unresolved principal)', async () => {
  const t = await charterTopic({
    project_id: P, name: 'Unknown', charter: 'c', created_by: 'actor-A', actingPrincipalId: actor,
  });
  await assert.rejects(
    joinTopic({ topic_id: t.topic_id, actor_id: 'actor-U', actor_type: 'ai', display_name: 'U', level: 'execution', actingPrincipalId: '00000000-0000-0000-0000-000000000000' }),
    (e: unknown) => isForbidden(e) || isNotFound(e),
  );
});
