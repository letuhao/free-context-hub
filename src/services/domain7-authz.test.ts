/**
 * Actor Data Boundary F2f domain 7 (guardrails / taxonomy / projectGroups / reviewRequests / exchange
 * / coordinationEvents.replayEvents) — auth-ON cross-actor enforcement.
 *
 * These services lost their assertCallerScope/assertTopicScope guards; authorize() + grants is the
 * gate, run as the FIRST line of each fn (before any DB/network/fs work). Project-scoped reads deny as
 * NOT_FOUND (no oracle); writes deny as FORBIDDEN on a resolvable project. replayEvents is topic-scoped
 * (an unknown topic is unresolvable → OUT_OF_SCOPE → NOT_FOUND). Real DB + auth-ON toggling.
 * (Replaces the DEFERRED-029 callerScope cross-tenant cases in d3/d4/coordination/documents-scope.)
 *
 * NOTE: jobQueue (enqueueJob/listJobs/cancelJob) is deliberately NOT migrated here — its SEC-1/3/5/6
 * hardening keys off callerScope as a data value and needs an actor-native redesign (see DEFERRED.md
 * F2f-jobs). Its DEFERRED-029 cases remain in d3-scope.test.ts.
 */

import assert from 'node:assert/strict';
import test, { before, after } from 'node:test';
import { listGuardrailRules, simulateGuardrails, checkGuardrails } from './guardrails.js';
import { getActiveProfile, activateProfile, deactivateProfile } from './taxonomyService.js';
import { addProjectToGroup, removeProjectFromGroup, listGroupsForProject, createProject, updateProject } from './projectGroups.js';
import { submitForReview, listReviewRequests, getReviewRequest, approveReviewRequest, returnReviewRequest } from './reviewRequests.js';
import { exportProject } from './exchange/exportProject.js';
import { importProject } from './exchange/importProject.js';
import { pullFromRemote } from './exchange/pullFromRemote.js';
import { replayEvents } from './coordinationEvents.js';
import { createPrincipal } from './principals.js';
import { createGrant } from './grants.js';
import { ContextHubError } from '../core/errors.js';
import { getDbPool } from '../db/client.js';

const PREFIX = '__test_domain7_authz__';
const P = `${PREFIX}projP`;
const Q = `${PREFIX}projQ`;
const UUID = '11111111-1111-1111-1111-111111111111';

const isNotFound = (e: unknown) => e instanceof ContextHubError && e.code === 'NOT_FOUND';
const isForbidden = (e: unknown) => e instanceof ContextHubError && e.code === 'FORBIDDEN';
const noopSink = { write: () => true, end: () => undefined } as unknown as NodeJS.WritableStream;

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
test('reader@P: listGuardrailRules cross-tenant → NOT_FOUND', async () => {
  await assert.rejects(listGuardrailRules(Q, { actingPrincipalId: reader }), isNotFound);
});
test('reader@P: listGuardrailRules multi (P,Q) cross-tenant → NOT_FOUND (strict-reject)', async () => {
  await assert.rejects(listGuardrailRules([P, Q], { actingPrincipalId: reader }), isNotFound);
});
test('reader@P: simulateGuardrails cross-tenant → NOT_FOUND', async () => {
  await assert.rejects(simulateGuardrails(Q, ['git push'], { actingPrincipalId: reader }), isNotFound);
});
test('reader@P: checkGuardrails cross-tenant → NOT_FOUND', async () => {
  await assert.rejects(checkGuardrails(Q, { action: 'git push' }, { actingPrincipalId: reader }), isNotFound);
});
test('reader@P: getActiveProfile cross-tenant → NOT_FOUND', async () => {
  await assert.rejects(getActiveProfile(Q, { actingPrincipalId: reader }), isNotFound);
});
test('reader@P: listGroupsForProject cross-tenant → NOT_FOUND', async () => {
  await assert.rejects(listGroupsForProject(Q, { actingPrincipalId: reader }), isNotFound);
});
test('reader@P: listReviewRequests cross-tenant → NOT_FOUND', async () => {
  await assert.rejects(listReviewRequests({ project_id: Q, actingPrincipalId: reader }), isNotFound);
});
test('reader@P: getReviewRequest cross-tenant → NOT_FOUND', async () => {
  await assert.rejects(getReviewRequest({ project_id: Q, request_id: UUID, actingPrincipalId: reader }), isNotFound);
});
test('reader@P: exportProject cross-tenant → NOT_FOUND', async () => {
  await assert.rejects(exportProject({ projectId: Q, actingPrincipalId: reader }, noopSink as any), isNotFound);
});
test('reader@P: replayEvents unknown topic → NOT_FOUND (unresolvable → OUT_OF_SCOPE)', async () => {
  await assert.rejects(replayEvents({ topic_id: `${PREFIX}notopic`, actingPrincipalId: reader }), isNotFound);
});

// ── writes: cross-tenant project Q → FORBIDDEN (resolvable project) ───────────
test('writer@P: activateProfile cross-tenant → FORBIDDEN', async () => {
  await assert.rejects(activateProfile({ project_id: Q, actingPrincipalId: writer, slug: 'default' }), isForbidden);
});
test('writer@P: deactivateProfile cross-tenant → FORBIDDEN', async () => {
  await assert.rejects(deactivateProfile(Q, { actingPrincipalId: writer }), isForbidden);
});
test('writer@P: addProjectToGroup cross-tenant → FORBIDDEN', async () => {
  await assert.rejects(addProjectToGroup('group-x', Q, { actingPrincipalId: writer }), isForbidden);
});
test('writer@P: removeProjectFromGroup cross-tenant → FORBIDDEN', async () => {
  await assert.rejects(removeProjectFromGroup('group-x', Q, { actingPrincipalId: writer }), isForbidden);
});
test('writer@P: submitForReview cross-tenant → FORBIDDEN', async () => {
  await assert.rejects(submitForReview({ project_id: Q, actingPrincipalId: writer, agent_id: 'a', lesson_id: UUID }), isForbidden);
});
test('writer@P: approveReviewRequest cross-tenant → FORBIDDEN', async () => {
  await assert.rejects(approveReviewRequest({ project_id: Q, request_id: UUID, resolved_by: 'r', actingPrincipalId: writer }), isForbidden);
});
test('writer@P: returnReviewRequest cross-tenant → FORBIDDEN', async () => {
  await assert.rejects(returnReviewRequest({ project_id: Q, request_id: UUID, resolved_by: 'r', resolution_note: 'x', actingPrincipalId: writer }), isForbidden);
});
test('writer@P: updateProject cross-tenant → FORBIDDEN', async () => {
  await assert.rejects(updateProject(Q, { actingPrincipalId: writer, name: 'x' }), isForbidden);
});
test('writer@P: createProject cross-tenant id → FORBIDDEN', async () => {
  await assert.rejects(createProject({ project_id: 'qcrosstenantproj', actingPrincipalId: writer, name: 'x' }), isForbidden);
});
test('writer@P: importProject cross-tenant → FORBIDDEN', async () => {
  await assert.rejects(importProject({ targetProjectId: Q, actingPrincipalId: writer, bundlePath: '/dev/null' }), isForbidden);
});
test('writer@P: pullFromRemote cross-tenant → FORBIDDEN', async () => {
  await assert.rejects(
    pullFromRemote({ targetProjectId: Q, actingPrincipalId: writer, remoteUrl: 'https://x.example', remoteProjectId: 'r' }),
    isForbidden,
  );
});

// ── over-capability on own project + allow + unknown ─────────────────────────
test('reader@P: activateProfile on own project (read ⊅ write) → FORBIDDEN', async () => {
  await assert.rejects(activateProfile({ project_id: P, actingPrincipalId: reader, slug: 'default' }), isForbidden);
});
test('reader@P: getActiveProfile on P → ALLOW (resolves through the gate → null)', async () => {
  const profile = await getActiveProfile(P, { actingPrincipalId: reader });
  assert.equal(profile, null);
});
test('reader@P: listGuardrailRules on P → ALLOW (empty rule set)', async () => {
  const res = await listGuardrailRules(P, { actingPrincipalId: reader });
  assert.ok(Array.isArray(res.rules));
});
test('unknown principal: listGuardrailRules on P → NOT_FOUND', async () => {
  await assert.rejects(listGuardrailRules(P, { actingPrincipalId: '00000000-0000-0000-0000-000000000000' }), isNotFound);
});
