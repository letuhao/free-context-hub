---
id: CH-M08  status: planned  phase: Phase 2  depends-on: M06, M07  updated: 2026-03-25
---

# Module Brief: M08 — DX Polish

## Outcome
Every friction point an agent encounters when calling tools is removed or reduced.
Zero cases where an agent fails because of a confusing description, a missing
default, or a documented bug that was never fixed.

## Scope
IN: Fix `rules_checked` bug in `guardrails.ts`
    `DEFAULT_PROJECT_ID` env var — makes `project_id` optional on all tools
    Full tool description audit and rewrite in `index.ts`
    `add_lesson` enum description — list all 5 types with one-liner each
    `AGENT_PROTOCOL.md` update — reflect new tools + simplified session start
    Module brief updates for M06/M07/M08
OUT: Breaking changes to existing tool signatures
     Renaming existing tools (backward compat preserved throughout)
     UI, dashboard, REST API changes

## Acceptance
- [ ] AT-M08-01: `DEFAULT_PROJECT_ID=myproj` set in env → `project_id` can be omitted → tool resolves correctly
- [ ] AT-M08-02: `check_guardrails` returns `rules_checked=N` where N = count of rules evaluated, not 0 when rules exist but none matched trigger
- [ ] AT-M08-03: All tool descriptions use "Use to X" or "Call when Y" pattern — no references to deprecated behavior
- [ ] AT-M08-04: `add_lesson` description lists all 5 `lesson_type` values with one-line description each
- [ ] AT-M08-05: `AGENT_PROTOCOL.md` §2 session start: step 4 = "Call `get_context(project_id, task)`", not the previous 4-step sequence

## Bug Fix: `rules_checked` (SP-1 — ship immediately)

File: `src/services/guardrails.ts`, line ~68

```typescript
// CURRENT (wrong):
if (matched.length === 0) {
  // ... audit log ...
  return { pass: true, rules_checked: 0 };  // ← should be checked.length
}

// FIXED:
if (matched.length === 0) {
  // ... audit log ...
  return { pass: true, rules_checked: checked.length };  // ← total rules evaluated
}
```

Impact: agents debugging "why didn't my guardrail fire?" now see the correct count.

## Default Project ID (SP-2)

Add to `src/env.ts`:
```typescript
DEFAULT_PROJECT_ID: z.string().optional()
```

Add helper to `src/index.ts`:
```typescript
function resolveProjectId(explicit?: string): string {
  const resolved = explicit ?? getEnv().DEFAULT_PROJECT_ID;
  if (!resolved) throw new McpError(ErrorCode.InvalidParams,
    'project_id required (or set DEFAULT_PROJECT_ID in server env)');
  return resolved;
}
```

All tool Zod schemas: change `project_id: z.string().min(1)` → `project_id: z.string().optional()`.

## Tool Description Rewrites (SP-3)

| Tool | New Description |
|---|---|
| `index_project` | "Scan and index a directory into the vector store. Call after significant code changes or on a fresh environment." |
| `search_code` | "Semantic search over indexed code. Call before Grep or file reads when you know intent but not location." |
| `search_lessons` | "Semantic search over all lessons (decisions, preferences, workarounds, notes). Call to find past decisions or team patterns." |
| `list_lessons` | "Browse lessons by type or tag without semantic ranking. Call when you want all lessons of a specific type." |
| `get_context` | "Session bootstrap. Call once at session start. Returns preferences, recent decisions, workarounds, guardrail rules, and (if task provided) relevant code and lessons." |
| `add_lesson` | "Persist team knowledge. lesson_type: decision=architectural choice, preference=team style, guardrail=rule to enforce, workaround=bug fix, general_note=anything else." |
| `check_guardrails` | "Evaluate active rules before a risky action. Call before: git push, deploy, schema migration, data deletion, force-push." |
| `get_preferences` | "DEPRECATED: use list_lessons(lesson_type='preference') or search_lessons() instead. Will be removed in next phase." |
| `delete_workspace` | "Delete ALL project data permanently. Irreversible. Call only on explicit user instruction." |

## Sub-phases
| SP | Scope | Status |
|---|---|---|
| SP-1 | Fix `rules_checked` bug — one line in `guardrails.ts` | planned |
| SP-2 | `DEFAULT_PROJECT_ID` env + `resolveProjectId()` helper | planned |
| SP-3 | Tool description audit + rewrite all 9 tool descriptions | planned |
| SP-4 | `AGENT_PROTOCOL.md` full update — new tools, session start = 1 call | planned |

## Risks (open)
- R-M08-01: Making `project_id` optional is an input schema change — MCP clients with strict validation may warn. Risk: low (optional fields are backward compatible)

## Recent Decisions
- SP-1 ships independently before M06/M07 — zero dependencies, immediate value [2026-03-25]
- Backward compat: `get_preferences` stays functional (implementation unchanged), only description updated [2026-03-25]
