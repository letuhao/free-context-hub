---
tag: 2026-06-17-phase-17-v11-hybrid-tradition-b-defer-judge-full
commit: d368586+dirty
branch: v11-hybrid-templates
run_at: 2026-06-17T12:41:11.907Z
elapsed_ms: 2907741
project_id_primary: free-context-hub
---

# RAG Baseline — 2026-06-17-phase-17-v11-hybrid-tradition-b-defer-judge-full

## Gen-eval manifest

- **answerer:** `mistralai/mistral-nemo-instruct-2407` @ `http://localhost:1234/v1` (temp=0.2, seed=42, max_tokens=1024)
- **judge:** `google/gemma-4-26b-a4b` @ `http://host.docker.internal:1234/v1` (temp=0, seed=42)
- **judge prompts hash:** `c0165a73c10c4e04`
- **synthesizer template hashes:**
  - lessons: `13ac4e950489bde6`
  - code: `3a2ea1624ae0a1fc`
  - chunks: `a01005e0d102b2c1`
  - global: `bbfc552fbd293364`

## Summary (all surfaces)

| Surface | Project | Q | err | recall@5 | recall@10 | MRR | nDCG@5 | nDCG@10 | dup@10 | dup@10 nearsem | cov% | p50 ms | p95 ms |
|---|---|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|
| lessons | free-context-hub | 48 | 0 | 0.8889 | 0.8889 | 0.8556 | 0.8447 | 0.8261 | 0 | 0 | 0.8889 | 84 | 95 |
| code | free-context-hub | 77 | 0 | 0.4286 | 0.5974 | 0.3613 | 0.3563 | 0.412 | 0 | 0 | 0.5974 | 2048 | 3876 |
| chunks | free-context-hub | 13 | 0 | 0.9091 | 0.9091 | 0.8485 | 0.8498 | 0.8534 | 0 | 0 | 0.9091 | 36 | 48 |
| global | free-context-hub | 14 | 0 | 0.4615 | 0.5385 | 0.2906 | 0.3278 | 0.351 | 0 | 0.15 | 0.5385 | 3 | 5 |

## Gen-eval summary (per surface)

| Surface | rows w/ gt | rows judged | faithfulness | answer_relevancy | context_precision | context_recall | refusal_correctness | groundedness_self_eval |
|---|---:|---:|---:|---:|---:|---:|---:|---:|
| lessons | 48 | 48 | 0.67 ±0.32 (28 fail) | 0.83 ±0.13 (20 fail) | 0.82 ±0.34 (10 fail) | 0.62 ±0.31 (31 fail) | 0.75 ±0.43 (1 fail) | 0.85 ±0.26 (16 fail) |
| code | 77 | 77 | 0.55 ±0.33 (59 fail) | 0.79 ±0.27 (33 fail) | 0.10 ±0.28 (71 fail) | 0.07 ±0.16 (76 fail) | 0.50 ±0.50 (1 fail) | 0.69 ±0.29 (50 fail) |
| chunks | 13 | 13 | 0.94 ±0.13 (2 fail) | 0.80 ±0.13 (6 fail) | 0.58 ±0.43 (7 fail) | 0.37 ±0.40 (10 fail) | 0.33 ±0.47 (2 fail) | 0.85 ±0.28 (4 fail) |
| global | 14 | 10 | 0.45 ±0.23 (9 fail) | 0.68 ±0.07 (9 fail) | 0.49 ±0.39 (7 fail) | 0.36 ±0.31 (9 fail) | 0.00 ±0.00 (1 fail) | 0.50 ±0.33 (8 fail) |

_Thresholds (WARN-only): faithfulness ≥ 0.9 · answer_relevancy ≥ 0.85 · context_precision ≥ 0.8 · context_recall ≥ 0.75 · refusal_correctness ≥ 0.75 · groundedness_self_eval ≥ 0.85_

### Gen-eval threshold violations

**lessons** (44):
  - `lesson-undici-version-pinning` — context_recall<0.75
  - `lesson-pyenv-python3-shim` — answer_relevancy<0.85, context_recall<0.75
  - `lesson-npm-test-silent-skip` — faithfulness<0.9, answer_relevancy<0.85, context_recall<0.75
  - `lesson-api-lessons-items-shape` — answer_relevancy<0.85
  - `lesson-review-impl-default` — faithfulness<0.9, context_recall<0.75, groundedness_self_eval<0.85
  - _(+39 more)_

**code** (77):
  - `auth-workspace-token-validate` — faithfulness<0.9, context_precision<0.8, context_recall<0.75, groundedness_self_eval<0.85
  - `mcp-streamable-http-endpoint` — faithfulness<0.9, context_precision<0.8, context_recall<0.75, groundedness_self_eval<0.85
  - `index-project-main-pipeline` — faithfulness<0.9, answer_relevancy<0.85, context_precision<0.8, context_recall<0.75, groundedness_self_eval<0.85
  - `ignore-rules-loading` — faithfulness<0.9, answer_relevancy<0.85, context_precision<0.8, context_recall<0.75, groundedness_self_eval<0.85
  - `embedding-request-shape` — faithfulness<0.9, context_precision<0.8, context_recall<0.75, groundedness_self_eval<0.85
  - _(+72 more)_

**chunks** (12):
  - `chunk-retry-strategy-overview` — context_recall<0.75
  - `chunk-retry-config-table` — answer_relevancy<0.85, context_precision<0.8, context_recall<0.75
  - `chunk-retry-implementation-code` — faithfulness<0.9, context_precision<0.8, context_recall<0.75, groundedness_self_eval<0.85
  - `chunk-authentication-overview` — answer_relevancy<0.85, context_recall<0.75
  - `chunk-role-definitions` — faithfulness<0.9, answer_relevancy<0.85, context_precision<0.8, context_recall<0.75, groundedness_self_eval<0.85
  - _(+7 more)_

**global** (10):
  - `global-retry-substr` — faithfulness<0.9, answer_relevancy<0.85, context_precision<0.8, groundedness_self_eval<0.85
  - `global-validation-substr` — faithfulness<0.9, answer_relevancy<0.85, context_precision<0.8, context_recall<0.75, groundedness_self_eval<0.85
  - `global-authentication-substr` — faithfulness<0.9, answer_relevancy<0.85, context_recall<0.75
  - `global-max-retry-substr` — faithfulness<0.9, answer_relevancy<0.85, context_precision<0.8, context_recall<0.75, groundedness_self_eval<0.85
  - `global-architecture-substr` — faithfulness<0.9, answer_relevancy<0.85, context_recall<0.75
  - _(+5 more)_


## lessons — per-query detail

| id | group | found@ | friction | p50 ms |
|---|---|---|---|---:|
| lesson-pg-uuid-casing | confident-hit | 1 | clean | 91 |
| lesson-undici-version-pinning | confident-hit | 1 | clean | 93 |
| lesson-pyenv-python3-shim | confident-hit | 1 | clean | 85 |
| lesson-npm-test-silent-skip | confident-hit | 1 | clean | 88 |
| lesson-api-lessons-items-shape | confident-hit | 1 | clean | 88 |
| lesson-review-impl-default | confident-hit | 1 | clean | 88 |
| lesson-noproject-guard-hydration | confident-hit | 1 | clean | 94 |
| lesson-project-crud-validation | confident-hit | 1 | clean | 85 |
| lesson-multi-project-color | confident-hit | 1 | clean | 81 |
| lesson-code-review-workflow-pref | confident-hit | 1 | clean | 82 |
| lesson-dup-max-retry-guardrail | duplicate-trap | 1,2,3,4,5 | clean | 80 |
| lesson-dup-global-search-retry-pattern | duplicate-trap | 1,2 | clean | 90 |
| lesson-dup-valid-impexp-fixture | duplicate-trap | 1,2,3,4,5 | clean | 80 |
| lesson-miss-unicorn | adversarial-miss | — | — | 82 |
| lesson-miss-astrophysics | adversarial-miss | — | — | 79 |
| lesson-miss-falconry | adversarial-miss | — | — | 81 |
| lesson-cross-integration-test-backoff | cross-topic | 1,2,5,6,7,8,10 | clean | 77 |
| lesson-cross-sprint-11-closeout | cross-topic | — | no-relevant-hit | 85 |
| lesson-cross-workflow-gate | cross-topic | 2,9 | clean | 83 |
| lesson-cross-agent-bootstrap-e2e | cross-topic | 1,3 | clean | 82 |
| lesson-ambig-measurement-methodology | ambiguous-multi-target | 2,8,10 | clean | 90 |
| lesson-ambig-dedup-key-design | ambiguous-multi-target | 1,2,3,4 | clean | 85 |
| lesson-ambig-review-impl-default | ambiguous-multi-target | 1,2 | clean | 87 |
| lesson-ambig-popularity-feedback | ambiguous-multi-target | 1,2 | clean | 81 |
| lesson-ambig-baseline-drift | ambiguous-multi-target | 1,5 | clean | 81 |
| lesson-ambig-numeric-edge-cases | ambiguous-multi-target | 1,9 | clean | 84 |
| lesson-ambig-test-infra-async | ambiguous-multi-target | 1,2 | clean | 82 |
| lesson-ambig-noise-floor | ambiguous-multi-target | 1,2,4,5 | clean | 85 |
| lesson-ambig-downstream-propagation | ambiguous-multi-target | 1,7,9 | clean | 83 |
| lesson-ambig-fire-and-forget-pool | ambiguous-multi-target | 1,2 | clean | 83 |
| lesson-ambig-multi-project-isolation | ambiguous-multi-target | 1,5 | clean | 84 |
| lesson-ambig-composite-relevance | ambiguous-multi-target | 1,4 | clean | 80 |
| lesson-ambig-content-empty-dedup | ambiguous-multi-target | 1,2,8 | clean | 84 |
| lesson-ambig-recency-frequency-retrieval | ambiguous-multi-target | 2 | clean | 91 |
| lesson-ambig-dedup-e2e-testing | ambiguous-multi-target | 1,3 | clean | 85 |
| lesson-para-pg-map-miss | semantic-paraphrase | 1 | clean | 96 |
| lesson-para-undici-node-mismatch | semantic-paraphrase | — | no-relevant-hit | 88 |
| lesson-para-nan-defensive-math | semantic-paraphrase | 1 | clean | 87 |
| lesson-para-new-test-not-running | semantic-paraphrase | 1 | clean | 83 |
| lesson-para-windows-python-newlines | semantic-paraphrase | 1 | clean | 84 |
| lesson-edge-multi-hop-1 | edge-multi-hop | — | no-relevant-hit | 86 |
| lesson-edge-multi-hop-2 | edge-multi-hop | 1,2,7 | clean | 80 |
| lesson-edge-no-answer-1 | edge-no-answer | — | — | 84 |
| lesson-edge-contradictory-1 | edge-contradictory | 1 | clean | 82 |
| lesson-edge-contradictory-2 | edge-contradictory | — | no-relevant-hit | 84 |
| lesson-edge-paraphrase-1 | edge-paraphrase | 1 | clean | 87 |
| lesson-edge-paraphrase-2 | edge-paraphrase | 1 | clean | 84 |
| lesson-edge-distractor-1 | edge-distractor | 1 | clean | 83 |

## code — per-query detail

| id | group | found@ | friction | p50 ms |
|---|---|---|---|---:|
| auth-workspace-token-validate | mcp-auth | — | no-relevant-hit | 2485 |
| mcp-streamable-http-endpoint | mcp-server | 8 | rank-order-inversion | 61 |
| index-project-main-pipeline | indexing | 7 | rank-order-inversion | 3113 |
| ignore-rules-loading | indexing | 1 | clean | 52 |
| embedding-request-shape | embeddings | — | no-relevant-hit | 2447 |
| project-snapshot-rebuild | snapshots | 1,3 | clean | 50 |
| kg-bootstrap | kg | 2,5 | clean | 46 |
| kg-upsert-from-indexer | kg | 1 | clean | 46 |
| kg-ts-morph-extractor | kg | 7 | rank-order-inversion | 3843 |
| kg-query-tools | kg | 2 | clean | 3867 |
| lessons-storage-and-search | lessons | 6 | rank-order-inversion | 2119 |
| guardrails-check | guardrails | 2,3 | clean | 2129 |
| git-ingest-core | git | 5 | rank-order-inversion | 3145 |
| git-deleted-files-handling | git | 2 | clean | 54 |
| git-proposal-upsert-idempotent | git | 5,6 | rank-order-inversion | 2815 |
| repo-source-config | sources | 2 | clean | 52 |
| prepare-repo-clone-fetch-checkout | sources | 8 | rank-order-inversion | 2533 |
| s3-source-artifacts | sources | 1 | clean | 65 |
| job-queue-postgres-claim | queue | 1 | clean | 50 |
| job-queue-rabbitmq | queue | 1,5 | clean | 2420 |
| job-executor-dispatch | queue | — | no-relevant-hit | 3141 |
| workspace-scan-porcelain | workspace | 1 | clean | 3826 |
| env-schema-queue-s3 | config | 3 | clean | 49 |
| migrations-git-intelligence | db | — | no-relevant-hit | 50 |
| migrations-sources-jobs | db | — | no-relevant-hit | 2425 |
| tool-output-formatting | mcp-server | — | no-relevant-hit | 3198 |
| output-format-parser-smoke | mcp-server | — | no-relevant-hit | 3777 |
| env-boolean-parser | config | 1 | clean | 47 |
| mcp-tool-registrations | mcp-server | — | no-relevant-hit | 46 |
| db-migrations-apply | db | 1 | clean | 43 |
| db-pool-singleton | db | 1 | clean | 44 |
| guardrails-storage | guardrails | 1 | clean | 47 |
| lessons-distillation-enabled | lessons | 1,4 | clean | 55 |
| distiller-commit-suggestion-schema | distillation | 1 | clean | 51 |
| job-correlation-filter | queue | — | no-relevant-hit | 3785 |
| rabbitmq-queue-assert-bind | queue | — | no-relevant-hit | 3461 |
| worker-rabbitmq-consumer | queue | 1 | clean | 2901 |
| worker-fallback-postgres-polling | queue | 6 | rank-order-inversion | 51 |
| repo-sync-fanout | queue | 8 | rank-order-inversion | 3729 |
| project-sources-schema | sources | — | no-relevant-hit | 2720 |
| workspace-deltas-schema | workspace | — | no-relevant-hit | 3946 |
| scan-workspace-delta-index | workspace | 6 | rank-order-inversion | 2146 |
| delete-workspace-cascades | storage | — | no-relevant-hit | 2809 |
| kg-ids-deterministic | kg | — | no-relevant-hit | 2493 |
| kg-linker-lessons | kg | 1 | clean | 50 |
| kg-project-graph-delete | kg | 3 | clean | 53 |
| git-impact-analysis | git | 6 | rank-order-inversion | 3184 |
| git-link-commit-to-lesson | git | 9 | rank-order-inversion | 2903 |
| git-proposal-sanitization | git | — | no-relevant-hit | 4088 |
| mcp-health-endpoint | mcp-server | — | no-relevant-hit | 56 |
| mcp-output-format-default | mcp-server | — | no-relevant-hit | 2552 |
| config-default-project-id | config | 1 | clean | 2753 |
| config-env-loading-dotenv | config | 1 | clean | 53 |
| config-embeddings-base-url | embeddings | — | no-relevant-hit | 3475 |
| config-embeddings-api-key | embeddings | 10 | rank-order-inversion | 73 |
| config-distillation-enabled | distillation | 1 | clean | 47 |
| config-kg-enabled | kg | 2,5 | clean | 47 |
| auth-tool-wrapper | mcp-auth | 2 | clean | 3051 |
| auth-workspace-token-env | mcp-auth | — | no-relevant-hit | 51 |
| indexer-chunk-size-config | indexing | — | no-relevant-hit | 2858 |
| retriever-search-code-boosts | retrieval | 9 | rank-order-inversion | 3438 |
| retriever-default-excludes | retrieval | — | no-relevant-hit | 3185 |
| queue-backend-selection | queue | 1,2 | clean | 50 |
| queue-job-types | queue | 1,3 | clean | 59 |
| smoke-queue-tools-block | smoke | 1 | clean | 3876 |
| ci-phase5-worker-validation-workflow | ci | — | no-relevant-hit | 3941 |
| ci-mock-embeddings-server | ci | — | no-relevant-hit | 57 |
| code-edge-multi-hop-1 | edge-multi-hop | 10 | rank-order-inversion | 3598 |
| code-edge-no-answer-1 | edge-no-answer | — | — | 2991 |
| code-edge-no-answer-2 | edge-no-answer | — | — | 48 |
| code-edge-contradictory-1 | edge-contradictory | — | no-relevant-hit | 47 |
| code-edge-contradictory-2 | edge-contradictory | — | no-relevant-hit | 61 |
| code-edge-paraphrase-1 | edge-paraphrase | — | no-relevant-hit | 50 |
| code-edge-paraphrase-2 | edge-paraphrase | — | no-relevant-hit | 50 |
| code-edge-distractor-1 | edge-distractor | 2 | clean | 46 |
| code-edge-distractor-2 | edge-distractor | — | no-relevant-hit | 44 |
| code-edge-distractor-3 | edge-distractor | — | no-relevant-hit | 49 |

## chunks — per-query detail

| id | group | found@ | friction | p50 ms |
|---|---|---|---|---:|
| chunk-retry-strategy-overview | confident-hit | 1 | clean | 48 |
| chunk-retry-config-table | confident-hit | 1 | clean | 38 |
| chunk-retry-implementation-code | confident-hit | 1 | clean | 35 |
| chunk-authentication-overview | confident-hit | 1 | clean | 36 |
| chunk-role-definitions | confident-hit | 1 | clean | 36 |
| chunk-data-storage-pgvector | confident-hit | 1 | clean | 36 |
| chunk-adr-intro-dup | duplicate-trap | 1,2 | clean | 37 |
| chunk-cross-retry-auth-storage | cross-topic | 3,5,6 | clean | 34 |
| chunk-miss-quantum | adversarial-miss | — | — | 31 |
| chunk-miss-jazz | adversarial-miss | — | — | 32 |
| chunk-edge-multi-hop-1 | edge-multi-hop | 1,2,4 | clean | 36 |
| chunk-edge-no-answer-1 | edge-no-answer | — | — | 35 |
| chunk-edge-distractor-1 | edge-distractor | 1 | clean | 33 |

## global — per-query detail

| id | group | found@ | friction | p50 ms |
|---|---|---|---|---:|
| global-retry-substr | confident-hit | 3 | clean | 5 |
| global-validation-substr | confident-hit | 9 | rank-order-inversion | 3 |
| global-authentication-substr | confident-hit | 1 | clean | 3 |
| global-max-retry-substr | confident-hit | 2 | clean | 2 |
| global-architecture-substr | confident-hit | 1,2 | clean | 4 |
| global-pgvector-substr | confident-hit | 2 | clean | 3 |
| global-review-impl-substr | confident-hit | — | no-relevant-hit | 3 |
| global-undici-substr | confident-hit | 3 | clean | 2 |
| global-workspace-substr | coverage-probe | — | — | 2 |
| global-miss-zephyr | adversarial-miss | — | empty-result-set | 2 |
| global-edge-multi-hop-1 | edge-multi-hop | — | empty-result-set;no-relevant-hit | 3 |
| global-edge-no-answer-1 | edge-no-answer | — | empty-result-set | 3 |
| global-edge-contradictory-1 | edge-contradictory | — | no-relevant-hit | 2 |
| global-edge-paraphrase-1 | edge-paraphrase | — | empty-result-set;no-relevant-hit | 3 |

## Friction observed (top examples)

_(showing up to 3 per surface; 55 total queries have flagged friction across all surfaces)_

- **lessons/lesson-cross-sprint-11-closeout** — no-relevant-hit: query `sprint 11.6c-sec DNS pinning body-stall timeout security polish`; top-3 keys=[96cd0dc1-920c-420e-a703-1d9dca5e4e04, 206e30df-829a-46f1-b51e-93145f9105fb, 5c0b7b25-4a93-4961-bf64-e0c967438b24]
- **lessons/lesson-para-undici-node-mismatch** — no-relevant-hit: query `why does swapping http agents between the default and an installed one break str`; top-3 keys=[e15edaef-1d63-4cff-a9cc-7f972a0887d5, 5ab3a1ba-b0b4-481c-997a-5b0f61138d63, eb7409e5-d2bf-407b-9811-fca62a2c3ded]
- **lessons/lesson-edge-multi-hop-1** — no-relevant-hit: query `What two patterns combine for safe state-transition testing in coordination laye`; top-3 keys=[4e2b8497-8d8b-4d33-bd2d-1ffd2d66c860, 45c8cb44-9fb8-4dad-b825-5b1cd8b0a108, eb7409e5-d2bf-407b-9811-fca62a2c3ded]
- **code/auth-workspace-token-validate** — no-relevant-hit: query `Where is workspace_token validated for MCP tool calls?`; top-3 keys=[src/mcp/index.ts, src/qc/testTypes.ts, src/env.ts]
- **code/mcp-streamable-http-endpoint** — rank-order-inversion: query `Where is the MCP HTTP endpoint implemented and what routes are exposed?`; top-3 keys=[src/qc/integrationTestRunner.ts, src/mcp/index.ts, src/qc/ragQcRunner.ts]
- **code/index-project-main-pipeline** — rank-order-inversion: query `How does index_project discover files, chunk them, embed, and write to Postgres?`; top-3 keys=[packages/mcp-client/src/index.ts, src/env.ts, src/utils/resolveProjectRoot.ts]
- **global/global-validation-substr** — rank-order-inversion: query `validation`; top-3 keys=[lesson:61835c5d-d5c8-4d61-9fa0-3497aadee229, lesson:476aeed0-8363-4630-bd07-faf0edc573ba, lesson:44e38b7e-0ef9-4b0f-9754-d5dcc09f4e4d]
- **global/global-review-impl-substr** — no-relevant-hit: query `review-impl`; top-3 keys=[lesson:7c632d4b-1486-4b11-910c-5214ad9e2d7d, guardrail:5287a774-5761-412f-a150-31db7f2b3880, lesson:f47de748-7a78-44e9-af6f-ef3f7a324004]
- **global/global-miss-zephyr** — empty-result-set: query `zephyr-ninja-pyramid-2026`; top-3 keys=[]

## Known limitations

- Latency varies ±10–20% across runs; quality metrics are deterministic.
- Global surface uses REST /api/search/global (ILIKE, not semantic); recall floor comes from raw substring matching.
- Code surface requires an indexed `chunks` population; empty index → 0 coverage regardless of query quality.
- `duplication_rate_at_10` v0 keys on exact entity id. Same-title-different-UUID noise (the original Phase-12 motivation: multiple lesson rows titled "Global search test retry pattern") is invisible to v0 — a reader seeing `dup@10 = 0` should NOT conclude "no duplication"; see `snippet-redundancy` in `docs/qc/friction-classes.md`.
- Golden-set ceiling bias: lesson queries are paraphrases of lesson content, and target ids were cherry-picked from recently-active lessons. Reported `recall@10 = 1.0` may reflect "queries are easy" rather than "retriever is strong." Sprint 12.1 should add adversarial queries (synonyms, typos, indirect references) to distinguish real improvement from noise.
