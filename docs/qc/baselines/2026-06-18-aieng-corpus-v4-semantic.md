---
tag: aieng-corpus-v4-semantic
commit: a04a88b+dirty
branch: main
run_at: 2026-06-18T16:25:41.662Z
elapsed_ms: 987312
project_id_primary: free-context-hub
---

# RAG Baseline — aieng-corpus-v4-semantic

## Gen-eval manifest

- **answerer:** `google/gemma-4-26b-a4b-qat` @ `http://127.0.0.1:1234/v1` (temp=0, seed=42, max_tokens=1024)
- **judge:** `google/gemma-4-26b-a4b-qat` @ `http://host.docker.internal:1234/v1` (temp=0, seed=42)
- **judge prompts hash:** `c0165a73c10c4e04`
- **synthesizer template hashes:**
  - lessons: `376244262baa3815`
  - code: `87bbbc3366fea99a`
  - chunks: `483d75de7d8a2cba`
  - global: `bbfc552fbd293364`
  - chunks:claim-eval: `e36c87ae32c4422d`

## Summary (all surfaces)

| Surface | Project | Q | err | recall@5 | recall@10 | MRR | nDCG@5 | nDCG@10 | dup@10 | dup@10 nearsem | cov% | p50 ms | p95 ms |
|---|---|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|
| chunks | free-context-hub | 56 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 119 | 161 |

## Gen-eval summary (per surface)

| Surface | rows w/ gt | rows judged | faithfulness | answer_relevancy | context_precision | context_recall | refusal_correctness | groundedness_self_eval |
|---|---:|---:|---:|---:|---:|---:|---:|---:|
| chunks | 56 | 56 | 0.81 ±0.28 (27 fail) | 0.56 ±0.21 (54 fail) | 0.78 ±0.32 (19 fail) | 0.85 ±0.30 (13 fail) | 1.00 ±0.00 | 0.99 ±0.04 (1 fail) |

_Thresholds (WARN-only): faithfulness ≥ 0.9 · answer_relevancy ≥ 0.85 · context_precision ≥ 0.8 · context_recall ≥ 0.75 · refusal_correctness ≥ 0.75 · groundedness_self_eval ≥ 0.85_

### Gen-eval threshold violations

**chunks** (54):
  - `AI-LLM-0001-s1` — faithfulness<0.9, answer_relevancy<0.85, context_precision<0.8
  - `AI-LLM-0001-s2` — answer_relevancy<0.85, context_recall<0.75
  - `AI-LLM-0001-s3` — answer_relevancy<0.85
  - `AI-LLM-0001-s4` — answer_relevancy<0.85, context_precision<0.8
  - `AI-LLM-0001-s5` — answer_relevancy<0.85
  - _(+49 more)_


## chunks — per-query detail

| id | group | found@ | friction | p50 ms |
|---|---|---|---|---:|
| AI-LLM-0001-s1 | ai-engineering/llm-fundamentals | — | — | 123 |
| AI-LLM-0001-s2 | ai-engineering/llm-fundamentals | — | — | 119 |
| AI-LLM-0001-s3 | ai-engineering/llm-fundamentals | — | — | 124 |
| AI-LLM-0001-s4 | ai-engineering/llm-fundamentals | — | — | 132 |
| AI-LLM-0001-s5 | ai-engineering/llm-fundamentals | — | — | 120 |
| AI-LLM-0001-s6 | ai-engineering/llm-fundamentals | — | — | 119 |
| AI-LLM-0001-s7 | ai-engineering/llm-fundamentals | — | — | 115 |
| AI-RAG-0001-s1 | ai-engineering/rag | — | — | 119 |
| AI-RAG-0001-s2 | ai-engineering/rag | — | — | 119 |
| AI-RAG-0001-s3 | ai-engineering/rag | — | — | 122 |
| AI-RAG-0001-s4 | ai-engineering/rag | — | — | 114 |
| AI-RAG-0001-s5 | ai-engineering/rag | — | — | 117 |
| AI-RAG-0001-s6 | ai-engineering/rag | — | — | 113 |
| AI-RAG-0001-s7 | ai-engineering/rag | — | — | 120 |
| AI-VEC-0001-s1 | ai-engineering/vector-retrieval | — | — | 118 |
| AI-VEC-0001-s2 | ai-engineering/vector-retrieval | — | — | 116 |
| AI-VEC-0001-s3 | ai-engineering/vector-retrieval | — | — | 124 |
| AI-VEC-0001-s4 | ai-engineering/vector-retrieval | — | — | 119 |
| AI-VEC-0001-s5 | ai-engineering/vector-retrieval | — | — | 123 |
| AI-VEC-0001-s6 | ai-engineering/vector-retrieval | — | — | 123 |
| AI-VEC-0001-s7 | ai-engineering/vector-retrieval | — | — | 119 |
| AI-AGENT-0001-s1 | ai-engineering/agentic-ai | — | — | 134 |
| AI-AGENT-0001-s2 | ai-engineering/agentic-ai | — | — | 140 |
| AI-AGENT-0001-s3 | ai-engineering/agentic-ai | — | — | 125 |
| AI-AGENT-0001-s4 | ai-engineering/agentic-ai | — | — | 113 |
| AI-AGENT-0001-s5 | ai-engineering/agentic-ai | — | — | 119 |
| AI-AGENT-0001-s6 | ai-engineering/agentic-ai | — | — | 141 |
| AI-AGENT-0001-s7 | ai-engineering/agentic-ai | — | — | 120 |
| AI-EVAL-0001-s1 | ai-engineering/llm-evaluation | — | — | 131 |
| AI-EVAL-0001-s2 | ai-engineering/llm-evaluation | — | — | 117 |
| AI-EVAL-0001-s3 | ai-engineering/llm-evaluation | — | — | 119 |
| AI-EVAL-0001-s4 | ai-engineering/llm-evaluation | — | — | 121 |
| AI-EVAL-0001-s5 | ai-engineering/llm-evaluation | — | — | 123 |
| AI-EVAL-0001-s6 | ai-engineering/llm-evaluation | — | — | 117 |
| AI-EVAL-0001-s7 | ai-engineering/llm-evaluation | — | — | 118 |
| AI-PROMPT-0001-s1 | ai-engineering/prompt-context-engineering | — | — | 120 |
| AI-PROMPT-0001-s2 | ai-engineering/prompt-context-engineering | — | — | 119 |
| AI-PROMPT-0001-s3 | ai-engineering/prompt-context-engineering | — | — | 119 |
| AI-PROMPT-0001-s4 | ai-engineering/prompt-context-engineering | — | — | 122 |
| AI-PROMPT-0001-s5 | ai-engineering/prompt-context-engineering | — | — | 119 |
| AI-PROMPT-0001-s6 | ai-engineering/prompt-context-engineering | — | — | 116 |
| AI-PROMPT-0001-s7 | ai-engineering/prompt-context-engineering | — | — | 118 |
| AI-PROD-0001-s1 | ai-engineering/productionizing-llms | — | — | 121 |
| AI-PROD-0001-s2 | ai-engineering/productionizing-llms | — | — | 120 |
| AI-PROD-0001-s3 | ai-engineering/productionizing-llms | — | — | 119 |
| AI-PROD-0001-s4 | ai-engineering/productionizing-llms | — | — | 115 |
| AI-PROD-0001-s5 | ai-engineering/productionizing-llms | — | — | 116 |
| AI-PROD-0001-s6 | ai-engineering/productionizing-llms | — | — | 109 |
| AI-PROD-0001-s7 | ai-engineering/productionizing-llms | — | — | 121 |
| AI-ML-0001-s1 | ai-engineering/ml-mlops-basics | — | — | 117 |
| AI-ML-0001-s2 | ai-engineering/ml-mlops-basics | — | — | 119 |
| AI-ML-0001-s3 | ai-engineering/ml-mlops-basics | — | — | 113 |
| AI-ML-0001-s4 | ai-engineering/ml-mlops-basics | — | — | 114 |
| AI-ML-0001-s5 | ai-engineering/ml-mlops-basics | — | — | 121 |
| AI-ML-0001-s6 | ai-engineering/ml-mlops-basics | — | — | 113 |
| AI-ML-0001-s7 | ai-engineering/ml-mlops-basics | — | — | 120 |

## Friction observed (top examples)

_(none flagged by heuristic classifier)_

## Known limitations

- Latency varies ±10–20% across runs; quality metrics are deterministic.
- Global surface uses REST /api/search/global (ILIKE, not semantic); recall floor comes from raw substring matching.
- Code surface requires an indexed `chunks` population; empty index → 0 coverage regardless of query quality.
- `duplication_rate_at_10` v0 keys on exact entity id. Same-title-different-UUID noise (the original Phase-12 motivation: multiple lesson rows titled "Global search test retry pattern") is invisible to v0 — a reader seeing `dup@10 = 0` should NOT conclude "no duplication"; see `snippet-redundancy` in `docs/qc/friction-classes.md`.
- Golden-set ceiling bias: lesson queries are paraphrases of lesson content, and target ids were cherry-picked from recently-active lessons. Reported `recall@10 = 1.0` may reflect "queries are easy" rather than "retriever is strong." Sprint 12.1 should add adversarial queries (synonyms, typos, indirect references) to distinguish real improvement from noise.
