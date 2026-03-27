-- Phase 5: automation and git intelligence

CREATE TABLE IF NOT EXISTS git_commits (
  project_id TEXT NOT NULL REFERENCES projects(project_id) ON DELETE CASCADE,
  sha TEXT NOT NULL,
  parent_shas TEXT[] NOT NULL DEFAULT '{}'::text[],
  author_name TEXT NOT NULL DEFAULT '',
  author_email TEXT NOT NULL DEFAULT '',
  committed_at TIMESTAMPTZ NOT NULL,
  message TEXT NOT NULL,
  summary TEXT,
  ingested_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (project_id, sha)
);

CREATE INDEX IF NOT EXISTS idx_git_commits_project_time
  ON git_commits(project_id, committed_at DESC);

CREATE TABLE IF NOT EXISTS git_commit_files (
  project_id TEXT NOT NULL,
  commit_sha TEXT NOT NULL,
  file_path TEXT NOT NULL,
  change_kind TEXT NOT NULL CHECK (change_kind IN ('A', 'M', 'D', 'R', 'C', 'T', 'U', 'X', 'B')),
  additions INT,
  deletions INT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (project_id, commit_sha, file_path),
  CONSTRAINT git_commit_files_commit_fk
    FOREIGN KEY (project_id, commit_sha)
    REFERENCES git_commits(project_id, sha)
    ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_git_commit_files_project_path
  ON git_commit_files(project_id, file_path);

CREATE TABLE IF NOT EXISTS git_ingest_runs (
  run_id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id TEXT NOT NULL REFERENCES projects(project_id) ON DELETE CASCADE,
  root TEXT NOT NULL,
  since_ref TEXT,
  until_ref TEXT,
  max_commits INT NOT NULL,
  commits_seen INT NOT NULL DEFAULT 0,
  commits_upserted INT NOT NULL DEFAULT 0,
  files_upserted INT NOT NULL DEFAULT 0,
  status TEXT NOT NULL CHECK (status IN ('ok', 'error')),
  error_message TEXT,
  started_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  finished_at TIMESTAMPTZ
);

CREATE INDEX IF NOT EXISTS idx_git_ingest_runs_project_started
  ON git_ingest_runs(project_id, started_at DESC);

CREATE TABLE IF NOT EXISTS git_lesson_proposals (
  proposal_id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id TEXT NOT NULL REFERENCES projects(project_id) ON DELETE CASCADE,
  source_commit_sha TEXT,
  lesson_type TEXT NOT NULL CHECK (lesson_type IN ('decision', 'preference', 'guardrail', 'workaround', 'general_note')),
  title TEXT NOT NULL,
  content TEXT NOT NULL,
  tags TEXT[] NOT NULL DEFAULT '{}'::text[],
  source_refs TEXT[] NOT NULL DEFAULT '{}'::text[],
  rationale TEXT,
  status TEXT NOT NULL DEFAULT 'draft' CHECK (status IN ('draft', 'accepted', 'rejected')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT git_lesson_proposals_commit_fk
    FOREIGN KEY (project_id, source_commit_sha)
    REFERENCES git_commits(project_id, sha)
    ON DELETE SET NULL
);

CREATE INDEX IF NOT EXISTS idx_git_lesson_proposals_project_status
  ON git_lesson_proposals(project_id, status, created_at DESC);

-- Keep one active draft proposal per commit to avoid duplicates on repeated suggestions.
CREATE UNIQUE INDEX IF NOT EXISTS uq_git_lesson_proposals_draft_per_commit
  ON git_lesson_proposals(project_id, source_commit_sha)
  WHERE status = 'draft' AND source_commit_sha IS NOT NULL;
