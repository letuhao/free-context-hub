---
tag: smoke-geneval
commit: 3353494+dirty
branch: phase-16-sprint-16.1-gen-eval-dataset
run_at: 2026-06-16T05:34:37.395Z
elapsed_ms: 82053
project_id_primary: free-context-hub
---

# RAG Baseline — smoke-geneval

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
| lessons | free-context-hub | 5 | 0 | 1 | 1 | 1 | 1 | 1 | 0 | 0 | 1 | 109 | 965 |

## Gen-eval summary (per surface)

| Surface | rows w/ gt | rows judged | faithfulness | answer_relevancy | context_precision | context_recall | refusal_correctness | groundedness_self_eval |
|---|---:|---:|---:|---:|---:|---:|---:|---:|
| lessons | 5 | 5 | 0.93 ±0.13 (1 fail) | 0.69 ±0.13 (4 fail) | 1.00 ±0.00 | 0.63 ±0.22 (4 fail) | — | 1.00 ±0.00 |

_Thresholds (WARN-only): faithfulness ≥ 0.9 · answer_relevancy ≥ 0.85 · context_precision ≥ 0.8 · context_recall ≥ 0.75 · refusal_correctness ≥ 0.75 · groundedness_self_eval ≥ 0.85_

### Gen-eval threshold violations

**lessons** (5):
  - `lesson-pg-uuid-casing` — faithfulness<0.9, answer_relevancy<0.85, context_recall<0.75
  - `lesson-undici-version-pinning` — context_recall<0.75
  - `lesson-pyenv-python3-shim` — answer_relevancy<0.85, context_recall<0.75
  - `lesson-npm-test-silent-skip` — answer_relevancy<0.85, context_recall<0.75
  - `lesson-api-lessons-items-shape` — answer_relevancy<0.85


## lessons — per-query detail

| id | group | found@ | friction | p50 ms |
|---|---|---|---|---:|
| lesson-pg-uuid-casing | confident-hit | 1 | clean | 887 |
| lesson-undici-version-pinning | confident-hit | 1 | clean | 106 |
| lesson-pyenv-python3-shim | confident-hit | 1 | clean | 117 |
| lesson-npm-test-silent-skip | confident-hit | 1 | clean | 100 |
| lesson-api-lessons-items-shape | confident-hit | 1 | clean | 94 |

## Friction observed (top examples)

_(none flagged by heuristic classifier)_

## Known limitations

- Latency varies ±10–20% across runs; quality metrics are deterministic.
- Global surface uses REST /api/search/global (ILIKE, not semantic); recall floor comes from raw substring matching.
- Code surface requires an indexed `chunks` population; empty index → 0 coverage regardless of query quality.
- `duplication_rate_at_10` v0 keys on exact entity id. Same-title-different-UUID noise (the original Phase-12 motivation: multiple lesson rows titled "Global search test retry pattern") is invisible to v0 — a reader seeing `dup@10 = 0` should NOT conclude "no duplication"; see `snippet-redundancy` in `docs/qc/friction-classes.md`.
- Golden-set ceiling bias: lesson queries are paraphrases of lesson content, and target ids were cherry-picked from recently-active lessons. Reported `recall@10 = 1.0` may reflect "queries are easy" rather than "retriever is strong." Sprint 12.1 should add adversarial queries (synonyms, typos, indirect references) to distinguish real improvement from noise.
