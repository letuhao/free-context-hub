---
tag: hyde-ab-expand
commit: f5d4b06+dirty
branch: deferred-034-chunk-granularity
run_at: 2026-06-18T11:01:23.227Z
elapsed_ms: 23550
project_id_primary: free-context-hub
---

# RAG Baseline — hyde-ab-expand

## Query-rewrite manifest

- **mode:** `expand`
- **answerer:** `google/gemma-4-26b-a4b-qat` @ `http://127.0.0.1:1234/v1` (temp=0, seed=42)
- **template hashes:** expand=`7c0f9a94a28371f4`, hyde=`e74b252d3be1e957`

## Summary (all surfaces)

| Surface | Project | Q | err | recall@5 | recall@10 | MRR | nDCG@5 | nDCG@10 | dup@10 | dup@10 nearsem | cov% | p50 ms | p95 ms |
|---|---|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|
| lessons | free-context-hub | 48 | 0 | 0.8667 | 0.8667 | 0.7719 | 0.7865 | 0.7737 | 0 | 0 | 0.8667 | 86 | 98 |

## lessons — per-query detail

| id | group | found@ | friction | dispatched query | p50 ms |
|---|---|---|---|---|---:|
| lesson-pg-uuid-casing | confident-hit | 1 | clean | PostgreSQL UUID casing case-sensitivity map lookup object key conversion RETURNI | 89 |
| lesson-undici-version-pinning | confident-hit | 1 | clean | undici userland version compatibility Node.js bundled version mismatch dependenc | 89 |
| lesson-pyenv-python3-shim | confident-hit | 1 | clean | pyenv-win python3.bat shim execution failure multi-line -c bash command argument | 87 |
| lesson-npm-test-silent-skip | confident-hit | 1 | clean | npm test script explicit test file listing test discovery pattern glob pattern t | 84 |
| lesson-api-lessons-items-shape | confident-hit | 1 | clean | GET /api/lessons response schema structure payload format items vs lessons key e | 84 |
| lesson-review-impl-default | confident-hit | 1 | clean | v2.2 workflow review-impl invocation post-review default behavior execution sequ | 87 |
| lesson-noproject-guard-hydration | confident-hit | 1 | clean | NoProjectGuard hydration-safe approach Next.js data pages hydration mismatch pre | 91 |
| lesson-project-crud-validation | confident-hit | 1 | clean | CRUD Create Read Update Delete POST PUT API endpoints validation rules schema co | 84 |
| lesson-multi-project-color | confident-hit | 1 | clean | multi-project color and description schema additions database schema migration m | 84 |
| lesson-code-review-workflow-pref | confident-hit | 1 | clean | code review strategy file grouping bulk implementation incremental review batch  | 84 |
| lesson-dup-max-retry-guardrail | duplicate-trap | 1,2,3,4,5 | clean | max retry attempts 3 external API call guardrail rate limiting error handling re | 80 |
| lesson-dup-global-search-retry-pattern | duplicate-trap | 1,2 | clean | global search test retry pattern exponential backoff delay jitter retry strategy | 84 |
| lesson-dup-valid-impexp-fixture | duplicate-trap | 1,2,3 | clean | valid impexp extra entry fixture import export configuration data loading | 76 |
| lesson-miss-unicorn | adversarial-miss | — | — | render rainbow unicorn WebGL Web Graphics Library subsurface scattering SSS ligh | 84 |
| lesson-miss-astrophysics | adversarial-miss | — | — | thermonuclear astrophysics quark-gluon plasma QGP LHC Large Hadron Collider high | 80 |
| lesson-miss-falconry | adversarial-miss | — | — | medieval falconry training manual hood design construction patterns equipment | 91 |
| lesson-cross-integration-test-backoff | cross-topic | 1,2,3,4,5,6,7 | clean | integration test exponential backoff retry strategy delay increase interval jitt | 83 |
| lesson-cross-sprint-11-closeout | cross-topic | — | no-relevant-hit | sprint 11.6c-sec DNS pinning body-stall timeout security polish domain name syst | 89 |
| lesson-cross-workflow-gate | cross-topic | 5 | rank-order-inversion | workflow gate state machine 12-phase workflow v2.2 state transitions workflow en | 91 |
| lesson-cross-agent-bootstrap-e2e | cross-topic | 1,3 | clean | agent context bootstrap end-to-end testing E2E testing agentic workflow initiali | 86 |
| lesson-ambig-measurement-methodology | ambiguous-multi-target | 3,6,8 | clean | RAG retrieval-augmented generation ranking evaluation metrics performance measur | 89 |
| lesson-ambig-dedup-key-design | ambiguous-multi-target | 1,2,3,4 | clean | near-duplicate detection key generation locality-sensitive hashing LSH MinHash S | 91 |
| lesson-ambig-review-impl-default | ambiguous-multi-target | 1,2 | clean | invoke adversarial review post-review default setting configuration trigger mech | 84 |
| lesson-ambig-popularity-feedback | ambiguous-multi-target | 1,2 | clean | salience boosts popularity bias lesson drowning specific hits retrieval precisio | 85 |
| lesson-ambig-baseline-drift | ambiguous-multi-target | 4,6 | rank-order-inversion | baseline drift non-deterministic results reproducibility variance stochasticity  | 87 |
| lesson-ambig-numeric-edge-cases | ambiguous-multi-target | — | no-relevant-hit | numeric edge cases handling silent failure prevention error detection validation | 85 |
| lesson-ambig-test-infra-async | ambiguous-multi-target | 1,2 | clean | integration test fixture timing asynchronous execution async task race condition | 81 |
| lesson-ambig-noise-floor | ambiguous-multi-target | 1,2,3,6 | clean | noise floor A/B difference comparison jitter signal-to-noise ratio SNR variance  | 82 |
| lesson-ambig-downstream-propagation | ambiguous-multi-target | 1,3,9 | clean | downstream consumers ranking shifts ranking drift model performance degradation  | 94 |
| lesson-ambig-fire-and-forget-pool | ambiguous-multi-target | 1,8 | clean | asynchronous insertion connection pool starvation prevention concurrency limit s | 87 |
| lesson-ambig-multi-project-isolation | ambiguous-multi-target | 2,5 | clean | project data isolation multi-tenancy query scoping deduplication data redundancy | 84 |
| lesson-ambig-composite-relevance | ambiguous-multi-target | 1,8 | clean | composite signal ranking boost vs pure semantic search relevance scoring hybrid  | 87 |
| lesson-ambig-content-empty-dedup | ambiguous-multi-target | 1,2,8 | clean | empty content fields false deduplication collisions duplicate detection empty st | 82 |
| lesson-ambig-recency-frequency-retrieval | ambiguous-multi-target | 5,6 | rank-order-inversion | recency frequency ranking retrieval re-ranking scoring features relevance decay  | 83 |
| lesson-ambig-dedup-e2e-testing | ambiguous-multi-target | 1,6 | clean | seed-and-verify end-to-end (e2e) testing deduplication dedup logic failure troub | 87 |
| lesson-para-pg-map-miss | semantic-paraphrase | 4 | rank-order-inversion | Map data structure insertion behavior key return value missing entries lookup fa | 87 |
| lesson-para-undici-node-mismatch | semantic-paraphrase | — | no-relevant-hit | HTTP agent swapping default vs custom agent streaming body interruption broken r | 86 |
| lesson-para-nan-defensive-math | semantic-paraphrase | 1 | clean | defensive bounds min max numeric input validation data corruption error handling | 80 |
| lesson-para-new-test-not-running | semantic-paraphrase | 1 | clean | unit test file execution failure test suite pass new test file not running test  | 83 |
| lesson-para-windows-python-newlines | semantic-paraphrase | 1 | clean | Windows inline Python script argument newline character loss batch file boundary | 81 |
| lesson-edge-multi-hop-1 | edge-multi-hop | — | no-relevant-hit | state-transition testing coordination layer patterns safe state machine testing  | 85 |
| lesson-edge-multi-hop-2 | edge-multi-hop | 1,2,5 | clean | authorization governance primitive review steps approval process audit checklist | 95 |
| lesson-edge-no-answer-1 | edge-no-answer | — | — | distributed transactions multiple PostgreSQL Postgres instances two-phase commit | 85 |
| lesson-edge-contradictory-1 | edge-contradictory | 1 | clean | sprint cycle cold-start adversarial review security testing threat modeling red  | 86 |
| lesson-edge-contradictory-2 | edge-contradictory | — | no-relevant-hit | LLM large language model lesson drafting human-in-the-loop review verification f | 87 |
| lesson-edge-paraphrase-1 | edge-paraphrase | 1 | clean | JavaScript Map key mismatch PostgreSQL UUID data type mismatch object reference  | 89 |
| lesson-edge-paraphrase-2 | edge-paraphrase | 1 | clean | fetch API error undici npm package installation breaking changes nodejs fetch im | 87 |
| lesson-edge-distractor-1 | edge-distractor | 1 | clean | cross-platform shell script python invocation interpreter execution portability  | 86 |

## Friction observed (top examples)

_(showing up to 3 per surface; 9 total queries have flagged friction across all surfaces)_

- **lessons/lesson-cross-sprint-11-closeout** — no-relevant-hit: query `sprint 11.6c-sec DNS pinning body-stall timeout security polish`; top-3 keys=[96cd0dc1-920c-420e-a703-1d9dca5e4e04, 476aeed0-8363-4630-bd07-faf0edc573ba, 5c0b7b25-4a93-4961-bf64-e0c967438b24]
- **lessons/lesson-cross-workflow-gate** — rank-order-inversion: query `workflow gate state machine 12-phase workflow v2.2`; top-3 keys=[45c8cb44-9fb8-4dad-b825-5b1cd8b0a108, 7c632d4b-1486-4b11-910c-5214ad9e2d7d, f142bda7-8a61-4d56-b4b4-d7f8035f6b06]
- **lessons/lesson-ambig-baseline-drift** — rank-order-inversion: query `why do baselines drift between runs`; top-3 keys=[c38a3ad5-6fe6-49c8-ae30-658ea7ed2113, a6a3a11d-00e8-4b7e-83f5-18d3c24b73a7, 67779145-29fe-42ae-a5fc-e1ece699b463]

## Known limitations

- Latency varies ±10–20% across runs; quality metrics are deterministic.
- Global surface uses REST /api/search/global (ILIKE, not semantic); recall floor comes from raw substring matching.
- Code surface requires an indexed `chunks` population; empty index → 0 coverage regardless of query quality.
- `duplication_rate_at_10` v0 keys on exact entity id. Same-title-different-UUID noise (the original Phase-12 motivation: multiple lesson rows titled "Global search test retry pattern") is invisible to v0 — a reader seeing `dup@10 = 0` should NOT conclude "no duplication"; see `snippet-redundancy` in `docs/qc/friction-classes.md`.
- Golden-set ceiling bias: lesson queries are paraphrases of lesson content, and target ids were cherry-picked from recently-active lessons. Reported `recall@10 = 1.0` may reflect "queries are easy" rather than "retriever is strong." Sprint 12.1 should add adversarial queries (synonyms, typos, indirect references) to distinguish real improvement from noise.
