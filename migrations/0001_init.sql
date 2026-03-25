-- MVP schema for ContextHub
-- Vector dimension is fixed to 1024 to match EMBEDDINGS_DIM default.

CREATE EXTENSION IF NOT EXISTS vector;
CREATE EXTENSION IF NOT EXISTS pgcrypto;

CREATE TABLE IF NOT EXISTS projects (
  project_id TEXT PRIMARY KEY,
  name TEXT,
  settings JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS files (
  file_id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id TEXT NOT NULL,
  root TEXT NOT NULL,
  path TEXT NOT NULL,
  content_hash TEXT NOT NULL,
  last_indexed_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (project_id, root, path)
);

CREATE TABLE IF NOT EXISTS chunks (
  chunk_id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id TEXT NOT NULL,
  root TEXT NOT NULL,
  file_path TEXT NOT NULL,
  start_line INT NOT NULL,
  end_line INT NOT NULL,
  content TEXT NOT NULL,
  embedding vector(1024) NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_chunks_project_file ON chunks(project_id, file_path);

CREATE TABLE IF NOT EXISTS lessons (
  lesson_id UUID PRIMARY KEY,
  project_id TEXT NOT NULL,
  lesson_type TEXT NOT NULL CHECK (lesson_type IN ('decision','preference','guardrail','workaround','general_note')),
  title TEXT NOT NULL,
  content TEXT NOT NULL,
  tags TEXT[] NOT NULL DEFAULT '{}'::text[],
  source_refs TEXT[] NOT NULL DEFAULT '{}'::text[],
  embedding vector(1024) NOT NULL,
  captured_by TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS guardrails (
  rule_id UUID PRIMARY KEY,
  project_id TEXT NOT NULL,
  trigger TEXT NOT NULL,
  requirement TEXT NOT NULL,
  verification_method TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS guardrail_audit_logs (
  audit_id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id TEXT NOT NULL,
  rule_id UUID,
  action_context JSONB NOT NULL,
  pass BOOLEAN NOT NULL,
  needs_confirmation BOOLEAN NOT NULL,
  prompt TEXT,
  decision_reason TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

