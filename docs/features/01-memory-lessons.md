# Memory & Lessons

The core of free-context-hub. A **lesson** is a durable unit of team knowledge —
a decision, a preference, a workaround, or a guardrail — that persists across
sessions and across agents, so nobody has to re-explain or re-discover it.

## Key concepts

- **Lesson types** — `decision`, `preference`, `workaround`, `guardrail`, and
  `knowledge` by default. Projects can define their own via custom types and
  taxonomy profiles.
- **Lifecycle** — every lesson moves through `draft → active → superseded →
  archived`. `pending-review` is an additional state for AI-generated lessons
  awaiting human approval (see [Governance](07-governance-decisions.md)).
- **Embeddings** — lesson content is embedded on write and re-embedded on update,
  which powers [semantic search](02-search-retrieval.md).
- **Versions** — every edit snapshots the prior content; history is retrievable.
- **Salience** — retrieval is weighted so frequently-useful lessons rank higher.

## How to use it

### MCP (agents)

| Tool | Purpose |
|------|---------|
| `add_lesson` | Capture a decision/preference/workaround/guardrail |
| `search_lessons` | Semantic search across stored knowledge |
| `list_lessons` | Browse with filters (type, tags, status) + cursor pagination |
| `update_lesson` | Edit content/title/tags/source refs (auto re-embed) |
| `update_lesson_status` | Move through the lifecycle |
| `list_lesson_versions` | Read version history |
| `get_project_summary` | Fast pre-built project briefing (no embedding call) |
| `reflect` | LLM-synthesized answer drawn from multiple lessons |
| `compress_context` | Compress arbitrary text with the configured chat model |
| `activate_taxonomy_profile` / `deactivate_taxonomy_profile` / `get_active_taxonomy_profile` / `list_taxonomy_profiles` | Manage lesson-type taxonomies |

> **Wrap `add_lesson` args** in `lesson_payload: { project_id, lesson_type, title, content, tags }`.

### REST

- `GET /api/lessons` — list/filter
- `POST /api/lessons` — create
- `POST /api/lessons/search` — semantic search
- `PUT /api/lessons/:id` — update
- `PATCH /api/lessons/:id/status` — status change (and `/batch-status`)
- `GET /api/lessons/:id/versions` — history
- `POST /api/lessons/:id/improve`, `/suggest-tags` — AI assistance
- `GET /api/lessons/export`, `POST /api/lessons/import`
- Custom types: `/api/lesson-types`; taxonomies: `/api/taxonomy-profiles`

### GUI

- **Lessons Library** (`/lessons`) — browse, search, filter, tag, bulk approve/archive, import/export.
- **Lesson Detail** (`/lessons/[id]`) — rich editor, comments, version history, related lessons.
- **Custom Lesson Types** (`/settings/lesson-types`) — define project-specific types with colors and templates.

## Example workflow

```
Agent A (Mon):    add_lesson("We use JWT not sessions — legal requires stateless auth")
Agent B (Thu):    search_lessons("authentication approach") → gets the decision
Agent C (Month):  doesn't re-litigate sessions vs JWT
```

## Related

- [Search & Retrieval](02-search-retrieval.md) — how lessons are found
- [Guardrails](03-guardrails.md) — lessons of type `guardrail` become enforceable rules
- [Governance & Decisions](07-governance-decisions.md) — the review queue for AI-generated lessons
