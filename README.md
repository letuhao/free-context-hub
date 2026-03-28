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

We tested 8 embedding models and 8 reranker models ([full benchmark](docs/benchmarks/2026-03-28-embedding-model-benchmark.md)). Best combo:

| Role | Model | Config |
| :--- | :--- | :--- |
| **Embeddings** | `qwen3-embedding-0.6b` | `EMBEDDINGS_DIM=1024` — best accuracy (18/18 pass, avg 0.652) |
| **Reranker** | `qwen3-4b-instruct-ranker` | `RERANK_MODEL=qwen3-4b-instruct-ranker` — +9% accuracy at 180 lessons |
| **Distillation** | `qwen2.5-coder-7b-instruct` | `DISTILLATION_ENABLED=true` — reflect, compress, summarize |

### Alternative Models

**Embedding** (8 tested, lesson search accuracy):

| Model | Dims | Pass Rate | Avg Score | Notes |
| :--- | :--- | :--- | :--- | :--- |
| **qwen3-embedding-0.6b** | 1024 | 18/18 | 0.652 | Recommended |
| bge-m3 | 1024 | 18/18 | 0.575 | Fast, solid all-rounder |
| mxbai-embed-large-v1 | 1024 | 17/18 | 0.648 | Close but 1 failure |

**Reranker** (8 tested, 180 lessons / 33 queries):

| Model | Type | Pass Rate | Latency | Notes |
| :--- | :--- | :--- | :--- | :--- |
| **qwen3-4b-instruct-ranker** | generative | 85% | 1.8s | Recommended — no thinking overhead |
| qwen.qwen3-reranker-4b | generative | 85% | 1.9s | Thinking mode, same accuracy |
| rank_zephyr_7b | generative | 82% | ~2s | RankGPT format |
| (no rerank) | — | 76% | 99ms | Baseline |

> **Note:** Code search uses ripgrep/FTS (deterministic), not embeddings. Cross-encoder rerankers (bge-reranker, gte-reranker) don't work via LM Studio — they need a dedicated `/v1/rerank` API.

---

## Roadmap

**Completed:**
- [x] **Phase 1-2**: Core MVP — Lessons, Search, Guardrails
- [x] **Phase 3**: Knowledge Distillation & Reflection
- [x] **Phase 4**: Knowledge Graph (Neo4j, symbol-level)
- [x] **Phase 5**: Git Intelligence & Automation
- [x] **Phase 6**: Retrieval Quality Tuning & Tiered Search

**Planned:**
- [ ] **Phase 7**: Interactive GUI for Knowledge Exploration
- [ ] **Phase 8**: Human-in-the-loop Correction
- [ ] **Phase 9**: Multi-format Ingestion (PDF, DOCX, Images)
- [ ] **Phase 10**: IDE Native (VS Code extension)
- [ ] **Phase 11**: Knowledge Portability (import/export)

**Dropped:**
- ~~Multi-Agent Passive Collection~~ — Passively monitor agent conversations and auto-extract lessons. Dropped: parsing conversations costs tokens (contradicts "reduce token usage" goal), most conversation is noise, and agents already call `add_lesson` explicitly with verified conclusions.
- ~~Session History Sharing~~ — Store and share full session transcripts between agents. Dropped: a single session transcript is 50k-200k tokens — sharing it defeats the purpose of reducing token usage. The value of a session is its conclusions, not the journey. `add_lesson` captures conclusions in ~100 tokens. `SESSION_PATCH.md` covers status. `search_lessons` lets any agent find any other agent's decisions. Full transcripts are noise that wastes context window.

---

## Troubleshooting

- **`Unauthorized: invalid workspace_token`**: Set `MCP_AUTH_ENABLED=false` in `.env` or provide the correct token.
- **`dimension mismatch`**: Ensure `EMBEDDINGS_DIM=1024` matches your model's output.
- **`401 Unauthorized` (LM Studio)**: Check `EMBEDDINGS_API_KEY` in your `.env`.

---

MIT License | [Whitepaper](WHITEPAPER.md) | [Agent Protocol](AGENT_PROTOCOL.md)
