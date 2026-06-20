/**
 * DEFERRED-029 PR C3 — DB-free cross-tenant scope guards.
 *
 * Each fn below uses `assertCallerScope(callerScope, projectId)` at the top of
 * its body, BEFORE opening a connection or issuing any query. When the caller's
 * scope is bound to a project that differs from the resource's project, the
 * helper throws `ContextHubError('NOT_FOUND', 'not found')` — the same shape
 * REST middleware uses (no existence oracle).
 *
 * These tests therefore exercise only the in-process guard; they do not need
 * a database. Entity-id-derive paths (assertTopicScope/Dispute/Intake) are
 * covered by PR F's auth-ON E2E slice (DESIGN §8 and §9).
 *
 * Mirrors `src/services/lessons.test.ts` (PR B cross-tenant block) one-for-one.
 */

import assert from 'node:assert/strict';
import test from 'node:test';

import { submitForReview, listReviewRequests, getReviewRequest, approveReviewRequest, returnReviewRequest } from './reviewRequests.js';
import { ContextHubError } from '../core/errors.js';

const isNotFound = (err: unknown): boolean =>
  err instanceof ContextHubError && err.code === 'NOT_FOUND';

// ── reviewRequests (5) ───────────────────────────────────────────────────────

test('DEFERRED-029: submitForReview cross-tenant → NOT_FOUND', async () => {
  await assert.rejects(
    submitForReview({
      project_id: 'proj-A',
      callerScope: 'proj-B',
      agent_id: 'agent:x',
      lesson_id: '11111111-1111-1111-1111-111111111111',
    }),
    isNotFound,
  );
});

test('DEFERRED-029: listReviewRequests cross-tenant → NOT_FOUND', async () => {
  await assert.rejects(
    listReviewRequests({ project_id: 'proj-A', callerScope: 'proj-B' }),
    isNotFound,
  );
});

test('DEFERRED-029: getReviewRequest cross-tenant → NOT_FOUND', async () => {
  await assert.rejects(
    getReviewRequest({
      project_id: 'proj-A',
      callerScope: 'proj-B',
      request_id: '11111111-1111-1111-1111-111111111111',
    }),
    isNotFound,
  );
});

test('DEFERRED-029: approveReviewRequest cross-tenant → NOT_FOUND', async () => {
  await assert.rejects(
    approveReviewRequest({
      project_id: 'proj-A',
      callerScope: 'proj-B',
      request_id: '11111111-1111-1111-1111-111111111111',
      resolved_by: 'reviewer:x',
    }),
    isNotFound,
  );
});

test('DEFERRED-029: returnReviewRequest cross-tenant → NOT_FOUND', async () => {
  await assert.rejects(
    returnReviewRequest({
      project_id: 'proj-A',
      callerScope: 'proj-B',
      request_id: '11111111-1111-1111-1111-111111111111',
      resolved_by: 'reviewer:x',
      resolution_note: 'needs work',
    }),
    isNotFound,
  );
});

// ── intake (submitIntake/listIntake) MIGRATED to F2f domain 3 (authorize() + grants); their
//    auth-ON enforcement coverage moved to decisions-authz.test.ts. The reviewRequests cases above
//    remain on the DEFERRED-029 callerScope guard until that domain (7) migrates.
