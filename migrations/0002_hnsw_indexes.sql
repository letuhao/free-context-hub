-- Phase 2: performance indexes for vector search
-- Adds HNSW indexes for cosine distance queries on embeddings.

-- Ensure pgvector is available (already created in 0001, but keep idempotent).
CREATE EXTENSION IF NOT EXISTS vector;

-- HNSW index for code chunk embeddings (used by search_code).
-- Our queries order by `embedding <=> query_vector`, i.e. cosine distance.
CREATE INDEX IF NOT EXISTS idx_chunks_embedding_hnsw
  ON chunks
  USING hnsw (embedding vector_cosine_ops);

-- HNSW index for lesson embeddings (used by search_lessons).
CREATE INDEX IF NOT EXISTS idx_lessons_embedding_hnsw
  ON lessons
  USING hnsw (embedding vector_cosine_ops);

