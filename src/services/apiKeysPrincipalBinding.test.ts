/**
 * Actor Data Boundary F1b — api_keys ↔ principal binding.
 *
 * A credential authenticates TO a principal. This suite proves:
 *   - createApiKey({principal_id}) binds only to an existing, ACTIVE, non-root principal.
 *   - validateApiKey resolves the bound principal and DENIES (returns null) when that principal
 *     is not active — so suspending/retiring a principal instantly disables all its credentials.
 *     (Closes cold-start adversary MED #3 + /review-impl #6 auth-time check.)
 *   - Legacy keys (principal_id NULL) keep working unchanged (back-compat).
 *
 * Harness mirrors apiKeys.test.ts; cleanup deletes keys BEFORE principals (FK ON DELETE RESTRICT).
 */

import assert from 'node:assert/strict';
import test, { before, after, beforeEach } from 'node:test';
import type { PoolClient } from 'pg';
import { createApiKey, validateApiKey, listApiKeys } from './apiKeys.js';
import { createPrincipal, seedRootPrincipal, setPrincipalStatus, getRootPrincipal } from './principals.js';
import { ContextHubError } from '../core/errors.js';
import { getDbPool } from '../db/client.js';

const PREFIX = '__test_keybind__';

async function cleanup() {
  const pool = getDbPool();
  await pool.query(`DELETE FROM api_keys WHERE name LIKE $1`, [`${PREFIX}%`]);
  await pool.query(`DELETE FROM principals WHERE display_name LIKE $1`, [`${PREFIX}%`]);
}

// This file seeds a root in its root-binding tests — share the advisory lock with the other
// root-creating files so the global single-root slot is never contended under concurrency. [F1c]
const ROOT_TEST_LOCK = 0x1c0b0064;
let rootLockClient: PoolClient | undefined;
before(async () => {
  rootLockClient = await getDbPool().connect();
  await rootLockClient.query('SELECT pg_advisory_lock($1)', [ROOT_TEST_LOCK]);
  await cleanup();
});
after(async () => {
  await cleanup();
  if (rootLockClient) {
    await rootLockClient.query('SELECT pg_advisory_unlock($1)', [ROOT_TEST_LOCK]).catch(() => {});
    rootLockClient.release();
    rootLockClient = undefined;
  }
});
beforeEach(cleanup);

test('createApiKey: binds to an active principal; validateApiKey resolves principal_id', async () => {
  const p = await createPrincipal({ kind: 'agent', display_name: `${PREFIX}codex` });
  const { key, entry } = await createApiKey({ name: `${PREFIX}k1`, principal_id: p.principal_id });
  assert.equal(entry.principal_id, p.principal_id);

  const validated = await validateApiKey(key);
  assert.ok(validated);
  assert.equal(validated.principal_id, p.principal_id);
});

test('createApiKey: the public path never sets is_bootstrap (escalation guard) [adversary #6]', async () => {
  const p = await createPrincipal({ kind: 'agent', display_name: `${PREFIX}nb` });
  const { entry } = await createApiKey({ name: `${PREFIX}knb`, principal_id: p.principal_id });
  const pool = getDbPool();
  const r = await pool.query<{ is_bootstrap: boolean }>(
    `SELECT is_bootstrap FROM api_keys WHERE key_id = $1`,
    [entry.key_id],
  );
  assert.equal(r.rows[0].is_bootstrap, false);
});

test('createApiKey: unknown principal_id -> NOT_FOUND', async () => {
  await assert.rejects(
    () => createApiKey({ name: `${PREFIX}k2`, principal_id: '00000000-0000-0000-0000-000000000000' }),
    (e: unknown) => e instanceof ContextHubError && e.code === 'NOT_FOUND',
  );
});

test('createApiKey: malformed principal_id -> BAD_REQUEST (not a raw pg 500) [review #1]', async () => {
  await assert.rejects(
    () => createApiKey({ name: `${PREFIX}kbad`, principal_id: 'not-a-uuid' }),
    (e: unknown) => e instanceof ContextHubError && e.code === 'BAD_REQUEST',
  );
});

test('listApiKeys: surfaces principal_id for bound keys (FE access-control depends on it) [review #2]', async () => {
  const p = await createPrincipal({ kind: 'agent', display_name: `${PREFIX}listed` });
  await createApiKey({ name: `${PREFIX}klisted`, principal_id: p.principal_id });
  const all = await listApiKeys();
  const mine = all.find((k) => k.name === `${PREFIX}klisted`);
  assert.ok(mine);
  assert.equal(mine.principal_id, p.principal_id);
});

test('createApiKey: cannot bind to a suspended or retired principal -> BAD_REQUEST', async () => {
  const sus = await createPrincipal({ kind: 'agent', display_name: `${PREFIX}sus` });
  await setPrincipalStatus(sus.principal_id, 'suspended');
  await assert.rejects(
    () => createApiKey({ name: `${PREFIX}ksus`, principal_id: sus.principal_id }),
    (e: unknown) => e instanceof ContextHubError && e.code === 'BAD_REQUEST',
  );

  const ret = await createPrincipal({ kind: 'agent', display_name: `${PREFIX}ret` });
  await setPrincipalStatus(ret.principal_id, 'retired');
  await assert.rejects(
    () => createApiKey({ name: `${PREFIX}kret`, principal_id: ret.principal_id }),
    (e: unknown) => e instanceof ContextHubError && e.code === 'BAD_REQUEST',
  );
});

test('createApiKey: cannot bind a key to the root principal via the public path -> BAD_REQUEST', async (t) => {
  const pre = await getRootPrincipal();
  if (pre && !pre.display_name.startsWith(PREFIX)) {
    t.skip('requires a root-free DB; a non-test root principal already exists');
    return;
  }
  const root = await seedRootPrincipal({ display_name: `${PREFIX}root` });
  await assert.rejects(
    () => createApiKey({ name: `${PREFIX}kroot`, principal_id: root.principal_id }),
    (e: unknown) => e instanceof ContextHubError && e.code === 'BAD_REQUEST',
  );
});

test('validateApiKey: suspending the bound principal instantly denies the credential [adversary MED #3]', async () => {
  const p = await createPrincipal({ kind: 'agent', display_name: `${PREFIX}live` });
  const { key } = await createApiKey({ name: `${PREFIX}klive`, principal_id: p.principal_id });

  assert.ok(await validateApiKey(key), 'valid while principal active');

  await setPrincipalStatus(p.principal_id, 'suspended');
  assert.equal(await validateApiKey(key), null, 'denied once principal suspended');

  // re-activation re-enables the credential (suspension is reversible)
  await setPrincipalStatus(p.principal_id, 'active');
  assert.ok(await validateApiKey(key), 'valid again after re-activation');
});

test('validateApiKey: retiring the bound principal permanently denies the credential', async () => {
  const p = await createPrincipal({ kind: 'agent', display_name: `${PREFIX}doomed` });
  const { key } = await createApiKey({ name: `${PREFIX}kdoomed`, principal_id: p.principal_id });
  await setPrincipalStatus(p.principal_id, 'retired');
  assert.equal(await validateApiKey(key), null, 'retired principal => credential denied');
});

test('validateApiKey: legacy key (no principal binding) still validates, principal_id null', async () => {
  const { key, entry } = await createApiKey({ name: `${PREFIX}klegacy` });
  assert.equal(entry.principal_id, null);
  const validated = await validateApiKey(key);
  assert.ok(validated);
  assert.equal(validated.principal_id, null);
});

test('validateApiKey: legacy key validates even when unrelated active principals exist (IS NULL branch locked) [review #3]', async () => {
  // An active principal in the table must not spuriously satisfy the JOIN for a NULL-principal key.
  await createPrincipal({ kind: 'agent', display_name: `${PREFIX}bystander` });
  const { key } = await createApiKey({ name: `${PREFIX}klegacy2` });
  const validated = await validateApiKey(key);
  assert.ok(validated, 'NULL-principal key validates regardless of other active principals');
  assert.equal(validated.principal_id, null);
});

test('validateApiKey: a root-bound key is DENIED at the validator (fail-closed on root) [adversary MED]', async (t) => {
  const pre = await getRootPrincipal();
  if (pre && !pre.display_name.startsWith(PREFIX)) {
    t.skip('requires a root-free DB; a non-test root principal already exists');
    return;
  }
  const root = await seedRootPrincipal({ display_name: `${PREFIX}root` });
  // Simulate an errant root-bound row (the path createApiKey blocks): insert directly.
  const pool = getDbPool();
  const token = 'chub_sk_errant_root_binding_test_value';
  const { createHash } = await import('node:crypto');
  const keyHash = createHash('sha256').update(token).digest('hex');
  await pool.query(
    `INSERT INTO api_keys (name, key_prefix, key_hash, role, principal_id)
     VALUES ($1, $2, $3, 'admin', $4)`,
    [`${PREFIX}krooterrant`, 'chub_sk_...root', keyHash, root.principal_id],
  );
  assert.equal(await validateApiKey(token), null, 'root-bound key must not authenticate via the general validator');
});
