---
tag: phase-17-baseline-v5-topk-5
commit: 6d9ca41+dirty
branch: phase-16-sprint-16.1-gen-eval-dataset
run_at: 2026-05-24T12:16:46.448Z
elapsed_ms: 2356831
project_id_primary: free-context-hub
---

# RAG Baseline — phase-17-baseline-v5-topk-5

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
| lessons | free-context-hub | 48 | 0 | 0.8667 | 0.8889 | 0.7226 | 0.7558 | 0.7565 | 0 | 0 | 0.8889 | 1197 | 2478 |
| code | free-context-hub | 77 | 0 | 0.4935 | 0.5714 | 0.3746 | 0.3922 | 0.4167 | 0 | 0 | 0.5714 | 1952 | 3691 |
| chunks | free-context-hub | 13 | 0 | 0.9091 | 0.9091 | 0.8485 | 0.8498 | 0.8534 | 0 | 0 | 0.9091 | 52 | 60 |
| global | free-context-hub | 14 | 0 | 0.4615 | 0.5385 | 0.2906 | 0.3278 | 0.351 | 0 | 0.15 | 0.5385 | 22 | 24 |

## Gen-eval summary (per surface)

| Surface | rows w/ gt | rows judged | faithfulness | answer_relevancy | context_precision | context_recall | refusal_correctness | groundedness_self_eval |
|---|---:|---:|---:|---:|---:|---:|---:|---:|
| lessons | 48 | 48 | 0.65 ±0.28 (31 fail) | 0.80 ±0.13 (24 fail) | 0.53 ±0.44 (27 fail) | 0.50 ±0.33 (37 fail) | 0.50 ±0.50 (2 fail) | 0.80 ±0.15 (31 fail) |
| code | 77 | 77 | 0.42 ±0.29 (71 fail) | 0.66 ±0.33 (48 fail) | 0.14 ±0.31 (70 fail) | 0.27 ±0.31 (70 fail) | 0.00 ±0.00 (2 fail) | 0.73 ±0.15 (63 fail) |
| chunks | 13 | 13 | 0.89 ±0.12 (5 fail) | 0.76 ±0.16 (8 fail) | 0.53 ±0.49 (6 fail) | 0.25 ±0.29 (13 fail) | 0.83 ±0.24 (1 fail) | 0.95 ±0.11 (2 fail) |
| global | 14 | 10 | 0.40 ±0.31 (8 fail) | 0.54 ±0.14 (9 fail) | 0.21 ±0.34 (9 fail) | 0.33 ±0.33 (9 fail) | 0.50 ±0.00 (1 fail) | 0.73 ±0.16 (8 fail) |

_Thresholds (WARN-only): faithfulness ≥ 0.9 · answer_relevancy ≥ 0.85 · context_precision ≥ 0.8 · context_recall ≥ 0.75 · refusal_correctness ≥ 0.75 · groundedness_self_eval ≥ 0.85_

### Gen-eval threshold violations

**lessons** (48):
  - `lesson-pg-uuid-casing` — answer_relevancy<0.85, context_recall<0.75
  - `lesson-undici-version-pinning` — faithfulness<0.9, answer_relevancy<0.85, context_recall<0.75
  - `lesson-pyenv-python3-shim` — answer_relevancy<0.85, context_recall<0.75
  - `lesson-npm-test-silent-skip` — faithfulness<0.9, answer_relevancy<0.85, context_recall<0.75, groundedness_self_eval<0.85
  - `lesson-api-lessons-items-shape` — answer_relevancy<0.85, context_recall<0.75
  - _(+43 more)_

**code** (77):
  - `auth-workspace-token-validate` — faithfulness<0.9, context_precision<0.8, context_recall<0.75, groundedness_self_eval<0.85
  - `mcp-streamable-http-endpoint` — faithfulness<0.9, answer_relevancy<0.85, context_precision<0.8, context_recall<0.75, groundedness_self_eval<0.85
  - `index-project-main-pipeline` — faithfulness<0.9, answer_relevancy<0.85, context_precision<0.8, context_recall<0.75, groundedness_self_eval<0.85
  - `ignore-rules-loading` — faithfulness<0.9, context_precision<0.8, context_recall<0.75, groundedness_self_eval<0.85
  - `embedding-request-shape` — faithfulness<0.9, groundedness_self_eval<0.85
  - _(+72 more)_

**chunks** (13):
  - `chunk-retry-strategy-overview` — faithfulness<0.9, context_recall<0.75
  - `chunk-retry-config-table` — answer_relevancy<0.85, context_precision<0.8, context_recall<0.75
  - `chunk-retry-implementation-code` — answer_relevancy<0.85, context_recall<0.75
  - `chunk-authentication-overview` — answer_relevancy<0.85, context_recall<0.75
  - `chunk-role-definitions` — faithfulness<0.9, answer_relevancy<0.85, context_recall<0.75
  - _(+8 more)_

**global** (10):
  - `global-retry-substr` — faithfulness<0.9, answer_relevancy<0.85, context_precision<0.8, context_recall<0.75, groundedness_self_eval<0.85
  - `global-validation-substr` — faithfulness<0.9, answer_relevancy<0.85, context_precision<0.8, context_recall<0.75, groundedness_self_eval<0.85
  - `global-authentication-substr` — faithfulness<0.9, answer_relevancy<0.85
  - `global-max-retry-substr` — faithfulness<0.9, answer_relevancy<0.85, context_precision<0.8, context_recall<0.75, groundedness_self_eval<0.85
  - `global-architecture-substr` — answer_relevancy<0.85, context_precision<0.8, context_recall<0.75
  - _(+5 more)_


## lessons — per-query detail

| id | group | found@ | friction | p50 ms |
|---|---|---|---|---:|
| lesson-pg-uuid-casing | confident-hit | 1 | clean | 748 |
| lesson-undici-version-pinning | confident-hit | 1 | clean | 1439 |
| lesson-pyenv-python3-shim | confident-hit | 1 | clean | 2406 |
| lesson-npm-test-silent-skip | confident-hit | 1 | clean | 712 |
| lesson-api-lessons-items-shape | confident-hit | 1 | clean | 1208 |
| lesson-review-impl-default | confident-hit | 1 | clean | 749 |
| lesson-noproject-guard-hydration | confident-hit | 1 | clean | 2196 |
| lesson-project-crud-validation | confident-hit | 1 | clean | 2183 |
| lesson-multi-project-color | confident-hit | 1 | clean | 1197 |
| lesson-code-review-workflow-pref | confident-hit | 10 | rank-order-inversion | 1377 |
| lesson-dup-max-retry-guardrail | duplicate-trap | 1,2,3,4,5 | clean | 1819 |
| lesson-dup-global-search-retry-pattern | duplicate-trap | 1,2 | clean | 1051 |
| lesson-dup-valid-impexp-fixture | duplicate-trap | 1,2,4,5,7 | clean | 1194 |
| lesson-miss-unicorn | adversarial-miss | — | — | 1175 |
| lesson-miss-astrophysics | adversarial-miss | — | — | 701 |
| lesson-miss-falconry | adversarial-miss | — | — | 743 |
| lesson-cross-integration-test-backoff | cross-topic | 1,3,7,10 | clean | 901 |
| lesson-cross-sprint-11-closeout | cross-topic | — | no-relevant-hit | 1048 |
| lesson-cross-workflow-gate | cross-topic | 4,5 | rank-order-inversion | 1978 |
| lesson-cross-agent-bootstrap-e2e | cross-topic | 1,2 | clean | 1102 |
| lesson-ambig-measurement-methodology | ambiguous-multi-target | 2,3,10 | clean | 1147 |
| lesson-ambig-dedup-key-design | ambiguous-multi-target | 1,2,3,4 | clean | 1122 |
| lesson-ambig-review-impl-default | ambiguous-multi-target | 1,3 | clean | 2396 |
| lesson-ambig-popularity-feedback | ambiguous-multi-target | 1 | clean | 2122 |
| lesson-ambig-baseline-drift | ambiguous-multi-target | 3,5 | clean | 1112 |
| lesson-ambig-numeric-edge-cases | ambiguous-multi-target | 2 | clean | 2582 |
| lesson-ambig-test-infra-async | ambiguous-multi-target | 4,5 | rank-order-inversion | 1547 |
| lesson-ambig-noise-floor | ambiguous-multi-target | 1,2,8 | clean | 791 |
| lesson-ambig-downstream-propagation | ambiguous-multi-target | 2,4 | clean | 1302 |
| lesson-ambig-fire-and-forget-pool | ambiguous-multi-target | 3,5 | clean | 884 |
| lesson-ambig-multi-project-isolation | ambiguous-multi-target | 2,7 | clean | 2415 |
| lesson-ambig-composite-relevance | ambiguous-multi-target | 1,2 | clean | 1243 |
| lesson-ambig-content-empty-dedup | ambiguous-multi-target | 1,3,4 | clean | 2246 |
| lesson-ambig-recency-frequency-retrieval | ambiguous-multi-target | 1 | clean | 2478 |
| lesson-ambig-dedup-e2e-testing | ambiguous-multi-target | 1,3 | clean | 1529 |
| lesson-para-pg-map-miss | semantic-paraphrase | 4 | rank-order-inversion | 1180 |
| lesson-para-undici-node-mismatch | semantic-paraphrase | — | no-relevant-hit | 2231 |
| lesson-para-nan-defensive-math | semantic-paraphrase | 2 | clean | 1336 |
| lesson-para-new-test-not-running | semantic-paraphrase | 2 | clean | 1590 |
| lesson-para-windows-python-newlines | semantic-paraphrase | 1 | clean | 1054 |
| lesson-edge-multi-hop-1 | edge-multi-hop | — | no-relevant-hit | 730 |
| lesson-edge-multi-hop-2 | edge-multi-hop | 1,2 | clean | 2837 |
| lesson-edge-no-answer-1 | edge-no-answer | — | — | 1176 |
| lesson-edge-contradictory-1 | edge-contradictory | 1 | clean | 726 |
| lesson-edge-contradictory-2 | edge-contradictory | — | no-relevant-hit | 1442 |
| lesson-edge-paraphrase-1 | edge-paraphrase | 1 | clean | 886 |
| lesson-edge-paraphrase-2 | edge-paraphrase | 1 | clean | 1130 |
| lesson-edge-distractor-1 | edge-distractor | 1 | clean | 2477 |

## code — per-query detail

| id | group | found@ | friction | p50 ms |
|---|---|---|---|---:|
| auth-workspace-token-validate | mcp-auth | 2 | clean | 3514 |
| mcp-streamable-http-endpoint | mcp-server | 8 | rank-order-inversion | 66 |
| index-project-main-pipeline | indexing | — | no-relevant-hit | 3052 |
| ignore-rules-loading | indexing | 1 | clean | 89 |
| embedding-request-shape | embeddings | — | no-relevant-hit | 2275 |
| project-snapshot-rebuild | snapshots | 1,3,5 | clean | 75 |
| kg-bootstrap | kg | 2,5 | clean | 77 |
| kg-upsert-from-indexer | kg | 1 | clean | 73 |
| kg-ts-morph-extractor | kg | 1 | clean | 3482 |
| kg-query-tools | kg | — | no-relevant-hit | 3410 |
| lessons-storage-and-search | lessons | 9 | rank-order-inversion | 2020 |
| guardrails-check | guardrails | 2,4 | clean | 1952 |
| git-ingest-core | git | 7 | rank-order-inversion | 3101 |
| git-deleted-files-handling | git | 2 | clean | 79 |
| git-proposal-upsert-idempotent | git | 2,3 | clean | 2819 |
| repo-source-config | sources | 2 | clean | 88 |
| prepare-repo-clone-fetch-checkout | sources | — | no-relevant-hit | 2384 |
| s3-source-artifacts | sources | 1 | clean | 84 |
| job-queue-postgres-claim | queue | 1 | clean | 93 |
| job-queue-rabbitmq | queue | 1,5 | clean | 2461 |
| job-executor-dispatch | queue | — | no-relevant-hit | 3179 |
| workspace-scan-porcelain | workspace | 1 | clean | 3472 |
| env-schema-queue-s3 | config | 3 | clean | 88 |
| migrations-git-intelligence | db | — | no-relevant-hit | 91 |
| migrations-sources-jobs | db | — | no-relevant-hit | 2359 |
| tool-output-formatting | mcp-server | — | no-relevant-hit | 3055 |
| output-format-parser-smoke | mcp-server | — | no-relevant-hit | 3664 |
| env-boolean-parser | config | 1 | clean | 85 |
| mcp-tool-registrations | mcp-server | — | no-relevant-hit | 97 |
| db-migrations-apply | db | 1 | clean | 78 |
| db-pool-singleton | db | 1 | clean | 75 |
| guardrails-storage | guardrails | 1 | clean | 70 |
| lessons-distillation-enabled | lessons | 1,4 | clean | 78 |
| distiller-commit-suggestion-schema | distillation | 1 | clean | 75 |
| job-correlation-filter | queue | 2 | clean | 3793 |
| rabbitmq-queue-assert-bind | queue | — | no-relevant-hit | 3423 |
| worker-rabbitmq-consumer | queue | 1 | clean | 2765 |
| worker-fallback-postgres-polling | queue | 6 | rank-order-inversion | 75 |
| repo-sync-fanout | queue | 5 | rank-order-inversion | 3691 |
| project-sources-schema | sources | — | no-relevant-hit | 2698 |
| workspace-deltas-schema | workspace | — | no-relevant-hit | 3840 |
| scan-workspace-delta-index | workspace | 5 | rank-order-inversion | 1993 |
| delete-workspace-cascades | storage | — | no-relevant-hit | 2761 |
| kg-ids-deterministic | kg | — | no-relevant-hit | 2417 |
| kg-linker-lessons | kg | 1 | clean | 82 |
| kg-project-graph-delete | kg | 3 | clean | 75 |
| git-impact-analysis | git | 10 | rank-order-inversion | 3024 |
| git-link-commit-to-lesson | git | — | no-relevant-hit | 2850 |
| git-proposal-sanitization | git | 3 | clean | 3670 |
| mcp-health-endpoint | mcp-server | — | no-relevant-hit | 76 |
| mcp-output-format-default | mcp-server | — | no-relevant-hit | 2423 |
| config-default-project-id | config | 1 | clean | 2642 |
| config-env-loading-dotenv | config | 1 | clean | 78 |
| config-embeddings-base-url | embeddings | — | no-relevant-hit | 3331 |
| config-embeddings-api-key | embeddings | 10 | rank-order-inversion | 73 |
| config-distillation-enabled | distillation | 1 | clean | 68 |
| config-kg-enabled | kg | 2,5 | clean | 67 |
| auth-tool-wrapper | mcp-auth | 2 | clean | 3055 |
| auth-workspace-token-env | mcp-auth | — | no-relevant-hit | 77 |
| indexer-chunk-size-config | indexing | — | no-relevant-hit | 2754 |
| retriever-search-code-boosts | retrieval | 5 | rank-order-inversion | 3385 |
| retriever-default-excludes | retrieval | — | no-relevant-hit | 3035 |
| queue-backend-selection | queue | 1,2 | clean | 74 |
| queue-job-types | queue | 1,3 | clean | 71 |
| smoke-queue-tools-block | smoke | 2 | clean | 3599 |
| ci-phase5-worker-validation-workflow | ci | — | no-relevant-hit | 3699 |
| ci-mock-embeddings-server | ci | — | no-relevant-hit | 80 |
| code-edge-multi-hop-1 | edge-multi-hop | — | no-relevant-hit | 3296 |
| code-edge-no-answer-1 | edge-no-answer | — | — | 2754 |
| code-edge-no-answer-2 | edge-no-answer | — | — | 66 |
| code-edge-contradictory-1 | edge-contradictory | — | no-relevant-hit | 63 |
| code-edge-contradictory-2 | edge-contradictory | — | no-relevant-hit | 78 |
| code-edge-paraphrase-1 | edge-paraphrase | — | no-relevant-hit | 77 |
| code-edge-paraphrase-2 | edge-paraphrase | — | no-relevant-hit | 74 |
| code-edge-distractor-1 | edge-distractor | 2 | clean | 69 |
| code-edge-distractor-2 | edge-distractor | — | no-relevant-hit | 70 |
| code-edge-distractor-3 | edge-distractor | — | no-relevant-hit | 74 |

## chunks — per-query detail

| id | group | found@ | friction | p50 ms |
|---|---|---|---|---:|
| chunk-retry-strategy-overview | confident-hit | 1 | clean | 52 |
| chunk-retry-config-table | confident-hit | 1 | clean | 55 |
| chunk-retry-implementation-code | confident-hit | 1 | clean | 50 |
| chunk-authentication-overview | confident-hit | 1 | clean | 53 |
| chunk-role-definitions | confident-hit | 1 | clean | 53 |
| chunk-data-storage-pgvector | confident-hit | 1 | clean | 52 |
| chunk-adr-intro-dup | duplicate-trap | 1,2 | clean | 56 |
| chunk-cross-retry-auth-storage | cross-topic | 3,5,6 | clean | 49 |
| chunk-miss-quantum | adversarial-miss | — | — | 60 |
| chunk-miss-jazz | adversarial-miss | — | — | 42 |
| chunk-edge-multi-hop-1 | edge-multi-hop | 1,2,4 | clean | 43 |
| chunk-edge-no-answer-1 | edge-no-answer | — | — | 53 |
| chunk-edge-distractor-1 | edge-distractor | 1 | clean | 48 |

## global — per-query detail

| id | group | found@ | friction | p50 ms |
|---|---|---|---|---:|
| global-retry-substr | confident-hit | 3 | clean | 18 |
| global-validation-substr | confident-hit | 9 | rank-order-inversion | 22 |
| global-authentication-substr | confident-hit | 1 | clean | 22 |
| global-max-retry-substr | confident-hit | 2 | clean | 21 |
| global-architecture-substr | confident-hit | 1,2 | clean | 22 |
| global-pgvector-substr | confident-hit | 2 | clean | 22 |
| global-review-impl-substr | confident-hit | — | no-relevant-hit | 22 |
| global-undici-substr | confident-hit | 3 | clean | 22 |
| global-workspace-substr | coverage-probe | — | — | 24 |
| global-miss-zephyr | adversarial-miss | — | empty-result-set | 22 |
| global-edge-multi-hop-1 | edge-multi-hop | — | empty-result-set;no-relevant-hit | 3 |
| global-edge-no-answer-1 | edge-no-answer | — | empty-result-set | 3 |
| global-edge-contradictory-1 | edge-contradictory | — | no-relevant-hit | 3 |
| global-edge-paraphrase-1 | edge-paraphrase | — | empty-result-set;no-relevant-hit | 23 |

## Friction observed (top examples)

_(showing up to 3 per surface; 55 total queries have flagged friction across all surfaces)_

- **lessons/lesson-code-review-workflow-pref** — rank-order-inversion: query `code review preference: review each file group separately after bulk implementat`; top-3 keys=[5258dbfe-b76d-42aa-b680-15eb9a7b83d7, e15edaef-1d63-4cff-a9cc-7f972a0887d5, 17320a37-4f2e-4708-8446-429d35f0f3fa]
- **lessons/lesson-cross-sprint-11-closeout** — no-relevant-hit: query `sprint 11.6c-sec DNS pinning body-stall timeout security polish`; top-3 keys=[67bc4411-a8b4-4e37-ae62-fa843fe47f67, c26217e2-69f0-440e-828c-e1ef9c2481fc, 5c0b7b25-4a93-4961-bf64-e0c967438b24]
- **lessons/lesson-cross-workflow-gate** — rank-order-inversion: query `workflow gate state machine 12-phase workflow v2.2`; top-3 keys=[7c632d4b-1486-4b11-910c-5214ad9e2d7d, 45c8cb44-9fb8-4dad-b825-5b1cd8b0a108, 5c0b7b25-4a93-4961-bf64-e0c967438b24]
- **code/mcp-streamable-http-endpoint** — rank-order-inversion: query `Where is the MCP HTTP endpoint implemented and what routes are exposed?`; top-3 keys=[src/qc/integrationTestRunner.ts, src/mcp/index.ts, src/qc/ragQcRunner.ts]
- **code/index-project-main-pipeline** — no-relevant-hit: query `How does index_project discover files, chunk them, embed, and write to Postgres?`; top-3 keys=[src/mcp/index.ts, src/smoke/distillProbe.ts, packages/mcp-client/src/index.ts]
- **code/embedding-request-shape** — no-relevant-hit: query `How does the embeddings client call /v1/embeddings and validate dimensions?`; top-3 keys=[src/services/faqBuilder.ts, services/ragas-judge/_compat.py, services/ragas-judge/main.py]
- **global/global-validation-substr** — rank-order-inversion: query `validation`; top-3 keys=[lesson:61835c5d-d5c8-4d61-9fa0-3497aadee229, lesson:476aeed0-8363-4630-bd07-faf0edc573ba, lesson:44e38b7e-0ef9-4b0f-9754-d5dcc09f4e4d]
- **global/global-review-impl-substr** — no-relevant-hit: query `review-impl`; top-3 keys=[lesson:7c632d4b-1486-4b11-910c-5214ad9e2d7d, guardrail:5287a774-5761-412f-a150-31db7f2b3880, lesson:f47de748-7a78-44e9-af6f-ef3f7a324004]
- **global/global-miss-zephyr** — empty-result-set: query `zephyr-ninja-pyramid-2026`; top-3 keys=[]

## Known limitations

- Latency varies ±10–20% across runs; quality metrics are deterministic.
- Global surface uses REST /api/search/global (ILIKE, not semantic); recall floor comes from raw substring matching.
- Code surface requires an indexed `chunks` population; empty index → 0 coverage regardless of query quality.
- `duplication_rate_at_10` v0 keys on exact entity id. Same-title-different-UUID noise (the original Phase-12 motivation: multiple lesson rows titled "Global search test retry pattern") is invisible to v0 — a reader seeing `dup@10 = 0` should NOT conclude "no duplication"; see `snippet-redundancy` in `docs/qc/friction-classes.md`.
- Golden-set ceiling bias: lesson queries are paraphrases of lesson content, and target ids were cherry-picked from recently-active lessons. Reported `recall@10 = 1.0` may reflect "queries are easy" rather than "retriever is strong." Sprint 12.1 should add adversarial queries (synonyms, typos, indirect references) to distinguish real improvement from noise.
