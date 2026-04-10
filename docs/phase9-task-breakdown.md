# Phase 9: Multi-Project UX Redesign — Task Breakdown

## Context

The current UI treats multi-project as an afterthought — users can only view one project at a time with no cross-project comparison, no aggregate views, and no visual project context on pages. In a real company with multiple teams and projects, this forces tedious switching and hides the big picture. Phase 9 redesigns the UX around "All Projects" as a first-class mode.

**Branch:** `feature/multi-project-ux`  
**Design drafts:** `docs/gui-drafts/v2/` (8 HTML files)  
**Page audit:** `docs/gui-drafts/v2/00-design-notes.md`

## Architecture Decisions

1. **Context model:** `selectedProjectIds: string[]` alongside legacy `projectId`. Sentinel `"__ALL__"` = all projects.
2. **API contract:** Endpoints gain optional `project_ids[]` param. When absent, existing single-project path unchanged.
3. **Backend pattern:** `*Multi` service variants using `WHERE project_id = ANY($1::text[])`, matching existing `searchLessonsMulti`.

## Existing Infrastructure (reuse, don't rebuild)

- `resolveProjectIds(projectId, includeGroups)` → `src/services/projectGroups.ts`
- `searchLessonsMulti()` → `src/services/lessons.ts` (already supports `project_ids[]`)
- `POST /api/guardrails/check` with `include_groups` → `src/api/routes/guardrails.ts`
- `listAllProjects()` → `src/services/projectGroups.ts`

---

## Sprint Breakdown (10 sprints)

| Sprint | Name | Scope | Effort | Depends |
|--------|------|-------|--------|---------|
| 9.1 | Context & API Foundation | BE: 6 multi-project endpoints. FE: context + api.ts | Large | — |
| 9.2 | ProjectSelector V2 + PageHeader V2 | FE: multi-select selector, project badge prop | Medium | 9.1 |
| 9.3 | NoProjectGuard V2 + ProjectBadge | FE: reusable badge, per-project-only guards | Small | 9.1, 9.2 |
| 9.4 | Dashboard V2 | FE: aggregate stats + project cards | Medium | 9.1–9.3 |
| 9.5 | Lessons V2 | FE: project column, cross-project search | Medium | 9.1–9.3 |
| 9.6 | Review Inbox V2 | FE: grouped by project, per-project batch | Medium | 9.1–9.3 |
| 9.7 | Guardrails V2 | FE+BE: cross-project check, project column | Medium | 9.1–9.3 |
| 9.8 | Analytics V2 | FE: per-project comparison, aggregate charts | Large | 9.1–9.3 |
| 9.9 | Minor Pages (11 pages) | FE: badges + multi-project fetch for 3 pages | Small | 9.1–9.3 |
| 9.10 | Graph Explorer V2 + E2E Cleanup | FE: polished warning. Tests: 228+ total | Medium | All |

---

## Sprint 9.1 — Context & API Foundation

**Status:** `[ ]`

### Backend Changes
- [ ] `src/services/analytics.ts` — Add `getRetrievalStatsMulti`, `getRetrievalTimeseriesMulti`
- [ ] `src/services/auditLog.ts` — Add `listAuditLogMulti`, `getAuditStatsMulti`
- [ ] `src/services/activity.ts` — Add `listActivityMulti`
- [ ] `src/services/projectGroups.ts` — Add `resolveProjectIdsArray`
- [ ] `src/api/routes/analytics.ts` — Accept `project_ids[]` on overview + timeseries
- [ ] `src/api/routes/audit.ts` — Accept `project_ids[]` on list + stats
- [ ] `src/api/routes/activity.ts` — Accept `project_ids[]`
- [ ] `src/api/routes/guardrails.ts` — Accept `project_ids[]` on rules list + simulate
- [ ] `src/api/routes/lessons.ts` — Accept `project_ids[]` on GET list
- [ ] `src/api/routes/jobs.ts` — Accept `project_ids[]` on GET list
- [ ] `src/core/index.ts` — Re-export new functions

### Frontend Changes
- [ ] `gui/src/contexts/project-context.tsx` — Add `selectedProjectIds`, `isAllProjects`, `effectiveProjectIds`, `setSelectedProjectIds`
- [ ] `gui/src/lib/api.ts` — Add `*Multi` methods (listLessonsMulti, getRetrievalStatsMulti, etc.)

### Acceptance Criteria
- All 198 existing E2E tests pass (zero regression)
- New endpoints return data when `project_ids[]` provided
- Legacy single `project_id` path still works unchanged

---

## Sprint 9.2 — ProjectSelector V2 + PageHeader V2

**Status:** `[ ]`

### Frontend Changes
- [ ] `gui/src/components/project-selector.tsx` — Full rewrite: "All Projects" row, checkbox multi-select, 3 display modes, keyboard nav
- [ ] `gui/src/components/ui/page-header.tsx` — Add `projectBadge?: ReactNode` prop
- [ ] `gui/src/components/sidebar.tsx` — Aggregate review/notif counts in All Projects mode

### Acceptance Criteria
- Selector shows "All Projects" option at top
- Multi-select works (check multiple, see stacked avatars)
- Single-select still works (backward compatible)
- PageHeader renders badge when provided

---

## Sprint 9.3 — NoProjectGuard V2 + ProjectBadge

**Status:** `[ ]`

### Frontend Changes
- [ ] `gui/src/components/no-project-guard.tsx` — Add `requireSingleProject` prop with warning UI
- [ ] `gui/src/components/project-badge.tsx` — **NEW** — reads context, renders color dot + name
- [ ] `gui/src/app/knowledge/graph/page.tsx` — Add `requireSingleProject` guard
- [ ] `gui/src/app/knowledge/search/page.tsx` — Add `requireSingleProject` guard
- [ ] `gui/src/app/projects/sources/page.tsx` — Add `requireSingleProject` guard
- [ ] `gui/src/app/projects/settings/page.tsx` — Add `requireSingleProject` guard

### Acceptance Criteria
- Graph/Search/Sources/Settings show warning when "All Projects" active
- Warning includes inline project picker
- ProjectBadge renders correctly in all 3 modes

---

## Sprint 9.4 — Dashboard V2

**Status:** `[ ]`

- [ ] `gui/src/app/page.tsx` — All Projects mode: project cards (2×2 grid with health scores), aggregate stats, cross-project activity feed with project badges

### Acceptance Criteria
- Single project: pixel-identical to current
- All Projects: project cards visible, aggregate totals correct, activity shows project badges

---

## Sprint 9.5 — Lessons V2

**Status:** `[ ]`

- [ ] `gui/src/app/lessons/page.tsx` — Project column in All Projects mode, `listLessonsMulti` for fetch, Add Lesson disabled
- [ ] `gui/src/app/lessons/types.ts` — Add optional `project_id`, `project_name` to Lesson type

### Acceptance Criteria
- Project column with color badges visible in All Projects
- Cross-project search returns mixed results
- Add Lesson shows "Select a project" hint

---

## Sprint 9.6 — Review Inbox V2

**Status:** `[ ]`

- [ ] `gui/src/app/review/page.tsx` — Collapsible project sections, per-project batch approve/reject

### Acceptance Criteria
- Lessons grouped by project with color headers
- Per-project "Approve all" / "Reject all" buttons
- Single project: unchanged

---

## Sprint 9.7 — Guardrails V2

**Status:** `[ ]`

- [ ] `gui/src/app/guardrails/page.tsx` — Project column in rules, cross-project check results
- [ ] `src/api/routes/guardrails.ts` — Accept `project_ids[]` in POST check

### Acceptance Criteria
- "Check All Projects" shows per-project BLOCKED/ALLOWED
- Rules table has Project column in All Projects mode

---

## Sprint 9.8 — Analytics V2

**Status:** `[ ]`

- [ ] `gui/src/app/analytics/page.tsx` — Per-project comparison table, aggregate stats with trends, multi-line timeseries

### Acceptance Criteria
- Comparison table: one row per project with sortable columns
- Aggregate stat cards with +/- trends
- Multi-line chart with project colors

---

## Sprint 9.9 — Minor Pages (11 pages)

**Status:** `[ ]`

Badge-only (5 pages):
- [ ] Chat, Documents, Getting Started, Generated Docs, Git History — `projectBadge` in PageHeader

Multi-project fetch (3 pages):
- [ ] Jobs — `listJobsMulti` + Project column
- [ ] Activity — `listActivityMulti` + Project column
- [ ] Agent Audit — `listAuditLogMulti` + Project column

---

## Sprint 9.10 — Graph Explorer V2 + E2E Cleanup

**Status:** `[ ]`

- [ ] `gui/src/app/knowledge/graph/page.tsx` — Polished per-project warning with inline project picker
- [ ] Verify all 198 existing E2E tests pass
- [ ] Add `test/e2e/gui/multi-project.spec.ts` (~15 tests)
- [ ] Add `test/e2e/api/multi-project.test.ts` (~15 tests)

### Final Target
- 198 original tests + ~30 new = **228+ tests all passing**
- Manual QA: switch between single/all/multi on every page
