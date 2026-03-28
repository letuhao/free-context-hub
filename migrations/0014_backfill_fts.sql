-- Backfill FTS column for chunks that were indexed before the fts column existed.
-- Uses simple content + file_path as input (no camelCase expansion in SQL --
-- good enough for basic matching; full expansion happens on next re-index).
UPDATE chunks
SET fts = to_tsvector('english', file_path || ' ' || content)
WHERE fts IS NULL;
