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

---

## 🗺️ Roadmap

We are currently in **Phase 3**. Here is our path forward:

- [x] **Phase 1-2**: MVP Core (Indexing, Search, Lessons, Guardrails).
- [x] **Phase 3**: Knowledge Distillation & Reflection (LLM-powered).
- [ ] **Phase 4**: Advanced Code Indexing & **Knowledge Graph Building**.
- [ ] **Phase 5**: **Automation Knowledge Building**: Auto-collecting insights from Git commits.
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

---

MIT License • [Whitepaper](WHITEPAPER.md) • [Agent Protocol](AGENT_PROTOCOL.md)
