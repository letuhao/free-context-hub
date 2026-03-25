---
id: CH-T1-P2  status: planned  phase: Phase 2  updated: 2026-03-25
---

# Phase 2 Context — ContextHub: Lesson Discovery & DX

## Phase Goal
Make every stored lesson queryable by AI agents. Reduce session-start friction from
4–5 steps to 1 tool call. Fix documented DX issues before they compound.

## Problem This Phase Solves
| Problem | Impact | Fix |
|---|---|---|
| `decision`/`workaround`/`general_note` lessons not queryable | Lessons are write-only for agents | M06: `search_lessons` + `list_lessons` |
| Session start requires 4 sequential tool calls | Agent friction, wasted tokens | M07: `get_context` bootstrap tool |
| `rules_checked=0` bug when rules exist but none match | Misleading guardrails debug | M08-SP1 (one-line fix) |
| Tool descriptions misdirect agents | Agents use wrong tool or skip calls | M08-SP3 description audit |
| `project_id` required on every call | Repetitive, error-prone | M08-SP2 `DEFAULT_PROJECT_ID` env |

## Module Map
| ID | Module | Status | Priority | Brief |
|---|---|---|---|---|
| M06 | Lesson Discovery | planned | P0 | modules/M06_LESSON_DISCOVERY_BRIEF.md |
| M07 | Smart Context Aggregator | planned | P0 | modules/M07_CONTEXT_AGGREGATOR_BRIEF.md |
| M08 | DX Polish | planned | P1 | modules/M08_DX_POLISH_BRIEF.md |

## Tool Inventory After Phase 2
| Tool | Status | Replaces/Note |
|---|---|---|
| `index_project` | unchanged | |
| `get_context` | **NEW M07** | Replaces 4-step session start |
| `search_code` | unchanged | |
| `search_lessons` | **NEW M06** | Fills write-only lesson gap |
| `list_lessons` | **NEW M06** | Browse by type/tag without embedding |
| `add_lesson` | unchanged | |
| `check_guardrails` | bug fix M08 | `rules_checked` counter corrected |
| `delete_workspace` | unchanged | |
| `get_preferences` | **deprecated M06** | → replaced by `list_lessons` + `search_lessons` |

Net: +3 tools, -1 deprecated = 8 tools total (was 6).
Cognitive burden: **decreases** — `get_context` removes 4 mandatory session steps.

## Build Order
```
M08-SP1 (guardrails bug) → immediate, zero risk
M06-SP1 (service layer)  → no schema change needed
M06-SP2 (tool reg)       → after M06-SP1
M06-SP3 (HNSW migration) → parallel with M06-SP1
M06-SP4 (deprecate)      → after M06-SP2 confirmed
M07-SP1 (context svc)    → after M06-SP1 (reuses searchLessons)
M07-SP2 (tool reg)       → after M07-SP1
M08-SP2 (default PID)    → after M06+M07 tools exist
M08-SP3 (descriptions)   → after all tools registered
M08-SP4 (docs sync)      → last
```

## Active Constraints
- No breaking changes to existing tool signatures (backward compatibility required)
- No cross-project lesson search (project_id isolation is a project invariant — DA approval to change)
- No `update_lesson` tool — out of scope, creates UI complexity
- All new tools must reuse `assertWorkspaceToken`, `formatToolResponse`, `OutputFormatSchema`
- `get_context` must degrade gracefully when LM Studio is unavailable (return persistent sections with warning, not throw)

## Open Decisions
| ID | Decision Needed | Status |
|---|---|---|
| DEC-P2-001 | Deprecate `get_preferences` immediately or keep as alias for 1 cycle? | open — DA decision |
| DEC-P2-002 | `get_context` with `task`: embed once + pass vector to services, or let services embed independently? | open — affects latency |
| DEC-P2-003 | `list_lessons` total_count: use `COUNT(*) OVER()` (window fn) or separate COUNT query? | open — performance tradeoff |

## Risk Register (open)
| ID | Risk | Severity | Mitigation |
|---|---|---|---|
| R-P2-01 | HNSW index build locks `lessons` table briefly | low | Use `CREATE INDEX CONCURRENTLY` |
| R-P2-02 | `get_context` payload too large if many lessons | medium | `lesson_limit`/`code_limit` params; defaults: 10/5 |
| R-P2-03 | `get_context` + `task` = 3 embed calls if not optimized | medium | Pass `precomputedVector` to service functions |
| R-P2-04 | Agents over-rely on `get_context`, stop using targeted `search_code` | low | Tool descriptions clarify bootstrap vs targeted search |

## Recent Decisions
- DEC-P2-000: Phase 2 scope locked to lesson discovery + DX; hybrid retrieval deferred to V1 [2026-03-25]

## Definition of Done (Phase 2)
- [ ] `search_lessons("auth token")` returns decision/workaround/general_note lessons
- [ ] `list_lessons(lesson_type="decision")` returns all decisions paginated
- [ ] `get_context(project_id, task="<any task>")` returns full context in one call
- [ ] `get_context` without task completes in < 300ms
- [ ] `check_guardrails` returns correct `rules_checked` count
- [ ] `project_id` optional when `DEFAULT_PROJECT_ID` set in env
- [ ] All tool descriptions updated and verified
- [ ] `get_preferences` marked deprecated in description
- [ ] `AGENT_PROTOCOL.md` updated — session start = 1 call, not 4
- [ ] Smoke test updated to cover new tools
