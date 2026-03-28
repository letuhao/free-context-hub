-- Chunk metadata for language-aware retrieval.
-- Adds structural metadata to chunks: language, symbol info, test detection, and FTS.

ALTER TABLE chunks ADD COLUMN IF NOT EXISTS language TEXT;
ALTER TABLE chunks ADD COLUMN IF NOT EXISTS symbol_name TEXT;
ALTER TABLE chunks ADD COLUMN IF NOT EXISTS symbol_type TEXT;
ALTER TABLE chunks ADD COLUMN IF NOT EXISTS is_test BOOLEAN NOT NULL DEFAULT false;

-- Full-text search column for hybrid search (replaces ILIKE).
ALTER TABLE chunks ADD COLUMN IF NOT EXISTS fts tsvector;

-- GIN index for fast FTS queries.
CREATE INDEX IF NOT EXISTS idx_chunks_fts ON chunks USING GIN (fts);

-- Partial indexes for common filters.
CREATE INDEX IF NOT EXISTS idx_chunks_language ON chunks (project_id, language) WHERE language IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_chunks_is_test ON chunks (project_id, is_test) WHERE is_test = true;
CREATE INDEX IF NOT EXISTS idx_chunks_symbol_type ON chunks (project_id, symbol_type) WHERE symbol_type IS NOT NULL;
