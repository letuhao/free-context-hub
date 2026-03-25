---
id: CH-T1-MVP  status: planning  phase: MVP  updated: 2026-03-25
---

# MVP Context — ContextHub

## Phase Goal
Ship a working single-node ContextHub with all 5 core modules integrated
and tested end-to-end with at least one MCP client (Claude Code or Cursor).

## Module Map
| ID | Module | Status | Priority | Brief |
|---|---|---|---|---|
| M01 | MCP Interface Layer | not-started | P0 | modules/M01_MCP_INTERFACE_BRIEF.md |
| M02 | Ingestion / Indexing Service | not-started | P0 | modules/M02_INDEXING_BRIEF.md |
| M03 | Retrieval Service | not-started | P0 | modules/M03_RETRIEVAL_BRIEF.md |
| M04 | Persistent Memory (Lessons) | not-started | P0 | modules/M04_LESSONS_BRIEF.md |
| M05 | Guardrails Engine | not-started | P1 | modules/M05_GUARDRAILS_BRIEF.md |

## Recommended Build Order
```
M04 → M02 → M01 → M03 → M05
```
Rationale: Lessons schema is foundation. Indexing depends on storage.
MCP layer wraps all. Retrieval is query-only. Guardrails are last enforcer.

## Active Constraints
- Language: **TypeScript** + `@modelcontextprotocol/sdk`
- Embedding provider: **OpenAI-compatible API** (configurable base URL) — default target: LM Studio local
- Recommended embedding model: `nomic-embed-text-v1.5` (see PROJECT_INVARIANTS for rationale)
- PostgreSQL + pgvector is default — SQLite for dev/test only
- All MCP responses must be structured JSON
- Secret exclusion active by default on every `index_project` call
- No module marked done without passing smoke test

## Open Decisions
| ID | Decision Needed | Status |
|---|---|---|
| DEC-003 | Chunking strategy: file-boundary vs AST-aware semantic chunks | open |
| DEC-004 | Auth mechanism for MCP workspace tokens | open |

## Risk Register (open only)
| ID | Risk | Severity | Mitigation |
|---|---|---|---|
| R-01 | Embedding model locks in cost/perf tradeoff early | high | Default configurable; lean toward local-first |
| R-02 | pgvector schema migration complexity | medium | Schema-first, migration scripts from day 0 |
| R-03 | Prompt injection via indexed content | medium | Sanitize retrieved text; mark as untrusted in responses |
| R-04 | Scope creep from whitepaper non-goals | low | DA gate required for any scope addition |

## Recent Decisions (last 5)
- DEC-002: Embedding = OpenAI-compatible API (configurable base_url); target LM Studio self-hosted [2026-03-25]
- DEC-001: Implementation language = TypeScript + `@modelcontextprotocol/sdk` [2026-03-25]
- DEC-000: MVP-first approach; defer graph/analytics/SSO to V1/V2 [2026-03-25]
- DEC-LCA: Adopt Lean Context Architecture for all project documentation [2026-03-25]

## Definition of Done (MVP)
- [ ] All 5 MCP tools functional and tested
- [ ] Index → Search round-trip returns relevant snippets
- [ ] Lessons persist across MCP client restarts
- [ ] At least 1 guardrail enforced end-to-end
- [ ] Docker Compose deployment works on fresh machine
- [ ] Secret exclusion verified (`.env` files not indexed)

## Observability Targets (MVP)
- Indexing: last_run, files_processed, error_count
- Search: latency p50/p95
- Guardrails: enforcement_count, confirmation_rate
