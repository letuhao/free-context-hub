# free-context-hub — Quickstart (Cursor AI + MCP)

This guide gets your local ContextHub MVP running (Postgres + embeddings) and connects Cursor AI via MCP tools.

## What you get

- MCP endpoint: `POST http://localhost:3000/mcp`
- Tools:
  - `help` (parameter docs + workflows + tool-call templates)
  - `index_project`
  - `search_code`
  - `list_lessons`
  - `search_lessons`
  - `add_lesson`
  - `check_guardrails`
  - `get_context`
  - `delete_workspace`
  - Phase 4 (optional Neo4j graph, `KG_ENABLED=true`): `search_symbols`, `get_symbol_neighbors`, `trace_dependency_path`, `get_lesson_impact`
  - Phase 5 (optional Git intelligence, `GIT_INGEST_ENABLED=true`): `ingest_git_history`, `list_commits`, `get_commit`, `suggest_lessons_from_commits`, `link_commit_to_lesson`, `analyze_commit_impact`
  - Worker/queue/source tools: `configure_project_source`, `prepare_repo`, `enqueue_job`, `list_jobs`, `run_next_job`, `register_workspace_root`, `scan_workspace`
- Project-scoped persistent memory + semantic code search (pgvector)
- DB-first generated artifacts (`generated_documents`) for FAQ/RAPTOR/QC, with optional filesystem exports

## Prerequisites

- Docker (for Postgres + MCP server; Neo4j is included for Phase 4 graph features)
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
- Phase 4 graph (optional): set `KG_ENABLED=true` and point `NEO4J_URI` / `NEO4J_USERNAME` / `NEO4J_PASSWORD` at your Neo4j Bolt endpoint (Compose defaults: `bolt://neo4j:7687` inside the stack, `bolt://127.0.0.1:7687` from the host). When `KG_ENABLED=false`, the server skips graph ingest/query and Phase 1–3 tools behave as before.
- Phase 5 git intelligence (optional): set `GIT_INGEST_ENABLED=true` (and optional `GIT_MAX_COMMITS_PER_RUN`) to enable commit ingestion + automation tools.

## Step 2: Start Postgres + MCP server (Docker)

```bash
docker compose up -d
```

Postgres listens on `localhost:5432`. Neo4j Browser/Bolt: `http://localhost:7474` / `bolt://localhost:7687`. MCP listens on `http://localhost:3000/mcp`.

### Phase 5 Git ingestion in Docker

- The `mcp` and `worker` containers mount workspace at `/workspace` for indexing + generated export flows.
- Use `root=/workspace` when calling `ingest_git_history` against dockerized MCP.
- Smoke example for Docker runtime:

```bash
# Windows PowerShell
$env:SMOKE_ROOT='/app'
$env:SMOKE_GIT_ROOT='/workspace'
npm run smoke-test
```

### Smoke block for worker/source tools (optional)

Use this when you want quick verification for `prepare_repo`, queue execution, and workspace scan:

```bash
# Windows PowerShell (example)
$env:SMOKE_QUEUE_TOOLS='true'
$env:SMOKE_GIT_ROOT='/workspace'
$env:SMOKE_PREPARE_GIT_URL='https://github.com/letuhao/free-context-hub'
$env:SMOKE_PREPARE_GIT_REF='main'
npm run smoke-test
```

Notes:
- The smoke block enqueues a job with a generated `correlation_id`.
- It then calls `run_next_job` and verifies `list_jobs` filtered by that `correlation_id`.
- It also checks `register_workspace_root` + `scan_workspace`.

### Phase 4 Neo4j troubleshooting

- **Symptoms:** `[kg] schema bootstrap failed` or graph tools return `warning` about KG disabled.
- **Checks:** `docker compose ps` shows `neo4j` healthy; `.env` has `KG_ENABLED=true` and credentials matching `NEO4J_AUTH` in Compose (`NEO4J_USERNAME` / `NEO4J_PASSWORD`).
- **From host MCP process:** use `bolt://127.0.0.1:7687` (not `neo4j:7687` unless you run MCP inside the Compose network).
- **Smoke:** run `npm run smoke-test` with `KG_ENABLED=true` to exercise `search_symbols` / `get_symbol_neighbors` / `trace_dependency_path` / `get_lesson_impact` (best-effort block).

If you run LM Studio on your host machine (recommended), the MCP container will reach it via `host.docker.internal`.

Storage governance references:
- `docs/storage/storage-contract.md`
- `docs/storage/generated-cleanup.md`

If you see an npm error like `self-signed certificate in certificate chain` while building the MCP image, set `NPM_STRICT_SSL=false` in your environment (Compose already defaults it to false) or bake your corporate CA into the image.

### Corporate CA certificate profile (recommended)

If your network uses a corporate MITM certificate (for example `certs/personal_kas.cer` in this repo), you can run the MCP container with that CA installed into the container trust store:

```bash
# Stop the non-CA MCP container if it's running (port conflict on 3000):
docker compose stop mcp

# Start DB + the CA-enabled MCP server:
docker compose --profile corp-ca up -d --build db mcp-ca
```

This profile builds a special image target that:

- installs the cert into Alpine's system trust store
- sets `npm config cafile` so `npm ci` works with strict SSL enabled
- sets `NODE_EXTRA_CA_CERTS` for runtime HTTPS calls

## Step 3: Start embeddings server (LM Studio)

In LM Studio:

- Ensure the server exposes `POST /v1/embeddings`
- Use the embedding model configured in `.env` (default: `mixedbread-ai/text-embedding-mxbai-embed-large-v1`)
- If your embeddings server requires an API key, set `EMBEDDINGS_API_KEY` in `.env`

## Step 4: (Optional) Run the MCP server without Docker

If you prefer to run only Postgres in Docker and run MCP on your host:

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

For deep async validation (worker chain + clone + git ingest + index quality), run:

```bash
npm run validate:phase5-worker
```

The validator now enforces gates for:
- clone/sync success (`prepare_repo` + resolved commit),
- queue chain (`repo.sync -> git.ingest -> index.run`) scoped by `correlation_id`,
- DB evidence (`chunks`, `files`, `git_commits`),
- retrieval quality (`list_commits`, `get_commit`, `search_code`),
- optional workspace scan mode.

## Step 6: Connect Cursor AI (MCP)

Cursor connects to MCP servers via configuration.

1. In Cursor, open MCP server settings (Tools & MCP).
2. Add a remote MCP server with:
   - URL: `http://localhost:3000/mcp`
   - Transport: Streamable HTTP (if you need to pick)
3. Restart Cursor after adding the server (Cursor caches MCP configs).

### Recommended first call: `help`

Call `help` once so the agent can learn all tool parameters and sample workflows.

```json
{
  "method": "tools/call",
  "params": {
    "name": "help",
    "arguments": {
      "output_format": "json_pretty"
    }
  }
}
```

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

`list_lessons`

- `workspace_token` (optional; required only if `MCP_AUTH_ENABLED=true`)
- `project_id` (optional; uses `DEFAULT_PROJECT_ID` when omitted)
- `filters` (optional)
- `page` (optional; cursor pagination)

`search_lessons`

- `workspace_token` (optional; required only if `MCP_AUTH_ENABLED=true`)
- `project_id` (optional; uses `DEFAULT_PROJECT_ID` when omitted)
- `query`
- `filters` (optional)
- `limit` (optional)

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

