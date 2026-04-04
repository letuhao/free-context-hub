import { callTool, withAuth, pass, fail } from '../testTypes.js';
import type { TestContext, TestFn } from '../testTypes.js';

const GROUP = 'lessons' as const; // reuse lessons group since documents are tightly coupled
const API_BASE = process.env.API_BASE_URL?.trim() || 'http://localhost:3001';

/**
 * Test: Document CRUD + linking lifecycle
 * create doc → create lesson → link → list linked → get (count=1) → unlink → delete → 404
 */
export const documentCrudAndLinking: TestFn = async (ctx) => {
  const name = 'document-crud-linking';
  const start = Date.now();

  try {
    // 1. Create a markdown document.
    const createRes = await fetch(`${API_BASE}/api/documents`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        project_id: ctx.projectId, name: 'Test RFC.md', doc_type: 'markdown',
        content: '# Test\n\nTest content for integration testing.',
        tags: ['integration-test'],
      }),
    });
    if (createRes.status !== 201) return fail(name, GROUP, Date.now() - start, `Create doc returned ${createRes.status}`);
    const doc = await createRes.json() as any;
    const docId = doc.doc_id;
    if (!docId) return fail(name, GROUP, Date.now() - start, 'No doc_id returned');

    // 2. Create a lesson to link with.
    const lessonRes = await fetch(`${API_BASE}/api/lessons`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        project_id: ctx.projectId, lesson_type: 'decision',
        title: 'Doc link test', content: 'Test lesson for doc linking',
        tags: ['integration-test', 'doc-link-test'],
      }),
    });
    const lesson = await lessonRes.json() as any;
    const lessonId = lesson.lesson_id;
    if (!lessonId) return fail(name, GROUP, Date.now() - start, 'No lesson_id');
    ctx.createdLessonIds.push(lessonId);

    // 3. Link doc to lesson.
    const linkRes = await fetch(`${API_BASE}/api/documents/${docId}/lessons/${lessonId}`, { method: 'POST' });
    if (linkRes.status !== 201) return fail(name, GROUP, Date.now() - start, `Link returned ${linkRes.status}`);

    // 4. List linked lessons.
    const linkedRes = await fetch(`${API_BASE}/api/documents/${docId}/lessons`);
    const linked = await linkedRes.json() as any;
    if (linked.lessons?.length !== 1) return fail(name, GROUP, Date.now() - start, `Expected 1 linked lesson, got ${linked.lessons?.length}`);

    // 5. Get doc — linked_lesson_count should be 1.
    const getRes = await fetch(`${API_BASE}/api/documents/${docId}?project_id=${ctx.projectId}`);
    const got = await getRes.json() as any;
    if (got.linked_lesson_count !== 1) return fail(name, GROUP, Date.now() - start, `Expected linked_lesson_count=1, got ${got.linked_lesson_count}`);

    // 6. List with filter=linked.
    const linkedFilter = await fetch(`${API_BASE}/api/documents?project_id=${ctx.projectId}&linked=linked`);
    const lf = await linkedFilter.json() as any;
    const found = lf.items?.some((d: any) => d.doc_id === docId);
    if (!found) return fail(name, GROUP, Date.now() - start, 'Doc not in linked filter');

    // 7. Unlink.
    const unlinkRes = await fetch(`${API_BASE}/api/documents/${docId}/lessons/${lessonId}`, { method: 'DELETE' });
    const unlink = await unlinkRes.json() as any;
    if (unlink.status !== 'ok') return fail(name, GROUP, Date.now() - start, `Unlink failed: ${unlink.error}`);

    // 8. Delete doc.
    const delRes = await fetch(`${API_BASE}/api/documents/${docId}?project_id=${ctx.projectId}`, { method: 'DELETE' });
    const del = await delRes.json() as any;
    if (del.status !== 'ok') return fail(name, GROUP, Date.now() - start, `Delete failed`);

    // 9. 404 after delete.
    const goneRes = await fetch(`${API_BASE}/api/documents/${docId}?project_id=${ctx.projectId}`);
    if (goneRes.status !== 404) return fail(name, GROUP, Date.now() - start, `Expected 404, got ${goneRes.status}`);

    return pass(name, GROUP, Date.now() - start);
  } catch (err) {
    return fail(name, GROUP, Date.now() - start, `Exception: ${err instanceof Error ? err.message : String(err)}`);
  }
};

/**
 * Test: Document type filter
 */
export const documentTypeFilter: TestFn = async (ctx) => {
  const name = 'document-type-filter';
  const start = Date.now();

  try {
    // Create markdown + url docs.
    const md = await (await fetch(`${API_BASE}/api/documents`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ project_id: ctx.projectId, name: 'filter-test.md', doc_type: 'markdown', content: 'test', tags: ['filter-test'] }),
    })).json() as any;

    const url = await (await fetch(`${API_BASE}/api/documents`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ project_id: ctx.projectId, name: 'filter-test-url', doc_type: 'url', url: 'https://example.com', tags: ['filter-test'] }),
    })).json() as any;

    // Filter by markdown.
    const mdList = await (await fetch(`${API_BASE}/api/documents?project_id=${ctx.projectId}&doc_type=markdown`)).json() as any;
    const hasMd = mdList.items?.some((d: any) => d.doc_id === md.doc_id);
    const hasUrl = mdList.items?.some((d: any) => d.doc_id === url.doc_id);
    if (!hasMd) return fail(name, GROUP, Date.now() - start, 'Markdown doc missing from markdown filter');
    if (hasUrl) return fail(name, GROUP, Date.now() - start, 'URL doc should not appear in markdown filter');

    // Cleanup.
    await fetch(`${API_BASE}/api/documents/${md.doc_id}?project_id=${ctx.projectId}`, { method: 'DELETE' });
    await fetch(`${API_BASE}/api/documents/${url.doc_id}?project_id=${ctx.projectId}`, { method: 'DELETE' });

    return pass(name, GROUP, Date.now() - start);
  } catch (err) {
    return fail(name, GROUP, Date.now() - start, `Exception: ${err instanceof Error ? err.message : String(err)}`);
  }
};

export const allDocumentTests: TestFn[] = [documentCrudAndLinking, documentTypeFilter];
