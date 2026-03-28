-- Switch to 3584 dimensions for nomic-embed-code model.
-- >2000 dims requires halfvec for HNSW index support.

DROP INDEX IF EXISTS idx_chunks_embedding_hnsw;
DROP INDEX IF EXISTS idx_chunks_embedding_ivf;
DROP INDEX IF EXISTS idx_lessons_embedding_hnsw;
DROP INDEX IF EXISTS idx_lessons_embedding_ivf;

ALTER TABLE chunks DROP COLUMN IF EXISTS embedding;
ALTER TABLE chunks ADD COLUMN embedding halfvec(3584);

ALTER TABLE lessons DROP COLUMN IF EXISTS embedding;
ALTER TABLE lessons ADD COLUMN embedding halfvec(3584);

CREATE INDEX idx_chunks_embedding_hnsw ON chunks USING hnsw (embedding halfvec_cosine_ops);
CREATE INDEX idx_lessons_embedding_hnsw ON lessons USING hnsw (embedding halfvec_cosine_ops);

DELETE FROM chunks;
DELETE FROM lessons;
