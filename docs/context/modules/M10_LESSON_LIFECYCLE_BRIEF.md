---
id: CH-M10
module: M10 Lesson Lifecycle
status: done
updated: 2026-03-26
---

# M10 — Lesson Lifecycle

## Purpose

Make **authority** and **staleness** explicit so agents do not treat drafts or superseded notes as ground truth.

## Status model

| Status | Meaning |
|---|---|
| `draft` | Captured but distillation failed or incomplete; still searchable unless filtered |
| `active` | Current guidance |
| `superseded` | Replaced by another lesson |
| `archived` | Inactive / historical |

## Tool: `update_lesson_status`

**Inputs:**

- `project_id` (or default via `DEFAULT_PROJECT_ID`)
- `lesson_id`
- `status` — one of the four values
- `superseded_by` — optional UUID of replacement lesson (typically when `status=superseded`)

**Rules:**

- Validates the lesson belongs to `project_id`.
- Setting `superseded` without `superseded_by` is allowed (link optional), but recommended when known.

## Retrieval defaults

- `search_lessons` excludes `superseded` and `archived` by default.
- Optional escape hatch: `filters.include_all_statuses=true` (or equivalent) to include all.

## Failure modes

| Symptom | Cause | Mitigation |
|---|---|---|
| Lesson “disappeared” from search | Marked superseded/archived | Use `list_lessons` with status filter or include-all flag |
