-- 0035: Activity log + notifications

CREATE TABLE IF NOT EXISTS activity_log (
  activity_id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id TEXT NOT NULL,
  event_type TEXT NOT NULL CHECK (event_type IN (
    'lesson.created', 'lesson.updated', 'lesson.status_changed', 'lesson.deleted',
    'guardrail.triggered', 'guardrail.passed',
    'job.queued', 'job.succeeded', 'job.failed',
    'document.uploaded', 'document.deleted',
    'group.created', 'group.deleted',
    'comment.added'
  )),
  actor TEXT,
  title TEXT NOT NULL,
  detail TEXT,
  metadata JSONB,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_activity_log_project ON activity_log(project_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_activity_log_type ON activity_log(event_type, created_at DESC);

CREATE TABLE IF NOT EXISTS notifications (
  notification_id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id TEXT NOT NULL,
  activity_id UUID NOT NULL REFERENCES activity_log(activity_id) ON DELETE CASCADE,
  read BOOLEAN NOT NULL DEFAULT false,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_notifications_user ON notifications(user_id, read, created_at DESC);
