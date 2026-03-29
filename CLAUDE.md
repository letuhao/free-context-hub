# CLAUDE.md

## Project
free-context-hub — self-hosted persistent memory + guardrails for AI agents.
MCP: `http://localhost:3000/mcp` | project_id: `free-context-hub`

## Session Start (do these 2 things)
1. `search_lessons(query: "<your task intent>")` — load relevant prior decisions/workarounds
2. `check_guardrails(action_context: {action: "<what you plan to do>"})` — if doing anything risky

That's it. Don't call `help()` every session — only on first use or after tool changes.

## When to Use MCP (saves tokens) vs Built-in Tools (faster)

| Task | Use MCP | Use Grep/Glob/Read |
|------|---------|-------------------|
| "What did the team decide about X?" | `search_lessons` | - |
| "Any workarounds for X bug?" | `search_lessons` | - |
| "Is X allowed before deploy?" | `check_guardrails` | - |
| "Where is function X defined?" | - | `Grep "functionX"` |
| "Find all .ts files in src/" | - | `Glob "src/**/*.ts"` |
| "Find the test file for X" | `search_code_tiered(kind: "test")` | - |
| "Any docs about X topic?" | `search_code_tiered(kind: "doc")` | - |
| "What does the project do?" | `get_project_summary` (first time only) | - |

**Rule: use MCP for knowledge (lessons, guardrails, docs). Use built-in tools for code navigation.**

## After Making Decisions
Call `add_lesson` with:
- `lesson_type: "decision"` — architectural choice
- `lesson_type: "workaround"` — bug fix or workaround
- `lesson_type: "preference"` — team convention
- `lesson_type: "guardrail"` — rule to enforce before actions

**Note:** wrap args in `lesson_payload: { project_id, lesson_type, title, content, tags }`.

## Before Risky Actions
Always `check_guardrails` before: git push, deploy, schema migration, delete data.
If `pass: false` → show prompt to user and wait for approval.

## Session End
Update `docs/sessions/SESSION_PATCH.md` with what was done and what's next.

## Tool Reference
Call `help(output_format: "json_pretty")` for full tool docs, parameters, and examples.
Don't memorize tool schemas — `help()` is always current.
