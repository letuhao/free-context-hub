---
tag: cove-ab-cove-edge-v2
commit: e9de752+dirty
branch: fix-model-swap-orchestration
run_at: 2026-06-18T09:36:02.121Z
elapsed_ms: 397327
project_id_primary: free-context-hub
---

# RAG Baseline — cove-ab-cove-edge-v2

## Gen-eval manifest

- **answerer:** `google/gemma-4-26b-a4b-qat` @ `http://localhost:1234/v1` (temp=0.2, seed=42, max_tokens=1024)
- **judge:** `google/gemma-4-26b-a4b-qat` @ `http://host.docker.internal:1234/v1` (temp=0, seed=42)
- **judge prompts hash:** `c0165a73c10c4e04`
- **synthesizer template hashes:**
  - lessons: `376244262baa3815`
  - code: `87bbbc3366fea99a`
  - chunks: `483d75de7d8a2cba`
  - global: `bbfc552fbd293364`

## Summary (all surfaces)

| Surface | Project | Q | err | recall@5 | recall@10 | MRR | nDCG@5 | nDCG@10 | dup@10 | dup@10 nearsem | cov% | p50 ms | p95 ms |
|---|---|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|
| lessons | free-context-hub | 8 | 0 | 0.625 | 0.625 | 0.625 | 0.5996 | 0.5976 | 0 | 0 | 0.625 | 91 | 110 |
| code | free-context-hub | 10 | 0 | 0.1 | 0.2 | 0.0611 | 0.0631 | 0.0932 | 0 | 0 | 0.2 | 60 | 3701 |
| chunks | free-context-hub | 3 | 0 | 0.6667 | 0.6667 | 0.6667 | 0.6611 | 0.6611 | 0 | 0 | 0.6667 | 70 | 84 |
| global | free-context-hub | 4 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0.2 | 0 | 3 | 21 |

## Gen-eval summary (per surface)

| Surface | rows w/ gt | rows judged | faithfulness | answer_relevancy | context_precision | context_recall | refusal_correctness | groundedness_self_eval |
|---|---:|---:|---:|---:|---:|---:|---:|---:|
| lessons | 8 | 8 | 0.52 ±0.47 (4 fail) | 0.42 ±0.37 (7 fail) | 0.69 ±0.43 (3 fail) | 0.48 ±0.33 (7 fail) | 1.00 ±0.00 | 1.00 ±0.00 |
| code | 10 | 10 | 0.63 ±0.48 (3 fail) | 0.09 ±0.25 (8 fail) | 0.08 ±0.25 (9 fail) | 0.13 ±0.31 (9 fail) | 1.00 ±0.00 | 0.90 ±0.30 (1 fail) |
| chunks | 3 | 3 | 1.00 ±0.00 | 0.67 ±0.16 (2 fail) | 0.67 ±0.47 (1 fail) | 0.61 ±0.28 (2 fail) | 1.00 ±0.00 | 1.00 ±0.00 |
| global | 4 | 1 | 0.75 ±0.00 (1 fail) | 0.41 ±0.00 (1 fail) | 0.00 ±0.00 (1 fail) | 0.50 ±0.00 (1 fail) | — | 0.40 ±0.00 (1 fail) |

_Thresholds (WARN-only): faithfulness ≥ 0.9 · answer_relevancy ≥ 0.85 · context_precision ≥ 0.8 · context_recall ≥ 0.75 · refusal_correctness ≥ 0.75 · groundedness_self_eval ≥ 0.85_

### Gen-eval threshold violations

**lessons** (8):
  - `lesson-edge-multi-hop-1` — faithfulness<0.9, answer_relevancy<0.85, context_precision<0.8, context_recall<0.75
  - `lesson-edge-multi-hop-2` — answer_relevancy<0.85, context_recall<0.75
  - `lesson-edge-no-answer-1` — context_precision<0.8, context_recall<0.75
  - `lesson-edge-contradictory-1` — answer_relevancy<0.85, context_recall<0.75
  - `lesson-edge-contradictory-2` — faithfulness<0.9, answer_relevancy<0.85, context_precision<0.8, context_recall<0.75
  - _(+3 more)_

**code** (9):
  - `code-edge-multi-hop-1` — answer_relevancy<0.85, context_precision<0.8, context_recall<0.75, groundedness_self_eval<0.85
  - `code-edge-no-answer-1` — context_precision<0.8, context_recall<0.75
  - `code-edge-contradictory-1` — faithfulness<0.9, answer_relevancy<0.85, context_precision<0.8, context_recall<0.75
  - `code-edge-contradictory-2` — faithfulness<0.9, answer_relevancy<0.85, context_precision<0.8, context_recall<0.75
  - `code-edge-paraphrase-1` — faithfulness<0.9, answer_relevancy<0.85, context_precision<0.8, context_recall<0.75
  - _(+4 more)_

**chunks** (2):
  - `chunk-edge-multi-hop-1` — answer_relevancy<0.85, context_precision<0.8, context_recall<0.75
  - `chunk-edge-distractor-1` — answer_relevancy<0.85, context_recall<0.75

**global** (1):
  - `global-edge-contradictory-1` — faithfulness<0.9, answer_relevancy<0.85, context_precision<0.8, context_recall<0.75, groundedness_self_eval<0.85


## lessons — per-query detail

| id | group | found@ | friction | p50 ms |
|---|---|---|---|---:|
| lesson-edge-multi-hop-1 | edge-multi-hop | — | no-relevant-hit | 110 |
| lesson-edge-multi-hop-2 | edge-multi-hop | 1,2,7 | clean | 91 |
| lesson-edge-no-answer-1 | edge-no-answer | — | — | 86 |
| lesson-edge-contradictory-1 | edge-contradictory | 1 | clean | 85 |
| lesson-edge-contradictory-2 | edge-contradictory | — | no-relevant-hit | 86 |
| lesson-edge-paraphrase-1 | edge-paraphrase | 1 | clean | 92 |
| lesson-edge-paraphrase-2 | edge-paraphrase | 1 | clean | 98 |
| lesson-edge-distractor-1 | edge-distractor | 1 | clean | 86 |

## code — per-query detail

| id | group | found@ | friction | p50 ms |
|---|---|---|---|---:|
| code-edge-multi-hop-1 | edge-multi-hop | 9 | rank-order-inversion | 3701 |
| code-edge-no-answer-1 | edge-no-answer | — | — | 3156 |
| code-edge-no-answer-2 | edge-no-answer | — | — | 52 |
| code-edge-contradictory-1 | edge-contradictory | — | no-relevant-hit | 56 |
| code-edge-contradictory-2 | edge-contradictory | — | no-relevant-hit | 55 |
| code-edge-paraphrase-1 | edge-paraphrase | — | no-relevant-hit | 64 |
| code-edge-paraphrase-2 | edge-paraphrase | — | no-relevant-hit | 61 |
| code-edge-distractor-1 | edge-distractor | 2 | clean | 60 |
| code-edge-distractor-2 | edge-distractor | — | no-relevant-hit | 51 |
| code-edge-distractor-3 | edge-distractor | — | no-relevant-hit | 57 |

## chunks — per-query detail

| id | group | found@ | friction | p50 ms |
|---|---|---|---|---:|
| chunk-edge-multi-hop-1 | edge-multi-hop | 1,2,4 | clean | 64 |
| chunk-edge-no-answer-1 | edge-no-answer | — | — | 70 |
| chunk-edge-distractor-1 | edge-distractor | 1 | clean | 70 |

## global — per-query detail

| id | group | found@ | friction | p50 ms |
|---|---|---|---|---:|
| global-edge-multi-hop-1 | edge-multi-hop | — | empty-result-set;no-relevant-hit | 5 |
| global-edge-no-answer-1 | edge-no-answer | — | empty-result-set | 3 |
| global-edge-contradictory-1 | edge-contradictory | — | no-relevant-hit | 3 |
| global-edge-paraphrase-1 | edge-paraphrase | — | empty-result-set;no-relevant-hit | 6 |

## Friction observed (top examples)

_(showing up to 3 per surface; 13 total queries have flagged friction across all surfaces)_

- **lessons/lesson-edge-multi-hop-1** — no-relevant-hit: query `What two patterns combine for safe state-transition testing in coordination laye`; top-3 keys=[4e2b8497-8d8b-4d33-bd2d-1ffd2d66c860, 45c8cb44-9fb8-4dad-b825-5b1cd8b0a108, eb7409e5-d2bf-407b-9811-fca62a2c3ded]
- **lessons/lesson-edge-contradictory-2** — no-relevant-hit: query `Can a lesson drafted by an LLM be considered final without further review?`; top-3 keys=[c0e76a3d-cf5c-456a-b064-8731f3f62bc7, 45c8cb44-9fb8-4dad-b825-5b1cd8b0a108, 2097202f-4d46-4420-a088-d1351378286f]
- **code/code-edge-multi-hop-1** — rank-order-inversion: query `How does index_project hand off chunks to the embedding service before writing t`; top-3 keys=[packages/mcp-client/src/index.ts, src/env.ts, src/utils/resolveProjectRoot.ts]
- **code/code-edge-contradictory-1** — no-relevant-hit: query `Does MCP_AUTH_ENABLED apply uniformly across REST and MCP transports?`; top-3 keys=[src/qc/integrationTestRunner.ts, src/mcp/index.ts, packages/mcp-client/src/rest-client.ts]
- **code/code-edge-contradictory-2** — no-relevant-hit: query `Are retries enabled by default in this project's service layer?`; top-3 keys=[gui/src/contexts/project-context.tsx, src/services/repoSources.ts, packages/mcp-client/src/index.ts]
- **global/global-edge-multi-hop-1** — empty-result-set; no-relevant-hit: query `retry workflow`; top-3 keys=[]
- **global/global-edge-no-answer-1** — empty-result-set: query `obfuscation cipher quantum`; top-3 keys=[]
- **global/global-edge-contradictory-1** — no-relevant-hit: query `approval`; top-3 keys=[lesson:b85dc715-80d8-4f04-9efd-9bcd16a45dc3, guardrail:84829ccb-2fe7-40a8-9d78-475ee1cb7b87, guardrail:aea98de0-aa19-432e-a2bd-f6cff9abb2e5]

## Known limitations

- Latency varies ±10–20% across runs; quality metrics are deterministic.
- Global surface uses REST /api/search/global (ILIKE, not semantic); recall floor comes from raw substring matching.
- Code surface requires an indexed `chunks` population; empty index → 0 coverage regardless of query quality.
- `duplication_rate_at_10` v0 keys on exact entity id. Same-title-different-UUID noise (the original Phase-12 motivation: multiple lesson rows titled "Global search test retry pattern") is invisible to v0 — a reader seeing `dup@10 = 0` should NOT conclude "no duplication"; see `snippet-redundancy` in `docs/qc/friction-classes.md`.
- Golden-set ceiling bias: lesson queries are paraphrases of lesson content, and target ids were cherry-picked from recently-active lessons. Reported `recall@10 = 1.0` may reflect "queries are easy" rather than "retriever is strong." Sprint 12.1 should add adversarial queries (synonyms, typos, indirect references) to distinguish real improvement from noise.
