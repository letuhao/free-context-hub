import { callTool, withAuth, pass, fail } from '../testTypes.js';
import type { TestContext, TestFn } from '../testTypes.js';

const GROUP = 'lessons' as const;

/**
 * Test 1: Lesson CRUD lifecycle
 * add → search → find → update_status(superseded) → search excludes → search(include_all) finds
 */
export const lessonCrud: TestFn = async (ctx) => {
  const name = 'lesson-crud';
  const start = Date.now();
  const marker = `integration-test-crud-${Date.now()}`;

  try {
    // 1. Add a lesson (args wrapped in lesson_payload).
    const added = await callTool(ctx.client, 'add_lesson', withAuth({
      lesson_payload: {
        project_id: ctx.projectId,
        lesson_type: 'decision',
        title: `Test CRUD: ${marker}`,
        content: `This is a test decision with marker ${marker} for integration testing.`,
        tags: ['integration-test', 'crud-test'],
      },
    }, ctx.workspaceToken));

    const lessonId = added?.lesson_id;
    if (!lessonId) return fail(name, GROUP, Date.now() - start, 'add_lesson returned no lesson_id');
    ctx.createdLessonIds.push(lessonId);

    // 2. Search for it.
    const searchResult = await callTool(ctx.client, 'search_lessons', withAuth({
      project_id: ctx.projectId,
      query: marker,
      limit: 5,
    }, ctx.workspaceToken));

    const matches = searchResult?.matches ?? searchResult?.items ?? [];
    const found = matches.some((m: any) => m.lesson_id === lessonId || m.title?.includes(marker));
    if (!found) return fail(name, GROUP, Date.now() - start, `search_lessons did not find lesson with marker ${marker}`);

    // 3. Supersede it.
    await callTool(ctx.client, 'update_lesson_status', withAuth({
      project_id: ctx.projectId,
      lesson_id: lessonId,
      status: 'superseded',
    }, ctx.workspaceToken));

    // 4. Search should exclude superseded by default.
    const searchAfter = await callTool(ctx.client, 'search_lessons', withAuth({
      project_id: ctx.projectId,
      query: marker,
      limit: 5,
    }, ctx.workspaceToken));

    const matchesAfter = searchAfter?.matches ?? searchAfter?.items ?? [];
    const foundAfter = matchesAfter.some((m: any) => m.lesson_id === lessonId);
    if (foundAfter) return fail(name, GROUP, Date.now() - start, 'superseded lesson still appears in default search');

    // 5. Search with include_all_statuses should find it.
    const searchAll = await callTool(ctx.client, 'search_lessons', withAuth({
      project_id: ctx.projectId,
      query: marker,
      filters: { include_all_statuses: true },
      limit: 5,
    }, ctx.workspaceToken));

    const matchesAll = searchAll?.matches ?? searchAll?.items ?? [];
    const foundAll = matchesAll.some((m: any) => m.lesson_id === lessonId || m.title?.includes(marker));
    if (!foundAll) return fail(name, GROUP, Date.now() - start, 'superseded lesson not found with include_all_statuses');

    return pass(name, GROUP, Date.now() - start);
  } catch (err) {
    return fail(name, GROUP, Date.now() - start, `Exception: ${err instanceof Error ? err.message : String(err)}`);
  }
};

/**
 * Test 2: Lesson types and tag filtering
 * Add 3 types → list with type filter → list with tag filter
 */
export const lessonTypesAndTags: TestFn = async (ctx) => {
  const name = 'lesson-types-tags';
  const start = Date.now();
  const tag = `it-tag-${Date.now()}`;

  try {
    // Add workaround.
    const w = await callTool(ctx.client, 'add_lesson', withAuth({
      lesson_payload: {
        project_id: ctx.projectId,
        lesson_type: 'workaround',
        title: `Workaround: ${tag}`,
        content: 'Redis cache must be flushed after deploy.',
        tags: ['integration-test', tag, 'redis'],
      },
    }, ctx.workspaceToken));
    ctx.createdLessonIds.push(w?.lesson_id);

    // Add preference.
    const p = await callTool(ctx.client, 'add_lesson', withAuth({
      lesson_payload: {
        project_id: ctx.projectId,
        lesson_type: 'preference',
        title: `Preference: ${tag}`,
        content: 'Use strict TypeScript everywhere.',
        tags: ['integration-test', tag, 'typescript'],
      },
    }, ctx.workspaceToken));
    ctx.createdLessonIds.push(p?.lesson_id);

    // List with type filter — should find only workaround.
    const listWorkarounds = await callTool(ctx.client, 'list_lessons', withAuth({
      project_id: ctx.projectId,
      filters: { lesson_type: 'workaround', tags_any: [tag] },
    }, ctx.workspaceToken));

    const wItems = listWorkarounds?.items ?? [];
    if (wItems.length !== 1) return fail(name, GROUP, Date.now() - start, `Expected 1 workaround, got ${wItems.length}`);

    // List with tag filter — should find both.
    const listByTag = await callTool(ctx.client, 'list_lessons', withAuth({
      project_id: ctx.projectId,
      filters: { tags_any: [tag] },
    }, ctx.workspaceToken));

    const tagItems = listByTag?.items ?? [];
    if (tagItems.length < 2) return fail(name, GROUP, Date.now() - start, `Expected >= 2 lessons with tag ${tag}, got ${tagItems.length}`);

    return pass(name, GROUP, Date.now() - start);
  } catch (err) {
    return fail(name, GROUP, Date.now() - start, `Exception: ${err instanceof Error ? err.message : String(err)}`);
  }
};

/**
 * Test 3: Lesson persistence (in DB)
 * Add with unique marker → list to verify it persists in DB
 */
export const lessonPersistence: TestFn = async (ctx) => {
  const name = 'lesson-persistence';
  const start = Date.now();
  const marker = `persist-check-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;

  try {
    const added = await callTool(ctx.client, 'add_lesson', withAuth({
      lesson_payload: {
        project_id: ctx.projectId,
        lesson_type: 'general_note',
        title: `Persistence: ${marker}`,
        content: `Unique content for persistence verification: ${marker}`,
        tags: ['integration-test', 'persistence-test'],
      },
    }, ctx.workspaceToken));

    const lessonId = added?.lesson_id;
    if (!lessonId) return fail(name, GROUP, Date.now() - start, 'add_lesson returned no lesson_id');
    ctx.createdLessonIds.push(lessonId);

    // Verify via list (not search — no embedding dependency).
    const listResult = await callTool(ctx.client, 'list_lessons', withAuth({
      project_id: ctx.projectId,
      filters: { tags_any: ['persistence-test'] },
    }, ctx.workspaceToken));

    const items = listResult?.items ?? [];
    const found = items.some((i: any) => i.lesson_id === lessonId);
    if (!found) return fail(name, GROUP, Date.now() - start, `Lesson ${lessonId} not found in list after creation`);

    return pass(name, GROUP, Date.now() - start);
  } catch (err) {
    return fail(name, GROUP, Date.now() - start, `Exception: ${err instanceof Error ? err.message : String(err)}`);
  }
};

export const allLessonTests: TestFn[] = [lessonCrud, lessonTypesAndTags, lessonPersistence];
