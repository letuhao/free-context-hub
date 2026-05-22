/**
 * Phase 15 Sprint 15.11 — api-key provisioning tests (DEFERRED-016 Q4).
 *
 * Covers actor-identity uniqueness (one active key per name) + per-operator
 * key-count limit + created_by tracking.
 */

import assert from 'node:assert/strict';
import test, { before, after, beforeEach } from 'node:test';
import { createApiKey, revokeApiKey } from './apiKeys.js';
import { getDbPool } from '../db/client.js';
import { getEnv } from '../env.js';

const PREFIX = '__test_authz_key__';

async function cleanup() {
  const pool = getDbPool();
  await pool.query(`DELETE FROM api_keys WHERE name LIKE $1 OR created_by LIKE $1`, [`${PREFIX}%`]);
}

before(cleanup);
after(cleanup);
beforeEach(cleanup);

test('15.11: created_by is tracked on minted keys', async () => {
  const { entry } = await createApiKey({ name: `${PREFIX}alice`, role: 'writer', created_by: `${PREFIX}admin` });
  assert.equal(entry.name, `${PREFIX}alice`);
  const pool = getDbPool();
  const r = await pool.query<{ created_by: string }>(`SELECT created_by FROM api_keys WHERE key_id=$1`, [entry.key_id]);
  assert.equal(r.rows[0].created_by, `${PREFIX}admin`);
});

test('15.11: duplicate active key-name → duplicate_active_key_name', async () => {
  await createApiKey({ name: `${PREFIX}dup`, role: 'writer', created_by: `${PREFIX}admin` });
  await assert.rejects(
    createApiKey({ name: `${PREFIX}dup`, role: 'writer', created_by: `${PREFIX}admin` }),
    (err: any) => {
      assert.equal(err.code, 'BAD_REQUEST');
      assert.ok(err.message.includes('duplicate_active_key_name'));
      return true;
    },
  );
});

test('15.11: a revoked key frees its name — a new key may reuse it', async () => {
  const { entry } = await createApiKey({ name: `${PREFIX}reuse`, role: 'writer', created_by: `${PREFIX}admin` });
  await revokeApiKey(entry.key_id);
  // Now the name is free (partial unique index is WHERE revoked=false)
  const { entry: e2 } = await createApiKey({ name: `${PREFIX}reuse`, role: 'writer', created_by: `${PREFIX}admin` });
  assert.equal(e2.name, `${PREFIX}reuse`);
});

test('15.11: per-operator key-count limit → key_limit_exceeded', async () => {
  const env = getEnv() as { MAX_KEYS_PER_CREATOR: number };
  const original = env.MAX_KEYS_PER_CREATOR;
  try {
    env.MAX_KEYS_PER_CREATOR = 2;
    await createApiKey({ name: `${PREFIX}k1`, created_by: `${PREFIX}op` });
    await createApiKey({ name: `${PREFIX}k2`, created_by: `${PREFIX}op` });
    // third key by the same operator → over the limit
    await assert.rejects(
      createApiKey({ name: `${PREFIX}k3`, created_by: `${PREFIX}op` }),
      (err: any) => {
        assert.equal(err.code, 'BAD_REQUEST');
        assert.ok(err.message.includes('key_limit_exceeded'));
        return true;
      },
    );
  } finally {
    env.MAX_KEYS_PER_CREATOR = original;
  }
});

test('15.11: revoking a key frees a slot under the per-operator limit', async () => {
  const env = getEnv() as { MAX_KEYS_PER_CREATOR: number };
  const original = env.MAX_KEYS_PER_CREATOR;
  try {
    env.MAX_KEYS_PER_CREATOR = 1;
    const { entry } = await createApiKey({ name: `${PREFIX}slot1`, created_by: `${PREFIX}op2` });
    await assert.rejects(createApiKey({ name: `${PREFIX}slot2`, created_by: `${PREFIX}op2` }));
    await revokeApiKey(entry.key_id);
    // slot freed → a new key is mintable
    const { entry: e2 } = await createApiKey({ name: `${PREFIX}slot2`, created_by: `${PREFIX}op2` });
    assert.equal(e2.name, `${PREFIX}slot2`);
  } finally {
    env.MAX_KEYS_PER_CREATOR = original;
  }
});

test('15.11: legacy keys (created_by NULL) are not counted against the limit', async () => {
  const env = getEnv() as { MAX_KEYS_PER_CREATOR: number };
  const original = env.MAX_KEYS_PER_CREATOR;
  try {
    env.MAX_KEYS_PER_CREATOR = 1;
    // No created_by → not attributed to any operator, no limit check
    await createApiKey({ name: `${PREFIX}legacy1` });
    await createApiKey({ name: `${PREFIX}legacy2` });
    await createApiKey({ name: `${PREFIX}legacy3` });
    // all succeed (NULL created_by bypasses the per-operator count)
    assert.ok(true);
  } finally {
    env.MAX_KEYS_PER_CREATOR = original;
  }
});
