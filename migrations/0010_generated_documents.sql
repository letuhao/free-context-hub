-- DB-first generated artifact storage (FAQ / RAPTOR / QC / benchmarks).

CREATE TABLE IF NOT EXISTS generated_documents (
  doc_id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id TEXT NOT NULL REFERENCES projects(project_id) ON DELETE CASCADE,
  doc_type TEXT NOT NULL CHECK (
    doc_type IN (
      'faq',
      'raptor',
      'qc_report',
      'qc_artifact',
      'benchmark_artifact'
    )
  ),
  doc_key TEXT NOT NULL,
  source_job_id UUID,
  correlation_id TEXT,
  title TEXT,
  path_hint TEXT,
  content TEXT NOT NULL,
  metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (project_id, doc_type, doc_key)
);

CREATE INDEX IF NOT EXISTS idx_generated_docs_project_type_updated
  ON generated_documents(project_id, doc_type, updated_at DESC);

CREATE INDEX IF NOT EXISTS idx_generated_docs_project_corr
  ON generated_documents(project_id, correlation_id, updated_at DESC);

CREATE TABLE IF NOT EXISTS generated_exports (
  export_id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  doc_id UUID NOT NULL REFERENCES generated_documents(doc_id) ON DELETE CASCADE,
  export_path TEXT NOT NULL,
  content_hash TEXT NOT NULL,
  exported_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_generated_exports_doc
  ON generated_exports(doc_id, exported_at DESC);

