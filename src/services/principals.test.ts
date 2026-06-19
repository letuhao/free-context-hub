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
import {
  createPrincipal,
  getPrincipal,
  getRootPrincipal,
  listPrincipals,
  seedRootPrincipal,
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

before(cleanup);
after(cleanup);
beforeEach(cleanup);

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

test('createPrincipal: cannot set is_root via the normal path', async () => {
  // createPrincipal has no is_root param; the only root path is seedRootPrincipal.
  const p = await createPrincipal({ kind: 'system', display_name: `${PREFIX}sys` });
  assert.equal(p.is_root, false);
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

test('setPrincipalStatus: root status is axiomatic — cannot suspend/retire root [adversary #1]', async () => {
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

test('seedRootPrincipal: sets is_root, discoverable via getRootPrincipal; second seed -> ROOT_EXISTS', async () => {
  const root = await seedRootPrincipal({ display_name: `${PREFIX}root` });
  assert.equal(root.is_root, true);
  assert.equal(root.kind, 'human');

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

test('listPrincipals: returns created rows', async () => {
  await createPrincipal({ kind: 'agent', display_name: `${PREFIX}a` });
  await createPrincipal({ kind: 'agent', display_name: `${PREFIX}b` });
  const all = await listPrincipals();
  const mine = all.filter((p) => p.display_name.startsWith(PREFIX));
  assert.equal(mine.length, 2);
});
