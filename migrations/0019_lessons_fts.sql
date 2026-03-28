-- Add FTS column to lessons for hybrid search (semantic + keyword).
-- Combines title + content into tsvector for full-text matching.

ALTER TABLE lessons ADD COLUMN IF NOT EXISTS fts tsvector;

-- Backfill existing lessons.
UPDATE lessons SET fts = to_tsvector('english', title || ' ' || content)
WHERE fts IS NULL;

-- GIN index for fast FTS queries.
CREATE INDEX IF NOT EXISTS idx_lessons_fts ON lessons USING GIN (fts);
