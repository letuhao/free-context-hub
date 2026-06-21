---
tag: 2026-06-19-competency-smoke-aws
commit: 0c8f8f1+dirty
branch: feature/actor-data-boundary
run_at: 2026-06-19T10:47:39.063Z
elapsed_ms: 142132
project_id_primary: free-context-hub
---

# RAG Baseline — 2026-06-19-competency-smoke-aws

## Gen-eval manifest

- **answerer:** `google/gemma-4-26b-a4b-qat` @ `http://localhost:1234/v1` (temp=0.2, seed=42, max_tokens=1024)
- **judge:** `google/gemma-4-26b-a4b-qat` @ `http://host.docker.internal:1234/v1` (temp=0, seed=42)
- **judge prompts hash:** `c0165a73c10c4e04`
- **synthesizer template hashes:**
  - lessons: `13ac4e950489bde6`
  - code: `3a2ea1624ae0a1fc`
  - chunks: `a01005e0d102b2c1`
  - global: `9816150d043baca5`

## Summary (all surfaces)

| Surface | Project | Q | err | recall@5 | recall@10 | MRR | nDCG@5 | nDCG@10 | dup@10 | dup@10 nearsem | cov% | p50 ms | p95 ms |
|---|---|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|
| chunks | free-context-hub | 7 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 151 | 1047 |

## Gen-eval summary (per surface)

| Surface | rows w/ gt | rows judged | faithfulness | answer_relevancy | context_precision | context_recall | refusal_correctness | groundedness_self_eval |
|---|---:|---:|---:|---:|---:|---:|---:|---:|
| chunks | 7 | 7 | 0.86 ±0.09 (5 fail) | 0.63 ±0.09 (7 fail) | 1.00 ±0.00 | 1.00 ±0.00 | — | 1.00 ±0.00 |

_Thresholds (WARN-only): faithfulness ≥ 0.9 · answer_relevancy ≥ 0.85 · context_precision ≥ 0.8 · context_recall ≥ 0.75 · refusal_correctness ≥ 0.75 · groundedness_self_eval ≥ 0.85_

### Gen-eval threshold violations

**chunks** (7):
  - `AWS-STO-0001-s1` — faithfulness<0.9, answer_relevancy<0.85
  - `AWS-STO-0001-s2` — faithfulness<0.9, answer_relevancy<0.85
  - `AWS-STO-0001-s3` — faithfulness<0.9, answer_relevancy<0.85
  - `AWS-STO-0001-s4` — answer_relevancy<0.85
  - `AWS-STO-0001-s5` — faithfulness<0.9, answer_relevancy<0.85
  - _(+2 more)_


## chunks — per-query detail

| id | group | found@ | friction | p50 ms |
|---|---|---|---|---:|
| AWS-STO-0001-s1 | aws-ops/storage | — | — | 1047 |
| AWS-STO-0001-s2 | aws-ops/storage | — | — | 155 |
| AWS-STO-0001-s3 | aws-ops/storage | — | — | 151 |
| AWS-STO-0001-s4 | aws-ops/storage | — | — | 146 |
| AWS-STO-0001-s5 | aws-ops/storage | — | — | 143 |
| AWS-STO-0001-s6 | aws-ops/storage | — | — | 144 |
| AWS-STO-0001-s7 | aws-ops/storage | — | — | 154 |

## Friction observed (top examples)

_(none flagged by heuristic classifier)_

## Known limitations

- Latency varies ±10–20% across runs; quality metrics are deterministic.
- Global surface uses REST /api/search/global (ILIKE, not semantic); recall floor comes from raw substring matching.
- Code surface requires an indexed `chunks` population; empty index → 0 coverage regardless of query quality.
- `duplication_rate_at_10` v0 keys on exact entity id. Same-title-different-UUID noise (the original Phase-12 motivation: multiple lesson rows titled "Global search test retry pattern") is invisible to v0 — a reader seeing `dup@10 = 0` should NOT conclude "no duplication"; see `snippet-redundancy` in `docs/qc/friction-classes.md`.
- Golden-set ceiling bias: lesson queries are paraphrases of lesson content, and target ids were cherry-picked from recently-active lessons. Reported `recall@10 = 1.0` may reflect "queries are easy" rather than "retriever is strong." Sprint 12.1 should add adversarial queries (synonyms, typos, indirect references) to distinguish real improvement from noise.
