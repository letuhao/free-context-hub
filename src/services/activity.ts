import { getDbPool } from '../db/client.js';

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
  eventType?: string;
  since?: string;
  limit?: number;
  offset?: number;
}): Promise<{ items: ActivityEntry[]; total_count: number }> {
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

/** Create notifications for a user from an activity event. */
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

/** List notifications for a user (joined with activity_log). */
export async function listNotifications(params: {
  userId: string;
  unreadOnly?: boolean;
  limit?: number;
}): Promise<{ items: Notification[]; unread_count: number }> {
  const pool = getDbPool();
  const limit = Math.min(params.limit ?? 50, 100);

  let where = 'WHERE n.user_id = $1';
  if (params.unreadOnly) where += ' AND n.read = false';

  const result = await pool.query(
    `SELECT n.*, a.event_type, a.title, a.detail, a.actor, a.project_id
     FROM notifications n
     JOIN activity_log a ON a.activity_id = n.activity_id
     ${where}
     ORDER BY n.created_at DESC LIMIT $2`,
    [params.userId, limit],
  );

  const unreadRes = await pool.query(
    `SELECT COUNT(*) AS cnt FROM notifications WHERE user_id = $1 AND read = false`,
    [params.userId],
  );

  return {
    items: result.rows,
    unread_count: parseInt(unreadRes.rows[0]?.cnt ?? '0', 10),
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
