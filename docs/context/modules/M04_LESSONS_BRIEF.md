---
id: CH-M04  status: done  phase: MVP  depends-on: storage-schema  updated: 2026-03-25
---

# Module Brief: M04 — Persistent Memory (Lessons & Preferences)

## Outcome
Stores, retrieves, and embeds lessons scoped by project_id. This is the
foundation layer — M01, M02, M05 all write to or read from here.

## Scope
IN: Lesson CRUD, preference filtering (tag-based), lesson embeddings,
    project_id isolation, source_refs, audit timestamps, delete/retention
OUT: Lesson merging/deduplication, version history, user-level ACL (post-MVP)

## Acceptance
- [ ] AT-M04-01: `add_lesson(payload)` persists all fields including tags and source_refs
- [ ] AT-M04-02: `get_preferences(project_id)` returns only `preference-*` tagged lessons
- [ ] AT-M04-03: Lessons survive process restart (durable storage confirmed)
- [ ] AT-M04-04: project_id isolation — project A cannot read project B data
- [ ] AT-M04-05: Lesson embedding stored alongside lesson record
- [ ] AT-M04-06: `delete_workspace(project_id)` removes all project data

## Data Schema
```sql
lessons(
  project_id     TEXT NOT NULL,
  lesson_id      UUID PRIMARY KEY,
  lesson_type    TEXT CHECK(lesson_type IN ('decision','preference','guardrail','workaround','general_note')),
  title          TEXT NOT NULL,
  content        TEXT NOT NULL,
  tags           TEXT[],
  source_refs    TEXT[],
  created_at     TIMESTAMPTZ,
  updated_at     TIMESTAMPTZ,
  captured_by    TEXT
);

guardrails(
  project_id          TEXT NOT NULL,
  rule_id             UUID PRIMARY KEY,
  trigger             TEXT NOT NULL,
  requirement         TEXT NOT NULL,
  verification_method TEXT NOT NULL
);
```

## Sub-phases
| SP | Scope | Status |
|---|---|---|
| SP-1 | DB schema + migration scripts | done |
| SP-2 | Lesson CRUD (create, read) | done |
| SP-3 | Preference query (tag filter: `preference-*`) | done |
| SP-4 | Guardrail rule CRUD (via `add_lesson` with `guardrail` field) | done |
| SP-5 | Lesson embedding storage | done |
| SP-6 | Delete/retention controls (`delete_workspace` tool) | done |

## V1 Gap — `search_lessons` tool missing

**Problem discovered**: `general_note`, `decision`, `workaround` lessons stored via `add_lesson`
are NOT queryable by agents. `get_preferences()` only returns `preference-*` tagged lessons.
All other lesson types are write-only in MVP — stored with embeddings but no read path.

**Workaround (now)**: Add tag `preference-<topic>` to any lesson you want agents to read.

**Proper fix (V1)**: Add `search_lessons(query, lesson_type?, limit?)` tool:
```sql
SELECT lesson_id, lesson_type, title, content, tags
FROM lessons
WHERE project_id = $1
  AND ($3 IS NULL OR lesson_type = $3)
ORDER BY embedding <=> $2::vector
LIMIT $4;
```
No schema change needed — embedding already exists in lessons table.

## Risks (open)
- R-M04-01: `general_note`/`decision`/`workaround` lessons are write-only for agents (no query tool) [high for V1]

## Recent Decisions
- MVP: lesson retrieval limited to `preference-*` tag filter via `get_preferences()` [2026-03-25]
- Workaround confirmed: tag any lesson with `preference-<topic>` to make it agent-readable now [2026-03-25]
