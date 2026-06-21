/**
 * Actor Data Boundary — Stream S5 (NHI hardening) service tests.
 * standards-gap.md §3 NHI · COMPLETION-plan §4 (S5 acceptance).
 *
 * Proves the three migration-free operations layered on existing api_keys columns:
 *   - reviewApiKeys()        : flags at-risk keys (unused-≥90d / never-expires /
 *                              ownerless) + correct aggregate stats.
 *   - rotateApiKey()         : mints a working successor; BOTH keys validate
 *                              during the overlap; the old key fails validation
 *                              once its (shortened) overlap elapses; overlap=0
 *                              revokes the old key immediately; transactional.
 *   - createEphemeralApiKey(): short-TTL key validates now, fails once expired;
 *                              TTL is bounded; non-positive TTL rejected.
 *
 * Harness mirrors apiKeysPrincipalBinding.test.ts — real test DB, name-prefix
 * cleanup, cleanup deletes keys BEFORE principals (FK ON DELETE RESTRICT).
 */

import assert from 'node:assert/strict';
import test, { before, after, beforeEach } from 'node:test';
import {
  createApiKey,
  validateApiKey,
  reviewApiKeys,
  rotateApiKey,
  createEphemeralApiKey,
  listApiKeys,
  MAX_EPHEMERAL_TTL_MS,
  MAX_ROTATION_OVERLAP_MS,
} from './apiKeys.js';
import { createPrincipal } from './principals.js';
import { ContextHubError } from '../core/errors.js';
import { getDbPool } from '../db/client.js';

const PREFIX = '__test_nhi__';

async function cleanup() {
  const pool = getDbPool();
  await pool.query(`DELETE FROM api_keys WHERE name LIKE $1`, [`${PREFIX}%`]);
  await pool.query(`DELETE FROM principals WHERE display_name LIKE $1`, [`${PREFIX}%`]);
}

before(cleanup);
after(cleanup);
beforeEach(cleanup);

/** Force a key's columns directly (simulate age / staleness the clock can't reach in a test). */
async function patchKey(keyId: string, set: Record<string, string | null>) {
  const pool = getDbPool();
  const cols = Object.keys(set);
  const assigns = cols.map((c, i) => `${c} = $${i + 2}`).join(', ');
  await pool.query(`UPDATE api_keys SET ${assigns} WHERE key_id = $1`, [keyId, ...cols.map((c) => set[c])]);
}

// ── reviewApiKeys ───────────────────────────────────────────────────────────

test('reviewApiKeys: flags unused-≥90d, never-expires, and ownerless keys', async () => {
  const p = await createPrincipal({ kind: 'agent', display_name: `${PREFIX}owner` });

  // Healthy: bound, expires in future, used recently.
  const healthy = await createApiKey({
    name: `${PREFIX}healthy`,
    principal_id: p.principal_id,
    expires_at: new Date(Date.now() + 90 * 24 * 3600 * 1000).toISOString(),
  });
  await patchKey(healthy.entry.key_id, { last_used_at: new Date().toISOString() });

  // Never-expires + ownerless (legacy key, no principal, no expiry).
  const legacy = await createApiKey({ name: `${PREFIX}legacy` });

  // Unused ≥90d: bound, created long ago, never used.
  const stale = await createApiKey({ name: `${PREFIX}stale`, principal_id: p.principal_id });
  await patchKey(stale.entry.key_id, { created_at: new Date(Date.now() - 200 * 24 * 3600 * 1000).toISOString() });

  const { stats, keys } = await reviewApiKeys();

  const get = (id: string) => keys.find((k) => k.key_id === id);
  const h = get(healthy.entry.key_id)!;
  const l = get(legacy.entry.key_id)!;
  const s = get(stale.entry.key_id)!;

  assert.ok(h && l && s, 'all three active keys appear in the review');

  // healthy: no flags
  assert.equal(h.unused_90d, false);
  assert.equal(h.never_expires, false);
  assert.equal(h.ownerless, false);
  assert.equal(h.principal_name, `${PREFIX}owner`);

  // legacy: never-expires + ownerless
  assert.equal(l.never_expires, true);
  assert.equal(l.ownerless, true);
  assert.equal(l.principal_name, null);

  // stale: unused ≥90d
  assert.equal(s.unused_90d, true);
  assert.ok(s.age_days >= 199, `age computed (~200d), got ${s.age_days}`);
  assert.equal(s.days_since_used, null);

  // aggregate stats count our flagged keys (≥ because the DB may hold other keys)
  assert.ok(stats.total_active >= 3);
  assert.ok(stats.unused_90d >= 1);
  assert.ok(stats.never_expires >= 1);
  assert.ok(stats.ownerless >= 1);
});

test('reviewApiKeys: omits revoked keys', async () => {
  const k = await createApiKey({ name: `${PREFIX}revoked` });
  const pool = getDbPool();
  await pool.query(`UPDATE api_keys SET revoked = true WHERE key_id = $1`, [k.entry.key_id]);
  const { keys } = await reviewApiKeys();
  assert.equal(keys.find((x) => x.key_id === k.entry.key_id), undefined);
});

// ── rotateApiKey ────────────────────────────────────────────────────────────

test('rotateApiKey: successor validates; both keys valid during overlap; old expires after', async () => {
  const p = await createPrincipal({ kind: 'agent', display_name: `${PREFIX}rot` });
  const original = await createApiKey({
    name: `${PREFIX}rotme`,
    role: 'reader',
    principal_id: p.principal_id,
  });

  // Sanity: original works before rotation.
  assert.ok(await validateApiKey(original.key));

  const rotated = await rotateApiKey(original.entry.key_id, { overlapMs: 7 * 24 * 3600 * 1000 });

  // Successor is a real, working credential bound to the same principal + role + scope.
  assert.notEqual(rotated.key, original.key);
  assert.equal(rotated.previous_key_id, original.entry.key_id);
  const succ = await validateApiKey(rotated.key);
  assert.ok(succ, 'successor validates');
  assert.equal(succ.principal_id, p.principal_id);
  assert.equal(succ.role, 'reader');

  // During overlap BOTH validate (zero-downtime).
  assert.ok(await validateApiKey(original.key), 'old key still valid during overlap');
  assert.ok(rotated.old_expires_at, 'old key was given a future expiry');

  // Shorten the overlap into the past → old key now fails the expires_at filter.
  await patchKey(original.entry.key_id, { expires_at: new Date(Date.now() - 1000).toISOString() });
  assert.equal(await validateApiKey(original.key), null, 'old key denied once overlap elapses');
  assert.ok(await validateApiKey(rotated.key), 'successor still valid after old expires');
});

test('rotateApiKey: overlap=0 revokes the old key immediately', async () => {
  const original = await createApiKey({ name: `${PREFIX}rotnow` });
  const rotated = await rotateApiKey(original.entry.key_id, { overlapMs: 0 });
  assert.equal(await validateApiKey(original.key), null, 'old key revoked immediately with no overlap');
  assert.ok(await validateApiKey(rotated.key), 'successor valid');
});

test('rotateApiKey: caps the overlap window at MAX_ROTATION_OVERLAP_MS', async () => {
  const original = await createApiKey({ name: `${PREFIX}rotcap` });
  const rotated = await rotateApiKey(original.entry.key_id, { overlapMs: 999 * 24 * 3600 * 1000 });
  const expiry = new Date(rotated.old_expires_at!).getTime();
  const ceiling = Date.now() + MAX_ROTATION_OVERLAP_MS + 60_000; // small slack
  assert.ok(expiry <= ceiling, `overlap capped (${rotated.old_expires_at})`);
});

test('rotateApiKey: successor name differs from the still-active old name (unique-name index)', async () => {
  const original = await createApiKey({ name: `${PREFIX}rotname` });
  const rotated = await rotateApiKey(original.entry.key_id, { overlapMs: 24 * 3600 * 1000 });
  assert.notEqual(rotated.entry.name, original.entry.name);
  // Both rows are non-revoked during overlap and must coexist under the unique index.
  const all = await listApiKeys();
  const live = all.filter((k) => !k.revoked && (k.key_id === original.entry.key_id || k.key_id === rotated.entry.key_id));
  assert.equal(live.length, 2, 'both old and successor coexist during overlap');
});

test('rotateApiKey: unknown key -> NOT_FOUND; revoked key -> CONFLICT; bad id -> BAD_REQUEST', async () => {
  await assert.rejects(
    () => rotateApiKey('00000000-0000-0000-0000-000000000000'),
    (e: unknown) => e instanceof ContextHubError && e.code === 'NOT_FOUND',
  );
  await assert.rejects(
    () => rotateApiKey('not-a-uuid'),
    (e: unknown) => e instanceof ContextHubError && e.code === 'BAD_REQUEST',
  );
  const k = await createApiKey({ name: `${PREFIX}rotrevoked` });
  const pool = getDbPool();
  await pool.query(`UPDATE api_keys SET revoked = true WHERE key_id = $1`, [k.entry.key_id]);
  await assert.rejects(
    () => rotateApiKey(k.entry.key_id),
    (e: unknown) => e instanceof ContextHubError && e.code === 'CONFLICT',
  );
});

// ── createEphemeralApiKey ───────────────────────────────────────────────────

test('createEphemeralApiKey: key validates now and is denied once its TTL elapses', async () => {
  const p = await createPrincipal({ kind: 'agent', display_name: `${PREFIX}eph` });
  const eph = await createEphemeralApiKey({
    name: `${PREFIX}ephkey`,
    principal_id: p.principal_id,
    ttlMs: 60 * 60 * 1000,
  });
  assert.ok(eph.expires_at, 'ephemeral key carries an expiry');
  assert.equal(eph.entry.principal_id, p.principal_id);

  // Valid before expiry.
  assert.ok(await validateApiKey(eph.key), 'ephemeral key valid before TTL');

  // Push expiry into the past → validation must now fail.
  await patchKey(eph.entry.key_id, { expires_at: new Date(Date.now() - 1000).toISOString() });
  assert.equal(await validateApiKey(eph.key), null, 'ephemeral key denied after TTL');
});

test('createEphemeralApiKey: TTL is capped at MAX_EPHEMERAL_TTL_MS', async () => {
  const eph = await createEphemeralApiKey({ name: `${PREFIX}ephcap`, ttlMs: 999 * 24 * 3600 * 1000 });
  const expiry = new Date(eph.expires_at).getTime();
  const ceiling = Date.now() + MAX_EPHEMERAL_TTL_MS + 60_000;
  assert.ok(expiry <= ceiling, `TTL capped (${eph.expires_at})`);
});

test('createEphemeralApiKey: non-positive TTL -> BAD_REQUEST', async () => {
  await assert.rejects(
    () => createEphemeralApiKey({ name: `${PREFIX}ephbad`, ttlMs: 0 }),
    (e: unknown) => e instanceof ContextHubError && e.code === 'BAD_REQUEST',
  );
  await assert.rejects(
    () => createEphemeralApiKey({ name: `${PREFIX}ephneg`, ttlMs: -5 }),
    (e: unknown) => e instanceof ContextHubError && e.code === 'BAD_REQUEST',
  );
});
