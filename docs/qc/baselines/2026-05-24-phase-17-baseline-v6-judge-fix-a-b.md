---
tag: phase-17-baseline-v6-judge-fix-a-b
commit: 6d9ca41+dirty
branch: phase-16-sprint-16.1-gen-eval-dataset
run_at: 2026-05-24T17:49:32.597Z
elapsed_ms: 2447426
project_id_primary: free-context-hub
---

# RAG Baseline — phase-17-baseline-v6-judge-fix-a-b

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
| lessons | free-context-hub | 48 | 0 | 0.8889 | 0.8889 | 0.7593 | 0.7845 | 0.7784 | 0 | 0 | 0.8889 | 1218 | 2603 |
| code | free-context-hub | 77 | 0 | 0.4935 | 0.6234 | 0.3818 | 0.3939 | 0.4336 | 0 | 0 | 0.6234 | 2194 | 4303 |
| chunks | free-context-hub | 13 | 0 | 0.9091 | 0.9091 | 0.8485 | 0.8498 | 0.8534 | 0 | 0 | 0.9091 | 55 | 66 |
| global | free-context-hub | 14 | 0 | 0.4615 | 0.5385 | 0.2906 | 0.3278 | 0.351 | 0 | 0.15 | 0.5385 | 23 | 24 |

## Gen-eval summary (per surface)

| Surface | rows w/ gt | rows judged | faithfulness | answer_relevancy | context_precision | context_recall | refusal_correctness | groundedness_self_eval |
|---|---:|---:|---:|---:|---:|---:|---:|---:|
| lessons | 48 | 48 | 0.66 ±0.29 (31 fail) | 0.77 ±0.18 (29 fail) | 0.54 ±0.44 (26 fail) | 0.55 ±0.32 (33 fail) | 0.88 ±0.22 (1 fail) | 0.82 ±0.16 (28 fail) |
| code | 77 | 77 | 0.50 ±0.29 (67 fail) | 0.65 ±0.33 (54 fail) | 0.18 ±0.33 (69 fail) | 0.36 ±0.30 (68 fail) | 0.25 ±0.25 (2 fail) | 0.77 ±0.16 (55 fail) |
| chunks | 13 | 13 | 0.91 ±0.12 (4 fail) | 0.75 ±0.16 (8 fail) | 0.74 ±0.41 (4 fail) | 0.36 ±0.39 (10 fail) | 0.83 ±0.24 (1 fail) | 0.95 ±0.11 (2 fail) |
| global | 14 | 10 | 0.49 ±0.22 (9 fail) | 0.54 ±0.12 (9 fail) | 0.18 ±0.32 (9 fail) | 0.42 ±0.40 (6 fail) | 0.50 ±0.00 (1 fail) | 0.82 ±0.15 (6 fail) |

_Thresholds (WARN-only): faithfulness ≥ 0.9 · answer_relevancy ≥ 0.85 · context_precision ≥ 0.8 · context_recall ≥ 0.75 · refusal_correctness ≥ 0.75 · groundedness_self_eval ≥ 0.85_

### Gen-eval threshold violations

**lessons** (48):
  - `lesson-pg-uuid-casing` — faithfulness<0.9, answer_relevancy<0.85, context_precision<0.8, context_recall<0.75
  - `lesson-undici-version-pinning` — faithfulness<0.9, answer_relevancy<0.85
  - `lesson-pyenv-python3-shim` — faithfulness<0.9, answer_relevancy<0.85, context_recall<0.75
  - `lesson-npm-test-silent-skip` — answer_relevancy<0.85, context_recall<0.75
  - `lesson-api-lessons-items-shape` — faithfulness<0.9, context_recall<0.75
  - _(+43 more)_

**code** (77):
  - `auth-workspace-token-validate` — faithfulness<0.9, context_precision<0.8, context_recall<0.75, groundedness_self_eval<0.85
  - `mcp-streamable-http-endpoint` — faithfulness<0.9, answer_relevancy<0.85, context_precision<0.8, context_recall<0.75, groundedness_self_eval<0.85
  - `index-project-main-pipeline` — faithfulness<0.9, answer_relevancy<0.85, context_precision<0.8, context_recall<0.75, groundedness_self_eval<0.85
  - `ignore-rules-loading` — faithfulness<0.9, answer_relevancy<0.85, context_precision<0.8, context_recall<0.75, groundedness_self_eval<0.85
  - `embedding-request-shape` — faithfulness<0.9, answer_relevancy<0.85, context_precision<0.8, context_recall<0.75, groundedness_self_eval<0.85
  - _(+72 more)_

**chunks** (13):
  - `chunk-retry-strategy-overview` — faithfulness<0.9, context_recall<0.75
  - `chunk-retry-config-table` — answer_relevancy<0.85, context_recall<0.75
  - `chunk-retry-implementation-code` — faithfulness<0.9, answer_relevancy<0.85, groundedness_self_eval<0.85
  - `chunk-authentication-overview` — faithfulness<0.9, answer_relevancy<0.85, context_recall<0.75
  - `chunk-role-definitions` — answer_relevancy<0.85
  - _(+8 more)_

**global** (10):
  - `global-retry-substr` — faithfulness<0.9, answer_relevancy<0.85, context_precision<0.8, groundedness_self_eval<0.85
  - `global-validation-substr` — faithfulness<0.9, answer_relevancy<0.85, context_precision<0.8, context_recall<0.75
  - `global-authentication-substr` — faithfulness<0.9, answer_relevancy<0.85
  - `global-max-retry-substr` — faithfulness<0.9, answer_relevancy<0.85, context_precision<0.8, context_recall<0.75, groundedness_self_eval<0.85
  - `global-architecture-substr` — faithfulness<0.9, answer_relevancy<0.85, context_precision<0.8, context_recall<0.75
  - _(+5 more)_


## lessons — per-query detail

| id | group | found@ | friction | p50 ms |
|---|---|---|---|---:|
| lesson-pg-uuid-casing | confident-hit | 1 | clean | 824 |
| lesson-undici-version-pinning | confident-hit | 1 | clean | 1656 |
| lesson-pyenv-python3-shim | confident-hit | 1 | clean | 2671 |
| lesson-npm-test-silent-skip | confident-hit | 1 | clean | 828 |
| lesson-api-lessons-items-shape | confident-hit | 1 | clean | 1555 |
| lesson-review-impl-default | confident-hit | 1 | clean | 867 |
| lesson-noproject-guard-hydration | confident-hit | 1 | clean | 850 |
| lesson-project-crud-validation | confident-hit | 1 | clean | 1502 |
| lesson-multi-project-color | confident-hit | 1 | clean | 1465 |
| lesson-code-review-workflow-pref | confident-hit | 1 | clean | 1227 |
| lesson-dup-max-retry-guardrail | duplicate-trap | 1,2,3,4,5 | clean | 1306 |
| lesson-dup-global-search-retry-pattern | duplicate-trap | 1,2 | clean | 978 |
| lesson-dup-valid-impexp-fixture | duplicate-trap | 1,2,3,5,7 | clean | 1183 |
| lesson-miss-unicorn | adversarial-miss | — | — | 1226 |
| lesson-miss-astrophysics | adversarial-miss | — | — | 761 |
| lesson-miss-falconry | adversarial-miss | — | — | 787 |
| lesson-cross-integration-test-backoff | cross-topic | 1,3,7,9,10 | clean | 948 |
| lesson-cross-sprint-11-closeout | cross-topic | — | no-relevant-hit | 1167 |
| lesson-cross-workflow-gate | cross-topic | — | no-relevant-hit | 1150 |
| lesson-cross-agent-bootstrap-e2e | cross-topic | 1,4 | clean | 1176 |
| lesson-ambig-measurement-methodology | ambiguous-multi-target | 2,3,10 | clean | 1175 |
| lesson-ambig-dedup-key-design | ambiguous-multi-target | 1,2,3,4 | clean | 4217 |
| lesson-ambig-review-impl-default | ambiguous-multi-target | 1,3 | clean | 2106 |
| lesson-ambig-popularity-feedback | ambiguous-multi-target | 1 | clean | 1801 |
| lesson-ambig-baseline-drift | ambiguous-multi-target | 3,5 | clean | 1301 |
| lesson-ambig-numeric-edge-cases | ambiguous-multi-target | 2 | clean | 2603 |
| lesson-ambig-test-infra-async | ambiguous-multi-target | 3,4,7 | clean | 1150 |
| lesson-ambig-noise-floor | ambiguous-multi-target | 1,3,8 | clean | 1224 |
| lesson-ambig-downstream-propagation | ambiguous-multi-target | 2 | clean | 2191 |
| lesson-ambig-fire-and-forget-pool | ambiguous-multi-target | 2,3 | clean | 1500 |
| lesson-ambig-multi-project-isolation | ambiguous-multi-target | 2,7 | clean | 2498 |
| lesson-ambig-composite-relevance | ambiguous-multi-target | 1,2 | clean | 2575 |
| lesson-ambig-content-empty-dedup | ambiguous-multi-target | 1,3 | clean | 1066 |
| lesson-ambig-recency-frequency-retrieval | ambiguous-multi-target | 1 | clean | 1906 |
| lesson-ambig-dedup-e2e-testing | ambiguous-multi-target | 1,4 | clean | 1583 |
| lesson-para-pg-map-miss | semantic-paraphrase | 1 | clean | 822 |
| lesson-para-undici-node-mismatch | semantic-paraphrase | 4 | rank-order-inversion | 1177 |
| lesson-para-nan-defensive-math | semantic-paraphrase | 2 | clean | 1469 |
| lesson-para-new-test-not-running | semantic-paraphrase | 4 | rank-order-inversion | 1080 |
| lesson-para-windows-python-newlines | semantic-paraphrase | 1 | clean | 1047 |
| lesson-edge-multi-hop-1 | edge-multi-hop | — | no-relevant-hit | 728 |
| lesson-edge-multi-hop-2 | edge-multi-hop | 1,2,9 | clean | 2009 |
| lesson-edge-no-answer-1 | edge-no-answer | — | — | 1679 |
| lesson-edge-contradictory-1 | edge-contradictory | 1 | clean | 1088 |
| lesson-edge-contradictory-2 | edge-contradictory | — | no-relevant-hit | 1218 |
| lesson-edge-paraphrase-1 | edge-paraphrase | 1 | clean | 776 |
| lesson-edge-paraphrase-2 | edge-paraphrase | 1 | clean | 1176 |
| lesson-edge-distractor-1 | edge-distractor | 1 | clean | 2433 |

## code — per-query detail

| id | group | found@ | friction | p50 ms |
|---|---|---|---|---:|
| auth-workspace-token-validate | mcp-auth | 1 | clean | 2683 |
| mcp-streamable-http-endpoint | mcp-server | 8 | rank-order-inversion | 106 |
| index-project-main-pipeline | indexing | 8 | rank-order-inversion | 3465 |
| ignore-rules-loading | indexing | 1 | clean | 89 |
| embedding-request-shape | embeddings | — | no-relevant-hit | 2654 |
| project-snapshot-rebuild | snapshots | 1,3,5 | clean | 112 |
| kg-bootstrap | kg | 2,5 | clean | 86 |
| kg-upsert-from-indexer | kg | 1 | clean | 78 |
| kg-ts-morph-extractor | kg | — | no-relevant-hit | 4306 |
| kg-query-tools | kg | — | no-relevant-hit | 4182 |
| lessons-storage-and-search | lessons | 8 | rank-order-inversion | 2226 |
| guardrails-check | guardrails | 3,5 | clean | 2194 |
| git-ingest-core | git | 8 | rank-order-inversion | 3418 |
| git-deleted-files-handling | git | 2 | clean | 91 |
| git-proposal-upsert-idempotent | git | 5,6 | rank-order-inversion | 3194 |
| repo-source-config | sources | 2 | clean | 83 |
| prepare-repo-clone-fetch-checkout | sources | — | no-relevant-hit | 2666 |
| s3-source-artifacts | sources | 1 | clean | 83 |
| job-queue-postgres-claim | queue | 1 | clean | 96 |
| job-queue-rabbitmq | queue | 1,6 | clean | 2658 |
| job-executor-dispatch | queue | 1 | clean | 3491 |
| workspace-scan-porcelain | workspace | 1 | clean | 4313 |
| env-schema-queue-s3 | config | 3 | clean | 89 |
| migrations-git-intelligence | db | — | no-relevant-hit | 96 |
| migrations-sources-jobs | db | — | no-relevant-hit | 2693 |
| tool-output-formatting | mcp-server | 7 | rank-order-inversion | 3397 |
| output-format-parser-smoke | mcp-server | — | no-relevant-hit | 4173 |
| env-boolean-parser | config | 1 | clean | 92 |
| mcp-tool-registrations | mcp-server | — | no-relevant-hit | 88 |
| db-migrations-apply | db | 1 | clean | 79 |
| db-pool-singleton | db | 1 | clean | 81 |
| guardrails-storage | guardrails | 1 | clean | 85 |
| lessons-distillation-enabled | lessons | 1,4 | clean | 88 |
| distiller-commit-suggestion-schema | distillation | 1 | clean | 77 |
| job-correlation-filter | queue | 5 | rank-order-inversion | 4146 |
| rabbitmq-queue-assert-bind | queue | — | no-relevant-hit | 3738 |
| worker-rabbitmq-consumer | queue | 1 | clean | 3082 |
| worker-fallback-postgres-polling | queue | 6 | rank-order-inversion | 79 |
| repo-sync-fanout | queue | 3 | clean | 4103 |
| project-sources-schema | sources | — | no-relevant-hit | 3043 |
| workspace-deltas-schema | workspace | — | no-relevant-hit | 4316 |
| scan-workspace-delta-index | workspace | 4 | rank-order-inversion | 2273 |
| delete-workspace-cascades | storage | — | no-relevant-hit | 3053 |
| kg-ids-deterministic | kg | 3 | clean | 2704 |
| kg-linker-lessons | kg | 1 | clean | 93 |
| kg-project-graph-delete | kg | 3 | clean | 82 |
| git-impact-analysis | git | 7 | rank-order-inversion | 3423 |
| git-link-commit-to-lesson | git | 10 | rank-order-inversion | 3175 |
| git-proposal-sanitization | git | — | no-relevant-hit | 4303 |
| mcp-health-endpoint | mcp-server | — | no-relevant-hit | 85 |
| mcp-output-format-default | mcp-server | — | no-relevant-hit | 2560 |
| config-default-project-id | config | 2 | clean | 3038 |
| config-env-loading-dotenv | config | 1 | clean | 82 |
| config-embeddings-base-url | embeddings | 1 | clean | 3790 |
| config-embeddings-api-key | embeddings | 10 | rank-order-inversion | 82 |
| config-distillation-enabled | distillation | 1 | clean | 80 |
| config-kg-enabled | kg | 2,5 | clean | 88 |
| auth-tool-wrapper | mcp-auth | 3 | clean | 3463 |
| auth-workspace-token-env | mcp-auth | — | no-relevant-hit | 80 |
| indexer-chunk-size-config | indexing | — | no-relevant-hit | 3017 |
| retriever-search-code-boosts | retrieval | 10 | rank-order-inversion | 3801 |
| retriever-default-excludes | retrieval | — | no-relevant-hit | 3444 |
| queue-backend-selection | queue | 1,2 | clean | 81 |
| queue-job-types | queue | 1,3 | clean | 80 |
| smoke-queue-tools-block | smoke | 2 | clean | 4089 |
| ci-phase5-worker-validation-workflow | ci | — | no-relevant-hit | 4279 |
| ci-mock-embeddings-server | ci | — | no-relevant-hit | 81 |
| code-edge-multi-hop-1 | edge-multi-hop | — | no-relevant-hit | 3787 |
| code-edge-no-answer-1 | edge-no-answer | — | — | 3178 |
| code-edge-no-answer-2 | edge-no-answer | — | — | 90 |
| code-edge-contradictory-1 | edge-contradictory | — | no-relevant-hit | 75 |
| code-edge-contradictory-2 | edge-contradictory | — | no-relevant-hit | 92 |
| code-edge-paraphrase-1 | edge-paraphrase | — | no-relevant-hit | 82 |
| code-edge-paraphrase-2 | edge-paraphrase | — | no-relevant-hit | 92 |
| code-edge-distractor-1 | edge-distractor | 2 | clean | 86 |
| code-edge-distractor-2 | edge-distractor | — | no-relevant-hit | 78 |
| code-edge-distractor-3 | edge-distractor | — | no-relevant-hit | 72 |

## chunks — per-query detail

| id | group | found@ | friction | p50 ms |
|---|---|---|---|---:|
| chunk-retry-strategy-overview | confident-hit | 1 | clean | 65 |
| chunk-retry-config-table | confident-hit | 1 | clean | 55 |
| chunk-retry-implementation-code | confident-hit | 1 | clean | 57 |
| chunk-authentication-overview | confident-hit | 1 | clean | 52 |
| chunk-role-definitions | confident-hit | 1 | clean | 66 |
| chunk-data-storage-pgvector | confident-hit | 1 | clean | 54 |
| chunk-adr-intro-dup | duplicate-trap | 1,2 | clean | 56 |
| chunk-cross-retry-auth-storage | cross-topic | 3,5,6 | clean | 54 |
| chunk-miss-quantum | adversarial-miss | — | — | 61 |
| chunk-miss-jazz | adversarial-miss | — | — | 45 |
| chunk-edge-multi-hop-1 | edge-multi-hop | 1,2,4 | clean | 47 |
| chunk-edge-no-answer-1 | edge-no-answer | — | — | 61 |
| chunk-edge-distractor-1 | edge-distractor | 1 | clean | 46 |

## global — per-query detail

| id | group | found@ | friction | p50 ms |
|---|---|---|---|---:|
| global-retry-substr | confident-hit | 3 | clean | 24 |
| global-validation-substr | confident-hit | 9 | rank-order-inversion | 23 |
| global-authentication-substr | confident-hit | 1 | clean | 23 |
| global-max-retry-substr | confident-hit | 2 | clean | 23 |
| global-architecture-substr | confident-hit | 1,2 | clean | 24 |
| global-pgvector-substr | confident-hit | 2 | clean | 24 |
| global-review-impl-substr | confident-hit | — | no-relevant-hit | 24 |
| global-undici-substr | confident-hit | 3 | clean | 23 |
| global-workspace-substr | coverage-probe | — | — | 23 |
| global-miss-zephyr | adversarial-miss | — | empty-result-set | 6 |
| global-edge-multi-hop-1 | edge-multi-hop | — | empty-result-set;no-relevant-hit | 3 |
| global-edge-no-answer-1 | edge-no-answer | — | empty-result-set | 4 |
| global-edge-contradictory-1 | edge-contradictory | — | no-relevant-hit | 4 |
| global-edge-paraphrase-1 | edge-paraphrase | — | empty-result-set;no-relevant-hit | 22 |

## Friction observed (top examples)

_(showing up to 3 per surface; 53 total queries have flagged friction across all surfaces)_

- **lessons/lesson-cross-sprint-11-closeout** — no-relevant-hit: query `sprint 11.6c-sec DNS pinning body-stall timeout security polish`; top-3 keys=[67bc4411-a8b4-4e37-ae62-fa843fe47f67, 96cd0dc1-920c-420e-a703-1d9dca5e4e04, c26217e2-69f0-440e-828c-e1ef9c2481fc]
- **lessons/lesson-cross-workflow-gate** — no-relevant-hit: query `workflow gate state machine 12-phase workflow v2.2`; top-3 keys=[7c632d4b-1486-4b11-910c-5214ad9e2d7d, 45c8cb44-9fb8-4dad-b825-5b1cd8b0a108, 596f210c-5c7b-4c99-a99f-f4bc6a72448f]
- **lessons/lesson-para-undici-node-mismatch** — rank-order-inversion: query `why does swapping http agents between the default and an installed one break str`; top-3 keys=[7c632d4b-1486-4b11-910c-5214ad9e2d7d, 29f1a41f-8c33-49b9-9492-1716bf79512d, d6b8cde5-a965-4cb5-a159-7efa125e4923]
- **code/mcp-streamable-http-endpoint** — rank-order-inversion: query `Where is the MCP HTTP endpoint implemented and what routes are exposed?`; top-3 keys=[src/qc/integrationTestRunner.ts, src/mcp/index.ts, src/qc/ragQcRunner.ts]
- **code/index-project-main-pipeline** — rank-order-inversion: query `How does index_project discover files, chunk them, embed, and write to Postgres?`; top-3 keys=[packages/mcp-client/src/index.ts, services/ragas-judge/bug2_probe.py, src/env.ts]
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
