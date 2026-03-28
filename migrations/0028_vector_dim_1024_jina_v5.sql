-- Switch back to 1024d for Jina v5 retrieval benchmark.

DROP INDEX IF EXISTS idx_chunks_embedding_hnsw;
DROP INDEX IF EXISTS idx_lessons_embedding_hnsw;

ALTER TABLE chunks DROP COLUMN IF EXISTS embedding;
ALTER TABLE chunks ADD COLUMN embedding vector(1024);

ALTER TABLE lessons DROP COLUMN IF EXISTS embedding;
ALTER TABLE lessons ADD COLUMN embedding vector(1024);

CREATE INDEX idx_chunks_embedding_hnsw ON chunks USING hnsw (embedding vector_cosine_ops);
CREATE INDEX idx_lessons_embedding_hnsw ON lessons USING hnsw (embedding vector_cosine_ops);

DELETE FROM chunks;
DELETE FROM lessons;
