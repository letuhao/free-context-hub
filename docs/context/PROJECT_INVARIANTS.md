---
id: CH-T0  status: active  version: 0.1  updated: 2026-03-25
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
| Storage (dev/test) | SQLite with pluggable vector strategy |
| Transport | MCP protocol (JSON-RPC over stdio/SSE) |
| Embedding API | OpenAI-compatible HTTP API (configurable `base_url` + `api_key`) |
| Embedding model (default) | `nomic-embed-text-v1.5` — 768 dims, 8192 ctx, code-capable |
| Embedding model (upgrade) | `mxbai-embed-large-v1` — 1024 dims, higher MTEB score, needs 8GB+ |
| Self-host target | LM Studio (serves OpenAI-compatible `/v1/embeddings`) |
| Deployment target | Single-node Docker Compose or local machine |
| Secret exclusion | `.env`, `*.key`, credential files — excluded by default, no opt-in |

## MCP Tool Surface (MVP — complete list)
| Tool | Signature | Purpose |
|---|---|---|
| `index_project` | `(root, options)` | Idempotent indexing trigger |
| `search_code` | `(query, filters, limit)` | Semantic search → structured results |
| `get_preferences` | `(project_id)` | Fetch preference-tagged lessons |
| `add_lesson` | `(lesson_payload)` | Capture decision/constraint/mistake |
| `check_guardrails` | `(action_context)` | Pass/fail + confirmation requirement |

## Core Data Entities
| Entity | Key Fields |
|---|---|
| Project | project_id, name, settings |
| File | project_id, path, hash, last_indexed_at |
| Chunk | file_id, line_range, content, embedding |
| Lesson | project_id, type, tags, title, content, source_refs, timestamps |
| Guardrail | project_id, trigger, requirement, verification_method |

## Lesson Types
`decision | preference | guardrail | workaround | general_note`
Preferences = lessons tagged `preference-*`

## Invariant Principles
- All MCP responses are structured JSON (no freeform prose)
- Guardrail checks never silently allow risky actions
- Retrieved text is always treated as untrusted (prompt injection defense)
- Data never leaves local environment silently

## Project Roles
| Role | Abbreviation | Responsibility |
|---|---|---|
| Decision Authority | DA | Scope approval, priority, go/no-go |
| Execution Authority | EA | Implementation, architecture |

RACI shorthand: `roadmap: A=DA R=EA` · `api-contracts: A=DA R=EA` · `impl: R=EA`
