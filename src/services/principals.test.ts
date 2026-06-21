/**
 * Actor Data Boundary F1a — principals service unit tests.
 *
 * Harness mirrors src/services/coordinationEvents.test.ts — real test DB via DATABASE_URL;
 * every fixture display_name carries PREFIX so cleanup is total (incl. the seeded root).
 *
 * Covers:
 *   - createPrincipal: active by default, is_root always false, getPrincipal round-trip
 *   - createPrincipal validation: bad kind, empty display_name
 *   - setPrincipalStatus: active -> suspended -> retired, bad status rejected
 *   - seedRootPrincipal: sets is_root=true; getRootPrincipal finds it; second seed -> ROOT_EXISTS,
 *     still exactly one root (single-root partial unique index holds)
 *   - listPrincipals returns created rows
 */

import assert from 'node:assert/strict';
import test, { before, after, beforeEach } from 'node:test';
import type { PoolClient } from 'pg';
import {
  createPrincipal,
  getPrincipal,
  getRootPrincipal,
  getSystemPrincipal,
  listPrincipals,
  seedRootPrincipal,
  seedSystemPrincipal,
  setPrincipalStatus,
} from './principals.js';
import { ContextHubError } from '../core/errors.js';
import { getDbPool } from '../db/client.js';

const PREFIX = '__test_principals__';

async function cleanup() {
  const pool = getDbPool();
  // api_keys.principal_id is ON DELETE RESTRICT — clear any test keys first (none expected).
  await pool.query(
    `DELETE FROM api_keys WHERE principal_id IN (SELECT principal_id FROM principals WHERE display_name LIKE $1)`,
    [`${PREFIX}%`],
  );
  await pool.query(`DELETE FROM principals WHERE display_name LIKE $1`, [`${PREFIX}%`]);
}

// The single-root index is a GLOBAL singleton, so any two test FILES that create a root collide
// when node:test runs them concurrently. Serialize all root-creating files behind a Postgres
// advisory lock held for this file's duration (auto-released if the process dies). [F1c test-contention]
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

/**
 * is_root is a GLOBAL singleton (principals_single_root_uniq). Root-creating tests can only run
 * on a root-free DB. Once F1c's bootstrap:root seeds a real (non-PREFIX) root into a shared dev
 * DB, these tests would false-RED — so skip gracefully instead, rather than destroying a real
 * root row. [review-impl F1a #1]
 */
async function skipIfForeignRoot(t: { skip: (m?: string) => void }): Promise<boolean> {
  const pre = await getRootPrincipal();
  if (pre && !pre.display_name.startsWith(PREFIX)) {
    t.skip('requires a root-free DB; a non-test root principal already exists');
    return true;
  }
  return false;
}

test('createPrincipal: active agent, is_root false, round-trips via getPrincipal', async () => {
  const p = await createPrincipal({ kind: 'agent', display_name: `${PREFIX}codex` });
  assert.equal(p.kind, 'agent');
  assert.equal(p.status, 'active');
  assert.equal(p.is_root, false);
  assert.ok(p.principal_id && p.principal_id.length >= 32, 'principal_id is an opaque uuid');

  const fetched = await getPrincipal(p.principal_id);
  assert.ok(fetched);
  assert.equal(fetched.principal_id, p.principal_id);
  assert.equal(fetched.display_name, `${PREFIX}codex`);
});

test('getPrincipal: unknown id -> null', async () => {
  const fetched = await getPrincipal('00000000-0000-0000-0000-000000000000');
  assert.equal(fetched, null);
});

test('createPrincipal: rejects bad kind', async () => {
  await assert.rejects(
    () => createPrincipal({ kind: 'robot' as never, display_name: `${PREFIX}x` }),
    (e: unknown) => e instanceof ContextHubError && e.code === 'BAD_REQUEST',
  );
});

test('createPrincipal: rejects empty display_name', async () => {
  await assert.rejects(
    () => createPrincipal({ kind: 'human', display_name: '   ' }),
    (e: unknown) => e instanceof ContextHubError && e.code === 'BAD_REQUEST',
  );
});

test('createPrincipal: cannot set is_root or is_system via the normal path', async () => {
  // createPrincipal has no is_root/is_system param; the only marker paths are seedRoot/seedSystem.
  const p = await createPrincipal({ kind: 'system', display_name: `${PREFIX}sys` });
  assert.equal(p.is_root, false);
  assert.equal(p.is_system, false);
});

/** Mirror skipIfForeignRoot for the is_system singleton (a real bootstrap:system on a shared dev DB). */
async function skipIfForeignSystem(t: { skip: (m?: string) => void }): Promise<boolean> {
  const pre = await getSystemPrincipal();
  if (pre && !pre.display_name.startsWith(PREFIX)) {
    t.skip('requires a system-free DB; a non-test system principal already exists');
    return true;
  }
  return false;
}

test('seedSystemPrincipal: sets is_system=true (NOT root); getSystemPrincipal finds it; second seed -> CONFLICT [F2g]', async (t) => {
  if (await skipIfForeignSystem(t)) return;
  const sys = await seedSystemPrincipal({ display_name: `${PREFIX}system-worker` });
  assert.equal(sys.is_system, true);
  assert.equal(sys.is_root, false);
  assert.equal(sys.kind, 'system');

  const found = await getSystemPrincipal();
  assert.equal(found?.principal_id, sys.principal_id);

  await assert.rejects(
    () => seedSystemPrincipal({ display_name: `${PREFIX}dupe` }),
    (e: unknown) => e instanceof ContextHubError && e.code === 'CONFLICT',
  );
});

test('principals_root_xor_system_chk: a row cannot be BOTH root and system [F2g adv #2]', async (t) => {
  // Run only on a root- AND system-free window so the CHECK (23514) fires, not a singleton index (23505).
  if (await skipIfForeignRoot(t)) return;
  if (await skipIfForeignSystem(t)) return;
  const p = await createPrincipal({ kind: 'system', display_name: `${PREFIX}both` });
  await assert.rejects(
    () =>
      getDbPool().query(`UPDATE principals SET is_root = true, is_system = true WHERE principal_id = $1`, [
        p.principal_id,
      ]),
    (e: unknown) => (e as { code?: string }).code === '23514', // check_violation
  );
});

test('setPrincipalStatus: active -> suspended -> retired; bad status rejected', async () => {
  const p = await createPrincipal({ kind: 'agent', display_name: `${PREFIX}toggle` });
  const sus = await setPrincipalStatus(p.principal_id, 'suspended');
  assert.equal(sus.status, 'suspended');
  const ret = await setPrincipalStatus(p.principal_id, 'retired');
  assert.equal(ret.status, 'retired');
  await assert.rejects(
    () => setPrincipalStatus(p.principal_id, 'banished' as never),
    (e: unknown) => e instanceof ContextHubError && e.code === 'BAD_REQUEST',
  );
});

test('setPrincipalStatus: retired is terminal — retired -> active rejected (no resurrection) [adversary #2]', async () => {
  const p = await createPrincipal({ kind: 'agent', display_name: `${PREFIX}dead` });
  await setPrincipalStatus(p.principal_id, 'retired');
  await assert.rejects(
    () => setPrincipalStatus(p.principal_id, 'active'),
    (e: unknown) => e instanceof ContextHubError && e.code === 'CONFLICT',
  );
  const still = await getPrincipal(p.principal_id);
  assert.equal(still?.status, 'retired');
});

test('setPrincipalStatus: suspended <-> active stays reversible', async () => {
  const p = await createPrincipal({ kind: 'agent', display_name: `${PREFIX}sus` });
  await setPrincipalStatus(p.principal_id, 'suspended');
  const back = await setPrincipalStatus(p.principal_id, 'active');
  assert.equal(back.status, 'active');
});

test('setPrincipalStatus: root status is axiomatic — cannot suspend/retire root [adversary #1]', async (t) => {
  if (await skipIfForeignRoot(t)) return;
  const root = await seedRootPrincipal({ display_name: `${PREFIX}root` });
  await assert.rejects(
    () => setPrincipalStatus(root.principal_id, 'suspended'),
    (e: unknown) => e instanceof ContextHubError && e.code === 'CONFLICT',
  );
  await assert.rejects(
    () => setPrincipalStatus(root.principal_id, 'retired'),
    (e: unknown) => e instanceof ContextHubError && e.code === 'CONFLICT',
  );
  const still = await getRootPrincipal();
  assert.equal(still?.status, 'active');
  assert.equal(still?.is_root, true);
});

test('setPrincipalStatus: unknown principal -> NOT_FOUND', async () => {
  await assert.rejects(
    () => setPrincipalStatus('00000000-0000-0000-0000-000000000000', 'suspended'),
    (e: unknown) => e instanceof ContextHubError && e.code === 'NOT_FOUND',
  );
});

test('seedRootPrincipal: sets is_root, discoverable via getRootPrincipal; second seed -> ROOT_EXISTS', async (t) => {
  if (await skipIfForeignRoot(t)) return;
  const root = await seedRootPrincipal({ display_name: `${PREFIX}root` });
  assert.equal(root.is_root, true);
  assert.equal(root.kind, 'system'); // root = headless trust anchor, not a person (F1c)

  const found = await getRootPrincipal();
  assert.ok(found);
  assert.equal(found.principal_id, root.principal_id);
  assert.equal(found.is_root, true);

  await assert.rejects(
    () => seedRootPrincipal({ display_name: `${PREFIX}root2` }),
    (e: unknown) => e instanceof ContextHubError && e.code === 'CONFLICT',
  );

  // still exactly one root with the test prefix
  const pool = getDbPool();
  const res = await pool.query(
    `SELECT count(*)::int AS n FROM principals WHERE is_root = true AND display_name LIKE $1`,
    [`${PREFIX}%`],
  );
  assert.equal(res.rows[0].n, 1);
});

test('seedRootPrincipal: concurrent seeders -> exactly one root (singleton invariant) [review-impl #3]', async (t) => {
  if (await skipIfForeignRoot(t)) return;
  const results = await Promise.allSettled([
    seedRootPrincipal({ display_name: `${PREFIX}race1` }),
    seedRootPrincipal({ display_name: `${PREFIX}race2` }),
  ]);
  const fulfilled = results.filter((r) => r.status === 'fulfilled');
  const conflicts = results.filter(
    (r) => r.status === 'rejected' && (r.reason as ContextHubError)?.code === 'CONFLICT',
  );
  assert.equal(fulfilled.length, 1, 'exactly one seeder succeeds');
  assert.equal(conflicts.length, 1, 'the loser gets CONFLICT (read-check or 23505 catch)');

  const pool = getDbPool();
  const res = await pool.query(
    `SELECT count(*)::int AS n FROM principals WHERE is_root = true AND display_name LIKE $1`,
    [`${PREFIX}%`],
  );
  assert.equal(res.rows[0].n, 1, 'exactly one root row committed');
});

test('listPrincipals: returns created rows', async () => {
  await createPrincipal({ kind: 'agent', display_name: `${PREFIX}a` });
  await createPrincipal({ kind: 'agent', display_name: `${PREFIX}b` });
  const all = await listPrincipals();
  const mine = all.filter((p) => p.display_name.startsWith(PREFIX));
  assert.equal(mine.length, 2);
});
