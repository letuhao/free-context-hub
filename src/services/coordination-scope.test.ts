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
import { submitIntake, listIntake } from './intake.js';
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

// ── intake (2 — direct-project_id fns) ───────────────────────────────────────
// triageIntake / dismissIntake / getIntake derive from intake_id and are
// covered by the PR F auth-ON E2E slice (DESIGN §8 + §9).

test('DEFERRED-029: submitIntake cross-tenant → NOT_FOUND', async () => {
  await assert.rejects(
    submitIntake({
      project_id: 'proj-A',
      callerScope: 'proj-B',
      kind: 'suggestion',
      body: 'hello',
      submitted_by: 'agent:x',
    }),
    isNotFound,
  );
});

test('DEFERRED-029: listIntake cross-tenant → NOT_FOUND', async () => {
  await assert.rejects(
    listIntake('proj-A', { callerScope: 'proj-B' }),
    isNotFound,
  );
});

// ── back-compat sanity: undefined / null are unrestricted ────────────────────
// We can't fully exercise the happy path without a DB, but we can prove the
// guard does NOT throw on undefined/null and instead progresses to the next
// validation step. (For undefined we'd reach DB; the assertion below uses
// missing required fields to force a synchronous BAD_REQUEST before any DB
// call.)

test('DEFERRED-029: undefined callerScope → unrestricted (no NOT_FOUND from scope)', async () => {
  await assert.rejects(
    submitIntake({
      project_id: 'proj-A',
      callerScope: undefined,
      kind: '', // forces BAD_REQUEST before DB
      body: 'hello',
      submitted_by: 'agent:x',
    }),
    (err: unknown) =>
      err instanceof ContextHubError && err.code === 'BAD_REQUEST',
    'undefined callerScope should NOT trigger NOT_FOUND — must fall through to next check',
  );
});

test('DEFERRED-029: null callerScope (global key) → unrestricted', async () => {
  await assert.rejects(
    submitIntake({
      project_id: 'proj-A',
      callerScope: null,
      kind: '', // forces BAD_REQUEST before DB
      body: 'hello',
      submitted_by: 'agent:x',
    }),
    (err: unknown) =>
      err instanceof ContextHubError && err.code === 'BAD_REQUEST',
    'null callerScope (global) should NOT trigger NOT_FOUND',
  );
});
