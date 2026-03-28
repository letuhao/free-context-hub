# CLAUDE.md — ContextHub Development Guide

## What This Project Is
Self-hosted MCP server providing persistent memory + semantic code search + guardrails for AI agents.
MCP server: `http://localhost:3000/mcp` (must be running before session starts).
Source of truth for architecture: `WHITEPAPER.md`. Source of truth for current status: `docs/sessions/SESSION_PATCH.md`.

> Full agent protocol (portable, tool-agnostic): `AGENT_PROTOCOL.md`
> This file adds Claude Code-specific behavior on top of that protocol.

---

## Session Start Protocol (required every session)

Run these steps in order at the start of EVERY session:

1. **Call** `help` → learn tool parameters + sample workflows (once per environment or when the server changes)
2. **Call** `get_context` (with `task.intent` + optional `task.query` / `task.path_glob`) → bootstrap minimal refs + optional `project_snapshot` + suggested next calls
3. **Optional:** `get_project_summary` → full pre-built project briefing text (no embedding call) if you need more than the snapshot snippet from `get_context`
4. **Call** `search_lessons` → load relevant prior decisions/preferences/guardrails for the task
5. **Call** `search_code_tiered` → find relevant code locations with kind-filtered precision (preferred over `search_code`)
6. **Read** the relevant module brief from `docs/context/modules/` ONLY if patching that module

Do NOT load `WHITEPAPER.md` unless there is an architectural question not answered by the docs above.

`workspace_token` is optional and only needed when `MCP_AUTH_ENABLED=true` (key: `CONTEXT_HUB_WORKSPACE_TOKEN`). If you see `Unauthorized: invalid workspace_token`, check the server `[env]` log for `MCP_AUTH_ENABLED` and your `.env` (`MCP_AUTH_ENABLED=false` must parse as boolean false — see `src/env.ts`).

---

## Tool Usage Rules

### `search_code_tiered` — primary code search (preferred)
```
When: you need to find where something is implemented, before using Glob/Grep/Read
How:  search_code_tiered(project_id, query="what you're looking for", kind="source")
Why:  uses ripgrep + symbol lookup + FTS first (near 100% accurate), semantic as fallback only
      returns ALL candidate files with tier labels — you choose what to read
```

**Data kinds** — filter to search only what you need:
| Kind | What's in it | When to use |
|------|-------------|-------------|
| `source` | Implementation code (functions, classes, handlers) | "Where is X implemented?" |
| `type_def` | Type/interface definitions, models, DTOs, .d.ts | "What type does X accept?" |
| `test` | Test files (unit, integration, e2e, mocks) | "Is there a test for X?" |
| `migration` | Database migrations, SQL schemas, seed data | "What columns does X table have?" |
| `config` | App configuration (.env, yaml, json settings) | "What env vars are available?" |
| `dependency` | Package manifests (package.json, go.mod, etc.) | "What version of X?" |
| `api_spec` | API definitions (OpenAPI, GraphQL, protobuf) | "What's the API contract?" |
| `doc` | Documentation (markdown, README, changelogs) | "Any docs about X?" |
| `script` | Utility/build scripts (not core logic) | "How do I run the seed?" |
| `infra` | CI/CD, Docker, Terraform, deployment | "How is CI configured?" |
| `style` | CSS/SCSS/LESS styling | "What CSS classes exist?" |
| `generated` | Lock files, codegen output | Usually excluded |

Examples:
- "where is auth handled?" → `search_code_tiered(query: "assertWorkspaceToken", kind: "source")`
- "what DB migrations exist?" → `search_code_tiered(query: "chunks table columns", kind: "migration")`
- "find env config for S3" → `search_code_tiered(query: "S3_BUCKET S3_ENDPOINT", kind: "config")`
- "any docs about deployment?" → `search_code_tiered(query: "deploy docker", kind: "doc")`
- "broad search, I'm not sure" → `search_code_tiered(query: "guardrail trigger logic")` (no kind = all)

### `search_code` — legacy semantic search
```
When: fallback if search_code_tiered is unavailable, or for pure natural-language queries
How:  search_code(project_id, query="what you're looking for", limit=5)
Why:  semantic-only search, returns top-K results (less precise than tiered)
```

### Phase 4 graph tools (`search_symbols`, `get_symbol_neighbors`, `trace_dependency_path`, `get_lesson_impact`)
```
When: KG_ENABLED=true on the server, after index_project, and you need symbol-level structure (imports/calls) or lesson-to-code impact.
How:  search_symbols(query) → pick symbol_id → get_symbol_neighbors(symbol_id) / trace_dependency_path(from,to)
      get_lesson_impact(lesson_id) after lessons with source_refs.
Why: complements vector search_code; returns empty + warning when KG is disabled (never blocks Phase 1–3 tools).
```

### `help` — call first (agent onboarding)
```
When: first time an agent connects to this MCP server (or after tool changes)
How:  help(output_format: "json_pretty")
Why:  provides parameter docs + sample workflows + tool-call templates
```

### `get_context` — bootstrap session start
```
When: session start (recommended)
How:  get_context(task: {intent: "...", query?: "...", path_glob?: "src/**/*.ts"})
Why:  returns refs + optional project_snapshot + suggested next tool calls (no noisy bundle)
```

### `get_project_summary` — full project snapshot (Phase 3)
```
When: you want the entire pre-built briefing in one read
How:  get_project_summary(project_id)
Why:  fast DB read; complements get_context
```

### `reflect` — synthesized answer over lessons (Phase 3)
```
When: you need a concise answer synthesized from many lessons for a topic
How:  reflect(project_id, topic: "...")
Why:  requires server DISTILLATION_ENABLED=true + chat model; if disabled, use search_lessons + read items instead
```

### `search_lessons` / `list_lessons` — use instead of get_preferences
```
When: find previous decisions/preferences/guardrails/workarounds by intent OR browse with filters
How:  search_lessons(query: "...") or list_lessons(filters: { lesson_type, tags_any, status }, page)
Why:  semantic search across lesson types; Phase 3 adds status filtering and default exclusion of superseded/archived in search
```

### `update_lesson_status` — lifecycle (Phase 3)
```
When: a lesson is superseded, archived, or promoted from draft
How:  update_lesson_status(lesson_id, status, superseded_by?)
Why:  keeps authority and staleness explicit for downstream agents
```

### `compress_context` — optional text shrink (Phase 3)
```
When: pasting very long notes and you want a shorter version via the server LLM
How:  compress_context(text, max_output_chars?)
Why:  respects DISTILLATION_ENABLED; otherwise truncates with a warning
```

### `add_lesson` — call after any significant decision
```
When: a new architectural decision is made, a workaround is found, a mistake is captured
How:  add_lesson with appropriate lesson_type and tags
Why:  persists knowledge across sessions — future AI agents will read these
Note: Phase 3 may return summary/quick_action and conflict_suggestions when distillation is enabled
```
Example triggers:
- Team decides on a pattern → `lesson_type: "decision"`
- A bug workaround is applied → `lesson_type: "workaround"`
- A new team preference is stated → `lesson_type: "preference"`, tag: `"preference-*"`
- A rule is established → `lesson_type: "guardrail"` + `guardrail` field

### `check_guardrails` — call before risky actions
```
When: BEFORE any of these actions: git push, deploy, schema migration, deleting data
How:  check_guardrails(action_context: {action: "git push", project_id: "free-context-hub"})
Why:  enforces captured team rules — do NOT skip even if you think it's safe
```
If result has `pass: false` → show the `prompt` to the user and wait for explicit approval.

### `index_project` — call when source changes significantly
```
When: after significant code additions or after a fresh clone
How:  index_project(project_id: "free-context-hub", root: "<cwd>")
Why:  keeps search results current; classifies chunks by kind; refreshes project snapshot
```

### `delete_workspace` — only on explicit user instruction
```
When: ONLY when user explicitly asks to reset all ContextHub data for a project
How:  delete_workspace(project_id: "...")
Why:  destructive — deletes lessons, chunks, guardrails, snapshot for the project
```

---

## Session End Protocol

At the end of each session, update `docs/sessions/SESSION_PATCH.md` with:
- What was completed
- What is next
- Any new open blockers

If any architectural decisions were made during the session, call `add_lesson` BEFORE updating the patch.

---

## Lean Context Loading Rules

| Situation | Load |
|---|---|
| Any session start | help() + get_context() + search_lessons() + search_code_tiered() |
| Working on specific module | + relevant MODULE_BRIEF.md |
| Architectural question | + WHITEPAPER.md (specific section only) |
| Finding code | search_code_tiered(kind: "source") first, then Read if needed |
| Finding config/env | search_code_tiered(kind: "config") |
| Finding DB schema | search_code_tiered(kind: "migration") |
| Finding docs | search_code_tiered(kind: "doc") |
| Before risky action | check_guardrails() — mandatory |

**Do NOT load all module briefs at once.** Load only the module you are working on.

---

## Project Constants
```
project_id:       free-context-hub
mcp_url:          http://localhost:3000/mcp
workspace_token:  optional; required only if MCP_AUTH_ENABLED=true → CONTEXT_HUB_WORKSPACE_TOKEN
db:               PostgreSQL + pgvector (vector dim: 1024)
embedding:        mixedbread-ai/text-embedding-mxbai-embed-large-v1 (see README / .env.example)
phase_3_chat:     optional OpenAI-compatible /v1/chat/completions for distill + reflect + compress
                  (DISTILLATION_ENABLED, DISTILLATION_MODEL, DISTILLATION_BASE_URL defaults to EMBEDDINGS_BASE_URL)
phase_4_graph:    optional Neo4j 5.x (KG_ENABLED, NEO4J_URI, NEO4J_USERNAME, NEO4J_PASSWORD)
                  TS/JS symbol graph + lesson links; tools noop with warning when disabled
chunk_kinds:      12 data categories (source, type_def, test, migration, config, dependency,
                  api_spec, doc, script, infra, style, generated)
```
