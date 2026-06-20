/**
 * DEFERRED-029 PR D4 — DB-free cross-tenant scope guards for guardrails.
 *
 * These fns use direct project_id paths (assertCallerScope).
 *
 * NOTE: the indexer / retriever / tieredRetriever / KG / snapshot / deleteWorkspace cases that
 * once lived here have been MIGRATED to authorize() + grants (F2f domains 5–6); their auth-ON
 * coverage now lives in search-authz.test.ts and git-workspace-scope.test.ts. The guardrails
 * cases below stay on the DEFERRED-029 callerScope guard until domain 7 migrates them.
 */

import assert from 'node:assert/strict';
import test from 'node:test';

import { listGuardrailRules, simulateGuardrails, checkGuardrails } from './guardrails.js';
import { ContextHubError } from '../core/errors.js';

const isNotFound = (err: unknown): boolean =>
  err instanceof ContextHubError && err.code === 'NOT_FOUND';

// ── guardrails (4) ────────────────────────────────────────────────────────────

test('DEFERRED-029: listGuardrailRules cross-tenant → NOT_FOUND', async () => {
  await assert.rejects(
    listGuardrailRules('proj-A', { callerScope: 'proj-B' }),
    isNotFound,
  );
});

test('DEFERRED-029: listGuardrailRules multi cross-tenant → NOT_FOUND (strict-reject)', async () => {
  await assert.rejects(
    listGuardrailRules(['proj-A', 'proj-B'], { callerScope: 'proj-A' }),
    isNotFound,
  );
});

test('DEFERRED-029: simulateGuardrails cross-tenant → NOT_FOUND', async () => {
  await assert.rejects(
    simulateGuardrails('proj-A', ['git push'], { callerScope: 'proj-B' }),
    isNotFound,
  );
});

test('DEFERRED-029: checkGuardrails cross-tenant → NOT_FOUND', async () => {
  await assert.rejects(
    checkGuardrails('proj-A', { action: 'git push' }, { callerScope: 'proj-B' }),
    isNotFound,
  );
});
