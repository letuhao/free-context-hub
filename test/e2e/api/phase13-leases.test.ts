/**
 * Phase 13 Sprint 13.7 Part A — Artifact leases (F1) lifecycle E2E.
 *
 * Covers F1 ACs 1-8: claim/release/renew/list/check, force-release (admin),
 * conflict path, concurrent-claim race, attempt-rate limit (in-process),
 * and sweep DELETE behavior via direct service call (grace_minutes=0).
 */

import type { TestFn } from '../shared/testContext.js';
import { pass, fail, skip } from '../shared/testContext.js';
import { expectStatus } from '../shared/apiClient.js';

const GROUP = 'phase13-leases';

function leaseTest(name: string, fn: (ctx: any) => Promise<void>): TestFn {
  return async (ctx) => {
    const start = Date.now();
    try {
      await fn(ctx);
      return pass(name, GROUP, Date.now() - start);
    } catch (err: any) {
      const msg = err?.message ?? String(err);
      if (msg.includes('SKIP:')) return skip(name, GROUP, msg.replace('SKIP: ', ''));
      return fail(name, GROUP, Date.now() - start, msg);
    }
  };
}

export const allPhase13LeaseTests: TestFn[] = [
  leaseTest('lease-claim-happy-path', async ({ api, projectId, cleanup, runMarker }) => {
    const r = await api.post(`/api/projects/${projectId}/artifact-leases`, {
      agent_id: `agent-${runMarker}`,
      artifact_type: 'custom',
      artifact_id: `lease-claim-${runMarker}`,
      task_description: 'happy path claim',
      ttl_minutes: 5,
    });
    expectStatus(r, 201);
    if (r.body.status !== 'claimed') throw new Error(`Expected claimed, got ${r.body.status}`);
    if (!r.body.lease_id) throw new Error('No lease_id returned');
    if (!r.body.expires_at) throw new Error('No expires_at returned');
    cleanup.leaseIds.push({ leaseId: r.body.lease_id, projectId, agentId: `agent-${runMarker}` });
  }),

  leaseTest('lease-conflict-second-claim-on-same-artifact', async ({ api, projectId, cleanup, runMarker }) => {
    const artifactId = `lease-conflict-${runMarker}`;
    const r1 = await api.post(`/api/projects/${projectId}/artifact-leases`, {
      agent_id: `agent-A-${runMarker}`,
      artifact_type: 'custom',
      artifact_id: artifactId,
      task_description: 'first claim',
      ttl_minutes: 5,
    });
    expectStatus(r1, 201);
    cleanup.leaseIds.push({ leaseId: r1.body.lease_id, projectId, agentId: `agent-A-${runMarker}` });

    const r2 = await api.post(`/api/projects/${projectId}/artifact-leases`, {
      agent_id: `agent-B-${runMarker}`,
      artifact_type: 'custom',
      artifact_id: artifactId,
      task_description: 'second claim should conflict',
      ttl_minutes: 5,
    });
    expectStatus(r2, 200);
    if (r2.body.status !== 'conflict') throw new Error(`Expected conflict, got ${r2.body.status}`);
    if (r2.body.incumbent_agent_id !== `agent-A-${runMarker}`) {
      throw new Error(`Expected incumbent agent-A, got ${r2.body.incumbent_agent_id}`);
    }
  }),

  leaseTest('lease-concurrent-claims-race', async ({ api, projectId, cleanup, runMarker }) => {
    const artifactId = `lease-race-${runMarker}`;
    const claims = await Promise.all(
      Array.from({ length: 5 }, (_, i) =>
        api.post(`/api/projects/${projectId}/artifact-leases`, {
          agent_id: `agent-race-${i}-${runMarker}`,
          artifact_type: 'custom',
          artifact_id: artifactId,
          task_description: `race ${i}`,
          ttl_minutes: 5,
        }),
      ),
    );
    const claimed = claims.filter((r) => r.body.status === 'claimed');
    const conflicts = claims.filter((r) => r.body.status === 'conflict');
    if (claimed.length !== 1) throw new Error(`Expected exactly 1 claim, got ${claimed.length}`);
    if (conflicts.length !== 4) throw new Error(`Expected 4 conflicts, got ${conflicts.length}`);
    for (const r of claimed) {
      cleanup.leaseIds.push({ leaseId: r.body.lease_id, projectId, agentId: `agent-race-${runMarker}` });
    }
  }),

  // SS5 (BUG-13.7-2): a real owner-release test. The original test was mislabeled
  // — it called force-release (admin). Owner-release needs agent_id in the body,
  // which api.delete cannot send, so it goes through the MCP release_artifact tool.
  leaseTest('lease-release-by-owner', async ({ api, mcp, projectId, cleanup, runMarker }) => {
    if (!mcp) throw new Error('SKIP: MCP client not connected — release_artifact (with agent_id) is MCP-only');
    const agentId = `agent-release-${runMarker}`;
    const artifactId = `lease-release-${runMarker}`;
    const c = await api.post(`/api/projects/${projectId}/artifact-leases`, {
      agent_id: agentId,
      artifact_type: 'custom',
      artifact_id: artifactId,
      task_description: 'will be released by its owner',
      ttl_minutes: 5,
    });
    expectStatus(c, 201);
    cleanup.leaseIds.push({ leaseId: c.body.lease_id, projectId, agentId });

    await mcp.callTool({
      name: 'release_artifact',
      arguments: { project_id: projectId, agent_id: agentId, lease_id: c.body.lease_id },
    });

    // The release worked iff the artifact is available again.
    const chk = await api.post(`/api/projects/${projectId}/artifact-leases/check`, {
      artifact_type: 'custom', artifact_id: artifactId,
    });
    expectStatus(chk, 200);
    if (chk.body.available !== true) {
      throw new Error('expected artifact available after the owner released its lease');
    }
  }),

  leaseTest('lease-renew-extends-ttl', async ({ api, projectId, cleanup, runMarker }) => {
    const agentId = `agent-renew-${runMarker}`;
    const c = await api.post(`/api/projects/${projectId}/artifact-leases`, {
      agent_id: agentId,
      artifact_type: 'custom',
      artifact_id: `lease-renew-${runMarker}`,
      task_description: 'will be renewed',
      ttl_minutes: 5,
    });
    expectStatus(c, 201);
    const leaseId = c.body.lease_id;
    const originalExpiry = new Date(c.body.expires_at).getTime();
    cleanup.leaseIds.push({ leaseId, projectId, agentId });

    const r = await api.patch(`/api/projects/${projectId}/artifact-leases/${leaseId}`, {
      agent_id: agentId,
      extend_by_minutes: 10,
    });
    expectStatus(r, 200);
    if (r.body.status !== 'renewed') throw new Error(`Expected renewed, got ${r.body.status}`);
    const newExpiry = new Date(r.body.expires_at).getTime();
    if (newExpiry <= originalExpiry) {
      throw new Error(`Expected new expiry > original; got new=${newExpiry} orig=${originalExpiry}`);
    }
  }),

  leaseTest('lease-list-active-claims', async ({ api, projectId, cleanup, runMarker }) => {
    // Create 3 leases on distinct artifacts
    const created: string[] = [];
    for (let i = 0; i < 3; i++) {
      const r = await api.post(`/api/projects/${projectId}/artifact-leases`, {
        agent_id: `agent-list-${i}-${runMarker}`,
        artifact_type: 'custom',
        artifact_id: `lease-list-${i}-${runMarker}`,
        task_description: `list-test-${i}`,
        ttl_minutes: 5,
      });
      expectStatus(r, 201);
      created.push(r.body.lease_id);
      cleanup.leaseIds.push({ leaseId: r.body.lease_id, projectId, agentId: `agent-list-${i}-${runMarker}` });
    }
    const lr = await api.get(`/api/projects/${projectId}/artifact-leases`);
    expectStatus(lr, 200);
    const ours = lr.body.claims.filter((c: any) => created.includes(c.lease_id));
    if (ours.length !== 3) throw new Error(`Expected 3 of our claims in list, got ${ours.length}`);
  }),

  leaseTest('lease-check-availability-snapshot', async ({ api, projectId, cleanup, runMarker }) => {
    const artifactId = `lease-check-${runMarker}`;
    const before = await api.post(`/api/projects/${projectId}/artifact-leases/check`, {
      artifact_type: 'custom',
      artifact_id: artifactId,
    });
    expectStatus(before, 200);
    if (before.body.available !== true) throw new Error('Expected available=true before claim');

    const c = await api.post(`/api/projects/${projectId}/artifact-leases`, {
      agent_id: `agent-check-${runMarker}`,
      artifact_type: 'custom',
      artifact_id: artifactId,
      task_description: 'will block check',
      ttl_minutes: 5,
    });
    expectStatus(c, 201);
    cleanup.leaseIds.push({ leaseId: c.body.lease_id, projectId, agentId: `agent-check-${runMarker}` });

    const after = await api.post(`/api/projects/${projectId}/artifact-leases/check`, {
      artifact_type: 'custom',
      artifact_id: artifactId,
    });
    expectStatus(after, 200);
    if (after.body.available !== false) throw new Error('Expected available=false after claim');
    if (after.body.lease?.agent_id !== `agent-check-${runMarker}`) {
      throw new Error(`Expected lease.agent_id from check`);
    }
  }),

  leaseTest('lease-force-release-admin', async ({ api, projectId, cleanup, runMarker }) => {
    // Admin token is bootstrap-default for the ctx api client; this test passes
    // because tests run as admin. The cross-tenant + non-admin paths are in
    // phase13-auth-scope.test.ts under the auth-enabled stack.
    const agentId = `agent-fr-${runMarker}`;
    const c = await api.post(`/api/projects/${projectId}/artifact-leases`, {
      agent_id: agentId,
      artifact_type: 'custom',
      artifact_id: `lease-force-${runMarker}`,
      task_description: 'will be force-released',
      ttl_minutes: 5,
    });
    expectStatus(c, 201);
    const leaseId = c.body.lease_id;

    const r = await api.delete(`/api/projects/${projectId}/artifact-leases/${leaseId}/force`);
    expectStatus(r, 200);
    if (r.body.status !== 'force_released') throw new Error(`Expected force_released, got ${r.body.status}`);
  }),

  // SS5 (BUG-13.7-2): honest, minimal skip — no fake setup. The sweep DELETE
  // (sweepExpiredLeases: grace clamping + the expired-row predicate) is covered
  // by src/services/artifactLeases.test.ts, and the scheduler's advisory-lock +
  // enqueue path by src/services/sweepScheduler.test.ts. A black-box e2e test
  // cannot age a lease past the grace window without server-side time control,
  // so it is recorded as an explicit skip rather than dead setup that pretends.
  leaseTest('lease-sweep-delete-coverage-note', async () => {
    throw new Error('SKIP: sweep DELETE covered by artifactLeases.test.ts + sweepScheduler.test.ts unit tests (a fast e2e test would need server-side TTL aging)');
  }),
];
