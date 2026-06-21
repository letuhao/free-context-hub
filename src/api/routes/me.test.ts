/**
 * Phase 13 Sprint 13.2 — me.ts unit tests.
 *
 * Verifies the three admin identities are distinguishable via key_source:
 *   - no_auth (MCP_AUTH_ENABLED=false)
 *   - env_token (MCP_AUTH_ENABLED=true + no role attached)
 *   - db_key (MCP_AUTH_ENABLED=true + role attached)
 *
 * Approach: call `buildMeResponse` directly with mocked req + stubbed env.
 */

import assert from 'node:assert/strict';
import test from 'node:test';

import { buildMeResponse, resolveMePrincipal } from './me.js';
import type { Principal } from '../../services/principals.js';

function stubEnv(MCP_AUTH_ENABLED: boolean): () => { MCP_AUTH_ENABLED: boolean } {
  return () => ({ MCP_AUTH_ENABLED });
}

test('buildMeResponse returns no_auth source when MCP_AUTH_ENABLED is false', () => {
  const body = buildMeResponse({}, stubEnv(false));
  assert.equal(body.role, 'admin');
  assert.equal(body.project_scope, null);
  assert.equal(body.auth_enabled, false);
  assert.equal(body.key_source, 'no_auth');
});

test('buildMeResponse returns env_token source when auth enabled but no role attached', () => {
  const body = buildMeResponse({}, stubEnv(true)); // no apiKeyRole
  assert.equal(body.role, 'admin');
  assert.equal(body.project_scope, null);
  assert.equal(body.auth_enabled, true);
  assert.equal(body.key_source, 'env_token');
});

test('buildMeResponse returns db_key source for DB-backed writer with scope', () => {
  const body = buildMeResponse({ apiKeyRole: 'writer', apiKeyScope: 'proj-A' }, stubEnv(true));
  assert.equal(body.role, 'writer');
  assert.equal(body.project_scope, 'proj-A');
  assert.equal(body.auth_enabled, true);
  assert.equal(body.key_source, 'db_key');
});

test('buildMeResponse returns db_key source for DB-backed admin with null scope', () => {
  const body = buildMeResponse({ apiKeyRole: 'admin', apiKeyScope: null }, stubEnv(true));
  assert.equal(body.role, 'admin');
  assert.equal(body.project_scope, null);
  assert.equal(body.auth_enabled, true);
  assert.equal(body.key_source, 'db_key');
});

// r3 F1 fix: scope attached without role → restrictive identity (no admin leak)
test('buildMeResponse returns restrictive identity when scope is attached without role', () => {
  const body = buildMeResponse({ apiKeyScope: 'proj-A' }, stubEnv(true));
  assert.equal(body.role, 'reader', 'must NOT report admin when only scope is attached');
  assert.equal(body.project_scope, 'proj-A');
  assert.equal(body.auth_enabled, true);
  assert.equal(body.key_source, 'db_key');
});

// Actor Data Boundary S1 — buildMeResponse always sets principal:null (the router overlays it async).
test('buildMeResponse sets principal to null (router overlays it)', () => {
  assert.equal(buildMeResponse({}, stubEnv(false)).principal, null);
  assert.equal(buildMeResponse({ apiKeyRole: 'admin' }, stubEnv(true)).principal, null);
});

// Actor Data Boundary S1 — resolveMePrincipal returns the footer subset for a bound principal.
const FAKE_PRINCIPAL: Principal = {
  principal_id: 'p-1',
  kind: 'human',
  status: 'active',
  display_name: 'Ada',
  is_root: false,
  is_system: false,
  created_at: '2026-06-21T00:00:00Z',
};

test('resolveMePrincipal returns null when no principal id is bound', async () => {
  assert.equal(await resolveMePrincipal(null, async () => FAKE_PRINCIPAL), null);
  assert.equal(await resolveMePrincipal('', async () => FAKE_PRINCIPAL), null);
});

test('resolveMePrincipal returns null when the lookup misses', async () => {
  assert.equal(await resolveMePrincipal('p-missing', async () => null), null);
});

test('resolveMePrincipal returns the footer subset for a bound principal', async () => {
  const p = await resolveMePrincipal('p-1', async () => FAKE_PRINCIPAL);
  assert.deepEqual(p, {
    principal_id: 'p-1',
    display_name: 'Ada',
    kind: 'human',
    status: 'active',
    is_root: false,
    is_system: false,
  });
});
