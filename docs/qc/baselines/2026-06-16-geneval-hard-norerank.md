---
tag: geneval-hard-norerank
commit: 3353494+dirty
branch: phase-16-sprint-16.1-gen-eval-dataset
run_at: 2026-06-16T05:52:07.710Z
elapsed_ms: 400809
project_id_primary: free-context-hub
---

# RAG Baseline — geneval-hard-norerank

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
| lessons | free-context-hub | 18 | 0 | 0.2778 | 0.6667 | 0.1159 | 0.1099 | 0.2414 | 0 | 0 | 0.6667 | 60 | 94 |

## Gen-eval summary (per surface)

| Surface | rows w/ gt | rows judged | faithfulness | answer_relevancy | context_precision | context_recall | refusal_correctness | groundedness_self_eval |
|---|---:|---:|---:|---:|---:|---:|---:|---:|
| lessons | 18 | 18 | 0.42 ±0.47 (12 fail) | 0.22 ±0.32 (18 fail) | 0.26 ±0.29 (17 fail) | 0.31 ±0.42 (14 fail) | — | 0.97 ±0.09 (2 fail) |

_Thresholds (WARN-only): faithfulness ≥ 0.9 · answer_relevancy ≥ 0.85 · context_precision ≥ 0.8 · context_recall ≥ 0.75 · refusal_correctness ≥ 0.75 · groundedness_self_eval ≥ 0.85_

### Gen-eval threshold violations

**lessons** (18):
  - `lesson-stress-4a1e3c16` — faithfulness<0.9, answer_relevancy<0.85, context_precision<0.8, context_recall<0.75, groundedness_self_eval<0.85
  - `lesson-stress-1eaa0a03` — answer_relevancy<0.85, context_precision<0.8, context_recall<0.75
  - `lesson-stress-289f24f9` — faithfulness<0.9, answer_relevancy<0.85, context_precision<0.8, context_recall<0.75
  - `lesson-stress-004444c4` — faithfulness<0.9, answer_relevancy<0.85, context_precision<0.8
  - `lesson-stress-beeef1e1` — answer_relevancy<0.85, context_precision<0.8, context_recall<0.75
  - _(+13 more)_


## lessons — per-query detail

| id | group | found@ | friction | p50 ms |
|---|---|---|---|---:|
| lesson-stress-4a1e3c16 | rerank-stress-headroom | — | no-relevant-hit | 55 |
| lesson-stress-1eaa0a03 | rerank-stress-headroom | 7 | rank-order-inversion | 65 |
| lesson-stress-289f24f9 | rerank-stress-headroom | — | no-relevant-hit | 60 |
| lesson-stress-004444c4 | rerank-stress-headroom | 6 | rank-order-inversion | 61 |
| lesson-stress-beeef1e1 | rerank-stress-headroom | 5 | rank-order-inversion | 69 |
| lesson-stress-206e30df | rerank-stress-headroom | 7 | rank-order-inversion | 74 |
| lesson-stress-d6648258 | rerank-stress-headroom | 8 | rank-order-inversion | 59 |
| lesson-stress-1ef42f81 | rerank-stress-headroom | 4 | rank-order-inversion | 60 |
| lesson-stress-abe242ea | rerank-stress-headroom | 5 | rank-order-inversion | 62 |
| lesson-stress-e87cd142 | rerank-stress-headroom | 6 | rank-order-inversion | 56 |
| lesson-stress-a0792c20 | rerank-stress-headroom | — | no-relevant-hit | 59 |
| lesson-stress-17320a37 | rerank-stress-headroom | 8 | rank-order-inversion | 60 |
| lesson-stress-57685eb8 | rerank-stress-headroom | — | no-relevant-hit | 61 |
| lesson-stress-ee1ec705 | rerank-stress-headroom | — | no-relevant-hit | 56 |
| lesson-stress-f690c505 | rerank-stress-headroom | — | no-relevant-hit | 53 |
| lesson-stress-e15edaef | rerank-stress-headroom | 5 | rank-order-inversion | 57 |
| lesson-stress-db9027fb | rerank-stress-headroom | 6 | rank-order-inversion | 60 |
| lesson-stress-b1d76cc8 | rerank-stress-headroom | 5 | rank-order-inversion | 61 |

## Friction observed (top examples)

_(showing up to 3 per surface; 18 total queries have flagged friction across all surfaces)_

- **lessons/lesson-stress-4a1e3c16** — no-relevant-hit: query `How to ensure an active process uses original data instead of updated rules?`; top-3 keys=[24ab1511-6373-4171-80c4-600d101d2a2a, 5ab3a1ba-b0b4-481c-997a-5b0f61138d63, a2763aed-b84e-4ad8-9ba7-5d37be9bbbc0]
- **lessons/lesson-stress-1eaa0a03** — rank-order-inversion: query `How to safely stop processing all items in a collection without losing data or l`; top-3 keys=[206e30df-829a-46f1-b51e-93145f9105fb, 05fde055-3cef-41d4-a5d7-a65d6daeb442, e15edaef-1d63-4cff-a9cc-7f972a0887d5]
- **lessons/lesson-stress-289f24f9** — no-relevant-hit: query `Why are some event messages using different keys for the same status information`; top-3 keys=[b696708a-7877-491a-9e75-4fc6f948150a, 4e2b8497-8d8b-4d33-bd2d-1ffd2d66c860, 67bc4411-a8b4-4e37-ae62-fa843fe47f67]

## Known limitations

- Latency varies ±10–20% across runs; quality metrics are deterministic.
- Global surface uses REST /api/search/global (ILIKE, not semantic); recall floor comes from raw substring matching.
- Code surface requires an indexed `chunks` population; empty index → 0 coverage regardless of query quality.
- `duplication_rate_at_10` v0 keys on exact entity id. Same-title-different-UUID noise (the original Phase-12 motivation: multiple lesson rows titled "Global search test retry pattern") is invisible to v0 — a reader seeing `dup@10 = 0` should NOT conclude "no duplication"; see `snippet-redundancy` in `docs/qc/friction-classes.md`.
- Golden-set ceiling bias: lesson queries are paraphrases of lesson content, and target ids were cherry-picked from recently-active lessons. Reported `recall@10 = 1.0` may reflect "queries are easy" rather than "retriever is strong." Sprint 12.1 should add adversarial queries (synonyms, typos, indirect references) to distinguish real improvement from noise.
