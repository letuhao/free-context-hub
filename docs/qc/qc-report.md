# QC Report — RAG Quality (free-context-hub)

Project: `qc-free-context-hub`  
Focus: **RAG quality** (retrieval grounding + usefulness), not function-level tool checks.

## Latest automated retrieval run

- Latest run report: `docs/qc/2026-03-27T13-58-03-232Z-qc-report.md`
- Artifacts: `docs/qc/artifacts/2026-03-27T13-58-03-232Z-qc-artifacts.json`
- Totals (file-level ground truth):
- queries: **67**
- **recall@3 = 0.537**
- **MRR = 0.502**

## Delta vs previous run (retrieval tuning)

- Previous: `docs/qc/2026-03-27T13-56-28-934Z-qc-report.md` (49 queries)
- Current: `docs/qc/2026-03-27T13-58-03-232Z-qc-report.md` (67 queries)
- Totals:
  - recall@3: **0.551 → 0.537** (\(\Delta -0.014\))
  - MRR: **0.511 → 0.502** (\(\Delta -0.009\))
- Note: golden set expanded (+18 queries), so totals are not perfectly comparable; treat as a “new baseline”.

## A/B: optional LLM rerank (search_code.filters.rerank_mode)

- QC (rerank off): `docs/qc/2026-03-27T14-01-22-434Z-qc-report.md`
- QC (rerank llm): `docs/qc/2026-03-27T14-01-37-765Z-qc-report.md`
- Result: totals unchanged in this run (likely because `DISTILLATION_ENABLED=false` so rerank is a best-effort no-op).

## Key findings (from worst queries)

### 1) “Server entrypoint” and “auth” queries miss `src/index.ts`
Examples:
- `auth-workspace-token-validate` expects `src/index.ts` but top results are `src/utils/ignore.ts`, `src/services/distiller.ts`, `src/kg/bootstrap.ts`.
- `mcp-streamable-http-endpoint` expects `src/index.ts` but KG bootstrap files dominate.

**Status**: still failing (see latest worst list: `auth-workspace-token-validate`, `mcp-streamable-http-endpoint`, `mcp-tool-registrations`).\n
**Hypothesis**: chunking + embedding similarity pulls in “config/bootstrapping” vocabulary without surfacing the entrypoint file.
**Suggested improvements**:
- Add lightweight **lexical boost** for exact token matches (e.g. `assertWorkspaceToken`, `/mcp`, `registerTool`) when present.
- Consider smaller chunks for `src/index.ts` region with tool registrations to improve semantic resolution.

### 2) Indexing/embedding pipeline queries miss the correct files
Examples:
- `index-project-main-pipeline` expects `src/services/indexer.ts` + `src/services/embedder.ts` but top results include proposal upsert and schema files.
- `embedding-request-shape` expects `src/services/embedder.ts` but retrieves DB client/proposal code first.

**Status**: still failing for `index-project-main-pipeline` and `embedding-request-shape`.\n
**Hypothesis**: the vocabulary is shared across multiple files (DB, schema, embeddings), and semantic similarity alone isn’t enough.
**Suggested improvements**:
- Add optional `filters.path_glob` defaults for internal “how it works” prompts (e.g. default `src/services/**` when query contains “embed/embedding/index”).
- Add a “tool-assisted” retrieval mode that first retrieves via symbol graph neighbors when KG is enabled (entrypoint -> callee chain).

### 3) Queue/RabbitMQ queries under-retrieve `jobQueue.ts` / `worker.ts`
Examples:
- `rabbitmq-queue-assert-bind` expects `src/services/jobQueue.ts` but top results include test files / executor.
- `worker-rabbitmq-consumer` expects `src/worker.ts` but misses in top 3.

**Status**: queue group recall@3 is **0.500** (10 queries) and multiple items still miss (`job-queue-rabbitmq`, `worker-rabbitmq-consumer`).\n
**Suggested improvements**:
- Strengthen entrypoint/file-path weighting for `jobQueue.ts`, `worker.ts`, `jobExecutor.ts`.
- Use KG assist probes tuned for queue intent (`RabbitMQ`, `assertQueue`, `consume`, `ack`).

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
1. **Fix server entrypoint retrieval** for `src/index.ts` (auth/routes/tool registrations) — currently worst cluster.
2. **Fix config/env retrieval** for `src/env.ts` (newly expanded golden set shows config group recall@3 = 0.000).
3. Improve indexing/embeddings retrieval (`src/services/indexer.ts`, `src/services/embedder.ts`).
4. Improve queue retrieval (`jobQueue.ts`, `worker.ts`) with intent probes + path weighting.
5. Continue expanding golden set toward 80–100 and keep delta reporting per change set.

