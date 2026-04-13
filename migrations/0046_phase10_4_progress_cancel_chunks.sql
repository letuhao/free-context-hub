-- Phase 10 Sprint 10.4: job progress tracking, cancellation, and chunk-edit support.
--
-- Changes:
-- 1. async_jobs: add progress_pct + progress_message columns for real-time updates
-- 2. async_jobs: allow 'cancelled' status (worker checks before each page)
-- 3. document_chunks: add updated_at column for optimistic locking on edits

-- 1. Job progress tracking (used by worker to write per-page progress)
ALTER TABLE async_jobs ADD COLUMN IF NOT EXISTS progress_pct REAL;
ALTER TABLE async_jobs ADD COLUMN IF NOT EXISTS progress_message TEXT;

-- 2. Allow 'cancelled' as a job status. Existing constraint allows
--    queued/running/succeeded/failed/dead_letter — we add 'cancelled'.
ALTER TABLE async_jobs DROP CONSTRAINT IF EXISTS async_jobs_status_check;
ALTER TABLE async_jobs ADD CONSTRAINT async_jobs_status_check
  CHECK (status IN ('queued', 'running', 'succeeded', 'failed', 'dead_letter', 'cancelled'));

-- 3. Chunk updated_at for optimistic locking on edits
ALTER TABLE document_chunks ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ NOT NULL DEFAULT now();

-- Auto-update updated_at on row update (matches created_at pattern)
CREATE OR REPLACE FUNCTION document_chunks_touch() RETURNS trigger AS $$
BEGIN
  NEW.updated_at := now();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS document_chunks_touch_trigger ON document_chunks;
CREATE TRIGGER document_chunks_touch_trigger
  BEFORE UPDATE ON document_chunks
  FOR EACH ROW EXECUTE FUNCTION document_chunks_touch();
