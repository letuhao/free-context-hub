/**
 * DEFERRED-029 PR D2 — DB-free cross-tenant scope guards for git +
 * projectSources + workspace services.
 *
 * All 12 fns are direct-project_id paths so `assertCallerScope` fires at the
 * top of each body BEFORE any DB call. Cross-tenant attempts therefore yield
 * `ContextHubError('NOT_FOUND', 'not found')` with no oracle leak.
 *
 * Mirrors lessons.test.ts / coordination-scope.test.ts / documents-scope.test.ts.
 */

import assert from 'node:assert/strict';
import test from 'node:test';

import {
  ingestGitHistory,
  listCommits,
  getCommit,
  suggestLessonsFromCommits,
  linkCommitToLesson,
  analyzeCommitImpact,
} from './gitIntelligence.js';
import { configureProjectSource, prepareRepo, getProjectSource } from './repoSources.js';
import { registerWorkspaceRoot, listWorkspaceRoots, scanWorkspaceChanges } from './workspaceTracker.js';
import { ContextHubError } from '../core/errors.js';

const isNotFound = (err: unknown): boolean =>
  err instanceof ContextHubError && err.code === 'NOT_FOUND';

// ── gitIntelligence (6) ───────────────────────────────────────────────────────

test('DEFERRED-029: ingestGitHistory cross-tenant → NOT_FOUND', async () => {
  await assert.rejects(
    ingestGitHistory({ projectId: 'proj-A', callerScope: 'proj-B', root: '/tmp/x' }),
    isNotFound,
  );
});

test('DEFERRED-029: listCommits cross-tenant → NOT_FOUND', async () => {
  await assert.rejects(
    listCommits({ projectId: 'proj-A', callerScope: 'proj-B' }),
    isNotFound,
  );
});

test('DEFERRED-029: getCommit cross-tenant → NOT_FOUND', async () => {
  await assert.rejects(
    getCommit({ projectId: 'proj-A', callerScope: 'proj-B', sha: 'abc' }),
    isNotFound,
  );
});

test('DEFERRED-029: suggestLessonsFromCommits cross-tenant → NOT_FOUND', async () => {
  await assert.rejects(
    suggestLessonsFromCommits({ projectId: 'proj-A', callerScope: 'proj-B' }),
    isNotFound,
  );
});

test('DEFERRED-029: linkCommitToLesson cross-tenant → NOT_FOUND', async () => {
  await assert.rejects(
    linkCommitToLesson({
      projectId: 'proj-A',
      callerScope: 'proj-B',
      commitSha: 'abc',
      lessonId: '11111111-1111-1111-1111-111111111111',
    }),
    isNotFound,
  );
});

test('DEFERRED-029: analyzeCommitImpact cross-tenant → NOT_FOUND', async () => {
  await assert.rejects(
    analyzeCommitImpact({ projectId: 'proj-A', callerScope: 'proj-B', commitSha: 'abc' }),
    isNotFound,
  );
});

// ── repoSources (3) ──────────────────────────────────────────────────────────

test('DEFERRED-029: configureProjectSource cross-tenant → NOT_FOUND', async () => {
  await assert.rejects(
    configureProjectSource({
      projectId: 'proj-A',
      callerScope: 'proj-B',
      sourceType: 'local_workspace',
    }),
    isNotFound,
  );
});

test('DEFERRED-029: prepareRepo cross-tenant → NOT_FOUND', async () => {
  await assert.rejects(
    prepareRepo({
      projectId: 'proj-A',
      callerScope: 'proj-B',
      gitUrl: 'https://example.com/repo.git',
      cacheRoot: '/tmp',
    }),
    isNotFound,
  );
});

test('DEFERRED-029: getProjectSource cross-tenant → NOT_FOUND', async () => {
  await assert.rejects(
    getProjectSource('proj-A', 'local_workspace', { callerScope: 'proj-B' }),
    isNotFound,
  );
});

// ── workspaceTracker (3) ─────────────────────────────────────────────────────

test('DEFERRED-029: registerWorkspaceRoot cross-tenant → NOT_FOUND', async () => {
  await assert.rejects(
    registerWorkspaceRoot({
      projectId: 'proj-A',
      callerScope: 'proj-B',
      rootPath: '/tmp/x',
    }),
    isNotFound,
  );
});

test('DEFERRED-029: listWorkspaceRoots cross-tenant → NOT_FOUND', async () => {
  await assert.rejects(
    listWorkspaceRoots('proj-A', { callerScope: 'proj-B' }),
    isNotFound,
  );
});

test('DEFERRED-029: scanWorkspaceChanges cross-tenant → NOT_FOUND', async () => {
  await assert.rejects(
    scanWorkspaceChanges({
      projectId: 'proj-A',
      callerScope: 'proj-B',
      rootPath: '/tmp/x',
    }),
    isNotFound,
  );
});
