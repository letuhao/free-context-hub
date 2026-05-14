/**
 * Phase 13 Sprint 13.1 — artifactLeases unit tests
 *
 * Covers:
 *   - claim succeeds when no existing lease
 *   - second claim on same artifact returns conflict
 *   - claim returns rate_limited at MAX_ACTIVE_LEASES_PER_AGENT
 *   - concurrent claims: exactly one wins, others get conflict (no 500)
 *   - release by owner / non-owner / unknown lease
 *   - renew below cap / at cap / by non-owner / of expired
 *   - list_active_claims excludes expired + filter
 *   - check_artifact_availability: available / occupied
 *   - force_release with correct + wrong project_id (tenant isolation)
 *   - invalid artifact_id format
 */

import assert from 'node:assert/strict';
import test, { before, after, beforeEach } from 'node:test';
import {
  claimArtifact,
  releaseArtifact,
  renewArtifact,
  listActiveClaims,
  checkArtifactAvailability,
  forceReleaseArtifact,
} from './artifactLeases.js';
import { getDbPool } from '../db/client.js';

const TEST_PROJECT = '__test_artifact_leases__';
const TEST_PROJECT_B = '__test_artifact_leases_B__';

async function cleanup() {
  const pool = getDbPool();
  await pool.query(`DELETE FROM artifact_leases WHERE project_id IN ($1, $2)`, [TEST_PROJECT, TEST_PROJECT_B]);
}

before(async () => {
  await cleanup();
});

after(async () => {
  await cleanup();
});

beforeEach(async () => {
  await cleanup();
});

test('claim succeeds when no existing lease', async () => {
  const r = await claimArtifact({
    project_id: TEST_PROJECT,
    agent_id: 'agent-1',
    artifact_type: 'custom',
    artifact_id: 'a1',
    task_description: 'work on a1',
  });
  assert.equal(r.status, 'claimed');
  if (r.status === 'claimed') {
    assert.ok(r.lease_id);
    assert.ok(new Date(r.expires_at).getTime() > Date.now());
  }
});

test('second claim on same artifact returns conflict', async () => {
  await claimArtifact({
    project_id: TEST_PROJECT, agent_id: 'agent-1',
    artifact_type: 'custom', artifact_id: 'a2', task_description: 'first',
  });
  const r2 = await claimArtifact({
    project_id: TEST_PROJECT, agent_id: 'agent-2',
    artifact_type: 'custom', artifact_id: 'a2', task_description: 'second',
  });
  assert.equal(r2.status, 'conflict');
  if (r2.status === 'conflict') {
    assert.equal(r2.incumbent_agent_id, 'agent-1');
    assert.equal(r2.incumbent_task, 'first');
    assert.ok(r2.seconds_remaining > 0);
  }
});

test('claim returns rate_limited at 10 active leases per agent', async () => {
  for (let i = 0; i < 10; i++) {
    const r = await claimArtifact({
      project_id: TEST_PROJECT, agent_id: 'limited-agent',
      artifact_type: 'custom', artifact_id: `rl-${i}`, task_description: 'fill',
    });
    assert.equal(r.status, 'claimed');
  }
  const r11 = await claimArtifact({
    project_id: TEST_PROJECT, agent_id: 'limited-agent',
    artifact_type: 'custom', artifact_id: 'rl-11', task_description: 'should fail',
  });
  assert.equal(r11.status, 'rate_limited');
  if (r11.status === 'rate_limited') {
    assert.equal(r11.reason, 'max_active_leases');
  }
});

test('concurrent claims: exactly one wins, others get conflict (no error)', async () => {
  const promises = Array.from({ length: 5 }, (_, i) =>
    claimArtifact({
      project_id: TEST_PROJECT, agent_id: `concurrent-${i}`,
      artifact_type: 'custom', artifact_id: 'race', task_description: `attempt-${i}`,
    }),
  );
  const results = await Promise.all(promises);
  const claimed = results.filter((r) => r.status === 'claimed');
  const conflicts = results.filter((r) => r.status === 'conflict');
  assert.equal(claimed.length, 1, 'exactly one claim should succeed');
  assert.equal(conflicts.length, 4, 'remaining four should be conflict');
});

test('release by owner succeeds', async () => {
  const c = await claimArtifact({
    project_id: TEST_PROJECT, agent_id: 'agent-1',
    artifact_type: 'custom', artifact_id: 'rel-1', task_description: 't',
  });
  assert.equal(c.status, 'claimed');
  if (c.status !== 'claimed') return;
  const r = await releaseArtifact({ project_id: TEST_PROJECT, agent_id: 'agent-1', lease_id: c.lease_id });
  assert.equal(r.status, 'released');
});

test('release by non-owner returns not_owner', async () => {
  const c = await claimArtifact({
    project_id: TEST_PROJECT, agent_id: 'owner',
    artifact_type: 'custom', artifact_id: 'rel-2', task_description: 't',
  });
  if (c.status !== 'claimed') throw new Error('setup failed');
  const r = await releaseArtifact({ project_id: TEST_PROJECT, agent_id: 'imposter', lease_id: c.lease_id });
  assert.equal(r.status, 'not_owner');
});

test('release of unknown lease_id returns not_found', async () => {
  const r = await releaseArtifact({
    project_id: TEST_PROJECT, agent_id: 'agent-1',
    lease_id: '00000000-0000-0000-0000-000000000000',
  });
  assert.equal(r.status, 'not_found');
});

test('renew below cap extends expires_at', async () => {
  const c = await claimArtifact({
    project_id: TEST_PROJECT, agent_id: 'agent-1',
    artifact_type: 'custom', artifact_id: 'ren-1', task_description: 't',
    ttl_minutes: 30,
  });
  if (c.status !== 'claimed') throw new Error('setup failed');
  const r = await renewArtifact({
    project_id: TEST_PROJECT, agent_id: 'agent-1', lease_id: c.lease_id,
    extend_by_minutes: 60,
  });
  assert.equal(r.status, 'renewed');
  if (r.status === 'renewed') {
    assert.equal(r.effective_extension_minutes, 60);
    assert.ok(new Date(r.expires_at).getTime() > new Date(c.expires_at).getTime());
  }
});

test('renew at TTL cap returns cap_reached with reduced effective_extension_minutes', async () => {
  const c = await claimArtifact({
    project_id: TEST_PROJECT, agent_id: 'agent-1',
    artifact_type: 'custom', artifact_id: 'ren-cap', task_description: 't',
    ttl_minutes: 240, // already at max
  });
  if (c.status !== 'claimed') throw new Error('setup failed');
  const r = await renewArtifact({
    project_id: TEST_PROJECT, agent_id: 'agent-1', lease_id: c.lease_id,
    extend_by_minutes: 60,
  });
  assert.equal(r.status, 'cap_reached');
  if (r.status === 'cap_reached') {
    assert.ok(r.effective_extension_minutes < 60, `cap should reduce extension; got ${r.effective_extension_minutes}`);
  }
});

test('renew by non-owner returns not_owner', async () => {
  const c = await claimArtifact({
    project_id: TEST_PROJECT, agent_id: 'owner',
    artifact_type: 'custom', artifact_id: 'ren-no', task_description: 't',
  });
  if (c.status !== 'claimed') throw new Error('setup failed');
  const r = await renewArtifact({
    project_id: TEST_PROJECT, agent_id: 'imposter', lease_id: c.lease_id,
    extend_by_minutes: 30,
  });
  assert.equal(r.status, 'not_owner');
});

test('renew of expired lease returns expired', async () => {
  // Insert an already-expired lease directly via DB
  const pool = getDbPool();
  const expiredId = '11111111-1111-1111-1111-111111111111';
  await pool.query(
    `INSERT INTO artifact_leases (lease_id, project_id, agent_id, artifact_type, artifact_id, task_description, ttl_minutes, expires_at)
     VALUES ($1, $2, 'agent-1', 'custom', 'expired-1', 't', 30, now() - interval '1 minute')`,
    [expiredId, TEST_PROJECT],
  );
  const r = await renewArtifact({
    project_id: TEST_PROJECT, agent_id: 'agent-1', lease_id: expiredId,
    extend_by_minutes: 30,
  });
  assert.equal(r.status, 'expired');
});

test('list_active_claims excludes expired', async () => {
  const pool = getDbPool();
  await pool.query(
    `INSERT INTO artifact_leases (lease_id, project_id, agent_id, artifact_type, artifact_id, task_description, ttl_minutes, expires_at)
     VALUES (gen_random_uuid(), $1, 'agent-1', 'custom', 'list-expired', 't', 30, now() - interval '1 minute')`,
    [TEST_PROJECT],
  );
  await claimArtifact({
    project_id: TEST_PROJECT, agent_id: 'agent-1',
    artifact_type: 'custom', artifact_id: 'list-active', task_description: 't',
  });
  const r = await listActiveClaims({ project_id: TEST_PROJECT });
  assert.equal(r.claims.length, 1);
  assert.equal(r.claims[0].artifact_id, 'list-active');
});

test('list_active_claims with artifact_type filter', async () => {
  await claimArtifact({
    project_id: TEST_PROJECT, agent_id: 'a1',
    artifact_type: 'lesson', artifact_id: 'lesson-1', task_description: 't',
  });
  await claimArtifact({
    project_id: TEST_PROJECT, agent_id: 'a2',
    artifact_type: 'custom', artifact_id: 'custom-1', task_description: 't',
  });
  const filtered = await listActiveClaims({ project_id: TEST_PROJECT, artifact_type: 'lesson' });
  assert.equal(filtered.claims.length, 1);
  assert.equal(filtered.claims[0].artifact_type, 'lesson');
});

test('check_artifact_availability: available=true when no lease', async () => {
  const r = await checkArtifactAvailability({
    project_id: TEST_PROJECT, artifact_type: 'custom', artifact_id: 'free',
  });
  assert.equal(r.available, true);
});

test('check_artifact_availability: available=false with lease info', async () => {
  await claimArtifact({
    project_id: TEST_PROJECT, agent_id: 'a1',
    artifact_type: 'custom', artifact_id: 'occupied', task_description: 'working',
  });
  const r = await checkArtifactAvailability({
    project_id: TEST_PROJECT, artifact_type: 'custom', artifact_id: 'occupied',
  });
  assert.equal(r.available, false);
  if (!r.available) {
    assert.equal(r.lease.agent_id, 'a1');
    assert.equal(r.lease.task_description, 'working');
  }
});

test('force_release with correct project_id deletes lease', async () => {
  const c = await claimArtifact({
    project_id: TEST_PROJECT, agent_id: 'a1',
    artifact_type: 'custom', artifact_id: 'force-1', task_description: 't',
  });
  if (c.status !== 'claimed') throw new Error('setup failed');
  const r = await forceReleaseArtifact({ project_id: TEST_PROJECT, lease_id: c.lease_id });
  assert.equal(r.status, 'force_released');
});

test('force_release with WRONG project_id returns not_found (tenant isolation)', async () => {
  const c = await claimArtifact({
    project_id: TEST_PROJECT, agent_id: 'a1',
    artifact_type: 'custom', artifact_id: 'tenant-1', task_description: 't',
  });
  if (c.status !== 'claimed') throw new Error('setup failed');
  // Admin from project B attempts force-release on project A's lease
  const r = await forceReleaseArtifact({ project_id: TEST_PROJECT_B, lease_id: c.lease_id });
  assert.equal(r.status, 'not_found');
  // Verify lease still exists in original project
  const stillThere = await listActiveClaims({ project_id: TEST_PROJECT });
  assert.equal(stillThere.claims.length, 1);
});

test('invalid artifact_id format throws on claim', async () => {
  await assert.rejects(
    claimArtifact({
      project_id: TEST_PROJECT, agent_id: 'a1',
      artifact_type: 'custom', artifact_id: 'Invalid Name With Spaces',
      task_description: 't',
    }),
    /artifact_id must be lowercase kebab-case/,
  );
});

test('invalid artifact_type (typo or case) throws on claim', async () => {
  await assert.rejects(
    claimArtifact({
      project_id: TEST_PROJECT, agent_id: 'a1',
      artifact_type: 'LESSON', artifact_id: 'a1',
      task_description: 't',
    }),
    /artifact_type must be one of/,
  );
  await assert.rejects(
    claimArtifact({
      project_id: TEST_PROJECT, agent_id: 'a1',
      artifact_type: 'lessson', artifact_id: 'a2',  // typo
      task_description: 't',
    }),
    /artifact_type must be one of/,
  );
});
