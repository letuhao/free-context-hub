/**
 * DEFERRED-029 PR D4 — DB-free cross-tenant scope guards for guardrails +
 * snapshot + indexer + retriever + tieredRetriever + KG + deleteWorkspace.
 *
 * All these fns use direct project_id paths (assertCallerScope).
 * KG fns also have feature-toggle short-circuits (returning empty arrays)
 * but assertCallerScope fires BEFORE those, so cross-tenant attempts
 * yield NOT_FOUND even when KG is disabled.
 *
 * Mirrors lessons.test.ts / coordination-scope.test.ts / documents-scope.test.ts
 * / git-workspace-scope.test.ts / d3-scope.test.ts one-for-one.
 */

import assert from 'node:assert/strict';
import test from 'node:test';

import { listGuardrailRules, simulateGuardrails, checkGuardrails } from './guardrails.js';
import { getProjectSnapshotBody, rebuildProjectSnapshot } from './snapshot.js';
import { indexProject } from './indexer.js';
import { searchCode } from './retriever.js';
import { tieredSearch } from './tieredRetriever.js';
import { searchSymbols, getSymbolNeighbors, traceDependencyPath, getLessonImpact } from '../kg/query.js';
import { deleteWorkspace } from './lessons.js';
import { ContextHubError } from '../core/errors.js';

const isNotFound = (err: unknown): boolean =>
  err instanceof ContextHubError && err.code === 'NOT_FOUND';

// ── guardrails (3) ────────────────────────────────────────────────────────────

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

// ── snapshot (2) ──────────────────────────────────────────────────────────────

test('DEFERRED-029: getProjectSnapshotBody cross-tenant → NOT_FOUND', async () => {
  await assert.rejects(
    getProjectSnapshotBody('proj-A', { callerScope: 'proj-B' }),
    isNotFound,
  );
});

test('DEFERRED-029: rebuildProjectSnapshot cross-tenant → NOT_FOUND', async () => {
  await assert.rejects(
    rebuildProjectSnapshot('proj-A', { callerScope: 'proj-B' }),
    isNotFound,
  );
});

// ── indexer (1) ───────────────────────────────────────────────────────────────

test('DEFERRED-029: indexProject cross-tenant → NOT_FOUND', async () => {
  await assert.rejects(
    indexProject({ projectId: 'proj-A', callerScope: 'proj-B', root: '/tmp/x' }),
    isNotFound,
  );
});

// ── retriever / tieredRetriever (2) ───────────────────────────────────────────

test('DEFERRED-029: searchCode cross-tenant → NOT_FOUND', async () => {
  await assert.rejects(
    searchCode({ projectId: 'proj-A', callerScope: 'proj-B', query: 'x' }),
    isNotFound,
  );
});

test('DEFERRED-029: tieredSearch cross-tenant → NOT_FOUND', async () => {
  await assert.rejects(
    tieredSearch({ projectId: 'proj-A', callerScope: 'proj-B', query: 'x' }),
    isNotFound,
  );
});

// ── KG (4) ────────────────────────────────────────────────────────────────────

test('DEFERRED-029: searchSymbols cross-tenant → NOT_FOUND', async () => {
  await assert.rejects(
    searchSymbols({ projectId: 'proj-A', callerScope: 'proj-B', query: 'x' }),
    isNotFound,
  );
});

test('DEFERRED-029: getSymbolNeighbors cross-tenant → NOT_FOUND', async () => {
  await assert.rejects(
    getSymbolNeighbors({ projectId: 'proj-A', callerScope: 'proj-B', symbolId: 'sym:x' }),
    isNotFound,
  );
});

test('DEFERRED-029: traceDependencyPath cross-tenant → NOT_FOUND', async () => {
  await assert.rejects(
    traceDependencyPath({
      projectId: 'proj-A',
      callerScope: 'proj-B',
      fromSymbolId: 'sym:a',
      toSymbolId: 'sym:b',
    }),
    isNotFound,
  );
});

test('DEFERRED-029: getLessonImpact cross-tenant → NOT_FOUND', async () => {
  await assert.rejects(
    getLessonImpact({
      projectId: 'proj-A',
      callerScope: 'proj-B',
      lessonId: '11111111-1111-1111-1111-111111111111',
    }),
    isNotFound,
  );
});

// ── deleteWorkspace (1) ───────────────────────────────────────────────────────

test('DEFERRED-029: deleteWorkspace cross-tenant → NOT_FOUND', async () => {
  await assert.rejects(
    deleteWorkspace('proj-A', { callerScope: 'proj-B' }),
    isNotFound,
  );
});
