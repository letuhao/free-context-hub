# Jobs & Operations

Heavy or asynchronous work — indexing, git ingestion, document extraction,
re-embedding, QC — runs through a background **job queue** processed by a worker.
Operational endpoints expose health and configuration.

## Key concepts

- **Jobs** — async units like `repo.sync`, `index.run`, `git.ingest`, document
  extraction, and re-embedding. Each has a status and an optional `correlation_id`.
- **Worker** — a separate process (`npm run worker`) drains the queue. With
  `QUEUE_ENABLED=true` it uses RabbitMQ; otherwise jobs can be run inline/manually.
- **Manual execution** — `run_next_job` executes the next queued job immediately,
  useful in dev or when no worker is running.
- **System health/info** — liveness and a feature/model report for monitoring and
  debugging.
- **Model providers** — chat/embedding/rerank models derive from a single canonical
  `CHAT_MODEL` plus the embeddings/rerank settings (see
  [`CLAUDE.md`](../../CLAUDE.md) → model orchestration).

## How to use it

### MCP (agents)

| Tool | Purpose |
|------|---------|
| `enqueue_job` | Enqueue an async worker job |
| `list_jobs` | List jobs (filter by `correlation_id` + status) |
| `run_next_job` | Execute the next queued job now |

### REST

- `/api/jobs` — list, enqueue, status, execute
- `GET /api/system/health` — public liveness probe
- `GET /api/system/info` — server info, feature flags, model names

### GUI

- **Job Queue** (`/jobs`) — monitor running/queued/succeeded/failed jobs by tab;
  manual enqueue.
- **System Settings** (`/settings`) — server info, ports, feature flags.
- **Model Providers** (`/settings/models`) — configure providers and assign them to
  features (embeddings, distillation, reranking).

## Configuration

```bash
QUEUE_ENABLED=false       # true → RabbitMQ-backed worker queue
REDIS_ENABLED=false       # tiered-search cache
CHAT_MODEL=...            # single source of truth for chat callers
```

## Related

- [Code Intelligence](04-code-intelligence.md) (indexing/ingestion jobs) ·
  [Documents & Ingestion](05-documents-ingestion.md) (extraction jobs)
