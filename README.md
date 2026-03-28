# free-context-hub

> **Self-hosted persistent memory + guardrails for AI coding agents. Free, local, for small teams.**

free-context-hub is a local [ContextStream](https://contextstream.io/)-inspired MCP server that gives your AI assistants (Claude Code, Cursor, etc.) **persistent knowledge across sessions and agents** — decisions, preferences, workarounds, and guardrails that survive after a conversation ends.

---

## Why This Exists

Every new AI agent session starts from zero. The agent doesn't know:
- Why your team chose JWT over sessions
- That Redis cache must be flushed after deployment
- That pushing without tests broke production last month
- Your team's naming conventions and architectural preferences

**free-context-hub solves this.** One agent captures a lesson, every future agent benefits — across sessions, across team members, persistently.

---

## Core Features (Priority Order)

### 1. Persistent Lessons & Knowledge (Primary)
The main value proposition. Store and retrieve team knowledge that persists across sessions and agents.

- **`add_lesson`** — Capture decisions, preferences, workarounds, guardrails
- **`search_lessons`** — Semantic search across all stored knowledge
- **`list_lessons`** — Browse with filters (type, tags, status)
- **`update_lesson_status`** — Lifecycle management (draft → active → superseded → archived)
- **`reflect`** — LLM-synthesized answers from multiple lessons (optional, requires chat model)

**Example workflow:**
```
Agent A (Monday):   add_lesson("We use JWT not sessions — legal requires stateless auth")
Agent B (Thursday): search_lessons("authentication approach") → gets the decision instantly
Agent C (Next month): Doesn't waste time debating sessions vs JWT
```

### 2. Guardrails (Primary)
Prevent repeated mistakes by enforcing team rules before risky actions.

- **`check_guardrails`** — Pre-action safety verification (git push, deploy, migrations)
- Guardrails are derived from lessons with `lesson_type: "guardrail"`
- Returns `pass/fail` + prompt for user confirmation when blocked

### 3. Session Bootstrap (Primary)
Quick onboarding for new agent sessions.

- **`get_context`** — Bootstrap with project state + suggested next calls
- **`get_project_summary`** — Full project briefing in one read
- **`help`** — Tool discovery and sample workflows

### 4. Code Search (Supplementary)
Semantic code search assists agents in finding relevant code. This is a **supplementary feature**, not the core goal — agents already have built-in tools (Grep, Glob, Read) for code navigation.

- **`search_code_tiered`** — Multi-tier search with 3 auto-selected profiles:
  - *code-search*: ripgrep > symbol > FTS > semantic (for source/config/types)
  - *relationship*: convention paths > KG imports > filtered ripgrep (for tests)
  - *semantic-first*: vector similarity > FTS (for docs/scripts)
- **`search_code`** — Legacy semantic-only search
- **`index_project`** — Index repository into chunks + embeddings

### 5. Git Intelligence (Supplementary)
Auto-collect insights from commit history.

- **`ingest_git_history`** / **`suggest_lessons_from_commits`** — Draft lessons from git history
- **`analyze_commit_impact`** — Commit impact over symbol/lesson graph

### 6. Knowledge Graph (Optional)
Symbol-level code structure for advanced queries. Requires Neo4j.

- **`search_symbols`** / **`get_symbol_neighbors`** / **`trace_dependency_path`**
- **`get_lesson_impact`** — Which code does a lesson affect?

---

## Quickstart (Run Locally)

1.  **Configure Environment**:
    ```bash
    copy .env.example .env
    ```
2.  **Start Infrastructure**:
    ```bash
    docker compose up -d
    ```
    *(Requires Docker for Postgres + pgvector)*
3.  **Start Embeddings Server**:
    Ensure [LM Studio](https://lmstudio.ai/) or a compatible server is running and serving `POST /v1/embeddings`.
4.  **Launch ContextHub**:
    ```bash
    npm install
    npm run dev
    ```
5.  **Verify Setup**:
    ```bash
    npm run smoke-test
    ```
6.  **Connect Your AI Tool**:
    Add the MCP server URL in your tool's settings: `http://localhost:3000/mcp`.

Detailed setup: [`docs/QUICKSTART.md`](docs/QUICKSTART.md)

---

## Self-Hosted Models

ContextHub uses OpenAI-compatible APIs. Run locally with [LM Studio](https://lmstudio.ai/) or any compatible server.

### Recommended Combo (benchmarked)

We tested 8 embedding models on lesson search quality ([full benchmark](docs/benchmarks/2026-03-28-embedding-model-benchmark.md)). Best combo:

| Role | Model | Config |
| :--- | :--- | :--- |
| **Embeddings** | `qwen3-embedding-0.6b` | `EMBEDDINGS_DIM=1024` — best accuracy (18/18, avg 0.652) |
| **Distillation** | `qwen2.5-coder-7b-instruct` | `DISTILLATION_ENABLED=true` — reflect, compress, summarize |
| **Reranker** (optional) | `qwen3-reranker-4b` | `RERANK_MODEL=qwen.qwen3-reranker-4b` — LLM reranking |

### Alternative Embedding Models

| Model | Dims | Pass Rate | Avg Score | Best For |
| :--- | :--- | :--- | :--- | :--- |
| **qwen3-embedding-0.6b** | 1024 | 18/18 | 0.652 | Best overall (recommended) |
| bge-m3 | 1024 | 18/18 | 0.575 | Fast indexing, solid all-rounder |
| mxbai-embed-large-v1 | 1024 | 17/18 | 0.648 | Close second, 1 failure |
| jina-v5-text-small-retrieval | 1024 | 18/18 | 0.523 | Retrieval-optimized |

> **Note:** Code search uses ripgrep/FTS (deterministic), not embeddings. The embedding model only affects lesson and doc search quality. Code-specific models like `nomic-embed-code` performed worst (avg 0.381) for our use case.

---

## Roadmap

- [x] **Phase 1-2**: Core MVP — Lessons, Search, Guardrails
- [x] **Phase 3**: Knowledge Distillation & Reflection
- [x] **Phase 4**: Knowledge Graph (Neo4j, symbol-level)
- [x] **Phase 5**: Git Intelligence & Automation
- [x] **Phase 6**: Retrieval Quality Tuning & Tiered Search
- [ ] **Phase 7**: Multi-Agent Knowledge Sharing
- [ ] **Phase 8**: Interactive GUI for Knowledge Exploration
- [ ] **Phase 9**: Human-in-the-loop Correction
- [ ] **Phase 10**: Multi-format Ingestion (PDF, DOCX, Images)
- [ ] **Phase 11**: RAG to Insight (human-readable summaries)
- [ ] **Phase 12**: IDE Native (VS Code extension)
- [ ] **Phase 13**: Knowledge Portability (import/export)

---

## Troubleshooting

- **`Unauthorized: invalid workspace_token`**: Set `MCP_AUTH_ENABLED=false` in `.env` or provide the correct token.
- **`dimension mismatch`**: Ensure `EMBEDDINGS_DIM=1024` matches your model's output.
- **`401 Unauthorized` (LM Studio)**: Check `EMBEDDINGS_API_KEY` in your `.env`.

---

MIT License | [Whitepaper](WHITEPAPER.md) | [Agent Protocol](AGENT_PROTOCOL.md)
