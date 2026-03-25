---
id: CH-T0
status: active
version: 0.2
updated: 2026-03-26
---

# ContextHub — Project Invariants

## Mission

Self-hosted, team-friendly system giving MCP-enabled AI tools persistent memory
and semantic code understanding. For small teams. No hosted SaaS dependency.

## Core Value Props

1. Persistent lessons/preferences across sessions (project-scoped)
2. Vector-first semantic code search — find by intent, not filename
3. Lightweight guardrails derived from captured lessons
4. Self-hostable, minimal external dependencies

## Non-Goals (Permanent — DA approval required to change)

- NO automated code modification without explicit user approval
- NO enterprise identity (SAML/SSO) in MVP
- NO full dependency graph analysis in MVP
- NO complex knowledge-graph UI in MVP

## Tech Constraints

| Concern | Decision |
|---|---|
| Language | TypeScript + `@modelcontextprotocol/sdk` |
| Storage (default) | PostgreSQL + pgvector |
| Storage (dev/test) | SQLite with pluggable vector strategy (if used) |
| Transport | MCP protocol (JSON-RPC over HTTP/SSE) |
| Embedding API | OpenAI-compatible HTTP API (`EMBEDDINGS_BASE_URL` + optional `EMBEDDINGS_API_KEY`) |
| Chat API (Phase 3) | OpenAI-compatible `POST /v1/chat/completions` (`DISTILLATION_BASE_URL`, optional key; defaults to embedding base URL) |
| Embedding model (default) | `mixedbread-ai/text-embedding-mxbai-embed-large-v1` — 1024 dims, matches DB schema |
| Embedding dims | **1024** — hardcoded in DB schema (`vector(1024)`), must match model |
| Self-host target | LM Studio for embeddings; Phase 3 distillation may use same host or a cloud chat endpoint |
| Deployment target | Single-node Docker Compose or local machine |
| Secret exclusion | `.env`, `*.key`, credential files — excluded from indexing by default |

## MCP Tool Surface (Phase 2 — current baseline)

| Tool | Purpose |
|---|---|
| `help` | Self-documenting usage, workflows, templates |
| `index_project` | Idempotent indexing of a filesystem root into chunks + embeddings |
| `search_code` | Semantic search over code chunks |
| `list_lessons` | Cursor-paginated lesson list + filters |
| `search_lessons` | Semantic search over lesson embeddings |
| `add_lesson` | Persist structured lessons; optional embedded guardrail rule |
| `check_guardrails` | Evaluate guardrails for a proposed action |
| `get_context` | Minimal refs + suggested next tool calls for a task |
| `delete_workspace` | Delete all data for a `project_id` |

> **Historical note:** Earlier MVP docs referenced `get_preferences`; Phase 2 replaced that with `list_lessons` + `search_lessons`. Do not add `get_preferences` back.

## MCP Tool Surface (Phase 3 — additive)

| Tool | Purpose |
|---|---|
| `update_lesson_status` | Set `draft/active/superseded/archived` + optional supersession link |
| `get_project_summary` | Read pre-built project snapshot text (no embedding call) |
| `reflect` | On-demand LLM synthesis over retrieved lessons for a topic |
| `compress_context` | Optional LLM compression of pasted text |

Phase 3 also **enhances** `add_lesson`, `search_lessons`, `list_lessons`, and `get_context` (see [PHASE3_CONTEXT.md](PHASE3_CONTEXT.md)).

## Core Data Entities

| Entity | Key Fields |
|---|---|
| Project | `project_id`, name, settings |
| File | `project_id`, path, hash, last_indexed_at |
| Chunk | `file_id`, line range, content, embedding |
| Lesson | `project_id`, type, title, content, tags, embedding, **Phase 3:** `summary`, `quick_action`, `status`, `superseded_by` |
| Project snapshot | **Phase 3:** `project_id`, `body`, `updated_at` |
| Guardrail | `project_id`, trigger, requirement, verification_method |

## Lesson Types

`decision | preference | guardrail | workaround | general_note`

## Invariant Principles

- MCP tool results are structured JSON (see `output_format` for presentation variants)
- Guardrail checks never silently allow risky actions
- Retrieved text is always treated as untrusted (prompt injection defense)
- Data never leaves the operator’s environment **silently** — cloud chat endpoints are **explicit** configuration (Phase 3)

## Project Roles

| Role | Abbreviation | Responsibility |
|---|---|---|
| Decision Authority | DA | Scope approval, priority, go/no-go |
| Execution Authority | EA | Implementation, architecture |

RACI shorthand: `roadmap: A=DA R=EA` · `api-contracts: A=DA R=EA` · `impl: R=EA`
