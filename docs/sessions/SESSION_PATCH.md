---
id: CH-T3  date: 2026-03-25  module: Phase2-planning  phase: Phase 2
---

# Session Patch — 2026-03-25

## Where We Are
Phase: MVP complete · Phase 2: planned, not started
Last completed: Phase 2 design — M06/M07/M08 module briefs + PHASE2_CONTEXT.md created
Next: DA decision on DEC-P2-001 (deprecate `get_preferences` immediately or alias?), then start M08-SP1

## Recommended First Step
**M08-SP1** — fix `rules_checked` bug in [guardrails.ts:68](src/services/guardrails.ts#L68).
One-line change, zero dependencies, ships immediately:
```typescript
// Change:  return { pass: true, rules_checked: 0 };
// To:      return { pass: true, rules_checked: checked.length };
```

## Open Decisions
| ID | Decision | Blocks |
|---|---|---|
| DEC-P2-001 | Deprecate `get_preferences` immediately or keep as alias for 1 cycle? | M06-SP4 |
| DEC-P2-002 | `get_context` + task: single embed → pass precomputedVector, or let services embed independently? | M07-SP2 latency |
| DEC-P2-003 | `list_lessons` total_count: window function vs separate COUNT query? | M06-SP1 |

## Open Blocker (MVP - operational)
- OPS-001: Stale server process may hold wrong `CONTEXT_HUB_WORKSPACE_TOKEN` → restart before smoke-test

## Context to Load This Session
- Tier 0: `docs/context/PROJECT_INVARIANTS.md`
- Tier 1: `docs/context/PHASE2_CONTEXT.md`  ← use this now, not MVP_CONTEXT
- Tier 2 (if implementing): `docs/context/modules/M08_DX_POLISH_BRIEF.md` (start here)
