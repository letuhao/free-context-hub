# ContextHub — Agent Protocol
> Load this file as system prompt or starting context for any AI agent working on this project.
> This file is self-contained. No other file is required to understand the protocol.

---

## 1. Connection

```
MCP endpoint:  http://localhost:3000/mcp   (Streamable HTTP / POST)
project_id:    free-context-hub
workspace_token: optional; required only if `MCP_AUTH_ENABLED=true` → key: CONTEXT_HUB_WORKSPACE_TOKEN
```

`project_id` is required for some tools and optional for others when `DEFAULT_PROJECT_ID` is set in the server environment.

`workspace_token` is optional when `MCP_AUTH_ENABLED=false` (default). If auth is enabled, every `tools/call` must include a valid token.

**Boolean env note:** In `.env`, use `MCP_AUTH_ENABLED=false` (not quoted garbage). The server logs `[env]` on startup — confirm `MCP_AUTH_ENABLED` matches what you expect.

First calls (recommended):

1. `help` — tool inventory, parameter docs, sample workflows, templates (once per environment or when the server changes).
2. `get_context(task?)` — minimal refs + `project_snapshot` (when available) + suggested next tool calls.

---

## 2. Session Protocol (mandatory sequence)

### Session Start — run in this order, every session

| Step | Action | Why |
|---|---|---|
| 1 | Call `help` (e.g. `output_format: "json_pretty"`) | Onboarding: parameters + workflows |
| 2 | Call `get_context(task?)` | Refs + optional pre-built `project_snapshot` + suggested next calls |
| 3 | (Optional) Call `get_project_summary` | Read the full snapshot text in one shot (no embedding call) if you need more than the snippet in `get_context` |
| 4 | (Optional) Read `docs/sessions/SESSION_PATCH.md` | Exact “where we left off” |
| 5 | Call `search_lessons(query)` | Prior decisions/preferences/guardrails by intent |
| 6 | Call `search_code(query)` | Code locations by intent |
| 6b | (Optional, Phase 4) Call `search_symbols` / `get_symbol_neighbors` | When `KG_ENABLED=true` and you need symbol-level graph navigation |
| 7 | Read `docs/context/modules/<MODULE>_BRIEF.md` | Only if patching that module |

Do NOT load WHITEPAPER.md unless answering an architectural question unanswered above.

### Session End — required before closing

| Step | Action | Condition |
|---|---|---|
| A | Call `add_lesson(...)` for each significant decision made | If any decision was made |
| B | Call `add_lesson(...)` for any workaround or mistake captured | If any found |
| C | Overwrite `docs/sessions/SESSION_PATCH.md` with current state | Always |

---

## 3. Tool Reference

### `help`
```
When:   First integration with this server, or after server/tool changes.
Params: workspace_token (optional; required only if MCP_AUTH_ENABLED=true)
        output_format: auto_both | json_only | json_pretty | summary_only
Returns: JSON: server info, auth rules, project_id rules, tools[], workflows[], tool_call_templates[], troubleshooting[].
```

### `index_project`
```
When:   After significant code changes, or at start of a fresh environment.
Params: project_id, root (directory path), workspace_token (optional; required only if `MCP_AUTH_ENABLED=true`)
        options: { lines_per_chunk?: number, embedding_batch_size?: number }
Returns: { status: "ok"|"error", files_indexed, duration_ms, errors[] }
Note:   Rebuilds the per-project snapshot text used by get_project_summary (Phase 3).
```

### `search_code`
```
When:   BEFORE using Grep/Glob/Read to find code. Always try this first.
Params: project_id, query (natural language), workspace_token (optional; required only if `MCP_AUTH_ENABLED=true`)
        filters?: { path_glob? }   limit?: number   debug?: boolean
Returns: { matches: [{ path, start_line, end_line, snippet, score, match_type }], explanations[] }
Rule:   If matches.length > 0, use those snippets. Only read full file if more context needed.
```

### `list_lessons`
```
When:   Browse lessons by type/tags/status with cursor pagination.
Params: project_id (optional if DEFAULT_PROJECT_ID is set), workspace_token (optional; required only if `MCP_AUTH_ENABLED=true`)
        filters?: { lesson_type?, tags_any?, status? }   page?: { limit?, after? }
Returns: { items: Lesson[], next_cursor?, total_count }
Note:   Phase 3 items may include summary, quick_action, status, superseded_by.
```

### `search_lessons`
```
When:   Find decisions/preferences/guardrails/workarounds by intent.
Params: project_id (optional if DEFAULT_PROJECT_ID is set), query, workspace_token (optional; required only if `MCP_AUTH_ENABLED=true`)
        filters?: { lesson_type?, tags_any?, include_all_statuses? }  limit?: number
Returns: { matches: [{ lesson_id, lesson_type, title, content_snippet, tags, score, status? }], explanations[] }
Rule:   Default excludes superseded/archived unless filters.include_all_statuses=true.
        Snippet prefers distilled summary when present (Phase 3).
```

### `get_context`
```
When:   Session start bootstrap (recommended) or when you want suggested next tool calls.
Params: project_id (optional if DEFAULT_PROJECT_ID is set), workspace_token (optional; required only if `MCP_AUTH_ENABLED=true`)
        task?: { intent, query?, path_glob? }
Returns: { project_id, context_refs[], project_snapshot?, suggested_next_calls[], notes[] }
Rule:   Does NOT bundle huge content; may include a snapshot string when the project has been indexed or has lessons.
```

### `get_project_summary`
```
When:   You want the full pre-built project briefing (Phase 3).
Params: project_id (optional if DEFAULT_PROJECT_ID is set), workspace_token (optional; required only if `MCP_AUTH_ENABLED=true`)
Returns: { project_id, body, updated_hint? }
Rule:   No embedding call — fast read from project_snapshots. Rebuilt on add_lesson / index_project.
```

### `reflect`
```
When:   You want an LLM synthesis across retrieved lessons for a topic (Phase 3).
Params: project_id (optional if DEFAULT_PROJECT_ID is set), topic, workspace_token (optional; required only if `MCP_AUTH_ENABLED=true`)
Returns: { project_id, topic, answer, warning?, retrieved_lessons }
Rule:   Requires DISTILLATION_ENABLED=true and a valid DISTILLATION_MODEL on the server. If disabled, answer may be empty and warning explains why.
```

### `compress_context`
```
When:   Shrink long pasted text via the configured chat model (Phase 3).
Params: text, max_output_chars?, workspace_token (optional; required only if `MCP_AUTH_ENABLED=true`)
Returns: { compressed, warning? }
Rule:   With DISTILLATION_ENABLED=false, returns truncated original text + warning (no LLM call).
```

### `search_symbols` (Phase 4)
```
When:   You need structured symbol lookup (TS/JS) after indexing; complements vector `search_code`.
Params: project_id (optional if DEFAULT_PROJECT_ID is set), query (substring), limit?, workspace_token (optional)
Returns: { matches: [{ symbol_id, name, kind, file_path, score }], warning? }
Rule:   Requires KG_ENABLED=true + Neo4j reachable + successful `index_project` graph ingest. If disabled, matches=[] and warning explains why.
```

### `get_symbol_neighbors` (Phase 4)
```
When:   Explore local graph around a known symbol_id (from search_symbols or docs).
Params: project_id (optional if DEFAULT_PROJECT_ID is set), symbol_id, depth?, limit?, workspace_token (optional)
Returns: { center, neighbors[], edges[], warning? }
```

### `trace_dependency_path` (Phase 4)
```
When:   Ask whether two symbols are connected via the extracted dependency/call/import graph.
Params: project_id (optional if DEFAULT_PROJECT_ID is set), from_symbol_id, to_symbol_id, max_hops?, workspace_token (optional)
Returns: { found, path_nodes[], path_edges[], hops, warning? }
```

### `get_lesson_impact` (Phase 4)
```
When:   Understand which code symbols/files a lesson may touch via graph links.
Params: project_id (optional if DEFAULT_PROJECT_ID is set), lesson_id, limit?, workspace_token (optional)
Returns: { lesson?, linked_symbols[], affected_files[], rationale, warning? }
Rule:   Populated when lessons were written with `source_refs` pointing at indexed paths (optionally `src/file.ts:MySymbol`).
```

### `ingest_git_history` (Phase 5)
```
When:   Ingest git commits/files into ContextHub for automation memory.
Params: project_id (optional if DEFAULT_PROJECT_ID is set), root, since?, max_commits?, workspace_token (optional)
Returns: { status, run_id?, commits_seen, commits_upserted, files_upserted, warning?, error? }
Rule:   Requires GIT_INGEST_ENABLED=true. When disabled, returns skipped + warning (no side effects).
```

### `list_commits` / `get_commit` (Phase 5)
```
When:   Read ingested commit history and changed file details.
Params: list_commits(project_id?, limit?) | get_commit(project_id?, sha)
Returns: commit metadata and changed files (for get_commit).
```

### `suggest_lessons_from_commits` (Phase 5)
```
When:   Generate draft lesson proposals from commit context.
Params: project_id?, commit_shas?, limit?, workspace_token (optional)
Returns: { proposals[] } where each proposal is draft-only and reviewable.
Rule:   Uses distillation when DISTILLATION_ENABLED=true; otherwise heuristic fallback.
```

### `link_commit_to_lesson` (Phase 5)
```
When:   Attach commit refs/file refs into an existing lesson and refresh symbol links.
Params: project_id?, commit_sha, lesson_id, workspace_token (optional)
Returns: { status, linked_refs, warning?, error? }
```

### `analyze_commit_impact` (Phase 5)
```
When:   Analyze affected files/symbols/related lessons for a commit.
Params: project_id?, commit_sha, limit?, workspace_token (optional)
Returns: { commit_sha, affected_files[], affected_symbols[], related_lessons[], warning? }
Rule:   If KG_ENABLED=false, returns file-only impact + warning.
```

### `prepare_repo` / `enqueue_job` / `list_jobs` / `run_next_job` / `scan_workspace` (Worker pipeline)
```
When:   You need async source sync + git/index automation with queue execution.
Params: enqueue_job(project_id?, job_type, payload?, correlation_id?, queue_name?, max_attempts?)
        list_jobs(project_id?, correlation_id?, status?, limit?)
        run_next_job(queue_name?)
Rule:   Always pass a run-scoped correlation_id when validating/reporting one execution window.
        Child jobs spawned by repo.sync/workspace.scan inherit the same correlation_id.
```

### `update_lesson_status`
```
When:   Mark a lesson draft/active/superseded/archived or link supersession (Phase 3).
Params: project_id (optional if DEFAULT_PROJECT_ID is set), lesson_id, status, superseded_by?, workspace_token (optional)
Returns: { status: "ok"|"error", error? }
```

### `add_lesson`
```
When:   See Self-Report Protocol (section 4).
Params: workspace_token (optional; required only if `MCP_AUTH_ENABLED=true`)
        lesson_payload: {
          project_id, lesson_type, title, content,
          tags?: string[],  source_refs?: string[],  captured_by?: string,
          guardrail?: { trigger, requirement, verification_method }
        }
lesson_type values: decision | preference | guardrail | workaround | general_note
Returns: { status: "ok", lesson_id, summary?, quick_action?, distillation?, conflict_suggestions?, guardrail_inserted? }
Note:   Phase 3 may distill summary/quick_action when DISTILLATION_ENABLED=true; on failure lesson may be stored as draft.
        conflict_suggestions lists semantically similar existing lessons (suggest-only; does not auto-supersede).
```

### `check_guardrails`
```
When:   BEFORE: git push, deploy, schema migration, deleting data, force-push.
Params: workspace_token (optional; required only if `MCP_AUTH_ENABLED=true`)
        action_context: { action: string, project_id?: string, workspace?: string }
Returns: { pass: boolean, rules_checked, needs_confirmation?, prompt?, matched_rules? }
Rule:   If pass=false → show prompt to user, do NOT proceed without explicit approval.
        Never skip this call for the listed action types.
```

### `delete_workspace`
```
When:   ONLY on explicit user instruction.
Params: project_id, workspace_token (optional; required only if `MCP_AUTH_ENABLED=true`)
Returns: { status, deleted, deleted_project_id }
Warning: Deletes ALL data (lessons, chunks, guardrails, project snapshot) for the project. Irreversible.
```

---

## 4. Self-Report Protocol

The agent MUST submit data back to ContextHub to keep team knowledge current.
Use `add_lesson` with the appropriate type. Tags are how knowledge is classified.

### Decision (architectural or technical)
```
lesson_type: "decision"
title:       Short decision statement (e.g., "Use line-based chunking for MVP")
content:     Context: why this was decided, what alternatives were considered
tags:        ["decision-<area>"]   e.g., ["decision-storage", "decision-auth"]
source_refs: file paths or ticket IDs relevant to the decision
```

### Preference (team style or constraint)
```
lesson_type: "preference"
title:       The preference (e.g., "Always use structured JSON responses")
content:     Elaboration and rationale
tags:        ["preference-<topic>"]   e.g., ["preference-api", "preference-typescript"]
```

### Guardrail (rule to enforce before an action)
```
lesson_type: "guardrail"
title:       Rule name
content:     Full description
tags:        ["guardrail-<area>"]
guardrail:   {
  trigger:              "git push" | "deploy" | "/regex pattern/"
  requirement:          Human-readable condition that must be met
  verification_method:  "user_confirmation" | "recorded_test_event" | "cli_exit_code"
}
```

### Workaround (bug or environment fix)
```
lesson_type: "workaround"
title:       What was broken and how it was fixed
content:     Steps taken, root cause if known
tags:        ["workaround-<component>"]   e.g., ["workaround-indexer", "workaround-auth"]
source_refs: file paths changed
```

### General Note
```
lesson_type: "general_note"
title:       Topic
content:     Observation or context worth preserving
tags:        free-form
```

---

## 5. Session Patch Format

At session end, overwrite `docs/sessions/SESSION_PATCH.md` with this structure:

```markdown
---
id: CH-T3
date: YYYY-MM-DD
module: <current-module>
phase: MVP
---

# Session Patch — YYYY-MM-DD

## Where We Are
Phase: MVP · Status: <one-line status>
Last completed: <what was done this session>
Next: <immediate next action>

## Open Blockers
| ID | Blocker | Action |
|---|---|---|
| ... | ... | ... |

## Context to Load Next Session
- Tier 0: docs/context/PROJECT_INVARIANTS.md
- Tier 1: docs/context/MVP_CONTEXT.md
- Tier 2: docs/context/modules/<RELEVANT_MODULE>_BRIEF.md
```

---

## 6. Code Search Decision Tree

```
Need to find code?
    │
    ├─ Do you know the exact file path? → Read file directly
    │
    └─ Do you know intent but not location?
            │
            └─ search_code(query: natural language description)
                    │
                    ├─ matches > 0 → use snippets, Read full file only if needed
                    └─ matches = 0 → fall back to Grep, then check if index is current
```

---

## 7. Quick Reference Card

```
Session start:  help → get_context(task?) → [get_project_summary?] → search_lessons(query) → search_code(query)
Finding code:   search_code() before Grep/Read
Deep recall:    reflect(topic) if distillation enabled; else search_lessons + read lessons
Before push:    check_guardrails({action: "git push", project_id})
Decision made:  add_lesson(type: "decision")
Lifecycle:      update_lesson_status when superseding or archiving a lesson
Session end:    add_lesson() for any decisions → overwrite SESSION_PATCH.md
```
