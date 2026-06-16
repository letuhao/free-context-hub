---
tag: phase-17-baseline-v7-bug3-fix-code
commit: 3dcfadb
branch: phase-16-sprint-16.1-gen-eval-dataset
run_at: 2026-06-16T09:36:20.996Z
elapsed_ms: 1403026
project_id_primary: free-context-hub
---

# RAG Baseline — phase-17-baseline-v7-bug3-fix-code

## Gen-eval manifest

- **answerer:** `mistralai/mistral-nemo-instruct-2407` @ `http://localhost:1234/v1` (temp=0.2, seed=42, max_tokens=1024)
- **judge:** `mistralai/mistral-nemo-instruct-2407` @ `http://host.docker.internal:1234/v1` (temp=0, seed=42)
- **judge prompts hash:** `c0165a73c10c4e04`
- **synthesizer template hashes:**
  - lessons: `fecb8c98312650a9`
  - code: `92380026b28cfa8f`
  - chunks: `e7870818e5b8cd8b`
  - global: `900e082ca7899d45`

## Summary (all surfaces)

| Surface | Project | Q | err | recall@5 | recall@10 | MRR | nDCG@5 | nDCG@10 | dup@10 | dup@10 nearsem | cov% | p50 ms | p95 ms |
|---|---|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|
| code | free-context-hub | 77 | 0 | 0.4675 | 0.6494 | 0.3935 | 0.3872 | 0.4477 | 0 | 0 | 0.6494 | 1955 | 3928 |

## Gen-eval summary (per surface)

| Surface | rows w/ gt | rows judged | faithfulness | answer_relevancy | context_precision | context_recall | refusal_correctness | groundedness_self_eval |
|---|---:|---:|---:|---:|---:|---:|---:|---:|
| code | 77 | 77 | 0.51 ±0.31 (63 fail) | 0.69 ±0.31 (49 fail) | 0.18 ±0.32 (69 fail) | 0.37 ±0.32 (67 fail) | 0.00 ±0.00 (2 fail) | 0.76 ±0.16 (57 fail) |

_Thresholds (WARN-only): faithfulness ≥ 0.9 · answer_relevancy ≥ 0.85 · context_precision ≥ 0.8 · context_recall ≥ 0.75 · refusal_correctness ≥ 0.75 · groundedness_self_eval ≥ 0.85_

### Gen-eval threshold violations

**code** (77):
  - `auth-workspace-token-validate` — faithfulness<0.9, context_precision<0.8, context_recall<0.75, groundedness_self_eval<0.85
  - `mcp-streamable-http-endpoint` — faithfulness<0.9, context_precision<0.8, context_recall<0.75
  - `index-project-main-pipeline` — faithfulness<0.9, answer_relevancy<0.85, context_precision<0.8, context_recall<0.75, groundedness_self_eval<0.85
  - `ignore-rules-loading` — faithfulness<0.9, answer_relevancy<0.85, context_precision<0.8, context_recall<0.75, groundedness_self_eval<0.85
  - `embedding-request-shape` — faithfulness<0.9, answer_relevancy<0.85, context_precision<0.8, context_recall<0.75, groundedness_self_eval<0.85
  - _(+72 more)_


## code — per-query detail

| id | group | found@ | friction | p50 ms |
|---|---|---|---|---:|
| auth-workspace-token-validate | mcp-auth | 1 | clean | 2539 |
| mcp-streamable-http-endpoint | mcp-server | 8 | rank-order-inversion | 279 |
| index-project-main-pipeline | indexing | 6 | rank-order-inversion | 3150 |
| ignore-rules-loading | indexing | 1 | clean | 92 |
| embedding-request-shape | embeddings | — | no-relevant-hit | 2357 |
| project-snapshot-rebuild | snapshots | 1,3 | clean | 85 |
| kg-bootstrap | kg | 2,5 | clean | 81 |
| kg-upsert-from-indexer | kg | 1 | clean | 87 |
| kg-ts-morph-extractor | kg | 9 | rank-order-inversion | 3768 |
| kg-query-tools | kg | — | no-relevant-hit | 3856 |
| lessons-storage-and-search | lessons | 9 | rank-order-inversion | 1955 |
| guardrails-check | guardrails | 1,4 | clean | 2076 |
| git-ingest-core | git | 7 | rank-order-inversion | 3041 |
| git-deleted-files-handling | git | 2 | clean | 89 |
| git-proposal-upsert-idempotent | git | 6,7 | rank-order-inversion | 2772 |
| repo-source-config | sources | 2 | clean | 82 |
| prepare-repo-clone-fetch-checkout | sources | 10 | rank-order-inversion | 2365 |
| s3-source-artifacts | sources | 1 | clean | 89 |
| job-queue-postgres-claim | queue | 1 | clean | 85 |
| job-queue-rabbitmq | queue | 1,4 | clean | 2723 |
| job-executor-dispatch | queue | 1 | clean | 3230 |
| workspace-scan-porcelain | workspace | 1 | clean | 3928 |
| env-schema-queue-s3 | config | 3 | clean | 82 |
| migrations-git-intelligence | db | — | no-relevant-hit | 80 |
| migrations-sources-jobs | db | — | no-relevant-hit | 2526 |
| tool-output-formatting | mcp-server | 6 | rank-order-inversion | 3218 |
| output-format-parser-smoke | mcp-server | — | no-relevant-hit | 3678 |
| env-boolean-parser | config | 1 | clean | 86 |
| mcp-tool-registrations | mcp-server | — | no-relevant-hit | 92 |
| db-migrations-apply | db | 1 | clean | 72 |
| db-pool-singleton | db | 1 | clean | 98 |
| guardrails-storage | guardrails | 1 | clean | 79 |
| lessons-distillation-enabled | lessons | 1,4 | clean | 86 |
| distiller-commit-suggestion-schema | distillation | 1 | clean | 78 |
| job-correlation-filter | queue | 2 | clean | 3789 |
| rabbitmq-queue-assert-bind | queue | — | no-relevant-hit | 3343 |
| worker-rabbitmq-consumer | queue | 1 | clean | 2784 |
| worker-fallback-postgres-polling | queue | 6 | rank-order-inversion | 81 |
| repo-sync-fanout | queue | 4 | rank-order-inversion | 3848 |
| project-sources-schema | sources | — | no-relevant-hit | 2733 |
| workspace-deltas-schema | workspace | — | no-relevant-hit | 3991 |
| scan-workspace-delta-index | workspace | 7 | rank-order-inversion | 2178 |
| delete-workspace-cascades | storage | — | no-relevant-hit | 2927 |
| kg-ids-deterministic | kg | — | no-relevant-hit | 2550 |
| kg-linker-lessons | kg | 1 | clean | 91 |
| kg-project-graph-delete | kg | 3 | clean | 91 |
| git-impact-analysis | git | 5 | rank-order-inversion | 3279 |
| git-link-commit-to-lesson | git | 8 | rank-order-inversion | 2939 |
| git-proposal-sanitization | git | — | no-relevant-hit | 4042 |
| mcp-health-endpoint | mcp-server | — | no-relevant-hit | 84 |
| mcp-output-format-default | mcp-server | — | no-relevant-hit | 2361 |
| config-default-project-id | config | 2,3 | clean | 2729 |
| config-env-loading-dotenv | config | 1 | clean | 85 |
| config-embeddings-base-url | embeddings | 1 | clean | 3296 |
| config-embeddings-api-key | embeddings | 10 | rank-order-inversion | 77 |
| config-distillation-enabled | distillation | 1 | clean | 83 |
| config-kg-enabled | kg | 2,5 | clean | 64 |
| auth-tool-wrapper | mcp-auth | 4 | rank-order-inversion | 3276 |
| auth-workspace-token-env | mcp-auth | — | no-relevant-hit | 85 |
| indexer-chunk-size-config | indexing | — | no-relevant-hit | 2790 |
| retriever-search-code-boosts | retrieval | 6 | rank-order-inversion | 3595 |
| retriever-default-excludes | retrieval | — | no-relevant-hit | 3239 |
| queue-backend-selection | queue | 1,2 | clean | 81 |
| queue-job-types | queue | 1,3 | clean | 79 |
| smoke-queue-tools-block | smoke | 2 | clean | 3938 |
| ci-phase5-worker-validation-workflow | ci | — | no-relevant-hit | 3891 |
| ci-mock-embeddings-server | ci | — | no-relevant-hit | 77 |
| code-edge-multi-hop-1 | edge-multi-hop | 7 | rank-order-inversion | 3530 |
| code-edge-no-answer-1 | edge-no-answer | — | — | 2851 |
| code-edge-no-answer-2 | edge-no-answer | — | — | 78 |
| code-edge-contradictory-1 | edge-contradictory | — | no-relevant-hit | 79 |
| code-edge-contradictory-2 | edge-contradictory | — | no-relevant-hit | 86 |
| code-edge-paraphrase-1 | edge-paraphrase | — | no-relevant-hit | 77 |
| code-edge-paraphrase-2 | edge-paraphrase | — | no-relevant-hit | 79 |
| code-edge-distractor-1 | edge-distractor | 2 | clean | 95 |
| code-edge-distractor-2 | edge-distractor | — | no-relevant-hit | 77 |
| code-edge-distractor-3 | edge-distractor | — | no-relevant-hit | 79 |

## Friction observed (top examples)

_(showing up to 3 per surface; 42 total queries have flagged friction across all surfaces)_

- **code/mcp-streamable-http-endpoint** — rank-order-inversion: query `Where is the MCP HTTP endpoint implemented and what routes are exposed?`; top-3 keys=[src/qc/integrationTestRunner.ts, src/mcp/index.ts, src/qc/ragQcRunner.ts]
- **code/index-project-main-pipeline** — rank-order-inversion: query `How does index_project discover files, chunk them, embed, and write to Postgres?`; top-3 keys=[packages/mcp-client/src/index.ts, src/env.ts, gui/src/app/documents/chunk-search-panel.tsx]
- **code/embedding-request-shape** — no-relevant-hit: query `How does the embeddings client call /v1/embeddings and validate dimensions?`; top-3 keys=[packages/mcp-client/src/rest-client.ts, src/qc/seedExact100.ts, src/qc/seedSessionLessons.ts]

## Known limitations

- Latency varies ±10–20% across runs; quality metrics are deterministic.
- Global surface uses REST /api/search/global (ILIKE, not semantic); recall floor comes from raw substring matching.
- Code surface requires an indexed `chunks` population; empty index → 0 coverage regardless of query quality.
- `duplication_rate_at_10` v0 keys on exact entity id. Same-title-different-UUID noise (the original Phase-12 motivation: multiple lesson rows titled "Global search test retry pattern") is invisible to v0 — a reader seeing `dup@10 = 0` should NOT conclude "no duplication"; see `snippet-redundancy` in `docs/qc/friction-classes.md`.
- Golden-set ceiling bias: lesson queries are paraphrases of lesson content, and target ids were cherry-picked from recently-active lessons. Reported `recall@10 = 1.0` may reflect "queries are easy" rather than "retriever is strong." Sprint 12.1 should add adversarial queries (synonyms, typos, indirect references) to distinguish real improvement from noise.
