-- Switch vector dimension from 768 back to 1024 for bge-m3 model.
-- All existing embeddings will be lost — full re-index required.

DROP INDEX IF EXISTS idx_chunks_embedding_hnsw;
DROP INDEX IF EXISTS idx_lessons_embedding;

ALTER TABLE chunks DROP COLUMN IF EXISTS embedding;
ALTER TABLE chunks ADD COLUMN embedding vector(1024);

ALTER TABLE lessons DROP COLUMN IF EXISTS embedding;
ALTER TABLE lessons ADD COLUMN embedding vector(1024);

CREATE INDEX idx_chunks_embedding_hnsw ON chunks USING hnsw (embedding vector_cosine_ops);
CREATE INDEX idx_lessons_embedding ON lessons USING hnsw (embedding vector_cosine_ops);

DELETE FROM chunks;
DELETE FROM lessons;
