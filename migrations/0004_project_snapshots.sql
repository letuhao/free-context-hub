-- Phase 3: pre-built project summaries (no embedding on read)

CREATE TABLE IF NOT EXISTS project_snapshots (
  project_id TEXT PRIMARY KEY REFERENCES projects(project_id) ON DELETE CASCADE,
  body TEXT NOT NULL DEFAULT '',
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_project_snapshots_updated ON project_snapshots(updated_at);
