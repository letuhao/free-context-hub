---
tag: 2026-06-16-lessons-crossencoder-v2
commit: 3353494+dirty
branch: phase-16-sprint-16.1-gen-eval-dataset
run_at: 2026-06-16T05:19:40.433Z
elapsed_ms: 14034
project_id_primary: free-context-hub
---

# RAG Baseline — 2026-06-16-lessons-crossencoder-v2

## Summary (all surfaces)

| Surface | Project | Q | err | recall@5 | recall@10 | MRR | nDCG@5 | nDCG@10 | dup@10 | dup@10 nearsem | cov% | p50 ms | p95 ms |
|---|---|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|
| lessons | free-context-hub | 48 | 0 | 0.8889 | 0.8889 | 0.8556 | 0.8447 | 0.8261 | 0 | 0 | 0.8889 | 94 | 111 |

## lessons — per-query detail

| id | group | found@ | friction | p50 ms |
|---|---|---|---|---:|
| lesson-pg-uuid-casing | confident-hit | 1 | clean | 124 |
| lesson-undici-version-pinning | confident-hit | 1 | clean | 109 |
| lesson-pyenv-python3-shim | confident-hit | 1 | clean | 105 |
| lesson-npm-test-silent-skip | confident-hit | 1 | clean | 96 |
| lesson-api-lessons-items-shape | confident-hit | 1 | clean | 100 |
| lesson-review-impl-default | confident-hit | 1 | clean | 96 |
| lesson-noproject-guard-hydration | confident-hit | 1 | clean | 97 |
| lesson-project-crud-validation | confident-hit | 1 | clean | 101 |
| lesson-multi-project-color | confident-hit | 1 | clean | 104 |
| lesson-code-review-workflow-pref | confident-hit | 1 | clean | 97 |
| lesson-dup-max-retry-guardrail | duplicate-trap | 1,2,3,4,5 | clean | 89 |
| lesson-dup-global-search-retry-pattern | duplicate-trap | 1,2 | clean | 95 |
| lesson-dup-valid-impexp-fixture | duplicate-trap | 1,2,3,4,5 | clean | 86 |
| lesson-miss-unicorn | adversarial-miss | — | — | 93 |
| lesson-miss-astrophysics | adversarial-miss | — | — | 101 |
| lesson-miss-falconry | adversarial-miss | — | — | 91 |
| lesson-cross-integration-test-backoff | cross-topic | 1,2,5,6,7,8,10 | clean | 87 |
| lesson-cross-sprint-11-closeout | cross-topic | — | no-relevant-hit | 93 |
| lesson-cross-workflow-gate | cross-topic | 2,9 | clean | 89 |
| lesson-cross-agent-bootstrap-e2e | cross-topic | 1,3 | clean | 87 |
| lesson-ambig-measurement-methodology | ambiguous-multi-target | 2,8,10 | clean | 91 |
| lesson-ambig-dedup-key-design | ambiguous-multi-target | 1,2,3,4 | clean | 94 |
| lesson-ambig-review-impl-default | ambiguous-multi-target | 1,2 | clean | 91 |
| lesson-ambig-popularity-feedback | ambiguous-multi-target | 1,2 | clean | 97 |
| lesson-ambig-baseline-drift | ambiguous-multi-target | 1,5 | clean | 95 |
| lesson-ambig-numeric-edge-cases | ambiguous-multi-target | 1,9 | clean | 98 |
| lesson-ambig-test-infra-async | ambiguous-multi-target | 1,2 | clean | 92 |
| lesson-ambig-noise-floor | ambiguous-multi-target | 1,2,4,5 | clean | 100 |
| lesson-ambig-downstream-propagation | ambiguous-multi-target | 1,7,9 | clean | 116 |
| lesson-ambig-fire-and-forget-pool | ambiguous-multi-target | 1,2 | clean | 91 |
| lesson-ambig-multi-project-isolation | ambiguous-multi-target | 1,5 | clean | 88 |
| lesson-ambig-composite-relevance | ambiguous-multi-target | 1,4 | clean | 89 |
| lesson-ambig-content-empty-dedup | ambiguous-multi-target | 1,2,8 | clean | 90 |
| lesson-ambig-recency-frequency-retrieval | ambiguous-multi-target | 2 | clean | 93 |
| lesson-ambig-dedup-e2e-testing | ambiguous-multi-target | 1,3 | clean | 96 |
| lesson-para-pg-map-miss | semantic-paraphrase | 1 | clean | 93 |
| lesson-para-undici-node-mismatch | semantic-paraphrase | — | no-relevant-hit | 96 |
| lesson-para-nan-defensive-math | semantic-paraphrase | 1 | clean | 93 |
| lesson-para-new-test-not-running | semantic-paraphrase | 1 | clean | 90 |
| lesson-para-windows-python-newlines | semantic-paraphrase | 1 | clean | 95 |
| lesson-edge-multi-hop-1 | edge-multi-hop | — | no-relevant-hit | 94 |
| lesson-edge-multi-hop-2 | edge-multi-hop | 1,2,7 | clean | 95 |
| lesson-edge-no-answer-1 | edge-no-answer | — | — | 94 |
| lesson-edge-contradictory-1 | edge-contradictory | 1 | clean | 89 |
| lesson-edge-contradictory-2 | edge-contradictory | — | no-relevant-hit | 89 |
| lesson-edge-paraphrase-1 | edge-paraphrase | 1 | clean | 95 |
| lesson-edge-paraphrase-2 | edge-paraphrase | 1 | clean | 93 |
| lesson-edge-distractor-1 | edge-distractor | 1 | clean | 94 |

## Friction observed (top examples)

_(showing up to 3 per surface; 4 total queries have flagged friction across all surfaces)_

- **lessons/lesson-cross-sprint-11-closeout** — no-relevant-hit: query `sprint 11.6c-sec DNS pinning body-stall timeout security polish`; top-3 keys=[96cd0dc1-920c-420e-a703-1d9dca5e4e04, 206e30df-829a-46f1-b51e-93145f9105fb, 5c0b7b25-4a93-4961-bf64-e0c967438b24]
- **lessons/lesson-para-undici-node-mismatch** — no-relevant-hit: query `why does swapping http agents between the default and an installed one break str`; top-3 keys=[e15edaef-1d63-4cff-a9cc-7f972a0887d5, 5ab3a1ba-b0b4-481c-997a-5b0f61138d63, eb7409e5-d2bf-407b-9811-fca62a2c3ded]
- **lessons/lesson-edge-multi-hop-1** — no-relevant-hit: query `What two patterns combine for safe state-transition testing in coordination laye`; top-3 keys=[4e2b8497-8d8b-4d33-bd2d-1ffd2d66c860, 45c8cb44-9fb8-4dad-b825-5b1cd8b0a108, eb7409e5-d2bf-407b-9811-fca62a2c3ded]

## Known limitations

- Latency varies ±10–20% across runs; quality metrics are deterministic.
- Global surface uses REST /api/search/global (ILIKE, not semantic); recall floor comes from raw substring matching.
- Code surface requires an indexed `chunks` population; empty index → 0 coverage regardless of query quality.
- `duplication_rate_at_10` v0 keys on exact entity id. Same-title-different-UUID noise (the original Phase-12 motivation: multiple lesson rows titled "Global search test retry pattern") is invisible to v0 — a reader seeing `dup@10 = 0` should NOT conclude "no duplication"; see `snippet-redundancy` in `docs/qc/friction-classes.md`.
- Golden-set ceiling bias: lesson queries are paraphrases of lesson content, and target ids were cherry-picked from recently-active lessons. Reported `recall@10 = 1.0` may reflect "queries are easy" rather than "retriever is strong." Sprint 12.1 should add adversarial queries (synonyms, typos, indirect references) to distinguish real improvement from noise.
