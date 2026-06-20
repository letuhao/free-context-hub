/**
 * DEFERRED-029 PR D3 — DB-free cross-tenant scope guards for jobQueue.
 *
 * jobQueue (enqueueJob/listJobs/cancelJob) uses direct project_id paths
 * (assertCallerScope). Cross-tenant attempts yield ContextHubError('NOT_FOUND').
 *
 * NOTE: the taxonomyService / projectGroups / replayEvents cases that once lived
 * here were MIGRATED to authorize() + grants (F2f domain 7); their auth-ON
 * coverage now lives in domain7-authz.test.ts. artifactLeases moved to
 * board-authz.test.ts (F2f domain 2). jobQueue stays on the DEFERRED-029 guard:
 * its SEC-1/3/5/6 hardening keys off callerScope as a data value and needs an
 * actor-native redesign before migration (see DEFERRED.md F2f-jobs).
 */

import assert from 'node:assert/strict';
import test from 'node:test';

import { enqueueJob, listJobs, cancelJob } from './jobQueue.js';
import { ContextHubError } from '../core/errors.js';

const isNotFound = (err: unknown): boolean =>
  err instanceof ContextHubError && err.code === 'NOT_FOUND';

// ── jobQueue (4 — direct project_id when project_id is set) ───────────────────

test('DEFERRED-029: enqueueJob cross-tenant → NOT_FOUND', async () => {
  await assert.rejects(
    enqueueJob({
      project_id: 'proj-A',
      callerScope: 'proj-B',
      job_type: 'index.run',
      payload: {},
    }),
    isNotFound,
  );
});

test('DEFERRED-029: listJobs cross-tenant (single projectId) → NOT_FOUND', async () => {
  await assert.rejects(
    listJobs({ projectId: 'proj-A', callerScope: 'proj-B' }),
    isNotFound,
  );
});

test('DEFERRED-029: listJobs cross-tenant (multi projectIds) → NOT_FOUND (strict-reject)', async () => {
  await assert.rejects(
    listJobs({ projectIds: ['proj-A', 'proj-B'], callerScope: 'proj-A' }),
    isNotFound,
  );
});

test('DEFERRED-029: cancelJob cross-tenant → NOT_FOUND', async () => {
  await assert.rejects(
    cancelJob('11111111-1111-1111-1111-111111111111', 'proj-A', { callerScope: 'proj-B' }),
    isNotFound,
  );
});
