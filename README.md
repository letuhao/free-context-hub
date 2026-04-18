<p align="center">
  <h1 align="center">free-context-hub</h1>
  <p align="center">
    <strong>Persistent memory and guardrails for AI coding agents — so they never start from zero again.</strong>
  </p>
  <p align="center">
    <a href="LICENSE"><img src="https://img.shields.io/badge/license-MIT-blue.svg" alt="MIT License"></a>
    <img src="https://img.shields.io/badge/node-%3E%3D20-brightgreen" alt="Node 20+">
    <img src="https://img.shields.io/badge/typescript-5.x-blue" alt="TypeScript">
    <img src="https://img.shields.io/badge/MCP-compatible-purple" alt="MCP Compatible">
    <img src="https://img.shields.io/badge/self--hosted-100%25-orange" alt="Self-Hosted">
  </p>
</p>

---

Every AI coding session starts with amnesia. Your agent forgets the architectural decisions you explained yesterday, the workaround you discovered last week, and the deployment rule your team agreed on last month. You re-explain, re-discover, re-enforce — over and over.

**free-context-hub** is a self-hosted, open-source [MCP](https://modelcontextprotocol.io/) server that gives AI assistants (Claude Code, Cursor, etc.) **persistent knowledge across sessions and agents** — decisions, preferences, workarounds, and guardrails that survive after a conversation ends.

It also provides a **web GUI** for humans to review, approve, and refine AI-generated knowledge — bridging **AI-to-AI** and **AI-to-Human** collaboration.

> Inspired by [ContextStream](https://contextstream.io/). Free, local, for small teams.

---

## Screenshots

> 20 pages, 70+ REST endpoints, full human-in-the-loop workflow.

### Dashboard — Knowledge health, insights, activity feed
![Dashboard](docs/screenshots/dashboard.png)

### AI Chat — Markdown rendering, tool calls, conversation history
![Chat](docs/screenshots/chat.png)

### Lessons — Search, filter, import/export, feedback signals
![Lessons](docs/screenshots/lessons.png)

### Review Inbox — Approve AI-generated lessons, trust levels
![Review Inbox](docs/screenshots/review-inbox.png)

### Lesson Detail — Rich editor, comments, version history
![Lesson Detail](docs/screenshots/lesson-detail.png)

### Analytics — Retrieval trends, dead knowledge, agent activity
![Analytics](docs/screenshots/analytics.png)

### Documents — Upload, link, generate lessons from docs
![Documents](docs/screenshots/documents.png)

### Guardrails — Test presets, "What Would Block?" simulate mode
![Guardrails](docs/screenshots/guardrails.png)

---

## Tech Stack

| Layer | Technology |
|:------|:-----------|
| **Backend** | Node.js + TypeScript, MCP protocol server |
| **Frontend** | Next.js 16, React 19, Tailwind CSS 4 |
| **Primary Database** | PostgreSQL 16 + pgvector (data + embeddings) |
| **Knowledge Graph** | Neo4j 5 (optional — symbol extraction via ts-morph) |
| **Job Queue** | RabbitMQ (background workers for git ingestion, reflection) |
| **Cache** | Redis (tiered search caching) |
| **AI Integration** | MCP (Model Context Protocol) — open standard for agent tool use |
| **Embeddings** | Any OpenAI-compatible endpoint (LM Studio, Ollama, etc.) |
| **Deployment** | Docker Compose — single-node, self-hosted, zero cloud dependency |

---

## Architecture

```
 AI Agents (Claude Code, Cursor, etc.)
        │ MCP :3000
        ▼
 ┌─────────────────────────────────┐
 │       ContextHub Backend        │
 │  MCP Server · REST API · Chat   │
 │  Background Worker (jobs)       │
 │─────────────────────────────────│
 │        Services Layer           │
 │  lessons · guardrails · search  │
 │  git · jobs · docs · audit      │
 │─────────────────────────────────│
 │  Postgres   │ Neo4j  (optional) │
 │  + pgvector │ Redis  (optional) │
 │             │ Rabbit (optional) │
 └──────────────┬──────────────────┘
                │ REST :3001
                ▼
 ┌─────────────────────────────────┐
 │      GUI (Next.js :3002)        │
 │  20 pages · AI chat · Review    │
 │  Inbox · Analytics · Agents     │
 └─────────────────────────────────┘
                │
           Human (browser)
```

---

## Core Features

### 1. Persistent Lessons & Knowledge
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

### 2. Guardrails
Prevent repeated mistakes by enforcing team rules before risky actions.

- **`check_guardrails`** — Pre-action safety verification (git push, deploy, migrations)
- Guardrails are derived from lessons with `lesson_type: "guardrail"`
- Returns `pass/fail` + prompt for user confirmation when blocked

### 3. Session Bootstrap
Quick onboarding for new agent sessions.

- **`get_context`** — Bootstrap with project state + suggested next calls
- **`get_project_summary`** — Full project briefing in one read
- **`help`** — Tool discovery and sample workflows

### 4. Human-in-the-Loop GUI
A full web dashboard where humans review, approve, and refine AI-generated knowledge.

- **Review Inbox** — Batch approve/reject AI-generated lessons with trust levels
- **Rich Content Editor** — Markdown toolbar, live preview, keyboard shortcuts (Ctrl+B/I)
- **AI Editor** — Clarify, simplify, expand lessons with diff view (accept/reject)
- **Comments & Feedback** — Threaded comments, thumbs up/down, bookmarks
- **Activity & Analytics** — Timeline, retrieval trends, dead knowledge detection
- **Documents** — Upload reference docs, generate lessons from them
- **Global Search** — Cmd+K across all knowledge

### 5. Access Control & Agent Audit
Secure multi-agent environments with role-based access and full audit trails.

- **API Keys with Roles** — Admin, editor, viewer permissions via SHA-256 hashed keys
- **Agent Audit Trail** — Unified timeline of all agent actions (guardrail checks, lessons created)
- **Custom Lesson Types** — Define project-specific types beyond the defaults
- **Feature Toggles** — Enable/disable capabilities per project

### 6. Code Search (Supplementary)
Semantic code search assists agents in finding relevant code. Supplementary — agents already have built-in Grep/Glob.

- **`search_code_tiered`** — Multi-tier search with auto-selected profiles:
  - *code-search*: ripgrep → symbol → FTS → semantic
  - *relationship*: convention paths → KG imports → filtered ripgrep
  - *semantic-first*: vector similarity → FTS (for docs/scripts)

### 7. Git Intelligence (Supplementary)
Auto-collect insights from commit history.

- **`ingest_git_history`** / **`suggest_lessons_from_commits`** — Draft lessons from git
- **`analyze_commit_impact`** — Commit impact over symbol/lesson graph

### 8. Knowledge Graph (Optional)
Symbol-level code structure for advanced queries. Requires Neo4j.

- **`search_symbols`** / **`get_symbol_neighbors`** / **`trace_dependency_path`**
- **`get_lesson_impact`** — Which code does a lesson affect?

---

## Quickstart

### Prerequisites
- **Node.js 20+** and **npm**
- **Docker** (for PostgreSQL + pgvector)
- **Embeddings server** — [LM Studio](https://lmstudio.ai/) or any OpenAI-compatible endpoint

### Setup

```bash
# 1. Clone and install
git clone https://github.com/your-username/free-context-hub.git
cd free-context-hub
npm install

# 2. Configure environment
cp .env.example .env
# Edit .env — set DATABASE_URL and EMBEDDINGS_BASE_URL

# 3. Start infrastructure
docker compose up -d

# 4. Launch the backend (MCP + API)
npm run dev

# 5. Verify everything works
npm run smoke-test

# 6. (Optional) Launch the GUI
cd gui && npm install && npm run dev
```

### Connect Your AI Tool

Add the MCP server URL in your tool's settings:

```
http://localhost:3000/mcp
```

| Service | URL |
|:--------|:----|
| MCP Server | `http://localhost:3000/mcp` |
| REST API | `http://localhost:3001` |
| Web GUI | `http://localhost:3002` |

Detailed setup: [`docs/QUICKSTART.md`](docs/QUICKSTART.md)

---

## Self-Hosted Models

ContextHub uses OpenAI-compatible APIs. Run locally with [LM Studio](https://lmstudio.ai/) or any compatible server.

### Recommended Combo (benchmarked)

We tested 8 embedding models and 8 reranker models ([full benchmark](docs/benchmarks/2026-03-28-embedding-model-benchmark.md)). Best combo:

| Role | Model | Config |
|:-----|:------|:-------|
| **Embeddings** | `qwen3-embedding-0.6b` | `EMBEDDINGS_DIM=1024` — best accuracy (18/18 pass, avg 0.652) |
| **Reranker** | `qwen3-4b-instruct-ranker` | `RERANK_MODEL=qwen3-4b-instruct-ranker` — +9% accuracy at 180 lessons |
| **Distillation** | `qwen2.5-coder-7b-instruct` | `DISTILLATION_ENABLED=true` — reflect, compress, summarize |

### Alternative Models

**Embedding** (8 tested, lesson search accuracy):

| Model | Dims | Pass Rate | Avg Score | Notes |
|:------|:-----|:----------|:----------|:------|
| **qwen3-embedding-0.6b** | 1024 | 18/18 | 0.652 | Recommended |
| bge-m3 | 1024 | 18/18 | 0.575 | Fast, solid all-rounder |
| mxbai-embed-large-v1 | 1024 | 17/18 | 0.648 | Close but 1 failure |

**Reranker** (8 tested, 180 lessons / 33 queries):

| Model | Type | Pass Rate | Latency | Notes |
|:------|:-----|:----------|:--------|:------|
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
- [x] **Phase 7**: Interactive GUI & Human-in-the-Loop
  - 23 pages, 105 REST endpoints, 45 MCP tools, 41 migrations
  - Dashboard, Chat, Lessons, Review Inbox, Analytics, Documents, Guardrails, Settings, and more
- [x] **Phase 8**: Advanced HITL
  - Access control (API keys with roles), custom lesson types, rich content editor, agent audit trail, feature toggles
- [x] **Phase 8D/E**: Polish & Testing
  - Feature toggles BE, role enforcement middleware, layout fixes (viewport scroll, page sizing)
  - E2E test suite: 198 tests (API smoke 75, GUI smoke 23, MCP smoke 36, API scenarios 34, GUI scenarios 21, Agent visual 9)
- [x] **Phase 9**: Multi-Project UX Redesign
  - "All Projects" first-class mode with project selector V2 (multi-select, checkboxes)
  - ProjectBadge on all 23 pages, cross-project data on 8 pages (Dashboard, Lessons, Guardrails, Review, Analytics, Jobs, Activity, Agents)
  - Per-project guards on 4 pages (Graph Explorer, Code Search, Sources, Settings)
  - 6 backend services extended with `project_ids[]`, 9 `*Multi` API methods
  - 11 sprints, 26 commits, 41 files changed
- [x] **Phase 10**: Multi-Format Extraction Pipeline
  - Fast text (pdf-parse + mammoth), Quality text (pdftotext + pandoc), Vision (LLM via OpenAI-compatible API with per-page async jobs, progress reporting, cancel)
  - Chunking + pgvector embeddings with hierarchical/naive strategies, table/code/mermaid detection
  - Hybrid semantic + FTS chunk search across 4 surfaces: REST endpoint, Cmd+K global search, chat `search_documents` tool, MCP `search_document_chunks` tool
  - Chunk edit/delete with optimistic locking + re-embed; bulk vision re-extract
  - Image upload UX (drag-drop + thumbnail preview + auto-Vision preselect)
  - Mermaid diagram rendering everywhere MarkdownContent is used
  - SSRF-hardened URL ingestion (private-range DNS check, redirect re-validation, streaming size cap)
  - 7 sprints, 7 migrations, 47-test E2E suite incl real vision runs
- [x] **Phase 11**: Knowledge Portability
  - Zip+JSONL bundle format with sha256 per entry — streaming encoder/decoder
  - Full project export (`GET /api/projects/:id/export`) via pg-cursor
  - Full project import (`POST /api/projects/:id/import`) with 3 conflict policies (skip/overwrite/fail) + dry-run + cross-tenant UUID guard
  - GUI Knowledge Exchange panel embedded in Project Settings (drag-drop + Preview + Apply)
  - Cross-instance pull (`POST /api/projects/:id/pull-from`) with DNS-rebinding pinning + slow-loris body-stall defense
  - Streaming JSONL decode (~99% jsonl peak memory reduction) + streaming base64 encode on import (~45% PDF peak reduction)
  - Batched SELECT on import (~99% SELECT-count reduction)
  - 9 sub-sprints, 61 API e2e + 1 GUI Playwright + 39 unit tests, all through v2.2 12-phase workflow with `/review-impl`

**Intentionally Dropped:**
- ~~Multi-Agent Passive Collection~~ — Parsing agent conversations costs tokens and captures noise. `add_lesson` captures verified conclusions explicitly.
- ~~Session History Sharing~~ — Transcripts are 50k-200k tokens. The value is conclusions, not the journey.
- ~~IDE Extension~~ — Agents use MCP (done). Humans use the web GUI — works in any browser including VS Code's built-in browser.

---

## Project Stats

| Metric | Count |
|:-------|:------|
| MCP Tools | 45 |
| REST Endpoints | 105+ (adds `/export`, `/import`, `/pull-from` in Phase 11) |
| GUI Pages | 23 |
| Database Migrations | 41 |
| E2E Tests | 198+ (adds 15 Phase-11 tests; all passing) |
| Development Phases | **11/11 complete** |

---

## Contributing

Contributions are welcome! This is a solo project that grew into something useful — fresh eyes and ideas are appreciated.

1. Fork the repo
2. Create a feature branch (`git checkout -b feature/my-feature`)
3. Make your changes
4. Run `npm run smoke-test` to verify
5. Submit a pull request

Please open an issue first for large changes so we can discuss the approach.

---

## Troubleshooting

- **`Unauthorized: invalid workspace_token`**: Set `MCP_AUTH_ENABLED=false` in `.env` or provide the correct token.
- **`dimension mismatch`**: Ensure `EMBEDDINGS_DIM=1024` matches your model's output.
- **`401 Unauthorized` (LM Studio)**: Check `EMBEDDINGS_API_KEY` in your `.env`.

---

## License

MIT — see [LICENSE](LICENSE) for details.

[Whitepaper](WHITEPAPER.md) | [Quickstart Guide](docs/QUICKSTART.md) | [Knowledge Exchange Reference](docs/references/knowledge-exchange.md)
