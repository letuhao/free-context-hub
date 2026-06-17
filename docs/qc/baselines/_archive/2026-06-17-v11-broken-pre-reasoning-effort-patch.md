---
tag: 2026-06-17-phase-17-v11-hybrid-tradition-b-defer-judge-full
commit: d368586+dirty
branch: v11-hybrid-templates
run_at: 2026-06-17T10:18:11.933Z
elapsed_ms: 8085644
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
| lessons | free-context-hub | 48 | 0 | 0.8889 | 0.8889 | 0.8556 | 0.8447 | 0.8261 | 0 | 0 | 0.8889 | 85 | 98 |
| code | free-context-hub | 77 | 0 | 0.5325 | 0.6234 | 0.4122 | 0.4281 | 0.4575 | 0 | 0 | 0.6234 | 2079 | 3812 |
| chunks | free-context-hub | 13 | 0 | 0.9091 | 0.9091 | 0.8485 | 0.8498 | 0.8534 | 0 | 0 | 0.9091 | 37 | 55 |
| global | free-context-hub | 14 | 0 | 0.4615 | 0.5385 | 0.2906 | 0.3278 | 0.351 | 0 | 0.15 | 0.5385 | 3 | 5 |

## Gen-eval summary (per surface)

| Surface | rows w/ gt | rows judged | faithfulness | answer_relevancy | context_precision | context_recall | refusal_correctness | groundedness_self_eval |
|---|---:|---:|---:|---:|---:|---:|---:|---:|
| lessons | 48 | 48 | — | 0.82 ±0.19 (16 fail) | 0.82 ±0.36 (6 fail) | 0.67 ±0.33 (1 fail) | 0.75 ±0.43 (1 fail) | 0.86 ±0.32 (5 fail) |
| code | 77 | 77 | — | 0.85 ±0.15 (18 fail) | 0.07 ±0.24 (61 fail) | — | 0.00 ±0.00 (2 fail) | 0.82 ±0.33 (6 fail) |
| chunks | 13 | 13 | 1.00 ±0.00 | 0.80 ±0.14 (6 fail) | 0.75 ±0.43 (1 fail) | 0.67 ±0.33 (1 fail) | 0.33 ±0.47 (2 fail) | 1.00 ±0.00 |
| global | 14 | 10 | — | 0.68 ±0.07 (8 fail) | 0.31 ±0.34 (6 fail) | 0.00 ±0.00 (1 fail) | 0.00 ±0.00 (1 fail) | 0.35 ±0.41 (3 fail) |

_Thresholds (WARN-only): faithfulness ≥ 0.9 · answer_relevancy ≥ 0.85 · context_precision ≥ 0.8 · context_recall ≥ 0.75 · refusal_correctness ≥ 0.75 · groundedness_self_eval ≥ 0.85_

### Gen-eval threshold violations

**lessons** (23):
  - `lesson-pyenv-python3-shim` — answer_relevancy<0.85
  - `lesson-npm-test-silent-skip` — answer_relevancy<0.85, context_recall<0.75
  - `lesson-review-impl-default` — groundedness_self_eval<0.85
  - `lesson-noproject-guard-hydration` — answer_relevancy<0.85
  - `lesson-code-review-workflow-pref` — answer_relevancy<0.85
  - _(+18 more)_

**code** (65):
  - `auth-workspace-token-validate` — context_precision<0.8
  - `mcp-streamable-http-endpoint` — context_precision<0.8
  - `index-project-main-pipeline` — answer_relevancy<0.85, context_precision<0.8
  - `ignore-rules-loading` — context_precision<0.8
  - `embedding-request-shape` — context_precision<0.8
  - _(+60 more)_

**chunks** (8):
  - `chunk-retry-config-table` — answer_relevancy<0.85
  - `chunk-authentication-overview` — answer_relevancy<0.85
  - `chunk-role-definitions` — answer_relevancy<0.85, context_precision<0.8
  - `chunk-data-storage-pgvector` — answer_relevancy<0.85
  - `chunk-adr-intro-dup` — answer_relevancy<0.85, context_recall<0.75
  - _(+3 more)_

**global** (9):
  - `global-retry-substr` — answer_relevancy<0.85, context_precision<0.8
  - `global-validation-substr` — answer_relevancy<0.85, context_precision<0.8, groundedness_self_eval<0.85
  - `global-authentication-substr` — answer_relevancy<0.85
  - `global-max-retry-substr` — answer_relevancy<0.85, context_precision<0.8, context_recall<0.75, groundedness_self_eval<0.85
  - `global-pgvector-substr` — answer_relevancy<0.85, context_precision<0.8
  - _(+4 more)_


## lessons — per-query detail

| id | group | found@ | friction | p50 ms |
|---|---|---|---|---:|
| lesson-pg-uuid-casing | confident-hit | 1 | clean | 88 |
| lesson-undici-version-pinning | confident-hit | 1 | clean | 89 |
| lesson-pyenv-python3-shim | confident-hit | 1 | clean | 100 |
| lesson-npm-test-silent-skip | confident-hit | 1 | clean | 87 |
| lesson-api-lessons-items-shape | confident-hit | 1 | clean | 88 |
| lesson-review-impl-default | confident-hit | 1 | clean | 89 |
| lesson-noproject-guard-hydration | confident-hit | 1 | clean | 93 |
| lesson-project-crud-validation | confident-hit | 1 | clean | 91 |
| lesson-multi-project-color | confident-hit | 1 | clean | 81 |
| lesson-code-review-workflow-pref | confident-hit | 1 | clean | 84 |
| lesson-dup-max-retry-guardrail | duplicate-trap | 1,2,3,4,5 | clean | 78 |
| lesson-dup-global-search-retry-pattern | duplicate-trap | 1,2 | clean | 84 |
| lesson-dup-valid-impexp-fixture | duplicate-trap | 1,2,3,4,5 | clean | 74 |
| lesson-miss-unicorn | adversarial-miss | — | — | 89 |
| lesson-miss-astrophysics | adversarial-miss | — | — | 85 |
| lesson-miss-falconry | adversarial-miss | — | — | 85 |
| lesson-cross-integration-test-backoff | cross-topic | 1,2,5,6,7,8,10 | clean | 78 |
| lesson-cross-sprint-11-closeout | cross-topic | — | no-relevant-hit | 85 |
| lesson-cross-workflow-gate | cross-topic | 2,9 | clean | 85 |
| lesson-cross-agent-bootstrap-e2e | cross-topic | 1,3 | clean | 82 |
| lesson-ambig-measurement-methodology | ambiguous-multi-target | 2,8,10 | clean | 86 |
| lesson-ambig-dedup-key-design | ambiguous-multi-target | 1,2,3,4 | clean | 90 |
| lesson-ambig-review-impl-default | ambiguous-multi-target | 1,2 | clean | 80 |
| lesson-ambig-popularity-feedback | ambiguous-multi-target | 1,2 | clean | 82 |
| lesson-ambig-baseline-drift | ambiguous-multi-target | 1,5 | clean | 82 |
| lesson-ambig-numeric-edge-cases | ambiguous-multi-target | 1,9 | clean | 89 |
| lesson-ambig-test-infra-async | ambiguous-multi-target | 1,2 | clean | 83 |
| lesson-ambig-noise-floor | ambiguous-multi-target | 1,2,4,5 | clean | 82 |
| lesson-ambig-downstream-propagation | ambiguous-multi-target | 1,7,9 | clean | 83 |
| lesson-ambig-fire-and-forget-pool | ambiguous-multi-target | 1,2 | clean | 81 |
| lesson-ambig-multi-project-isolation | ambiguous-multi-target | 1,5 | clean | 96 |
| lesson-ambig-composite-relevance | ambiguous-multi-target | 1,4 | clean | 81 |
| lesson-ambig-content-empty-dedup | ambiguous-multi-target | 1,2,8 | clean | 84 |
| lesson-ambig-recency-frequency-retrieval | ambiguous-multi-target | 2 | clean | 83 |
| lesson-ambig-dedup-e2e-testing | ambiguous-multi-target | 1,3 | clean | 84 |
| lesson-para-pg-map-miss | semantic-paraphrase | 1 | clean | 96 |
| lesson-para-undici-node-mismatch | semantic-paraphrase | — | no-relevant-hit | 84 |
| lesson-para-nan-defensive-math | semantic-paraphrase | 1 | clean | 83 |
| lesson-para-new-test-not-running | semantic-paraphrase | 1 | clean | 80 |
| lesson-para-windows-python-newlines | semantic-paraphrase | 1 | clean | 87 |
| lesson-edge-multi-hop-1 | edge-multi-hop | — | no-relevant-hit | 94 |
| lesson-edge-multi-hop-2 | edge-multi-hop | 1,2,7 | clean | 79 |
| lesson-edge-no-answer-1 | edge-no-answer | — | — | 85 |
| lesson-edge-contradictory-1 | edge-contradictory | 1 | clean | 80 |
| lesson-edge-contradictory-2 | edge-contradictory | — | no-relevant-hit | 84 |
| lesson-edge-paraphrase-1 | edge-paraphrase | 1 | clean | 93 |
| lesson-edge-paraphrase-2 | edge-paraphrase | 1 | clean | 83 |
| lesson-edge-distractor-1 | edge-distractor | 1 | clean | 85 |

## code — per-query detail

| id | group | found@ | friction | p50 ms |
|---|---|---|---|---:|
| auth-workspace-token-validate | mcp-auth | — | no-relevant-hit | 2479 |
| mcp-streamable-http-endpoint | mcp-server | 8 | rank-order-inversion | 55 |
| index-project-main-pipeline | indexing | 7 | rank-order-inversion | 3222 |
| ignore-rules-loading | indexing | 1 | clean | 53 |
| embedding-request-shape | embeddings | — | no-relevant-hit | 2430 |
| project-snapshot-rebuild | snapshots | 1,3 | clean | 55 |
| kg-bootstrap | kg | 2,5 | clean | 47 |
| kg-upsert-from-indexer | kg | 1 | clean | 49 |
| kg-ts-morph-extractor | kg | 1 | clean | 3726 |
| kg-query-tools | kg | 1 | clean | 3812 |
| lessons-storage-and-search | lessons | 8 | rank-order-inversion | 2149 |
| guardrails-check | guardrails | 3,7 | clean | 2084 |
| git-ingest-core | git | 5 | rank-order-inversion | 3113 |
| git-deleted-files-handling | git | 2 | clean | 55 |
| git-proposal-upsert-idempotent | git | 1,2 | clean | 2872 |
| repo-source-config | sources | 2 | clean | 65 |
| prepare-repo-clone-fetch-checkout | sources | 2 | clean | 2498 |
| s3-source-artifacts | sources | 1 | clean | 51 |
| job-queue-postgres-claim | queue | 1 | clean | 54 |
| job-queue-rabbitmq | queue | 1,4 | clean | 2498 |
| job-executor-dispatch | queue | 1 | clean | 3213 |
| workspace-scan-porcelain | workspace | 1 | clean | 3847 |
| env-schema-queue-s3 | config | 3 | clean | 46 |
| migrations-git-intelligence | db | — | no-relevant-hit | 52 |
| migrations-sources-jobs | db | — | no-relevant-hit | 2480 |
| tool-output-formatting | mcp-server | — | no-relevant-hit | 3184 |
| output-format-parser-smoke | mcp-server | — | no-relevant-hit | 3831 |
| env-boolean-parser | config | 1 | clean | 58 |
| mcp-tool-registrations | mcp-server | — | no-relevant-hit | 47 |
| db-migrations-apply | db | 1 | clean | 52 |
| db-pool-singleton | db | 1 | clean | 53 |
| guardrails-storage | guardrails | 1 | clean | 52 |
| lessons-distillation-enabled | lessons | 1,4 | clean | 54 |
| distiller-commit-suggestion-schema | distillation | 1 | clean | 60 |
| job-correlation-filter | queue | 5 | rank-order-inversion | 3811 |
| rabbitmq-queue-assert-bind | queue | — | no-relevant-hit | 3546 |
| worker-rabbitmq-consumer | queue | 1 | clean | 2857 |
| worker-fallback-postgres-polling | queue | 6 | rank-order-inversion | 49 |
| repo-sync-fanout | queue | 2 | clean | 3758 |
| project-sources-schema | sources | — | no-relevant-hit | 2829 |
| workspace-deltas-schema | workspace | — | no-relevant-hit | 3839 |
| scan-workspace-delta-index | workspace | 3 | clean | 2170 |
| delete-workspace-cascades | storage | — | no-relevant-hit | 2833 |
| kg-ids-deterministic | kg | — | no-relevant-hit | 2583 |
| kg-linker-lessons | kg | 1 | clean | 56 |
| kg-project-graph-delete | kg | 3 | clean | 52 |
| git-impact-analysis | git | 4 | rank-order-inversion | 3208 |
| git-link-commit-to-lesson | git | 6 | rank-order-inversion | 2843 |
| git-proposal-sanitization | git | — | no-relevant-hit | 3694 |
| mcp-health-endpoint | mcp-server | — | no-relevant-hit | 71 |
| mcp-output-format-default | mcp-server | — | no-relevant-hit | 2480 |
| config-default-project-id | config | 1 | clean | 2778 |
| config-env-loading-dotenv | config | 1 | clean | 51 |
| config-embeddings-base-url | embeddings | — | no-relevant-hit | 3592 |
| config-embeddings-api-key | embeddings | 10 | rank-order-inversion | 51 |
| config-distillation-enabled | distillation | 1 | clean | 46 |
| config-kg-enabled | kg | 2,5 | clean | 57 |
| auth-tool-wrapper | mcp-auth | 2 | clean | 3121 |
| auth-workspace-token-env | mcp-auth | — | no-relevant-hit | 72 |
| indexer-chunk-size-config | indexing | — | no-relevant-hit | 2938 |
| retriever-search-code-boosts | retrieval | 3 | clean | 3490 |
| retriever-default-excludes | retrieval | — | no-relevant-hit | 3216 |
| queue-backend-selection | queue | 1,2 | clean | 59 |
| queue-job-types | queue | 1,3 | clean | 57 |
| smoke-queue-tools-block | smoke | 2 | clean | 3792 |
| ci-phase5-worker-validation-workflow | ci | — | no-relevant-hit | 3798 |
| ci-mock-embeddings-server | ci | — | no-relevant-hit | 54 |
| code-edge-multi-hop-1 | edge-multi-hop | 10 | rank-order-inversion | 3583 |
| code-edge-no-answer-1 | edge-no-answer | — | — | 2922 |
| code-edge-no-answer-2 | edge-no-answer | — | — | 51 |
| code-edge-contradictory-1 | edge-contradictory | — | no-relevant-hit | 52 |
| code-edge-contradictory-2 | edge-contradictory | — | no-relevant-hit | 60 |
| code-edge-paraphrase-1 | edge-paraphrase | — | no-relevant-hit | 52 |
| code-edge-paraphrase-2 | edge-paraphrase | — | no-relevant-hit | 50 |
| code-edge-distractor-1 | edge-distractor | 2 | clean | 49 |
| code-edge-distractor-2 | edge-distractor | — | no-relevant-hit | 47 |
| code-edge-distractor-3 | edge-distractor | — | no-relevant-hit | 55 |

## chunks — per-query detail

| id | group | found@ | friction | p50 ms |
|---|---|---|---|---:|
| chunk-retry-strategy-overview | confident-hit | 1 | clean | 47 |
| chunk-retry-config-table | confident-hit | 1 | clean | 38 |
| chunk-retry-implementation-code | confident-hit | 1 | clean | 37 |
| chunk-authentication-overview | confident-hit | 1 | clean | 35 |
| chunk-role-definitions | confident-hit | 1 | clean | 37 |
| chunk-data-storage-pgvector | confident-hit | 1 | clean | 48 |
| chunk-adr-intro-dup | duplicate-trap | 1,2 | clean | 41 |
| chunk-cross-retry-auth-storage | cross-topic | 3,5,6 | clean | 37 |
| chunk-miss-quantum | adversarial-miss | — | — | 37 |
| chunk-miss-jazz | adversarial-miss | — | — | 34 |
| chunk-edge-multi-hop-1 | edge-multi-hop | 1,2,4 | clean | 38 |
| chunk-edge-no-answer-1 | edge-no-answer | — | — | 37 |
| chunk-edge-distractor-1 | edge-distractor | 1 | clean | 36 |

## global — per-query detail

| id | group | found@ | friction | p50 ms |
|---|---|---|---|---:|
| global-retry-substr | confident-hit | 3 | clean | 5 |
| global-validation-substr | confident-hit | 9 | rank-order-inversion | 3 |
| global-authentication-substr | confident-hit | 1 | clean | 3 |
| global-max-retry-substr | confident-hit | 2 | clean | 3 |
| global-architecture-substr | confident-hit | 1,2 | clean | 3 |
| global-pgvector-substr | confident-hit | 2 | clean | 4 |
| global-review-impl-substr | confident-hit | — | no-relevant-hit | 4 |
| global-undici-substr | confident-hit | 3 | clean | 3 |
| global-workspace-substr | coverage-probe | — | — | 3 |
| global-miss-zephyr | adversarial-miss | — | empty-result-set | 3 |
| global-edge-multi-hop-1 | edge-multi-hop | — | empty-result-set;no-relevant-hit | 4 |
| global-edge-no-answer-1 | edge-no-answer | — | empty-result-set | 3 |
| global-edge-contradictory-1 | edge-contradictory | — | no-relevant-hit | 3 |
| global-edge-paraphrase-1 | edge-paraphrase | — | empty-result-set;no-relevant-hit | 3 |

## Friction observed (top examples)

_(showing up to 3 per surface; 48 total queries have flagged friction across all surfaces)_

- **lessons/lesson-cross-sprint-11-closeout** — no-relevant-hit: query `sprint 11.6c-sec DNS pinning body-stall timeout security polish`; top-3 keys=[96cd0dc1-920c-420e-a703-1d9dca5e4e04, 206e30df-829a-46f1-b51e-93145f9105fb, 5c0b7b25-4a93-4961-bf64-e0c967438b24]
- **lessons/lesson-para-undici-node-mismatch** — no-relevant-hit: query `why does swapping http agents between the default and an installed one break str`; top-3 keys=[e15edaef-1d63-4cff-a9cc-7f972a0887d5, 5ab3a1ba-b0b4-481c-997a-5b0f61138d63, eb7409e5-d2bf-407b-9811-fca62a2c3ded]
- **lessons/lesson-edge-multi-hop-1** — no-relevant-hit: query `What two patterns combine for safe state-transition testing in coordination laye`; top-3 keys=[4e2b8497-8d8b-4d33-bd2d-1ffd2d66c860, 45c8cb44-9fb8-4dad-b825-5b1cd8b0a108, eb7409e5-d2bf-407b-9811-fca62a2c3ded]
- **code/auth-workspace-token-validate** — no-relevant-hit: query `Where is workspace_token validated for MCP tool calls?`; top-3 keys=[services/ragas-judge/_compat.py, src/mcp/index.ts, src/smoke/phase5WorkerValidation.ts]
- **code/mcp-streamable-http-endpoint** — rank-order-inversion: query `Where is the MCP HTTP endpoint implemented and what routes are exposed?`; top-3 keys=[src/qc/integrationTestRunner.ts, src/mcp/index.ts, src/qc/ragQcRunner.ts]
- **code/index-project-main-pipeline** — rank-order-inversion: query `How does index_project discover files, chunk them, embed, and write to Postgres?`; top-3 keys=[packages/mcp-client/src/index.ts, packages/mcp-client/src/rest-client.ts, src/utils/resolveProjectRoot.ts]
- **global/global-validation-substr** — rank-order-inversion: query `validation`; top-3 keys=[lesson:61835c5d-d5c8-4d61-9fa0-3497aadee229, lesson:476aeed0-8363-4630-bd07-faf0edc573ba, lesson:44e38b7e-0ef9-4b0f-9754-d5dcc09f4e4d]
- **global/global-review-impl-substr** — no-relevant-hit: query `review-impl`; top-3 keys=[lesson:7c632d4b-1486-4b11-910c-5214ad9e2d7d, guardrail:5287a774-5761-412f-a150-31db7f2b3880, lesson:f47de748-7a78-44e9-af6f-ef3f7a324004]
- **global/global-miss-zephyr** — empty-result-set: query `zephyr-ninja-pyramid-2026`; top-3 keys=[]

## Known limitations

- Latency varies ±10–20% across runs; quality metrics are deterministic.
- Global surface uses REST /api/search/global (ILIKE, not semantic); recall floor comes from raw substring matching.
- Code surface requires an indexed `chunks` population; empty index → 0 coverage regardless of query quality.
- `duplication_rate_at_10` v0 keys on exact entity id. Same-title-different-UUID noise (the original Phase-12 motivation: multiple lesson rows titled "Global search test retry pattern") is invisible to v0 — a reader seeing `dup@10 = 0` should NOT conclude "no duplication"; see `snippet-redundancy` in `docs/qc/friction-classes.md`.
- Golden-set ceiling bias: lesson queries are paraphrases of lesson content, and target ids were cherry-picked from recently-active lessons. Reported `recall@10 = 1.0` may reflect "queries are easy" rather than "retriever is strong." Sprint 12.1 should add adversarial queries (synonyms, typos, indirect references) to distinguish real improvement from noise.
