# Search & Retrieval

free-context-hub combines **lexical** (exact / full-text) and **semantic** (vector)
search across three corpora: lessons, code, and document chunks. A reranking stage
sharpens results when enabled.

## Key concepts

- **Embeddings** — text is embedded via any OpenAI-compatible endpoint
  (`EMBEDDINGS_BASE_URL`). The recommended model is `bge-m3` / `qwen3-embedding`
  (1024-dim). See the [benchmark](../benchmarks/2026-03-28-embedding-model-benchmark.md).
- **Tiered search** — code search escalates through tiers, stopping when a tier
  returns confident hits:
  - *code-search*: ripgrep → symbol → full-text → semantic
  - *relationship*: convention paths → KG imports → filtered ripgrep
  - *semantic-first*: vector similarity → full-text (for docs/scripts)
- **Reranking** — an optional cross-encoder/generative reranker reorders the top-N
  candidates. `qwen3-4b-instruct-ranker` is recommended (+9% accuracy at scale).
  Runs as a separate service (TEI on port 28417); falls back gracefully if absent.
- **Hybrid document search** — document chunks are searched with combined semantic
  + FTS scoring.

## How to use it

### MCP (agents)

| Tool | Searches | Notes |
|------|----------|-------|
| `search_lessons` | lessons | multi-project, dedup, salience-weighted |
| `search_code_tiered` | code | auto-selects a tier profile by `kind` |
| `search_code` | code | direct vector similarity over indexed chunks |
| `search_document_chunks` | documents | hybrid semantic + FTS |
| `search_symbols` | code symbols | requires `KG_ENABLED` (Neo4j) |

**When to use which:** use `search_lessons` for "what did we decide / any workaround
for X". Use `search_code_tiered(kind: "test"|"doc")` to find a test or doc. For
"where is function X defined", your agent's built-in Grep/Glob is faster.

### REST

- `POST /api/search/code-tiered` — tiered code search
- `GET /api/search/global` — global search (powers Cmd+K)
- `POST /api/lessons/search` — semantic lesson search
- `GET /api/documents/:id/chunks` — chunk search within a document

### GUI

- **Code Search** (`/knowledge/search`) — tiered search with file-kind filters and relevance scores.
- **Cmd+K** — global search overlay available on every page.
- Search bars on **Lessons**, **Documents**, and **Activity**.

## Configuration

```bash
EMBEDDINGS_BASE_URL=http://localhost:1234   # OpenAI-compatible endpoint
EMBEDDINGS_MODEL=text-embedding-bge-m3
EMBEDDINGS_DIM=1024
RERANK_MODEL=qwen3-4b-instruct-ranker       # optional; omit to disable reranking
REDIS_ENABLED=false                          # enables tiered-search caching
```

## Related

- [Memory & Lessons](01-memory-lessons.md) · [Code Intelligence](04-code-intelligence.md) · [Documents & Ingestion](05-documents-ingestion.md)
- Quality measurement: [`../benchmarks/`](../benchmarks/) (recall@k, MRR, latency budgets)
