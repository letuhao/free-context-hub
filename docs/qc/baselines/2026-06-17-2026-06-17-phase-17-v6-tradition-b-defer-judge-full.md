---
tag: 2026-06-17-phase-17-v6-tradition-b-defer-judge-full
commit: faa114d+dirty
branch: deferred-030-rerank-quality
run_at: 2026-06-17T07:40:06.251Z
elapsed_ms: 3119445
project_id_primary: free-context-hub
---

# RAG Baseline — 2026-06-17-phase-17-v6-tradition-b-defer-judge-full

## Gen-eval manifest

- **answerer:** `mistralai/mistral-nemo-instruct-2407` @ `http://localhost:1234/v1` (temp=0.2, seed=42, max_tokens=1024)
- **judge:** `google/gemma-4-26b-a4b` @ `http://host.docker.internal:1234/v1` (temp=0, seed=42)
- **judge prompts hash:** `c0165a73c10c4e04`
- **synthesizer template hashes:**
  - lessons: `13ac4e950489bde6`
  - code: `3a2ea1624ae0a1fc`
  - chunks: `a01005e0d102b2c1`
  - global: `5ae7c8e925ad8a47`

## Summary (all surfaces)

| Surface | Project | Q | err | recall@5 | recall@10 | MRR | nDCG@5 | nDCG@10 | dup@10 | dup@10 nearsem | cov% | p50 ms | p95 ms |
|---|---|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|
| lessons | free-context-hub | 48 | 0 | 0.8889 | 0.8889 | 0.8556 | 0.8447 | 0.8261 | 0 | 0 | 0.8889 | 84 | 92 |
| code | free-context-hub | 77 | 0 | 0.5065 | 0.6104 | 0.4015 | 0.4132 | 0.4472 | 0 | 0 | 0.6104 | 2107 | 3883 |
| chunks | free-context-hub | 13 | 0 | 0.9091 | 0.9091 | 0.8485 | 0.8498 | 0.8534 | 0 | 0 | 0.9091 | 35 | 53 |
| global | free-context-hub | 14 | 0 | 0.4615 | 0.5385 | 0.2906 | 0.3278 | 0.351 | 0 | 0.15 | 0.5385 | 3 | 4 |

## Gen-eval summary (per surface)

| Surface | rows w/ gt | rows judged | faithfulness | answer_relevancy | context_precision | context_recall | refusal_correctness | groundedness_self_eval |
|---|---:|---:|---:|---:|---:|---:|---:|---:|
| lessons | 48 | 48 | 0.66 ±0.30 (26 fail) | 0.83 ±0.13 (17 fail) | 0.83 ±0.34 (10 fail) | 0.65 ±0.32 (25 fail) | 0.75 ±0.43 (1 fail) | 0.84 ±0.26 (15 fail) |
| code | 77 | 77 | 0.56 ±0.35 (56 fail) | 0.74 ±0.31 (39 fail) | 0.12 ±0.30 (69 fail) | 0.06 ±0.14 (76 fail) | 0.00 ±0.00 (2 fail) | 0.72 ±0.30 (44 fail) |
| chunks | 13 | 13 | 0.94 ±0.14 (2 fail) | 0.80 ±0.13 (6 fail) | 0.56 ±0.42 (8 fail) | 0.40 ±0.39 (10 fail) | 0.33 ±0.47 (2 fail) | 0.84 ±0.29 (4 fail) |
| global | 14 | 10 | 0.44 ±0.18 (9 fail) | 0.54 ±0.18 (9 fail) | 0.49 ±0.39 (7 fail) | 0.33 ±0.29 (10 fail) | 0.00 ±0.00 (1 fail) | 0.43 ±0.29 (9 fail) |

_Thresholds (WARN-only): faithfulness ≥ 0.9 · answer_relevancy ≥ 0.85 · context_precision ≥ 0.8 · context_recall ≥ 0.75 · refusal_correctness ≥ 0.75 · groundedness_self_eval ≥ 0.85_

### Gen-eval threshold violations

**lessons** (43):
  - `lesson-pyenv-python3-shim` — answer_relevancy<0.85
  - `lesson-npm-test-silent-skip` — answer_relevancy<0.85
  - `lesson-review-impl-default` — groundedness_self_eval<0.85
  - `lesson-noproject-guard-hydration` — faithfulness<0.9, answer_relevancy<0.85
  - `lesson-project-crud-validation` — faithfulness<0.9, context_recall<0.75
  - _(+38 more)_

**code** (77):
  - `auth-workspace-token-validate` — answer_relevancy<0.85, context_precision<0.8, context_recall<0.75
  - `mcp-streamable-http-endpoint` — faithfulness<0.9, context_precision<0.8, context_recall<0.75, groundedness_self_eval<0.85
  - `index-project-main-pipeline` — faithfulness<0.9, answer_relevancy<0.85, context_precision<0.8, context_recall<0.75, groundedness_self_eval<0.85
  - `ignore-rules-loading` — faithfulness<0.9, context_precision<0.8, context_recall<0.75, groundedness_self_eval<0.85
  - `embedding-request-shape` — faithfulness<0.9, context_precision<0.8, context_recall<0.75, groundedness_self_eval<0.85
  - _(+72 more)_

**chunks** (13):
  - `chunk-retry-strategy-overview` — context_precision<0.8, context_recall<0.75
  - `chunk-retry-config-table` — answer_relevancy<0.85, context_precision<0.8, context_recall<0.75
  - `chunk-retry-implementation-code` — faithfulness<0.9, context_precision<0.8, context_recall<0.75, groundedness_self_eval<0.85
  - `chunk-authentication-overview` — faithfulness<0.9, answer_relevancy<0.85, context_recall<0.75
  - `chunk-role-definitions` — answer_relevancy<0.85, context_precision<0.8, context_recall<0.75, groundedness_self_eval<0.85
  - _(+8 more)_

**global** (10):
  - `global-retry-substr` — faithfulness<0.9, answer_relevancy<0.85, context_precision<0.8, context_recall<0.75, groundedness_self_eval<0.85
  - `global-validation-substr` — faithfulness<0.9, answer_relevancy<0.85, context_precision<0.8, context_recall<0.75, groundedness_self_eval<0.85
  - `global-authentication-substr` — faithfulness<0.9, answer_relevancy<0.85, context_recall<0.75, groundedness_self_eval<0.85
  - `global-max-retry-substr` — faithfulness<0.9, answer_relevancy<0.85, context_precision<0.8, context_recall<0.75, groundedness_self_eval<0.85
  - `global-architecture-substr` — faithfulness<0.9, answer_relevancy<0.85, context_recall<0.75
  - _(+5 more)_


## lessons — per-query detail

| id | group | found@ | friction | p50 ms |
|---|---|---|---|---:|
| lesson-pg-uuid-casing | confident-hit | 1 | clean | 89 |
| lesson-undici-version-pinning | confident-hit | 1 | clean | 87 |
| lesson-pyenv-python3-shim | confident-hit | 1 | clean | 86 |
| lesson-npm-test-silent-skip | confident-hit | 1 | clean | 97 |
| lesson-api-lessons-items-shape | confident-hit | 1 | clean | 84 |
| lesson-review-impl-default | confident-hit | 1 | clean | 87 |
| lesson-noproject-guard-hydration | confident-hit | 1 | clean | 85 |
| lesson-project-crud-validation | confident-hit | 1 | clean | 87 |
| lesson-multi-project-color | confident-hit | 1 | clean | 83 |
| lesson-code-review-workflow-pref | confident-hit | 1 | clean | 86 |
| lesson-dup-max-retry-guardrail | duplicate-trap | 1,2,3,4,5 | clean | 80 |
| lesson-dup-global-search-retry-pattern | duplicate-trap | 1,2 | clean | 81 |
| lesson-dup-valid-impexp-fixture | duplicate-trap | 1,2,3,4,5 | clean | 82 |
| lesson-miss-unicorn | adversarial-miss | — | — | 86 |
| lesson-miss-astrophysics | adversarial-miss | — | — | 81 |
| lesson-miss-falconry | adversarial-miss | — | — | 85 |
| lesson-cross-integration-test-backoff | cross-topic | 1,2,5,6,7,8,10 | clean | 85 |
| lesson-cross-sprint-11-closeout | cross-topic | — | no-relevant-hit | 83 |
| lesson-cross-workflow-gate | cross-topic | 2,9 | clean | 83 |
| lesson-cross-agent-bootstrap-e2e | cross-topic | 1,3 | clean | 84 |
| lesson-ambig-measurement-methodology | ambiguous-multi-target | 2,8,10 | clean | 83 |
| lesson-ambig-dedup-key-design | ambiguous-multi-target | 1,2,3,4 | clean | 87 |
| lesson-ambig-review-impl-default | ambiguous-multi-target | 1,2 | clean | 87 |
| lesson-ambig-popularity-feedback | ambiguous-multi-target | 1,2 | clean | 87 |
| lesson-ambig-baseline-drift | ambiguous-multi-target | 1,5 | clean | 82 |
| lesson-ambig-numeric-edge-cases | ambiguous-multi-target | 1,9 | clean | 85 |
| lesson-ambig-test-infra-async | ambiguous-multi-target | 1,2 | clean | 81 |
| lesson-ambig-noise-floor | ambiguous-multi-target | 1,2,4,5 | clean | 83 |
| lesson-ambig-downstream-propagation | ambiguous-multi-target | 1,7,9 | clean | 84 |
| lesson-ambig-fire-and-forget-pool | ambiguous-multi-target | 1,2 | clean | 83 |
| lesson-ambig-multi-project-isolation | ambiguous-multi-target | 1,5 | clean | 81 |
| lesson-ambig-composite-relevance | ambiguous-multi-target | 1,4 | clean | 82 |
| lesson-ambig-content-empty-dedup | ambiguous-multi-target | 1,2,8 | clean | 81 |
| lesson-ambig-recency-frequency-retrieval | ambiguous-multi-target | 2 | clean | 84 |
| lesson-ambig-dedup-e2e-testing | ambiguous-multi-target | 1,3 | clean | 85 |
| lesson-para-pg-map-miss | semantic-paraphrase | 1 | clean | 81 |
| lesson-para-undici-node-mismatch | semantic-paraphrase | — | no-relevant-hit | 83 |
| lesson-para-nan-defensive-math | semantic-paraphrase | 1 | clean | 84 |
| lesson-para-new-test-not-running | semantic-paraphrase | 1 | clean | 80 |
| lesson-para-windows-python-newlines | semantic-paraphrase | 1 | clean | 89 |
| lesson-edge-multi-hop-1 | edge-multi-hop | — | no-relevant-hit | 84 |
| lesson-edge-multi-hop-2 | edge-multi-hop | 1,2,7 | clean | 79 |
| lesson-edge-no-answer-1 | edge-no-answer | — | — | 89 |
| lesson-edge-contradictory-1 | edge-contradictory | 1 | clean | 81 |
| lesson-edge-contradictory-2 | edge-contradictory | — | no-relevant-hit | 83 |
| lesson-edge-paraphrase-1 | edge-paraphrase | 1 | clean | 90 |
| lesson-edge-paraphrase-2 | edge-paraphrase | 1 | clean | 85 |
| lesson-edge-distractor-1 | edge-distractor | 1 | clean | 82 |

## code — per-query detail

| id | group | found@ | friction | p50 ms |
|---|---|---|---|---:|
| auth-workspace-token-validate | mcp-auth | — | no-relevant-hit | 2519 |
| mcp-streamable-http-endpoint | mcp-server | 8 | rank-order-inversion | 51 |
| index-project-main-pipeline | indexing | 5 | rank-order-inversion | 3139 |
| ignore-rules-loading | indexing | 1 | clean | 70 |
| embedding-request-shape | embeddings | — | no-relevant-hit | 2439 |
| project-snapshot-rebuild | snapshots | 1,3 | clean | 49 |
| kg-bootstrap | kg | 2,5 | clean | 47 |
| kg-upsert-from-indexer | kg | 1 | clean | 48 |
| kg-ts-morph-extractor | kg | 1 | clean | 3898 |
| kg-query-tools | kg | — | no-relevant-hit | 3887 |
| lessons-storage-and-search | lessons | 8 | rank-order-inversion | 2162 |
| guardrails-check | guardrails | 3 | clean | 2111 |
| git-ingest-core | git | 8 | rank-order-inversion | 3152 |
| git-deleted-files-handling | git | 2 | clean | 56 |
| git-proposal-upsert-idempotent | git | 3,4 | clean | 2816 |
| repo-source-config | sources | 2 | clean | 55 |
| prepare-repo-clone-fetch-checkout | sources | 1 | clean | 2476 |
| s3-source-artifacts | sources | 1 | clean | 54 |
| job-queue-postgres-claim | queue | 1 | clean | 48 |
| job-queue-rabbitmq | queue | 1,3 | clean | 2411 |
| job-executor-dispatch | queue | 1 | clean | 3185 |
| workspace-scan-porcelain | workspace | 1 | clean | 3812 |
| env-schema-queue-s3 | config | 3 | clean | 49 |
| migrations-git-intelligence | db | — | no-relevant-hit | 49 |
| migrations-sources-jobs | db | — | no-relevant-hit | 2456 |
| tool-output-formatting | mcp-server | — | no-relevant-hit | 3057 |
| output-format-parser-smoke | mcp-server | — | no-relevant-hit | 3825 |
| env-boolean-parser | config | 1 | clean | 51 |
| mcp-tool-registrations | mcp-server | — | no-relevant-hit | 48 |
| db-migrations-apply | db | 1 | clean | 49 |
| db-pool-singleton | db | 1 | clean | 50 |
| guardrails-storage | guardrails | 1 | clean | 50 |
| lessons-distillation-enabled | lessons | 1,4 | clean | 54 |
| distiller-commit-suggestion-schema | distillation | 1 | clean | 55 |
| job-correlation-filter | queue | 4 | rank-order-inversion | 3725 |
| rabbitmq-queue-assert-bind | queue | — | no-relevant-hit | 3529 |
| worker-rabbitmq-consumer | queue | 1 | clean | 2780 |
| worker-fallback-postgres-polling | queue | 6 | rank-order-inversion | 51 |
| repo-sync-fanout | queue | 5 | rank-order-inversion | 3661 |
| project-sources-schema | sources | — | no-relevant-hit | 2765 |
| workspace-deltas-schema | workspace | — | no-relevant-hit | 3936 |
| scan-workspace-delta-index | workspace | 3 | clean | 2146 |
| delete-workspace-cascades | storage | — | no-relevant-hit | 2763 |
| kg-ids-deterministic | kg | — | no-relevant-hit | 2495 |
| kg-linker-lessons | kg | 1 | clean | 56 |
| kg-project-graph-delete | kg | 3 | clean | 49 |
| git-impact-analysis | git | 6 | rank-order-inversion | 3218 |
| git-link-commit-to-lesson | git | 8 | rank-order-inversion | 2905 |
| git-proposal-sanitization | git | — | no-relevant-hit | 3862 |
| mcp-health-endpoint | mcp-server | — | no-relevant-hit | 56 |
| mcp-output-format-default | mcp-server | — | no-relevant-hit | 2447 |
| config-default-project-id | config | 1,2 | clean | 2839 |
| config-env-loading-dotenv | config | 1 | clean | 47 |
| config-embeddings-base-url | embeddings | 2 | clean | 3402 |
| config-embeddings-api-key | embeddings | 10 | rank-order-inversion | 55 |
| config-distillation-enabled | distillation | 1 | clean | 46 |
| config-kg-enabled | kg | 2,5 | clean | 50 |
| auth-tool-wrapper | mcp-auth | 2 | clean | 3027 |
| auth-workspace-token-env | mcp-auth | — | no-relevant-hit | 51 |
| indexer-chunk-size-config | indexing | — | no-relevant-hit | 2884 |
| retriever-search-code-boosts | retrieval | 6 | rank-order-inversion | 3533 |
| retriever-default-excludes | retrieval | — | no-relevant-hit | 3212 |
| queue-backend-selection | queue | 1,2 | clean | 53 |
| queue-job-types | queue | 1,3 | clean | 53 |
| smoke-queue-tools-block | smoke | 1 | clean | 3883 |
| ci-phase5-worker-validation-workflow | ci | — | no-relevant-hit | 3781 |
| ci-mock-embeddings-server | ci | — | no-relevant-hit | 51 |
| code-edge-multi-hop-1 | edge-multi-hop | — | no-relevant-hit | 3536 |
| code-edge-no-answer-1 | edge-no-answer | — | — | 2787 |
| code-edge-no-answer-2 | edge-no-answer | — | — | 49 |
| code-edge-contradictory-1 | edge-contradictory | — | no-relevant-hit | 51 |
| code-edge-contradictory-2 | edge-contradictory | — | no-relevant-hit | 54 |
| code-edge-paraphrase-1 | edge-paraphrase | — | no-relevant-hit | 50 |
| code-edge-paraphrase-2 | edge-paraphrase | — | no-relevant-hit | 48 |
| code-edge-distractor-1 | edge-distractor | 2 | clean | 55 |
| code-edge-distractor-2 | edge-distractor | — | no-relevant-hit | 42 |
| code-edge-distractor-3 | edge-distractor | — | no-relevant-hit | 52 |

## chunks — per-query detail

| id | group | found@ | friction | p50 ms |
|---|---|---|---|---:|
| chunk-retry-strategy-overview | confident-hit | 1 | clean | 38 |
| chunk-retry-config-table | confident-hit | 1 | clean | 39 |
| chunk-retry-implementation-code | confident-hit | 1 | clean | 33 |
| chunk-authentication-overview | confident-hit | 1 | clean | 34 |
| chunk-role-definitions | confident-hit | 1 | clean | 33 |
| chunk-data-storage-pgvector | confident-hit | 1 | clean | 35 |
| chunk-adr-intro-dup | duplicate-trap | 1,2 | clean | 36 |
| chunk-cross-retry-auth-storage | cross-topic | 3,5,6 | clean | 34 |
| chunk-miss-quantum | adversarial-miss | — | — | 44 |
| chunk-miss-jazz | adversarial-miss | — | — | 32 |
| chunk-edge-multi-hop-1 | edge-multi-hop | 1,2,4 | clean | 34 |
| chunk-edge-no-answer-1 | edge-no-answer | — | — | 38 |
| chunk-edge-distractor-1 | edge-distractor | 1 | clean | 35 |

## global — per-query detail

| id | group | found@ | friction | p50 ms |
|---|---|---|---|---:|
| global-retry-substr | confident-hit | 3 | clean | 8 |
| global-validation-substr | confident-hit | 9 | rank-order-inversion | 3 |
| global-authentication-substr | confident-hit | 1 | clean | 3 |
| global-max-retry-substr | confident-hit | 2 | clean | 2 |
| global-architecture-substr | confident-hit | 1,2 | clean | 3 |
| global-pgvector-substr | confident-hit | 2 | clean | 3 |
| global-review-impl-substr | confident-hit | — | no-relevant-hit | 3 |
| global-undici-substr | confident-hit | 3 | clean | 3 |
| global-workspace-substr | coverage-probe | — | — | 4 |
| global-miss-zephyr | adversarial-miss | — | empty-result-set | 3 |
| global-edge-multi-hop-1 | edge-multi-hop | — | empty-result-set;no-relevant-hit | 3 |
| global-edge-no-answer-1 | edge-no-answer | — | empty-result-set | 3 |
| global-edge-contradictory-1 | edge-contradictory | — | no-relevant-hit | 3 |
| global-edge-paraphrase-1 | edge-paraphrase | — | empty-result-set;no-relevant-hit | 3 |

## Friction observed (top examples)

_(showing up to 3 per surface; 50 total queries have flagged friction across all surfaces)_

- **lessons/lesson-cross-sprint-11-closeout** — no-relevant-hit: query `sprint 11.6c-sec DNS pinning body-stall timeout security polish`; top-3 keys=[96cd0dc1-920c-420e-a703-1d9dca5e4e04, 206e30df-829a-46f1-b51e-93145f9105fb, 5c0b7b25-4a93-4961-bf64-e0c967438b24]
- **lessons/lesson-para-undici-node-mismatch** — no-relevant-hit: query `why does swapping http agents between the default and an installed one break str`; top-3 keys=[e15edaef-1d63-4cff-a9cc-7f972a0887d5, 5ab3a1ba-b0b4-481c-997a-5b0f61138d63, eb7409e5-d2bf-407b-9811-fca62a2c3ded]
- **lessons/lesson-edge-multi-hop-1** — no-relevant-hit: query `What two patterns combine for safe state-transition testing in coordination laye`; top-3 keys=[4e2b8497-8d8b-4d33-bd2d-1ffd2d66c860, 45c8cb44-9fb8-4dad-b825-5b1cd8b0a108, eb7409e5-d2bf-407b-9811-fca62a2c3ded]
- **code/auth-workspace-token-validate** — no-relevant-hit: query `Where is workspace_token validated for MCP tool calls?`; top-3 keys=[src/smoke/phase5WorkerValidation.ts, src/core/auth.ts, src/smoke/smokeTest.ts]
- **code/mcp-streamable-http-endpoint** — rank-order-inversion: query `Where is the MCP HTTP endpoint implemented and what routes are exposed?`; top-3 keys=[src/qc/integrationTestRunner.ts, src/mcp/index.ts, src/qc/ragQcRunner.ts]
- **code/index-project-main-pipeline** — rank-order-inversion: query `How does index_project discover files, chunk them, embed, and write to Postgres?`; top-3 keys=[packages/mcp-client/src/index.ts, gui/src/app/documents/chunk-search-panel.tsx, gui/src/app/documents/mermaid-chunk.tsx]
- **global/global-validation-substr** — rank-order-inversion: query `validation`; top-3 keys=[lesson:61835c5d-d5c8-4d61-9fa0-3497aadee229, lesson:476aeed0-8363-4630-bd07-faf0edc573ba, lesson:44e38b7e-0ef9-4b0f-9754-d5dcc09f4e4d]
- **global/global-review-impl-substr** — no-relevant-hit: query `review-impl`; top-3 keys=[lesson:7c632d4b-1486-4b11-910c-5214ad9e2d7d, guardrail:5287a774-5761-412f-a150-31db7f2b3880, lesson:f47de748-7a78-44e9-af6f-ef3f7a324004]
- **global/global-miss-zephyr** — empty-result-set: query `zephyr-ninja-pyramid-2026`; top-3 keys=[]

## Known limitations

- Latency varies ±10–20% across runs; quality metrics are deterministic.
- Global surface uses REST /api/search/global (ILIKE, not semantic); recall floor comes from raw substring matching.
- Code surface requires an indexed `chunks` population; empty index → 0 coverage regardless of query quality.
- `duplication_rate_at_10` v0 keys on exact entity id. Same-title-different-UUID noise (the original Phase-12 motivation: multiple lesson rows titled "Global search test retry pattern") is invisible to v0 — a reader seeing `dup@10 = 0` should NOT conclude "no duplication"; see `snippet-redundancy` in `docs/qc/friction-classes.md`.
- Golden-set ceiling bias: lesson queries are paraphrases of lesson content, and target ids were cherry-picked from recently-active lessons. Reported `recall@10 = 1.0` may reflect "queries are easy" rather than "retriever is strong." Sprint 12.1 should add adversarial queries (synonyms, typos, indirect references) to distinguish real improvement from noise.
