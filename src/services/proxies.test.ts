/**
 * Phase 15 Sprint 15.11 — proxies service unit tests (DEFERRED-017 Q3).
 *
 * Covers grant (principal-only authz), revoke, list, and the castVote proxy
 * verification gated behind MCP_AUTH_ENABLED.
 */

import assert from 'node:assert/strict';
import test, { before, after, beforeEach } from 'node:test';
import { grantProxy, revokeProxy, listProxies } from './proxies.js';
import { createBody, addBodyMember } from './decisionBodies.js';
import { charterTopic, joinTopic } from './topics.js';
import { proposeMotion, secondMotion, castVote } from './motions.js';
import { createPrincipal } from './principals.js';
import { createGrant } from './grants.js';
import { getDbPool } from '../db/client.js';
import { getEnv } from '../env.js';

const TEST_PROJECT = '__test_proxies__';

async function cleanup() {
  const pool = getDbPool();
  const topicIds = await pool.query<{ topic_id: string }>(
    `SELECT topic_id FROM topics WHERE project_id = $1`, [TEST_PROJECT],
  );
  for (const { topic_id } of topicIds.rows) {
    await pool.query(`DELETE FROM votes WHERE motion_id IN (SELECT motion_id FROM motions WHERE topic_id=$1)`, [topic_id]);
    await pool.query(`DELETE FROM motions WHERE topic_id=$1`, [topic_id]);
    await pool.query(`DELETE FROM coordination_events WHERE topic_id=$1`, [topic_id]);
  }
  await pool.query(`DELETE FROM topics WHERE project_id=$1`, [TEST_PROJECT]);
  await pool.query(`DELETE FROM actors WHERE project_id=$1`, [TEST_PROJECT]);
  await pool.query(`DELETE FROM proxies WHERE body_id IN (SELECT body_id FROM decision_bodies WHERE project_id=$1)`, [TEST_PROJECT]);
  await pool.query(`DELETE FROM body_members WHERE body_id IN (SELECT body_id FROM decision_bodies WHERE project_id=$1)`, [TEST_PROJECT]);
  await pool.query(`DELETE FROM decision_bodies WHERE project_id=$1`, [TEST_PROJECT]);
}

before(cleanup);
after(cleanup);
beforeEach(cleanup);

async function mkBody() {
  const body = await createBody({
    project_id: TEST_PROJECT, name: 'Proxy Body', quorum: 0, threshold: 0.5,
    veto_holders: [], created_by: 'admin',
  });
  await addBodyMember({ body_id: body.body_id, actor_id: 'principal-a', vote_weight: 1 });
  return body.body_id;
}

test('15.11 grantProxy: principal delegates own vote → ok', async () => {
  const bodyId = await mkBody();
  const r = await grantProxy({ body_id: bodyId, principal: 'principal-a', proxy: 'agent-b', granted_by: 'principal-a' });
  assert.equal(r.status, 'ok');
  const list = await listProxies({ body_id: bodyId });
  assert.equal(list.proxies.length, 1);
  assert.equal(list.proxies[0].principal, 'principal-a');
  assert.equal(list.proxies[0].proxy, 'agent-b');
});

test('15.11 grantProxy: granted_by ≠ principal → not_authorized (only principal may delegate)', async () => {
  const bodyId = await mkBody();
  const r = await grantProxy({ body_id: bodyId, principal: 'principal-a', proxy: 'agent-b', granted_by: 'someone-else' });
  assert.equal(r.status, 'not_authorized');
});

test('15.11 grantProxy: principal not a body member → principal_not_member', async () => {
  const bodyId = await mkBody();
  const r = await grantProxy({ body_id: bodyId, principal: 'stranger', proxy: 'agent-b', granted_by: 'stranger' });
  assert.equal(r.status, 'principal_not_member');
});

test('15.11 grantProxy: unknown body → body_not_found', async () => {
  const r = await grantProxy({ body_id: '00000000-0000-0000-0000-000000000000', principal: 'p', proxy: 'q', granted_by: 'p' });
  assert.equal(r.status, 'body_not_found');
});

test('15.11 grantProxy: self-proxy → BAD_REQUEST', async () => {
  const bodyId = await mkBody();
  await assert.rejects(
    grantProxy({ body_id: bodyId, principal: 'principal-a', proxy: 'principal-a', granted_by: 'principal-a' }),
    (err: any) => { assert.equal(err.code, 'BAD_REQUEST'); return true; },
  );
});

test('15.11 revokeProxy: removes the grant', async () => {
  const bodyId = await mkBody();
  await grantProxy({ body_id: bodyId, principal: 'principal-a', proxy: 'agent-b', granted_by: 'principal-a' });
  const r = await revokeProxy({ body_id: bodyId, principal: 'principal-a', proxy: 'agent-b' });
  assert.equal(r.status, 'ok');
  const list = await listProxies({ body_id: bodyId });
  assert.equal(list.proxies.length, 0);
  // revoking a non-existent grant → not_found
  const r2 = await revokeProxy({ body_id: bodyId, principal: 'principal-a', proxy: 'agent-b' });
  assert.equal(r2.status, 'not_found');
});

test('15.11 castVote proxy verification: gated behind MCP_AUTH_ENABLED', async () => {
  const env = getEnv() as { MCP_AUTH_ENABLED: boolean };
  const original = env.MCP_AUTH_ENABLED;

  // F2f: under auth-ON, castVote/grantProxy now require the CALLER to hold write over the
  // motion/body (assertAuthorized) BEFORE the proxy-verification logic under test runs. Mint a
  // write-granted principal to satisfy that outer gate; the proxy check (proxy_not_granted vs
  // vote_recorded) is independent of it.
  const caller = (await createPrincipal({ kind: 'agent', display_name: `${TEST_PROJECT}caller` })).principal_id;
  await createGrant({ grantee_principal: caller, scope_type: 'project', scope_id: TEST_PROJECT, capability: 'write', granted_by: caller });

  // Setup a balloting motion with a member principal.
  const t = await charterTopic({ project_id: TEST_PROJECT, name: 'PV', charter: 'c', created_by: 'owner' });
  await joinTopic({ topic_id: t.topic_id, actor_id: 'owner', actor_type: 'human', display_name: 'O', level: 'authority' });
  await joinTopic({ topic_id: t.topic_id, actor_id: 'principal-a', actor_type: 'human', display_name: 'P', level: 'execution' });
  await joinTopic({ topic_id: t.topic_id, actor_id: 'proposer', actor_type: 'human', display_name: 'Pr', level: 'execution' });
  const body = await createBody({ project_id: TEST_PROJECT, name: 'PV Body', quorum: 0, threshold: 0.5, veto_holders: [], created_by: 'owner' });
  await addBodyMember({ body_id: body.body_id, actor_id: 'principal-a', vote_weight: 1 });
  await addBodyMember({ body_id: body.body_id, actor_id: 'proposer', vote_weight: 1 });
  const m = await proposeMotion({ body_id: body.body_id, topic_id: t.topic_id, subject_ref: 'test:pv', proposed_by: 'proposer' });
  if (m.status !== 'proposed') throw new Error('setup motion');
  await secondMotion({ motion_id: m.motion_id, actor_id: 'principal-a' });

  try {
    // Auth-ON: a vote with proxy_for but no grant → proxy_not_granted.
    env.MCP_AUTH_ENABLED = true;
    const denied = await castVote({ motion_id: m.motion_id, actingPrincipalId: caller, actor_id: 'principal-a', choice: 'for', proxy_for: 'agent-z' });
    assert.equal(denied.status, 'proxy_not_granted', 'auth-on rejects ungranted proxy');

    // Grant the proxy, then the vote succeeds.
    await grantProxy({ body_id: body.body_id, actingPrincipalId: caller, principal: 'principal-a', proxy: 'agent-z', granted_by: 'principal-a' });
    const ok = await castVote({ motion_id: m.motion_id, actingPrincipalId: caller, actor_id: 'principal-a', choice: 'for', proxy_for: 'agent-z' });
    assert.equal(ok.status, 'vote_recorded', 'auth-on accepts granted proxy');
  } finally {
    env.MCP_AUTH_ENABLED = original;
    const pool = getDbPool();
    await pool.query(`DELETE FROM grants WHERE grantee_principal=$1 OR granted_by=$1`, [caller]);
    await pool.query(`DELETE FROM principals WHERE principal_id=$1`, [caller]);
  }
});

test('15.11 castVote proxy verification: auth-OFF records proxy_for unverified (15.4 behavior)', async () => {
  const env = getEnv() as { MCP_AUTH_ENABLED: boolean };
  const original = env.MCP_AUTH_ENABLED;

  const t = await charterTopic({ project_id: TEST_PROJECT, name: 'PV2', charter: 'c', created_by: 'owner' });
  await joinTopic({ topic_id: t.topic_id, actor_id: 'owner', actor_type: 'human', display_name: 'O', level: 'authority' });
  await joinTopic({ topic_id: t.topic_id, actor_id: 'principal-a', actor_type: 'human', display_name: 'P', level: 'execution' });
  await joinTopic({ topic_id: t.topic_id, actor_id: 'proposer', actor_type: 'human', display_name: 'Pr', level: 'execution' });
  const body = await createBody({ project_id: TEST_PROJECT, name: 'PV2 Body', quorum: 0, threshold: 0.5, veto_holders: [], created_by: 'owner' });
  await addBodyMember({ body_id: body.body_id, actor_id: 'principal-a', vote_weight: 1 });
  await addBodyMember({ body_id: body.body_id, actor_id: 'proposer', vote_weight: 1 });
  const m = await proposeMotion({ body_id: body.body_id, topic_id: t.topic_id, subject_ref: 'test:pv2', proposed_by: 'proposer' });
  if (m.status !== 'proposed') throw new Error('setup motion');
  await secondMotion({ motion_id: m.motion_id, actor_id: 'principal-a' });

  try {
    env.MCP_AUTH_ENABLED = false;
    // No grant exists, but auth-off → proxy_for recorded unverified.
    const ok = await castVote({ motion_id: m.motion_id, actor_id: 'principal-a', choice: 'for', proxy_for: 'agent-unverified' });
    assert.equal(ok.status, 'vote_recorded', 'auth-off records proxy_for without a grant');
  } finally {
    env.MCP_AUTH_ENABLED = original;
  }
});
