/**
 * Actor Data Boundary F2f domain 4 (documents) — auth-ON cross-actor enforcement.
 *
 * documents/documentChunks/generatedDocs/extraction lost their assertCallerScope/assertDocumentScope/
 * assertLessonScope guards; authorize() + grants is the gate. A principal granted READ on project P is
 * denied OUTSIDE its grants (cross-tenant read → NOT_FOUND) and ABOVE its capability (createDocument
 * write, deleteDocument admin → FORBIDDEN). Exercises the F2f doc→project resolver (the lesson→project
 * resolver shares the same code path). Real DB + auth-ON toggling.
 */

import assert from 'node:assert/strict';
import test, { before, after } from 'node:test';
import { createDocument, listDocuments, getDocument, deleteDocument, linkDocumentToLesson, unlinkDocumentFromLesson, listDocumentLessons } from './documents.js';
import { searchChunks } from './documentChunks.js';
import { createPrincipal } from './principals.js';
import { createGrant } from './grants.js';
import { ContextHubError } from '../core/errors.js';
import { getDbPool } from '../db/client.js';

const PREFIX = '__test_documents_authz__';
const P = `${PREFIX}projP`;
const Q = `${PREFIX}projQ`;
const FAKE_UUID = '11111111-1111-1111-1111-111111111111';

const isNotFound = (e: unknown) => e instanceof ContextHubError && e.code === 'NOT_FOUND';
const isForbidden = (e: unknown) => e instanceof ContextHubError && e.code === 'FORBIDDEN';

let reader: string; // granted read@P only
let grantor: string;
let docQ: string;
const saved = { auth: process.env.MCP_AUTH_ENABLED };

async function setAuth(on: boolean) {
  process.env.MCP_AUTH_ENABLED = on ? 'true' : 'false';
  const { _resetEnvCacheForTest } = await import('../env.js');
  _resetEnvCacheForTest();
}

async function cleanup() {
  const pool = getDbPool();
  await pool.query(`DELETE FROM documents WHERE project_id LIKE $1`, [`${PREFIX}%`]);
  await pool.query(
    `DELETE FROM grants WHERE grantee_principal IN (SELECT principal_id FROM principals WHERE display_name LIKE $1)
        OR granted_by IN (SELECT principal_id FROM principals WHERE display_name LIKE $1)`,
    [`${PREFIX}%`],
  );
  await pool.query(`DELETE FROM principals WHERE display_name LIKE $1`, [`${PREFIX}%`]);
}

before(async () => {
  await cleanup();
  const pool = getDbPool();
  reader = (await createPrincipal({ kind: 'agent', display_name: `${PREFIX}reader` })).principal_id;
  grantor = (await createPrincipal({ kind: 'agent', display_name: `${PREFIX}grantor` })).principal_id;
  await createGrant({ grantee_principal: reader, scope_type: 'project', scope_id: P, capability: 'read', granted_by: grantor });
  const dq = await pool.query<{ doc_id: string }>(
    `INSERT INTO documents (project_id, name, doc_type) VALUES ($1,'dq','text') RETURNING doc_id`,
    [Q],
  );
  docQ = dq.rows[0].doc_id;
  await setAuth(true);
});
after(async () => {
  await cleanup();
  if (saved.auth === undefined) delete process.env.MCP_AUTH_ENABLED;
  else process.env.MCP_AUTH_ENABLED = saved.auth;
  const { _resetEnvCacheForTest } = await import('../env.js');
  _resetEnvCacheForTest();
});

test('reader@P: createDocument WRITE cross-tenant (project Q) → FORBIDDEN', async () => {
  await assert.rejects(
    createDocument({ projectId: Q, actingPrincipalId: reader, name: 'x', docType: 'text' }),
    isForbidden,
  );
});

test('reader@P: createDocument WRITE on own project (read ⊅ write) → FORBIDDEN', async () => {
  await assert.rejects(
    createDocument({ projectId: P, actingPrincipalId: reader, name: 'x', docType: 'text' }),
    isForbidden,
  );
});

test('reader@P: listDocuments READ cross-tenant (project Q) → NOT_FOUND', async () => {
  await assert.rejects(listDocuments({ projectId: Q, actingPrincipalId: reader }), isNotFound);
});

test('reader@P: getDocument READ cross-tenant (project Q) → NOT_FOUND', async () => {
  await assert.rejects(getDocument({ docId: FAKE_UUID, projectId: Q, actingPrincipalId: reader }), isNotFound);
});

test('reader@P: deleteDocument ADMIN on own project (read ⊅ admin) → FORBIDDEN', async () => {
  await assert.rejects(deleteDocument({ docId: FAKE_UUID, projectId: P, actingPrincipalId: reader }), isForbidden);
});

test('reader@P: searchChunks READ cross-tenant (project Q) → NOT_FOUND', async () => {
  await assert.rejects(searchChunks({ projectId: Q, actingPrincipalId: reader, query: 'x' }), isNotFound);
});

test('reader@P: listDocumentLessons READ cross-tenant (doc in Q, via doc→project resolver) → NOT_FOUND', async () => {
  await assert.rejects(listDocumentLessons({ docId: docQ, actingPrincipalId: reader }), isNotFound);
});

test('reader@P: linkDocumentToLesson on a cross-tenant doc (doc resolver) → NOT_FOUND', async () => {
  // doc check runs first; docQ resolves to Q where reader has no grant → read-shape NOT_FOUND
  // (linkDocumentToLesson asks write, but a deny on an unreachable resource surfaces as NOT_FOUND
  // only for read; write-deny on a resolvable doc is FORBIDDEN). docQ IS resolvable → FORBIDDEN.
  await assert.rejects(
    linkDocumentToLesson({ docId: docQ, lessonId: FAKE_UUID, actingPrincipalId: reader }),
    isForbidden,
  );
});

// PR F SEC-4 (migrated): the document_lessons edge has no project_id — both endpoints are
// authorized. An unresolvable doc id (or a cross-tenant one) is rejected BEFORE any edge write, so
// a scoped caller can't forge a cross-tenant link or probe lesson existence via rowCount.
test('reader@P: linkDocumentToLesson on an unresolvable doc → NOT_FOUND (no edge, no oracle)', async () => {
  await assert.rejects(
    linkDocumentToLesson({ docId: FAKE_UUID, lessonId: FAKE_UUID, actingPrincipalId: reader }),
    isNotFound,
  );
});

test('reader@P: unlinkDocumentFromLesson on an unresolvable doc → NOT_FOUND (no probe oracle)', async () => {
  await assert.rejects(
    unlinkDocumentFromLesson({ docId: FAKE_UUID, lessonId: FAKE_UUID, actingPrincipalId: reader }),
    isNotFound,
  );
});

test('reader@P: listDocuments READ on P → ALLOW (resolves through the gate)', async () => {
  const r = await listDocuments({ projectId: P, actingPrincipalId: reader });
  assert.ok(Array.isArray(r.items));
});

test('unknown principal: listDocuments READ → NOT_FOUND', async () => {
  await assert.rejects(
    listDocuments({ projectId: P, actingPrincipalId: '00000000-0000-0000-0000-000000000000' }),
    isNotFound,
  );
});
