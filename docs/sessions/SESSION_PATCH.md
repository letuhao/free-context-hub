---
id: CH-E2E-MULTIPROJECT
date: 2026-04-11
module: E2E-Tests-and-MultiProject-Design
phase: E2E complete, Multi-project V2 designed
---

# Session Patch — 2026-04-10/11 (Session 4)

## Where We Are
**E2E test suite complete (198/198 pass). Multi-project UX redesign designed (8 V2 drafts). Layout fixes shipped.**

## What Was Done This Session

### Phase 8D — Deferred Improvements (1 commit)
- Feature toggles BE: `isFeatureEnabled()` service with 30s cache, gates git/KG/distillation per-project
- Role enforcement: `requireRole()` middleware (reader/writer/admin) on all write routes
- Rich editor: RichEditor component in lesson detail edit mode
- Dashboard onboarding checklist (4 items, data-driven, dismissible)
- Code review: 4 issues found and fixed (reader GET access, promote route, stale checklist, orphaned comment)

### TS Strict Fixes (1 commit)
- Fixed 11 pre-existing `req.params` type errors (`string | string[]` → `String()`) that blocked Docker build

### E2E Test Suite (9 sprints, 9 commits)
- **Layer 1 — Smoke (134 tests):** API smoke (75 endpoints), GUI smoke (23 pages + screenshots), MCP smoke (36 tools)
- **Layer 2 — Scenarios (64 tests):** Auth roles (7), Lessons CRUD (8), Guardrails (6), Documents (5), Search (4), System (3), GUI Dashboard (5), GUI Lessons (7), GUI Guardrails (4), GUI Settings (5), Agent MCP→GUI (9)
- **Total: 198 tests, all passing**
- Infrastructure: Playwright, shared test utilities, 3 runners, screenshot baselines

### Layout Fixes (3 commits)
- `h-screen` + component-level scroll on all 24 pages (no more page-level vertical scroll)
- Page size 20→12 for tables (fits 1080p viewport with pagination)
- Minor polish: badge contrast, compact stat cards, neutral "Coming Soon" tags

### Multi-Project UX Redesign — Design Phase (2 commits)
- Full 23-page audit: which pages need cross-project view, which must stay per-project
- 8 V2 draft HTMLs: PageHeader, Project Selector, Dashboard, Lessons, Analytics, Graph Explorer, Guardrails, Review Inbox
- Key decisions: Graph Explorer stays per-project (company-wide graph is useless), "All Projects" is first-class mode

### MemPalace Investigation
- Cloned and analyzed milla-jovovich/mempalace (38K stars, ChromaDB-based memory system)
- Compared with free-context-hub: different philosophies (raw recall vs structured knowledge management)
- Conclusion: benchmark gap is storage philosophy, not technology — ChromaDB won't help us

## Commit Log (this session)
```
7982dda [Design] V2 drafts: graph explorer, guardrails, review inbox + full page audit
557381e [Design] V2 draft HTMLs — multi-project UX redesign + user review brief
31ab149 [E2E] Sprint 9 — Agent MCP→GUI visual tests (9/9 pass)
2ac2e34 [E2E] Sprint 8 — GUI scenarios: guardrails + settings (9/9 pass)
fd83845 [E2E] Sprint 7 — GUI scenarios: dashboard + lessons (12/12 pass)
8d64231 [E2E] Sprint 6 — API scenarios: documents, search, system (34/34 pass)
d32d16e [E2E] Sprint 5 — API scenario tests: auth, lessons, guardrails (22/22 pass)
0013a8a [GUI] Minor layout polish — badge contrast, compact stat cards, neutral tags
4f7f6b6 [GUI] Reduce page size 20→12 to fit viewport, remove window.scrollTo
2c43387 [GUI] Fix viewport layout — component-level scroll instead of page scroll
2298767 [E2E] Sprint 4 — MCP tool smoke tests, 111/111 pass (full Layer 1)
5cacc7e [E2E] Sprint 3 — GUI smoke tests, 23/23 pass + screenshots
991c191 [E2E] Sprint 2 — API smoke tests, 75/75 pass
256b58b [E2E] Sprint 1 — test infrastructure setup, shared utilities, smoke runner
904f63b Fix TS strict errors — String() cast on req.params to satisfy Express types
60b9ee5 [Phase8D] Deferred improvements — feature toggles BE, role enforcement, rich editor, onboarding checklist
```

## What's Next

### Phase 9: Multi-Project UX Redesign (NEW — replaces original Phase 9)
Branch: `feature/multi-project-ux`
Design: `docs/gui-drafts/v2/` (8 draft HTMLs + audit)

**Implementation scope:**
1. Project selector V2 — multi-select, "All Projects" mode, Ctrl+N shortcuts
2. PageHeader V2 — project badge in breadcrumb, "All Projects" indicator
3. Backend: cross-project query support (`project_ids` array param on list/search endpoints)
4. Dashboard V2 — aggregate stats + project cards + cross-project activity
5. Lessons V2 — project column, cross-project search
6. Guardrails V2 — cross-project check, project column in rules
7. Review Inbox V2 — grouped by project, per-project batch actions
8. Analytics V2 — per-project comparison table + stacked charts
9. Graph Explorer V2 — enforce per-project, "All Projects" warning
10. Minor pages — project badge in header for remaining pages

### Phase 10: Multi-Format Ingestion (moved from Phase 9)
- PDF/DOCX/Image ingestion pipelines
- Document parsing and chunk extraction
- Lesson generation from uploaded documents

### Phase 11: Knowledge Portability (moved from Phase 10)
- Import/export exchange hub
- Cross-instance sync
