---
tag: 2026-06-17-phase-17-v10-tradition-b-defer-judge-full
commit: 81cdde9+dirty
branch: deferred-030-rerank-quality
run_at: 2026-06-17T05:49:48.056Z
elapsed_ms: 3057530
project_id_primary: free-context-hub
---

# RAG Baseline — 2026-06-17-phase-17-v10-tradition-b-defer-judge-full

## Gen-eval manifest

- **answerer:** `mistralai/mistral-nemo-instruct-2407` @ `http://localhost:1234/v1` (temp=0.2, seed=42, max_tokens=1024)
- **judge:** `google/gemma-4-26b-a4b` @ `http://host.docker.internal:1234/v1` (temp=0, seed=42)
- **judge prompts hash:** `c0165a73c10c4e04`
- **synthesizer template hashes:**
  - lessons: `12d937d2dd93cdee`
  - code: `fa3d064302e85cd4`
  - chunks: `4684749e32568cec`
  - global: `bbfc552fbd293364`

## Summary (all surfaces)

| Surface | Project | Q | err | recall@5 | recall@10 | MRR | nDCG@5 | nDCG@10 | dup@10 | dup@10 nearsem | cov% | p50 ms | p95 ms |
|---|---|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|
| lessons | free-context-hub | 48 | 0 | 0.8889 | 0.8889 | 0.8556 | 0.8447 | 0.8261 | 0 | 0 | 0.8889 | 93 | 137 |
| code | free-context-hub | 77 | 0 | 0.4935 | 0.6364 | 0.3834 | 0.3909 | 0.4377 | 0 | 0 | 0.6364 | 2114 | 3859 |
| chunks | free-context-hub | 13 | 0 | 0.9091 | 0.9091 | 0.8485 | 0.8498 | 0.8534 | 0 | 0 | 0.9091 | 41 | 46 |
| global | free-context-hub | 14 | 0 | 0.4615 | 0.5385 | 0.2906 | 0.3278 | 0.351 | 0 | 0.15 | 0.5385 | 3 | 32 |

## Gen-eval summary (per surface)

| Surface | rows w/ gt | rows judged | faithfulness | answer_relevancy | context_precision | context_recall | refusal_correctness | groundedness_self_eval |
|---|---:|---:|---:|---:|---:|---:|---:|---:|
| lessons | 48 | 48 | 0.58 ±0.30 (20 fail) | 0.80 ±0.21 (21 fail) | 0.86 ±0.32 (6 fail) | 0.62 ±0.31 (20 fail) | 0.67 ±0.47 (1 fail) | 0.86 ±0.26 (12 fail) |
| code | 77 | 77 | 0.45 ±0.35 (62 fail) | 0.79 ±0.23 (38 fail) | 0.09 ±0.25 (72 fail) | 0.05 ±0.15 (77 fail) | 0.50 ±0.50 (1 fail) | 0.61 ±0.32 (56 fail) |
| chunks | 13 | 13 | 0.90 ±0.20 (2 fail) | 0.79 ±0.19 (5 fail) | 0.66 ±0.45 (5 fail) | 0.45 ±0.35 (10 fail) | 0.33 ±0.47 (2 fail) | 0.81 ±0.28 (5 fail) |
| global | 14 | 10 | 0.44 ±0.30 (9 fail) | 0.66 ±0.07 (9 fail) | 0.49 ±0.39 (7 fail) | 0.29 ±0.27 (10 fail) | 0.00 ±0.00 (1 fail) | 0.53 ±0.30 (8 fail) |

_Thresholds (WARN-only): faithfulness ≥ 0.9 · answer_relevancy ≥ 0.85 · context_precision ≥ 0.8 · context_recall ≥ 0.75 · refusal_correctness ≥ 0.75 · groundedness_self_eval ≥ 0.85_

### Gen-eval threshold violations

**lessons** (37):
  - `lesson-pg-uuid-casing` — answer_relevancy<0.85
  - `lesson-npm-test-silent-skip` — answer_relevancy<0.85
  - `lesson-api-lessons-items-shape` — answer_relevancy<0.85, context_recall<0.75
  - `lesson-review-impl-default` — groundedness_self_eval<0.85
  - `lesson-multi-project-color` — answer_relevancy<0.85
  - _(+32 more)_

**code** (77):
  - `auth-workspace-token-validate` — faithfulness<0.9, answer_relevancy<0.85, context_precision<0.8, context_recall<0.75
  - `mcp-streamable-http-endpoint` — faithfulness<0.9, context_precision<0.8, context_recall<0.75, groundedness_self_eval<0.85
  - `index-project-main-pipeline` — faithfulness<0.9, answer_relevancy<0.85, context_precision<0.8, context_recall<0.75, groundedness_self_eval<0.85
  - `ignore-rules-loading` — faithfulness<0.9, answer_relevancy<0.85, context_precision<0.8, context_recall<0.75
  - `embedding-request-shape` — faithfulness<0.9, answer_relevancy<0.85, context_precision<0.8, context_recall<0.75
  - _(+72 more)_

**chunks** (12):
  - `chunk-retry-strategy-overview` — context_precision<0.8, context_recall<0.75
  - `chunk-retry-config-table` — answer_relevancy<0.85, context_precision<0.8, context_recall<0.75
  - `chunk-retry-implementation-code` — context_recall<0.75
  - `chunk-authentication-overview` — faithfulness<0.9, context_recall<0.75, groundedness_self_eval<0.85
  - `chunk-role-definitions` — answer_relevancy<0.85, context_precision<0.8, context_recall<0.75, groundedness_self_eval<0.85
  - _(+7 more)_

**global** (10):
  - `global-retry-substr` — faithfulness<0.9, answer_relevancy<0.85, context_precision<0.8, context_recall<0.75, groundedness_self_eval<0.85
  - `global-validation-substr` — faithfulness<0.9, answer_relevancy<0.85, context_precision<0.8, context_recall<0.75, groundedness_self_eval<0.85
  - `global-authentication-substr` — faithfulness<0.9, answer_relevancy<0.85, context_recall<0.75
  - `global-max-retry-substr` — faithfulness<0.9, answer_relevancy<0.85, context_precision<0.8, context_recall<0.75, groundedness_self_eval<0.85
  - `global-architecture-substr` — faithfulness<0.9, answer_relevancy<0.85, context_recall<0.75
  - _(+5 more)_


## lessons — per-query detail

| id | group | found@ | friction | p50 ms |
|---|---|---|---|---:|
| lesson-pg-uuid-casing | confident-hit | 1 | clean | 1026 |
| lesson-undici-version-pinning | confident-hit | 1 | clean | 148 |
| lesson-pyenv-python3-shim | confident-hit | 1 | clean | 115 |
| lesson-npm-test-silent-skip | confident-hit | 1 | clean | 103 |
| lesson-api-lessons-items-shape | confident-hit | 1 | clean | 111 |
| lesson-review-impl-default | confident-hit | 1 | clean | 97 |
| lesson-noproject-guard-hydration | confident-hit | 1 | clean | 96 |
| lesson-project-crud-validation | confident-hit | 1 | clean | 95 |
| lesson-multi-project-color | confident-hit | 1 | clean | 129 |
| lesson-code-review-workflow-pref | confident-hit | 1 | clean | 99 |
| lesson-dup-max-retry-guardrail | duplicate-trap | 1,2,3,4,5 | clean | 92 |
| lesson-dup-global-search-retry-pattern | duplicate-trap | 1,2 | clean | 88 |
| lesson-dup-valid-impexp-fixture | duplicate-trap | 1,2,3,4,5 | clean | 86 |
| lesson-miss-unicorn | adversarial-miss | — | — | 91 |
| lesson-miss-astrophysics | adversarial-miss | — | — | 91 |
| lesson-miss-falconry | adversarial-miss | — | — | 89 |
| lesson-cross-integration-test-backoff | cross-topic | 1,2,5,6,7,8,10 | clean | 85 |
| lesson-cross-sprint-11-closeout | cross-topic | — | no-relevant-hit | 93 |
| lesson-cross-workflow-gate | cross-topic | 2,9 | clean | 97 |
| lesson-cross-agent-bootstrap-e2e | cross-topic | 1,3 | clean | 92 |
| lesson-ambig-measurement-methodology | ambiguous-multi-target | 2,8,10 | clean | 100 |
| lesson-ambig-dedup-key-design | ambiguous-multi-target | 1,2,3,4 | clean | 98 |
| lesson-ambig-review-impl-default | ambiguous-multi-target | 1,2 | clean | 97 |
| lesson-ambig-popularity-feedback | ambiguous-multi-target | 1,2 | clean | 94 |
| lesson-ambig-baseline-drift | ambiguous-multi-target | 1,5 | clean | 95 |
| lesson-ambig-numeric-edge-cases | ambiguous-multi-target | 1,9 | clean | 93 |
| lesson-ambig-test-infra-async | ambiguous-multi-target | 1,2 | clean | 92 |
| lesson-ambig-noise-floor | ambiguous-multi-target | 1,2,4,5 | clean | 95 |
| lesson-ambig-downstream-propagation | ambiguous-multi-target | 1,7,9 | clean | 97 |
| lesson-ambig-fire-and-forget-pool | ambiguous-multi-target | 1,2 | clean | 98 |
| lesson-ambig-multi-project-isolation | ambiguous-multi-target | 1,5 | clean | 91 |
| lesson-ambig-composite-relevance | ambiguous-multi-target | 1,4 | clean | 84 |
| lesson-ambig-content-empty-dedup | ambiguous-multi-target | 1,2,8 | clean | 137 |
| lesson-ambig-recency-frequency-retrieval | ambiguous-multi-target | 2 | clean | 89 |
| lesson-ambig-dedup-e2e-testing | ambiguous-multi-target | 1,3 | clean | 92 |
| lesson-para-pg-map-miss | semantic-paraphrase | 1 | clean | 91 |
| lesson-para-undici-node-mismatch | semantic-paraphrase | — | no-relevant-hit | 93 |
| lesson-para-nan-defensive-math | semantic-paraphrase | 1 | clean | 88 |
| lesson-para-new-test-not-running | semantic-paraphrase | 1 | clean | 88 |
| lesson-para-windows-python-newlines | semantic-paraphrase | 1 | clean | 104 |
| lesson-edge-multi-hop-1 | edge-multi-hop | — | no-relevant-hit | 92 |
| lesson-edge-multi-hop-2 | edge-multi-hop | 1,2,7 | clean | 85 |
| lesson-edge-no-answer-1 | edge-no-answer | — | — | 90 |
| lesson-edge-contradictory-1 | edge-contradictory | 1 | clean | 88 |
| lesson-edge-contradictory-2 | edge-contradictory | — | no-relevant-hit | 87 |
| lesson-edge-paraphrase-1 | edge-paraphrase | 1 | clean | 102 |
| lesson-edge-paraphrase-2 | edge-paraphrase | 1 | clean | 92 |
| lesson-edge-distractor-1 | edge-distractor | 1 | clean | 89 |

## code — per-query detail

| id | group | found@ | friction | p50 ms |
|---|---|---|---|---:|
| auth-workspace-token-validate | mcp-auth | — | no-relevant-hit | 2740 |
| mcp-streamable-http-endpoint | mcp-server | 8 | rank-order-inversion | 212 |
| index-project-main-pipeline | indexing | 7 | rank-order-inversion | 3086 |
| ignore-rules-loading | indexing | 1 | clean | 70 |
| embedding-request-shape | embeddings | — | no-relevant-hit | 2445 |
| project-snapshot-rebuild | snapshots | 1,3 | clean | 61 |
| kg-bootstrap | kg | 2,5 | clean | 68 |
| kg-upsert-from-indexer | kg | 1 | clean | 68 |
| kg-ts-morph-extractor | kg | 1 | clean | 3979 |
| kg-query-tools | kg | — | no-relevant-hit | 4121 |
| lessons-storage-and-search | lessons | 8 | rank-order-inversion | 2134 |
| guardrails-check | guardrails | 1,3 | clean | 2128 |
| git-ingest-core | git | 7 | rank-order-inversion | 3266 |
| git-deleted-files-handling | git | 2 | clean | 73 |
| git-proposal-upsert-idempotent | git | 3,4 | clean | 2928 |
| repo-source-config | sources | 2 | clean | 60 |
| prepare-repo-clone-fetch-checkout | sources | 10 | rank-order-inversion | 2495 |
| s3-source-artifacts | sources | 1 | clean | 70 |
| job-queue-postgres-claim | queue | 1 | clean | 63 |
| job-queue-rabbitmq | queue | 1,4 | clean | 2522 |
| job-executor-dispatch | queue | 9 | rank-order-inversion | 3059 |
| workspace-scan-porcelain | workspace | 4 | rank-order-inversion | 3689 |
| env-schema-queue-s3 | config | 3 | clean | 61 |
| migrations-git-intelligence | db | — | no-relevant-hit | 61 |
| migrations-sources-jobs | db | — | no-relevant-hit | 2432 |
| tool-output-formatting | mcp-server | — | no-relevant-hit | 3088 |
| output-format-parser-smoke | mcp-server | — | no-relevant-hit | 4619 |
| env-boolean-parser | config | 1 | clean | 76 |
| mcp-tool-registrations | mcp-server | — | no-relevant-hit | 54 |
| db-migrations-apply | db | 1 | clean | 57 |
| db-pool-singleton | db | 1 | clean | 57 |
| guardrails-storage | guardrails | 1 | clean | 65 |
| lessons-distillation-enabled | lessons | 1,4 | clean | 62 |
| distiller-commit-suggestion-schema | distillation | 1 | clean | 58 |
| job-correlation-filter | queue | 4 | rank-order-inversion | 3614 |
| rabbitmq-queue-assert-bind | queue | — | no-relevant-hit | 3414 |
| worker-rabbitmq-consumer | queue | 1 | clean | 2820 |
| worker-fallback-postgres-polling | queue | 6 | rank-order-inversion | 69 |
| repo-sync-fanout | queue | 4 | rank-order-inversion | 3727 |
| project-sources-schema | sources | — | no-relevant-hit | 2730 |
| workspace-deltas-schema | workspace | — | no-relevant-hit | 3847 |
| scan-workspace-delta-index | workspace | 5,10 | rank-order-inversion | 2114 |
| delete-workspace-cascades | storage | — | no-relevant-hit | 2780 |
| kg-ids-deterministic | kg | — | no-relevant-hit | 2582 |
| kg-linker-lessons | kg | 1 | clean | 64 |
| kg-project-graph-delete | kg | 3 | clean | 56 |
| git-impact-analysis | git | 4 | rank-order-inversion | 3124 |
| git-link-commit-to-lesson | git | 6 | rank-order-inversion | 2613 |
| git-proposal-sanitization | git | — | no-relevant-hit | 3780 |
| mcp-health-endpoint | mcp-server | — | no-relevant-hit | 66 |
| mcp-output-format-default | mcp-server | — | no-relevant-hit | 2917 |
| config-default-project-id | config | 1 | clean | 2648 |
| config-env-loading-dotenv | config | 1 | clean | 63 |
| config-embeddings-base-url | embeddings | 1 | clean | 3408 |
| config-embeddings-api-key | embeddings | 10 | rank-order-inversion | 60 |
| config-distillation-enabled | distillation | 1 | clean | 63 |
| config-kg-enabled | kg | 2,5 | clean | 54 |
| auth-tool-wrapper | mcp-auth | 3 | clean | 3059 |
| auth-workspace-token-env | mcp-auth | — | no-relevant-hit | 57 |
| indexer-chunk-size-config | indexing | — | no-relevant-hit | 2857 |
| retriever-search-code-boosts | retrieval | 6 | rank-order-inversion | 3264 |
| retriever-default-excludes | retrieval | 2 | clean | 3127 |
| queue-backend-selection | queue | 1,2 | clean | 66 |
| queue-job-types | queue | 1,3 | clean | 67 |
| smoke-queue-tools-block | smoke | 2 | clean | 3813 |
| ci-phase5-worker-validation-workflow | ci | — | no-relevant-hit | 3859 |
| ci-mock-embeddings-server | ci | — | no-relevant-hit | 60 |
| code-edge-multi-hop-1 | edge-multi-hop | 7 | rank-order-inversion | 3507 |
| code-edge-no-answer-1 | edge-no-answer | — | — | 2756 |
| code-edge-no-answer-2 | edge-no-answer | — | — | 65 |
| code-edge-contradictory-1 | edge-contradictory | — | no-relevant-hit | 61 |
| code-edge-contradictory-2 | edge-contradictory | — | no-relevant-hit | 62 |
| code-edge-paraphrase-1 | edge-paraphrase | — | no-relevant-hit | 56 |
| code-edge-paraphrase-2 | edge-paraphrase | — | no-relevant-hit | 56 |
| code-edge-distractor-1 | edge-distractor | 2 | clean | 73 |
| code-edge-distractor-2 | edge-distractor | — | no-relevant-hit | 52 |
| code-edge-distractor-3 | edge-distractor | — | no-relevant-hit | 52 |

## chunks — per-query detail

| id | group | found@ | friction | p50 ms |
|---|---|---|---|---:|
| chunk-retry-strategy-overview | confident-hit | 1 | clean | 45 |
| chunk-retry-config-table | confident-hit | 1 | clean | 41 |
| chunk-retry-implementation-code | confident-hit | 1 | clean | 41 |
| chunk-authentication-overview | confident-hit | 1 | clean | 43 |
| chunk-role-definitions | confident-hit | 1 | clean | 46 |
| chunk-data-storage-pgvector | confident-hit | 1 | clean | 41 |
| chunk-adr-intro-dup | duplicate-trap | 1,2 | clean | 39 |
| chunk-cross-retry-auth-storage | cross-topic | 3,5,6 | clean | 41 |
| chunk-miss-quantum | adversarial-miss | — | — | 40 |
| chunk-miss-jazz | adversarial-miss | — | — | 46 |
| chunk-edge-multi-hop-1 | edge-multi-hop | 1,2,4 | clean | 43 |
| chunk-edge-no-answer-1 | edge-no-answer | — | — | 44 |
| chunk-edge-distractor-1 | edge-distractor | 1 | clean | 40 |

## global — per-query detail

| id | group | found@ | friction | p50 ms |
|---|---|---|---|---:|
| global-retry-substr | confident-hit | 3 | clean | 32 |
| global-validation-substr | confident-hit | 9 | rank-order-inversion | 4 |
| global-authentication-substr | confident-hit | 1 | clean | 3 |
| global-max-retry-substr | confident-hit | 2 | clean | 3 |
| global-architecture-substr | confident-hit | 1,2 | clean | 3 |
| global-pgvector-substr | confident-hit | 2 | clean | 4 |
| global-review-impl-substr | confident-hit | — | no-relevant-hit | 6 |
| global-undici-substr | confident-hit | 3 | clean | 3 |
| global-workspace-substr | coverage-probe | — | — | 3 |
| global-miss-zephyr | adversarial-miss | — | empty-result-set | 4 |
| global-edge-multi-hop-1 | edge-multi-hop | — | empty-result-set;no-relevant-hit | 3 |
| global-edge-no-answer-1 | edge-no-answer | — | empty-result-set | 4 |
| global-edge-contradictory-1 | edge-contradictory | — | no-relevant-hit | 3 |
| global-edge-paraphrase-1 | edge-paraphrase | — | empty-result-set;no-relevant-hit | 3 |

## Friction observed (top examples)

_(showing up to 3 per surface; 53 total queries have flagged friction across all surfaces)_

- **lessons/lesson-cross-sprint-11-closeout** — no-relevant-hit: query `sprint 11.6c-sec DNS pinning body-stall timeout security polish`; top-3 keys=[96cd0dc1-920c-420e-a703-1d9dca5e4e04, 206e30df-829a-46f1-b51e-93145f9105fb, 5c0b7b25-4a93-4961-bf64-e0c967438b24]
- **lessons/lesson-para-undici-node-mismatch** — no-relevant-hit: query `why does swapping http agents between the default and an installed one break str`; top-3 keys=[e15edaef-1d63-4cff-a9cc-7f972a0887d5, 5ab3a1ba-b0b4-481c-997a-5b0f61138d63, eb7409e5-d2bf-407b-9811-fca62a2c3ded]
- **lessons/lesson-edge-multi-hop-1** — no-relevant-hit: query `What two patterns combine for safe state-transition testing in coordination laye`; top-3 keys=[4e2b8497-8d8b-4d33-bd2d-1ffd2d66c860, 45c8cb44-9fb8-4dad-b825-5b1cd8b0a108, eb7409e5-d2bf-407b-9811-fca62a2c3ded]
- **code/auth-workspace-token-validate** — no-relevant-hit: query `Where is workspace_token validated for MCP tool calls?`; top-3 keys=[src/mcp/index.ts, src/smoke/phase5WorkerValidation.ts, src/mcp/formatters.ts]
- **code/mcp-streamable-http-endpoint** — rank-order-inversion: query `Where is the MCP HTTP endpoint implemented and what routes are exposed?`; top-3 keys=[src/qc/integrationTestRunner.ts, src/mcp/index.ts, src/qc/ragQcRunner.ts]
- **code/index-project-main-pipeline** — rank-order-inversion: query `How does index_project discover files, chunk them, embed, and write to Postgres?`; top-3 keys=[packages/mcp-client/src/index.ts, packages/mcp-client/src/rest-client.ts, src/worker.ts]
- **global/global-validation-substr** — rank-order-inversion: query `validation`; top-3 keys=[lesson:61835c5d-d5c8-4d61-9fa0-3497aadee229, lesson:476aeed0-8363-4630-bd07-faf0edc573ba, lesson:44e38b7e-0ef9-4b0f-9754-d5dcc09f4e4d]
- **global/global-review-impl-substr** — no-relevant-hit: query `review-impl`; top-3 keys=[lesson:7c632d4b-1486-4b11-910c-5214ad9e2d7d, guardrail:5287a774-5761-412f-a150-31db7f2b3880, lesson:f47de748-7a78-44e9-af6f-ef3f7a324004]
- **global/global-miss-zephyr** — empty-result-set: query `zephyr-ninja-pyramid-2026`; top-3 keys=[]

## Known limitations

- Latency varies ±10–20% across runs; quality metrics are deterministic.
- Global surface uses REST /api/search/global (ILIKE, not semantic); recall floor comes from raw substring matching.
- Code surface requires an indexed `chunks` population; empty index → 0 coverage regardless of query quality.
- `duplication_rate_at_10` v0 keys on exact entity id. Same-title-different-UUID noise (the original Phase-12 motivation: multiple lesson rows titled "Global search test retry pattern") is invisible to v0 — a reader seeing `dup@10 = 0` should NOT conclude "no duplication"; see `snippet-redundancy` in `docs/qc/friction-classes.md`.
- Golden-set ceiling bias: lesson queries are paraphrases of lesson content, and target ids were cherry-picked from recently-active lessons. Reported `recall@10 = 1.0` may reflect "queries are easy" rather than "retriever is strong." Sprint 12.1 should add adversarial queries (synonyms, typos, indirect references) to distinguish real improvement from noise.
