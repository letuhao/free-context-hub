# Storage Contract (DB-first)

This project uses a DB-first storage model for generated RAG artifacts.

## Roles by storage

- Postgres: canonical source of truth for generated artifacts, chunks, lessons, async jobs, and project snapshots.
- Neo4j: canonical source for symbol graph relationships.
- Redis: non-canonical cache only (retrieval/rerank cache, versioned invalidation).
- S3/MinIO: source repository artifacts/bundles only.
- Filesystem: derived export/audit/debug output only.

## Mandatory rules

- Every generated artifact MUST be written to Postgres first (`generated_documents`).
- File exports MUST be derived from DB content and can be regenerated at any time.
- Redis MUST NOT store canonical generated content.
- S3 MUST NOT store generated FAQ/RAPTOR/QC reports.
- Worker jobs MUST include trace fields (`source_job_id`, `correlation_id`) when writing generated content.

## Job to write-target mapping

- `faq.build`
  - Canonical: `generated_documents` (`doc_type='faq'`)
  - Derived export: `docs/faq/*.md` + `generated_exports`
  - Downstream indexing: `index.run` (includes generated docs indexing)
- `raptor.build`
  - Canonical: `generated_documents` (`doc_type='raptor'`)
  - Derived export: `docs/.raptor/**` + `generated_exports`
  - Downstream indexing: `index.run` (includes generated docs indexing)
- `quality.eval` (worker) / `qc:rag` (QC harness)
  - Worker: `benchmark_artifact` JSON (`quality_eval/*`, optional baseline `quality_eval/baseline`)
  - Harness: `generated_documents` (`doc_type='qc_artifact' | 'qc_report'`) plus filesystem `docs/qc/**`
- `knowledge.loop.shallow`
  - Canonical: `benchmark_artifact` audit row (`phase6/shallow/*`, metadata often `status: draft`)
  - Downstream: FAQ/RAPTOR builders + single `index.run`
- `knowledge.loop.deep`
  - Canonical: `benchmark_artifact` per eval round (`quality_eval/deep-*`) + summary (`phase6/deep/summary/*`)
  - Bounded rounds: `index.run` + `quality.eval` until gates pass or `max_rounds`
- `index.run`
  - Indexes filesystem content and generated DB documents into `chunks`
  - Synthetic paths: `generated/<doc_type>/<doc_key>.md`

## Cache policy

- Retrieval/rerank cache keys must include project cache version.
- Any indexing completion bumps `project_cache_versions.version`.
- Cache misses always fall back to canonical DB data.

