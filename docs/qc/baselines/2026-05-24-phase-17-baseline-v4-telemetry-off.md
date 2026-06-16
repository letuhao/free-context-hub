---
tag: phase-17-baseline-v4-telemetry-off
commit: 902efba+dirty
branch: phase-16-sprint-16.1-gen-eval-dataset
run_at: 2026-05-24T11:24:31.414Z
elapsed_ms: 2155107
project_id_primary: free-context-hub
---

# RAG Baseline — phase-17-baseline-v4-telemetry-off

## Gen-eval manifest

- **answerer:** `mistralai/mistral-nemo-instruct-2407` @ `http://localhost:1234/v1` (temp=0.2, seed=42, max_tokens=1024)
- **judge:** `mistralai/mistral-nemo-instruct-2407` @ `http://host.docker.internal:1234/v1`
- **judge prompts hash:** `c0165a73c10c4e04`
- **synthesizer template hashes:**
  - lessons: `13ac4e950489bde6`
  - code: `3a2ea1624ae0a1fc`
  - chunks: `a01005e0d102b2c1`
  - global: `5ae7c8e925ad8a47`

## Summary (all surfaces)

| Surface | Project | Q | err | recall@5 | recall@10 | MRR | nDCG@5 | nDCG@10 | dup@10 | dup@10 nearsem | cov% | p50 ms | p95 ms |
|---|---|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|
| lessons | free-context-hub | 48 | 0 | 0.8889 | 0.8889 | 0.75 | 0.7784 | 0.7699 | 0 | 0 | 0.8889 | 1602 | 4851 |
| code | free-context-hub | 77 | 0 | 0.4805 | 0.6494 | 0.362 | 0.3709 | 0.4257 | 0 | 0 | 0.6494 | 2078 | 3804 |
| chunks | free-context-hub | 13 | 0 | 0.9091 | 0.9091 | 0.8485 | 0.8498 | 0.8534 | 0 | 0 | 0.9091 | 56 | 72 |
| global | free-context-hub | 14 | 0 | 0.4615 | 0.5385 | 0.2906 | 0.3278 | 0.351 | 0 | 0.15 | 0.5385 | 23 | 37 |

## Gen-eval summary (per surface)

| Surface | rows w/ gt | rows judged | faithfulness | answer_relevancy | context_precision | context_recall | refusal_correctness | groundedness_self_eval |
|---|---:|---:|---:|---:|---:|---:|---:|---:|
| lessons | 48 | 48 | 0.66 ±0.31 (29 fail) | 0.78 ±0.18 (24 fail) | 0.51 ±0.45 (27 fail) | 0.48 ±0.34 (38 fail) | 1.00 ±0.00 | 0.77 ±0.14 (36 fail) |
| code | 77 | 77 | 0.37 ±0.30 (70 fail) | 0.68 ±0.33 (48 fail) | 0.16 ±0.34 (67 fail) | 0.27 ±0.28 (72 fail) | 0.00 ±0.00 (2 fail) | 0.75 ±0.17 (57 fail) |
| chunks | 13 | 13 | 0.85 ±0.20 (4 fail) | 0.74 ±0.16 (8 fail) | 0.50 ±0.48 (7 fail) | 0.29 ±0.27 (12 fail) | 1.00 ±0.00 | 0.95 ±0.11 (2 fail) |
| global | 14 | 10 | 0.24 ±0.25 (9 fail) | 0.52 ±0.17 (9 fail) | 0.24 ±0.33 (9 fail) | 0.28 ±0.33 (9 fail) | 0.50 ±0.00 (1 fail) | 0.79 ±0.14 (7 fail) |

_Thresholds (WARN-only): faithfulness ≥ 0.9 · answer_relevancy ≥ 0.85 · context_precision ≥ 0.8 · context_recall ≥ 0.75 · refusal_correctness ≥ 0.75 · groundedness_self_eval ≥ 0.85_

### Gen-eval threshold violations

**lessons** (47):
  - `lesson-pg-uuid-casing` — faithfulness<0.9, answer_relevancy<0.85, context_recall<0.75
  - `lesson-undici-version-pinning` — faithfulness<0.9, answer_relevancy<0.85, context_recall<0.75
  - `lesson-pyenv-python3-shim` — answer_relevancy<0.85, context_recall<0.75
  - `lesson-npm-test-silent-skip` — answer_relevancy<0.85, context_recall<0.75
  - `lesson-api-lessons-items-shape` — faithfulness<0.9, context_precision<0.8, context_recall<0.75, groundedness_self_eval<0.85
  - _(+42 more)_

**code** (77):
  - `auth-workspace-token-validate` — faithfulness<0.9, context_precision<0.8, context_recall<0.75, groundedness_self_eval<0.85
  - `mcp-streamable-http-endpoint` — faithfulness<0.9, context_precision<0.8, context_recall<0.75, groundedness_self_eval<0.85
  - `index-project-main-pipeline` — faithfulness<0.9, answer_relevancy<0.85, context_precision<0.8, context_recall<0.75, groundedness_self_eval<0.85
  - `ignore-rules-loading` — faithfulness<0.9, answer_relevancy<0.85, context_precision<0.8, context_recall<0.75
  - `embedding-request-shape` — faithfulness<0.9, context_precision<0.8, context_recall<0.75, groundedness_self_eval<0.85
  - _(+72 more)_

**chunks** (13):
  - `chunk-retry-strategy-overview` — context_precision<0.8, context_recall<0.75
  - `chunk-retry-config-table` — answer_relevancy<0.85, context_precision<0.8, context_recall<0.75
  - `chunk-retry-implementation-code` — answer_relevancy<0.85, context_recall<0.75, groundedness_self_eval<0.85
  - `chunk-authentication-overview` — faithfulness<0.9, answer_relevancy<0.85, context_recall<0.75
  - `chunk-role-definitions` — faithfulness<0.9, answer_relevancy<0.85, groundedness_self_eval<0.85
  - _(+8 more)_

**global** (10):
  - `global-retry-substr` — faithfulness<0.9, answer_relevancy<0.85, context_precision<0.8, context_recall<0.75, groundedness_self_eval<0.85
  - `global-validation-substr` — faithfulness<0.9, answer_relevancy<0.85, context_precision<0.8, context_recall<0.75, groundedness_self_eval<0.85
  - `global-authentication-substr` — faithfulness<0.9, answer_relevancy<0.85
  - `global-max-retry-substr` — faithfulness<0.9, answer_relevancy<0.85, context_precision<0.8, context_recall<0.75, groundedness_self_eval<0.85
  - `global-architecture-substr` — faithfulness<0.9, answer_relevancy<0.85, context_precision<0.8, context_recall<0.75
  - _(+5 more)_


## lessons — per-query detail

| id | group | found@ | friction | p50 ms |
|---|---|---|---|---:|
| lesson-pg-uuid-casing | confident-hit | 1 | clean | 4017 |
| lesson-undici-version-pinning | confident-hit | 1 | clean | 4953 |
| lesson-pyenv-python3-shim | confident-hit | 1 | clean | 4851 |
| lesson-npm-test-silent-skip | confident-hit | 1 | clean | 1413 |
| lesson-api-lessons-items-shape | confident-hit | — | no-relevant-hit | 2190 |
| lesson-review-impl-default | confident-hit | 1 | clean | 5057 |
| lesson-noproject-guard-hydration | confident-hit | 2 | clean | 1694 |
| lesson-project-crud-validation | confident-hit | 1 | clean | 865 |
| lesson-multi-project-color | confident-hit | 1 | clean | 1610 |
| lesson-code-review-workflow-pref | confident-hit | 1 | clean | 1441 |
| lesson-dup-max-retry-guardrail | duplicate-trap | 1,2,3,4,5 | clean | 1757 |
| lesson-dup-global-search-retry-pattern | duplicate-trap | 1,2 | clean | 1539 |
| lesson-dup-valid-impexp-fixture | duplicate-trap | 1,2,3,5,7 | clean | 1170 |
| lesson-miss-unicorn | adversarial-miss | — | — | 1629 |
| lesson-miss-astrophysics | adversarial-miss | — | — | 750 |
| lesson-miss-falconry | adversarial-miss | — | — | 774 |
| lesson-cross-integration-test-backoff | cross-topic | 1,6,9,10 | clean | 1359 |
| lesson-cross-sprint-11-closeout | cross-topic | — | no-relevant-hit | 1432 |
| lesson-cross-workflow-gate | cross-topic | 3,6 | clean | 2705 |
| lesson-cross-agent-bootstrap-e2e | cross-topic | 1,2 | clean | 2460 |
| lesson-ambig-measurement-methodology | ambiguous-multi-target | 2,3,10 | clean | 1568 |
| lesson-ambig-dedup-key-design | ambiguous-multi-target | 1,2,3,4 | clean | 1738 |
| lesson-ambig-review-impl-default | ambiguous-multi-target | 1,3 | clean | 2097 |
| lesson-ambig-popularity-feedback | ambiguous-multi-target | 1,3 | clean | 2807 |
| lesson-ambig-baseline-drift | ambiguous-multi-target | 3 | clean | 2275 |
| lesson-ambig-numeric-edge-cases | ambiguous-multi-target | 2 | clean | 2747 |
| lesson-ambig-test-infra-async | ambiguous-multi-target | 2,3,5 | clean | 1508 |
| lesson-ambig-noise-floor | ambiguous-multi-target | 1,2,8 | clean | 1570 |
| lesson-ambig-downstream-propagation | ambiguous-multi-target | 2 | clean | 2045 |
| lesson-ambig-fire-and-forget-pool | ambiguous-multi-target | 1,2 | clean | 1556 |
| lesson-ambig-multi-project-isolation | ambiguous-multi-target | 2,7 | clean | 2858 |
| lesson-ambig-composite-relevance | ambiguous-multi-target | 2 | clean | 2785 |
| lesson-ambig-content-empty-dedup | ambiguous-multi-target | 1,3 | clean | 1676 |
| lesson-ambig-recency-frequency-retrieval | ambiguous-multi-target | 1 | clean | 2877 |
| lesson-ambig-dedup-e2e-testing | ambiguous-multi-target | 1,2 | clean | 1272 |
| lesson-para-pg-map-miss | semantic-paraphrase | 1 | clean | 1566 |
| lesson-para-undici-node-mismatch | semantic-paraphrase | 4 | rank-order-inversion | 1554 |
| lesson-para-nan-defensive-math | semantic-paraphrase | 1 | clean | 1602 |
| lesson-para-new-test-not-running | semantic-paraphrase | 3 | clean | 1570 |
| lesson-para-windows-python-newlines | semantic-paraphrase | 1 | clean | 1455 |
| lesson-edge-multi-hop-1 | edge-multi-hop | — | no-relevant-hit | 1554 |
| lesson-edge-multi-hop-2 | edge-multi-hop | 1,2 | clean | 2927 |
| lesson-edge-no-answer-1 | edge-no-answer | — | — | 1192 |
| lesson-edge-contradictory-1 | edge-contradictory | 1 | clean | 1098 |
| lesson-edge-contradictory-2 | edge-contradictory | — | no-relevant-hit | 1712 |
| lesson-edge-paraphrase-1 | edge-paraphrase | 1 | clean | 1489 |
| lesson-edge-paraphrase-2 | edge-paraphrase | 1 | clean | 1521 |
| lesson-edge-distractor-1 | edge-distractor | 1 | clean | 2691 |

## code — per-query detail

| id | group | found@ | friction | p50 ms |
|---|---|---|---|---:|
| auth-workspace-token-validate | mcp-auth | 3 | clean | 2224 |
| mcp-streamable-http-endpoint | mcp-server | 8 | rank-order-inversion | 205 |
| index-project-main-pipeline | indexing | 10 | rank-order-inversion | 3078 |
| ignore-rules-loading | indexing | 1 | clean | 78 |
| embedding-request-shape | embeddings | — | no-relevant-hit | 2238 |
| project-snapshot-rebuild | snapshots | 1,3,5 | clean | 86 |
| kg-bootstrap | kg | 2,5 | clean | 94 |
| kg-upsert-from-indexer | kg | 1 | clean | 93 |
| kg-ts-morph-extractor | kg | 7 | rank-order-inversion | 3949 |
| kg-query-tools | kg | — | no-relevant-hit | 3772 |
| lessons-storage-and-search | lessons | 9 | rank-order-inversion | 2127 |
| guardrails-check | guardrails | 2,7 | clean | 2130 |
| git-ingest-core | git | 4 | rank-order-inversion | 3397 |
| git-deleted-files-handling | git | 2 | clean | 89 |
| git-proposal-upsert-idempotent | git | 7,8 | rank-order-inversion | 2708 |
| repo-source-config | sources | 2 | clean | 83 |
| prepare-repo-clone-fetch-checkout | sources | 2 | clean | 2237 |
| s3-source-artifacts | sources | 1 | clean | 85 |
| job-queue-postgres-claim | queue | 1 | clean | 86 |
| job-queue-rabbitmq | queue | 2,6 | clean | 2285 |
| job-executor-dispatch | queue | 10 | rank-order-inversion | 2860 |
| workspace-scan-porcelain | workspace | 1 | clean | 3429 |
| env-schema-queue-s3 | config | 3 | clean | 90 |
| migrations-git-intelligence | db | — | no-relevant-hit | 83 |
| migrations-sources-jobs | db | — | no-relevant-hit | 2312 |
| tool-output-formatting | mcp-server | 6 | rank-order-inversion | 2856 |
| output-format-parser-smoke | mcp-server | — | no-relevant-hit | 3606 |
| env-boolean-parser | config | 1 | clean | 85 |
| mcp-tool-registrations | mcp-server | — | no-relevant-hit | 83 |
| db-migrations-apply | db | 1 | clean | 83 |
| db-pool-singleton | db | 1 | clean | 85 |
| guardrails-storage | guardrails | 1 | clean | 92 |
| lessons-distillation-enabled | lessons | 1,4 | clean | 71 |
| distiller-commit-suggestion-schema | distillation | 1 | clean | 79 |
| job-correlation-filter | queue | 3 | clean | 3788 |
| rabbitmq-queue-assert-bind | queue | — | no-relevant-hit | 3519 |
| worker-rabbitmq-consumer | queue | 1 | clean | 2666 |
| worker-fallback-postgres-polling | queue | 6 | rank-order-inversion | 86 |
| repo-sync-fanout | queue | 3 | clean | 3704 |
| project-sources-schema | sources | — | no-relevant-hit | 2711 |
| workspace-deltas-schema | workspace | — | no-relevant-hit | 3852 |
| scan-workspace-delta-index | workspace | 6 | rank-order-inversion | 2078 |
| delete-workspace-cascades | storage | — | no-relevant-hit | 2632 |
| kg-ids-deterministic | kg | — | no-relevant-hit | 2231 |
| kg-linker-lessons | kg | 1 | clean | 85 |
| kg-project-graph-delete | kg | 3 | clean | 84 |
| git-impact-analysis | git | 6 | rank-order-inversion | 2880 |
| git-link-commit-to-lesson | git | 8 | rank-order-inversion | 2695 |
| git-proposal-sanitization | git | — | no-relevant-hit | 4227 |
| mcp-health-endpoint | mcp-server | — | no-relevant-hit | 86 |
| mcp-output-format-default | mcp-server | — | no-relevant-hit | 2182 |
| config-default-project-id | config | 2 | clean | 2528 |
| config-env-loading-dotenv | config | 1 | clean | 102 |
| config-embeddings-base-url | embeddings | — | no-relevant-hit | 3424 |
| config-embeddings-api-key | embeddings | 10 | rank-order-inversion | 77 |
| config-distillation-enabled | distillation | 1 | clean | 85 |
| config-kg-enabled | kg | 2,5 | clean | 67 |
| auth-tool-wrapper | mcp-auth | 2 | clean | 3046 |
| auth-workspace-token-env | mcp-auth | — | no-relevant-hit | 75 |
| indexer-chunk-size-config | indexing | — | no-relevant-hit | 2841 |
| retriever-search-code-boosts | retrieval | 5 | rank-order-inversion | 3506 |
| retriever-default-excludes | retrieval | 2 | clean | 3160 |
| queue-backend-selection | queue | 1,2 | clean | 74 |
| queue-job-types | queue | 1,3 | clean | 76 |
| smoke-queue-tools-block | smoke | 2 | clean | 3794 |
| ci-phase5-worker-validation-workflow | ci | — | no-relevant-hit | 3804 |
| ci-mock-embeddings-server | ci | — | no-relevant-hit | 75 |
| code-edge-multi-hop-1 | edge-multi-hop | 7 | rank-order-inversion | 3375 |
| code-edge-no-answer-1 | edge-no-answer | — | — | 2832 |
| code-edge-no-answer-2 | edge-no-answer | — | — | 62 |
| code-edge-contradictory-1 | edge-contradictory | — | no-relevant-hit | 61 |
| code-edge-contradictory-2 | edge-contradictory | — | no-relevant-hit | 81 |
| code-edge-paraphrase-1 | edge-paraphrase | — | no-relevant-hit | 75 |
| code-edge-paraphrase-2 | edge-paraphrase | — | no-relevant-hit | 74 |
| code-edge-distractor-1 | edge-distractor | 2 | clean | 85 |
| code-edge-distractor-2 | edge-distractor | — | no-relevant-hit | 82 |
| code-edge-distractor-3 | edge-distractor | — | no-relevant-hit | 82 |

## chunks — per-query detail

| id | group | found@ | friction | p50 ms |
|---|---|---|---|---:|
| chunk-retry-strategy-overview | confident-hit | 1 | clean | 72 |
| chunk-retry-config-table | confident-hit | 1 | clean | 57 |
| chunk-retry-implementation-code | confident-hit | 1 | clean | 54 |
| chunk-authentication-overview | confident-hit | 1 | clean | 56 |
| chunk-role-definitions | confident-hit | 1 | clean | 56 |
| chunk-data-storage-pgvector | confident-hit | 1 | clean | 56 |
| chunk-adr-intro-dup | duplicate-trap | 1,2 | clean | 47 |
| chunk-cross-retry-auth-storage | cross-topic | 3,5,6 | clean | 56 |
| chunk-miss-quantum | adversarial-miss | — | — | 58 |
| chunk-miss-jazz | adversarial-miss | — | — | 46 |
| chunk-edge-multi-hop-1 | edge-multi-hop | 1,2,4 | clean | 48 |
| chunk-edge-no-answer-1 | edge-no-answer | — | — | 59 |
| chunk-edge-distractor-1 | edge-distractor | 1 | clean | 47 |

## global — per-query detail

| id | group | found@ | friction | p50 ms |
|---|---|---|---|---:|
| global-retry-substr | confident-hit | 3 | clean | 37 |
| global-validation-substr | confident-hit | 9 | rank-order-inversion | 25 |
| global-authentication-substr | confident-hit | 1 | clean | 22 |
| global-max-retry-substr | confident-hit | 2 | clean | 24 |
| global-architecture-substr | confident-hit | 1,2 | clean | 25 |
| global-pgvector-substr | confident-hit | 2 | clean | 23 |
| global-review-impl-substr | confident-hit | — | no-relevant-hit | 24 |
| global-undici-substr | confident-hit | 3 | clean | 24 |
| global-workspace-substr | coverage-probe | — | — | 23 |
| global-miss-zephyr | adversarial-miss | — | empty-result-set | 7 |
| global-edge-multi-hop-1 | edge-multi-hop | — | empty-result-set;no-relevant-hit | 4 |
| global-edge-no-answer-1 | edge-no-answer | — | empty-result-set | 4 |
| global-edge-contradictory-1 | edge-contradictory | — | no-relevant-hit | 4 |
| global-edge-paraphrase-1 | edge-paraphrase | — | empty-result-set;no-relevant-hit | 26 |

## Friction observed (top examples)

_(showing up to 3 per surface; 52 total queries have flagged friction across all surfaces)_

- **lessons/lesson-api-lessons-items-shape** — no-relevant-hit: query `GET /api/lessons response shape uses items not lessons`; top-3 keys=[a688cb2c-3ed5-4fdd-ad07-0a8f5f4f5d6c, 67bc4411-a8b4-4e37-ae62-fa843fe47f67, c0e76a3d-cf5c-456a-b064-8731f3f62bc7]
- **lessons/lesson-cross-sprint-11-closeout** — no-relevant-hit: query `sprint 11.6c-sec DNS pinning body-stall timeout security polish`; top-3 keys=[4a1e3c16-b9fa-46fe-bd94-c99c5ec32b44, 5c0b7b25-4a93-4961-bf64-e0c967438b24, 96cd0dc1-920c-420e-a703-1d9dca5e4e04]
- **lessons/lesson-para-undici-node-mismatch** — rank-order-inversion: query `why does swapping http agents between the default and an installed one break str`; top-3 keys=[7c632d4b-1486-4b11-910c-5214ad9e2d7d, bb39fe5e-0345-4b98-976b-fe3b0743f169, a2763aed-b84e-4ad8-9ba7-5d37be9bbbc0]
- **code/mcp-streamable-http-endpoint** — rank-order-inversion: query `Where is the MCP HTTP endpoint implemented and what routes are exposed?`; top-3 keys=[src/qc/integrationTestRunner.ts, src/mcp/index.ts, src/qc/ragQcRunner.ts]
- **code/index-project-main-pipeline** — rank-order-inversion: query `How does index_project discover files, chunk them, embed, and write to Postgres?`; top-3 keys=[src/mcp/index.ts, src/env.ts, packages/mcp-client/src/index.ts]
- **code/embedding-request-shape** — no-relevant-hit: query `How does the embeddings client call /v1/embeddings and validate dimensions?`; top-3 keys=[packages/mcp-client/src/rest-client.ts, src/qc/seedExact100.ts, src/qc/seedSessionLessons.ts]
- **global/global-validation-substr** — rank-order-inversion: query `validation`; top-3 keys=[lesson:61835c5d-d5c8-4d61-9fa0-3497aadee229, lesson:476aeed0-8363-4630-bd07-faf0edc573ba, lesson:44e38b7e-0ef9-4b0f-9754-d5dcc09f4e4d]
- **global/global-review-impl-substr** — no-relevant-hit: query `review-impl`; top-3 keys=[lesson:7c632d4b-1486-4b11-910c-5214ad9e2d7d, guardrail:5287a774-5761-412f-a150-31db7f2b3880, lesson:f47de748-7a78-44e9-af6f-ef3f7a324004]
- **global/global-miss-zephyr** — empty-result-set: query `zephyr-ninja-pyramid-2026`; top-3 keys=[]

## Known limitations

- Latency varies ±10–20% across runs; quality metrics are deterministic.
- Global surface uses REST /api/search/global (ILIKE, not semantic); recall floor comes from raw substring matching.
- Code surface requires an indexed `chunks` population; empty index → 0 coverage regardless of query quality.
- `duplication_rate_at_10` v0 keys on exact entity id. Same-title-different-UUID noise (the original Phase-12 motivation: multiple lesson rows titled "Global search test retry pattern") is invisible to v0 — a reader seeing `dup@10 = 0` should NOT conclude "no duplication"; see `snippet-redundancy` in `docs/qc/friction-classes.md`.
- Golden-set ceiling bias: lesson queries are paraphrases of lesson content, and target ids were cherry-picked from recently-active lessons. Reported `recall@10 = 1.0` may reflect "queries are easy" rather than "retriever is strong." Sprint 12.1 should add adversarial queries (synonyms, typos, indirect references) to distinguish real improvement from noise.
