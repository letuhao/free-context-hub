-- 0033: Document management
-- Stores uploaded/linked reference documents and their association with lessons.

CREATE TABLE IF NOT EXISTS documents (
  doc_id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id TEXT NOT NULL,
  name TEXT NOT NULL,
  doc_type TEXT NOT NULL CHECK (doc_type IN ('pdf', 'markdown', 'url', 'text')),
  url TEXT,
  storage_path TEXT,
  content TEXT,
  file_size_bytes INT,
  description TEXT,
  tags TEXT[] NOT NULL DEFAULT '{}'::text[],
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_documents_project ON documents(project_id, updated_at DESC);

CREATE TABLE IF NOT EXISTS document_lessons (
  doc_id UUID NOT NULL REFERENCES documents(doc_id) ON DELETE CASCADE,
  lesson_id UUID NOT NULL REFERENCES lessons(lesson_id) ON DELETE CASCADE,
  linked_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (doc_id, lesson_id)
);
