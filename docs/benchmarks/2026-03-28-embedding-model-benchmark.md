# Embedding Model Benchmark — 2026-03-28

## Objective

Find the best embedding model for **lesson search** (the core feature of free-context-hub).
Lessons are natural language text — decisions, workarounds, preferences, guardrails.
Agents search them with natural language queries like "docker deployment issues" or "how does search work".

Code search uses ripgrep/FTS (deterministic), so the embedding model primarily affects lesson and doc retrieval quality.

## Test Setup

- **10 real lessons** seeded from project decisions/workarounds
- **18 queries** (12 easy direct matches + 6 hard/ambiguous + 2 negative tests)
- **Hybrid search**: semantic embedding + 0.40 * FTS keyword boost
- **Metric**: pass = correct lesson ranks in top 3; score = cosine similarity + FTS blend
- **Negative tests**: queries with no matching lesson should score < 0.5
- **Infrastructure**: LM Studio local, PostgreSQL + pgvector, Docker

## Results

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

## Winner: Qwen3-Embedding-0.6B

**Why it wins:**
- **18/18 pass rate** — every query finds the correct lesson in top 3
- **Highest average score among 18/18 models** (0.652) — better separation between relevant and irrelevant
- **1024 dimensions** — native pgvector HNSW support, no halfvec workaround needed
- **600M params** — good balance of quality and speed
- **Instruction-aware** — supports task prefixes for potential future optimization

**Why not the others:**
- `mxbai-embed-large`: close avg (0.648) but 1 failure — can't guarantee correct ranking
- `bge-m3`: solid (18/18, 0.575) but 13% lower avg score than qwen3-0.6b
- `qwen3-embedding-4b`: 4B params for +0.031 avg improvement doesn't justify 7x model size and halfvec requirement
- `embeddinggemma-300m`: highest raw scores (0.699 avg) but 3 failures — scores so high that negative tests break (everything above 0.5)
- `nomic-embed-code`: code-specific model is wrong for text lesson search
- `jina-v5-retrieval`: decent (18/18) but low avg (0.523)

## Key Insight

**Code embedding models don't help us.** Our embedding model is used for lesson search (natural language) and doc search, not code search. Code search uses ripgrep + symbol lookup + FTS — no embeddings needed. A general-purpose multilingual model optimized for text retrieval is the right choice.

## Recommended Model Combo

| Role | Model | Purpose |
|------|-------|---------|
| **Embeddings** | `qwen3-embedding-0.6b` (1024d) | Lesson + doc semantic search |
| **Distillation** | `qwen2.5-coder-7b-instruct` | Reflect, compress, lesson summarization |
| **Reranker** | `qwen.qwen3-reranker-4b` | LLM-based reranking (optional) |
