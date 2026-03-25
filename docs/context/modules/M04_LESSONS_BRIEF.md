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

## Risks (open)
- R-M04-01: Lesson schema may need evolution if guardrail model changes mid-MVP [medium]

## Recent Decisions
- (none yet — this is the first module to implement)
