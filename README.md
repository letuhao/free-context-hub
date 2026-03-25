# free-context-hub

Self-hosted "persistent memory + semantic code search + guardrails" for MCP-enabled AI tools.

This repo runs a local ContextHub MVP that exposes MCP tools (Cursor / Claude Code) so your assistant can:

- Index your repo into pgvector embeddings
- Search code by intent (`search_code`)
- Persist lessons/preferences per `project_id`
- Apply lightweight guardrails before risky actions

## Quickstart (run locally)

1. Configure environment:
   - `copy .env.example .env`
2. Start Postgres (pgvector):
   - `docker compose up -d`
3. Start your embeddings server (LM Studio):
   - must serve `POST /v1/embeddings`
4. Run the MCP server:
   - `npm install`
   - `npm run dev`
5. Verify everything works:
   - `npm run smoke-test`
6. Connect Cursor AI:
   - add MCP server URL: `http://localhost:3000/mcp`
   - by default (`MCP_AUTH_ENABLED=false`) you do NOT need to send `workspace_token`
   - if you set `MCP_AUTH_ENABLED=true`, then send `workspace_token` = your `.env` `CONTEXT_HUB_WORKSPACE_TOKEN`

For step-by-step setup (including Cursor MCP configuration), see: [`docs/QUICKSTART.md`](docs/QUICKSTART.md).

## Self-hosted models (embeddings + context builder)

ContextHub expects an **OpenAI-compatible** HTTP API. With [LM Studio](https://lmstudio.ai/) (or any compatible server), you typically run **two roles** on the same host: embeddings for indexing/search, and (optionally) a **chat** model for Phase 3 distillation, `reflect`, and `compress_context`.

### Embeddings (indexed code + lesson vectors)

| Setting | Default in `.env.example` | Notes |
| --- | --- | --- |
| `EMBEDDINGS_MODEL` | `mixedbread-ai/text-embedding-mxbai-embed-large-v1` | **1024 dimensions** — matches the Postgres `vector(1024)` schema and `EMBEDDINGS_DIM=1024`. |
| `EMBEDDINGS_DIM` | `1024` | Must match the model output; mismatch causes startup/index errors. |

Stick to this embedding model unless you change the DB schema and `EMBEDDINGS_DIM` to match another model’s output size.

### Context builder (chat — Phase 3, optional)

Set `DISTILLATION_ENABLED=true` and point `DISTILLATION_MODEL` at a **chat** model served from the same OpenAI-compatible base URL (often the same LM Studio server as embeddings: `DISTILLATION_BASE_URL` defaults to `EMBEDDINGS_BASE_URL`).

Reasonable **local** choices (names vary by how you imported the GGUF in LM Studio):

| Style | Example model ids (illustrative) | When to use |
| --- | --- | --- |
| Code-biased | `qwen2.5-coder-7b-instruct`, `qwen2.5-coder-14b-instruct` | Summaries, `reflect`, and guardrail-adjacent text tied to the repo. |
| General instruct | `qwen2.5-7b-instruct`, `qwen2.5-14b-instruct`, `meta-llama-3.1-8b-instruct` | Broader lesson distillation and compression. |
| Smaller / faster | `mistral-7b-instruct`, `phi-4` (if available in your stack) | Lower latency; shorter `summary` / `quick_action` quality. |

Use enough **RAM/VRAM** for the chat model you load; if the chat server is slow or unavailable, Phase 3 falls back (e.g. lessons stored as `draft` without distilled fields — see `docs/context/PHASE3_CONTEXT.md`).

## MCP Tools

This server exposes:

- `help` (start here: parameter docs + workflows + tool-call templates)
- `index_project`
- `search_code`
- `list_lessons`
- `search_lessons`
- `add_lesson`
- `check_guardrails`
- `get_context`
- `delete_workspace`
- Phase 3 (optional): `update_lesson_status`, `get_project_summary`, `reflect`, `compress_context`

Call the `help` tool for the authoritative list, parameters, and workflows.

## Troubleshooting

- `Unauthorized: invalid workspace_token`
  - occurs only when `MCP_AUTH_ENABLED=true`
  - Cursor tool arguments used the wrong token, or the server was started with an older `.env`.
- Embedding `dimension mismatch`
  - Set `EMBEDDINGS_DIM=1024` and use the matching default model `mixedbread-ai/text-embedding-mxbai-embed-large-v1`.
- LM Studio embeddings `401 Unauthorized`
  - Set `EMBEDDINGS_API_KEY` in `.env` (only if your embeddings endpoint requires it).
