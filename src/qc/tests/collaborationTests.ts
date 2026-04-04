import { callTool, withAuth, pass, fail } from '../testTypes.js';
import type { TestContext, TestFn } from '../testTypes.js';

const GROUP = 'lessons' as const;
const API_BASE = process.env.API_BASE_URL?.trim() || 'http://localhost:3001';

/** Test: Comments CRUD + threading */
export const commentsTest: TestFn = async (ctx) => {
  const name = 'comments-crud';
  const start = Date.now();

  try {
    // Create lesson.
    const lesson = await (await fetch(`${API_BASE}/api/lessons`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ project_id: ctx.projectId, lesson_type: 'decision', title: `Comment test ${Date.now()}`, content: 'test', tags: ['integration-test'] }),
    })).json() as any;
    ctx.createdLessonIds.push(lesson.lesson_id);

    // Add root comment.
    const c1 = await (await fetch(`${API_BASE}/api/lessons/${lesson.lesson_id}/comments`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ author: 'test-user', content: 'Root comment' }),
    })).json() as any;
    if (!c1.comment_id) return fail(name, GROUP, Date.now() - start, 'No comment_id');

    // Add reply.
    const c2 = await (await fetch(`${API_BASE}/api/lessons/${lesson.lesson_id}/comments`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ author: 'test-agent', content: 'Reply', parent_id: c1.comment_id }),
    })).json() as any;
    if (c2.parent_id !== c1.comment_id) return fail(name, GROUP, Date.now() - start, 'Reply parent_id mismatch');

    // List — threaded.
    const list = await (await fetch(`${API_BASE}/api/lessons/${lesson.lesson_id}/comments`)).json() as any;
    if (list.total_count !== 2) return fail(name, GROUP, Date.now() - start, `Expected 2 comments, got ${list.total_count}`);
    const root = list.comments.find((c: any) => c.comment_id === c1.comment_id);
    if (!root?.replies?.length) return fail(name, GROUP, Date.now() - start, 'Root comment missing replies');

    // Delete reply.
    const del = await (await fetch(`${API_BASE}/api/lessons/${lesson.lesson_id}/comments/${c2.comment_id}`, { method: 'DELETE' })).json() as any;
    if (del.status !== 'ok') return fail(name, GROUP, Date.now() - start, 'Delete failed');

    return pass(name, GROUP, Date.now() - start);
  } catch (err) {
    return fail(name, GROUP, Date.now() - start, `Exception: ${err instanceof Error ? err.message : String(err)}`);
  }
};

/** Test: Feedback voting + aggregation */
export const feedbackTest: TestFn = async (ctx) => {
  const name = 'feedback-voting';
  const start = Date.now();

  try {
    const lesson = await (await fetch(`${API_BASE}/api/lessons`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ project_id: ctx.projectId, lesson_type: 'decision', title: `Feedback test ${Date.now()}`, content: 'test', tags: ['integration-test'] }),
    })).json() as any;
    ctx.createdLessonIds.push(lesson.lesson_id);

    // Two upvotes, one downvote.
    await fetch(`${API_BASE}/api/lessons/${lesson.lesson_id}/feedback`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ user_id: 'user-a', vote: 1 }),
    });
    await fetch(`${API_BASE}/api/lessons/${lesson.lesson_id}/feedback`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ user_id: 'user-b', vote: 1 }),
    });
    await fetch(`${API_BASE}/api/lessons/${lesson.lesson_id}/feedback`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ user_id: 'user-c', vote: -1 }),
    });

    // Get aggregation.
    const fb = await (await fetch(`${API_BASE}/api/lessons/${lesson.lesson_id}/feedback?user_id=user-a`)).json() as any;
    if (fb.upvotes !== 2) return fail(name, GROUP, Date.now() - start, `Expected 2 upvotes, got ${fb.upvotes}`);
    if (fb.downvotes !== 1) return fail(name, GROUP, Date.now() - start, `Expected 1 downvote, got ${fb.downvotes}`);
    if (fb.user_vote !== 1) return fail(name, GROUP, Date.now() - start, `Expected user_vote=1, got ${fb.user_vote}`);

    // Change vote (upsert).
    await fetch(`${API_BASE}/api/lessons/${lesson.lesson_id}/feedback`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ user_id: 'user-a', vote: -1 }),
    });
    const fb2 = await (await fetch(`${API_BASE}/api/lessons/${lesson.lesson_id}/feedback?user_id=user-a`)).json() as any;
    if (fb2.upvotes !== 1) return fail(name, GROUP, Date.now() - start, `After change: expected 1 upvote, got ${fb2.upvotes}`);
    if (fb2.user_vote !== -1) return fail(name, GROUP, Date.now() - start, `After change: expected user_vote=-1`);

    // Remove feedback.
    const delRes = await fetch(`${API_BASE}/api/lessons/${lesson.lesson_id}/feedback?user_id=user-a`, { method: 'DELETE' });
    const del = await delRes.json() as any;
    if (del.status !== 'ok') return fail(name, GROUP, Date.now() - start, `Remove feedback failed`);

    // Verify removed.
    const fb3 = await (await fetch(`${API_BASE}/api/lessons/${lesson.lesson_id}/feedback?user_id=user-a`)).json() as any;
    if (fb3.user_vote !== null) return fail(name, GROUP, Date.now() - start, `After remove: user_vote should be null, got ${fb3.user_vote}`);
    if (fb3.upvotes !== 1) return fail(name, GROUP, Date.now() - start, `After remove: expected 1 upvote (user-b), got ${fb3.upvotes}`);

    // Remove non-existent → 404.
    const gone = await fetch(`${API_BASE}/api/lessons/${lesson.lesson_id}/feedback?user_id=user-a`, { method: 'DELETE' });
    if (gone.status !== 404) return fail(name, GROUP, Date.now() - start, `Expected 404 for removed feedback, got ${gone.status}`);

    return pass(name, GROUP, Date.now() - start);
  } catch (err) {
    return fail(name, GROUP, Date.now() - start, `Exception: ${err instanceof Error ? err.message : String(err)}`);
  }
};

/** Test: Bookmarks add/list/remove */
export const bookmarksTest: TestFn = async (ctx) => {
  const name = 'bookmarks-crud';
  const start = Date.now();

  try {
    const lesson = await (await fetch(`${API_BASE}/api/lessons`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ project_id: ctx.projectId, lesson_type: 'decision', title: `Bookmark test ${Date.now()}`, content: 'test', tags: ['integration-test'] }),
    })).json() as any;
    ctx.createdLessonIds.push(lesson.lesson_id);

    // Add bookmark.
    const add = await (await fetch(`${API_BASE}/api/bookmarks`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ user_id: 'test-user', lesson_id: lesson.lesson_id }),
    })).json() as any;
    if (add.status !== 'ok') return fail(name, GROUP, Date.now() - start, 'Add bookmark failed');

    // List.
    const list = await (await fetch(`${API_BASE}/api/bookmarks?user_id=test-user&project_id=${ctx.projectId}`)).json() as any;
    if (!list.bookmarks?.some((b: any) => b.lesson_id === lesson.lesson_id)) return fail(name, GROUP, Date.now() - start, 'Bookmark not in list');

    // Idempotent add.
    await fetch(`${API_BASE}/api/bookmarks`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ user_id: 'test-user', lesson_id: lesson.lesson_id }),
    });
    const list2 = await (await fetch(`${API_BASE}/api/bookmarks?user_id=test-user&project_id=${ctx.projectId}`)).json() as any;
    const count = list2.bookmarks?.filter((b: any) => b.lesson_id === lesson.lesson_id).length;
    if (count !== 1) return fail(name, GROUP, Date.now() - start, `Idempotent add created duplicate: ${count}`);

    // Remove.
    const del = await (await fetch(`${API_BASE}/api/bookmarks?user_id=test-user&lesson_id=${lesson.lesson_id}`, { method: 'DELETE' })).json() as any;
    if (del.status !== 'ok') return fail(name, GROUP, Date.now() - start, 'Remove failed');

    return pass(name, GROUP, Date.now() - start);
  } catch (err) {
    return fail(name, GROUP, Date.now() - start, `Exception: ${err instanceof Error ? err.message : String(err)}`);
  }
};

/** Test: Import/Export lessons */
export const importExportTest: TestFn = async (ctx) => {
  const name = 'import-export';
  const start = Date.now();
  const marker = `impexp-${Date.now()}`;

  try {
    // Import 2 lessons + 1 duplicate.
    const imp = await (await fetch(`${API_BASE}/api/lessons/import`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        project_id: ctx.projectId,
        lessons: [
          { lesson_type: 'decision', title: `Import A: ${marker}`, content: 'Content A', tags: ['import-test'] },
          { lesson_type: 'preference', title: `Import B: ${marker}`, content: 'Content B', tags: ['import-test'] },
          { lesson_type: 'decision', title: `Import A: ${marker}`, content: 'Duplicate', tags: ['import-test'] },
        ],
        skip_duplicates: true,
      }),
    })).json() as any;

    if (imp.imported !== 2) return fail(name, GROUP, Date.now() - start, `Expected 2 imported, got ${imp.imported}`);
    if (imp.skipped !== 1) return fail(name, GROUP, Date.now() - start, `Expected 1 skipped, got ${imp.skipped}`);

    // Export (all).
    const exp = await (await fetch(`${API_BASE}/api/lessons/export?project_id=${ctx.projectId}`)).json() as any;
    if (exp.total_count < 2) return fail(name, GROUP, Date.now() - start, `Expected >=2 exported, got ${exp.total_count}`);
    const hasA = exp.items?.some((l: any) => l.title?.includes(`Import A: ${marker}`));
    if (!hasA) return fail(name, GROUP, Date.now() - start, 'Imported lesson not found in export');

    // Export with status filter.
    const expActive = await (await fetch(`${API_BASE}/api/lessons/export?project_id=${ctx.projectId}&status=active`)).json() as any;
    const hasArchived = expActive.items?.some((l: any) => l.status === 'archived');
    if (hasArchived) return fail(name, GROUP, Date.now() - start, 'Export status=active should not include archived');

    // Import with invalid lesson_type.
    const badImp = await (await fetch(`${API_BASE}/api/lessons/import`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        project_id: ctx.projectId,
        lessons: [
          { lesson_type: 'invalid_type', title: 'Bad type', content: 'test' },
          { lesson_type: 'decision', title: `Valid: ${marker}-extra`, content: 'test' },
        ],
      }),
    })).json() as any;
    if (badImp.imported !== 1) return fail(name, GROUP, Date.now() - start, `Expected 1 imported (valid only), got ${badImp.imported}`);
    if (badImp.errors?.length !== 1) return fail(name, GROUP, Date.now() - start, `Expected 1 error for invalid type, got ${badImp.errors?.length}`);

    return pass(name, GROUP, Date.now() - start);
  } catch (err) {
    return fail(name, GROUP, Date.now() - start, `Exception: ${err instanceof Error ? err.message : String(err)}`);
  }
};

export const allCollaborationTests: TestFn[] = [commentsTest, feedbackTest, bookmarksTest, importExportTest];
