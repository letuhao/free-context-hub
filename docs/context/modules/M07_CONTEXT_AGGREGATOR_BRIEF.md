---
id: CH-M07  status: planned  phase: Phase 2  depends-on: M06-SP1  updated: 2026-03-25
---

# Module Brief: M07 — Smart Context Aggregator

## Outcome
One `get_context(project_id, task?)` call replaces the entire session-start sequence.
Agent receives preferences + recent decisions + workarounds + guardrail summary +
(if task provided) relevant code and lessons — all in a single round-trip.

## Why Now
Session start currently requires: read SESSION_PATCH + read T0 + read T1 + `get_preferences()`.
The file reads stay (they load docs that are not in DB), but the tool call sequence
collapses from 4 steps to 1. Key: `get_context` runs DB queries in parallel.

## Scope
IN: `get_context(project_id, task?, include?, lesson_limit?, code_limit?)` tool
    `src/services/context.ts` (new file) — parallel query executor
    Optional `precomputedVector` param on `searchLessons`/`searchCode` to avoid duplicate embedding
    `get_context` in smoke test
OUT: File-system reads (SESSION_PATCH.md and tier docs remain file reads by design)
     Cross-project aggregation, caching, materialized context, lifecycle hooks

## Acceptance
- [ ] AT-M07-01: `get_context(project_id)` returns `{preferences, recent_decisions, active_workarounds, guardrail_summary, code_matches, lesson_matches}` in one call
- [ ] AT-M07-02: `get_context(project_id, task="JWT refresh")` populates `code_matches` and `lesson_matches`
- [ ] AT-M07-03: `include=["preferences","decisions"]` returns only those sections, others are empty arrays
- [ ] AT-M07-04: Response is valid JSON matching the defined output schema — no freeform text
- [ ] AT-M07-05: Empty project returns empty arrays in all sections — never an error
- [ ] AT-M07-06: `guardrail_summary` contains `{total_rules, rules:[{rule_id, trigger, requirement}]}`
- [ ] AT-M07-07: Without `task`: completes in < 300ms (no embedding call)
- [ ] AT-M07-08: With `task`: completes in < 800ms (one embedding call + parallel queries)
- [ ] AT-M07-09: If LM Studio unavailable and `task` provided: returns persistent sections + `warnings: ["task_search_skipped: embedding service unavailable"]`

## API Signature

### Input
```typescript
{
  workspace_token?: string,
  project_id?: string,
  task?: string,           // triggers semantic search for code + lessons
  include?: Array<'preferences' | 'decisions' | 'workarounds' | 'guardrails' | 'code'>,
                           // default: all sections
  lesson_limit?: number,   // max per section; default: 10
  code_limit?: number,     // only used when task provided; default: 5
  output_format?: OutputFormat
}
```

### Output
```typescript
{
  project_id: string,
  task?: string,

  // Always present (no embedding needed)
  preferences: LessonRow[],        // lesson_type=preference OR tag preference-*
  recent_decisions: LessonRow[],   // lesson_type=decision, ordered by created_at DESC
  active_workarounds: LessonRow[], // lesson_type=workaround, ordered by created_at DESC
  guardrail_summary: {
    total_rules: number,
    rules: Array<{ rule_id: string, trigger: string, requirement: string }>
  },

  // Present only when `task` is provided AND embedding succeeds
  code_matches: CodeMatch[],       // from searchCode(task)
  lesson_matches: LessonMatch[],   // from searchLessons(task) — all types

  warnings?: string[]              // non-fatal failures, e.g., embedding unavailable
}
```

### Internal Execution (parallel)
```typescript
// No task: 4 parallel DB queries, zero embed calls
const [preferences, decisions, workarounds, guardrails] = await Promise.all([
  listLessons({ projectId, lessonType: 'preference', limit }),
  listLessons({ projectId, lessonType: 'decision',   limit }),
  listLessons({ projectId, lessonType: 'workaround', limit }),
  pool.query('SELECT rule_id, trigger, requirement FROM guardrails WHERE project_id=$1', [projectId])
]);

// With task: embed ONCE, pass precomputed vector to both searches
const [embedding] = await embedTexts([task]);   // single embed call
const [codeMatches, lessonMatches] = await Promise.all([
  searchCode({ projectId, precomputedVector: embedding, limit: codeLimit }),
  searchLessons({ projectId, precomputedVector: embedding, limit: lessonLimit })
]);
```

## Sub-phases
| SP | Scope | Status |
|---|---|---|
| SP-1 | `src/services/context.ts` — parallel query service | planned |
| SP-2 | Add `precomputedVector?` param to `searchLessons` + `searchCode` service fns | planned |
| SP-3 | `get_context` tool registration in `index.ts` | planned |
| SP-4 | Smoke test: `get_context` with and without `task` | planned |
| SP-5 | Update `AGENT_PROTOCOL.md` — session start = `get_context`, not 4 steps | planned |

## Risks (open)
- R-M07-01: Large payload if hundreds of lessons [medium — `lesson_limit`/`code_limit` cap it]
- R-M07-02: Agents stop using `search_code` for targeted mid-session queries [low — tool descriptions clarify]
- R-M07-03: `precomputedVector` change to `searchCode`/`searchLessons` is a service-layer change [medium — internal only, no MCP signature change]

## Recent Decisions
- `get_context` does NOT replace file reads (SESSION_PATCH.md, T0, T1 docs stay as file reads) [2026-03-25]
- Degradation pattern: on embed failure + task provided → return persistent sections + `warnings[]`, not throw [2026-03-25]
- `guardrail_summary` returns trigger+requirement only (no full audit log, no verification_method) — keeps response compact [2026-03-25]
