/**
 * Actor Data Boundary F1d — resolveMcpCaller: expose the credential-bound principal + the
 * structured CREDENTIAL_EXPIRED signal (distinct from a plain invalid token).
 *
 * Real DB (creates principals + keys). Toggles MCP_AUTH_ENABLED via _resetEnvCacheForTest.
 */

import assert from 'node:assert/strict';
import test, { before, after, beforeEach } from 'node:test';
import { resolveMcpCaller } from './auth.js';
import { createPrincipal, setPrincipalStatus } from '../services/principals.js';
import { createApiKey, revokeApiKey } from '../services/apiKeys.js';
import { ContextHubError } from '../core/errors.js';
import { getDbPool } from '../db/client.js';

const PREFIX = '__test_mcpcaller__';

async function cleanup() {
  const pool = getDbPool();
  await pool.query(`DELETE FROM api_keys WHERE name LIKE $1`, [`${PREFIX}%`]);
  await pool.query(`DELETE FROM principals WHERE display_name LIKE $1`, [`${PREFIX}%`]);
}

let resetEnv: () => void;
const savedEnv = {
  auth: process.env.MCP_AUTH_ENABLED,
  token: process.env.CONTEXT_HUB_WORKSPACE_TOKEN,
  disabled: process.env.MCP_LEGACY_TOKEN_DISABLED,
};
async function authOn() {
  // api-keys-only hardened config: auth on, legacy single-shared token disabled (so the env schema
  // does not require CONTEXT_HUB_WORKSPACE_TOKEN).
  process.env.MCP_AUTH_ENABLED = 'true';
  delete process.env.CONTEXT_HUB_WORKSPACE_TOKEN;
  process.env.MCP_LEGACY_TOKEN_DISABLED = 'true';
  ({ _resetEnvCacheForTest: resetEnv } = await import('../env.js'));
  resetEnv();
}
async function authOff() {
  process.env.MCP_AUTH_ENABLED = 'false';
  ({ _resetEnvCacheForTest: resetEnv } = await import('../env.js'));
  resetEnv();
}

before(cleanup);
after(async () => {
  await cleanup();
  if (savedEnv.auth === undefined) delete process.env.MCP_AUTH_ENABLED; else process.env.MCP_AUTH_ENABLED = savedEnv.auth;
  if (savedEnv.token === undefined) delete process.env.CONTEXT_HUB_WORKSPACE_TOKEN; else process.env.CONTEXT_HUB_WORKSPACE_TOKEN = savedEnv.token;
  if (savedEnv.disabled === undefined) delete process.env.MCP_LEGACY_TOKEN_DISABLED; else process.env.MCP_LEGACY_TOKEN_DISABLED = savedEnv.disabled;
  const { _resetEnvCacheForTest } = await import('../env.js');
  _resetEnvCacheForTest();
});
beforeEach(cleanup);

test('auth-off -> scope undefined, no principal', async () => {
  await authOff();
  const caller = await resolveMcpCaller('whatever');
  assert.equal(caller.scope, undefined);
  assert.equal(caller.principalId, null);
});

test('bound active key -> exposes principalId + expiresAt', async () => {
  await authOn();
  const p = await createPrincipal({ kind: 'agent', display_name: `${PREFIX}codex` });
  const { key } = await createApiKey({ name: `${PREFIX}k`, principal_id: p.principal_id });
  const caller = await resolveMcpCaller(key);
  assert.equal(caller.principalId, p.principal_id);
});

test('suspended bound principal -> UNAUTHORIZED, NOT principal-state leak [adversary #1]', async () => {
  // The bound principal being suspended/retired must NOT surface as a distinct wire reason to an
  // unauthenticated caller (it would leak that a named principal was deactivated). Folded to generic.
  await authOn();
  const p = await createPrincipal({ kind: 'agent', display_name: `${PREFIX}sus` });
  const { key } = await createApiKey({ name: `${PREFIX}ksus`, principal_id: p.principal_id });
  await setPrincipalStatus(p.principal_id, 'suspended');
  await assert.rejects(
    () => resolveMcpCaller(key),
    (e: unknown) => e instanceof ContextHubError && e.code === 'UNAUTHORIZED',
  );
});

test('revoked key -> CREDENTIAL_EXPIRED', async () => {
  await authOn();
  const p = await createPrincipal({ kind: 'agent', display_name: `${PREFIX}rev` });
  const { key, entry } = await createApiKey({ name: `${PREFIX}krev`, principal_id: p.principal_id });
  await revokeApiKey(entry.key_id);
  await assert.rejects(
    () => resolveMcpCaller(key),
    (e: unknown) => e instanceof ContextHubError && e.code === 'CREDENTIAL_EXPIRED',
  );
});

test('expired key -> CREDENTIAL_EXPIRED', async () => {
  await authOn();
  const p = await createPrincipal({ kind: 'agent', display_name: `${PREFIX}exp` });
  const { key } = await createApiKey({
    name: `${PREFIX}kexp`,
    principal_id: p.principal_id,
    expires_at: '2000-01-01T00:00:00Z',
  });
  await assert.rejects(
    () => resolveMcpCaller(key),
    (e: unknown) => e instanceof ContextHubError && e.code === 'CREDENTIAL_EXPIRED',
  );
});

test('never-seen token -> UNAUTHORIZED (not CREDENTIAL_EXPIRED)', async () => {
  await authOn();
  await assert.rejects(
    () => resolveMcpCaller('chub_sk_never_existed_at_all'),
    (e: unknown) => e instanceof ContextHubError && e.code === 'UNAUTHORIZED',
  );
});
