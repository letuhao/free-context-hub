/**
 * Actor Data Boundary F2f domain 5 (git / workspace / snapshot) — auth-ON cross-actor enforcement.
 *
 * gitIntelligence/repoSources/workspaceTracker/snapshot lost their assertCallerScope guards;
 * authorize() + grants is the gate. All these fns are project-scoped: a principal granted READ on
 * project P is denied OUTSIDE its grants (cross-tenant read → NOT_FOUND, write/admin → FORBIDDEN).
 * assertAuthorized runs first in each fn, so a deny throws before any git/fs/DB work. Real DB +
 * auth-ON toggling. (Replaces the DEFERRED-029 callerScope cross-tenant cases.)
 */

import assert from 'node:assert/strict';
import test, { before, after } from 'node:test';
import { ingestGitHistory, listCommits, getCommit, suggestLessonsFromCommits, linkCommitToLesson, analyzeCommitImpact } from './gitIntelligence.js';
import { configureProjectSource, prepareRepo, getProjectSource } from './repoSources.js';
import { registerWorkspaceRoot, listWorkspaceRoots, scanWorkspaceChanges } from './workspaceTracker.js';
import { getProjectSnapshotBody, rebuildProjectSnapshot } from './snapshot.js';
import { createPrincipal } from './principals.js';
import { createGrant } from './grants.js';
import { ContextHubError } from '../core/errors.js';
import { getDbPool } from '../db/client.js';

const PREFIX = '__test_gitws_authz__';
const P = `${PREFIX}projP`;
const Q = `${PREFIX}projQ`;

const isNotFound = (e: unknown) => e instanceof ContextHubError && e.code === 'NOT_FOUND';
const isForbidden = (e: unknown) => e instanceof ContextHubError && e.code === 'FORBIDDEN';

let reader: string; // granted read@P only
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
  grantor = (await createPrincipal({ kind: 'agent', display_name: `${PREFIX}grantor` })).principal_id;
  await createGrant({ grantee_principal: reader, scope_type: 'project', scope_id: P, capability: 'read', granted_by: grantor });
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
test('reader@P: listCommits cross-tenant → NOT_FOUND', async () => {
  await assert.rejects(listCommits({ projectId: Q, actingPrincipalId: reader }), isNotFound);
});
test('reader@P: getCommit cross-tenant → NOT_FOUND', async () => {
  await assert.rejects(getCommit({ projectId: Q, actingPrincipalId: reader, sha: 'abc' }), isNotFound);
});
test('reader@P: analyzeCommitImpact cross-tenant → NOT_FOUND', async () => {
  await assert.rejects(analyzeCommitImpact({ projectId: Q, actingPrincipalId: reader, commitSha: 'abc' }), isNotFound);
});
test('reader@P: getProjectSource cross-tenant → NOT_FOUND', async () => {
  await assert.rejects(getProjectSource(Q, 'local_workspace', { actingPrincipalId: reader }), isNotFound);
});
test('reader@P: listWorkspaceRoots cross-tenant → NOT_FOUND', async () => {
  await assert.rejects(listWorkspaceRoots(Q, { actingPrincipalId: reader }), isNotFound);
});
test('reader@P: getProjectSnapshotBody cross-tenant → NOT_FOUND', async () => {
  await assert.rejects(getProjectSnapshotBody(Q, { actingPrincipalId: reader }), isNotFound);
});

// ── writes: cross-tenant project Q → FORBIDDEN (resolvable project) ───────────
test('reader@P: ingestGitHistory cross-tenant → FORBIDDEN', async () => {
  await assert.rejects(ingestGitHistory({ projectId: Q, actingPrincipalId: reader, root: '/tmp/x' }), isForbidden);
});
test('reader@P: suggestLessonsFromCommits cross-tenant → FORBIDDEN', async () => {
  await assert.rejects(suggestLessonsFromCommits({ projectId: Q, actingPrincipalId: reader }), isForbidden);
});
test('reader@P: linkCommitToLesson cross-tenant → FORBIDDEN', async () => {
  await assert.rejects(linkCommitToLesson({ projectId: Q, actingPrincipalId: reader, commitSha: 'abc', lessonId: 'l' }), isForbidden);
});
test('reader@P: configureProjectSource cross-tenant → FORBIDDEN', async () => {
  await assert.rejects(configureProjectSource({ projectId: Q, actingPrincipalId: reader, sourceType: 'local_workspace' }), isForbidden);
});
test('reader@P: prepareRepo cross-tenant → FORBIDDEN', async () => {
  await assert.rejects(prepareRepo({ projectId: Q, actingPrincipalId: reader, gitUrl: 'https://x/y.git', cacheRoot: '/tmp' }), isForbidden);
});
test('reader@P: registerWorkspaceRoot cross-tenant → FORBIDDEN', async () => {
  await assert.rejects(registerWorkspaceRoot({ projectId: Q, actingPrincipalId: reader, rootPath: '/tmp/x' }), isForbidden);
});
test('reader@P: scanWorkspaceChanges cross-tenant → FORBIDDEN', async () => {
  await assert.rejects(scanWorkspaceChanges({ projectId: Q, actingPrincipalId: reader, rootPath: '/tmp/x' }), isForbidden);
});
test('reader@P: rebuildProjectSnapshot cross-tenant → FORBIDDEN', async () => {
  await assert.rejects(rebuildProjectSnapshot(Q, { actingPrincipalId: reader }), isForbidden);
});

// ── over-capability on own project + allow ───────────────────────────────────
test('reader@P: ingestGitHistory on own project (read ⊅ write) → FORBIDDEN', async () => {
  await assert.rejects(ingestGitHistory({ projectId: P, actingPrincipalId: reader, root: '/tmp/x' }), isForbidden);
});
test('reader@P: getProjectSnapshotBody on P → ALLOW (resolves through the gate)', async () => {
  const body = await getProjectSnapshotBody(P, { actingPrincipalId: reader });
  assert.ok(body === null || typeof body === 'string');
});
test('unknown principal: listCommits → NOT_FOUND', async () => {
  await assert.rejects(listCommits({ projectId: P, actingPrincipalId: '00000000-0000-0000-0000-000000000000' }), isNotFound);
});
