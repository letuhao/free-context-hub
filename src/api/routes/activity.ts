import { Router } from 'express';
import {
  logActivity, listActivity,
  listNotifications, markNotificationsRead,
} from '../../services/activity.js';
import { resolveProjectIdOrThrow } from '../../core/index.js';

const router = Router();

/** GET /api/activity — list activity feed for a project */
router.get('/', async (req, res, next) => {
  try {
    const projectId = resolveProjectIdOrThrow(req.query.project_id as string | undefined);
    const result = await listActivity({
      projectId,
      eventType: req.query.event_type as string | undefined,
      since: req.query.since as string | undefined,
      limit: req.query.limit ? Number(req.query.limit) : undefined,
    });
    res.json(result);
  } catch (e) { next(e); }
});

/** POST /api/activity — manually log an activity event (for testing/admin) */
router.post('/', async (req, res, next) => {
  try {
    const projectId = resolveProjectIdOrThrow(req.body.project_id);
    const activityId = await logActivity({
      projectId,
      eventType: req.body.event_type,
      actor: req.body.actor,
      title: req.body.title,
      detail: req.body.detail,
      metadata: req.body.metadata,
    });
    res.status(201).json({ status: 'ok', activity_id: activityId });
  } catch (e) { next(e); }
});

export { router as activityRouter };

// ── Notifications router ──

const notifRouter = Router();

/** GET /api/notifications — list notifications for a user */
notifRouter.get('/', async (req, res, next) => {
  try {
    const result = await listNotifications({
      userId: req.query.user_id as string,
      unreadOnly: req.query.unread_only === 'true',
      limit: req.query.limit ? Number(req.query.limit) : undefined,
    });
    res.json(result);
  } catch (e) { next(e); }
});

/** PATCH /api/notifications/mark-read — mark one or all as read */
notifRouter.patch('/mark-read', async (req, res, next) => {
  try {
    const result = await markNotificationsRead({
      userId: req.body.user_id,
      notificationId: req.body.notification_id,
    });
    res.json(result);
  } catch (e) { next(e); }
});

/** GET /api/notifications/settings — get notification settings for a user+project */
notifRouter.get('/settings', async (req, res, next) => {
  try {
    const projectId = resolveProjectIdOrThrow(req.query.project_id as string | undefined);
    const userId = (req.query.user_id as string) ?? 'gui-user';
    const { getDbPool } = await import('../../db/client.js');
    const pool = getDbPool();
    const result = await pool.query(
      `SELECT setting_key, enabled FROM notification_settings WHERE user_id = $1 AND project_id = $2`,
      [userId, projectId],
    );
    const settings: Record<string, boolean> = {};
    for (const row of result.rows) settings[row.setting_key] = row.enabled;
    res.json({ status: 'ok', settings });
  } catch (e) { next(e); }
});

/** PUT /api/notifications/settings — update notification settings */
notifRouter.put('/settings', async (req, res, next) => {
  try {
    const projectId = resolveProjectIdOrThrow(req.body.project_id);
    const userId = req.body.user_id ?? 'gui-user';
    const settings: Record<string, boolean> = req.body.settings ?? {};
    const { getDbPool } = await import('../../db/client.js');
    const pool = getDbPool();
    for (const [key, enabled] of Object.entries(settings)) {
      await pool.query(
        `INSERT INTO notification_settings (user_id, project_id, setting_key, enabled, updated_at)
         VALUES ($1, $2, $3, $4, now())
         ON CONFLICT (user_id, project_id, setting_key) DO UPDATE SET enabled = $4, updated_at = now()`,
        [userId, projectId, key, enabled],
      );
    }
    res.json({ status: 'ok' });
  } catch (e) { next(e); }
});

export { notifRouter as notificationsRouter };
