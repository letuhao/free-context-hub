/**
 * DEFERRED-029 PR D1 — DB-free cross-tenant scope guards for exchange,
 * documents, chunks, and generatedDocs services.
 *
 * Each fn uses `assertCallerScope(callerScope, projectId)` at the top of its
 * body (or before opening a connection / issuing any query). When the caller's
 * scope is bound to a project that differs from the resource's project, the
 * helper throws `ContextHubError('NOT_FOUND', 'not found')` — the same shape
 * REST middleware uses (no existence oracle).
 *
 * These tests therefore exercise only the in-process guard; they do not need
 * a database. Entity-id-derive paths (assertDocumentScope on the
 * link/unlink/listDocumentLessons fns) are covered by PR F's auth-ON E2E
 * slice (DESIGN §8 and §9), following the same convention as PR C1/C2/C3.
 *
 * Mirrors `src/services/lessons.test.ts` (PR B) +
 * `src/services/coordination-scope.test.ts` (PR C3) one-for-one.
 */

import assert from 'node:assert/strict';
import test from 'node:test';

import { exportProject } from './exchange/exportProject.js';
import { importProject } from './exchange/importProject.js';
import { createDocument, listDocuments, getDocument, deleteDocument } from './documents.js';
import { searchChunks, searchChunksMulti } from './documentChunks.js';
import { listDocumentChunks, updateChunk, deleteChunk, runExtraction } from './extraction/pipeline.js';
import { upsertGeneratedDocument, listGeneratedDocuments, getGeneratedDocument, promoteGeneratedDocument } from './generatedDocs.js';
import { ContextHubError } from '../core/errors.js';

const isNotFound = (err: unknown): boolean =>
  err instanceof ContextHubError && err.code === 'NOT_FOUND';

// ── exchange (2 of 3 — pullFromRemote is omitted: validates URL synchronously
// before scope check would be useful; covered by exportProject + importProject) ──

test('DEFERRED-029: exportProject cross-tenant → NOT_FOUND', async () => {
  // Pass a no-op Writable; the scope check fires before any write.
  const sink = { write: () => true, end: () => undefined } as unknown as NodeJS.WritableStream;
  await assert.rejects(
    exportProject(
      { projectId: 'proj-A', callerScope: 'proj-B' },
      sink as any,
    ),
    isNotFound,
  );
});

test('DEFERRED-029: importProject cross-tenant → NOT_FOUND', async () => {
  await assert.rejects(
    importProject({
      targetProjectId: 'proj-A',
      callerScope: 'proj-B',
      bundlePath: '/dev/null', // never reached — scope check fires first
    }),
    isNotFound,
  );
});

// ── documents (4 direct-project_id fns) ───────────────────────────────────────

test('DEFERRED-029: createDocument cross-tenant → NOT_FOUND', async () => {
  await assert.rejects(
    createDocument({
      projectId: 'proj-A',
      callerScope: 'proj-B',
      name: 'x',
      docType: 'text',
      content: 'hello',
    }),
    isNotFound,
  );
});

test('DEFERRED-029: listDocuments cross-tenant → NOT_FOUND', async () => {
  await assert.rejects(
    listDocuments({ projectId: 'proj-A', callerScope: 'proj-B' }),
    isNotFound,
  );
});

test('DEFERRED-029: getDocument cross-tenant → NOT_FOUND', async () => {
  await assert.rejects(
    getDocument({
      projectId: 'proj-A',
      callerScope: 'proj-B',
      docId: '11111111-1111-1111-1111-111111111111',
    }),
    isNotFound,
  );
});

test('DEFERRED-029: deleteDocument cross-tenant → NOT_FOUND', async () => {
  await assert.rejects(
    deleteDocument({
      projectId: 'proj-A',
      callerScope: 'proj-B',
      docId: '11111111-1111-1111-1111-111111111111',
    }),
    isNotFound,
  );
});

// ── documentChunks (2 fns) ────────────────────────────────────────────────────

test('DEFERRED-029: searchChunks cross-tenant → NOT_FOUND', async () => {
  await assert.rejects(
    searchChunks({ projectId: 'proj-A', callerScope: 'proj-B', query: 'x' }),
    isNotFound,
  );
});

test('DEFERRED-029: searchChunksMulti cross-tenant → NOT_FOUND (strict-reject)', async () => {
  await assert.rejects(
    searchChunksMulti({
      projectIds: ['proj-A', 'proj-B'],
      callerScope: 'proj-A',
      query: 'x',
    }),
    isNotFound,
  );
});

// ── extraction/pipeline (4 fns) ───────────────────────────────────────────────

test('DEFERRED-029: runExtraction cross-tenant → NOT_FOUND', async () => {
  await assert.rejects(
    runExtraction({
      docId: '11111111-1111-1111-1111-111111111111',
      projectId: 'proj-A',
      callerScope: 'proj-B',
      mode: 'fast',
    }),
    isNotFound,
  );
});

test('DEFERRED-029: listDocumentChunks cross-tenant → NOT_FOUND', async () => {
  await assert.rejects(
    listDocumentChunks({
      docId: '11111111-1111-1111-1111-111111111111',
      projectId: 'proj-A',
      callerScope: 'proj-B',
    }),
    isNotFound,
  );
});

test('DEFERRED-029: updateChunk cross-tenant → NOT_FOUND', async () => {
  await assert.rejects(
    updateChunk({
      docId: '11111111-1111-1111-1111-111111111111',
      chunkId: '22222222-2222-2222-2222-222222222222',
      projectId: 'proj-A',
      callerScope: 'proj-B',
      content: 'x',
    }),
    isNotFound,
  );
});

test('DEFERRED-029: deleteChunk cross-tenant → NOT_FOUND', async () => {
  await assert.rejects(
    deleteChunk({
      docId: '11111111-1111-1111-1111-111111111111',
      chunkId: '22222222-2222-2222-2222-222222222222',
      projectId: 'proj-A',
      callerScope: 'proj-B',
    }),
    isNotFound,
  );
});

// ── generatedDocs (4 fns) ─────────────────────────────────────────────────────

test('DEFERRED-029: upsertGeneratedDocument cross-tenant → NOT_FOUND', async () => {
  await assert.rejects(
    upsertGeneratedDocument({
      projectId: 'proj-A',
      callerScope: 'proj-B',
      docType: 'faq',
      docKey: 'k',
      content: 'c',
    }),
    isNotFound,
  );
});

test('DEFERRED-029: listGeneratedDocuments cross-tenant → NOT_FOUND', async () => {
  await assert.rejects(
    listGeneratedDocuments({ projectId: 'proj-A', callerScope: 'proj-B' }),
    isNotFound,
  );
});

test('DEFERRED-029: getGeneratedDocument cross-tenant → NOT_FOUND', async () => {
  await assert.rejects(
    getGeneratedDocument({
      projectId: 'proj-A',
      callerScope: 'proj-B',
      docId: '11111111-1111-1111-1111-111111111111',
    }),
    isNotFound,
  );
});

test('DEFERRED-029: promoteGeneratedDocument cross-tenant → NOT_FOUND', async () => {
  await assert.rejects(
    promoteGeneratedDocument({
      projectId: 'proj-A',
      callerScope: 'proj-B',
      docId: '11111111-1111-1111-1111-111111111111',
    }),
    isNotFound,
  );
});

// ── back-compat sanity ────────────────────────────────────────────────────────

test('DEFERRED-029: undefined callerScope on listDocuments → unrestricted (falls through)', async () => {
  // Without a DB this will reject — but NOT with NOT_FOUND from scope.
  // We just confirm the rejection is not a scope-helper NOT_FOUND.
  try {
    await listDocuments({ projectId: 'proj-A', callerScope: undefined });
    // If it resolves (somehow with a DB) that's also fine.
  } catch (err) {
    assert.ok(
      !isNotFound(err),
      `undefined scope should NOT throw NOT_FOUND from the scope guard; got: ${(err as Error).message}`,
    );
  }
});

test('DEFERRED-029: null callerScope (global) on listDocuments → unrestricted', async () => {
  try {
    await listDocuments({ projectId: 'proj-A', callerScope: null });
  } catch (err) {
    assert.ok(
      !isNotFound(err),
      `null scope should NOT throw NOT_FOUND from the scope guard; got: ${(err as Error).message}`,
    );
  }
});
