-- 0044: Fix document_chunks embedding dimension to 1024
-- Migration 0042 hardcoded vector(768) but the active embedding model
-- (jina_v5 / bge-m3) produces 1024-dimensional vectors. Match the lessons
-- table dimension and the EMBEDDINGS_DIM env var.
--
-- Since we just shipped 0042, no chunks exist yet — safe to ALTER without
-- backfill.

DROP INDEX IF EXISTS idx_document_chunks_embedding_hnsw;

ALTER TABLE document_chunks
  ALTER COLUMN embedding TYPE vector(1024) USING NULL;

CREATE INDEX IF NOT EXISTS idx_document_chunks_embedding_hnsw
  ON document_chunks
  USING hnsw (embedding vector_cosine_ops);
