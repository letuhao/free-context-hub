-- Switch vector dimension from 1024 to 4096 for qwen3-embedding-8b model.
-- Note: pgvector indexes (HNSW/IVFFlat) do not support >2000 dims.
-- No vector index created — sequential scan only. Superseded by 0023.

DROP INDEX IF EXISTS idx_chunks_embedding_hnsw;
DROP INDEX IF EXISTS idx_lessons_embedding;

ALTER TABLE chunks DROP COLUMN IF EXISTS embedding;
ALTER TABLE chunks ADD COLUMN embedding vector(4096);

ALTER TABLE lessons DROP COLUMN IF EXISTS embedding;
ALTER TABLE lessons ADD COLUMN embedding vector(4096);

DELETE FROM chunks;
DELETE FROM lessons;
