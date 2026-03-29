---
id: CH-T7-ARCHITECTURE
date: 2026-03-30
module: Phase7-Architecture-Refactor
phase: Phase 7
---

# Session Patch — 2026-03-30

## Where We Are
Phase: **Phase 7 M1–M6 implemented + Dashboard and Lessons pages built.** Architecture refactor complete. GUI has 15 shared components, full Lessons page, full Dashboard page. Remaining: Guardrails, Jobs, Projects, Generated Docs, Code Search, Graph Explorer, Settings, Model Providers, Chat pages.

## Completed This Session

### Phase M1–M2: Extract core/ and mcp/ from monolith
- `src/index.ts` reduced from 2379 → 86 lines
- `src/core/` — protocol-agnostic: auth, errors (ContextHubError), startup, barrel re-exports
- `src/mcp/` — 36 MCP tools + error boundary (ContextHubError → McpError)
- Centralized `dotenv.config()` in `env.ts` (fixes import-order timing)
- `getEnv()` memoization (parse once, cache for all calls)

### Phase M3: REST API
- `src/api/` — Express app on port 3001 with 17 endpoints
- Bearer token auth middleware, ContextHubError → HTTP status mapping
- Routes: lessons (offset pagination, sort, text search), guardrails, search, projects, git, jobs, generated-docs, system

### Phase M4: Docker
- `EXPOSE 3000 3001` in Dockerfile (both stages)
- `API_PORT` env var in docker-compose.yml (mcp + mcp-ca services)

### Phase M5: MCP Client Package
- `packages/mcp-client/` — standalone npm package (stdio → REST proxy)
- 8 tools, RestApiError → McpError mapping, health check on startup
- CLI: `npx @contexthub/mcp-client`

### Phase M6: Next.js GUI
- `gui/` — Next.js 16 App Router, dark zinc theme, Geist fonts
- **15 shared components**: DataTable (sortable, selectable, bulk ops, onHeaderClick), SlideOver, CommandPalette, Badge, Toast, Pagination, FilterPanel, FilterChips, EmptyState, LoadingSkeleton, ConfirmDialog, ErrorBanner, StatCard, PageHeader, SearchBar, Button
- **ProjectContext** provider + sidebar with health polling + collapsible

### Lessons Page (full implementation)
- Dual search: text (ILIKE substring) + semantic (vector search)
- Page-number pagination with jump-to-page (offset-based, backend + frontend)
- Sortable columns (created_at, title, type, status) with sort arrows
- Click-to-filter tags, filter panel dropdown (type + status)
- Active-only default with "Show all" toggle
- Bulk operations: checkbox select, archive, export JSON
- Density toggle: comfortable / compact
- Slide-over detail panel with status actions + "Open full page" link
- Add lesson dialog: Write/Preview tabs, tag input, guardrail-specific fields
- Backend: `listLessons` extended with offset, sort, order, q params + ILIKE wildcard escaping

### Dashboard Page (full implementation)
- 5 stat cards (clickable → navigate): Lessons, Commits, Generated Docs, Active Jobs
- Feature status grid: 9 subsystems with green/gray dots + model names
- Quick actions: Add Lesson, Ask AI, Re-index, Check Guardrail, Ingest Git
- Project summary section (collapsible, with Refresh)
- Generated documents grid: FAQ, RAPTOR, QC cards with type badges
- Two-column: Recent Lessons + Active Jobs (with animated running dots)
- Recent Commits with sha links
- Onboarding flow (3-step wizard) when project is empty
- Auto-refresh 60s (pauses when tab hidden, resumes on visibility)
- 6 parallel API calls via Promise.allSettled (graceful degradation)

### Design Documentation
- `docs/gui-design.md` — complete page & component design spec
- `docs/gui-wireframes.html` — interactive component wireframes (all 15 components)
- `docs/gui-lessons-wireframe.html` — interactive lessons page wireframe v2
- `docs/gui-dashboard-wireframe.html` — interactive dashboard wireframe v2
- Revised page map: 13 pages across Knowledge, Project, System groups
- Model Providers page design (provider CRUD + feature→model assignment)

### Review Fixes Applied
- **Backend**: SQL cursor path rewrite (removed dead code, fixed param indices), ILIKE escaping, removed base_url/uri leak from system/info
- **Frontend**: toast useRef pattern (prevents infinite re-render), relTime shared utility, FilterChips value-aware removal, DataTable onHeaderClick, AddLessonDialog backdrop fix, auto-refresh visibility optimization, initialLoad vs loading separation

## Next Steps

### Pages to implement (priority order)
1. **Guardrails** — filtered lessons table + test panel (reuses lessons components)
2. **Jobs** — DataTable + status tabs + polling
3. **Projects** — card layout + action buttons + git history
4. **Generated Docs** (`/knowledge/docs`) — FAQ/RAPTOR/QC viewer
5. **Code Search** (`/knowledge/search`) — tiered search UI
6. **Settings / Model Providers** (`/settings/models`) — provider CRUD + feature assignment
7. **Settings / System** (`/settings`) — feature flags, env summary
8. **Graph Explorer** (`/knowledge/graph`) — symbol search, dependency tracing (KG only)
9. **Chat** — AI streaming (requires AI SDK deps + POST /api/chat endpoint)

### Backend work needed for remaining pages
- `GET /api/kg/stats` — symbol/relationship counts
- `POST /api/kg/search-symbols`, `POST /api/kg/neighbors`, etc.
- Model provider CRUD: `model_providers` + `model_assignments` tables + 9 endpoints
- `POST /api/chat` — AI SDK streamText integration with LM Studio

## Open Blockers / Risks
- Migration files 0020-0028 from model testing should be squashed before release
- guardrail-superseded integration test fails when existing deploy guardrails in DB (data issue, not code)
- Chat page blocked on AI SDK dependency installation + chat endpoint
- Model Providers page blocked on new DB tables (migration needed)
