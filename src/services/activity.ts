import { getDbPool } from '../db/client.js';
import { assertAuthorized, authorize } from './authorize.js';

/** F2f: authorize `read` on every project in the (single-or-multi) filter, strict-reject. */
async function assertReadAll(
  actingPrincipalId: string | null | undefined,
  projectIdOrIds: string | string[] | undefined,
): Promise<void> {
  const ids = Array.isArray(projectIdOrIds) ? projectIdOrIds : projectIdOrIds ? [projectIdOrIds] : [];
  // Empty filter → fail closed (authorize a null project → NOT_FOUND under auth-ON).
  for (const pid of (ids.length ? ids : [null])) {
    await assertAuthorized(actingPrincipalId, 'read', { kind: 'project', id: pid });
  }
}

function safeStringify(obj: unknown): string | null {
  try { return JSON.stringify(obj); } catch { return null; }
}

export type EventType =
  | 'lesson.created' | 'lesson.updated' | 'lesson.status_changed' | 'lesson.deleted'
  | 'guardrail.triggered' | 'guardrail.passed'
  | 'job.queued' | 'job.succeeded' | 'job.failed'
  | 'document.uploaded' | 'document.deleted'
  | 'group.created' | 'group.deleted'
  | 'comment.added'
  // Phase 13 Sprint 13.3: review-request lifecycle
  | 'review.submitted' | 'review.approved' | 'review.returned';

export interface ActivityEntry {
  activity_id: string;
  project_id: string;
  event_type: EventType;
  actor: string | null;
  title: string;
  detail: string | null;
  metadata: Record<string, unknown> | null;
  created_at: string;
}

/** Log an activity event. Returns the activity_id. */
export async function logActivity(params: {
  projectId: string;
  eventType: EventType;
  actor?: string;
  title: string;
  detail?: string;
  metadata?: Record<string, unknown>;
}): Promise<string> {
  const pool = getDbPool();
  const result = await pool.query(
    `INSERT INTO activity_log (project_id, event_type, actor, title, detail, metadata)
     VALUES ($1, $2, $3, $4, $5, $6) RETURNING activity_id`,
    [params.projectId, params.eventType, params.actor ?? null,
     params.title, params.detail ?? null,
     params.metadata ? safeStringify(params.metadata) : null],
  );
  return result.rows[0]?.activity_id;
}

/** List activity for a project with optional filters. */
export async function listActivity(params: {
  projectId?: string;
  projectIds?: string[];
  /** F2f: acting principal; authorize() enforces read on each project. */
  actingPrincipalId?: string | null;
  eventType?: string;
  since?: string;
  limit?: number;
  offset?: number;
}): Promise<{ items: ActivityEntry[]; total_count: number }> {
  await assertReadAll(params.actingPrincipalId, params.projectIds ?? params.projectId);
  const pool = getDbPool();
  const limit = Math.min(params.limit ?? 50, 200);
  const offset = Math.max(params.offset ?? 0, 0);

  const ids = params.projectIds ?? (params.projectId ? [params.projectId] : []);
  const projectClause = ids.length === 1 ? 'project_id = $1' : 'project_id = ANY($1::text[])';
  let where = `WHERE ${projectClause}`;
  const args: any[] = [ids.length === 1 ? ids[0] : ids];
  let idx = 2;

  if (params.eventType) {
    if (params.eventType.includes('.')) {
      // Exact event type match (e.g. "lesson.created")
      where += ` AND event_type = $${idx++}`;
      args.push(params.eventType);
    } else {
      // Category prefix match (e.g. "lesson" matches "lesson.created", "lesson.updated", etc.)
      where += ` AND event_type LIKE $${idx++}`;
      args.push(`${params.eventType}.%`);
    }
  }
  if (params.since) {
    where += ` AND created_at >= $${idx++}`;
    args.push(params.since);
  }

  const countRes = await pool.query(`SELECT COUNT(*) AS cnt FROM activity_log ${where}`, args);
  const total_count = parseInt(countRes.rows[0]?.cnt ?? '0', 10);

  args.push(limit, offset);
  const result = await pool.query(
    `SELECT * FROM activity_log ${where} ORDER BY created_at DESC LIMIT $${idx} OFFSET $${idx + 1}`, args,
  );

  return { items: result.rows, total_count };
}

// ── Notifications ──

export interface Notification {
  notification_id: string;
  user_id: string;
  activity_id: string;
  read: boolean;
  created_at: string;
  // joined from activity_log
  event_type?: string;
  title?: string;
  detail?: string;
  actor?: string;
  project_id?: string;
}

/** Create notifications for a user from an activity event.
 *  [DEFERRED-050 / review-impl #3] `userId` MUST be a principal id (the notification-isolation key the
 *  routes derive from `callerPrincipalOf`). Passing a free-text string here would break per-principal
 *  isolation. This is dormant today (no callers); whoever wires it must pass a principal id, and should
 *  only notify a principal about events it is entitled to (the listNotifications JOIN filter is the
 *  defense-in-depth backstop, not a license to over-notify). */
export async function createNotification(params: {
  userId: string;
  activityId: string;
}): Promise<void> {
  const pool = getDbPool();
  await pool.query(
    `INSERT INTO notifications (user_id, activity_id) VALUES ($1, $2) ON CONFLICT DO NOTHING`,
    [params.userId, params.activityId],
  );
}

/** Upper bound on rows scanned before the per-row authz filter. A per-user notification feed never
 *  approaches this; it bounds the JS-side filter for the (dormant) feature. [DEFERRED-050] */
const NOTIFICATION_MAX_SCAN = 500;

/**
 * List notifications for a user (joined with activity_log).
 *
 * [DEFERRED-050 D2] The caller is identified by `userId` (= the authenticated principal, set by the route),
 * and — defense-in-depth — a notification carrying a `project_id` the principal cannot `read` is dropped, so
 * even a mis-created notification can't leak project metadata via the JOIN. `unreadOnly`/`limit` are applied
 * AFTER the authz filter (in JS) so the filter runs first and `unread_count` reflects the visible set.
 * auth-OFF → authorize short-circuits ALLOW → every row kept (unchanged behavior).
 */
export async function listNotifications(params: {
  userId: string;
  actingPrincipalId?: string | null;
  unreadOnly?: boolean;
  limit?: number;
}): Promise<{ items: Notification[]; unread_count: number }> {
  const pool = getDbPool();
  const limit = Math.min(params.limit ?? 50, 100);

  const result = await pool.query<Notification>(
    `SELECT n.*, a.event_type, a.title, a.detail, a.actor, a.project_id
     FROM notifications n
     JOIN activity_log a ON a.activity_id = n.activity_id
     WHERE n.user_id = $1
     ORDER BY n.created_at DESC LIMIT $2`,
    [params.userId, NOTIFICATION_MAX_SCAN],
  );

  const visible: Notification[] = [];
  for (const r of result.rows) {
    // Keep a non-project-scoped personal notification; otherwise require read on its project.
    if (!r.project_id || (await authorize(params.actingPrincipalId, 'read', { kind: 'project', id: r.project_id })).allow) {
      visible.push(r);
    }
  }

  const unread = visible.filter((r) => !r.read);
  return {
    items: (params.unreadOnly ? unread : visible).slice(0, limit),
    unread_count: unread.length,
  };
}

/** Mark notifications as read (one or all). */
export async function markNotificationsRead(params: {
  userId: string;
  notificationId?: string;
}): Promise<{ updated: number }> {
  const pool = getDbPool();
  let result;
  if (params.notificationId) {
    result = await pool.query(
      `UPDATE notifications SET read = true WHERE user_id = $1 AND notification_id = $2 AND read = false`,
      [params.userId, params.notificationId],
    );
  } else {
    result = await pool.query(
      `UPDATE notifications SET read = true WHERE user_id = $1 AND read = false`,
      [params.userId],
    );
  }
  return { updated: result.rowCount ?? 0 };
}
