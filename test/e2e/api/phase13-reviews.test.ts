/**
 * Phase 13 Sprint 13.7 Part A — Review requests (F2) lifecycle E2E.
 * Phase 13 bug-fix SS5 (BUG-13.7-2): the original file SKIPped the entire F2
 * lifecycle. This version exercises it end-to-end — submit_for_review via the
 * MCP client, approve/return via REST — plus the three ✗ transition guards
 * (master design L275-281):
 *   (a) active → pending-review via update_lesson_status → reject
 *   (b) pending-review → superseded via update_lesson_status → reject
 *   (c) draft → pending-review via update_lesson_status → reject
 */

import type { TestFn } from '../shared/testContext.js';
import { pass, fail, skip } from '../shared/testContext.js';
import { expectStatus } from '../shared/apiClient.js';

const GROUP = 'phase13-reviews';

function reviewTest(name: string, fn: (ctx: any) => Promise<void>): TestFn {
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

async function createDraftLesson(api: any, projectId: string, runMarker: string, suffix: string): Promise<string> {
  const r = await api.post('/api/lessons', {
    project_id: projectId,
    lesson_type: 'general_note',
    title: `Review test ${suffix} ${runMarker}`,
    content: `Phase 13.7 review test content ${suffix}`,
  });
  expectStatus(r, 201);
  const lessonId = r.body?.lesson_id;
  if (!lessonId) throw new Error('No lesson_id returned');
  // Lessons are created active by default; demote to draft for review tests.
  const sr = await api.patch(`/api/lessons/${lessonId}/status`, { project_id: projectId, status: 'draft' });
  expectStatus(sr, 200);
  return lessonId;
}

/** Extract the structured result object from an MCP callTool() response. */
function structured(res: any): any {
  if (res && typeof res === 'object' && res.structuredContent) return res.structuredContent;
  const text: string = res?.content?.[0]?.text ?? '';
  const brace = text.indexOf('{');
  if (brace >= 0) {
    try { return JSON.parse(text.slice(brace)); } catch { /* fall through */ }
  }
  return {};
}

/** submit_for_review is MCP-only — call it via the bootstrapped MCP client. */
async function submitForReview(mcp: any, projectId: string, lessonId: string, agentId: string): Promise<any> {
  const res = await mcp.callTool({
    name: 'submit_for_review',
    arguments: { project_id: projectId, agent_id: agentId, lesson_id: lessonId },
  });
  return structured(res);
}

export const allPhase13ReviewTests: TestFn[] = [
  // ── F2 AC1 + AC3 + AC4: submit → list → detail → approve ──
  reviewTest('review-lifecycle-submit-approve', async ({ api, mcp, projectId, cleanup, runMarker }) => {
    if (!mcp) throw new Error('SKIP: MCP client not connected — submit_for_review is MCP-only');
    const lessonId = await createDraftLesson(api, projectId, runMarker, 'submit-approve');
    cleanup.lessonIds.push(lessonId);

    const submit = await submitForReview(mcp, projectId, lessonId, `agent-${runMarker}`);
    if (submit.status !== 'submitted') throw new Error(`submit_for_review: expected submitted, got ${submit.status}`);
    const requestId = submit.request_id;
    if (!requestId) throw new Error('submit_for_review returned no request_id');

    // The pending list includes it.
    const listR = await api.get(`/api/projects/${projectId}/review-requests?status=pending`);
    expectStatus(listR, 200);
    if (!(listR.body.items ?? []).some((i: any) => i.request_id === requestId)) {
      throw new Error('submitted request not found in the pending list');
    }

    // The detail endpoint returns the full lesson content (BUG-13.4-1).
    const detR = await api.get(`/api/projects/${projectId}/review-requests/${requestId}`);
    expectStatus(detR, 200);
    if (!detR.body.lesson || typeof detR.body.lesson.content !== 'string' || detR.body.lesson.content.length === 0) {
      throw new Error('detail endpoint did not return lesson.content');
    }

    // Approve → lesson goes active.
    const apprR = await api.post(`/api/projects/${projectId}/review-requests/${requestId}/approve`, {});
    expectStatus(apprR, 200);
    if (apprR.body.status !== 'resolved' || apprR.body.new_lesson_status !== 'active') {
      throw new Error(`approve: expected resolved/active, got ${apprR.body.status}/${apprR.body.new_lesson_status}`);
    }
  }),

  // ── F2 AC5 + AC6: submit → return → re-submit creates a new request ──
  reviewTest('review-lifecycle-submit-return-resubmit', async ({ api, mcp, projectId, cleanup, runMarker }) => {
    if (!mcp) throw new Error('SKIP: MCP client not connected');
    const lessonId = await createDraftLesson(api, projectId, runMarker, 'return-resubmit');
    cleanup.lessonIds.push(lessonId);

    const submit1 = await submitForReview(mcp, projectId, lessonId, `agent-${runMarker}`);
    if (submit1.status !== 'submitted') throw new Error(`first submit: got ${submit1.status}`);

    // Return → lesson goes back to draft.
    const retR = await api.post(`/api/projects/${projectId}/review-requests/${submit1.request_id}/return`,
      { resolution_note: 'needs more detail before approval' });
    expectStatus(retR, 200);
    if (retR.body.status !== 'resolved' || retR.body.new_lesson_status !== 'draft') {
      throw new Error(`return: expected resolved/draft, got ${retR.body.status}/${retR.body.new_lesson_status}`);
    }

    // Re-submit → a NEW request row (the old returned row does not block it).
    const submit2 = await submitForReview(mcp, projectId, lessonId, `agent-${runMarker}`);
    if (submit2.status !== 'submitted') throw new Error(`re-submit: expected submitted, got ${submit2.status}`);
    if (submit2.request_id === submit1.request_id) throw new Error('re-submit reused the old request_id');
  }),

  // ── F2 'return' requires a resolution_note ──
  reviewTest('review-return-requires-resolution-note', async ({ api, mcp, projectId, cleanup, runMarker }) => {
    if (!mcp) throw new Error('SKIP: MCP client not connected');
    const lessonId = await createDraftLesson(api, projectId, runMarker, 'return-novalidate');
    cleanup.lessonIds.push(lessonId);
    const submit = await submitForReview(mcp, projectId, lessonId, `agent-${runMarker}`);
    if (submit.status !== 'submitted') throw new Error(`submit: got ${submit.status}`);
    const r = await api.post(`/api/projects/${projectId}/review-requests/${submit.request_id}/return`, {});
    if (r.status !== 400) throw new Error(`expected 400 for return without resolution_note, got ${r.status}`);
  }),

  // ── ✗ transition (a): active → pending-review via update_lesson_status → reject ──
  reviewTest('review-reject-active-to-pending-review', async ({ api, projectId, cleanup, runMarker }) => {
    const lessonId = await createDraftLesson(api, projectId, runMarker, 'reject-a');
    cleanup.lessonIds.push(lessonId);
    await api.patch(`/api/lessons/${lessonId}/status`, { project_id: projectId, status: 'active' });
    const r = await api.patch(`/api/lessons/${lessonId}/status`, { project_id: projectId, status: 'pending-review' });
    if (r.status === 200 && r.body?.status !== 'error') {
      throw new Error(`Expected rejection of active→pending-review; got status=${r.status} body.status=${r.body?.status}`);
    }
  }),

  // ── ✗ transition (b): pending-review → superseded via update_lesson_status → reject ──
  //    (the SS5 test the original phase13-reviews.test.ts header promised but never shipped)
  reviewTest('review-reject-pending-review-to-superseded', async ({ api, mcp, projectId, cleanup, runMarker }) => {
    if (!mcp) throw new Error('SKIP: MCP client not connected');
    const lessonId = await createDraftLesson(api, projectId, runMarker, 'reject-b');
    cleanup.lessonIds.push(lessonId);
    const submit = await submitForReview(mcp, projectId, lessonId, `agent-${runMarker}`);
    if (submit.status !== 'submitted') throw new Error(`submit: got ${submit.status}`);
    // Lesson is now pending-review. update_lesson_status → superseded must be rejected.
    const r = await api.patch(`/api/lessons/${lessonId}/status`, { project_id: projectId, status: 'superseded' });
    if (r.status === 200 && r.body?.status !== 'error') {
      throw new Error(`Expected rejection of pending-review→superseded; got status=${r.status} body.status=${r.body?.status}`);
    }
  }),

  // ── ✗ transition (c): draft → pending-review via update_lesson_status → reject ──
  reviewTest('review-reject-draft-to-pending-review-via-update', async ({ api, projectId, cleanup, runMarker }) => {
    const lessonId = await createDraftLesson(api, projectId, runMarker, 'reject-c');
    cleanup.lessonIds.push(lessonId);
    const r = await api.patch(`/api/lessons/${lessonId}/status`, { project_id: projectId, status: 'pending-review' });
    if (r.status === 200 && r.body?.status !== 'error') {
      throw new Error(`Expected rejection of draft→pending-review via update_lesson_status; got status=${r.status} body.status=${r.body?.status}`);
    }
  }),

  // ── F2 review-requests list endpoint shape ──
  reviewTest('review-list-endpoint-shape', async ({ api, projectId }) => {
    const r = await api.get(`/api/projects/${projectId}/review-requests`);
    expectStatus(r, 200);
    if (!Array.isArray(r.body.items)) throw new Error('items not an array');
    if (typeof r.body.total_count !== 'number') throw new Error('total_count not a number');
  }),

  reviewTest('review-list-endpoint-status-filter', async ({ api, projectId }) => {
    for (const status of ['pending', 'approved', 'returned']) {
      const r = await api.get(`/api/projects/${projectId}/review-requests?status=${status}`);
      expectStatus(r, 200);
    }
  }),
];
