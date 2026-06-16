---
tag: geneval-hard-crossencoder
commit: 3353494+dirty
branch: phase-16-sprint-16.1-gen-eval-dataset
run_at: 2026-06-16T06:12:34.806Z
elapsed_ms: 316793
project_id_primary: free-context-hub
---

# RAG Baseline — geneval-hard-crossencoder

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
| lessons | free-context-hub | 18 | 0 | 0.6667 | 0.8333 | 0.4704 | 0.5023 | 0.5579 | 0 | 0 | 0.8333 | 102 | 137 |

## Gen-eval summary (per surface)

| Surface | rows w/ gt | rows judged | faithfulness | answer_relevancy | context_precision | context_recall | refusal_correctness | groundedness_self_eval |
|---|---:|---:|---:|---:|---:|---:|---:|---:|
| lessons | 18 | 18 | 0.60 ±0.48 (8 fail) | 0.39 ±0.32 (18 fail) | 0.58 ±0.32 (12 fail) | 0.63 ±0.36 (11 fail) | — | 0.94 ±0.23 (1 fail) |

_Thresholds (WARN-only): faithfulness ≥ 0.9 · answer_relevancy ≥ 0.85 · context_precision ≥ 0.8 · context_recall ≥ 0.75 · refusal_correctness ≥ 0.75 · groundedness_self_eval ≥ 0.85_

### Gen-eval threshold violations

**lessons** (18):
  - `lesson-stress-4a1e3c16` — faithfulness<0.9, answer_relevancy<0.85, context_precision<0.8
  - `lesson-stress-1eaa0a03` — faithfulness<0.9, answer_relevancy<0.85, context_recall<0.75
  - `lesson-stress-289f24f9` — answer_relevancy<0.85, context_precision<0.8
  - `lesson-stress-004444c4` — answer_relevancy<0.85, context_precision<0.8, context_recall<0.75, groundedness_self_eval<0.85
  - `lesson-stress-beeef1e1` — faithfulness<0.9, answer_relevancy<0.85, context_precision<0.8, context_recall<0.75
  - _(+13 more)_


## lessons — per-query detail

| id | group | found@ | friction | p50 ms |
|---|---|---|---|---:|
| lesson-stress-4a1e3c16 | rerank-stress-headroom | 5 | rank-order-inversion | 92 |
| lesson-stress-1eaa0a03 | rerank-stress-headroom | 1 | clean | 100 |
| lesson-stress-289f24f9 | rerank-stress-headroom | 2 | clean | 98 |
| lesson-stress-004444c4 | rerank-stress-headroom | 6 | rank-order-inversion | 105 |
| lesson-stress-beeef1e1 | rerank-stress-headroom | — | no-relevant-hit | 102 |
| lesson-stress-206e30df | rerank-stress-headroom | 2 | clean | 105 |
| lesson-stress-d6648258 | rerank-stress-headroom | 3 | clean | 104 |
| lesson-stress-1ef42f81 | rerank-stress-headroom | 1 | clean | 101 |
| lesson-stress-abe242ea | rerank-stress-headroom | 2 | clean | 101 |
| lesson-stress-e87cd142 | rerank-stress-headroom | 1 | clean | 107 |
| lesson-stress-a0792c20 | rerank-stress-headroom | 1 | clean | 100 |
| lesson-stress-17320a37 | rerank-stress-headroom | 10 | rank-order-inversion | 106 |
| lesson-stress-57685eb8 | rerank-stress-headroom | 1 | clean | 101 |
| lesson-stress-ee1ec705 | rerank-stress-headroom | — | no-relevant-hit | 102 |
| lesson-stress-f690c505 | rerank-stress-headroom | — | no-relevant-hit | 105 |
| lesson-stress-e15edaef | rerank-stress-headroom | 2 | clean | 102 |
| lesson-stress-db9027fb | rerank-stress-headroom | 6 | rank-order-inversion | 110 |
| lesson-stress-b1d76cc8 | rerank-stress-headroom | 2 | clean | 108 |

## Friction observed (top examples)

_(showing up to 3 per surface; 7 total queries have flagged friction across all surfaces)_

- **lessons/lesson-stress-4a1e3c16** — rank-order-inversion: query `How to ensure an active process uses original data instead of updated rules?`; top-3 keys=[8a5198bc-cccf-4b30-84ef-30269c715d09, b3e6f670-b2da-4404-a54f-5853610e1ad0, 4e2b8497-8d8b-4d33-bd2d-1ffd2d66c860]
- **lessons/lesson-stress-004444c4** — rank-order-inversion: query `Why are identical content items being merged when they belong to different owner`; top-3 keys=[72a49cc5-6e44-4472-82da-097ef11beb26, 720f912b-c304-4dc7-bb9a-280657c3ed3f, 61835c5d-d5c8-4d61-9fa0-3497aadee229]
- **lessons/lesson-stress-beeef1e1** — no-relevant-hit: query `How to prevent multiple instances from running the same cleanup job simultaneous`; top-3 keys=[d6648258-41f0-41a7-a14e-8b1e01b3531b, b3e6f670-b2da-4404-a54f-5853610e1ad0, 5258dbfe-b76d-42aa-b680-15eb9a7b83d7]

## Known limitations

- Latency varies ±10–20% across runs; quality metrics are deterministic.
- Global surface uses REST /api/search/global (ILIKE, not semantic); recall floor comes from raw substring matching.
- Code surface requires an indexed `chunks` population; empty index → 0 coverage regardless of query quality.
- `duplication_rate_at_10` v0 keys on exact entity id. Same-title-different-UUID noise (the original Phase-12 motivation: multiple lesson rows titled "Global search test retry pattern") is invisible to v0 — a reader seeing `dup@10 = 0` should NOT conclude "no duplication"; see `snippet-redundancy` in `docs/qc/friction-classes.md`.
- Golden-set ceiling bias: lesson queries are paraphrases of lesson content, and target ids were cherry-picked from recently-active lessons. Reported `recall@10 = 1.0` may reflect "queries are easy" rather than "retriever is strong." Sprint 12.1 should add adversarial queries (synonyms, typos, indirect references) to distinguish real improvement from noise.
