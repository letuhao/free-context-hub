/**
 * Actor Data Boundary F2f domain 6 (search / retrieval / indexer / KG) — auth-ON cross-actor enforcement.
 *
 * retriever (searchCode), tieredRetriever (tieredSearch), indexer (indexProject), and the four KG
 * query fns (searchSymbols/getSymbolNeighbors/traceDependencyPath/getLessonImpact) lost their
 * assertCallerScope guards; authorize() + grants is the gate. All are project-scoped. assertAuthorized
 * runs FIRST in each fn (before any embedding / Neo4j / fs / DB work), so a deny throws before side
 * effects — and the KG feature-toggle short-circuit never masks a cross-tenant attempt. Reads deny as
 * NOT_FOUND (no oracle); the write (indexProject) denies as FORBIDDEN on a resolvable project. Real DB
 * + auth-ON toggling. (Replaces the DEFERRED-029 callerScope cross-tenant cases in d4-scope.test.ts.)
 */

import assert from 'node:assert/strict';
import test, { before, after } from 'node:test';
import { searchCode } from './retriever.js';
import { tieredSearch } from './tieredRetriever.js';
import { indexProject } from './indexer.js';
import { searchSymbols, getSymbolNeighbors, traceDependencyPath, getLessonImpact } from '../kg/query.js';
import { globalSearch } from './globalSearch.js';
import { createPrincipal } from './principals.js';
import { createGrant } from './grants.js';
import { ContextHubError } from '../core/errors.js';
import { getDbPool } from '../db/client.js';

const PREFIX = '__test_search_authz__';
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

// ── reads: cross-tenant project Q → NOT_FOUND (deny before embedding / Neo4j work) ──
test('reader@P: searchCode cross-tenant → NOT_FOUND', async () => {
  await assert.rejects(searchCode({ projectId: Q, actingPrincipalId: reader, query: 'x' }), isNotFound);
});
test('reader@P: tieredSearch cross-tenant → NOT_FOUND', async () => {
  await assert.rejects(tieredSearch({ projectId: Q, actingPrincipalId: reader, query: 'x' }), isNotFound);
});
test('reader@P: searchSymbols cross-tenant → NOT_FOUND', async () => {
  await assert.rejects(searchSymbols({ projectId: Q, actingPrincipalId: reader, query: 'x' }), isNotFound);
});
test('reader@P: getSymbolNeighbors cross-tenant → NOT_FOUND', async () => {
  await assert.rejects(getSymbolNeighbors({ projectId: Q, actingPrincipalId: reader, symbolId: 'sym:x' }), isNotFound);
});
test('reader@P: traceDependencyPath cross-tenant → NOT_FOUND', async () => {
  await assert.rejects(
    traceDependencyPath({ projectId: Q, actingPrincipalId: reader, fromSymbolId: 'sym:a', toSymbolId: 'sym:b' }),
    isNotFound,
  );
});
test('reader@P: getLessonImpact cross-tenant → NOT_FOUND', async () => {
  await assert.rejects(
    getLessonImpact({ projectId: Q, actingPrincipalId: reader, lessonId: '11111111-1111-1111-1111-111111111111' }),
    isNotFound,
  );
});

// ── write: cross-tenant project Q → FORBIDDEN (resolvable project) ──
test('reader@P: indexProject cross-tenant → FORBIDDEN', async () => {
  await assert.rejects(indexProject({ projectId: Q, actingPrincipalId: reader, root: '/tmp/x' }), isForbidden);
});

// ── over-capability on own project + allow ──
test('reader@P: indexProject on own project (read ⊅ write) → FORBIDDEN', async () => {
  await assert.rejects(indexProject({ projectId: P, actingPrincipalId: reader, root: '/tmp/x' }), isForbidden);
});
test('reader@P: searchSymbols on P → ALLOW (passes the gate; no authz denial)', async () => {
  // The grant lets the read THROUGH authorize(). Past the gate the KG path either
  // short-circuits (KG disabled → empty matches) or reaches Neo4j (which is not up
  // in the unit env → ServiceUnavailable). Either way proves no NOT_FOUND/FORBIDDEN denial.
  try {
    const res = await searchSymbols({ projectId: P, actingPrincipalId: reader, query: 'x' });
    assert.ok(Array.isArray(res.matches));
  } catch (e) {
    assert.ok(!isNotFound(e) && !isForbidden(e), `expected a non-authz error past the gate, got ${String(e)}`);
  }
});
test('unknown principal: searchCode on P → NOT_FOUND', async () => {
  await assert.rejects(
    searchCode({ projectId: P, actingPrincipalId: '00000000-0000-0000-0000-000000000000', query: 'x' }),
    isNotFound,
  );
});

// ── globalSearch (Cmd+K palette) — adversary-pass fix: was an unguarded cross-tenant read surface ──
test('reader@P: globalSearch cross-tenant → NOT_FOUND', async () => {
  await assert.rejects(globalSearch({ projectId: Q, actingPrincipalId: reader, query: 'x' }), isNotFound);
});
test('reader@P: globalSearch on P → ALLOW (resolves through the gate → result shape)', async () => {
  const res = await globalSearch({ projectId: P, actingPrincipalId: reader, query: 'x' });
  assert.ok(Array.isArray(res.lessons) && Array.isArray(res.documents) && Array.isArray(res.guardrails));
});
