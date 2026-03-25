---
id: CH-M06  status: planned  phase: Phase 2  depends-on: M04  updated: 2026-03-25
---

# Module Brief: M06 — Lesson Discovery

## Outcome
Every stored lesson — regardless of type or tag — is queryable by AI agents.
The `preference-*` tag workaround is eliminated. Agents can find decisions,
workarounds, and notes by semantic query or by structured browse.

## Why Now
`add_lesson` stores embeddings for all lesson types but the only read path
(`get_preferences`) filters to `preference-*` tags only. All other lesson types
are write-only. Embedding column exists — semantic search needs zero schema change.

## Scope
IN: `search_lessons(query, filters?)` — vector similarity over all lessons
    `list_lessons(filters?)` — paginated browse by type/tag, no embedding needed
    Service functions in `src/services/lessons.ts`
    Tool registration in `src/index.ts`
    Migration `0002_lesson_hnsw_index.sql` (HNSW on `lessons.embedding`)
    Deprecate `get_preferences` description (keep implementation, mark deprecated)
OUT: Cross-project search, full-text (lexical) search, lesson update/edit, deduplication

## Acceptance
- [ ] AT-M06-01: `search_lessons(query)` returns `decision`/`workaround`/`general_note` without `preference-*` tag
- [ ] AT-M06-02: `search_lessons(query, lesson_type="decision")` returns only decisions
- [ ] AT-M06-03: `search_lessons(query, tags=["guardrail-ci"])` requires all specified tags
- [ ] AT-M06-04: Result includes `{lesson_id, lesson_type, title, content, tags, source_refs, score, created_at}`
- [ ] AT-M06-05: `list_lessons(lesson_type="workaround")` returns all workarounds, ordered `created_at DESC`
- [ ] AT-M06-06: `list_lessons` supports `limit` + `offset` pagination; response includes `total_count`
- [ ] AT-M06-07: Empty results return `{lessons: []}` — never an error
- [ ] AT-M06-08: project_id isolation — project A cannot read project B lessons

## API Signatures

### `search_lessons` input
```typescript
{
  workspace_token?: string,
  project_id?: string,              // optional if DEFAULT_PROJECT_ID set in env
  query: string,                    // natural language: "why we chose postgres"
  lesson_type?: LessonType,         // filter to one type
  tags?: string[],                  // AND filter: all tags must match
  limit?: number,                   // default: 10
  output_format?: OutputFormat
}
```
### `search_lessons` output
```typescript
{
  lessons: Array<{
    lesson_id: string, lesson_type: string, title: string, content: string,
    tags: string[], source_refs: string[], score: number, created_at: string,
    captured_by: string | null
  }>,
  explanations: string[]
}
```
### Core SQL (direct analogue of `searchCode`)
```sql
SELECT lesson_id, lesson_type, title, content, tags, source_refs, captured_by, created_at,
       GREATEST(0, 1 - (embedding <=> $2::vector)) AS score
FROM lessons
WHERE project_id = $1
  AND ($3::text IS NULL OR lesson_type = $3)
  AND ($4::text[] IS NULL OR tags @> $4)
ORDER BY embedding <=> $2::vector
LIMIT $5;
```

### `list_lessons` input
```typescript
{
  workspace_token?: string,
  project_id?: string,
  lesson_type?: LessonType,
  tags?: string[],
  limit?: number,    // default: 20
  offset?: number,   // default: 0
  output_format?: OutputFormat
}
```
### `list_lessons` output
```typescript
{
  lessons: Array<{ lesson_id, lesson_type, title, content, tags, source_refs, created_at, captured_by }>,
  total_count: number    // total matching rows before limit/offset
}
```

## Sub-phases
| SP | Scope | Status |
|---|---|---|
| SP-1 | `searchLessons()` + `listLessons()` service functions in `lessons.ts` | planned |
| SP-2 | `search_lessons` + `list_lessons` tool registration in `index.ts` | planned |
| SP-3 | Migration `0002_lesson_hnsw_index.sql` (`CREATE INDEX CONCURRENTLY`) | planned |
| SP-4 | Mark `get_preferences` description as deprecated; update `AGENT_PROTOCOL.md` | planned |
| SP-5 | Smoke test: assert `search_lessons` finds non-preference-tagged lessons | planned |

## Risks (open)
- R-M06-01: HNSW index build briefly locks lessons table [low — use CONCURRENTLY]
- R-M06-02: `search_lessons` requires LM Studio running for embedding — same as `search_code` [known dependency]

## Recent Decisions
- Pattern: reuse `searchCode()` query structure — replace `chunks` table with `lessons`, same cosine operator [2026-03-25]
- `list_lessons` does NOT call embedder — pure SQL filter for zero-latency browsing [2026-03-25]
