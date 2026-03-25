---
id: CH-T1-P3
status: done
phase: Phase 3
updated: 2026-03-26
---

# Phase 3 Context — ContextHub: Context Intelligence

## Core Shift (Why Phase 3 Exists)

| Phase | Model | Who manages context? |
|---|---|---|
| Phase 1–2 | Delivery | Consuming agent calls tools, gets raw data, manages its own window |
| **Phase 3** | **Intelligence** | Dedicated builder process distills knowledge; consuming agent gets pre-engineered output |

Phase 2 made lessons *queryable*. Phase 3 makes them *intelligent* — distilled, temporally valid,
conflict-aware, and immediately actionable before the consuming agent ever reads them.

**Trigger**: AI agent review of Phase 2 output identified three structural problems in the lessons system
that retrieval tooling alone cannot fix:

1. Verbose lessons → search snippets surface only preamble, not the action
2. Proposals mixed with confirmed decisions → agent hallucinates authority
3. No TL;DR / Quick How-to → even correct retrieval requires the agent to re-read and interpret

## Deployment modes (LLM “Context Builder”)

The **embedding** endpoint (`EMBEDDINGS_BASE_URL`, `/v1/embeddings`) and the **chat** endpoint used for distillation / `reflect` / `compress_context` are **separate concerns**:

| Mode | Embeddings | Chat (distillation / reflect / compress) | Data boundary |
|---|---|---|---|
| **Air-gapped** | LM Studio (local) | Same host `DISTILLATION_BASE_URL` → `/v1/chat/completions` | Code + lessons stay local |
| **Hybrid** | LM Studio (local) | Cloud OpenAI-compatible API (`DISTILLATION_BASE_URL` + key) | **Recommended:** only lesson text / snapshot text is sent to chat; **no** code chunks unless explicitly enabled in a future feature |
| **Cloud-everything** | Cloud embeddings API | Cloud chat | Possible, but not the product’s default self-host story |

**Defaults (implementation):**

- `DISTILLATION_ENABLED` defaults to **`false`** so existing deployments and CI behave like Phase 2 until operators opt in.
- When `DISTILLATION_ENABLED=true`, set `DISTILLATION_MODEL` to a model available at `DISTILLATION_BASE_URL` (often the same machine as LM Studio; can differ from `EMBEDDINGS_MODEL`).

## Out of scope for Phase 3

- **Automatic lesson capture from chat** (e.g. parsing agent corrections without an explicit `add_lesson` call) — backlog / possible Phase 4+
- **Session-level deduplication** of repeated user context (à la ContextStream marketing) — optional M12 / future; not required for Phase 3 DoD
- **Cross-project** snapshots or distillation — remains blocked unless invariants change (**DEC-P3-004** stays “future / DA”)

## Problem This Phase Solves

| Problem | Impact | Fix |
|---|---|---|
| Lessons are verbose (300+ lines) | search_lessons snippets miss actionable content | M09-SP1: auto-generate `summary` + `quick_action` fields |
| Proposals indistinguishable from confirmed decisions | Agent misreads authority level | M10-SP1: `status` field (draft/active/superseded/archived) |
| New lesson may contradict existing lesson (stale) | Agent follows outdated guidance | M09-SP3: conflict detection + supersession **suggestion** (no auto-supersede by default) |
| Lessons are append-only — no invalidation | Knowledge graph grows but never prunes | M10-SP2: supersession links + `update_lesson_status` tool |
| Session-start context has no project-level summary | Agent must browse individual lessons to orient | M11-SP1: `project_snapshots` — incremental, pre-built |
| Consuming agent spends tokens deciding what context matters | Token waste + drift | M11-SP3: `reflect` — on-demand LLM synthesis |

## Architecture: Context Builder vs Context Consumer

```
[Consuming Agent] ─── calls ──► MCP Tools (search, get_context, reflect, get_project_summary)
                                        │
                                  already distilled
                                        │
                              ┌─────────▼──────────┐
                              │   Context Builder   │  ← Phase 3
                              │  (chat LLM)         │
                              │  OpenAI-compatible  │
                              └─────────┬──────────┘
                                        │
                         ┌──────────────┼──────────────┐
                    add_lesson         index_project
                    trigger              trigger
                         │                  │
                    inline distill    snapshot rebuild
                    (sync + timeout)   (sync)
```

Builder calls **`POST /v1/chat/completions`** on `DISTILLATION_BASE_URL` (defaults to `EMBEDDINGS_BASE_URL` if unset).

## Module Map

| ID | Module | Status | Priority | Brief |
|---|---|---|---|---|
| M09 | Lesson Intelligence | done | P0 | [modules/M09_LESSON_INTELLIGENCE_BRIEF.md](modules/M09_LESSON_INTELLIGENCE_BRIEF.md) |
| M10 | Lesson Lifecycle | done | P0 | [modules/M10_LESSON_LIFECYCLE_BRIEF.md](modules/M10_LESSON_LIFECYCLE_BRIEF.md) |
| M11 | Project Intelligence | done | P1 | [modules/M11_PROJECT_INTELLIGENCE_BRIEF.md](modules/M11_PROJECT_INTELLIGENCE_BRIEF.md) |
| M12 | Context Compression | done | P2 | [modules/M12_CONTEXT_COMPRESSION_BRIEF.md](modules/M12_CONTEXT_COMPRESSION_BRIEF.md) |

## Tool Inventory After Phase 3

| Tool | Status | Note |
|---|---|---|
| `add_lesson` | enhanced | Optional `summary` + `quick_action`; `conflict_suggestions` when similar lessons exist |
| `search_lessons` | enhanced | Default excludes `superseded` + `archived`; snippet prefers `summary` |
| `list_lessons` | enhanced | Optional `filters.status` |
| `get_context` | enhanced | Includes `project_snapshot` text when available |
| `update_lesson_status` | **NEW M10** | Set status + optional `superseded_by` |
| `reflect` | **NEW M11** | LLM synthesis for a topic |
| `get_project_summary` | **NEW M11** | Pre-built snapshot (no embedding call) |
| `compress_context` | **NEW M12** | Optional LLM compression of arbitrary text |
| All other Phase 1–2 tools | unchanged | Backward compatible JSON |

Net: +4 tools (`update_lesson_status`, `get_project_summary`, `reflect`, `compress_context`).

## New Infrastructure

| Component | Purpose |
|---|---|
| `DISTILLATION_ENABLED` | Default `false`; `false` ⇒ Phase 2-compatible behavior for lessons |
| `DISTILLATION_BASE_URL` | Chat API base (OpenAI-compatible); defaults to `EMBEDDINGS_BASE_URL` |
| `DISTILLATION_API_KEY` | Optional bearer for chat; defaults to `EMBEDDINGS_API_KEY` |
| `DISTILLATION_MODEL` | Chat model id for distillation / reflect / compress |
| `DISTILLATION_TIMEOUT_MS` | Inline distillation timeout |
| `REFLECT_TIMEOUT_MS` | `reflect` timeout (default 5s) |
| `src/services/distiller.ts` | Chat client + prompts |
| `src/services/snapshot.ts` | Project snapshot rebuild + read |
| Migration `0003_lesson_intelligence.sql` | `summary`, `quick_action`, `status`, `superseded_by` |
| Migration `0004_project_snapshots.sql` | `project_snapshots` table |

## Build Order

```
M10-SP1 (schema: status, superseded_by) → migration
M09-SP1 (distiller.ts: chat client)
M09-SP2 (add_lesson enhancement) → inline distillation + conflict suggestions
M10-SP2 (update_lesson_status tool)
M09-SP3 (conflict detection) — shipped with M09-SP2
M11-SP1 (project_snapshots table) → migration
M11-SP2 (snapshot builder) → rebuild after add_lesson + index_project
M11-SP3 (get_project_summary tool)
M11-SP4 (reflect tool)
M12-SP1 (compress_context tool)
```

## Decisions (resolved defaults for EA)

| ID | Decision | Resolution |
|---|---|---|
| DEC-P3-001 | Which chat model? | Operator-chosen `DISTILLATION_MODEL` on LM Studio or cloud; not hardcoded |
| DEC-P3-002 | Inline vs async distillation | **Default: inline** with timeout + fallback (`status=draft`, skip fields). Async queue is future optimization |
| DEC-P3-003 | Conflict / supersession | **Default: suggest only** — return `conflict_suggestions`; never auto-supersede without explicit tool call |
| DEC-P3-004 | Cross-project mental model | **Out of scope** until invariants change |

## Risk Register

| ID | Risk | Severity | Mitigation |
|---|---|---|---|
| R-P3-01 | Chat model unavailable → add_lesson slow / fails | high | Timeout + fallback: skip distillation, `status=draft` |
| R-P3-02 | Distillation hallucination in summary/quick_action | medium | Short prompts; user can edit via future tooling; content remains source of truth |
| R-P3-03 | Schema migration breaks existing lessons | low | Nullable fields; existing rows `status=active` |
| R-P3-04 | Snapshot staleness | low | Rebuild on `add_lesson` and `index_project` |
| R-P3-05 | `reflect` slow | medium | `REFLECT_TIMEOUT_MS`; partial answer + warning |

## Active Constraints

- `DISTILLATION_ENABLED=false` must match Phase 2 lesson behavior (no required chat; tools work)
- No distillation of **code chunks** — only lessons / snapshot / reflect inputs are text from operators
- No cross-project distillation or snapshots
- Summary / quick_action size caps enforced in prompts (`distiller.ts`)
- All DB changes via numbered migrations (`0003_*`, `0004_*`)

## Relationship to Competitors

| Competitor | What they do | What this adds beyond them |
|---|---|---|
| ContextStream | Code + memory + guardrails, cloud-backed index | **Air-gapped** option, Postgres + your infra, combined lessons + guardrails + code search |
| Mem0 | Fact extraction + CRUD | +guardrails engine, +code search, +lesson lifecycle |
| Zep | Temporal graph | Simpler lifecycle + supersession in one server |
| Hindsight | reflect via MCP | Same pattern + self-hosted store |

## Definition of Done (Phase 3)

- [x] `add_lesson` may return `summary` + `quick_action` when distillation enabled and succeeds
- [x] `search_lessons` default excludes `superseded` and `archived`
- [x] `update_lesson_status(lesson_id, status, superseded_by?)` works
- [x] `get_project_summary` returns stored snapshot without embedding calls
- [x] `reflect(project_id, topic)` completes within timeout or returns warning
- [x] `DISTILLATION_ENABLED=false` passes Phase 1–2 smoke test expectations
- [x] New schema columns nullable / defaulted — existing rows unaffected post-migration
