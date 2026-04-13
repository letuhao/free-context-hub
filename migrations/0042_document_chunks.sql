-- 0042: Document chunks for Phase 10 extraction pipeline
-- Stores chunked, embedded content extracted from documents.
-- Each chunk participates in semantic search alongside lessons.

CREATE TABLE IF NOT EXISTS document_chunks (
  chunk_id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  doc_id UUID NOT NULL REFERENCES documents(doc_id) ON DELETE CASCADE,
  project_id TEXT NOT NULL,
  chunk_index INT NOT NULL,
  content TEXT NOT NULL,
  page_number INT,
  heading TEXT,
  chunk_type TEXT NOT NULL DEFAULT 'text'
    CHECK (chunk_type IN ('text', 'table', 'diagram_description', 'mermaid', 'code')),
  extraction_mode TEXT
    CHECK (extraction_mode IN ('fast', 'quality', 'vision')),
  confidence REAL,
  bbox_x0 REAL,
  bbox_y0 REAL,
  bbox_x1 REAL,
  bbox_y1 REAL,
  embedding vector(1024),
  fts tsvector,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_document_chunks_doc
  ON document_chunks(doc_id, chunk_index);

CREATE INDEX IF NOT EXISTS idx_document_chunks_project
  ON document_chunks(project_id);

CREATE INDEX IF NOT EXISTS idx_document_chunks_embedding_hnsw
  ON document_chunks
  USING hnsw (embedding vector_cosine_ops);

CREATE INDEX IF NOT EXISTS idx_document_chunks_fts
  ON document_chunks
  USING gin (fts);

-- Auto-update FTS on insert/update (matches lesson FTS pattern)
CREATE OR REPLACE FUNCTION document_chunks_fts_update() RETURNS trigger AS $$
BEGIN
  NEW.fts := to_tsvector('english', COALESCE(NEW.heading, '') || ' ' || COALESCE(NEW.content, ''));
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS document_chunks_fts_trigger ON document_chunks;
CREATE TRIGGER document_chunks_fts_trigger
  BEFORE INSERT OR UPDATE OF content, heading
  ON document_chunks
  FOR EACH ROW EXECUTE FUNCTION document_chunks_fts_update();
