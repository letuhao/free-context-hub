-- Switch to 2560 dimensions for qwen3-embedding-4b model.
-- pgvector vector type only supports HNSW/IVFFlat up to 2000 dims.
-- Use halfvec(2560) which supports HNSW up to 4000 dims with half precision.
-- Half precision is sufficient for similarity search (negligible quality loss).

DROP INDEX IF EXISTS idx_chunks_embedding_hnsw;
DROP INDEX IF EXISTS idx_chunks_embedding_ivf;
DROP INDEX IF EXISTS idx_lessons_embedding;
DROP INDEX IF EXISTS idx_lessons_embedding_ivf;

ALTER TABLE chunks DROP COLUMN IF EXISTS embedding;
ALTER TABLE chunks ADD COLUMN embedding halfvec(2560);

ALTER TABLE lessons DROP COLUMN IF EXISTS embedding;
ALTER TABLE lessons ADD COLUMN embedding halfvec(2560);

CREATE INDEX idx_chunks_embedding_hnsw ON chunks USING hnsw (embedding halfvec_cosine_ops);
CREATE INDEX idx_lessons_embedding_hnsw ON lessons USING hnsw (embedding halfvec_cosine_ops);

DELETE FROM chunks;
DELETE FROM lessons;
