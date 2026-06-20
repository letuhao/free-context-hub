/**
 * DEFERRED-029 PR D1 — cross-tenant scope guards for the EXCHANGE services
 * (exportProject / importProject). These remain on the DEFERRED-029 callerScope
 * guard until F2f domain 7 migrates them.
 *
 * The documents / documentChunks / extraction / generatedDocs cases that lived
 * here were MIGRATED by F2f domain 4 (authorize() + grants) — their auth-ON
 * enforcement coverage moved to `documents-authz.test.ts`.
 */

import assert from 'node:assert/strict';
import test from 'node:test';

import { exportProject } from './exchange/exportProject.js';
import { importProject } from './exchange/importProject.js';
import { ContextHubError } from '../core/errors.js';

const isNotFound = (err: unknown): boolean =>
  err instanceof ContextHubError && err.code === 'NOT_FOUND';

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
