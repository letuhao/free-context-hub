-- Phase 6 prep: multi-source projects (remote git + local workspaces) and async jobs.

CREATE TABLE IF NOT EXISTS project_sources (
  project_id TEXT NOT NULL REFERENCES projects(project_id) ON DELETE CASCADE,
  source_type TEXT NOT NULL CHECK (source_type IN ('remote_git', 'local_workspace')),
  git_url TEXT,
  default_ref TEXT NOT NULL DEFAULT 'main',
  repo_root TEXT,
  enabled BOOLEAN NOT NULL DEFAULT true,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (project_id, source_type)
);

CREATE INDEX IF NOT EXISTS idx_project_sources_enabled
  ON project_sources(project_id, source_type, enabled);

CREATE TABLE IF NOT EXISTS project_workspaces (
  workspace_id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id TEXT NOT NULL REFERENCES projects(project_id) ON DELETE CASCADE,
  root_path TEXT NOT NULL,
  is_active BOOLEAN NOT NULL DEFAULT true,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (project_id, root_path)
);

CREATE INDEX IF NOT EXISTS idx_project_workspaces_active
  ON project_workspaces(project_id, is_active, created_at DESC);

CREATE TABLE IF NOT EXISTS workspace_deltas (
  delta_id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id TEXT NOT NULL REFERENCES projects(project_id) ON DELETE CASCADE,
  workspace_id UUID REFERENCES project_workspaces(workspace_id) ON DELETE CASCADE,
  root_path TEXT NOT NULL,
  modified_files TEXT[] NOT NULL DEFAULT '{}'::text[],
  untracked_files TEXT[] NOT NULL DEFAULT '{}'::text[],
  staged_files TEXT[] NOT NULL DEFAULT '{}'::text[],
  scanned_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_workspace_deltas_project_scan
  ON workspace_deltas(project_id, scanned_at DESC);

CREATE TABLE IF NOT EXISTS async_jobs (
  job_id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id TEXT REFERENCES projects(project_id) ON DELETE CASCADE,
  job_type TEXT NOT NULL CHECK (
    job_type IN (
      'repo.sync',
      'workspace.scan',
      'workspace.delta_index',
      'index.run',
      'git.ingest',
      'quality.eval',
      'knowledge.refresh'
    )
  ),
  queue_name TEXT NOT NULL DEFAULT 'default',
  payload JSONB NOT NULL DEFAULT '{}'::jsonb,
  correlation_id TEXT,
  status TEXT NOT NULL DEFAULT 'queued' CHECK (status IN ('queued', 'running', 'succeeded', 'failed', 'dead_letter')),
  attempts INT NOT NULL DEFAULT 0,
  max_attempts INT NOT NULL DEFAULT 3,
  available_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  error_message TEXT,
  queued_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  started_at TIMESTAMPTZ,
  finished_at TIMESTAMPTZ
);

CREATE INDEX IF NOT EXISTS idx_async_jobs_status_available
  ON async_jobs(status, available_at, queued_at);

CREATE INDEX IF NOT EXISTS idx_async_jobs_project
  ON async_jobs(project_id, status, queued_at DESC);

