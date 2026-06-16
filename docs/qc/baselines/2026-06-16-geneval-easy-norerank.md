---
tag: geneval-easy-norerank
commit: 3353494+dirty
branch: phase-16-sprint-16.1-gen-eval-dataset
run_at: 2026-06-16T05:40:10.361Z
elapsed_ms: 716226
project_id_primary: free-context-hub
---

# RAG Baseline — geneval-easy-norerank

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
| lessons | free-context-hub | 48 | 0 | 0.8889 | 0.8889 | 0.8519 | 0.8423 | 0.8277 | 0 | 0 | 0.8889 | 57 | 94 |

## Gen-eval summary (per surface)

| Surface | rows w/ gt | rows judged | faithfulness | answer_relevancy | context_precision | context_recall | refusal_correctness | groundedness_self_eval |
|---|---:|---:|---:|---:|---:|---:|---:|---:|
| lessons | 48 | 48 | 0.78 ±0.38 (14 fail) | 0.52 ±0.29 (40 fail) | 0.77 ±0.35 (14 fail) | 0.68 ±0.32 (26 fail) | 1.00 ±0.00 | 0.98 ±0.07 (3 fail) |

_Thresholds (WARN-only): faithfulness ≥ 0.9 · answer_relevancy ≥ 0.85 · context_precision ≥ 0.8 · context_recall ≥ 0.75 · refusal_correctness ≥ 0.75 · groundedness_self_eval ≥ 0.85_

### Gen-eval threshold violations

**lessons** (46):
  - `lesson-pg-uuid-casing` — faithfulness<0.9, answer_relevancy<0.85, context_recall<0.75
  - `lesson-undici-version-pinning` — faithfulness<0.9, context_recall<0.75, groundedness_self_eval<0.85
  - `lesson-pyenv-python3-shim` — answer_relevancy<0.85, context_precision<0.8
  - `lesson-npm-test-silent-skip` — answer_relevancy<0.85, context_recall<0.75
  - `lesson-api-lessons-items-shape` — answer_relevancy<0.85
  - _(+41 more)_


## lessons — per-query detail

| id | group | found@ | friction | p50 ms |
|---|---|---|---|---:|
| lesson-pg-uuid-casing | confident-hit | 1 | clean | 80 |
| lesson-undici-version-pinning | confident-hit | 1 | clean | 61 |
| lesson-pyenv-python3-shim | confident-hit | 1 | clean | 61 |
| lesson-npm-test-silent-skip | confident-hit | 1 | clean | 54 |
| lesson-api-lessons-items-shape | confident-hit | 1 | clean | 70 |
| lesson-review-impl-default | confident-hit | 1 | clean | 52 |
| lesson-noproject-guard-hydration | confident-hit | 1 | clean | 55 |
| lesson-project-crud-validation | confident-hit | 1 | clean | 56 |
| lesson-multi-project-color | confident-hit | 1 | clean | 54 |
| lesson-code-review-workflow-pref | confident-hit | 1 | clean | 56 |
| lesson-dup-max-retry-guardrail | duplicate-trap | 1,2,3,4,5 | clean | 49 |
| lesson-dup-global-search-retry-pattern | duplicate-trap | 1,2 | clean | 51 |
| lesson-dup-valid-impexp-fixture | duplicate-trap | 1,2,3,4,5 | clean | 46 |
| lesson-miss-unicorn | adversarial-miss | — | — | 53 |
| lesson-miss-astrophysics | adversarial-miss | — | — | 67 |
| lesson-miss-falconry | adversarial-miss | — | — | 56 |
| lesson-cross-integration-test-backoff | cross-topic | 1,2,7,9,10 | clean | 48 |
| lesson-cross-sprint-11-closeout | cross-topic | — | no-relevant-hit | 55 |
| lesson-cross-workflow-gate | cross-topic | — | no-relevant-hit | 60 |
| lesson-cross-agent-bootstrap-e2e | cross-topic | 1,3 | clean | 65 |
| lesson-ambig-measurement-methodology | ambiguous-multi-target | 1,9 | clean | 59 |
| lesson-ambig-dedup-key-design | ambiguous-multi-target | 1,2,3,4 | clean | 57 |
| lesson-ambig-review-impl-default | ambiguous-multi-target | 2,4 | clean | 53 |
| lesson-ambig-popularity-feedback | ambiguous-multi-target | 1,3 | clean | 54 |
| lesson-ambig-baseline-drift | ambiguous-multi-target | 1,3 | clean | 58 |
| lesson-ambig-numeric-edge-cases | ambiguous-multi-target | 3 | clean | 50 |
| lesson-ambig-test-infra-async | ambiguous-multi-target | 1,3,5 | clean | 47 |
| lesson-ambig-noise-floor | ambiguous-multi-target | 1,2,7 | clean | 54 |
| lesson-ambig-downstream-propagation | ambiguous-multi-target | 1,3 | clean | 54 |
| lesson-ambig-fire-and-forget-pool | ambiguous-multi-target | 1,3 | clean | 59 |
| lesson-ambig-multi-project-isolation | ambiguous-multi-target | 1,6 | clean | 54 |
| lesson-ambig-composite-relevance | ambiguous-multi-target | 1,2 | clean | 61 |
| lesson-ambig-content-empty-dedup | ambiguous-multi-target | 1,3,9 | clean | 57 |
| lesson-ambig-recency-frequency-retrieval | ambiguous-multi-target | 1,3 | clean | 57 |
| lesson-ambig-dedup-e2e-testing | ambiguous-multi-target | 1,2 | clean | 73 |
| lesson-para-pg-map-miss | semantic-paraphrase | 1 | clean | 54 |
| lesson-para-undici-node-mismatch | semantic-paraphrase | 1 | clean | 56 |
| lesson-para-nan-defensive-math | semantic-paraphrase | 1 | clean | 51 |
| lesson-para-new-test-not-running | semantic-paraphrase | 1 | clean | 51 |
| lesson-para-windows-python-newlines | semantic-paraphrase | 1 | clean | 53 |
| lesson-edge-multi-hop-1 | edge-multi-hop | — | no-relevant-hit | 57 |
| lesson-edge-multi-hop-2 | edge-multi-hop | 1,2 | clean | 55 |
| lesson-edge-no-answer-1 | edge-no-answer | — | — | 81 |
| lesson-edge-contradictory-1 | edge-contradictory | 2 | clean | 60 |
| lesson-edge-contradictory-2 | edge-contradictory | — | no-relevant-hit | 53 |
| lesson-edge-paraphrase-1 | edge-paraphrase | 1 | clean | 67 |
| lesson-edge-paraphrase-2 | edge-paraphrase | 1 | clean | 59 |
| lesson-edge-distractor-1 | edge-distractor | 1 | clean | 67 |

## Friction observed (top examples)

_(showing up to 3 per surface; 4 total queries have flagged friction across all surfaces)_

- **lessons/lesson-cross-sprint-11-closeout** — no-relevant-hit: query `sprint 11.6c-sec DNS pinning body-stall timeout security polish`; top-3 keys=[a0792c20-305b-4640-b6c7-befffcf5c3e1, f690c505-f146-4bcd-acf5-582bd441c731, 96cd0dc1-920c-420e-a703-1d9dca5e4e04]
- **lessons/lesson-cross-workflow-gate** — no-relevant-hit: query `workflow gate state machine 12-phase workflow v2.2`; top-3 keys=[7c632d4b-1486-4b11-910c-5214ad9e2d7d, beeef1e1-aa87-48c1-911d-235ad21ebfce, f690c505-f146-4bcd-acf5-582bd441c731]
- **lessons/lesson-edge-multi-hop-1** — no-relevant-hit: query `What two patterns combine for safe state-transition testing in coordination laye`; top-3 keys=[4e2b8497-8d8b-4d33-bd2d-1ffd2d66c860, f690c505-f146-4bcd-acf5-582bd441c731, 669855e9-5098-4b05-8161-1155589e8ff2]

## Known limitations

- Latency varies ±10–20% across runs; quality metrics are deterministic.
- Global surface uses REST /api/search/global (ILIKE, not semantic); recall floor comes from raw substring matching.
- Code surface requires an indexed `chunks` population; empty index → 0 coverage regardless of query quality.
- `duplication_rate_at_10` v0 keys on exact entity id. Same-title-different-UUID noise (the original Phase-12 motivation: multiple lesson rows titled "Global search test retry pattern") is invisible to v0 — a reader seeing `dup@10 = 0` should NOT conclude "no duplication"; see `snippet-redundancy` in `docs/qc/friction-classes.md`.
- Golden-set ceiling bias: lesson queries are paraphrases of lesson content, and target ids were cherry-picked from recently-active lessons. Reported `recall@10 = 1.0` may reflect "queries are easy" rather than "retriever is strong." Sprint 12.1 should add adversarial queries (synonyms, typos, indirect references) to distinguish real improvement from noise.
