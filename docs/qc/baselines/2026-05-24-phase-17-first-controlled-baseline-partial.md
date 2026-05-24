---
tag: phase-17-first-controlled-baseline-partial
commit: 3892f68+dirty
branch: phase-16-sprint-16.1-gen-eval-dataset
run_at: 2026-05-24T10:21:51.056Z
elapsed_ms: 679153
project_id_primary: free-context-hub
---

# RAG Baseline — phase-17-first-controlled-baseline-partial

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
| lessons | free-context-hub | 48 | 42 | 0.1333 | 0.1333 | 0.1333 | 0.1333 | 0.1333 | 0 | 0 | 0.1333 | 1 | 955 |
| code | free-context-hub | 77 | 77 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 1 | 1 |
| chunks | free-context-hub | 13 | 13 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 1 | 1 |
| global | free-context-hub | 14 | 14 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 1 | 1 |

## Gen-eval summary (per surface)

| Surface | rows w/ gt | rows judged | faithfulness | answer_relevancy | context_precision | context_recall | refusal_correctness | groundedness_self_eval |
|---|---:|---:|---:|---:|---:|---:|---:|---:|
| lessons | 6 | 5 | 0.87 ±0.16 (2 fail) | 0.74 ±0.09 (5 fail) | 1.00 ±0.00 | 0.29 ±0.06 (5 fail) | — | 1.00 ±0.00 |

_Thresholds (WARN-only): faithfulness ≥ 0.9 · answer_relevancy ≥ 0.85 · context_precision ≥ 0.8 · context_recall ≥ 0.75 · refusal_correctness ≥ 0.75 · groundedness_self_eval ≥ 0.85_

### Gen-eval threshold violations

**lessons** (5):
  - `lesson-pg-uuid-casing` — faithfulness<0.9, answer_relevancy<0.85, context_recall<0.75
  - `lesson-undici-version-pinning` — faithfulness<0.9, answer_relevancy<0.85, context_recall<0.75
  - `lesson-pyenv-python3-shim` — answer_relevancy<0.85, context_recall<0.75
  - `lesson-npm-test-silent-skip` — answer_relevancy<0.85, context_recall<0.75
  - `lesson-api-lessons-items-shape` — answer_relevancy<0.85, context_recall<0.75


## lessons — per-query detail

| id | group | found@ | friction | p50 ms |
|---|---|---|---|---:|
| lesson-pg-uuid-casing | confident-hit | 1 | clean | 573 |
| lesson-undici-version-pinning | confident-hit | 1 | clean | 5770 |
| lesson-pyenv-python3-shim | confident-hit | 1 | clean | 955 |
| lesson-npm-test-silent-skip | confident-hit | 1 | clean | 880 |
| lesson-api-lessons-items-shape | confident-hit | 1 | clean | 858 |
| lesson-review-impl-default | confident-hit | 1 | clean | 1264 |
| lesson-noproject-guard-hydration | confident-hit | — | retrieval-error;empty-result-set;no-relevant-hit | 1 |
| lesson-project-crud-validation | confident-hit | — | retrieval-error;empty-result-set;no-relevant-hit | 1 |
| lesson-multi-project-color | confident-hit | — | retrieval-error;empty-result-set;no-relevant-hit | 1 |
| lesson-code-review-workflow-pref | confident-hit | — | retrieval-error;empty-result-set;no-relevant-hit | 1 |
| lesson-dup-max-retry-guardrail | duplicate-trap | — | retrieval-error;empty-result-set;no-relevant-hit | 0 |
| lesson-dup-global-search-retry-pattern | duplicate-trap | — | retrieval-error;empty-result-set;no-relevant-hit | 1 |
| lesson-dup-valid-impexp-fixture | duplicate-trap | — | retrieval-error;empty-result-set;no-relevant-hit | 1 |
| lesson-miss-unicorn | adversarial-miss | — | retrieval-error;empty-result-set | 1 |
| lesson-miss-astrophysics | adversarial-miss | — | retrieval-error;empty-result-set | 1 |
| lesson-miss-falconry | adversarial-miss | — | retrieval-error;empty-result-set | 1 |
| lesson-cross-integration-test-backoff | cross-topic | — | retrieval-error;empty-result-set;no-relevant-hit | 0 |
| lesson-cross-sprint-11-closeout | cross-topic | — | retrieval-error;empty-result-set;no-relevant-hit | 1 |
| lesson-cross-workflow-gate | cross-topic | — | retrieval-error;empty-result-set;no-relevant-hit | 1 |
| lesson-cross-agent-bootstrap-e2e | cross-topic | — | retrieval-error;empty-result-set;no-relevant-hit | 1 |
| lesson-ambig-measurement-methodology | ambiguous-multi-target | — | retrieval-error;empty-result-set;no-relevant-hit | 1 |
| lesson-ambig-dedup-key-design | ambiguous-multi-target | — | retrieval-error;empty-result-set;no-relevant-hit | 0 |
| lesson-ambig-review-impl-default | ambiguous-multi-target | — | retrieval-error;empty-result-set;no-relevant-hit | 1 |
| lesson-ambig-popularity-feedback | ambiguous-multi-target | — | retrieval-error;empty-result-set;no-relevant-hit | 1 |
| lesson-ambig-baseline-drift | ambiguous-multi-target | — | retrieval-error;empty-result-set;no-relevant-hit | 1 |
| lesson-ambig-numeric-edge-cases | ambiguous-multi-target | — | retrieval-error;empty-result-set;no-relevant-hit | 1 |
| lesson-ambig-test-infra-async | ambiguous-multi-target | — | retrieval-error;empty-result-set;no-relevant-hit | 1 |
| lesson-ambig-noise-floor | ambiguous-multi-target | — | retrieval-error;empty-result-set;no-relevant-hit | 1 |
| lesson-ambig-downstream-propagation | ambiguous-multi-target | — | retrieval-error;empty-result-set;no-relevant-hit | 1 |
| lesson-ambig-fire-and-forget-pool | ambiguous-multi-target | — | retrieval-error;empty-result-set;no-relevant-hit | 0 |
| lesson-ambig-multi-project-isolation | ambiguous-multi-target | — | retrieval-error;empty-result-set;no-relevant-hit | 1 |
| lesson-ambig-composite-relevance | ambiguous-multi-target | — | retrieval-error;empty-result-set;no-relevant-hit | 1 |
| lesson-ambig-content-empty-dedup | ambiguous-multi-target | — | retrieval-error;empty-result-set;no-relevant-hit | 1 |
| lesson-ambig-recency-frequency-retrieval | ambiguous-multi-target | — | retrieval-error;empty-result-set;no-relevant-hit | 1 |
| lesson-ambig-dedup-e2e-testing | ambiguous-multi-target | — | retrieval-error;empty-result-set;no-relevant-hit | 1 |
| lesson-para-pg-map-miss | semantic-paraphrase | — | retrieval-error;empty-result-set;no-relevant-hit | 0 |
| lesson-para-undici-node-mismatch | semantic-paraphrase | — | retrieval-error;empty-result-set;no-relevant-hit | 1 |
| lesson-para-nan-defensive-math | semantic-paraphrase | — | retrieval-error;empty-result-set;no-relevant-hit | 1 |
| lesson-para-new-test-not-running | semantic-paraphrase | — | retrieval-error;empty-result-set;no-relevant-hit | 1 |
| lesson-para-windows-python-newlines | semantic-paraphrase | — | retrieval-error;empty-result-set;no-relevant-hit | 1 |
| lesson-edge-multi-hop-1 | edge-multi-hop | — | retrieval-error;empty-result-set;no-relevant-hit | 1 |
| lesson-edge-multi-hop-2 | edge-multi-hop | — | retrieval-error;empty-result-set;no-relevant-hit | 1 |
| lesson-edge-no-answer-1 | edge-no-answer | — | retrieval-error;empty-result-set | 0 |
| lesson-edge-contradictory-1 | edge-contradictory | — | retrieval-error;empty-result-set;no-relevant-hit | 0 |
| lesson-edge-contradictory-2 | edge-contradictory | — | retrieval-error;empty-result-set;no-relevant-hit | 1 |
| lesson-edge-paraphrase-1 | edge-paraphrase | — | retrieval-error;empty-result-set;no-relevant-hit | 1 |
| lesson-edge-paraphrase-2 | edge-paraphrase | — | retrieval-error;empty-result-set;no-relevant-hit | 1 |
| lesson-edge-distractor-1 | edge-distractor | — | retrieval-error;empty-result-set;no-relevant-hit | 1 |

## code — per-query detail

| id | group | found@ | friction | p50 ms |
|---|---|---|---|---:|
| auth-workspace-token-validate | mcp-auth | — | retrieval-error;empty-result-set;no-relevant-hit | 1 |
| mcp-streamable-http-endpoint | mcp-server | — | retrieval-error;empty-result-set;no-relevant-hit | 1 |
| index-project-main-pipeline | indexing | — | retrieval-error;empty-result-set;no-relevant-hit | 1 |
| ignore-rules-loading | indexing | — | retrieval-error;empty-result-set;no-relevant-hit | 0 |
| embedding-request-shape | embeddings | — | retrieval-error;empty-result-set;no-relevant-hit | 0 |
| project-snapshot-rebuild | snapshots | — | retrieval-error;empty-result-set;no-relevant-hit | 2 |
| kg-bootstrap | kg | — | retrieval-error;empty-result-set;no-relevant-hit | 1 |
| kg-upsert-from-indexer | kg | — | retrieval-error;empty-result-set;no-relevant-hit | 2 |
| kg-ts-morph-extractor | kg | — | retrieval-error;empty-result-set;no-relevant-hit | 1 |
| kg-query-tools | kg | — | retrieval-error;empty-result-set;no-relevant-hit | 1 |
| lessons-storage-and-search | lessons | — | retrieval-error;empty-result-set;no-relevant-hit | 1 |
| guardrails-check | guardrails | — | retrieval-error;empty-result-set;no-relevant-hit | 1 |
| git-ingest-core | git | — | retrieval-error;empty-result-set;no-relevant-hit | 1 |
| git-deleted-files-handling | git | — | retrieval-error;empty-result-set;no-relevant-hit | 1 |
| git-proposal-upsert-idempotent | git | — | retrieval-error;empty-result-set;no-relevant-hit | 0 |
| repo-source-config | sources | — | retrieval-error;empty-result-set;no-relevant-hit | 0 |
| prepare-repo-clone-fetch-checkout | sources | — | retrieval-error;empty-result-set;no-relevant-hit | 1 |
| s3-source-artifacts | sources | — | retrieval-error;empty-result-set;no-relevant-hit | 1 |
| job-queue-postgres-claim | queue | — | retrieval-error;empty-result-set;no-relevant-hit | 1 |
| job-queue-rabbitmq | queue | — | retrieval-error;empty-result-set;no-relevant-hit | 1 |
| job-executor-dispatch | queue | — | retrieval-error;empty-result-set;no-relevant-hit | 0 |
| workspace-scan-porcelain | workspace | — | retrieval-error;empty-result-set;no-relevant-hit | 1 |
| env-schema-queue-s3 | config | — | retrieval-error;empty-result-set;no-relevant-hit | 1 |
| migrations-git-intelligence | db | — | retrieval-error;empty-result-set;no-relevant-hit | 1 |
| migrations-sources-jobs | db | — | retrieval-error;empty-result-set;no-relevant-hit | 1 |
| tool-output-formatting | mcp-server | — | retrieval-error;empty-result-set;no-relevant-hit | 1 |
| output-format-parser-smoke | mcp-server | — | retrieval-error;empty-result-set;no-relevant-hit | 1 |
| env-boolean-parser | config | — | retrieval-error;empty-result-set;no-relevant-hit | 1 |
| mcp-tool-registrations | mcp-server | — | retrieval-error;empty-result-set;no-relevant-hit | 1 |
| db-migrations-apply | db | — | retrieval-error;empty-result-set;no-relevant-hit | 1 |
| db-pool-singleton | db | — | retrieval-error;empty-result-set;no-relevant-hit | 0 |
| guardrails-storage | guardrails | — | retrieval-error;empty-result-set;no-relevant-hit | 1 |
| lessons-distillation-enabled | lessons | — | retrieval-error;empty-result-set;no-relevant-hit | 1 |
| distiller-commit-suggestion-schema | distillation | — | retrieval-error;empty-result-set;no-relevant-hit | 1 |
| job-correlation-filter | queue | — | retrieval-error;empty-result-set;no-relevant-hit | 1 |
| rabbitmq-queue-assert-bind | queue | — | retrieval-error;empty-result-set;no-relevant-hit | 0 |
| worker-rabbitmq-consumer | queue | — | retrieval-error;empty-result-set;no-relevant-hit | 1 |
| worker-fallback-postgres-polling | queue | — | retrieval-error;empty-result-set;no-relevant-hit | 1 |
| repo-sync-fanout | queue | — | retrieval-error;empty-result-set;no-relevant-hit | 1 |
| project-sources-schema | sources | — | retrieval-error;empty-result-set;no-relevant-hit | 0 |
| workspace-deltas-schema | workspace | — | retrieval-error;empty-result-set;no-relevant-hit | 1 |
| scan-workspace-delta-index | workspace | — | retrieval-error;empty-result-set;no-relevant-hit | 1 |
| delete-workspace-cascades | storage | — | retrieval-error;empty-result-set;no-relevant-hit | 1 |
| kg-ids-deterministic | kg | — | retrieval-error;empty-result-set;no-relevant-hit | 0 |
| kg-linker-lessons | kg | — | retrieval-error;empty-result-set;no-relevant-hit | 0 |
| kg-project-graph-delete | kg | — | retrieval-error;empty-result-set;no-relevant-hit | 1 |
| git-impact-analysis | git | — | retrieval-error;empty-result-set;no-relevant-hit | 1 |
| git-link-commit-to-lesson | git | — | retrieval-error;empty-result-set;no-relevant-hit | 1 |
| git-proposal-sanitization | git | — | retrieval-error;empty-result-set;no-relevant-hit | 1 |
| mcp-health-endpoint | mcp-server | — | retrieval-error;empty-result-set;no-relevant-hit | 0 |
| mcp-output-format-default | mcp-server | — | retrieval-error;empty-result-set;no-relevant-hit | 0 |
| config-default-project-id | config | — | retrieval-error;empty-result-set;no-relevant-hit | 1 |
| config-env-loading-dotenv | config | — | retrieval-error;empty-result-set;no-relevant-hit | 1 |
| config-embeddings-base-url | embeddings | — | retrieval-error;empty-result-set;no-relevant-hit | 1 |
| config-embeddings-api-key | embeddings | — | retrieval-error;empty-result-set;no-relevant-hit | 0 |
| config-distillation-enabled | distillation | — | retrieval-error;empty-result-set;no-relevant-hit | 1 |
| config-kg-enabled | kg | — | retrieval-error;empty-result-set;no-relevant-hit | 1 |
| auth-tool-wrapper | mcp-auth | — | retrieval-error;empty-result-set;no-relevant-hit | 1 |
| auth-workspace-token-env | mcp-auth | — | retrieval-error;empty-result-set;no-relevant-hit | 1 |
| indexer-chunk-size-config | indexing | — | retrieval-error;empty-result-set;no-relevant-hit | 1 |
| retriever-search-code-boosts | retrieval | — | retrieval-error;empty-result-set;no-relevant-hit | 0 |
| retriever-default-excludes | retrieval | — | retrieval-error;empty-result-set;no-relevant-hit | 1 |
| queue-backend-selection | queue | — | retrieval-error;empty-result-set;no-relevant-hit | 1 |
| queue-job-types | queue | — | retrieval-error;empty-result-set;no-relevant-hit | 1 |
| smoke-queue-tools-block | smoke | — | retrieval-error;empty-result-set;no-relevant-hit | 1 |
| ci-phase5-worker-validation-workflow | ci | — | retrieval-error;empty-result-set;no-relevant-hit | 1 |
| ci-mock-embeddings-server | ci | — | retrieval-error;empty-result-set;no-relevant-hit | 0 |
| code-edge-multi-hop-1 | edge-multi-hop | — | retrieval-error;empty-result-set;no-relevant-hit | 1 |
| code-edge-no-answer-1 | edge-no-answer | — | retrieval-error;empty-result-set | 0 |
| code-edge-no-answer-2 | edge-no-answer | — | retrieval-error;empty-result-set | 1 |
| code-edge-contradictory-1 | edge-contradictory | — | retrieval-error;empty-result-set;no-relevant-hit | 2 |
| code-edge-contradictory-2 | edge-contradictory | — | retrieval-error;empty-result-set;no-relevant-hit | 1 |
| code-edge-paraphrase-1 | edge-paraphrase | — | retrieval-error;empty-result-set;no-relevant-hit | 1 |
| code-edge-paraphrase-2 | edge-paraphrase | — | retrieval-error;empty-result-set;no-relevant-hit | 0 |
| code-edge-distractor-1 | edge-distractor | — | retrieval-error;empty-result-set;no-relevant-hit | 1 |
| code-edge-distractor-2 | edge-distractor | — | retrieval-error;empty-result-set;no-relevant-hit | 1 |
| code-edge-distractor-3 | edge-distractor | — | retrieval-error;empty-result-set;no-relevant-hit | 1 |

## chunks — per-query detail

| id | group | found@ | friction | p50 ms |
|---|---|---|---|---:|
| chunk-retry-strategy-overview | confident-hit | — | retrieval-error;empty-result-set;no-relevant-hit | 1 |
| chunk-retry-config-table | confident-hit | — | retrieval-error;empty-result-set;no-relevant-hit | 1 |
| chunk-retry-implementation-code | confident-hit | — | retrieval-error;empty-result-set;no-relevant-hit | 1 |
| chunk-authentication-overview | confident-hit | — | retrieval-error;empty-result-set;no-relevant-hit | 1 |
| chunk-role-definitions | confident-hit | — | retrieval-error;empty-result-set;no-relevant-hit | 1 |
| chunk-data-storage-pgvector | confident-hit | — | retrieval-error;empty-result-set;no-relevant-hit | 1 |
| chunk-adr-intro-dup | duplicate-trap | — | retrieval-error;empty-result-set;no-relevant-hit | 1 |
| chunk-cross-retry-auth-storage | cross-topic | — | retrieval-error;empty-result-set;no-relevant-hit | 1 |
| chunk-miss-quantum | adversarial-miss | — | retrieval-error;empty-result-set | 1 |
| chunk-miss-jazz | adversarial-miss | — | retrieval-error;empty-result-set | 0 |
| chunk-edge-multi-hop-1 | edge-multi-hop | — | retrieval-error;empty-result-set;no-relevant-hit | 1 |
| chunk-edge-no-answer-1 | edge-no-answer | — | retrieval-error;empty-result-set | 1 |
| chunk-edge-distractor-1 | edge-distractor | — | retrieval-error;empty-result-set;no-relevant-hit | 1 |

## global — per-query detail

| id | group | found@ | friction | p50 ms |
|---|---|---|---|---:|
| global-retry-substr | confident-hit | — | retrieval-error;empty-result-set;no-relevant-hit | 1 |
| global-validation-substr | confident-hit | — | retrieval-error;empty-result-set;no-relevant-hit | 1 |
| global-authentication-substr | confident-hit | — | retrieval-error;empty-result-set;no-relevant-hit | 1 |
| global-max-retry-substr | confident-hit | — | retrieval-error;empty-result-set;no-relevant-hit | 0 |
| global-architecture-substr | confident-hit | — | retrieval-error;empty-result-set;no-relevant-hit | 1 |
| global-pgvector-substr | confident-hit | — | retrieval-error;empty-result-set;no-relevant-hit | 1 |
| global-review-impl-substr | confident-hit | — | retrieval-error;empty-result-set;no-relevant-hit | 0 |
| global-undici-substr | confident-hit | — | retrieval-error;empty-result-set;no-relevant-hit | 1 |
| global-workspace-substr | coverage-probe | — | retrieval-error;empty-result-set | 1 |
| global-miss-zephyr | adversarial-miss | — | retrieval-error;empty-result-set | 1 |
| global-edge-multi-hop-1 | edge-multi-hop | — | retrieval-error;empty-result-set;no-relevant-hit | 1 |
| global-edge-no-answer-1 | edge-no-answer | — | retrieval-error;empty-result-set | 1 |
| global-edge-contradictory-1 | edge-contradictory | — | retrieval-error;empty-result-set;no-relevant-hit | 1 |
| global-edge-paraphrase-1 | edge-paraphrase | — | retrieval-error;empty-result-set;no-relevant-hit | 0 |

## Friction observed (top examples)

_(showing up to 3 per surface; 146 total queries have flagged friction across all surfaces)_

- **lessons/lesson-noproject-guard-hydration** — retrieval-error; empty-result-set; no-relevant-hit: query `NoProjectGuard hydration-safe approach for Next.js data pages`; top-3 keys=[]
- **lessons/lesson-project-crud-validation** — retrieval-error; empty-result-set; no-relevant-hit: query `project CRUD POST PUT endpoints with validation rules`; top-3 keys=[]
- **lessons/lesson-multi-project-color** — retrieval-error; empty-result-set; no-relevant-hit: query `multi-project color and description schema additions`; top-3 keys=[]
- **code/auth-workspace-token-validate** — retrieval-error; empty-result-set; no-relevant-hit: query `Where is workspace_token validated for MCP tool calls?`; top-3 keys=[]
- **code/mcp-streamable-http-endpoint** — retrieval-error; empty-result-set; no-relevant-hit: query `Where is the MCP HTTP endpoint implemented and what routes are exposed?`; top-3 keys=[]
- **code/index-project-main-pipeline** — retrieval-error; empty-result-set; no-relevant-hit: query `How does index_project discover files, chunk them, embed, and write to Postgres?`; top-3 keys=[]
- **chunks/chunk-retry-strategy-overview** — retrieval-error; empty-result-set; no-relevant-hit: query `what is the retry strategy for external API calls?`; top-3 keys=[]
- **chunks/chunk-retry-config-table** — retrieval-error; empty-result-set; no-relevant-hit: query `retry configuration parameters base delay and multiplier`; top-3 keys=[]
- **chunks/chunk-retry-implementation-code** — retrieval-error; empty-result-set; no-relevant-hit: query `how to implement a retry middleware wrapping fetch`; top-3 keys=[]
- **global/global-retry-substr** — retrieval-error; empty-result-set; no-relevant-hit: query `retry`; top-3 keys=[]
- **global/global-validation-substr** — retrieval-error; empty-result-set; no-relevant-hit: query `validation`; top-3 keys=[]
- **global/global-authentication-substr** — retrieval-error; empty-result-set; no-relevant-hit: query `Authentication`; top-3 keys=[]

## Known limitations

- Latency varies ±10–20% across runs; quality metrics are deterministic.
- Global surface uses REST /api/search/global (ILIKE, not semantic); recall floor comes from raw substring matching.
- Code surface requires an indexed `chunks` population; empty index → 0 coverage regardless of query quality.
- `duplication_rate_at_10` v0 keys on exact entity id. Same-title-different-UUID noise (the original Phase-12 motivation: multiple lesson rows titled "Global search test retry pattern") is invisible to v0 — a reader seeing `dup@10 = 0` should NOT conclude "no duplication"; see `snippet-redundancy` in `docs/qc/friction-classes.md`.
- Golden-set ceiling bias: lesson queries are paraphrases of lesson content, and target ids were cherry-picked from recently-active lessons. Reported `recall@10 = 1.0` may reflect "queries are easy" rather than "retriever is strong." Sprint 12.1 should add adversarial queries (synonyms, typos, indirect references) to distinguish real improvement from noise.
