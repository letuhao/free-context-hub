---
tag: aieng-corpus-v3-rrf
commit: 8f9b3ca
branch: main
run_at: 2026-06-18T15:39:09.666Z
elapsed_ms: 985991
project_id_primary: free-context-hub
---

# RAG Baseline — aieng-corpus-v3-rrf

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
| chunks | free-context-hub | 56 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 108 | 151 |

## Gen-eval summary (per surface)

| Surface | rows w/ gt | rows judged | faithfulness | answer_relevancy | context_precision | context_recall | refusal_correctness | groundedness_self_eval |
|---|---:|---:|---:|---:|---:|---:|---:|---:|
| chunks | 56 | 56 | 0.92 ±0.11 (20 fail) | 0.65 ±0.06 (54 fail) | 0.87 ±0.18 (17 fail) | 0.99 ±0.04 (1 fail) | 1.00 ±0.00 | 1.00 ±0.00 |

_Thresholds (WARN-only): faithfulness ≥ 0.9 · answer_relevancy ≥ 0.85 · context_precision ≥ 0.8 · context_recall ≥ 0.75 · refusal_correctness ≥ 0.75 · groundedness_self_eval ≥ 0.85_

### Gen-eval threshold violations

**chunks** (54):
  - `AI-LLM-0001-s1` — faithfulness<0.9, answer_relevancy<0.85, context_precision<0.8
  - `AI-LLM-0001-s2` — answer_relevancy<0.85, context_precision<0.8
  - `AI-LLM-0001-s3` — answer_relevancy<0.85
  - `AI-LLM-0001-s4` — answer_relevancy<0.85
  - `AI-LLM-0001-s5` — answer_relevancy<0.85
  - _(+49 more)_


## chunks — per-query detail

| id | group | found@ | friction | p50 ms |
|---|---|---|---|---:|
| AI-LLM-0001-s1 | ai-engineering/llm-fundamentals | — | — | 151 |
| AI-LLM-0001-s2 | ai-engineering/llm-fundamentals | — | — | 111 |
| AI-LLM-0001-s3 | ai-engineering/llm-fundamentals | — | — | 112 |
| AI-LLM-0001-s4 | ai-engineering/llm-fundamentals | — | — | 112 |
| AI-LLM-0001-s5 | ai-engineering/llm-fundamentals | — | — | 112 |
| AI-LLM-0001-s6 | ai-engineering/llm-fundamentals | — | — | 116 |
| AI-LLM-0001-s7 | ai-engineering/llm-fundamentals | — | — | 134 |
| AI-RAG-0001-s1 | ai-engineering/rag | — | — | 112 |
| AI-RAG-0001-s2 | ai-engineering/rag | — | — | 107 |
| AI-RAG-0001-s3 | ai-engineering/rag | — | — | 130 |
| AI-RAG-0001-s4 | ai-engineering/rag | — | — | 105 |
| AI-RAG-0001-s5 | ai-engineering/rag | — | — | 108 |
| AI-RAG-0001-s6 | ai-engineering/rag | — | — | 108 |
| AI-RAG-0001-s7 | ai-engineering/rag | — | — | 104 |
| AI-VEC-0001-s1 | ai-engineering/vector-retrieval | — | — | 114 |
| AI-VEC-0001-s2 | ai-engineering/vector-retrieval | — | — | 110 |
| AI-VEC-0001-s3 | ai-engineering/vector-retrieval | — | — | 139 |
| AI-VEC-0001-s4 | ai-engineering/vector-retrieval | — | — | 102 |
| AI-VEC-0001-s5 | ai-engineering/vector-retrieval | — | — | 108 |
| AI-VEC-0001-s6 | ai-engineering/vector-retrieval | — | — | 111 |
| AI-VEC-0001-s7 | ai-engineering/vector-retrieval | — | — | 106 |
| AI-AGENT-0001-s1 | ai-engineering/agentic-ai | — | — | 105 |
| AI-AGENT-0001-s2 | ai-engineering/agentic-ai | — | — | 105 |
| AI-AGENT-0001-s3 | ai-engineering/agentic-ai | — | — | 117 |
| AI-AGENT-0001-s4 | ai-engineering/agentic-ai | — | — | 106 |
| AI-AGENT-0001-s5 | ai-engineering/agentic-ai | — | — | 105 |
| AI-AGENT-0001-s6 | ai-engineering/agentic-ai | — | — | 113 |
| AI-AGENT-0001-s7 | ai-engineering/agentic-ai | — | — | 105 |
| AI-EVAL-0001-s1 | ai-engineering/llm-evaluation | — | — | 108 |
| AI-EVAL-0001-s2 | ai-engineering/llm-evaluation | — | — | 107 |
| AI-EVAL-0001-s3 | ai-engineering/llm-evaluation | — | — | 106 |
| AI-EVAL-0001-s4 | ai-engineering/llm-evaluation | — | — | 107 |
| AI-EVAL-0001-s5 | ai-engineering/llm-evaluation | — | — | 105 |
| AI-EVAL-0001-s6 | ai-engineering/llm-evaluation | — | — | 107 |
| AI-EVAL-0001-s7 | ai-engineering/llm-evaluation | — | — | 113 |
| AI-PROMPT-0001-s1 | ai-engineering/prompt-context-engineering | — | — | 107 |
| AI-PROMPT-0001-s2 | ai-engineering/prompt-context-engineering | — | — | 107 |
| AI-PROMPT-0001-s3 | ai-engineering/prompt-context-engineering | — | — | 123 |
| AI-PROMPT-0001-s4 | ai-engineering/prompt-context-engineering | — | — | 105 |
| AI-PROMPT-0001-s5 | ai-engineering/prompt-context-engineering | — | — | 104 |
| AI-PROMPT-0001-s6 | ai-engineering/prompt-context-engineering | — | — | 103 |
| AI-PROMPT-0001-s7 | ai-engineering/prompt-context-engineering | — | — | 107 |
| AI-PROD-0001-s1 | ai-engineering/productionizing-llms | — | — | 109 |
| AI-PROD-0001-s2 | ai-engineering/productionizing-llms | — | — | 102 |
| AI-PROD-0001-s3 | ai-engineering/productionizing-llms | — | — | 109 |
| AI-PROD-0001-s4 | ai-engineering/productionizing-llms | — | — | 105 |
| AI-PROD-0001-s5 | ai-engineering/productionizing-llms | — | — | 104 |
| AI-PROD-0001-s6 | ai-engineering/productionizing-llms | — | — | 103 |
| AI-PROD-0001-s7 | ai-engineering/productionizing-llms | — | — | 106 |
| AI-ML-0001-s1 | ai-engineering/ml-mlops-basics | — | — | 104 |
| AI-ML-0001-s2 | ai-engineering/ml-mlops-basics | — | — | 109 |
| AI-ML-0001-s3 | ai-engineering/ml-mlops-basics | — | — | 109 |
| AI-ML-0001-s4 | ai-engineering/ml-mlops-basics | — | — | 107 |
| AI-ML-0001-s5 | ai-engineering/ml-mlops-basics | — | — | 105 |
| AI-ML-0001-s6 | ai-engineering/ml-mlops-basics | — | — | 104 |
| AI-ML-0001-s7 | ai-engineering/ml-mlops-basics | — | — | 113 |

## Friction observed (top examples)

_(none flagged by heuristic classifier)_

## Known limitations

- Latency varies ±10–20% across runs; quality metrics are deterministic.
- Global surface uses REST /api/search/global (ILIKE, not semantic); recall floor comes from raw substring matching.
- Code surface requires an indexed `chunks` population; empty index → 0 coverage regardless of query quality.
- `duplication_rate_at_10` v0 keys on exact entity id. Same-title-different-UUID noise (the original Phase-12 motivation: multiple lesson rows titled "Global search test retry pattern") is invisible to v0 — a reader seeing `dup@10 = 0` should NOT conclude "no duplication"; see `snippet-redundancy` in `docs/qc/friction-classes.md`.
- Golden-set ceiling bias: lesson queries are paraphrases of lesson content, and target ids were cherry-picked from recently-active lessons. Reported `recall@10 = 1.0` may reflect "queries are easy" rather than "retriever is strong." Sprint 12.1 should add adversarial queries (synonyms, typos, indirect references) to distinguish real improvement from noise.
