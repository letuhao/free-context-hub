# Model Benchmark — 2026-03-28

## Objective

Find the best **embedding model** and **reranker model** for lesson search (the core feature of free-context-hub).
Lessons are natural language text — decisions, workarounds, preferences, guardrails.
Agents search with queries like "docker deployment issues" or "how does search work".

Code search uses ripgrep/FTS (deterministic), so models primarily affect lesson and doc retrieval quality.

---

## Embedding Model Benchmark

### Test Setup (Embedding)

- **10 real lessons** seeded from project decisions/workarounds
- **18 queries** (12 easy + 6 hard/ambiguous + 2 negative tests)
- **Hybrid search**: semantic embedding + 0.40 * FTS keyword boost
- **Metric**: pass = correct lesson in top 3; score = cosine similarity + FTS blend
- **Negative tests**: queries with no matching lesson should score < 0.5

### Results (Embedding)

| # | Model | Params | Dims | Pass | Avg Score | Min | Max | Index Time | Notes |
|---|-------|--------|------|------|-----------|-----|-----|-----------|-------|
| 1 | mxbai-embed-large-v1 | 335M | 1024 | 17/18 | 0.648 | 0.461 | 0.775 | ~55s | 1 failure, good avg |
| 2 | nomic-embed-text-v2 | 137M | 768 | 18/18 | 0.479 | 0.207 | 0.645 | ~55s | Low scores, fast |
| 3 | bge-m3 | 568M | 1024 | 18/18 | 0.575 | 0.383 | 0.706 | ~55s | Solid all-rounder |
| 4 | qwen3-embedding-4b | 4B | 2560 | 17/18 | 0.621 | 0.417 | 0.806 | ~73s | Needs halfvec (>2000d) |
| 5 | nomic-embed-code | 137M | 3584 | 18/18 | 0.381 | 0.143 | 0.611 | ~156s | Code model, bad for text |
| 6 | **qwen3-embedding-0.6b** | **600M** | **1024** | **18/18** | **0.652** | **0.426** | **0.793** | **~83s** | **Winner** |
| 7 | embeddinggemma-300m | 300M | 768 | 15/18 | 0.699 | 0.593 | 0.809 | ~68s | Highest avg but 3 failures |
| 8 | jina-v5-text-small-retrieval | ~150M | 1024 | 18/18 | 0.523 | 0.233 | 0.797 | ~84s | Middle of pack |

### Winner: Qwen3-Embedding-0.6B

- **18/18 pass rate** — every query finds the correct lesson
- **Highest avg among 18/18 models** (0.652) — best separation between relevant and irrelevant
- **1024 dimensions** — native pgvector HNSW, no halfvec workaround
- **600M params** — good balance of quality and speed

### Key Insight (Embedding)

Code embedding models don't help. Lessons are natural language text, not code. Code search uses ripgrep/FTS — no embeddings needed. A general-purpose text model is the right choice.

---

## Reranker Model Benchmark

### Test Setup (Reranker)

- **180 lessons** (real project decisions + diverse small-project scenarios)
- **33 queries** (29 positive matches + 4 negative tests)
- **Dynamic retrieval pool**: fetch top 40, rerank top 20 (scaled by lesson count)
- **Two reranker types tested**:
  - **Generative**: chat API, model outputs `{"order":[1,0,2]}` or `[1] > [3] > [2]`
  - **Cross-encoder**: embedding API, cosine similarity re-scoring

### Results (Reranker)

| # | Model | Type | Pass | Rate | Avg Latency | Accuracy vs Baseline | Notes |
|---|-------|------|------|------|-------------|---------------------|-------|
| 1 | (no rerank) | — | 25/33 | 76% | 99ms | baseline | Pure retrieval |
| 2 | qwen3-reranker-0.6b | generative | 25/33 | 76% | ~100ms | +0% | Too small, fails silently |
| 3 | gte-reranker-modernbert-base | cross-encoder | 23/33 | 70% | 490ms | -6% | Worse than baseline |
| 4 | bge-reranker-v2-gemma | cross-encoder | — | — | — | N/A | All scores 1.0, no discrimination |
| 5 | zerank-2 | generative | 26/33 | 79% | ~2s | +3% | |
| 6 | rank_zephyr_7b | generative (RankGPT) | 27/33 | 82% | ~2s | +6% | Uses [X] > [Y] format |
| 7 | qwen.qwen3-reranker-4b | generative | 28/33 | 85% | 1.9s | +9% | Thinking mode |
| 8 | **qwen3-4b-instruct-ranker** | **generative** | **28/33** | **85%** | **1.8s** | **+9%** | **Winner — no thinking overhead, best gap** |

### Winner: Qwen3-4B-Instruct-Ranker

- **28/33 (85%)** — tied best accuracy with qwen3-reranker-4b
- **No thinking mode** — outputs JSON directly, no reasoning tokens wasted
- **Best discrimination gap** (0.240) — cleanest separation between relevant and irrelevant
- **1.8s avg latency** — acceptable for interactive agent sessions

### Key Insights (Reranker)

1. **Cross-encoder models don't work via LM Studio** — bge-reranker and gte-reranker need a dedicated `/v1/rerank` API that LM Studio doesn't provide. Via embedding API, they output identical scores (no discrimination).

2. **Generative rerankers work** — models that can follow instructions and output JSON or RankGPT format are effective. The reranker generates a ranking, not just a score.

3. **Retrieval pool matters more than model choice** — widening the fetch pool from 8 to 20 candidates improved accuracy (+3%) more than switching between compatible reranker models.

4. **Dynamic scaling is essential** — rerank budget scales with lesson count: <20 lessons skip rerank, <200 rerank top 20, <500 rerank top 30. Enterprise pattern: retrieval is cheap, reranking is expensive.

### Scale Test Results

| Lessons | No Rerank | With Reranker (qwen3-4b-instruct-ranker) | Improvement |
|---------|-----------|------------------------------------------|-------------|
| 10 | 18/18 (100%) | — | Not needed |
| 40 | 25/33 (76%) | 30/33 (91%) | +15% |
| 98 | 25/33 (76%) | 28/33 (85%) | +9% |
| 180 | 25/33 (76%) | 28/33 (85%) | +9% |

---

## Recommended Model Combo

| Role | Model | Config |
|------|-------|--------|
| **Embeddings** | `qwen3-embedding-0.6b` (1024d) | `EMBEDDINGS_DIM=1024` |
| **Reranker** | `qwen3-4b-instruct-ranker` | `RERANK_MODEL=qwen3-4b-instruct-ranker` |
| **Distillation** | `qwen2.5-coder-7b-instruct` | `DISTILLATION_ENABLED=true` |
