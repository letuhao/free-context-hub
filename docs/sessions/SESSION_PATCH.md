---
id: CH-GUI-ENHANCEMENT-DRAFTS
date: 2026-04-04
module: GUI-Enhancement-Phase
phase: Draft Design Complete
---

# Session Patch — 2026-04-04

## Where We Are
Phase: **Phase 7 GUI Enhancement — draft design complete, implementation pending.**

The GUI has 14 functional pages + 15 shared components (from prior session). This session focused on designing enhancements through standalone HTML drafts before implementing in React.

## What Was Done This Session

### Docker / Infrastructure Fixes
- `Dockerfile`: Changed `npm ci` → `npm install` (package-lock.json is gitignored by design)
- `gui/Dockerfile`: Created multi-stage Next.js Dockerfile (deps → build → runner)
- `gui/next.config.ts`: Enabled `output: "standalone"` for Docker
- `docker-compose.yml`: Added `gui` service on port 3002
- Fixed Badge type error in `gui/src/app/projects/groups/page.tsx` (`<Badge>{x}</Badge>` → `<Badge value={x} />`)

### GUI Draft Design (docs/gui-drafts/)
Created comprehensive HTML draft references for all current and planned GUI features.

**v1 — Baseline (32 files):** Snapshot of all 15 components + 14 pages as standalone HTML

**v2 — UI Polish:**
- Replaced all emoji icons with Lucide SVG icons (18x18 stroke-based)
- Chat: markdown rendering, code blocks with syntax highlighting, message hover toolbars, tool call cards
- Dashboard: redesigned from 7 flat sections to 3 focused zones (overview strip, activity feed, quick start)
- Breadcrumbs on all 12 nested pages
- Sticky table headers, sort indicator arrows, enhanced pagination (page numbers + jump box)
- Modal/toast animations (slide-in, fade-in, backdrop blur)
- Empty state gradient rings

**v3 — Feature Enhancements:**
- NEW: Documents page (upload/link, viewer with in-doc search, generate lessons from docs)
- NEW: Activity & Notifications page (timeline feed, notification preferences)
- Lesson detail: center modal (was slide-over), edit mode, version history, AI improve, linked documents
- Chat: history sidebar, pinned messages, "Create Lesson from Answer" popover
- Dashboard: knowledge health score (72% ring), insights panel, suggested actions
- Guardrails: test presets, test history, "What Would Block?" mode
- Sidebar: notification bell, Documents nav, Activity nav
- Lessons: import/export, import dialog (JSON/CSV/Markdown), enhanced bulk edit
- Knowledge docs: center modal with in-document search and highlight

**v4 — Human-in-the-Loop & Collaboration:**
- NEW: Review Inbox (draft→review→active pipeline, card-based review, agent trust levels)
- NEW: Analytics (retrieval trends chart, dead knowledge, agent activity)
- NEW: Getting Started (guided onboarding learning path, progress tracker)
- NEW: Keyboard Shortcuts overlay (? key, 3-column grid, chord shortcuts)
- Lesson detail: AI-assisted editor (select chunks → Ask AI → diff view → per-chunk accept/reject → dirty indicator), comments/discussions (threaded + auto-review bot), feedback signals (thumbs up/down + retrieval count), bookmarks
- Lessons page: status tabs (Active/Draft-Pending/Superseded/Archived), feedback column, "created by" avatars, bookmarks filter
- Command palette: global search across lessons/docs/code/guardrails/commits
- Sidebar: Review Inbox badge, Analytics, Getting Started (53%), Bookmarks, shortcuts hint

### Documentation Updates
- `README.md`: Updated roadmap — Phase 7 detailed with functional vs enhancement checklist, design drafts reference
- `WHITEPAPER.md`: v0.2 → v0.3 — expanded vision (AI-to-Human bridge), detailed Phase 7 section with all planned enhancements, updated Phase 8-10 scope

## Final Inventory: docs/gui-drafts/
- **21 page drafts** (layout, dashboard, chat, lessons, guardrails, jobs, knowledge-docs, knowledge-graph, knowledge-search, projects-overview, projects-groups, projects-git, projects-sources, settings, settings-models, lesson-detail, documents, notifications, review-inbox, analytics, onboarding)
- **16 component drafts** (badge, button, data-table, command-palette, confirm-dialog, empty-state, error-banner, filter-chips, loading-skeleton, page-header, search-bar, slide-over, stat-card, toast, sidebar, keyboard-shortcuts)
- **index.html** — clickable catalog with v2/v3/v4 changelog

## Key Decisions
- **Drafts before code** — design all enhancements as HTML first, review with stakeholder, then implement in React
- **Center modal over slide-over** — for content-heavy views (lesson detail, FAQ/docs) because right-dock is too narrow
- **AI-assisted editing** — Cursor-style inline AI with per-chunk accept/reject, not all-or-nothing
- **Review pipeline** — AI-created lessons default to `draft`, human approval required (configurable trust levels per agent)
- **package-lock.json stays gitignored** — Dockerfile uses `npm install` instead of `npm ci`

## Next Steps
1. **Review drafts** — open `docs/gui-drafts/index.html` in browser, review all 37 files
2. **Prioritize implementation** — pick which enhancements to implement first (suggest: Lucide icons + review inbox + lesson editing)
3. **Install lucide-react** in gui/ package
4. **Implement enhancement batch 1** — icon system, breadcrumbs, sticky headers (low effort, high visual impact)
5. **Implement enhancement batch 2** — review inbox, lesson editing with AI assist (high effort, core value)
6. **Implement enhancement batch 3** — documents page, analytics, onboarding (medium effort, differentiation)

## Prior Session Context
- Phase 7 GUI: 14/14 core pages complete
- Multi-repo project groups: fully implemented
- Open: Model Providers backend, KG routes, integration testing
