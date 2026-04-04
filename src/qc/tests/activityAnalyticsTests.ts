import { pass, fail } from '../testTypes.js';
import type { TestContext, TestFn } from '../testTypes.js';

const GROUP = 'lessons' as const;
const API_BASE = process.env.API_BASE_URL?.trim() || 'http://localhost:3001';

/** Test: Activity log + notifications endpoints */
export const activityNotificationsTest: TestFn = async (ctx) => {
  const name = 'activity-notifications';
  const start = Date.now();

  try {
    // 1. Log activity event.
    const logRes = await (await fetch(`${API_BASE}/api/activity`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ project_id: ctx.projectId, event_type: 'lesson.created', actor: 'test-agent', title: `Activity test ${Date.now()}` }),
    })).json() as any;
    if (!logRes.activity_id) return fail(name, GROUP, Date.now() - start, 'No activity_id');

    // 2. List activity — should find at least our event.
    const list = await (await fetch(`${API_BASE}/api/activity?project_id=${ctx.projectId}&limit=5`)).json() as any;
    if (!list.items?.length) return fail(name, GROUP, Date.now() - start, 'Activity list empty');
    const found = list.items.some((a: any) => a.activity_id === logRes.activity_id);
    if (!found) return fail(name, GROUP, Date.now() - start, 'Logged event not found in list');

    // 3. Filter by event_type.
    const filtered = await (await fetch(`${API_BASE}/api/activity?project_id=${ctx.projectId}&event_type=lesson.created`)).json() as any;
    if (!filtered.items?.length) return fail(name, GROUP, Date.now() - start, 'Filtered list empty');

    // 4. Notifications endpoint shape check (empty for fresh user is OK).
    const freshUser = `notif-test-${Date.now()}`;
    const notifs = await (await fetch(`${API_BASE}/api/notifications?user_id=${freshUser}`)).json() as any;
    if (notifs.unread_count !== 0) return fail(name, GROUP, Date.now() - start, `Fresh user should have 0 unread, got ${notifs.unread_count}`);
    if (!Array.isArray(notifs.items)) return fail(name, GROUP, Date.now() - start, 'Missing items array');

    // 5. Mark-read with nothing to mark — should return updated:0.
    const mark = await (await fetch(`${API_BASE}/api/notifications/mark-read`, {
      method: 'PATCH', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ user_id: freshUser }),
    })).json() as any;
    if (mark.updated !== 0) return fail(name, GROUP, Date.now() - start, `Expected 0 updated for fresh user, got ${mark.updated}`);

    return pass(name, GROUP, Date.now() - start);
  } catch (err) {
    return fail(name, GROUP, Date.now() - start, `Exception: ${err instanceof Error ? err.message : String(err)}`);
  }
};

/** Test: Analytics endpoints return data */
export const analyticsTest: TestFn = async (ctx) => {
  const name = 'analytics-endpoints';
  const start = Date.now();

  try {
    const overview = await (await fetch(`${API_BASE}/api/analytics/overview?project_id=${ctx.projectId}`)).json() as any;
    if (overview.active_lessons === undefined) return fail(name, GROUP, Date.now() - start, 'Overview missing active_lessons');
    if (overview.stale_threshold_days !== 90) return fail(name, GROUP, Date.now() - start, `Stale threshold=${overview.stale_threshold_days}`);

    const byType = await (await fetch(`${API_BASE}/api/analytics/by-type?project_id=${ctx.projectId}`)).json() as any;
    if (!Array.isArray(byType.breakdown)) return fail(name, GROUP, Date.now() - start, 'by-type missing breakdown');

    const top = await (await fetch(`${API_BASE}/api/analytics/top-lessons?project_id=${ctx.projectId}&limit=3`)).json() as any;
    if (!Array.isArray(top.items)) return fail(name, GROUP, Date.now() - start, 'top-lessons missing items');

    const dead = await (await fetch(`${API_BASE}/api/analytics/dead-knowledge?project_id=${ctx.projectId}`)).json() as any;
    if (!Array.isArray(dead.items)) return fail(name, GROUP, Date.now() - start, 'dead-knowledge missing items');

    const agents = await (await fetch(`${API_BASE}/api/analytics/agents?project_id=${ctx.projectId}`)).json() as any;
    if (!Array.isArray(agents.agents)) return fail(name, GROUP, Date.now() - start, 'agents missing agents array');

    return pass(name, GROUP, Date.now() - start);
  } catch (err) {
    return fail(name, GROUP, Date.now() - start, `Exception: ${err instanceof Error ? err.message : String(err)}`);
  }
};

/** Test: Learning paths CRUD + progress */
export const learningPathsTest: TestFn = async (ctx) => {
  const name = 'learning-paths';
  const start = Date.now();

  try {
    // Create lesson for the path.
    const lesson = await (await fetch(`${API_BASE}/api/lessons`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ project_id: ctx.projectId, lesson_type: 'decision', title: `Path test ${Date.now()}`, content: 'test', tags: ['integration-test'] }),
    })).json() as any;
    ctx.createdLessonIds.push(lesson.lesson_id);

    // Add to path.
    const added = await (await fetch(`${API_BASE}/api/learning-paths`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ project_id: ctx.projectId, section: 'Testing', lesson_id: lesson.lesson_id, sort_order: 1 }),
    })).json() as any;
    if (!added.path_id) return fail(name, GROUP, Date.now() - start, 'No path_id');

    // Get path — not completed.
    const path1 = await (await fetch(`${API_BASE}/api/learning-paths?project_id=${ctx.projectId}&user_id=test-learner`)).json() as any;
    if (path1.total < 1) return fail(name, GROUP, Date.now() - start, 'Path empty');
    if (path1.completed !== 0) return fail(name, GROUP, Date.now() - start, `Expected 0 completed, got ${path1.completed}`);

    // Mark completed.
    await fetch(`${API_BASE}/api/learning-paths/${added.path_id}/complete`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ user_id: 'test-learner' }),
    });

    // Get path — completed.
    const path2 = await (await fetch(`${API_BASE}/api/learning-paths?project_id=${ctx.projectId}&user_id=test-learner`)).json() as any;
    if (path2.completed < 1) return fail(name, GROUP, Date.now() - start, 'Not marked completed');

    // Remove from path.
    const del = await (await fetch(`${API_BASE}/api/learning-paths/${added.path_id}`, { method: 'DELETE' })).json() as any;
    if (del.status !== 'ok') return fail(name, GROUP, Date.now() - start, 'Delete failed');

    return pass(name, GROUP, Date.now() - start);
  } catch (err) {
    return fail(name, GROUP, Date.now() - start, `Exception: ${err instanceof Error ? err.message : String(err)}`);
  }
};

export const allActivityAnalyticsTests: TestFn[] = [activityNotificationsTest, analyticsTest, learningPathsTest];
