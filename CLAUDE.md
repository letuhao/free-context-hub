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

1. **Read** `docs/sessions/SESSION_PATCH.md` → understand where we left off and what's next
2. **Read** `docs/context/PROJECT_INVARIANTS.md` → load Tier 0 constraints (immutable rules)
3. **Read** `docs/context/MVP_CONTEXT.md` → load Tier 1 phase status and open decisions
4. **Call** `get_preferences` with `project_id: "free-context-hub"` → load persistent team lessons
5. **Read** the relevant module brief from `docs/context/modules/` ONLY if working on that module

Do NOT load `WHITEPAPER.md` unless there is an architectural question not answered by the docs above.

`workspace_token` is optional and only needed when `MCP_AUTH_ENABLED=true` (key: `CONTEXT_HUB_WORKSPACE_TOKEN`).

---

## Tool Usage Rules

### `search_code` — use BEFORE reading files
```
When: you need to find where something is implemented, before using Glob/Grep/Read
How:  search_code(project_id, query="what you're looking for", limit=5)
Why:  semantic search finds by intent, not by filename
```
Examples of when to call:
- "where is auth handled?" → `search_code(query: "workspace token authentication")`
- "where do we write chunks?" → `search_code(query: "chunk embedding storage write")`
- "find the guardrail trigger logic" → `search_code(query: "trigger match guardrail rule")`

### `get_preferences` — call at session start
```
When: session start (mandatory) + any time you're unsure about team preferences
How:  get_preferences(project_id: "free-context-hub")
Why:  returns ALL lessons tagged preference-* — constraints the team has committed to
```

### `add_lesson` — call after any significant decision
```
When: a new architectural decision is made, a workaround is found, a mistake is captured
How:  add_lesson with appropriate lesson_type and tags
Why:  persists knowledge across sessions — future AI agents will read these
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
Why:  keeps search_code results current
```

### `delete_workspace` — only on explicit user instruction
```
When: ONLY when user explicitly asks to reset all ContextHub data for a project
How:  delete_workspace(project_id: "...")
Why:  destructive — deletes all lessons, chunks, guardrails for the project
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
| Any session start | SESSION_PATCH.md + PROJECT_INVARIANTS.md + MVP_CONTEXT.md + get_preferences() |
| Working on specific module | + relevant MODULE_BRIEF.md |
| Architectural question | + WHITEPAPER.md (specific section only) |
| Finding code | search_code() first, then Read if needed |
| Before risky action | check_guardrails() — mandatory |

**Do NOT load all module briefs at once.** Load only the module you are working on.

---

## Project Constants
```
project_id:    free-context-hub
mcp_url:       http://localhost:3000/mcp
workspace_token: optional; required only if `MCP_AUTH_ENABLED=true` → CONTEXT_HUB_WORKSPACE_TOKEN
db:            PostgreSQL + pgvector (vector dim: 1024)
embedding:     mxbai-embed-large-v1 via LM Studio (localhost:1234)
```
