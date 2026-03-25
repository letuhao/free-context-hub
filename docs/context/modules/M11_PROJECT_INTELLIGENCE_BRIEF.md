---
id: CH-M11
module: M11 Project Intelligence
status: done
updated: 2026-03-26
---

# M11 — Project Intelligence

## Purpose

Provide a **cheap, pre-built** project briefing (no embedding call on read) plus **on-demand synthesis** for nuanced questions.

## Table: `project_snapshots` (migration `0004_project_snapshots.sql`)

| Column | Type | Notes |
|---|---|---|
| `project_id` | `TEXT` PK | FK → `projects.project_id` |
| `body` | `TEXT` | Human-readable aggregate of active lessons |
| `updated_at` | `TIMESTAMPTZ` | Last rebuild time |

## Rebuild triggers

- After successful `add_lesson` (same project)
- After `index_project` completes (project-level orientation; cheap text roll-up)

**Implementation note:** synchronous rebuild keeps semantics simple; async queue is a future optimization.

## Tool: `get_project_summary`

- Reads `project_snapshots.body` for `project_id`.
- Target: **O(1) DB read**, no vector search.

## Tool: `reflect`

- Inputs: `project_id`, `topic` (string)
- Behavior: retrieve top relevant lessons (semantic `search_lessons` or similar), then call chat model to synthesize an answer.
- Timeout: `REFLECT_TIMEOUT_MS` (default 5s). On timeout: best-effort partial output + warning string.

## `get_context` enhancement

Include `project_snapshot` (string or null) so session bootstrap can avoid multiple lesson calls.

## Failure modes

| Symptom | Cause | Mitigation |
|---|---|---|
| Empty snapshot | No lessons yet | Expected; still valid |
| Stale snapshot | Rebuild failed silently | Check server logs; re-run `index_project` or add lesson |
