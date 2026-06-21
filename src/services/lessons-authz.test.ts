/**
 * Actor Data Boundary F2f domain 1 (lessons) — auth-ON cross-actor enforcement.
 *
 * Replaces the DEFERRED-029 callerScope cross-tenant unit tests (that mechanism is gone): tenant
 * isolation now rests on authorize() + grants. A principal granted READ on project P is denied
 * OUTSIDE its grants (cross-tenant read → NOT_FOUND, no existence oracle) and ABOVE its capability
 * (write/admin on P → FORBIDDEN, since read ⊅ write). assertAuthorized runs first in each fn, so a
 * deny throws before any lesson row, embedding call, or other dependency is needed. Real DB +
 * auth-ON toggling (node runs each test FILE in its own process, so the env flip is isolated).
 */

import assert from 'node:assert/strict';
import test, { before, after } from 'node:test';
import {
  addLesson,
  searchLessons,
  searchLessonsMulti,
  listLessons,
  updateLesson,
  deleteWorkspace,
} from './lessons.js';
import { createPrincipal } from './principals.js';
import { createGrant } from './grants.js';
import { ContextHubError } from '../core/errors.js';
import { getDbPool } from '../db/client.js';

const PREFIX = '__test_lessons_authz__';
const P = `${PREFIX}projP`;
const Q = `${PREFIX}projQ`;
const FAKE_UUID = '11111111-1111-1111-1111-111111111111';

const isNotFound = (e: unknown) => e instanceof ContextHubError && e.code === 'NOT_FOUND';
const isForbidden = (e: unknown) => e instanceof ContextHubError && e.code === 'FORBIDDEN';

async function cleanup() {
  const pool = getDbPool();
  await pool.query(
    `DELETE FROM grants WHERE grantee_principal IN (SELECT principal_id FROM principals WHERE display_name LIKE $1)
        OR granted_by IN (SELECT principal_id FROM principals WHERE display_name LIKE $1)`,
    [`${PREFIX}%`],
  );
  await pool.query(`DELETE FROM principals WHERE display_name LIKE $1`, [`${PREFIX}%`]);
}

let reader: string; // granted read@P only
let grantor: string;
const saved = { auth: process.env.MCP_AUTH_ENABLED };
async function setAuth(on: boolean) {
  process.env.MCP_AUTH_ENABLED = on ? 'true' : 'false';
  const { _resetEnvCacheForTest } = await import('../env.js');
  _resetEnvCacheForTest();
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

test('reader@P: cross-tenant READ (project Q) → NOT_FOUND (no existence oracle)', async () => {
  await assert.rejects(searchLessons({ projectId: Q, actingPrincipalId: reader, query: 'x' }), isNotFound);
  await assert.rejects(listLessons({ projectId: Q, actingPrincipalId: reader }), isNotFound);
});

test('reader@P: multi-project read including an ungranted project → NOT_FOUND', async () => {
  await assert.rejects(searchLessonsMulti({ projectIds: [P, Q], actingPrincipalId: reader, query: 'x' }), isNotFound);
  await assert.rejects(listLessons({ projectIds: [P, Q], actingPrincipalId: reader }), isNotFound);
});

test('reader@P: WRITE on its own project (read ⊅ write) → FORBIDDEN', async () => {
  await assert.rejects(
    addLesson({ project_id: P, actingPrincipalId: reader, lesson_type: 'decision' as any, title: 't', content: 'c' } as any),
    isForbidden,
  );
  await assert.rejects(updateLesson({ projectId: P, actingPrincipalId: reader, lessonId: FAKE_UUID }), isForbidden);
});

test('reader@P: ADMIN (deleteWorkspace, destructive) on its own project → FORBIDDEN', async () => {
  await assert.rejects(deleteWorkspace(P, { actingPrincipalId: reader }), isForbidden);
});

test('reader@P: granted READ on P resolves through the gate (no authz throw)', async () => {
  // listLessons takes a plain SQL path (no embeddings backend). P has no lessons → empty result,
  // which proves the grant lets the call THROUGH rather than denying it.
  const r = await listLessons({ projectId: P, actingPrincipalId: reader });
  assert.ok(Array.isArray(r.items));
});

test('unknown principal: READ anywhere → NOT_FOUND', async () => {
  await assert.rejects(
    searchLessons({ projectId: P, actingPrincipalId: '00000000-0000-0000-0000-000000000000', query: 'x' }),
    isNotFound,
  );
});
