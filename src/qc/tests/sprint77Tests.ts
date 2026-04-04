/**
 * Integration tests for Sprint 7.7 BE endpoints.
 * Tests new endpoints: upload, suggest-tags, timeseries, notification settings,
 * document reverse lookup, feedback in lesson list.
 */
import { pass, fail } from '../testTypes.js';
import type { TestContext, TestFn } from '../testTypes.js';

const GROUP = 'lessons' as const;
const API_BASE = process.env.API_BASE_URL?.trim() || 'http://localhost:3001';

function json(body: Record<string, unknown>) {
  return { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) };
}

// ── Helper: create a test lesson ──
async function createLesson(ctx: TestContext, extra: Record<string, unknown> = {}): Promise<any> {
  const res = await (await fetch(`${API_BASE}/api/lessons`, json({
    project_id: ctx.projectId,
    lesson_type: 'decision',
    title: `Sprint77 test ${Date.now()}`,
    content: 'Integration test content for sprint 77',
    tags: ['integration-test', 'sprint-77'],
    ...extra,
  }))).json() as any;
  if (res.lesson_id) ctx.createdLessonIds.push(res.lesson_id);
  return res;
}

// ════════════════════════════════════════════════════════════════════════

/** Test: POST /api/documents/upload — multipart file upload */
export const documentUploadTest: TestFn = async (ctx) => {
  const name = 'document-upload-multipart';
  const start = Date.now();

  try {
    const form = new FormData();
    form.append('project_id', ctx.projectId);
    form.append('file', new Blob(['# Test Document\n\nThis is a test markdown file.'], { type: 'text/markdown' }), 'test-upload.md');
    form.append('description', 'Integration test upload');

    const res = await fetch(`${API_BASE}/api/documents/upload`, { method: 'POST', body: form });
    if (!res.ok) return fail(name, GROUP, Date.now() - start, `Upload returned ${res.status}`);

    const doc = await res.json() as any;
    if (!doc.doc_id && !doc.document_id) return fail(name, GROUP, Date.now() - start, 'No doc_id in response');
    if (doc.doc_type !== 'markdown') return fail(name, GROUP, Date.now() - start, `Expected markdown, got ${doc.doc_type}`);
    if (doc.name !== 'test-upload.md') return fail(name, GROUP, Date.now() - start, `Name mismatch: ${doc.name}`);

    // Cleanup
    const docId = doc.doc_id ?? doc.document_id;
    await fetch(`${API_BASE}/api/documents/${docId}?project_id=${ctx.projectId}`, { method: 'DELETE' });

    return pass(name, GROUP, Date.now() - start);
  } catch (err) {
    return fail(name, GROUP, Date.now() - start, `Exception: ${err instanceof Error ? err.message : String(err)}`);
  }
};

/** Test: POST /api/documents/upload — no file returns 400 */
export const documentUploadNoFileTest: TestFn = async (ctx) => {
  const name = 'document-upload-no-file';
  const start = Date.now();

  try {
    const form = new FormData();
    form.append('project_id', ctx.projectId);

    const res = await fetch(`${API_BASE}/api/documents/upload`, { method: 'POST', body: form });
    if (res.status !== 400) return fail(name, GROUP, Date.now() - start, `Expected 400, got ${res.status}`);

    return pass(name, GROUP, Date.now() - start);
  } catch (err) {
    return fail(name, GROUP, Date.now() - start, `Exception: ${err instanceof Error ? err.message : String(err)}`);
  }
};

// ════════════════════════════════════════════════════════════════════════

/** Test: POST /api/lessons/:id/suggest-tags */
export const suggestTagsTest: TestFn = async (ctx) => {
  const name = 'suggest-tags';
  const start = Date.now();

  try {
    const lesson = await createLesson(ctx, {
      title: 'Use PostgreSQL connection pooling for performance',
      content: 'When connecting to PostgreSQL from Node.js, always use a connection pool. Set max connections to 20. Use pg library with Pool class.',
      tags: ['database'],
    });

    const res = await (await fetch(`${API_BASE}/api/lessons/${lesson.lesson_id}/suggest-tags`, json({
      project_id: ctx.projectId,
    }))).json() as any;

    if (res.status !== 'ok') return fail(name, GROUP, Date.now() - start, `Status: ${res.status}`);
    if (!Array.isArray(res.suggestions)) return fail(name, GROUP, Date.now() - start, 'Missing suggestions array');
    if (res.suggestions.length === 0) return fail(name, GROUP, Date.now() - start, 'No suggestions returned');

    // Should not include existing tag "database"
    if (res.suggestions.includes('database')) return fail(name, GROUP, Date.now() - start, 'Suggested existing tag "database"');

    // Should suggest something relevant like "postgresql", "connection", "pool"
    const relevant = res.suggestions.some((t: string) => ['postgresql', 'connection', 'pool', 'node', 'performance'].includes(t));
    if (!relevant) return fail(name, GROUP, Date.now() - start, `Suggestions not relevant: ${res.suggestions.join(', ')}`);

    return pass(name, GROUP, Date.now() - start);
  } catch (err) {
    return fail(name, GROUP, Date.now() - start, `Exception: ${err instanceof Error ? err.message : String(err)}`);
  }
};

// ════════════════════════════════════════════════════════════════════════

/** Test: GET /api/analytics/timeseries */
export const analyticsTimeseriesTest: TestFn = async (ctx) => {
  const name = 'analytics-timeseries';
  const start = Date.now();

  try {
    const res = await (await fetch(`${API_BASE}/api/analytics/timeseries?project_id=${ctx.projectId}&days=7`)).json() as any;

    if (!Array.isArray(res.points)) return fail(name, GROUP, Date.now() - start, 'Missing points array');
    // Should have ~7-8 points for 7 days
    if (res.points.length < 7) return fail(name, GROUP, Date.now() - start, `Expected >=7 points, got ${res.points.length}`);

    // Each point should have date + count
    const first = res.points[0];
    if (!first.date) return fail(name, GROUP, Date.now() - start, 'Point missing date');
    if (first.count === undefined) return fail(name, GROUP, Date.now() - start, 'Point missing count');

    // Dates should be ordered ascending
    for (let i = 1; i < res.points.length; i++) {
      if (res.points[i].date < res.points[i - 1].date) {
        return fail(name, GROUP, Date.now() - start, 'Points not in ascending date order');
      }
    }

    return pass(name, GROUP, Date.now() - start);
  } catch (err) {
    return fail(name, GROUP, Date.now() - start, `Exception: ${err instanceof Error ? err.message : String(err)}`);
  }
};

// ════════════════════════════════════════════════════════════════════════

/** Test: GET/PUT /api/notifications/settings */
export const notificationSettingsTest: TestFn = async (ctx) => {
  const name = 'notification-settings-crud';
  const start = Date.now();

  try {
    const userId = `test-user-${Date.now()}`;

    // Save settings
    const save = await (await fetch(`${API_BASE}/api/notifications/settings`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        project_id: ctx.projectId,
        user_id: userId,
        settings: { job_failures: true, guardrail_violations: false, new_lessons: true },
      }),
    })).json() as any;
    if (save.status !== 'ok') return fail(name, GROUP, Date.now() - start, `Save failed: ${save.error}`);

    // Load settings
    const load = await (await fetch(`${API_BASE}/api/notifications/settings?project_id=${ctx.projectId}&user_id=${userId}`)).json() as any;
    if (load.status !== 'ok') return fail(name, GROUP, Date.now() - start, `Load failed: ${load.error}`);
    if (load.settings?.job_failures !== true) return fail(name, GROUP, Date.now() - start, 'job_failures should be true');
    if (load.settings?.guardrail_violations !== false) return fail(name, GROUP, Date.now() - start, 'guardrail_violations should be false');
    if (load.settings?.new_lessons !== true) return fail(name, GROUP, Date.now() - start, 'new_lessons should be true');

    // Partial update
    await fetch(`${API_BASE}/api/notifications/settings`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ project_id: ctx.projectId, user_id: userId, settings: { guardrail_violations: true } }),
    });
    const load2 = await (await fetch(`${API_BASE}/api/notifications/settings?project_id=${ctx.projectId}&user_id=${userId}`)).json() as any;
    if (load2.settings?.guardrail_violations !== true) return fail(name, GROUP, Date.now() - start, 'Partial update failed');
    if (load2.settings?.job_failures !== true) return fail(name, GROUP, Date.now() - start, 'Partial update overwrote other settings');

    return pass(name, GROUP, Date.now() - start);
  } catch (err) {
    return fail(name, GROUP, Date.now() - start, `Exception: ${err instanceof Error ? err.message : String(err)}`);
  }
};

// ════════════════════════════════════════════════════════════════════════

/** Test: GET /api/documents?lesson_id=X — reverse lookup */
export const documentReverseLookupTest: TestFn = async (ctx) => {
  const name = 'document-reverse-lookup';
  const start = Date.now();

  try {
    // Create lesson + document + link them
    const lesson = await createLesson(ctx);
    const doc = await (await fetch(`${API_BASE}/api/documents`, json({
      project_id: ctx.projectId,
      name: `Reverse lookup test ${Date.now()}.md`,
      doc_type: 'markdown',
      content: 'Test content for reverse lookup',
    }))).json() as any;
    const docId = doc.doc_id ?? doc.document_id;

    await fetch(`${API_BASE}/api/documents/${docId}/lessons/${lesson.lesson_id}`, json({
      project_id: ctx.projectId,
    }));

    // Reverse lookup: find docs by lesson_id
    const res = await (await fetch(`${API_BASE}/api/documents?project_id=${ctx.projectId}&lesson_id=${lesson.lesson_id}`)).json() as any;
    if (!Array.isArray(res.items)) return fail(name, GROUP, Date.now() - start, 'Missing items array');
    const found = res.items.some((d: any) => (d.doc_id ?? d.document_id) === docId);
    if (!found) return fail(name, GROUP, Date.now() - start, 'Linked document not found in reverse lookup');

    // Non-existent lesson returns empty (use a UUID that won't match any real lesson)
    const fakeId = '00000000-aaaa-bbbb-cccc-000000000000';
    const empty = await (await fetch(`${API_BASE}/api/documents?project_id=${ctx.projectId}&lesson_id=${fakeId}`)).json() as any;
    if ((empty.items?.length ?? 0) > 0) return fail(name, GROUP, Date.now() - start, `Expected empty for non-existent lesson, got ${empty.items.length}`);

    // Cleanup
    await fetch(`${API_BASE}/api/documents/${docId}?project_id=${ctx.projectId}`, { method: 'DELETE' });

    return pass(name, GROUP, Date.now() - start);
  } catch (err) {
    return fail(name, GROUP, Date.now() - start, `Exception: ${err instanceof Error ? err.message : String(err)}`);
  }
};

// ════════════════════════════════════════════════════════════════════════

/** Test: GET /api/lessons returns feedback_up/feedback_down */
export const feedbackInListTest: TestFn = async (ctx) => {
  const name = 'feedback-in-lesson-list';
  const start = Date.now();

  try {
    // Create lesson and vote
    const lesson = await createLesson(ctx);

    await fetch(`${API_BASE}/api/lessons/${lesson.lesson_id}/feedback`, json({
      user_id: 'voter-a', vote: 1,
    }));
    await fetch(`${API_BASE}/api/lessons/${lesson.lesson_id}/feedback`, json({
      user_id: 'voter-b', vote: 1,
    }));
    await fetch(`${API_BASE}/api/lessons/${lesson.lesson_id}/feedback`, json({
      user_id: 'voter-c', vote: -1,
    }));

    // List lessons
    const res = await (await fetch(`${API_BASE}/api/lessons?project_id=${ctx.projectId}&limit=50`)).json() as any;
    const item = res.items?.find((l: any) => l.lesson_id === lesson.lesson_id);
    if (!item) return fail(name, GROUP, Date.now() - start, 'Lesson not found in list');
    if (item.feedback_up !== 2) return fail(name, GROUP, Date.now() - start, `Expected feedback_up=2, got ${item.feedback_up}`);
    if (item.feedback_down !== 1) return fail(name, GROUP, Date.now() - start, `Expected feedback_down=1, got ${item.feedback_down}`);

    return pass(name, GROUP, Date.now() - start);
  } catch (err) {
    return fail(name, GROUP, Date.now() - start, `Exception: ${err instanceof Error ? err.message : String(err)}`);
  }
};

// ════════════════════════════════════════════════════════════════════════

export const allSprint77Tests: TestFn[] = [
  documentUploadTest,
  documentUploadNoFileTest,
  suggestTagsTest,
  analyticsTimeseriesTest,
  notificationSettingsTest,
  documentReverseLookupTest,
  feedbackInListTest,
];
