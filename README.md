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

## MCP Tools

This server exposes:

- `index_project`
- `search_code`
- `get_preferences`
- `add_lesson`
- `check_guardrails`
- `delete_workspace`

## Troubleshooting

- `Unauthorized: invalid workspace_token`
  - occurs only when `MCP_AUTH_ENABLED=true`
  - Cursor tool arguments used the wrong token, or the server was started with an older `.env`.
- Embedding `dimension mismatch`
  - Set `EMBEDDINGS_DIM=1024` and use the matching default model `mixedbread-ai/text-embedding-mxbai-embed-large-v1`.
- LM Studio embeddings `401 Unauthorized`
  - Set `EMBEDDINGS_API_KEY` in `.env` (only if your embeddings endpoint requires it).
