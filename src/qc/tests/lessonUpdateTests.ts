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

/**
 * Test: Version history — create, edit twice, verify version list.
 * Uses REST API directly to avoid MCP auto_both format parse issues with nested LLM-generated text.
 */
export const lessonVersionHistory: TestFn = async (ctx) => {
  const name = 'lesson-version-history';
  const start = Date.now();
  const marker = `version-hist-${Date.now()}`;
  const apiBase = process.env.API_BASE_URL?.trim() || 'http://localhost:3001';

  try {
    // 1. Create lesson via REST.
    const createRes = await fetch(`${apiBase}/api/lessons`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        project_id: ctx.projectId, lesson_type: 'decision',
        title: `V1: ${marker}`, content: `First version: ${marker}`,
        tags: ['integration-test', 'version-history'],
      }),
    });
    const created = await createRes.json() as any;
    const lessonId = created?.lesson_id;
    if (!lessonId) return fail(name, GROUP, Date.now() - start, 'create returned no lesson_id');
    ctx.createdLessonIds.push(lessonId);

    // 2. No versions yet.
    const emptyRes = await fetch(`${apiBase}/api/lessons/${lessonId}/versions?project_id=${ctx.projectId}`);
    const empty = await emptyRes.json() as any;
    if (empty?.total_count !== 0) return fail(name, GROUP, Date.now() - start, `Expected 0 versions, got ${empty?.total_count}`);

    // 3. Edit content → version 1.
    const u1Res = await fetch(`${apiBase}/api/lessons/${lessonId}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        project_id: ctx.projectId, title: `V2: ${marker}`, content: `Second version: ${marker}`,
        changed_by: 'test-user', change_summary: 'First edit',
      }),
    });
    const u1 = await u1Res.json() as any;
    if (u1?.version_number !== 1) return fail(name, GROUP, Date.now() - start, `Expected version 1, got ${u1?.version_number}`);

    // 4. Edit again → version 2.
    const u2Res = await fetch(`${apiBase}/api/lessons/${lessonId}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        project_id: ctx.projectId, content: `Third version: ${marker}`,
        changed_by: 'test-agent', change_summary: 'Second edit',
      }),
    });
    const u2 = await u2Res.json() as any;
    if (u2?.version_number !== 2) return fail(name, GROUP, Date.now() - start, `Expected version 2, got ${u2?.version_number}`);

    // 5. List versions — 2 entries, newest first.
    const histRes = await fetch(`${apiBase}/api/lessons/${lessonId}/versions?project_id=${ctx.projectId}`);
    const hist = await histRes.json() as any;
    if (hist?.total_count !== 2) return fail(name, GROUP, Date.now() - start, `Expected 2 versions, got ${hist?.total_count}`);

    const v = hist?.versions ?? [];
    if (v[0]?.version_number !== 2) return fail(name, GROUP, Date.now() - start, `Newest should be v2, got v${v[0]?.version_number}`);
    if (v[1]?.version_number !== 1) return fail(name, GROUP, Date.now() - start, `Second should be v1, got v${v[1]?.version_number}`);
    if (!v[1]?.title?.includes('V1:')) return fail(name, GROUP, Date.now() - start, `v1 title wrong: ${v[1]?.title}`);
    if (v[1]?.changed_by !== 'test-user') return fail(name, GROUP, Date.now() - start, `v1 changed_by=${v[1]?.changed_by}`);
    if (!v[0]?.title?.includes('V2:')) return fail(name, GROUP, Date.now() - start, `v2 title wrong: ${v[0]?.title}`);

    // 6. 404 for wrong project.
    const badRes = await fetch(`${apiBase}/api/lessons/${lessonId}/versions?project_id=wrong-project`);
    if (badRes.status !== 404) return fail(name, GROUP, Date.now() - start, `Expected 404 for wrong project, got ${badRes.status}`);

    return pass(name, GROUP, Date.now() - start);
  } catch (err) {
    return fail(name, GROUP, Date.now() - start, `Exception: ${err instanceof Error ? err.message : String(err)}`);
  }
};

export const allLessonUpdateTests: TestFn[] = [lessonUpdate, lessonUpdateTagsOnly, lessonUpdateNotFound, lessonVersionHistory];
