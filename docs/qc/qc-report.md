# QC Report — RAG Quality (free-context-hub)

Project: `qc-free-context-hub`  
Focus: **RAG quality** (retrieval grounding + usefulness), not function-level tool checks.

## Latest automated retrieval run

- Latest run report: `docs/qc/2026-03-27T13-19-53-961Z-qc-report.md`
- Artifacts: `docs/qc/artifacts/2026-03-27T13-19-53-961Z-qc-artifacts.json`
- Totals (file-level ground truth):
  - queries: **49**
  - **recall@3 = 0.469**
  - **MRR = 0.376**

## Key findings (from worst queries)

### 1) “Server entrypoint” and “auth” queries miss `src/index.ts`
Examples:
- `auth-workspace-token-validate` expects `src/index.ts` but top results are `src/utils/ignore.ts`, `src/services/distiller.ts`, `src/kg/bootstrap.ts`.
- `mcp-streamable-http-endpoint` expects `src/index.ts` but KG bootstrap files dominate.

**Hypothesis**: chunking + embedding similarity pulls in “config/bootstrapping” vocabulary without surfacing the entrypoint file.\n
**Suggested improvements**:
- Add lightweight **lexical boost** for exact token matches (e.g. `assertWorkspaceToken`, `/mcp`, `registerTool`) when present.
- Consider smaller chunks for `src/index.ts` region with tool registrations to improve semantic resolution.

### 2) Indexing/embedding pipeline queries miss the correct files
Examples:
- `index-project-main-pipeline` expects `src/services/indexer.ts` + `src/services/embedder.ts` but top results include proposal upsert and schema files.
- `embedding-request-shape` expects `src/services/embedder.ts` but retrieves DB client/proposal code first.

**Hypothesis**: the vocabulary is shared across multiple files (DB, schema, embeddings), and semantic similarity alone isn’t enough.\n
**Suggested improvements**:
- Add optional `filters.path_glob` defaults for internal “how it works” prompts (e.g. default `src/services/**` when query contains “embed/embedding/index”).
- Add a “tool-assisted” retrieval mode that first retrieves via symbol graph neighbors when KG is enabled (entrypoint -> callee chain).

### 3) Queue/RabbitMQ queries under-retrieve `jobQueue.ts` / `worker.ts`
Examples:
- `rabbitmq-queue-assert-bind` expects `src/services/jobQueue.ts` but top results include test files / executor.
- `worker-rabbitmq-consumer` expects `src/worker.ts` but misses in top 3.

**Suggested improvements**:
- Add negative weighting for `**/*.test.ts` in `search_code` results (or exclude tests by default unless `include_tests=true`).
- Consider storing a cheap **path prior**: prefer non-test `src/` over `src/**/*.test.ts` when scores are close.

### 4) KG-related retrieval is weaker than KG tool quality
Even when KG tools work (see `docs/qc/kg-coverage-quickcheck.md`), `search_code` queries that ask about KG internals often return `tsMorphExtractor.ts` repeatedly instead of the requested files.\n
**Suggested improvements**:
- Add a KG-aware retrieval shortcut: for KG queries, run `search_symbols` first and then retrieve the symbol’s file via `get_symbol_neighbors`.\n

## Supplementary QC evidence
- KG quickcheck: `docs/qc/kg-coverage-quickcheck.md`
- Lessons eval: `docs/qc/lessons-eval.md`
- Git eval: `docs/qc/git-eval.md`
- Human rubric + tasks:\n
  - `docs/qc/task-eval-kit.md`\n
  - `docs/qc/e2e-tasks.md`

## Ranked improvement backlog (next engineering actions)
1. **Exclude or down-rank tests** in `search_code` by default (`**/*.test.ts`) to reduce noise.\n
2. Add **lexical boost** for exact identifier matches (especially for entrypoint/auth/server routing).\n
3. Add **KG-assisted retrieval mode**: `search_symbols` -> file -> neighbors for “how does X work” queries when KG enabled.\n
4. Add “query-class defaults”: auto-suggest `filters.path_glob` based on query intent (indexing/git/queue/kg).\n
5. Extend golden set to 80–100 queries and rerun QC after each retrieval tweak to measure deltas.

