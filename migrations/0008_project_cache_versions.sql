-- Phase 7: per-project cache version for Redis invalidation.

CREATE TABLE IF NOT EXISTS project_cache_versions (
  project_id TEXT PRIMARY KEY REFERENCES projects(project_id) ON DELETE CASCADE,
  version BIGINT NOT NULL DEFAULT 1,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

