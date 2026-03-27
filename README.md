# 🧠 free-context-hub

> **Self-hosted "persistent memory + semantic code search + guardrails" for MCP-enabled AI tools.**

`free-context-hub` is a local ContextHub that empowers your AI assistants (Cursor, Claude Code, etc.) with long-term memory, deep codebase understanding, and safety guardrails—all running on your hardware.

---

## ✨ Key Features

- 📂 **Semantic Indexing**: Index your repositories into `pgvector` for intent-based search.
- 🔍 **Intent Search**: Find code by what it *does*, not just what it *says* (`search_code`).
- 🧠 **Persistent Lessons**: Decisions, preferences, and workarounds stay across sessions.
- 🛡️ **Smart Guardrails**: Apply lightweight safety checks before risky actions.
- 🔬 **Phase 3 Distillation**: (Optional) Use local LLMs to summarize and reflect on your team's knowledge.

---

## 🚀 Quickstart (Run Locally)

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
6.  **Connect Cursor AI**:
    Add the MCP server URL in Cursor settings: `http://localhost:3000/mcp`.
    *(Defaults to no auth; set `MCP_AUTH_ENABLED=true` in `.env` if needed.)*

Detailed setup guide: [`docs/QUICKSTART.md`](docs/QUICKSTART.md).

Storage policy guide: [`docs/storage/storage-contract.md`](docs/storage/storage-contract.md).

---

## 🤖 Self-Hosted Models

ContextHub uses OpenAI-compatible APIs. We recommend running **two roles** (can be the same LM Studio instance):

### 1. Embeddings (Indexing & Search)
- **Model**: `mixedbread-ai/text-embedding-mxbai-embed-large-v1` (Default)
- **Dimensions**: `1024` (Must match `EMBEDDINGS_DIM` in `.env`)

### 2. Context Builder (Distillation & Reflection)
Enable by setting `DISTILLATION_ENABLED=true`.

| Model Type | Recommended Models | Best Use Case |
| :--- | :--- | :--- |
| **Code-Focused** | `qwen2.5-coder-7b/14b` | Architecture summaries & `reflect` |
| **Generalist** | `qwen2.5-7b`, `llama-3.1-8b` | Lesson distillation & compression |
| **Lightweight** | `phi-4`, `mistral-7b` | Low-latency summaries |

### 3. Rerank Model (Optional, online for `search_code`)
Enable by calling `search_code` with `filters.rerank_mode="llm"` and configure:
- `RERANK_MODEL` (required for dedicated rerank; otherwise uses `DISTILLATION_MODEL`)
- `RERANK_BASE_URL`, `RERANK_API_KEY` (optional overrides)

Recommended rerank-oriented choices:
- **Best quality / enough VRAM**: `Qwen/Qwen2.5-14B-Instruct`
- **Balanced latency/quality**: `Qwen/Qwen2.5-7B-Instruct`
- **Low-resource**: `Mistral-7B-Instruct`, `Phi-4`

### 4. QA Agent Model (Optional, worker jobs `faq.build` / `raptor.build`)
Configure:
- `QA_AGENT_MODEL` (if omitted, fallback to `DISTILLATION_MODEL`)
- `QA_AGENT_BASE_URL`, `QA_AGENT_API_KEY` (optional overrides)

Recommended QA generation choices:
- **Balanced**: `Qwen/Qwen2.5-7B-Instruct`
- **Higher quality**: `Qwen/Qwen2.5-14B-Instruct`
- **Low-resource**: `Phi-4` / `Mistral-7B-Instruct`

> Can I use `qwen/qwen2.5-coder-14b` for rerank + QA to save PC resources?
>
> Yes, you can run one shared model for both to simplify setup. It works and is often good enough for code-heavy corpora.
> But for ranking/QA style outputs, **instruct/general models usually behave more stably** than coder-only models.
> Practical recommendation: start with one shared model, measure `qc:rag` delta + latency, then decide if splitting models is worth it.

---

## 🛠️ MCP Toolset

Exposed tools for your AI agent:

- 🆘 `help`: Tool discovery & sample workflows.
- 🏗️ `index_project`: Full repository indexing.
- 🔍 `search_code`: Semantic retrieval of code snippets.
- 📚 `list_lessons` / `search_lessons`: Access persistent memory.
- ✍️ `add_lesson`: Capture new decisions or guardrails.
- 👮 `check_guardrails`: Pre-action safety verification.
- 🏗️ `get_context`: Bootstrap session with project state.
- 🔄 `update_lesson_status`: Manage lesson lifecycle (Phase 3).
- 📋 `get_project_summary`: Get a full project briefing (Phase 3).
- 🧠 `reflect`: LLM-synthesized answers from lessons (Phase 3).
- 🗜️ `compress_context`: Chat-based text compression (Phase 3).
- 🧨 `delete_workspace`: Wipe project data.
- 🧾 `ingest_git_history` / `list_commits` / `get_commit`: Git intelligence ingestion + retrieval (Phase 5).
- 📝 `suggest_lessons_from_commits` / `link_commit_to_lesson`: Draft lesson automation from commit context (Phase 5).
- 🧭 `analyze_commit_impact`: Commit impact over Phase 4 symbol/lesson graph (Phase 5).
- 🗂️ `list_generated_documents` / `get_generated_document`: Audit DB-first generated artifacts (FAQ/RAPTOR/QC/benchmark) directly from MCP.
- 🔁 Worker automation + queue/source tools: `prepare_repo`, `enqueue_job`, `list_jobs` (with `correlation_id` filter), `run_next_job`, `scan_workspace`.
- 🗃️ DB-first generated artifacts: FAQ/RAPTOR/QC outputs are canonical in Postgres (`generated_documents`) and optionally exported to filesystem.

---

## 🗺️ Roadmap

We are currently in **Phase 5**. Here is our path forward:

- [x] **Phase 1-2**: MVP Core (Indexing, Search, Lessons, Guardrails).
- [x] **Phase 3**: Knowledge Distillation & Reflection (LLM-powered).
- [x] **Phase 4**: Advanced Code Indexing & **Knowledge Graph Building**.
- [x] **Phase 5**: **Automation Knowledge Building**: Auto-collecting insights from Git commits.
- [ ] **Phase 6**: **Multi-Agent Knowledge**: Collecting knowledge from inter-agent communications.
- [ ] **Phase 7**: **Interactive GUI**: A visual interface for humans to explore the knowledge base.
- [ ] **Phase 8**: **Human-in-the-loop**: Interactive correction and manual knowledge injection.
- [ ] **Phase 9**: **Multi-format Support**: PDF, DOCX, XLSX, and Image ingestion.
- [ ] **Phase 10**: **RAG to Insight**: Converting raw knowledge into human-readable text and diagrams.
- [ ] **Phase 11**: **IDE Native**: Deep integration with Visual Studio Code.
- [ ] **Phase 12**: **Knowledge Portability**: Import/Export knowledge to/from other infrastructure.

---

## 🔧 Troubleshooting

- **`Unauthorized: invalid workspace_token`**: Occurs if `MCP_AUTH_ENABLED=true` but the token is missing/wrong. Restart the server after `.env` changes.
- **`dimension mismatch`**: Ensure `EMBEDDINGS_DIM=1024` matches your model's output.
- **`401 Unauthorized` (LM Studio)**: Check `EMBEDDINGS_API_KEY` in your `.env`.
- **`validate:phase5-worker` reports mixed jobs**: pass `correlation_id` into `enqueue_job` and query `list_jobs` with the same `correlation_id`.

---

MIT License • [Whitepaper](WHITEPAPER.md) • [Agent Protocol](AGENT_PROTOCOL.md)
