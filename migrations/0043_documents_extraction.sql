-- 0043: Document extraction support
-- Expands doc_type to include new formats, adds content_hash for dedup,
-- and extraction_status to track pipeline state.

-- Drop and recreate the doc_type CHECK constraint to add new formats
ALTER TABLE documents DROP CONSTRAINT IF EXISTS documents_doc_type_check;
ALTER TABLE documents ADD CONSTRAINT documents_doc_type_check
  CHECK (doc_type IN (
    'pdf', 'markdown', 'url', 'text',
    'docx', 'image', 'epub', 'odt', 'rtf', 'html'
  ));

-- Content hash for deduplication (SHA-256 of file bytes)
ALTER TABLE documents ADD COLUMN IF NOT EXISTS content_hash TEXT;

-- Extraction pipeline status
ALTER TABLE documents ADD COLUMN IF NOT EXISTS extraction_status TEXT
  DEFAULT 'none'
  CHECK (extraction_status IN ('none', 'processing', 'complete', 'failed'));

-- Track the most recent extraction mode used (fast/quality/vision)
ALTER TABLE documents ADD COLUMN IF NOT EXISTS extraction_mode TEXT
  CHECK (extraction_mode IN ('fast', 'quality', 'vision'));

-- Extracted timestamp
ALTER TABLE documents ADD COLUMN IF NOT EXISTS extracted_at TIMESTAMPTZ;

-- Backfill content_hash for existing documents from their content column.
-- Each existing document gets a hash that includes its doc_id as a suffix,
-- making it unique. This means existing documents WON'T dedupe against future
-- uploads (their hash isn't a real SHA-256 of file bytes), but it lets us
-- enforce dedup on all NEW uploads going forward without destroying existing
-- data — including pre-Phase-10 duplicates from test fixtures.
CREATE EXTENSION IF NOT EXISTS pgcrypto;
UPDATE documents
SET content_hash = 'legacy:' || doc_id::text
WHERE content_hash IS NULL;

-- Unique constraint per project on content_hash (allows same file in different projects).
-- Legacy rows have unique 'legacy:<uuid>' values so they pass the constraint.
-- New uploads from the Phase 10 endpoint use real SHA-256 hashes and dedupe correctly.
CREATE UNIQUE INDEX IF NOT EXISTS idx_documents_project_hash
  ON documents(project_id, content_hash)
  WHERE content_hash IS NOT NULL;
