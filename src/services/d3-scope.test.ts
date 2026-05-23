/**
 * DEFERRED-029 PR D3 — DB-free cross-tenant scope guards for jobQueue +
 * artifactLeases + taxonomyService + replayEvents + projectGroups.
 *
 * All these fns use direct project_id paths (assertCallerScope) or topic-id
 * derive (assertTopicScope for replayEvents). Cross-tenant attempts therefore
 * yield ContextHubError('NOT_FOUND', 'not found') with no oracle leak.
 *
 * Entity-id-derive cross-tenant DB tests (replayEvents.assertTopicScope)
 * deferred to PR F per established pattern — covered here only for direct
 * project_id matches.
 */

import assert from 'node:assert/strict';
import test from 'node:test';

import { enqueueJob, listJobs, cancelJob } from './jobQueue.js';
import {
  claimArtifact,
  releaseArtifact,
  renewArtifact,
  listActiveClaims,
  checkArtifactAvailability,
  forceReleaseArtifact,
} from './artifactLeases.js';
import { getActiveProfile, activateProfile, deactivateProfile } from './taxonomyService.js';
import {
  addProjectToGroup,
  removeProjectFromGroup,
  listGroupsForProject,
  createProject,
  updateProject,
} from './projectGroups.js';
import { ContextHubError } from '../core/errors.js';

const isNotFound = (err: unknown): boolean =>
  err instanceof ContextHubError && err.code === 'NOT_FOUND';

// ── jobQueue (3 — direct project_id when project_id is set) ───────────────────

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

// ── artifactLeases (6) ────────────────────────────────────────────────────────

test('DEFERRED-029: claimArtifact cross-tenant → NOT_FOUND', async () => {
  await assert.rejects(
    claimArtifact({
      project_id: 'proj-A',
      callerScope: 'proj-B',
      agent_id: 'agent:x',
      artifact_type: 'lesson',
      artifact_id: 'x-y',
      task_description: 'test',
    }),
    isNotFound,
  );
});

test('DEFERRED-029: releaseArtifact cross-tenant → NOT_FOUND', async () => {
  await assert.rejects(
    releaseArtifact({
      project_id: 'proj-A',
      callerScope: 'proj-B',
      agent_id: 'agent:x',
      lease_id: '11111111-1111-1111-1111-111111111111',
    }),
    isNotFound,
  );
});

test('DEFERRED-029: renewArtifact cross-tenant → NOT_FOUND', async () => {
  await assert.rejects(
    renewArtifact({
      project_id: 'proj-A',
      callerScope: 'proj-B',
      agent_id: 'agent:x',
      lease_id: '11111111-1111-1111-1111-111111111111',
      extend_by_minutes: 10,
    }),
    isNotFound,
  );
});

test('DEFERRED-029: listActiveClaims cross-tenant → NOT_FOUND', async () => {
  await assert.rejects(
    listActiveClaims({ project_id: 'proj-A', callerScope: 'proj-B' }),
    isNotFound,
  );
});

test('DEFERRED-029: checkArtifactAvailability cross-tenant → NOT_FOUND', async () => {
  await assert.rejects(
    checkArtifactAvailability({
      project_id: 'proj-A',
      callerScope: 'proj-B',
      artifact_type: 'lesson',
      artifact_id: 'x-y',
    }),
    isNotFound,
  );
});

test('DEFERRED-029: forceReleaseArtifact cross-tenant → NOT_FOUND', async () => {
  await assert.rejects(
    forceReleaseArtifact({
      project_id: 'proj-A',
      callerScope: 'proj-B',
      lease_id: '11111111-1111-1111-1111-111111111111',
    }),
    isNotFound,
  );
});

// ── taxonomyService (3 project-scoped) ────────────────────────────────────────

test('DEFERRED-029: getActiveProfile cross-tenant → NOT_FOUND', async () => {
  await assert.rejects(
    getActiveProfile('proj-A', { callerScope: 'proj-B' }),
    isNotFound,
  );
});

test('DEFERRED-029: activateProfile cross-tenant → NOT_FOUND', async () => {
  await assert.rejects(
    activateProfile({ project_id: 'proj-A', callerScope: 'proj-B', slug: 'default' }),
    isNotFound,
  );
});

test('DEFERRED-029: deactivateProfile cross-tenant → NOT_FOUND', async () => {
  await assert.rejects(
    deactivateProfile('proj-A', { callerScope: 'proj-B' }),
    isNotFound,
  );
});

// ── projectGroups (5 project-scoped) ──────────────────────────────────────────

test('DEFERRED-029: addProjectToGroup cross-tenant → NOT_FOUND', async () => {
  await assert.rejects(
    addProjectToGroup('group-x', 'proj-A', { callerScope: 'proj-B' }),
    isNotFound,
  );
});

test('DEFERRED-029: removeProjectFromGroup cross-tenant → NOT_FOUND', async () => {
  await assert.rejects(
    removeProjectFromGroup('group-x', 'proj-A', { callerScope: 'proj-B' }),
    isNotFound,
  );
});

test('DEFERRED-029: listGroupsForProject cross-tenant → NOT_FOUND', async () => {
  await assert.rejects(
    listGroupsForProject('proj-A', { callerScope: 'proj-B' }),
    isNotFound,
  );
});

test('DEFERRED-029: createProject cross-tenant → NOT_FOUND', async () => {
  await assert.rejects(
    createProject({ project_id: 'proj-A', callerScope: 'proj-B', name: 'A' }),
    isNotFound,
  );
});

test('DEFERRED-029: updateProject cross-tenant → NOT_FOUND', async () => {
  await assert.rejects(
    updateProject('proj-A', { callerScope: 'proj-B', name: 'A' }),
    isNotFound,
  );
});
