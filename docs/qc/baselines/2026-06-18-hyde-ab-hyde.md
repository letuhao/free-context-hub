---
tag: hyde-ab-hyde
commit: f5d4b06+dirty
branch: deferred-034-chunk-granularity
run_at: 2026-06-18T11:01:47.723Z
elapsed_ms: 48884
project_id_primary: free-context-hub
---

# RAG Baseline — hyde-ab-hyde

## Query-rewrite manifest

- **mode:** `hyde`
- **answerer:** `google/gemma-4-26b-a4b-qat` @ `http://127.0.0.1:1234/v1` (temp=0, seed=42)
- **template hashes:** expand=`7c0f9a94a28371f4`, hyde=`e74b252d3be1e957`

## Summary (all surfaces)

| Surface | Project | Q | err | recall@5 | recall@10 | MRR | nDCG@5 | nDCG@10 | dup@10 | dup@10 nearsem | cov% | p50 ms | p95 ms |
|---|---|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|
| lessons | free-context-hub | 48 | 0 | 0.8222 | 0.9111 | 0.7514 | 0.7465 | 0.7722 | 0 | 0 | 0.9111 | 105 | 118 |

## lessons — per-query detail

| id | group | found@ | friction | dispatched query | p50 ms |
|---|---|---|---|---|---:|
| lesson-pg-uuid-casing | confident-hit | 1 | clean | When performing map lookups on UUID keys retrieved via a PostgreSQL `RETURNING`  | 107 |
| lesson-undici-version-pinning | confident-hit | 1 | clean | The `undici` userland version must align with the Node.js bundled version to ens | 118 |
| lesson-pyenv-python3-shim | confident-hit | 1 | clean | The `python3.bat` shim in `pyenv-win` fails to correctly parse command strings c | 105 |
| lesson-npm-test-silent-skip | confident-hit | 1 | clean | The `npm test` script execution is governed by the `test` field in the `package. | 108 |
| lesson-api-lessons-items-shape | confident-hit | 1 | clean | The `GET /api/lessons` endpoint returns a response object where the primary data | 101 |
| lesson-review-impl-default | confident-hit | 1 | clean | In the v2.2 workflow engine, the `review-impl` function is not invoked by defaul | 101 |
| lesson-noproject-guard-hydration | confident-hit | 1 | clean | To implement a hydration-safe approach with NoProjectGuard in Next.js data pages | 115 |
| lesson-project-crud-validation | confident-hit | 1 | clean | The Project resource lifecycle is managed via standard RESTful endpoints: `POST  | 118 |
| lesson-multi-project-color | confident-hit | 1 | clean | The updated schema introduces a `color_hex` field and a `description_text` field | 104 |
| lesson-code-review-workflow-pref | confident-hit | 1 | clean | The code review workflow requires developers to submit pull requests in discrete | 96 |
| lesson-dup-max-retry-guardrail | duplicate-trap | 1,2,3,4,5 | clean | The `api_guardrail_retry_limit` configuration key must be set to a value of exac | 99 |
| lesson-dup-global-search-retry-pattern | duplicate-trap | 1,2 | clean | The global search test suite implements an exponential backoff strategy for hand | 100 |
| lesson-dup-valid-impexp-fixture | duplicate-trap | 1,3,4,5,6 | clean | The `impexp` extra entry fixture requires a valid `entry_type` identifier and a  | 106 |
| lesson-miss-unicorn | adversarial-miss | — | — | To render a subsurface scattering (SSS) effect for a rainbow unicorn model in We | 105 |
| lesson-miss-astrophysics | adversarial-miss | — | — | The transition from hadronic matter to a quark-gluon plasma (QGP) at LHC energie | 106 |
| lesson-miss-falconry | adversarial-miss | — | — | A standard falconry hood must be constructed from supple, high-quality leather t | 99 |
| lesson-cross-integration-test-backoff | cross-topic | 1,2,3,4,5,6,7 | clean | The integration test suite implements an exponential backoff strategy for flaky  | 97 |
| lesson-cross-sprint-11-closeout | cross-topic | — | no-relevant-hit | The sprint 11.6c-sec release implements a security patch to mitigate DNS pinning | 112 |
| lesson-cross-workflow-gate | cross-topic | 9 | rank-order-inversion | The workflow gate state machine in version 2.2 implements a 12-phase transition  | 107 |
| lesson-cross-agent-bootstrap-e2e | cross-topic | 1,2 | clean | The agent context bootstrap end-to-end testing suite validates the initializatio | 107 |
| lesson-ambig-measurement-methodology | ambiguous-multi-target | 3,9,10 | clean | Rigorous evaluation of RAG ranking changes requires the calculation of Mean Reci | 107 |
| lesson-ambig-dedup-key-design | ambiguous-multi-target | 1,2,3,4 | clean | To prevent over-collapse or under-collapse in near-duplicate detection, implemen | 110 |
| lesson-ambig-review-impl-default | ambiguous-multi-target | 1,3 | clean | The `post_review_pipeline` configuration includes an `adversarial_review` flag t | 102 |
| lesson-ambig-popularity-feedback | ambiguous-multi-target | 1,2 | clean | Salience boosts applied to high-frequency lesson IDs can lead to a distribution  | 112 |
| lesson-ambig-baseline-drift | ambiguous-multi-target | 1,6 | clean | Baseline drift between execution runs is primarily caused by stochastic variance | 109 |
| lesson-ambig-numeric-edge-cases | ambiguous-multi-target | 1,2 | clean | To prevent silent failures during arithmetic operations, the system implements s | 105 |
| lesson-ambig-test-infra-async | ambiguous-multi-target | 1,4 | clean | Integration test fixtures utilize a global `TestLifecycleManager` to synchronize | 108 |
| lesson-ambig-noise-floor | ambiguous-multi-target | 1,2,3,5 | clean | The noise floor for A/B differential analysis is determined by the standard devi | 102 |
| lesson-ambig-downstream-propagation | ambiguous-multi-target | 1,3 | clean | Ranking shifts in downstream consumers typically occur when the feature distribu | 108 |
| lesson-ambig-fire-and-forget-pool | ambiguous-multi-target | 7 | rank-order-inversion | To prevent pool starvation during asynchronous insertion operations, implement a | 115 |
| lesson-ambig-multi-project-isolation | ambiguous-multi-target | 2,8 | clean | To ensure project data isolation during query execution, implement a mandatory ` | 105 |
| lesson-ambig-composite-relevance | ambiguous-multi-target | 1 | clean | Composite signal ranking utilizes a weighted combination of semantic similarity  | 99 |
| lesson-ambig-content-empty-dedup | ambiguous-multi-target | 1,2 | clean | Empty content fields trigger false deduplication collisions when the hashing alg | 102 |
| lesson-ambig-recency-frequency-retrieval | ambiguous-multi-target | 7,10 | rank-order-inversion | Retrieval ranking algorithms often incorporate recency and frequency as secondar | 103 |
| lesson-ambig-dedup-e2e-testing | ambiguous-multi-target | 1 | clean | The `dedup` mechanism utilizes a non-deterministic salt in the hashing layer, pr | 107 |
| lesson-para-pg-map-miss | semantic-paraphrase | 6 | rank-order-inversion | Map miss entries immediately following a successful insertion typically occur du | 119 |
| lesson-para-undici-node-mismatch | semantic-paraphrase | — | no-relevant-hit | Swapping the default `http.Agent` with a custom instance often disrupts streamin | 108 |
| lesson-para-nan-defensive-math | semantic-paraphrase | 1 | clean | Input validation for numeric parameters must occur prior to the application of m | 103 |
| lesson-para-new-test-not-running | semantic-paraphrase | 2 | clean | Unexecuted test files in a new suite typically result from a mismatch between th | 106 |
| lesson-para-windows-python-newlines | semantic-paraphrase | 3 | clean | When executing inline Python scripts via a Windows batch file, the command proce | 102 |
| lesson-edge-multi-hop-1 | edge-multi-hop | 4 | rank-order-inversion | Safe state-transition testing in the coordination layer is achieved by combining | 99 |
| lesson-edge-multi-hop-2 | edge-multi-hop | 1,2,6 | clean | New authorization primitives require a mandatory security architecture review an | 101 |
| lesson-edge-no-answer-1 | edge-no-answer | — | — | Distributed transactions across multiple PostgreSQL instances are best managed u | 109 |
| lesson-edge-contradictory-1 | edge-contradictory | 1 | clean | Adversarial reviews are mandatory for all sprints involving changes to the core  | 97 |
| lesson-edge-contradictory-2 | edge-contradictory | — | no-relevant-hit | All LLM-generated lesson drafts are classified as "Draft-Pending-Review" and can | 104 |
| lesson-edge-paraphrase-1 | edge-paraphrase | 1 | clean | The discrepancy typically arises from a mismatch between the data type of the re | 107 |
| lesson-edge-paraphrase-2 | edge-paraphrase | 1 | clean | Installing `undici` can cause fetch failures due to global polyfill conflicts or | 101 |
| lesson-edge-distractor-1 | edge-distractor | 3 | clean | To ensure cross-platform compatibility, invoke the Python interpreter using the  | 105 |

## Friction observed (top examples)

_(showing up to 3 per surface; 8 total queries have flagged friction across all surfaces)_

- **lessons/lesson-cross-sprint-11-closeout** — no-relevant-hit: query `sprint 11.6c-sec DNS pinning body-stall timeout security polish`; top-3 keys=[96cd0dc1-920c-420e-a703-1d9dca5e4e04, 476aeed0-8363-4630-bd07-faf0edc573ba, 5c0b7b25-4a93-4961-bf64-e0c967438b24]
- **lessons/lesson-cross-workflow-gate** — rank-order-inversion: query `workflow gate state machine 12-phase workflow v2.2`; top-3 keys=[f690c505-f146-4bcd-acf5-582bd441c731, 45c8cb44-9fb8-4dad-b825-5b1cd8b0a108, 67bc4411-a8b4-4e37-ae62-fa843fe47f67]
- **lessons/lesson-ambig-fire-and-forget-pool** — rank-order-inversion: query `how to avoid pool starvation when inserting asynchronously`; top-3 keys=[4abf93d6-cbca-4006-aee6-a143bd3e8979, 9a34ef12-bb6d-42d3-bee3-7ff53c4d86b0, be30985a-e45b-47ce-82d2-f6a75dc282b8]

## Known limitations

- Latency varies ±10–20% across runs; quality metrics are deterministic.
- Global surface uses REST /api/search/global (ILIKE, not semantic); recall floor comes from raw substring matching.
- Code surface requires an indexed `chunks` population; empty index → 0 coverage regardless of query quality.
- `duplication_rate_at_10` v0 keys on exact entity id. Same-title-different-UUID noise (the original Phase-12 motivation: multiple lesson rows titled "Global search test retry pattern") is invisible to v0 — a reader seeing `dup@10 = 0` should NOT conclude "no duplication"; see `snippet-redundancy` in `docs/qc/friction-classes.md`.
- Golden-set ceiling bias: lesson queries are paraphrases of lesson content, and target ids were cherry-picked from recently-active lessons. Reported `recall@10 = 1.0` may reflect "queries are easy" rather than "retriever is strong." Sprint 12.1 should add adversarial queries (synonyms, typos, indirect references) to distinguish real improvement from noise.
