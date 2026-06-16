---
tag: geneval-easy-crossencoder
commit: 3353494+dirty
branch: phase-16-sprint-16.1-gen-eval-dataset
run_at: 2026-06-16T05:59:50.706Z
elapsed_ms: 763000
project_id_primary: free-context-hub
---

# RAG Baseline — geneval-easy-crossencoder

## Gen-eval manifest

- **answerer:** `google/gemma-4-26b-a4b-qat` @ `http://localhost:1234/v1` (temp=0.2, seed=42, max_tokens=1024)
- **judge:** `google/gemma-4-26b-a4b-qat` @ `http://host.docker.internal:1234/v1`
- **judge prompts hash:** `c0165a73c10c4e04`
- **synthesizer template hashes:**
  - lessons: `13ac4e950489bde6`
  - code: `3a2ea1624ae0a1fc`
  - chunks: `a01005e0d102b2c1`
  - global: `5ae7c8e925ad8a47`

## Summary (all surfaces)

| Surface | Project | Q | err | recall@5 | recall@10 | MRR | nDCG@5 | nDCG@10 | dup@10 | dup@10 nearsem | cov% | p50 ms | p95 ms |
|---|---|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|
| lessons | free-context-hub | 48 | 0 | 0.8889 | 0.8889 | 0.8556 | 0.8447 | 0.8261 | 0 | 0 | 0.8889 | 103 | 137 |

## Gen-eval summary (per surface)

| Surface | rows w/ gt | rows judged | faithfulness | answer_relevancy | context_precision | context_recall | refusal_correctness | groundedness_self_eval |
|---|---:|---:|---:|---:|---:|---:|---:|---:|
| lessons | 48 | 48 | 0.75 ±0.40 (15 fail) | 0.50 ±0.31 (41 fail) | 0.81 ±0.35 (11 fail) | 0.65 ±0.32 (31 fail) | 1.00 ±0.00 | 0.97 ±0.15 (2 fail) |

_Thresholds (WARN-only): faithfulness ≥ 0.9 · answer_relevancy ≥ 0.85 · context_precision ≥ 0.8 · context_recall ≥ 0.75 · refusal_correctness ≥ 0.75 · groundedness_self_eval ≥ 0.85_

### Gen-eval threshold violations

**lessons** (47):
  - `lesson-pg-uuid-casing` — faithfulness<0.9, answer_relevancy<0.85, context_recall<0.75
  - `lesson-undici-version-pinning` — faithfulness<0.9, context_recall<0.75, groundedness_self_eval<0.85
  - `lesson-pyenv-python3-shim` — answer_relevancy<0.85, context_recall<0.75
  - `lesson-npm-test-silent-skip` — answer_relevancy<0.85, context_recall<0.75
  - `lesson-api-lessons-items-shape` — answer_relevancy<0.85
  - _(+42 more)_


## lessons — per-query detail

| id | group | found@ | friction | p50 ms |
|---|---|---|---|---:|
| lesson-pg-uuid-casing | confident-hit | 1 | clean | 120 |
| lesson-undici-version-pinning | confident-hit | 1 | clean | 108 |
| lesson-pyenv-python3-shim | confident-hit | 1 | clean | 108 |
| lesson-npm-test-silent-skip | confident-hit | 1 | clean | 103 |
| lesson-api-lessons-items-shape | confident-hit | 1 | clean | 105 |
| lesson-review-impl-default | confident-hit | 1 | clean | 105 |
| lesson-noproject-guard-hydration | confident-hit | 1 | clean | 132 |
| lesson-project-crud-validation | confident-hit | 1 | clean | 107 |
| lesson-multi-project-color | confident-hit | 1 | clean | 95 |
| lesson-code-review-workflow-pref | confident-hit | 1 | clean | 109 |
| lesson-dup-max-retry-guardrail | duplicate-trap | 1,2,3,4,5 | clean | 95 |
| lesson-dup-global-search-retry-pattern | duplicate-trap | 1,2 | clean | 96 |
| lesson-dup-valid-impexp-fixture | duplicate-trap | 1,2,3,4,5 | clean | 93 |
| lesson-miss-unicorn | adversarial-miss | — | — | 98 |
| lesson-miss-astrophysics | adversarial-miss | — | — | 98 |
| lesson-miss-falconry | adversarial-miss | — | — | 102 |
| lesson-cross-integration-test-backoff | cross-topic | 1,2,5,6,7,8,10 | clean | 90 |
| lesson-cross-sprint-11-closeout | cross-topic | — | no-relevant-hit | 119 |
| lesson-cross-workflow-gate | cross-topic | 2,9 | clean | 95 |
| lesson-cross-agent-bootstrap-e2e | cross-topic | 1,3 | clean | 107 |
| lesson-ambig-measurement-methodology | ambiguous-multi-target | 2,8,10 | clean | 103 |
| lesson-ambig-dedup-key-design | ambiguous-multi-target | 1,2,3,4 | clean | 98 |
| lesson-ambig-review-impl-default | ambiguous-multi-target | 1,2 | clean | 101 |
| lesson-ambig-popularity-feedback | ambiguous-multi-target | 1,2 | clean | 103 |
| lesson-ambig-baseline-drift | ambiguous-multi-target | 1,5 | clean | 100 |
| lesson-ambig-numeric-edge-cases | ambiguous-multi-target | 1,9 | clean | 109 |
| lesson-ambig-test-infra-async | ambiguous-multi-target | 1,2 | clean | 101 |
| lesson-ambig-noise-floor | ambiguous-multi-target | 1,2,4,5 | clean | 98 |
| lesson-ambig-downstream-propagation | ambiguous-multi-target | 1,7,9 | clean | 100 |
| lesson-ambig-fire-and-forget-pool | ambiguous-multi-target | 1,2 | clean | 99 |
| lesson-ambig-multi-project-isolation | ambiguous-multi-target | 1,5 | clean | 111 |
| lesson-ambig-composite-relevance | ambiguous-multi-target | 1,4 | clean | 113 |
| lesson-ambig-content-empty-dedup | ambiguous-multi-target | 1,2,8 | clean | 95 |
| lesson-ambig-recency-frequency-retrieval | ambiguous-multi-target | 2 | clean | 98 |
| lesson-ambig-dedup-e2e-testing | ambiguous-multi-target | 1,3 | clean | 100 |
| lesson-para-pg-map-miss | semantic-paraphrase | 1 | clean | 97 |
| lesson-para-undici-node-mismatch | semantic-paraphrase | — | no-relevant-hit | 105 |
| lesson-para-nan-defensive-math | semantic-paraphrase | 1 | clean | 100 |
| lesson-para-new-test-not-running | semantic-paraphrase | 1 | clean | 113 |
| lesson-para-windows-python-newlines | semantic-paraphrase | 1 | clean | 101 |
| lesson-edge-multi-hop-1 | edge-multi-hop | — | no-relevant-hit | 101 |
| lesson-edge-multi-hop-2 | edge-multi-hop | 1,2,7 | clean | 91 |
| lesson-edge-no-answer-1 | edge-no-answer | — | — | 121 |
| lesson-edge-contradictory-1 | edge-contradictory | 1 | clean | 95 |
| lesson-edge-contradictory-2 | edge-contradictory | — | no-relevant-hit | 95 |
| lesson-edge-paraphrase-1 | edge-paraphrase | 1 | clean | 116 |
| lesson-edge-paraphrase-2 | edge-paraphrase | 1 | clean | 95 |
| lesson-edge-distractor-1 | edge-distractor | 1 | clean | 101 |

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
