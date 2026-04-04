-- Notification settings per user
CREATE TABLE IF NOT EXISTS notification_settings (
  user_id TEXT NOT NULL,
  project_id TEXT NOT NULL,
  setting_key TEXT NOT NULL,
  enabled BOOLEAN NOT NULL DEFAULT true,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (user_id, project_id, setting_key)
);
