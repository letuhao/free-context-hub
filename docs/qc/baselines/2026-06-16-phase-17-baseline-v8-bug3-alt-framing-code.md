---
tag: phase-17-baseline-v8-bug3-alt-framing-code
commit: 4a5c322
branch: phase-16-sprint-16.1-gen-eval-dataset
run_at: 2026-06-16T10:43:52.258Z
elapsed_ms: 1354771
project_id_primary: free-context-hub
---

# RAG Baseline — phase-17-baseline-v8-bug3-alt-framing-code

## Gen-eval manifest

- **answerer:** `mistralai/mistral-nemo-instruct-2407` @ `http://localhost:1234/v1` (temp=0.2, seed=42, max_tokens=1024)
- **judge:** `mistralai/mistral-nemo-instruct-2407` @ `http://host.docker.internal:1234/v1` (temp=0, seed=42)
- **judge prompts hash:** `c0165a73c10c4e04`
- **synthesizer template hashes:**
  - lessons: `12d937d2dd93cdee`
  - code: `fa3d064302e85cd4`
  - chunks: `4684749e32568cec`
  - global: `bbfc552fbd293364`

## Summary (all surfaces)

| Surface | Project | Q | err | recall@5 | recall@10 | MRR | nDCG@5 | nDCG@10 | dup@10 | dup@10 nearsem | cov% | p50 ms | p95 ms |
|---|---|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|
| code | free-context-hub | 77 | 0 | 0.5325 | 0.6494 | 0.419 | 0.4305 | 0.4665 | 0 | 0 | 0.6494 | 2042 | 3883 |

## Gen-eval summary (per surface)

| Surface | rows w/ gt | rows judged | faithfulness | answer_relevancy | context_precision | context_recall | refusal_correctness | groundedness_self_eval |
|---|---:|---:|---:|---:|---:|---:|---:|---:|
| code | 77 | 77 | 0.48 ±0.32 (64 fail) | 0.73 ±0.29 (44 fail) | 0.19 ±0.33 (69 fail) | 0.37 ±0.32 (65 fail) | 0.00 ±0.00 (2 fail) | 0.77 ±0.14 (57 fail) |

_Thresholds (WARN-only): faithfulness ≥ 0.9 · answer_relevancy ≥ 0.85 · context_precision ≥ 0.8 · context_recall ≥ 0.75 · refusal_correctness ≥ 0.75 · groundedness_self_eval ≥ 0.85_

### Gen-eval threshold violations

**code** (77):
  - `auth-workspace-token-validate` — faithfulness<0.9, answer_relevancy<0.85, context_precision<0.8, context_recall<0.75, groundedness_self_eval<0.85
  - `mcp-streamable-http-endpoint` — faithfulness<0.9, context_precision<0.8, context_recall<0.75, groundedness_self_eval<0.85
  - `index-project-main-pipeline` — faithfulness<0.9, answer_relevancy<0.85, context_precision<0.8, context_recall<0.75, groundedness_self_eval<0.85
  - `ignore-rules-loading` — faithfulness<0.9, context_precision<0.8, context_recall<0.75, groundedness_self_eval<0.85
  - `embedding-request-shape` — faithfulness<0.9, context_precision<0.8, context_recall<0.75, groundedness_self_eval<0.85
  - _(+72 more)_


## code — per-query detail

| id | group | found@ | friction | p50 ms |
|---|---|---|---|---:|
| auth-workspace-token-validate | mcp-auth | — | no-relevant-hit | 2399 |
| mcp-streamable-http-endpoint | mcp-server | 8 | rank-order-inversion | 101 |
| index-project-main-pipeline | indexing | 6 | rank-order-inversion | 3303 |
| ignore-rules-loading | indexing | 1 | clean | 93 |
| embedding-request-shape | embeddings | — | no-relevant-hit | 2401 |
| project-snapshot-rebuild | snapshots | 1,3 | clean | 86 |
| kg-bootstrap | kg | 2,5 | clean | 108 |
| kg-upsert-from-indexer | kg | 1 | clean | 87 |
| kg-ts-morph-extractor | kg | 1 | clean | 3883 |
| kg-query-tools | kg | — | no-relevant-hit | 3869 |
| lessons-storage-and-search | lessons | 10 | rank-order-inversion | 2042 |
| guardrails-check | guardrails | 2,3 | clean | 2067 |
| git-ingest-core | git | 6 | rank-order-inversion | 3174 |
| git-deleted-files-handling | git | 2 | clean | 93 |
| git-proposal-upsert-idempotent | git | 1,7 | clean | 2771 |
| repo-source-config | sources | 2 | clean | 91 |
| prepare-repo-clone-fetch-checkout | sources | 3 | clean | 2600 |
| s3-source-artifacts | sources | 1 | clean | 77 |
| job-queue-postgres-claim | queue | 1 | clean | 85 |
| job-queue-rabbitmq | queue | 1,4 | clean | 2449 |
| job-executor-dispatch | queue | 1 | clean | 3238 |
| workspace-scan-porcelain | workspace | 1 | clean | 3893 |
| env-schema-queue-s3 | config | 3 | clean | 82 |
| migrations-git-intelligence | db | — | no-relevant-hit | 82 |
| migrations-sources-jobs | db | — | no-relevant-hit | 2473 |
| tool-output-formatting | mcp-server | 5 | rank-order-inversion | 3268 |
| output-format-parser-smoke | mcp-server | — | no-relevant-hit | 3907 |
| env-boolean-parser | config | 1 | clean | 86 |
| mcp-tool-registrations | mcp-server | — | no-relevant-hit | 95 |
| db-migrations-apply | db | 1 | clean | 102 |
| db-pool-singleton | db | 1 | clean | 81 |
| guardrails-storage | guardrails | 1 | clean | 84 |
| lessons-distillation-enabled | lessons | 1,4 | clean | 89 |
| distiller-commit-suggestion-schema | distillation | 1 | clean | 78 |
| job-correlation-filter | queue | 3 | clean | 3821 |
| rabbitmq-queue-assert-bind | queue | — | no-relevant-hit | 3531 |
| worker-rabbitmq-consumer | queue | 1 | clean | 2803 |
| worker-fallback-postgres-polling | queue | 6 | rank-order-inversion | 114 |
| repo-sync-fanout | queue | 5 | rank-order-inversion | 3672 |
| project-sources-schema | sources | — | no-relevant-hit | 2787 |
| workspace-deltas-schema | workspace | — | no-relevant-hit | 4009 |
| scan-workspace-delta-index | workspace | 5 | rank-order-inversion | 2165 |
| delete-workspace-cascades | storage | 2 | clean | 2714 |
| kg-ids-deterministic | kg | — | no-relevant-hit | 2353 |
| kg-linker-lessons | kg | 1 | clean | 95 |
| kg-project-graph-delete | kg | 3 | clean | 81 |
| git-impact-analysis | git | 7 | rank-order-inversion | 3178 |
| git-link-commit-to-lesson | git | 6 | rank-order-inversion | 2802 |
| git-proposal-sanitization | git | — | no-relevant-hit | 3757 |
| mcp-health-endpoint | mcp-server | — | no-relevant-hit | 81 |
| mcp-output-format-default | mcp-server | — | no-relevant-hit | 2451 |
| config-default-project-id | config | 1 | clean | 2752 |
| config-env-loading-dotenv | config | 1 | clean | 86 |
| config-embeddings-base-url | embeddings | 1 | clean | 3430 |
| config-embeddings-api-key | embeddings | 10 | rank-order-inversion | 79 |
| config-distillation-enabled | distillation | 1 | clean | 81 |
| config-kg-enabled | kg | 2,5 | clean | 74 |
| auth-tool-wrapper | mcp-auth | 3 | clean | 3175 |
| auth-workspace-token-env | mcp-auth | — | no-relevant-hit | 76 |
| indexer-chunk-size-config | indexing | — | no-relevant-hit | 2909 |
| retriever-search-code-boosts | retrieval | 4 | rank-order-inversion | 3443 |
| retriever-default-excludes | retrieval | — | no-relevant-hit | 3178 |
| queue-backend-selection | queue | 1,2 | clean | 80 |
| queue-job-types | queue | 1,3 | clean | 73 |
| smoke-queue-tools-block | smoke | 1 | clean | 3870 |
| ci-phase5-worker-validation-workflow | ci | — | no-relevant-hit | 3867 |
| ci-mock-embeddings-server | ci | — | no-relevant-hit | 80 |
| code-edge-multi-hop-1 | edge-multi-hop | 9 | rank-order-inversion | 3438 |
| code-edge-no-answer-1 | edge-no-answer | — | — | 2804 |
| code-edge-no-answer-2 | edge-no-answer | — | — | 71 |
| code-edge-contradictory-1 | edge-contradictory | — | no-relevant-hit | 63 |
| code-edge-contradictory-2 | edge-contradictory | — | no-relevant-hit | 85 |
| code-edge-paraphrase-1 | edge-paraphrase | — | no-relevant-hit | 73 |
| code-edge-paraphrase-2 | edge-paraphrase | — | no-relevant-hit | 77 |
| code-edge-distractor-1 | edge-distractor | 2 | clean | 81 |
| code-edge-distractor-2 | edge-distractor | — | no-relevant-hit | 77 |
| code-edge-distractor-3 | edge-distractor | — | no-relevant-hit | 76 |

## Friction observed (top examples)

_(showing up to 3 per surface; 38 total queries have flagged friction across all surfaces)_

- **code/auth-workspace-token-validate** — no-relevant-hit: query `Where is workspace_token validated for MCP tool calls?`; top-3 keys=[src/mcp/index.ts, src/smoke/phase5WorkerValidation.ts, src/mcp/formatters.ts]
- **code/mcp-streamable-http-endpoint** — rank-order-inversion: query `Where is the MCP HTTP endpoint implemented and what routes are exposed?`; top-3 keys=[src/qc/integrationTestRunner.ts, src/mcp/index.ts, src/qc/ragQcRunner.ts]
- **code/index-project-main-pipeline** — rank-order-inversion: query `How does index_project discover files, chunk them, embed, and write to Postgres?`; top-3 keys=[packages/mcp-client/src/index.ts, src/env.ts, gui/src/app/documents/chunk-search-panel.tsx]

## Known limitations

- Latency varies ±10–20% across runs; quality metrics are deterministic.
- Global surface uses REST /api/search/global (ILIKE, not semantic); recall floor comes from raw substring matching.
- Code surface requires an indexed `chunks` population; empty index → 0 coverage regardless of query quality.
- `duplication_rate_at_10` v0 keys on exact entity id. Same-title-different-UUID noise (the original Phase-12 motivation: multiple lesson rows titled "Global search test retry pattern") is invisible to v0 — a reader seeing `dup@10 = 0` should NOT conclude "no duplication"; see `snippet-redundancy` in `docs/qc/friction-classes.md`.
- Golden-set ceiling bias: lesson queries are paraphrases of lesson content, and target ids were cherry-picked from recently-active lessons. Reported `recall@10 = 1.0` may reflect "queries are easy" rather than "retriever is strong." Sprint 12.1 should add adversarial queries (synonyms, typos, indirect references) to distinguish real improvement from noise.
