---
tag: phase-14-bge-m3-nemotron
commit: 677e08c+dirty
branch: phase-13-dlf-coordination
run_at: 2026-05-14T17:48:35.845Z
elapsed_ms: 1057661
project_id_primary: free-context-hub
---

# RAG Baseline — phase-14-bge-m3-nemotron

## Summary (all surfaces)

| Surface | Project | Q | err | recall@5 | recall@10 | MRR | nDCG@5 | nDCG@10 | dup@10 | dup@10 nearsem | cov% | p50 ms | p95 ms |
|---|---|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|
| lessons | free-context-hub | 40 | 1 | 0.9189 | 0.9459 | 0.9088 | 0.895 | 0.8974 | 0 | 0 | 0.9459 | 6458 | 6504 |
| code | free-context-hub | 67 | 0 | 0.5821 | 0.7612 | 0.4516 | 0.461 | 0.518 | 0 | 0 | 0.7612 | 1516 | 2532 |
| chunks | free-context-hub | 10 | 0 | 1 | 1 | 0.9167 | 0.943 | 0.9479 | 0 | 0 | 1 | 38 | 52 |
| global | free-context-hub | 10 | 0 | 0.7778 | 0.7778 | 0.4352 | 0.5214 | 0.5214 | 0 | 0.13 | 0.7778 | 7 | 10 |

## lessons — per-query detail

| id | group | found@ | friction | p50 ms |
|---|---|---|---|---:|
| lesson-pg-uuid-casing | confident-hit | 1 | clean | 6462 |
| lesson-undici-version-pinning | confident-hit | 1 | clean | 6477 |
| lesson-pyenv-python3-shim | confident-hit | 1 | clean | 6461 |
| lesson-npm-test-silent-skip | confident-hit | 1 | clean | 6452 |
| lesson-api-lessons-items-shape | confident-hit | 1 | clean | 6449 |
| lesson-review-impl-default | confident-hit | 1 | clean | 6457 |
| lesson-noproject-guard-hydration | confident-hit | 1 | clean | 6442 |
| lesson-project-crud-validation | confident-hit | 1 | clean | 6461 |
| lesson-multi-project-color | confident-hit | 1 | clean | 6456 |
| lesson-code-review-workflow-pref | confident-hit | 1 | clean | 6454 |
| lesson-dup-max-retry-guardrail | duplicate-trap | 1,2,3,4,5 | clean | 6453 |
| lesson-dup-global-search-retry-pattern | duplicate-trap | 1,2 | clean | 6449 |
| lesson-dup-valid-impexp-fixture | duplicate-trap | 1,2,3,4,5 | clean | 6458 |
| lesson-miss-unicorn | adversarial-miss | — | — | 6465 |
| lesson-miss-astrophysics | adversarial-miss | — | — | 6474 |
| lesson-miss-falconry | adversarial-miss | — | — | 6456 |
| lesson-cross-integration-test-backoff | cross-topic | 1,2,6,7,8,9 | clean | 6452 |
| lesson-cross-sprint-11-closeout | cross-topic | — | no-relevant-hit | 6461 |
| lesson-cross-workflow-gate | cross-topic | 8,9,10 | rank-order-inversion | 6443 |
| lesson-cross-agent-bootstrap-e2e | cross-topic | 1,2 | clean | 6462 |
| lesson-ambig-measurement-methodology | ambiguous-multi-target | — | retrieval-error;empty-result-set;no-relevant-hit | 6481 |
| lesson-ambig-dedup-key-design | ambiguous-multi-target | 1,2,3,4 | clean | 6531 |
| lesson-ambig-review-impl-default | ambiguous-multi-target | 1,2 | clean | 6486 |
| lesson-ambig-popularity-feedback | ambiguous-multi-target | 1,3 | clean | 6476 |
| lesson-ambig-baseline-drift | ambiguous-multi-target | 1,3 | clean | 6452 |
| lesson-ambig-numeric-edge-cases | ambiguous-multi-target | 2 | clean | 6451 |
| lesson-ambig-test-infra-async | ambiguous-multi-target | 1,2,3 | clean | 6455 |
| lesson-ambig-noise-floor | ambiguous-multi-target | 1,2,7 | clean | 6465 |
| lesson-ambig-downstream-propagation | ambiguous-multi-target | 1,3 | clean | 6447 |
| lesson-ambig-fire-and-forget-pool | ambiguous-multi-target | 1,3 | clean | 6457 |
| lesson-ambig-multi-project-isolation | ambiguous-multi-target | 1,3,10 | clean | 6454 |
| lesson-ambig-composite-relevance | ambiguous-multi-target | 1,2 | clean | 6458 |
| lesson-ambig-content-empty-dedup | ambiguous-multi-target | 1,3,5 | clean | 6449 |
| lesson-ambig-recency-frequency-retrieval | ambiguous-multi-target | 1,2 | clean | 6469 |
| lesson-ambig-dedup-e2e-testing | ambiguous-multi-target | 1,2 | clean | 6485 |
| lesson-para-pg-map-miss | semantic-paraphrase | 1 | clean | 6478 |
| lesson-para-undici-node-mismatch | semantic-paraphrase | 1 | clean | 6480 |
| lesson-para-nan-defensive-math | semantic-paraphrase | 1 | clean | 6458 |
| lesson-para-new-test-not-running | semantic-paraphrase | 1 | clean | 6451 |
| lesson-para-windows-python-newlines | semantic-paraphrase | 1 | clean | 6458 |

## code — per-query detail

| id | group | found@ | friction | p50 ms |
|---|---|---|---|---:|
| auth-workspace-token-validate | mcp-auth | 4,7 | rank-order-inversion | 1601 |
| mcp-streamable-http-endpoint | mcp-server | 8 | rank-order-inversion | 80 |
| index-project-main-pipeline | indexing | 7 | rank-order-inversion | 2062 |
| ignore-rules-loading | indexing | 1 | clean | 71 |
| embedding-request-shape | embeddings | — | no-relevant-hit | 1591 |
| project-snapshot-rebuild | snapshots | 1,3,5 | clean | 75 |
| kg-bootstrap | kg | 2,5 | clean | 67 |
| kg-upsert-from-indexer | kg | 1 | clean | 56 |
| kg-ts-morph-extractor | kg | 1 | clean | 2493 |
| kg-query-tools | kg | — | no-relevant-hit | 2491 |
| lessons-storage-and-search | lessons | 8 | rank-order-inversion | 1306 |
| guardrails-check | guardrails | 3,8 | clean | 1348 |
| git-ingest-core | git | 7 | rank-order-inversion | 2028 |
| git-deleted-files-handling | git | 2 | clean | 67 |
| git-proposal-upsert-idempotent | git | 2,8 | clean | 1867 |
| repo-source-config | sources | 2 | clean | 65 |
| prepare-repo-clone-fetch-checkout | sources | 3 | clean | 1636 |
| s3-source-artifacts | sources | 1 | clean | 66 |
| job-queue-postgres-claim | queue | 1 | clean | 65 |
| job-queue-rabbitmq | queue | 1,5 | clean | 1619 |
| job-executor-dispatch | queue | 1 | clean | 2060 |
| workspace-scan-porcelain | workspace | 1 | clean | 2543 |
| env-schema-queue-s3 | config | 3 | clean | 63 |
| migrations-git-intelligence | db | — | no-relevant-hit | 62 |
| migrations-sources-jobs | db | — | no-relevant-hit | 1639 |
| tool-output-formatting | mcp-server | 8 | rank-order-inversion | 2147 |
| output-format-parser-smoke | mcp-server | — | no-relevant-hit | 2545 |
| env-boolean-parser | config | 1 | clean | 60 |
| mcp-tool-registrations | mcp-server | — | no-relevant-hit | 63 |
| db-migrations-apply | db | 1 | clean | 49 |
| db-pool-singleton | db | 1 | clean | 52 |
| guardrails-storage | guardrails | 1 | clean | 50 |
| lessons-distillation-enabled | lessons | 1,4 | clean | 54 |
| distiller-commit-suggestion-schema | distillation | 1 | clean | 54 |
| job-correlation-filter | queue | 7 | rank-order-inversion | 2532 |
| rabbitmq-queue-assert-bind | queue | 2 | clean | 2183 |
| worker-rabbitmq-consumer | queue | 1 | clean | 1890 |
| worker-fallback-postgres-polling | queue | 6 | rank-order-inversion | 60 |
| repo-sync-fanout | queue | 10 | rank-order-inversion | 2431 |
| project-sources-schema | sources | — | no-relevant-hit | 1746 |
| workspace-deltas-schema | workspace | — | no-relevant-hit | 2469 |
| scan-workspace-delta-index | workspace | 7 | rank-order-inversion | 1295 |
| delete-workspace-cascades | storage | — | no-relevant-hit | 1793 |
| kg-ids-deterministic | kg | 3 | clean | 1555 |
| kg-linker-lessons | kg | 1 | clean | 73 |
| kg-project-graph-delete | kg | 3 | clean | 53 |
| git-impact-analysis | git | 10 | rank-order-inversion | 2002 |
| git-link-commit-to-lesson | git | 7 | rank-order-inversion | 1826 |
| git-proposal-sanitization | git | — | no-relevant-hit | 2392 |
| mcp-health-endpoint | mcp-server | — | no-relevant-hit | 66 |
| mcp-output-format-default | mcp-server | — | no-relevant-hit | 1550 |
| config-default-project-id | config | 3,4 | clean | 1803 |
| config-env-loading-dotenv | config | 1 | clean | 62 |
| config-embeddings-base-url | embeddings | 2 | clean | 2227 |
| config-embeddings-api-key | embeddings | 10 | rank-order-inversion | 62 |
| config-distillation-enabled | distillation | 1 | clean | 59 |
| config-kg-enabled | kg | 2,5 | clean | 68 |
| auth-tool-wrapper | mcp-auth | 5 | rank-order-inversion | 1973 |
| auth-workspace-token-env | mcp-auth | — | no-relevant-hit | 65 |
| indexer-chunk-size-config | indexing | — | no-relevant-hit | 1896 |
| retriever-search-code-boosts | retrieval | 1 | clean | 2247 |
| retriever-default-excludes | retrieval | 4 | rank-order-inversion | 2021 |
| queue-backend-selection | queue | 1,2 | clean | 68 |
| queue-job-types | queue | 1,3 | clean | 55 |
| smoke-queue-tools-block | smoke | 2 | clean | 2378 |
| ci-phase5-worker-validation-workflow | ci | — | no-relevant-hit | 2429 |
| ci-mock-embeddings-server | ci | — | no-relevant-hit | 72 |

## chunks — per-query detail

| id | group | found@ | friction | p50 ms |
|---|---|---|---|---:|
| chunk-retry-strategy-overview | confident-hit | 1 | clean | 52 |
| chunk-retry-config-table | confident-hit | 1 | clean | 47 |
| chunk-retry-implementation-code | confident-hit | 1 | clean | 37 |
| chunk-authentication-overview | confident-hit | 1 | clean | 37 |
| chunk-role-definitions | confident-hit | 1 | clean | 37 |
| chunk-data-storage-pgvector | confident-hit | 1 | clean | 38 |
| chunk-adr-intro-dup | duplicate-trap | 1,2 | clean | 35 |
| chunk-cross-retry-auth-storage | cross-topic | 3,5,6 | clean | 40 |
| chunk-miss-quantum | adversarial-miss | — | — | 37 |
| chunk-miss-jazz | adversarial-miss | — | — | 38 |

## global — per-query detail

| id | group | found@ | friction | p50 ms |
|---|---|---|---|---:|
| global-retry-substr | confident-hit | 3 | clean | 10 |
| global-validation-substr | confident-hit | 4 | rank-order-inversion | 8 |
| global-authentication-substr | confident-hit | 1 | clean | 7 |
| global-max-retry-substr | confident-hit | 2 | clean | 8 |
| global-architecture-substr | confident-hit | 1,2 | clean | 8 |
| global-pgvector-substr | confident-hit | 2 | clean | 7 |
| global-review-impl-substr | confident-hit | — | no-relevant-hit | 7 |
| global-undici-substr | confident-hit | 3 | clean | 7 |
| global-workspace-substr | coverage-probe | — | — | 7 |
| global-miss-zephyr | adversarial-miss | — | empty-result-set | 7 |

## Friction observed (top examples)

_(showing up to 3 per surface; 37 total queries have flagged friction across all surfaces)_

- **lessons/lesson-cross-sprint-11-closeout** — no-relevant-hit: query `sprint 11.6c-sec DNS pinning body-stall timeout security polish`; top-3 keys=[a0792c20-305b-4640-b6c7-befffcf5c3e1, e87cd142-9fc3-4ef9-868f-11ed3e7577bf, a6a3a11d-00e8-4b7e-83f5-18d3c24b73a7]
- **lessons/lesson-cross-workflow-gate** — rank-order-inversion: query `workflow gate state machine 12-phase workflow v2.2`; top-3 keys=[3ab6adbf-2c0e-4274-95a4-f2683d55cefb, a6a3a11d-00e8-4b7e-83f5-18d3c24b73a7, d081e672-e52e-41c8-a939-bbc08a87b253]
- **lessons/lesson-ambig-measurement-methodology** — retrieval-error; empty-result-set; no-relevant-hit: query `how do we measure RAG ranking changes rigorously`; top-3 keys=[]
- **code/auth-workspace-token-validate** — rank-order-inversion: query `Where is workspace_token validated for MCP tool calls?`; top-3 keys=[src/mcp/index.ts, src/smoke/phase5WorkerValidation.ts, src/env.ts]
- **code/mcp-streamable-http-endpoint** — rank-order-inversion: query `Where is the MCP HTTP endpoint implemented and what routes are exposed?`; top-3 keys=[src/qc/integrationTestRunner.ts, src/mcp/index.ts, src/qc/ragQcRunner.ts]
- **code/index-project-main-pipeline** — rank-order-inversion: query `How does index_project discover files, chunk them, embed, and write to Postgres?`; top-3 keys=[packages/mcp-client/src/index.ts, src/utils/resolveProjectRoot.ts, src/worker.ts]
- **global/global-validation-substr** — rank-order-inversion: query `validation`; top-3 keys=[lesson:c38a3ad5-6fe6-49c8-ae30-658ea7ed2113, lesson:898c3ce8-80a6-4a63-9359-9deaf495633d, lesson:4e28d4bc-5d6e-47c7-bda5-7b2dfb761736]
- **global/global-review-impl-substr** — no-relevant-hit: query `review-impl`; top-3 keys=[lesson:9875a2ee-fd66-4b05-9693-d7c41e366e94, lesson:ecf4aaf9-f36e-4dc3-bbac-4730e8e0dca5, lesson:500404f1-4284-442f-a8f5-960f6b3caca4]
- **global/global-miss-zephyr** — empty-result-set: query `zephyr-ninja-pyramid-2026`; top-3 keys=[]

## Known limitations

- Latency varies ±10–20% across runs; quality metrics are deterministic.
- Global surface uses REST /api/search/global (ILIKE, not semantic); recall floor comes from raw substring matching.
- Code surface requires an indexed `chunks` population; empty index → 0 coverage regardless of query quality.
- `duplication_rate_at_10` v0 keys on exact entity id. Same-title-different-UUID noise (the original Phase-12 motivation: multiple lesson rows titled "Global search test retry pattern") is invisible to v0 — a reader seeing `dup@10 = 0` should NOT conclude "no duplication"; see `snippet-redundancy` in `docs/qc/friction-classes.md`.
- Golden-set ceiling bias: lesson queries are paraphrases of lesson content, and target ids were cherry-picked from recently-active lessons. Reported `recall@10 = 1.0` may reflect "queries are easy" rather than "retriever is strong." Sprint 12.1 should add adversarial queries (synonyms, typos, indirect references) to distinguish real improvement from noise.
