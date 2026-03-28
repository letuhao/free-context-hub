-- Switch vector dimension from 1024 to 768 for nomic-embed-text-v2 model.
-- All existing embeddings will be lost — full re-index + re-seed lessons required.

-- Drop HNSW indexes first (they reference the old dimension).
DROP INDEX IF EXISTS idx_chunks_embedding_hnsw;
DROP INDEX IF EXISTS idx_lessons_embedding;

-- Chunks: drop old 1024-dim column, add new 768-dim.
ALTER TABLE chunks DROP COLUMN IF EXISTS embedding;
ALTER TABLE chunks ADD COLUMN embedding vector(768);

-- Lessons: drop old 1024-dim column, add new 768-dim.
ALTER TABLE lessons DROP COLUMN IF EXISTS embedding;
ALTER TABLE lessons ADD COLUMN embedding vector(768);

-- Recreate HNSW indexes for 768 dimensions.
CREATE INDEX idx_chunks_embedding_hnsw ON chunks USING hnsw (embedding vector_cosine_ops);
CREATE INDEX idx_lessons_embedding ON lessons USING hnsw (embedding vector_cosine_ops);

-- Delete all chunks so index_project does a fresh full index.
DELETE FROM chunks;
-- Delete all lessons (embeddings are now NULL / incompatible).
DELETE FROM lessons;
