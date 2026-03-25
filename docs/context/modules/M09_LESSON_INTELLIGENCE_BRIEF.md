---
id: CH-M09
module: M09 Lesson Intelligence
status: done
updated: 2026-03-26
---

# M09 — Lesson Intelligence

## Purpose

Improve **retrieval quality** and **actionability** of lessons without requiring the consuming agent to re-read long bodies.

## Schema (see migration `0003_lesson_intelligence.sql`)

| Column | Type | Notes |
|---|---|---|
| `summary` | `TEXT` nullable | ≤ ~150 tokens target; distilled TL;DR |
| `quick_action` | `TEXT` nullable | Short imperative “how to apply” (≤ ~10 lines) |
| `status` | `TEXT` NOT NULL | `draft \| active \| superseded \| archived` |
| `superseded_by` | `UUID` nullable | FK → `lessons.lesson_id` |

## Distillation (`src/services/distiller.ts`)

- **Input:** `title` + `content` (full lesson body).
- **Output:** JSON `{ "summary": string, "quick_action": string }`.
- **When:** `add_lesson`, if `DISTILLATION_ENABLED=true`.
- **Failure:** timeout / non-JSON / HTTP error → lesson still inserted with `status=draft`, `summary`/`quick_action` null (see `R-P3-01`).

## Conflict suggestions (M09-SP3)

After embedding the new lesson body (pre-insert), query nearest neighbors among **existing** lessons in the same `project_id` (pgvector distance). If similarity exceeds a threshold, return **`conflict_suggestions`** in the `add_lesson` tool response (suggest-only; **no** automatic supersession).

## MCP contract

- **`add_lesson` response** (backward compatible): existing fields plus optional:
  - `summary`, `quick_action`
  - `distillation`: `{ "status": "skipped" \| "ok" \| "failed", "reason"?: string }`
  - `conflict_suggestions`: `{ lesson_id, title, similarity }[]`

## Failure modes

| Symptom | Cause | Mitigation |
|---|---|---|
| Always `draft` + no summary | Chat model down / wrong URL | Fix `DISTILLATION_BASE_URL` / model; or set `DISTILLATION_ENABLED=false` |
| Low-quality summary | Model too small / temperature | Tune model; keep prompts short; cap tokens |
