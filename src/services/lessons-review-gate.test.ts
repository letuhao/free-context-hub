/**
 * Review gate on default semantic retrieval (QC FINDING-GOV, owner decision 2026-06-22).
 *
 * searchLessons / searchLessonsMulti must serve ONLY approved (active) knowledge by default:
 * draft + pending-review are withheld until a lesson is active, so unreviewed / under-review
 * AI content never surfaces as agent knowledge. include_all_statuses=true opts back in to every
 * status. (The human browse listLessons is intentionally unchanged — see lessons.ts.)
 *
 * Deterministic + embedder-independent: EMBEDDINGS_BASE_URL is pointed at a dead port to force
 * the FTS-only path, and fixtures populate the `fts` tsvector directly so retrieval doesn't need
 * a live embedder. The status gate lives in the shared WHERE clause, so FTS-only exercises it.
 */

import assert from 'node:assert/strict';
import test, { before, after } from 'node:test';
import { searchLessons, searchLessonsMulti } from './lessons.js';
import { createPrincipal } from './principals.js';
import { createGrant } from './grants.js';
import { getDbPool } from '../db/client.js';

const PREFIX = '__test_review_gate__';
const PROJECT = `${PREFIX}proj`;
const TOKEN = 'zqcgatetoken'; // unique FTS term shared by all three fixtures

let reader: string;
let grantor: string;
const ids: Record<string, string> = {};
const saved = { auth: process.env.MCP_AUTH_ENABLED, emb: process.env.EMBEDDINGS_BASE_URL };

async function setEnv(authOn: boolean) {
  process.env.MCP_AUTH_ENABLED = authOn ? 'true' : 'false';
  // Dead embeddings endpoint → searchLessons falls back to FTS-only (no live embedder needed).
  process.env.EMBEDDINGS_BASE_URL = 'http://127.0.0.1:1';
  const { _resetEnvCacheForTest } = await import('../env.js');
  _resetEnvCacheForTest();
}

async function insertLesson(status: string): Promise<string> {
  const pool = getDbPool();
  const r = await pool.query(
    `INSERT INTO lessons (lesson_id, project_id, lesson_type, title, content, status, captured_by, fts)
     VALUES (gen_random_uuid(), $1, 'workaround', $2, $3, $4, 'qc',
             to_tsvector('english', $2 || ' ' || $3))
     RETURNING lesson_id`,
    [PROJECT, `${TOKEN} ${status} fixture`, `${TOKEN} body for the ${status} review-gate fixture`, status],
  );
  return r.rows[0].lesson_id as string;
}

async function cleanup() {
  const pool = getDbPool();
  await pool.query(`DELETE FROM lessons WHERE project_id = $1`, [PROJECT]);
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
  await createGrant({ grantee_principal: reader, scope_type: 'project', scope_id: PROJECT, capability: 'read', granted_by: grantor });
  ids.active = await insertLesson('active');
  ids.draft = await insertLesson('draft');
  ids.pending = await insertLesson('pending-review');
  await setEnv(true);
});

after(async () => {
  await cleanup();
  if (saved.auth === undefined) delete process.env.MCP_AUTH_ENABLED; else process.env.MCP_AUTH_ENABLED = saved.auth;
  if (saved.emb === undefined) delete process.env.EMBEDDINGS_BASE_URL; else process.env.EMBEDDINGS_BASE_URL = saved.emb;
  const { _resetEnvCacheForTest } = await import('../env.js');
  _resetEnvCacheForTest();
});

test('searchLessons default: returns only active — draft + pending-review withheld', async () => {
  const res = await searchLessons({ projectId: PROJECT, actingPrincipalId: reader, query: TOKEN });
  const got = new Set(res.matches.map((m) => m.lesson_id));
  assert.ok(got.has(ids.active), 'active lesson must be retrievable by default');
  assert.ok(!got.has(ids.draft), 'draft lesson must NOT be in default retrieval');
  assert.ok(!got.has(ids.pending), 'pending-review lesson must NOT be in default retrieval (review gate)');
});

test('searchLessons include_all_statuses=true: opts back in to draft + pending-review', async () => {
  const res = await searchLessons({
    projectId: PROJECT,
    actingPrincipalId: reader,
    query: TOKEN,
    filters: { include_all_statuses: true },
  });
  const got = new Set(res.matches.map((m) => m.lesson_id));
  assert.ok(got.has(ids.active), 'active still present');
  assert.ok(got.has(ids.draft), 'draft present with include_all_statuses');
  assert.ok(got.has(ids.pending), 'pending-review present with include_all_statuses');
});

test('searchLessonsMulti default: review gate applies to multi-project retrieval too', async () => {
  const res = await searchLessonsMulti({ projectIds: [PROJECT], actingPrincipalId: reader, query: TOKEN });
  const got = new Set(res.matches.map((m) => m.lesson_id));
  assert.ok(got.has(ids.active), 'active retrievable');
  assert.ok(!got.has(ids.draft) && !got.has(ids.pending), 'draft + pending-review withheld in multi-project default');
});
