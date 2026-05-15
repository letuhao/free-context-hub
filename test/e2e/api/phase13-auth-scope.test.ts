/**
 * Phase 13 Sprint 13.7 Part B — Auth-enabled requireScope smoke (DEFERRED-006).
 *
 * Run via the auth-enabled docker-compose override:
 *   docker compose -f docker-compose.yml -f docker-compose.auth-test.yml up -d
 *   npm run test:e2e:api
 *
 * AUTH-1 env-var admin → GET /api/me → role=admin, key_source=env_token
 * AUTH-2 DB writer scoped to A → GET /api/me → role=writer, project_scope=A, key_source=db_key
 * AUTH-3 DB admin scoped to A → DELETE /api/projects/A/.../force → 200 (in-scope admin)
 * AUTH-4 DB admin scoped to A → DELETE /api/projects/B/.../force → 403 (requireScope blocks)  ← DEFERRED-006 closure
 * AUTH-5 DB writer scoped to A → DELETE /api/projects/B/.../force → 403 (requireRole blocks first)
 * AUTH-6 DB writer scoped to A → POST /api/taxonomy-profiles body.owner_project_id=B → 403 (inline scope-check)
 *
 * This file is skipped when MCP_AUTH_ENABLED is false (the default dev stack).
 * The dedicated auth-test override flips it true.
 */

import type { TestFn } from '../shared/testContext.js';
import { pass, fail, skip } from '../shared/testContext.js';
import { makeApiClient } from '../shared/apiClient.js';
import { API_BASE, ADMIN_TOKEN, E2E_PROJECT_ID, E2E_PROJECT_ID_B } from '../shared/constants.js';
import { createTestApiKey, revokeTestKeys } from '../shared/authHelpers.js';

const GROUP = 'phase13-auth-scope';

function authTest(name: string, fn: (ctx: any) => Promise<void>): TestFn {
  return async (ctx) => {
    const start = Date.now();
    try {
      await fn(ctx);
      return pass(name, GROUP, Date.now() - start);
    } catch (err: any) {
      const msg = err?.message ?? String(err);
      if (msg.includes('SKIP:')) return skip(name, GROUP, msg.replace('SKIP: ', ''));
      return fail(name, GROUP, Date.now() - start, msg);
    }
  };
}

async function checkAuthEnabled(): Promise<boolean> {
  // Quick probe: in the dev stack with auth off, /api/me returns key_source='no_auth'.
  // In the auth-enabled stack with env-var token, it returns 'env_token'.
  const c = makeApiClient(API_BASE, ADMIN_TOKEN);
  const r = await c.get('/api/me');
  return r.body?.auth_enabled === true;
}

export const allPhase13AuthScopeTests: TestFn[] = [
  authTest('auth-1-env-var-admin-returns-env-token-source', async () => {
    if (!(await checkAuthEnabled())) throw new Error('SKIP: auth not enabled — run via docker-compose.auth-test.yml');
    const c = makeApiClient(API_BASE, ADMIN_TOKEN);
    const r = await c.get('/api/me');
    if (r.body.role !== 'admin') throw new Error(`Expected role=admin, got ${r.body.role}`);
    if (r.body.key_source !== 'env_token') throw new Error(`Expected env_token, got ${r.body.key_source}`);
    if (r.body.project_scope !== null) throw new Error(`Expected null scope, got ${r.body.project_scope}`);
  }),

  authTest('auth-2-db-writer-scoped-returns-db-key-source', async () => {
    if (!(await checkAuthEnabled())) throw new Error('SKIP: auth not enabled');
    const key = await createTestApiKey('writer', { project_scope: E2E_PROJECT_ID, name: 'auth-test-writer-A' });
    try {
      const c = makeApiClient(API_BASE, key.key);
      const r = await c.get('/api/me');
      if (r.body.role !== 'writer') throw new Error(`Expected role=writer, got ${r.body.role}`);
      if (r.body.key_source !== 'db_key') throw new Error(`Expected db_key, got ${r.body.key_source}`);
      if (r.body.project_scope !== E2E_PROJECT_ID) throw new Error(`Expected scope=${E2E_PROJECT_ID}, got ${r.body.project_scope}`);
    } finally {
      await revokeTestKeys([key.key_id]);
    }
  }),

  authTest('auth-3-db-admin-scoped-in-scope-force-release-200', async ({ projectId, runMarker }) => {
    if (!(await checkAuthEnabled())) throw new Error('SKIP: auth not enabled');
    const adminA = await createTestApiKey('admin', { project_scope: E2E_PROJECT_ID, name: `auth-admin-A-${runMarker}` });
    const adminClient = makeApiClient(API_BASE, ADMIN_TOKEN);
    try {
      // Create a lease as admin (env-var)
      const c = await adminClient.post(`/api/projects/${E2E_PROJECT_ID}/artifact-leases`, {
        agent_id: `agent-auth3-${runMarker}`,
        artifact_type: 'custom',
        artifact_id: `auth3-${runMarker}`,
        task_description: 'will be force-released by scoped admin',
        ttl_minutes: 5,
      });
      if (c.status !== 201) throw new Error(`Setup failed: claim returned ${c.status}`);
      const leaseId = c.body.lease_id;

      // Scoped admin in scope → 200
      const scopedClient = makeApiClient(API_BASE, adminA.key);
      const r = await scopedClient.delete(`/api/projects/${E2E_PROJECT_ID}/artifact-leases/${leaseId}/force`);
      if (r.status !== 200) throw new Error(`Expected 200 for in-scope admin force-release, got ${r.status}: ${JSON.stringify(r.body)}`);
    } finally {
      await revokeTestKeys([adminA.key_id]);
    }
  }),

  authTest('auth-4-db-admin-scoped-cross-tenant-force-release-403-from-scope', async ({ runMarker }) => {
    if (!(await checkAuthEnabled())) throw new Error('SKIP: auth not enabled');
    const adminA = await createTestApiKey('admin', { project_scope: E2E_PROJECT_ID, name: `auth-admin-A-${runMarker}` });
    const adminClient = makeApiClient(API_BASE, ADMIN_TOKEN);
    try {
      // Create a lease in project B (env-var admin has global scope)
      const c = await adminClient.post(`/api/projects/${E2E_PROJECT_ID_B}/artifact-leases`, {
        agent_id: `agent-auth4-${runMarker}`,
        artifact_type: 'custom',
        artifact_id: `auth4-${runMarker}`,
        task_description: 'cross-tenant target',
        ttl_minutes: 5,
      }).catch(() => null);
      if (!c || c.status !== 201) throw new Error(`SKIP: cannot create lease in project ${E2E_PROJECT_ID_B} — likely missing project setup`);
      const leaseId = c.body.lease_id;

      // Scoped admin tries cross-tenant force-release → expect 403 from requireScope
      const scopedClient = makeApiClient(API_BASE, adminA.key);
      const r = await scopedClient.delete(`/api/projects/${E2E_PROJECT_ID_B}/artifact-leases/${leaseId}/force`);
      if (r.status !== 403) throw new Error(`Expected 403 cross-tenant, got ${r.status}: ${JSON.stringify(r.body)}`);
      const errMsg = String(r.body?.error ?? '');
      if (!errMsg.match(/scoped to|cannot access/i)) {
        throw new Error(`Expected scope-related error message; got: ${errMsg}`);
      }
    } finally {
      await revokeTestKeys([adminA.key_id]);
    }
  }),

  authTest('auth-5-db-writer-scoped-cross-tenant-force-release-403-from-role', async ({ runMarker }) => {
    if (!(await checkAuthEnabled())) throw new Error('SKIP: auth not enabled');
    const writerA = await createTestApiKey('writer', { project_scope: E2E_PROJECT_ID, name: `auth-writer-A-${runMarker}` });
    try {
      const scopedClient = makeApiClient(API_BASE, writerA.key);
      // Even before the request, requireRole('admin') should reject this writer
      const r = await scopedClient.delete(`/api/projects/${E2E_PROJECT_ID_B}/artifact-leases/some-fake-lease/force`);
      if (r.status !== 403) throw new Error(`Expected 403, got ${r.status}: ${JSON.stringify(r.body)}`);
      // The 403 should come from requireRole (not requireScope)
      const errMsg = String(r.body?.error ?? '');
      if (!errMsg.match(/admin|role/i)) {
        throw new Error(`Expected role-related error message (requireRole fires first); got: ${errMsg}`);
      }
    } finally {
      await revokeTestKeys([writerA.key_id]);
    }
  }),

  authTest('auth-6-writer-mismatched-owner-project-id-403-inline-scope-check', async ({ runMarker }) => {
    if (!(await checkAuthEnabled())) throw new Error('SKIP: auth not enabled');
    const writerA = await createTestApiKey('writer', { project_scope: E2E_PROJECT_ID, name: `auth-writer-A-${runMarker}` });
    try {
      const scopedClient = makeApiClient(API_BASE, writerA.key);
      const r = await scopedClient.post('/api/taxonomy-profiles', {
        slug: `cross-${runMarker}`,
        name: 'Cross-tenant attempt',
        lesson_types: [{ type: `cross-${runMarker}`, label: 'Cross' }],
        owner_project_id: E2E_PROJECT_ID_B, // mismatched
      });
      if (r.status !== 403) throw new Error(`Expected 403 cross-tenant create, got ${r.status}: ${JSON.stringify(r.body)}`);
      const errMsg = String(r.body?.error ?? '');
      if (!errMsg.match(/scoped to|cannot create/i)) {
        throw new Error(`Expected scope error message; got: ${errMsg}`);
      }
    } finally {
      await revokeTestKeys([writerA.key_id]);
    }
  }),
];
