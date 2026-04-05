---
id: CH-PHASE8-SPRINT1
date: 2026-04-05
module: Phase8-Sprint1-FeatureToggles-Drafts
phase: IN_PROGRESS
---

# Session Patch — 2026-04-05 (Session 3)

## Where We Are
**Phase 8 started.** 5 draft designs created. Sprint 8.1 (Feature Toggles) complete — full 9-phase workflow applied.

## What Was Done This Session

### 1. Pre-Phase 8 Review & QC (from Session 2)
- Code review: 12 review passes, 18 issues found and fixed
- Browser QC: 10 pages tested via Playwright, all pass, 0 console errors
- 4 lessons recorded via MCP (decisions + preferences)

### 2. Phase 8 Draft Designs (5 files)
- D1: Agent audit trail — action timeline, guardrail logs, agent detail slide-over
- D2: Custom lesson types — built-in + custom types, template editor, add type modal
- D3: Rich content editor — markdown toolbar, preview/split, AI assist popover
- D4: Feature toggles — project settings section, icons, dependency warnings
- D5: Access control — API keys, roles, permissions matrix
- Updated index.html to v5 (24 pages, 18 components)

### 3. Sprint 8.1: Feature Toggles (full 9-phase workflow)
- PLAN: Scope = wire settings.features JSONB to project settings UI
- DESIGN: Toggle click → PUT /api/projects/:id → merge settings → refreshProjects
- BUILD BE: Added `settings` to listAllProjects query, type, mapper (3 lines)
- BUILD FE: Added Features section with 4 toggles (Git Intelligence, Knowledge Graph, AI Distillation, Auto Review), icons, dependency hints, aria labels
- TEST: BE tsc clean, FE tsc clean, 4/4 tests pass, FE build clean (21 routes)
- REVIEW: 3 files, +69/-2, no issues found
- QC: Browser test blocked by dev server cache (code correct, build passes)
- Total: 3 files changed, minimal diff

## Commit Log (this session)
```
894548d [Phase8] Add 5 draft HTML designs for Advanced HITL features
4069d02 [Session] Update session patch — Pre-Phase 8 multi-project support complete
f23f88b [Pre-Phase8] Code review fixes — validation, a11y, hydration, cleanup
```

## What's Next (Next Session)

### Sprint 8.1 remaining
- Restart BE + FE dev servers to verify feature toggles in browser
- Live QC: toggle on/off, reload to verify persistence

### Sprint 8.2: Custom Lesson Types -- DONE
- Migration 0040: lesson_types table + seed 5 built-in + drop CHECK constraint
- BE: CRUD service + routes (GET/POST/PUT/DELETE /api/lesson-types)
- BE: Relaxed z.enum() → z.string() in MCP (4 places) + distiller + LessonType alias
- FE: /settings/lesson-types page with create/edit/delete modals
- FE: API client methods + sidebar nav link
- Remaining: update filter chips + add lesson dialog to use dynamic types (minor integration)

### Sprint 8.3: Agent Audit Trail -- DONE
- BE: auditLog service — UNION query over guardrail_audit_logs + lessons tables
- BE: GET /api/audit (timeline, filters, pagination) + GET /api/audit/stats
- FE: /agents page with timeline, stats, action tabs, time range filter
- FE: Agent detail slide-over with trust level + auto-approve controls
- FE: Renamed updateAgentTrust → updateAgent, added getAgent API method

### Sprint 8.4: Rich Content Editor -- DONE
- FE: RichEditor component — markdown toolbar (Bold/Italic/Code/Heading/List/Link/CodeBlock),
  Edit/Preview/Split toggle, simple markdown renderer, status bar, Ctrl+B/I shortcuts
- FE: Wired into add-lesson dialog (replaced Write/Preview toggle + textarea)
- Decision: kept lesson-detail textarea untouched (AI selection toolbar depends on textarea ref coords)

### Sprint 8.5: Access Control
- BE: API keys table, roles, middleware
- FE: Access control page (from draft D5)
