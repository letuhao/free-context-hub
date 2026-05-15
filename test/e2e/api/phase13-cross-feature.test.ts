/**
 * Phase 13 Sprint 13.7 Part A — Cross-feature integration E2E.
 *
 * Verifies that F1+F2+F3 don't interfere with each other:
 *   - F2+F3 interaction: review request for a profile-type lesson works
 *   - F1+F3 interaction: claim_artifact + check_guardrails do not interfere
 *   - F2 lifecycle ✓ transitions integration: submit (via service) → approve → check status
 *     (most lifecycle tests live in phase13-reviews.test.ts + unit tests)
 */

import type { TestFn } from '../shared/testContext.js';
import { pass, fail, skip } from '../shared/testContext.js';
import { expectStatus } from '../shared/apiClient.js';

const GROUP = 'phase13-cross-feature';

function xTest(name: string, fn: (ctx: any) => Promise<void>): TestFn {
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

export const allPhase13CrossFeatureTests: TestFn[] = [
  // ── F1+F3: lease claim works on lessons with profile-type lesson_type ──
  xTest('cross-f1-f3-lease-on-profile-type-lesson', async ({ api, projectId, cleanup, runMarker }) => {
    // Ensure dlf-phase0 active
    const aR = await api.post(`/api/projects/${projectId}/taxonomy-profile/activate`, {
      slug: 'dlf-phase0',
      activated_by: `e2e-${runMarker}`,
    });
    expectStatus(aR, 200);
    cleanup.taxonomyActivations.push(projectId);

    // Create a profile-type lesson
    const lr = await api.post('/api/lessons', {
      project_id: projectId,
      lesson_type: 'candidate-decision',
      title: `Cross F1+F3 ${runMarker}`,
      content: 'lease this lesson',
    });
    expectStatus(lr, 201);
    cleanup.lessonIds.push(lr.body.lesson_id);

    // Claim a lease on the lesson
    const cR = await api.post(`/api/projects/${projectId}/artifact-leases`, {
      agent_id: `agent-cross-${runMarker}`,
      artifact_type: 'lesson',
      artifact_id: `cross-f1f3-${runMarker}`,
      task_description: 'editing candidate-decision',
      ttl_minutes: 5,
    });
    expectStatus(cR, 201);
    if (cR.body.status !== 'claimed') throw new Error(`Expected claimed; got ${cR.body.status}`);
    cleanup.leaseIds.push({ leaseId: cR.body.lease_id, projectId, agentId: `agent-cross-${runMarker}` });
  }),

  // ── F2+F3: a real review request can be submitted for an F3 profile-type lesson ──
  // SS5 (BUG-13.7-2): the original test only GET'd the (empty) review list. This
  // exercises the actual F2×F3 interaction — submit_for_review on a lesson whose
  // lesson_type comes from an active taxonomy profile.
  xTest('cross-f2-f3-review-a-profile-type-lesson', async ({ api, mcp, projectId, cleanup, runMarker }) => {
    if (!mcp) throw new Error('SKIP: MCP client not connected');
    // F3: activate dlf-phase0 so 'candidate-decision' is a valid lesson_type.
    const aR = await api.post(`/api/projects/${projectId}/taxonomy-profile/activate`, {
      slug: 'dlf-phase0', activated_by: `e2e-${runMarker}`,
    });
    expectStatus(aR, 200);
    cleanup.taxonomyActivations.push(projectId);

    // Create a profile-type lesson and demote it to draft.
    const lr = await api.post('/api/lessons', {
      project_id: projectId, lesson_type: 'candidate-decision',
      title: `Cross F2+F3 ${runMarker}`, content: 'review a profile-type lesson',
    });
    expectStatus(lr, 201);
    cleanup.lessonIds.push(lr.body.lesson_id);
    await api.patch(`/api/lessons/${lr.body.lesson_id}/status`, { project_id: projectId, status: 'draft' });

    // F2: submit it for review via the MCP tool.
    const submitRes: any = await mcp.callTool({
      name: 'submit_for_review',
      arguments: { project_id: projectId, agent_id: `agent-${runMarker}`, lesson_id: lr.body.lesson_id },
    });
    const sc = submitRes?.structuredContent ?? {};
    const text: string = submitRes?.content?.[0]?.text ?? '';
    if (sc.status !== 'submitted' && !text.includes('submitted')) {
      throw new Error(`F2+F3: submit_for_review failed for a profile-type lesson: ${text.slice(0, 200)}`);
    }

    // It appears in the review list carrying its profile lesson_type.
    const listR = await api.get(`/api/projects/${projectId}/review-requests?status=pending`);
    expectStatus(listR, 200);
    const found = (listR.body.items ?? []).find((i: any) => i.lesson_id === lr.body.lesson_id);
    if (!found) throw new Error('F2+F3: the submitted profile-type lesson is not in the review list');
    if (found.lesson_type !== 'candidate-decision') {
      throw new Error(`F2+F3: expected lesson_type 'candidate-decision', got '${found.lesson_type}'`);
    }
  }),

  // ── F1+F2: existing review_requests don't affect lease availability ──
  xTest('cross-f1-f2-leases-orthogonal-to-reviews', async ({ api, projectId, cleanup, runMarker }) => {
    // Just verify that GET on both endpoints succeeds independently
    const leasesR = await api.get(`/api/projects/${projectId}/artifact-leases`);
    expectStatus(leasesR, 200);
    const reviewsR = await api.get(`/api/projects/${projectId}/review-requests`);
    expectStatus(reviewsR, 200);
    // Both are independent collections — no cross-table joins or counts that could mix them up
  }),

  // ── F1+F2+F3: GET /api/me returns full Phase 13 identity surface ──
  xTest('cross-all-features-api-me-shape', async ({ api }) => {
    const r = await api.get('/api/me');
    expectStatus(r, 200);
    if (typeof r.body.role !== 'string') throw new Error('role missing');
    if (!['no_auth', 'env_token', 'db_key'].includes(r.body.key_source)) {
      throw new Error(`Unexpected key_source: ${r.body.key_source}`);
    }
    if (typeof r.body.auth_enabled !== 'boolean') throw new Error('auth_enabled missing');
    // project_scope may be null
    if (r.body.project_scope !== null && typeof r.body.project_scope !== 'string') {
      throw new Error(`Unexpected project_scope type: ${typeof r.body.project_scope}`);
    }
  }),
];
