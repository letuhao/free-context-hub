-- Switch to 768d for EmbeddingGemma-300M benchmark test.

DROP INDEX IF EXISTS idx_chunks_embedding_hnsw;
DROP INDEX IF EXISTS idx_lessons_embedding_hnsw;

ALTER TABLE chunks DROP COLUMN IF EXISTS embedding;
ALTER TABLE chunks ADD COLUMN embedding vector(768);

ALTER TABLE lessons DROP COLUMN IF EXISTS embedding;
ALTER TABLE lessons ADD COLUMN embedding vector(768);

CREATE INDEX idx_chunks_embedding_hnsw ON chunks USING hnsw (embedding vector_cosine_ops);
CREATE INDEX idx_lessons_embedding_hnsw ON lessons USING hnsw (embedding vector_cosine_ops);

DELETE FROM chunks;
DELETE FROM lessons;
