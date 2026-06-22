# Code Intelligence

Turn a repository's history and structure into queryable knowledge: ingest commits,
analyze their impact, and — with Neo4j enabled — trace symbol-level dependencies.

## Key concepts

- **Git ingestion** — commits and changed files are pulled into Postgres for
  analysis and lesson suggestion. Controlled by `GIT_INGEST_ENABLED` (default `true`).
- **Lesson suggestions** — recurring commit patterns become draft lesson proposals
  you can review and accept.
- **Impact analysis** — a commit's blast radius is computed over the symbol/lesson
  graph.
- **Knowledge graph (optional)** — with `KG_ENABLED=true`, TypeScript/JavaScript
  symbols are extracted (via ts-morph) into Neo4j, enabling neighbor lookups,
  dependency-path tracing, and lesson-to-code impact. This is **supplementary** —
  agents already have Grep/Glob for plain navigation.
- **Indexing** — `index_project` discovers files, chunks them, embeds, and stores
  vectors for [code search](02-search-retrieval.md).

## How to use it

### MCP (agents)

| Tool | Purpose | Needs |
|------|---------|-------|
| `ingest_git_history` | Pull commits + files into Postgres | git source |
| `list_commits` / `get_commit` | Browse ingested commits | — |
| `suggest_lessons_from_commits` | Draft lessons from commit patterns | — |
| `link_commit_to_lesson` | Attach commit refs/files to a lesson | — |
| `analyze_commit_impact` | Impact over the KG | `KG_ENABLED` |
| `search_symbols` | Find TS/JS symbols | `KG_ENABLED` |
| `get_symbol_neighbors` | Callers/callees of a symbol | `KG_ENABLED` |
| `trace_dependency_path` | Shortest path between two symbols | `KG_ENABLED` |
| `get_lesson_impact` | Which code a lesson affects | `KG_ENABLED` |
| `index_project` | Idempotent discover → chunk → embed → store | embeddings |

### REST

- `POST /api/git/ingest`, `GET /api/git/commits`, `GET /api/git/commits/:sha`
- `POST /api/git/suggest-lessons`, `POST /api/git/analyze-impact`
- `POST /api/projects/:id/index`

### GUI

- **Git History** (`/projects/git`) — browse commits, ingest history, suggest lessons.
- **Graph Explorer** (`/knowledge/graph`) — symbol search, dependency tracing,
  neighbor exploration, lesson-impact analysis (requires Neo4j).
- **Project Sources** (`/projects/sources`) — configure the git source and register
  workspace roots for indexing.

## Configuration

```bash
GIT_INGEST_ENABLED=true
KG_ENABLED=false          # set true + run Neo4j for symbol graph features
```

## Related

- [Search & Retrieval](02-search-retrieval.md) · [Projects & Portability](09-projects-portability.md) · [Jobs & Operations](11-jobs-operations.md)
