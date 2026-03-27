# End-to-end RAG Tasks — QC Worksheet

Project: `qc-free-context-hub`

Use this worksheet with the rubric in `docs/qc/task-eval-kit.md`.

## Task 1 — Worker pipeline (repo.sync)
- Prompt: Explain end-to-end worker pipeline for `repo.sync`, including fan-out jobs and correlation scoping.
- Tools: `search_code`, `search_symbols` (optional), `list_jobs` (optional)
- Expected target files: `src/services/jobExecutor.ts`, `src/services/jobQueue.ts`, `src/worker.ts`

## Task 2 — correlation_id debugging
- Prompt: Identify where `correlation_id` is applied and how to debug a single run via MCP tools.
- Tools: `search_code`, `list_jobs(correlation_id=...)`
- Expected target files: `src/index.ts`, `src/services/jobQueue.ts`, `src/services/jobExecutor.ts`

## Task 3 — Indexing pipeline
- Prompt: Explain how `index_project` discovers files, chunks, embeds, and writes to Postgres.
- Tools: `search_code`, (optional) `search_symbols`
- Expected target files: `src/services/indexer.ts`, `src/services/embedder.ts`

## Task 4 — Retrieval contract & output_format
- Prompt: Explain `search_code` contract and how clients parse `auto_both` results.
- Tools: `search_code`
- Expected target files: `src/index.ts`, `src/utils/outputFormat.ts`, `src/smoke/smokeTest.ts`

## Task 5 — KG bootstrap & schema
- Prompt: Explain how KG is bootstrapped and schema constraints are applied.
- Tools: `search_code`, `search_symbols`
- Expected target files: `src/kg/bootstrap.ts`, `src/kg/schema.ts`

## Task 6 — TS symbol extraction
- Prompt: Explain how ts-morph extractor emits symbols and relationships (CALLS/IMPORTS/DECLARES).
- Tools: `search_code`, `search_symbols`, `get_symbol_neighbors`
- Expected target files: `src/kg/extractor/tsMorphExtractor.ts`

## Task 7 — Git ingestion correctness (incl deleted files)
- Prompt: Explain git ingestion diff parsing and how deleted files are retained.
- Tools: `search_code`, `get_commit`
- Expected target files: `src/services/gitIntelligence.ts`, `src/services/gitCommitFileParse.ts`

## Task 8 — Idempotent proposals
- Prompt: Explain how draft lesson proposals are idempotent and how conflicts are avoided.
- Tools: `search_code`
- Expected target files: `src/services/gitLessonProposalUpsert.ts`, `migrations/0007_git_lesson_proposals_draft_unique.sql`

## Task 9 — S3 source artifacts
- Prompt: Explain S3 sync/materialize flow and artifact keys.
- Tools: `search_code`, `get_project_source` (optional)
- Expected target files: `src/services/sourceArtifacts.ts`, `src/services/repoSources.ts`

## Task 10 — Workspace scan + delta index
- Prompt: Explain how scan_workspace detects changes and triggers delta indexing.
- Tools: `search_code`, `scan_workspace`
- Expected target files: `src/services/workspaceTracker.ts`

## Task 11 — Lesson impact links
- Prompt: Explain how lessons link to symbols and how `get_lesson_impact` is populated.
- Tools: `search_code`, `get_lesson_impact`
- Expected target files: `src/kg/linker.ts`, `src/services/lessons.ts`

## Task 12 — Guardrails
- Prompt: Explain guardrail trigger matching and what `check_guardrails` returns.
- Tools: `search_code`, `check_guardrails`
- Expected target files: `src/services/guardrails.ts`

