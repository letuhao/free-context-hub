import { callTool, withAuth, pass, fail } from '../testTypes.js';
import type { TestContext, TestFn } from '../testTypes.js';

const GROUP = 'lessons' as const;

/**
 * Test: Lesson update — edit title/content, verify re-embedding and version creation
 */
export const lessonUpdate: TestFn = async (ctx) => {
  const name = 'lesson-update';
  const start = Date.now();
  const marker = `update-test-${Date.now()}`;

  try {
    // 1. Create a lesson.
    const added = await callTool(ctx.client, 'add_lesson', withAuth({
      lesson_payload: {
        project_id: ctx.projectId,
        lesson_type: 'decision',
        title: `Original title: ${marker}`,
        content: `Original content for update testing: ${marker}`,
        tags: ['integration-test', 'update-test'],
      },
    }, ctx.workspaceToken));

    const lessonId = added?.lesson_id;
    if (!lessonId) return fail(name, GROUP, Date.now() - start, 'add_lesson returned no lesson_id');
    ctx.createdLessonIds.push(lessonId);

    // 2. Update title + content (should re-embed and create version).
    const updated = await callTool(ctx.client, 'update_lesson', withAuth({
      project_id: ctx.projectId,
      lesson_id: lessonId,
      title: `Updated title: ${marker}`,
      content: `Updated content with new details: ${marker}`,
      changed_by: 'integration-test',
      change_summary: 'Test content update',
    }, ctx.workspaceToken));

    if (updated?.status !== 'ok') return fail(name, GROUP, Date.now() - start, `update_lesson returned status=${updated?.status}: ${updated?.error}`);
    if (updated?.re_embedded !== true) return fail(name, GROUP, Date.now() - start, 're_embedded should be true for content change');
    if (updated?.version_number !== 1) return fail(name, GROUP, Date.now() - start, `Expected version_number=1, got ${updated?.version_number}`);

    // 3. Verify updated content via list.
    const listResult = await callTool(ctx.client, 'list_lessons', withAuth({
      project_id: ctx.projectId,
      filters: { tags_any: ['update-test'] },
    }, ctx.workspaceToken));

    const items = listResult?.items ?? [];
    const found = items.find((i: any) => i.lesson_id === lessonId);
    if (!found) return fail(name, GROUP, Date.now() - start, 'Updated lesson not found in list');
    if (!found.title.includes('Updated title')) return fail(name, GROUP, Date.now() - start, `Title not updated: ${found.title}`);

    // 4. Search for updated content.
    const searchResult = await callTool(ctx.client, 'search_lessons', withAuth({
      project_id: ctx.projectId,
      query: `Updated content new details ${marker}`,
      limit: 5,
    }, ctx.workspaceToken));

    const matches = searchResult?.matches ?? searchResult?.items ?? [];
    const searchFound = matches.some((m: any) => m.lesson_id === lessonId);
    if (!searchFound) return fail(name, GROUP, Date.now() - start, 'Updated content not found via semantic search');

    return pass(name, GROUP, Date.now() - start);
  } catch (err) {
    return fail(name, GROUP, Date.now() - start, `Exception: ${err instanceof Error ? err.message : String(err)}`);
  }
};

/**
 * Test: Tags-only update — should NOT re-embed or create version
 */
export const lessonUpdateTagsOnly: TestFn = async (ctx) => {
  const name = 'lesson-update-tags-only';
  const start = Date.now();
  const marker = `tags-only-${Date.now()}`;

  try {
    // 1. Create a lesson.
    const added = await callTool(ctx.client, 'add_lesson', withAuth({
      lesson_payload: {
        project_id: ctx.projectId,
        lesson_type: 'preference',
        title: `Tags test: ${marker}`,
        content: `Content for tags-only update test: ${marker}`,
        tags: ['integration-test', 'tags-test'],
      },
    }, ctx.workspaceToken));

    const lessonId = added?.lesson_id;
    if (!lessonId) return fail(name, GROUP, Date.now() - start, 'add_lesson returned no lesson_id');
    ctx.createdLessonIds.push(lessonId);

    // 2. Update tags only.
    const updated = await callTool(ctx.client, 'update_lesson', withAuth({
      project_id: ctx.projectId,
      lesson_id: lessonId,
      tags: ['integration-test', 'tags-test', 'new-tag'],
    }, ctx.workspaceToken));

    if (updated?.status !== 'ok') return fail(name, GROUP, Date.now() - start, `update_lesson returned status=${updated?.status}`);
    if (updated?.re_embedded !== false) return fail(name, GROUP, Date.now() - start, 're_embedded should be false for tags-only change');

    // 3. Verify tags updated.
    const listResult = await callTool(ctx.client, 'list_lessons', withAuth({
      project_id: ctx.projectId,
      filters: { tags_any: ['new-tag'] },
    }, ctx.workspaceToken));

    const items = listResult?.items ?? [];
    const found = items.some((i: any) => i.lesson_id === lessonId);
    if (!found) return fail(name, GROUP, Date.now() - start, 'Lesson not found after tags update');

    return pass(name, GROUP, Date.now() - start);
  } catch (err) {
    return fail(name, GROUP, Date.now() - start, `Exception: ${err instanceof Error ? err.message : String(err)}`);
  }
};

/**
 * Test: Update non-existent lesson — should return error
 */
export const lessonUpdateNotFound: TestFn = async (ctx) => {
  const name = 'lesson-update-not-found';
  const start = Date.now();

  try {
    const result = await callTool(ctx.client, 'update_lesson', withAuth({
      project_id: ctx.projectId,
      lesson_id: '00000000-0000-0000-0000-000000000000',
      title: 'Should fail',
    }, ctx.workspaceToken));

    if (result?.status !== 'error') return fail(name, GROUP, Date.now() - start, `Expected error status, got ${result?.status}`);

    return pass(name, GROUP, Date.now() - start);
  } catch (err) {
    return fail(name, GROUP, Date.now() - start, `Exception: ${err instanceof Error ? err.message : String(err)}`);
  }
};

export const allLessonUpdateTests: TestFn[] = [lessonUpdate, lessonUpdateTagsOnly, lessonUpdateNotFound];
