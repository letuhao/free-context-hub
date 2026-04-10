/**
 * Layer 1 — API Smoke Tests
 * Hit every REST endpoint once, expect not-500.
 * Tests are ordered so dependent resources (lesson, doc, conversation) are created first.
 */

import type { TestFn } from '../shared/testContext.js';
import { pass, fail, skip } from '../shared/testContext.js';
import { expectStatus } from '../shared/apiClient.js';

const GROUP = 'api-smoke';

// ── Helpers ──────────────────────────────────────────────────────────────

function smoke(
  name: string,
  fn: (ctx: any) => Promise<void>,
): TestFn {
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

/** Shared state for resources created during smoke tests. */
type SmokeState = {
  lessonId?: string;
  docId?: string;
  convId?: string;
  commentId?: string;
  groupId?: string;
  lessonTypeKey?: string;
  apiKeyId?: string;
  tempProjectId?: string;
};

const st: SmokeState = {};

// ── System (no auth, no project) ─────────────────────────────────────────

const systemTests: TestFn[] = [
  smoke('GET /api/system/health', async ({ api }) => {
    const r = await api.get('/api/system/health');
    expectStatus(r, 200);
    if (r.body?.status !== 'ok') throw new Error(`Expected status ok, got ${r.body?.status}`);
  }),

  smoke('GET /api/system/info', async ({ api }) => {
    const r = await api.get('/api/system/info');
    expectStatus(r, 200);
    if (!r.body?.features) throw new Error('Missing features in info response');
  }),
];

// ── Projects ─────────────────────────────────────────────────────────────

const projectTests: TestFn[] = [
  smoke('GET /api/projects', async ({ api }) => {
    const r = await api.get('/api/projects');
    expectStatus(r, 200);
  }),

  smoke('POST /api/projects', async ({ api, runMarker, cleanup }) => {
    st.tempProjectId = `e2e-smoke-${runMarker.slice(0, 16)}`;
    const r = await api.post('/api/projects', {
      project_id: st.tempProjectId,
      name: `Smoke test project`,
    });
    expectStatus(r, 201);
    cleanup.projectIds.push(st.tempProjectId);
  }),

  smoke('PUT /api/projects/:id', async ({ api, projectId }) => {
    const r = await api.put(`/api/projects/${projectId}`, {
      name: 'E2E Test Project',
      description: 'Updated by smoke test',
    });
    expectStatus(r, 200);
  }),

  smoke('GET /api/projects/:id/summary', async ({ api, projectId }) => {
    const r = await api.get(`/api/projects/${projectId}/summary`);
    // 200 or 404 (no summary generated yet) are both acceptable
    if (r.status !== 200 && r.status !== 404) throw new Error(`Expected 200 or 404, got ${r.status}`);
  }),

  smoke('DELETE /api/projects/:id', async ({ api, cleanup }) => {
    if (!st.tempProjectId) throw new Error('SKIP: no temp project to delete');
    const r = await api.delete(`/api/projects/${st.tempProjectId}`);
    expectStatus(r, 200);
    cleanup.projectIds = cleanup.projectIds.filter((id: string) => id !== st.tempProjectId);
  }),
];

// ── Lessons ──────────────────────────────────────────────────────────────

const lessonTests: TestFn[] = [
  smoke('POST /api/lessons (create)', async ({ api, projectId, runMarker, cleanup }) => {
    const r = await api.post('/api/lessons', {
      project_id: projectId,
      lesson_type: 'decision',
      title: `Smoke test lesson ${runMarker}`,
      content: 'Created by API smoke test',
      tags: ['e2e-smoke'],
    });
    expectStatus(r, 201);
    st.lessonId = r.body?.lesson_id;
    if (st.lessonId) cleanup.lessonIds.push(st.lessonId);
  }),

  smoke('GET /api/lessons', async ({ api, projectId }) => {
    const r = await api.get(`/api/lessons?project_id=${projectId}&limit=5`);
    expectStatus(r, 200);
    if (!Array.isArray(r.body?.items)) throw new Error('Expected items array');
  }),

  smoke('POST /api/lessons/search', async ({ api, projectId }) => {
    const r = await api.post('/api/lessons/search', {
      project_id: projectId,
      query: 'smoke test',
      limit: 3,
    });
    expectStatus(r, 200);
  }),

  smoke('GET /api/lessons/:id/versions', async ({ api, projectId }) => {
    if (!st.lessonId) throw new Error('SKIP: no lesson created');
    const r = await api.get(`/api/lessons/${st.lessonId}/versions?project_id=${projectId}`);
    expectStatus(r, 200);
  }),

  smoke('PUT /api/lessons/:id', async ({ api, projectId }) => {
    if (!st.lessonId) throw new Error('SKIP: no lesson created');
    const r = await api.put(`/api/lessons/${st.lessonId}`, {
      project_id: projectId,
      title: 'Smoke test lesson (updated)',
    });
    expectStatus(r, 200);
  }),

  smoke('PATCH /api/lessons/:id/status', async ({ api, projectId }) => {
    if (!st.lessonId) throw new Error('SKIP: no lesson created');
    const r = await api.patch(`/api/lessons/${st.lessonId}/status`, {
      project_id: projectId,
      status: 'active',
    });
    expectStatus(r, 200);
  }),

  smoke('POST /api/lessons/batch-status', async ({ api, projectId }) => {
    if (!st.lessonId) throw new Error('SKIP: no lesson created');
    const r = await api.post('/api/lessons/batch-status', {
      project_id: projectId,
      lesson_ids: [st.lessonId],
      status: 'active',
    });
    expectStatus(r, 200);
  }),

  smoke('GET /api/lessons/export', async ({ api, projectId }) => {
    const r = await api.get(`/api/lessons/export?project_id=${projectId}`);
    expectStatus(r, 200);
  }),

  smoke('POST /api/lessons/import', async ({ api, projectId }) => {
    const r = await api.post('/api/lessons/import', {
      project_id: projectId,
      lessons: [],
      skip_duplicates: true,
    });
    expectStatus(r, 200);
  }),
];

// ── Guardrails ───────────────────────────────────────────────────────────

const guardrailTests: TestFn[] = [
  smoke('GET /api/guardrails/rules', async ({ api, projectId }) => {
    const r = await api.get(`/api/guardrails/rules?project_id=${projectId}`);
    expectStatus(r, 200);
  }),

  smoke('POST /api/guardrails/check', async ({ api, projectId }) => {
    const r = await api.post('/api/guardrails/check', {
      project_id: projectId,
      action_context: { action: 'smoke test action' },
    });
    expectStatus(r, 200);
  }),

  smoke('POST /api/guardrails/simulate', async ({ api, projectId }) => {
    const r = await api.post('/api/guardrails/simulate', {
      project_id: projectId,
      actions: ['test action 1', 'test action 2'],
    });
    expectStatus(r, 200);
  }),
];

// ── Search ───────────────────────────────────────────────────────────────

const searchTests: TestFn[] = [
  smoke('GET /api/search/global', async ({ api, projectId }) => {
    const r = await api.get(`/api/search/global?project_id=${projectId}&q=test`);
    expectStatus(r, 200);
  }),

  smoke('POST /api/search/code-tiered', async ({ api, projectId }) => {
    const r = await api.post('/api/search/code-tiered', {
      project_id: projectId,
      query: 'test',
    });
    expectStatus(r, 200);
  }),
];

// ── Documents ────────────────────────────────────────────────────────────

const documentTests: TestFn[] = [
  smoke('POST /api/documents (create)', async ({ api, projectId, runMarker, cleanup }) => {
    const r = await api.post('/api/documents', {
      project_id: projectId,
      name: `smoke-doc-${runMarker}.md`,
      doc_type: 'markdown',
      content: '# Smoke test document',
    });
    expectStatus(r, 201);
    st.docId = r.body?.doc_id ?? r.body?.document_id;
    if (st.docId) cleanup.documentIds.push(st.docId);
  }),

  smoke('GET /api/documents', async ({ api, projectId }) => {
    const r = await api.get(`/api/documents?project_id=${projectId}`);
    expectStatus(r, 200);
  }),

  smoke('GET /api/documents/:id', async ({ api, projectId }) => {
    if (!st.docId) throw new Error('SKIP: no document created');
    const r = await api.get(`/api/documents/${st.docId}?project_id=${projectId}`);
    expectStatus(r, 200);
  }),

  smoke('POST /api/documents/:id/lessons/:lid (link)', async ({ api, projectId }) => {
    if (!st.docId || !st.lessonId) throw new Error('SKIP: no doc or lesson');
    const r = await api.post(`/api/documents/${st.docId}/lessons/${st.lessonId}`, {
      project_id: projectId,
    });
    // 201 or 200 (already linked)
    if (r.status !== 201 && r.status !== 200) throw new Error(`Expected 201 or 200, got ${r.status}`);
  }),

  smoke('GET /api/documents/:id/lessons', async ({ api, projectId }) => {
    if (!st.docId) throw new Error('SKIP: no document created');
    const r = await api.get(`/api/documents/${st.docId}/lessons?project_id=${projectId}`);
    expectStatus(r, 200);
  }),

  smoke('DELETE /api/documents/:id/lessons/:lid (unlink)', async ({ api, projectId }) => {
    if (!st.docId || !st.lessonId) throw new Error('SKIP: no doc or lesson');
    const r = await api.delete(`/api/documents/${st.docId}/lessons/${st.lessonId}?project_id=${projectId}`);
    expectStatus(r, 200);
  }),

  smoke('DELETE /api/documents/:id', async ({ api, cleanup }) => {
    if (!st.docId) throw new Error('SKIP: no document created');
    const r = await api.delete(`/api/documents/${st.docId}?project_id=${encodeURIComponent('e2e-test-project')}`);
    expectStatus(r, 200);
    cleanup.documentIds = cleanup.documentIds.filter((id: string) => id !== st.docId);
    st.docId = undefined;
  }),
];

// ── Collaboration ────────────────────────────────────────────────────────

const collaborationTests: TestFn[] = [
  smoke('GET /api/lessons/:id/comments', async ({ api }) => {
    if (!st.lessonId) throw new Error('SKIP: no lesson');
    const r = await api.get(`/api/lessons/${st.lessonId}/comments`);
    expectStatus(r, 200);
  }),

  smoke('POST /api/lessons/:id/comments', async ({ api }) => {
    if (!st.lessonId) throw new Error('SKIP: no lesson');
    const r = await api.post(`/api/lessons/${st.lessonId}/comments`, {
      author: 'e2e-smoke',
      content: 'Smoke test comment',
    });
    expectStatus(r, 201);
    st.commentId = r.body?.comment_id;
  }),

  smoke('DELETE /api/lessons/:id/comments/:cid', async ({ api }) => {
    if (!st.lessonId || !st.commentId) throw new Error('SKIP: no comment');
    const r = await api.delete(`/api/lessons/${st.lessonId}/comments/${st.commentId}`);
    expectStatus(r, 200);
  }),

  smoke('GET /api/lessons/:id/feedback', async ({ api }) => {
    if (!st.lessonId) throw new Error('SKIP: no lesson');
    const r = await api.get(`/api/lessons/${st.lessonId}/feedback`);
    expectStatus(r, 200);
  }),

  smoke('POST /api/lessons/:id/feedback', async ({ api }) => {
    if (!st.lessonId) throw new Error('SKIP: no lesson');
    const r = await api.post(`/api/lessons/${st.lessonId}/feedback`, {
      user_id: 'e2e-smoke',
      vote: 1,
    });
    expectStatus(r, 200);
  }),

  smoke('DELETE /api/lessons/:id/feedback', async ({ api }) => {
    if (!st.lessonId) throw new Error('SKIP: no lesson');
    const r = await api.delete(`/api/lessons/${st.lessonId}/feedback?user_id=e2e-smoke`);
    expectStatus(r, 200);
  }),
];

// ── Bookmarks ────────────────────────────────────────────────────────────

const bookmarkTests: TestFn[] = [
  smoke('GET /api/bookmarks', async ({ api, projectId }) => {
    const r = await api.get(`/api/bookmarks?project_id=${projectId}&user_id=e2e-smoke`);
    expectStatus(r, 200);
  }),

  smoke('POST /api/bookmarks', async ({ api, projectId }) => {
    if (!st.lessonId) throw new Error('SKIP: no lesson');
    const r = await api.post('/api/bookmarks', {
      project_id: projectId,
      lesson_id: st.lessonId,
      user_id: 'e2e-smoke',
    });
    // 201 or 200 (already bookmarked)
    if (r.status !== 201 && r.status !== 200) throw new Error(`Expected 201 or 200, got ${r.status}`);
  }),

  smoke('DELETE /api/bookmarks', async ({ api, projectId }) => {
    if (!st.lessonId) throw new Error('SKIP: no lesson');
    const r = await api.delete(`/api/bookmarks?project_id=${projectId}&lesson_id=${st.lessonId}&user_id=e2e-smoke`);
    expectStatus(r, 200);
  }),
];

// ── Chat + Conversations ─────────────────────────────────────────────────

const chatTests: TestFn[] = [
  smoke('POST /api/chat/conversations', async ({ api, projectId, cleanup }) => {
    const r = await api.post('/api/chat/conversations', { project_id: projectId });
    expectStatus(r, 201);
    st.convId = r.body?.conversation_id;
    if (st.convId) cleanup.conversationIds.push(st.convId);
  }),

  smoke('GET /api/chat/conversations', async ({ api, projectId }) => {
    const r = await api.get(`/api/chat/conversations?project_id=${projectId}`);
    expectStatus(r, 200);
  }),

  smoke('GET /api/chat/conversations/:id', async ({ api, projectId }) => {
    if (!st.convId) throw new Error('SKIP: no conversation');
    const r = await api.get(`/api/chat/conversations/${st.convId}?project_id=${projectId}`);
    expectStatus(r, 200);
  }),

  smoke('POST /api/chat/conversations/:id/messages', async ({ api, projectId }) => {
    if (!st.convId) throw new Error('SKIP: no conversation');
    const r = await api.post(`/api/chat/conversations/${st.convId}/messages`, {
      project_id: projectId,
      role: 'user',
      content: 'Smoke test message',
    });
    expectStatus(r, 201);
  }),

  smoke('DELETE /api/chat/conversations/:id', async ({ api, projectId, cleanup }) => {
    if (!st.convId) throw new Error('SKIP: no conversation');
    const r = await api.delete(`/api/chat/conversations/${st.convId}?project_id=${projectId}`);
    expectStatus(r, 200);
    cleanup.conversationIds = cleanup.conversationIds.filter((id: string) => id !== st.convId);
    st.convId = undefined;
  }),
];

// ── Activity + Notifications ─────────────────────────────────────────────

const activityTests: TestFn[] = [
  smoke('GET /api/activity', async ({ api, projectId }) => {
    const r = await api.get(`/api/activity?project_id=${projectId}`);
    expectStatus(r, 200);
  }),

  smoke('GET /api/notifications', async ({ api, projectId }) => {
    const r = await api.get(`/api/notifications?project_id=${projectId}&user_id=e2e-smoke`);
    expectStatus(r, 200);
  }),

  smoke('GET /api/notifications/settings', async ({ api, projectId }) => {
    const r = await api.get(`/api/notifications/settings?project_id=${projectId}&user_id=e2e-smoke`);
    expectStatus(r, 200);
  }),
];

// ── Analytics ────────────────────────────────────────────────────────────

const analyticsTests: TestFn[] = [
  smoke('GET /api/analytics/overview', async ({ api, projectId }) => {
    const r = await api.get(`/api/analytics/overview?project_id=${projectId}`);
    expectStatus(r, 200);
  }),

  smoke('GET /api/analytics/by-type', async ({ api, projectId }) => {
    const r = await api.get(`/api/analytics/by-type?project_id=${projectId}`);
    expectStatus(r, 200);
  }),

  smoke('GET /api/analytics/top-lessons', async ({ api, projectId }) => {
    const r = await api.get(`/api/analytics/top-lessons?project_id=${projectId}`);
    expectStatus(r, 200);
  }),

  smoke('GET /api/analytics/dead-knowledge', async ({ api, projectId }) => {
    const r = await api.get(`/api/analytics/dead-knowledge?project_id=${projectId}`);
    expectStatus(r, 200);
  }),

  smoke('GET /api/analytics/timeseries', async ({ api, projectId }) => {
    const r = await api.get(`/api/analytics/timeseries?project_id=${projectId}`);
    expectStatus(r, 200);
  }),

  smoke('GET /api/analytics/agents', async ({ api, projectId }) => {
    const r = await api.get(`/api/analytics/agents?project_id=${projectId}`);
    expectStatus(r, 200);
  }),
];

// ── Git ──────────────────────────────────────────────────────────────────

const gitTests: TestFn[] = [
  smoke('GET /api/git/commits', async ({ api, projectId }) => {
    const r = await api.get(`/api/git/commits?project_id=${projectId}`);
    expectStatus(r, 200);
  }),

  smoke('POST /api/git/suggest-lessons', async ({ api, projectId }) => {
    const r = await api.post('/api/git/suggest-lessons', { project_id: projectId });
    expectStatus(r, 200);
  }),
];

// ── Groups ───────────────────────────────────────────────────────────────

const groupTests: TestFn[] = [
  smoke('GET /api/groups', async ({ api }) => {
    const r = await api.get('/api/groups');
    expectStatus(r, 200);
  }),

  smoke('POST /api/groups', async ({ api, runMarker, cleanup }) => {
    const gid = `e2e_smoke_${runMarker.slice(4, 12)}`;
    const r = await api.post('/api/groups', { group_id: gid, name: `e2e-smoke-group` });
    expectStatus(r, 201);
    st.groupId = r.body?.group_id;
    if (st.groupId) cleanup.groupIds.push(st.groupId);
  }),

  smoke('GET /api/groups/:id/members', async ({ api }) => {
    if (!st.groupId) throw new Error('SKIP: no group');
    const r = await api.get(`/api/groups/${st.groupId}/members`);
    expectStatus(r, 200);
  }),

  smoke('POST /api/groups/:id/members', async ({ api, projectId }) => {
    if (!st.groupId) throw new Error('SKIP: no group');
    const r = await api.post(`/api/groups/${st.groupId}/members`, { project_id: projectId });
    // 201 or 200 (already member)
    if (r.status !== 201 && r.status !== 200) throw new Error(`Expected 201 or 200, got ${r.status}`);
  }),

  smoke('DELETE /api/groups/:id/members/:pid', async ({ api, projectId }) => {
    if (!st.groupId) throw new Error('SKIP: no group');
    const r = await api.delete(`/api/groups/${st.groupId}/members/${projectId}`);
    expectStatus(r, 200);
  }),

  smoke('GET /api/groups/by-project/:pid', async ({ api, projectId }) => {
    const r = await api.get(`/api/groups/by-project/${projectId}`);
    expectStatus(r, 200);
  }),

  smoke('DELETE /api/groups/:id', async ({ api, cleanup }) => {
    if (!st.groupId) throw new Error('SKIP: no group');
    const r = await api.delete(`/api/groups/${st.groupId}`);
    expectStatus(r, 200);
    cleanup.groupIds = cleanup.groupIds.filter((id: string) => id !== st.groupId);
    st.groupId = undefined;
  }),
];

// ── Lesson Types ─────────────────────────────────────────────────────────

const lessonTypeTests: TestFn[] = [
  smoke('GET /api/lesson-types', async ({ api }) => {
    const r = await api.get('/api/lesson-types');
    expectStatus(r, 200);
  }),

  smoke('POST /api/lesson-types', async ({ api, runMarker, cleanup }) => {
    st.lessonTypeKey = `e2e_smoke_${runMarker.slice(4, 12).replace(/[^a-z0-9_]/g, '')}`;
    const r = await api.post('/api/lesson-types', {
      type_key: st.lessonTypeKey,
      display_name: 'E2E Smoke Type',
      color: 'blue',
    });
    expectStatus(r, 201);
    cleanup.lessonTypeKeys.push(st.lessonTypeKey);
  }),

  smoke('PUT /api/lesson-types/:key', async ({ api }) => {
    if (!st.lessonTypeKey) throw new Error('SKIP: no lesson type');
    const r = await api.put(`/api/lesson-types/${st.lessonTypeKey}`, {
      display_name: 'E2E Smoke Type Updated',
    });
    expectStatus(r, 200);
  }),

  smoke('DELETE /api/lesson-types/:key', async ({ api, cleanup }) => {
    if (!st.lessonTypeKey) throw new Error('SKIP: no lesson type');
    const r = await api.delete(`/api/lesson-types/${st.lessonTypeKey}`);
    expectStatus(r, 200);
    cleanup.lessonTypeKeys = cleanup.lessonTypeKeys.filter((k: string) => k !== st.lessonTypeKey);
    st.lessonTypeKey = undefined;
  }),
];

// ── API Keys ─────────────────────────────────────────────────────────────

const apiKeyTests: TestFn[] = [
  smoke('GET /api/api-keys', async ({ api }) => {
    const r = await api.get('/api/api-keys');
    expectStatus(r, 200);
  }),

  smoke('POST /api/api-keys', async ({ api, runMarker, cleanup }) => {
    const r = await api.post('/api/api-keys', {
      name: `e2e-smoke-key-${runMarker.slice(0, 8)}`,
      role: 'reader',
    });
    expectStatus(r, 201);
    st.apiKeyId = r.body?.key_id;
    if (st.apiKeyId) cleanup.apiKeyIds.push(st.apiKeyId);
  }),

  smoke('DELETE /api/api-keys/:id', async ({ api, cleanup }) => {
    if (!st.apiKeyId) throw new Error('SKIP: no API key');
    const r = await api.delete(`/api/api-keys/${st.apiKeyId}`);
    expectStatus(r, 200);
    cleanup.apiKeyIds = cleanup.apiKeyIds.filter((id: string) => id !== st.apiKeyId);
    st.apiKeyId = undefined;
  }),
];

// ── Audit ────────────────────────────────────────────────────────────────

const auditTests: TestFn[] = [
  smoke('GET /api/audit', async ({ api, projectId }) => {
    const r = await api.get(`/api/audit?project_id=${projectId}`);
    expectStatus(r, 200);
  }),

  smoke('GET /api/audit/stats', async ({ api, projectId }) => {
    const r = await api.get(`/api/audit/stats?project_id=${projectId}`);
    expectStatus(r, 200);
  }),
];

// ── Agents ───────────────────────────────────────────────────────────────

const agentTests: TestFn[] = [
  smoke('GET /api/agents', async ({ api, projectId }) => {
    const r = await api.get(`/api/agents?project_id=${projectId}`);
    expectStatus(r, 200);
  }),
];

// ── Generated Docs ───────────────────────────────────────────────────────

const generatedDocTests: TestFn[] = [
  smoke('GET /api/generated-docs', async ({ api, projectId }) => {
    const r = await api.get(`/api/generated-docs?project_id=${projectId}`);
    expectStatus(r, 200);
  }),
];

// ── Jobs ─────────────────────────────────────────────────────────────────

const jobTests: TestFn[] = [
  smoke('GET /api/jobs', async ({ api, projectId }) => {
    const r = await api.get(`/api/jobs?project_id=${projectId}`);
    expectStatus(r, 200);
  }),
];

// ── Learning Paths ───────────────────────────────────────────────────────

const learningPathTests: TestFn[] = [
  smoke('GET /api/learning-paths', async ({ api, projectId }) => {
    const r = await api.get(`/api/learning-paths?project_id=${projectId}&user_id=e2e-smoke`);
    expectStatus(r, 200);
  }),
];

// ── Workspace ────────────────────────────────────────────────────────────

const workspaceTests: TestFn[] = [
  smoke('GET /api/workspace/roots', async ({ api, projectId }) => {
    const r = await api.get(`/api/workspace/roots?project_id=${projectId}`);
    expectStatus(r, 200);
  }),

  smoke('GET /api/sources', async ({ api, projectId }) => {
    const r = await api.get(`/api/sources?project_id=${projectId}`);
    // 200 or 404 (no source configured)
    if (r.status !== 200 && r.status !== 404) throw new Error(`Expected 200 or 404, got ${r.status}`);
  }),
];

// ── Export all ────────────────────────────────────────────────────────────

export const allApiSmokeTests: TestFn[] = [
  ...systemTests,
  ...projectTests,
  ...lessonTests,
  ...guardrailTests,
  ...searchTests,
  ...documentTests,
  ...collaborationTests,
  ...bookmarkTests,
  ...chatTests,
  ...activityTests,
  ...analyticsTests,
  ...gitTests,
  ...groupTests,
  ...lessonTypeTests,
  ...apiKeyTests,
  ...auditTests,
  ...agentTests,
  ...generatedDocTests,
  ...jobTests,
  ...learningPathTests,
  ...workspaceTests,
];
