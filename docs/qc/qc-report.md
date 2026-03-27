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

## Verification batch (rerank + QA + RAPTOR) — 2026-03-27

Scope:
- project: `qc-free-context-hub`
- compare both sets: derived `49` and full `67`
- matrix: rerank `off` vs `llm`, before/after attempted QA+RAPTOR execution

### 67-query matrix

| phase | rerank | report | recall@3 | MRR |
|---|---|---|---:|---:|
| before jobs | off | `docs/qc/2026-03-27T14-20-18-989Z-qc-report.md` | 0.478 | 0.452 |
| before jobs | llm | `docs/qc/2026-03-27T14-20-34-292Z-qc-report.md` | 0.478 | 0.452 |
| after jobs | off | `docs/qc/2026-03-27T14-35-46-445Z-qc-report.md` | 0.478 | 0.452 |
| after jobs | llm | `docs/qc/2026-03-27T14-35-49-802Z-qc-report.md` | 0.478 | 0.452 |

### 49-query view (derived from same run artifacts)

| phase | rerank | artifact | recall@3 | MRR |
|---|---|---|---:|---:|
| before jobs | off | `docs/qc/artifacts/2026-03-27T14-20-18-989Z-qc-artifacts.json` | 0.490 | 0.447 |
| before jobs | llm | `docs/qc/artifacts/2026-03-27T14-20-34-292Z-qc-artifacts.json` | 0.490 | 0.447 |
| after jobs | off | `docs/qc/artifacts/2026-03-27T14-35-46-445Z-qc-artifacts.json` | 0.490 | 0.447 |
| after jobs | llm | `docs/qc/artifacts/2026-03-27T14-35-49-802Z-qc-artifacts.json` | 0.490 | 0.447 |

### Execution notes / blocker

- MCP tool `enqueue_job` currently rejects `job_type=faq.build|raptor.build` in input schema (only old job types are accepted), so queue-path execution for these jobs is not yet verifiable via MCP.
- Direct container execution of `buildFaq/buildRaptor` against `/workspace` is blocked by read-only mount (`EROFS`) for generated docs paths.

### Verdict

- **Not improved** in this verification batch: no measurable delta on recall@3/MRR for either 49 or 67 sets.
- Primary reason: QA/RAPTOR job path was not effectively applied to indexed corpus in this environment due to tool/schema + mount constraints, and rerank A/B remained neutral.

## Storage defragmentation verification (DB-first) — 2026-03-27

Executed with rebuilt containers and latest code:

- `buildFaq(projectId=free-context-hub, root=/workspace, outputTarget=both)` completed successfully (7 items).
- `buildRaptorSummaries(projectId=free-context-hub, root=/workspace, pathGlob=docs/faq/*.md, maxLevels=2)` completed successfully (8 outputs).
- `indexProject(projectId=free-context-hub, root=/workspace)` result:
  - `files_indexed=20`
  - `generated_docs_indexed=22`
  - `generated_chunks_indexed=22`
  - `errors=[]`
- DB evidence (queried in container):
  - `generated_documents`: `faq=14`, `raptor=8`
  - synthetic chunks (`file_path like 'generated/%'`): `22`
- `qc:rag` run succeeded in-container and wrote report/artifact under `/app/docs/qc/...` in the runtime image.

Conclusion:

- DB-first canonical write path is active for FAQ/RAPTOR.
- Generated documents are indexed via synthetic paths and become retrievable through the standard chunk index.

## Verification batch (A/B Full rerun, Docker MCP) — 2026-03-27

Scope:
- runtime: Docker MCP container
- project (current runs): `free-context-hub`
- metrics: `recall@1`, `recall@3`, `recall@10`, `MRR`, `p95_ms`
- modes: `rerank=off` and `rerank=llm`

Baseline reference (latest comparable pair):
- off: `docs/qc/artifacts/2026-03-27T14-35-46-445Z-qc-artifacts.json`
- llm: `docs/qc/artifacts/2026-03-27T14-35-49-802Z-qc-artifacts.json`

Current runs:
- off: `docs/qc/artifacts/2026-03-27T15-44-03-885Z-qc-artifacts.json`
- llm: `docs/qc/artifacts/2026-03-27T15-44-51-276Z-qc-artifacts.json`

### 67-query matrix

| phase | rerank | artifact | recall@1 | recall@3 | recall@10 | MRR | p95_ms |
|---|---|---|---:|---:|---:|---:|---:|
| baseline | off | `2026-03-27T14-35-46-445Z-qc-artifacts.json` | 0.388 | 0.478 | 0.627 | 0.452 | 63 |
| baseline | llm | `2026-03-27T14-35-49-802Z-qc-artifacts.json` | 0.388 | 0.478 | 0.627 | 0.452 | 62 |
| current | off | `2026-03-27T15-44-03-885Z-qc-artifacts.json` | 0.358 | 0.507 | 0.582 | 0.442 | 69 |
| current | llm | `2026-03-27T15-44-51-276Z-qc-artifacts.json` | 0.433 | 0.537 | 0.582 | 0.488 | 1076 |

### Delta vs baseline (67)

- off:
  - recall@1: **-0.030**
  - recall@3: **+0.030**
  - recall@10: **-0.045**
  - MRR: **-0.010**
  - p95: **+6ms**
- llm:
  - recall@1: **+0.045**
  - recall@3: **+0.060**
  - recall@10: **-0.045**
  - MRR: **+0.036**
  - p95: **+1014ms**

### 49-query view (derived from same artifacts)

| phase | rerank | artifact | recall@1 | recall@3 | recall@10 | MRR | p95_ms |
|---|---|---|---:|---:|---:|---:|---:|
| baseline | off | `2026-03-27T14-35-46-445Z-qc-artifacts.json` | 0.367 | 0.490 | 0.653 | 0.447 | 67 |
| baseline | llm | `2026-03-27T14-35-49-802Z-qc-artifacts.json` | 0.367 | 0.490 | 0.653 | 0.447 | 65 |
| current | off | `2026-03-27T15-44-03-885Z-qc-artifacts.json` | 0.327 | 0.510 | 0.612 | 0.430 | 79 |
| current | llm | `2026-03-27T15-44-51-276Z-qc-artifacts.json` | 0.429 | 0.551 | 0.612 | 0.497 | 1081 |

### Fail clusters (current)

Lowest recall@3 groups (current off / current llm):
- `mcp-server`: **0.000 / 0.000**
- `config`: **0.000 / 0.000**
- `retrieval`: **0.000 / 0.000**
- `kg`: **0.250 / 0.250**

Repeated worst queries:
- `auth-workspace-token-validate`
- `mcp-streamable-http-endpoint`
- `mcp-tool-registrations`
- `tool-output-formatting`
- `kg-query-tools`
- `kg-bootstrap`

### Verdict

- **Chất lượng top-3 cải thiện**, đặc biệt ở chế độ `rerank=llm` (`recall@3` và `MRR` tăng rõ).
- **Độ phủ top-10 giảm** so với baseline ở cả off/llm (`recall@10` giảm), cho thấy ranking hiện tại tập trung hơn nhưng coverage rộng bị mất.
- **Latency tăng mạnh khi bật llm rerank** (p95 ~1s), hiện là trade-off lớn nhất.

### Prioritized next actions

1. Tăng recall nhóm `mcp-server/config/retrieval` bằng path priors và lexical probe cho các file neo (`src/index.ts`, `src/env.ts`, `src/services/retriever.ts`).
2. Thêm guardrail cho `rerank=llm` theo latency budget (fallback auto về `off` nếu p95 vượt ngưỡng).
3. Bổ sung metric blended objective (NDCG@10 hoặc recall@10 weighted) để tránh tối ưu quá mức cho top-3.

## QC Debug Track (2026-03-27) — Issues, approaches, achieved / not achieved

### Current issues

- Persistent hard cluster remains:
  - `mcp-streamable-http-endpoint`
  - `mcp-tool-registrations`
  - `config-env-loading-dotenv`
  - `retriever-default-excludes`
- Symptom: these queries stay at `recall@3=0` even after multiple QC-only ranking interventions.
- Signal observed: candidate pool for hard queries was often too small (`pass2_candidates` low before no-cap test).

### Approaches tested (QC-only, no production behavior changes)

1. Group-level hard priors (`prefer_paths`) in runner.
2. Query-derived anchor pre-sort (no `target_files` leakage).
3. 2-pass candidate expansion:
   - pass1 semantic default
   - pass2 anchor-focused (`path_glob` + `prefer_paths`)
4. `qc_no_cap` flag to disable `maxPerFile=2` in pass2.
5. Hard query rerank rules by path/phrase signals for the 4 hardest queries.

### Achieved

- Proved candidate bottleneck is real:
  - For hard mcp queries, pass2 candidates increased significantly when `qc_no_cap=true` (e.g. `2 -> 18`).
- Improved global upper-bound modestly in several QC-only variants:
  - small uplift on overall `recall@3` / `MRR` in some runs.
- Established instrumentation to inspect internal retrieval stages:
  - `qc_pass1_candidates`, `qc_pass2_candidates`, `qc_prefer_paths`, `qc_query_anchors`, `qc_anchor_path_glob`.

### Not achieved

- The 4 hardest queries still did not cross `recall@3 > 0` under prior QC-only rerank attempts.
- Strong oracle-style gains from target-file-leaked ranking were not reproducible under no-leak constraints.
- llm-mode latency remained high/unstable in several reruns.

### Next highest-value experiment (implemented now)

- Add a QC-only direct lexical retrieval side-channel (ripgrep-based over `path_glob` + `must_keywords`),
- merge lexical candidates with semantic candidates before scoring,
- evaluate as a **hybrid upper bound** to estimate practical ceiling before changing production retriever.

## QC-only Hybrid Upper Bound run (semantic + direct lexical side-channel)

Implementation summary (QC runner only):
- Added direct lexical side-channel via `rg` over `path_glob` + `must_keywords`/query-derived tokens.
- Merged side-channel candidates with semantic pass1+pass2 candidates before QC scoring.
- Kept all changes in `src/qc/ragQcRunner.ts` (no production retriever behavior change).

Infra note:
- Added `ripgrep` to Docker image so QC runner inside container can execute `rg`.

Latest run artifacts:
- off (hybrid): `docs/qc/artifacts/2026-03-27T16-52-17-106Z-qc-artifacts.json`
- previous off reference: `docs/qc/artifacts/2026-03-27T16-44-20-247Z-qc-artifacts.json`

Result (off vs previous off):
- `recall@3`: **0.537 -> 0.597** (\(\Delta +0.060\))
- `MRR`: **0.497 -> 0.536** (\(\Delta +0.039\))

Hard-query status (off):
- `mcp-streamable-http-endpoint`: recall@3 **0 -> 1**
- `mcp-tool-registrations`: recall@3 **0 -> 1**
- `config-env-loading-dotenv`: recall@3 **0 -> 1**
- `retriever-default-excludes`: recall@3 **0 -> 1**

LLM rerank note:
- Current llm rerun for this exact hybrid variant was unstable in this session (MCP request timeout in runner), so the verified delta above is from the `off` run.

## Production candidate rollout (safe, opt-in)

Patch set shipped for production-candidate path:
- `search_code.filters.hybrid_mode` supports `off | lexical` (default off).
- Env flags:
  - `RETRIEVAL_HYBRID_ENABLED=false` (default)
  - `RETRIEVAL_HYBRID_LEXICAL_LIMIT=12` (default)
- Debug telemetry in `search_code` explanations:
  - `hybridEnabled`, `hybridMode`, `hybridLexicalLimit`
  - `lexicalCandidates`, `mergedCandidates`, `hybridLatencyMs`

Guarded rollout rule:
1. Start with per-call opt-in (`hybrid_mode=lexical`) on target groups only.
2. Keep global env OFF during validation.
3. Promote to broader rollout only if A/B is stable across >=2 runs and p95 remains inside budget.

