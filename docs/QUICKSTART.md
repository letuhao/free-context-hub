# free-context-hub — Quickstart (Cursor AI + MCP)

This guide gets your local ContextHub MVP running (Postgres + embeddings) and connects Cursor AI via MCP tools.

## What you get

- MCP endpoint: `POST http://localhost:3000/mcp`
- Tools:
  - `index_project`
  - `search_code`
  - `get_preferences`
  - `add_lesson`
  - `check_guardrails`
  - `delete_workspace`
- Project-scoped persistent memory + semantic code search (pgvector)

## Prerequisites

- Node.js (for running the MCP server)
- Docker (for Postgres)
- LM Studio (or any OpenAI-compatible embeddings server) serving `POST /v1/embeddings`

## Step 1: Configure environment

From repo root:

```bash
# Windows (CMD/PowerShell)
copy .env.example .env
# macOS/Linux
# cp .env.example .env
```

Edit `.env` and ensure:

  - `MCP_AUTH_ENABLED=false` (default) to NOT require `workspace_token` on MCP tool calls
  - If you set `MCP_AUTH_ENABLED=true`, then `CONTEXT_HUB_WORKSPACE_TOKEN` must be set
- `EMBEDDINGS_BASE_URL` points to your embeddings server (default: `http://127.0.0.1:1234`)
- `EMBEDDINGS_MODEL` matches the DB embedding dimension (current MVP default is `mixedbread-ai/text-embedding-mxbai-embed-large-v1` with `EMBEDDINGS_DIM=1024`)

## Step 2: Start Postgres (Docker)

```bash
docker compose up -d
```

Postgres listens on `localhost:5432`.

## Step 3: Start embeddings server (LM Studio)

In LM Studio:

- Ensure the server exposes `POST /v1/embeddings`
- Use the embedding model configured in `.env` (default: `mixedbread-ai/text-embedding-mxbai-embed-large-v1`)
- If your embeddings server requires an API key, set `EMBEDDINGS_API_KEY` in `.env`

## Step 4: Run the MCP server

In another terminal:

```bash
npm install
npm run dev
```

Server listens on `MCP_PORT` (default `3000`) and applies SQL migrations on startup.

## Step 5: Smoke test (recommended)

```bash
npm run smoke-test
```

This verifies tool round-trips end-to-end (index -> search -> lessons -> guardrails -> project isolation).

## Step 6: Connect Cursor AI (MCP)

Cursor connects to MCP servers via configuration.

1. In Cursor, open MCP server settings (Tools & MCP).
2. Add a remote MCP server with:
   - URL: `http://localhost:3000/mcp`
   - Transport: Streamable HTTP (if you need to pick)
3. Restart Cursor after adding the server (Cursor caches MCP configs).

### Important: `workspace_token` is optional (required only if auth enabled)

This repo validates the token inside tool arguments (it is checked by `assertWorkspaceToken()` in the MCP server) only when `MCP_AUTH_ENABLED=true`.

So when Cursor calls any tool, the arguments must include:

-- `workspace_token` (optional): your `.env` value of `CONTEXT_HUB_WORKSPACE_TOKEN` (required only if `MCP_AUTH_ENABLED=true`)

Example arguments (shape):

```json
{
  "project_id": "demo-project-A",
  "root": "D:/your/repo"
}
```

### Tool cheat sheet (argument fields)

`index_project`

- `workspace_token` (optional; required only if `MCP_AUTH_ENABLED=true`)
- `project_id`
- `root`
- `options.lines_per_chunk` (default: `120`)
- `options.embedding_batch_size` (default: `8`)

`search_code`

- `workspace_token` (optional; required only if `MCP_AUTH_ENABLED=true`)
- `project_id`
- `query`
- `filters.path_glob` (optional)
- `limit` (optional)

`get_preferences`

- `workspace_token` (optional; required only if `MCP_AUTH_ENABLED=true`)
- `project_id`

`add_lesson`

- `workspace_token` (optional; required only if `MCP_AUTH_ENABLED=true`)
- `lesson_payload.project_id`
- `lesson_payload.lesson_type` (`decision | preference | guardrail | workaround | general_note`)
- `lesson_payload.title`
- `lesson_payload.content`
- `lesson_payload.tags` (optional)
- `lesson_payload.source_refs` (optional)
- `lesson_payload.guardrail` (optional; for guardrail lessons)

`check_guardrails`

- `workspace_token` (optional; required only if `MCP_AUTH_ENABLED=true`)
- `action_context.action` (e.g. `git push`)
- `action_context.project_id` (or `action_context.workspace`)

`delete_workspace`

- `workspace_token` (optional; required only if `MCP_AUTH_ENABLED=true`)
- `project_id`

## Troubleshooting

### `Unauthorized: invalid workspace_token`

- occurs only when `MCP_AUTH_ENABLED=true`
- Your Cursor config or tool arguments use the wrong token.
- Ensure `CONTEXT_HUB_WORKSPACE_TOKEN` matches the token you pass as `workspace_token`.
- If the server was started with an older `.env`, restart the MCP server.

### Embedding `dimension mismatch`

- The DB schema stores vectors as `vector(1024)`.
- Make sure:
  - `EMBEDDINGS_DIM=1024` in `.env`
  - `EMBEDDINGS_MODEL` is compatible (current default is `mixedbread-ai/text-embedding-mxbai-embed-large-v1`)

### LM Studio embedding returns `401 Unauthorized`

- Set `EMBEDDINGS_API_KEY` in `.env` (only if your LM Studio embeddings endpoint requires it).

### Tools not showing up in Cursor

- Confirm the MCP server is reachable: `http://localhost:3000/mcp`
- Run `npm run smoke-test` to verify connectivity and auth end-to-end.

