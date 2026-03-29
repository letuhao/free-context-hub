# GUI Implementation — Automation Workflow

## Purpose

Fully automated workflow to implement all remaining GUI pages. No human in the loop.
Each batch follows a strict pipeline with built-in review gates that catch issues
before they become code — the same mistakes we caught manually in Dashboard and Lessons.

## Roles

| Role | When | What they check |
|------|------|-----------------|
| **Solution Architect** | Batch planning | API coverage, data flow, service dependencies |
| **Product Owner** | After design, before code | Missing features, usability at scale, empty states, onboarding, enterprise needs |
| **Frontend Dev Lead** | After design, before code | Component reuse, state management, data fetching, import paths, Next.js conventions |
| **Backend Developer** | Implementation | Route wiring, SQL safety, error handling, param validation |
| **Frontend Developer** | Implementation | Page components, hooks, types, accessibility |
| **QC Engineer** | After implementation | Build verification, type check, review checklist |

## Pipeline Per Batch

```
┌─────────────────────────────────────────────────────────────┐
│                      BATCH PIPELINE                         │
│                                                             │
│  ┌──────────┐    ┌──────────┐    ┌──────────┐              │
│  │ 1. PLAN  │───▸│ 2. REVIEW│───▸│ 3. FIX   │              │
│  │ (Arch)   │    │ (PO+FEL) │    │ (Design) │              │
│  └──────────┘    └──────────┘    └──────────┘              │
│       │                               │                     │
│       │         ┌─────────────────────┘                     │
│       │         ▼                                           │
│  ┌──────────┐    ┌──────────┐    ┌──────────┐              │
│  │ 4. BUILD │───▸│ 5. REVIEW│───▸│ 6. FIX   │              │
│  │ (BE+FE)  │    │ (DevLead)│    │ (Code)   │              │
│  └──────────┘    └──────────┘    └──────────┘              │
│       │                               │                     │
│       │         ┌─────────────────────┘                     │
│       │         ▼                                           │
│  ┌──────────┐    ┌──────────┐    ┌──────────┐              │
│  │ 7. QC    │───▸│ 8. COMMIT│───▸│ 9. UPDATE│              │
│  │ (Verify) │    │ (Git)    │    │ (Session) │              │
│  └──────────┘    └──────────┘    └──────────┘              │
└─────────────────────────────────────────────────────────────┘
```

---

## Step Details

### Step 1: PLAN (Solution Architect)

**Input**: Page name from batch list + design doc + existing service code.

**Actions**:
1. Read the page spec from `docs/gui-design.md`
2. Identify all backend services needed (grep service functions)
3. Identify which API routes exist vs need creating
4. Identify which frontend components exist vs need creating
5. Write a mini-spec:

```markdown
### Batch N: [Page Name]

**Backend**:
- Route: `src/api/routes/[name].ts`
  - `GET /api/[path]` → service.function()
  - `POST /api/[path]` → service.function()
- New barrel exports needed: [list]
- API client additions: `gui/src/lib/api.ts` → [methods]

**Frontend**:
- Page: `gui/src/app/[route]/page.tsx`
- Sub-components: [list with purpose]
- Data fetching: [server vs client, polling needs]
- Shared components used: [DataTable, SlideOver, etc.]
- State: [URL params, context, local state]

**Interactions**:
- [list all user interactions and what they trigger]

**Empty state**: [what to show when no data]
**Error state**: [what to show on API failure]
```

### Step 2: REVIEW — Product Owner + Frontend Dev Lead

**PO checklist** (apply every review, based on mistakes we caught):

| # | Check | Why | Example from our history |
|---|-------|-----|------------------------|
| 1 | **Does the page show ALL features of the subsystem?** | Dashboard audit showed we missed FAQ, RAPTOR, KG, Builder Memory, etc. | Dashboard v1 missed 8 subsystems |
| 2 | **Does it work at scale (500+ items)?** | Lessons page v1 had prev/next only pagination | Added offset pagination + jump-to-page |
| 3 | **Is the default view filtered to what matters?** | Showing archived/superseded lessons by default adds noise | Default to active-only with "Show all" toggle |
| 4 | **Can users do bulk operations?** | Enterprise users with 500+ items need multi-select | Added checkbox + bulk archive/export |
| 5 | **Is there a clear empty state with CTA?** | Empty pages are confusing without guidance | Onboarding wizard on empty dashboard |
| 6 | **Are there enough quick actions / CTAs?** | Guardrails page v1 had no "Add Guardrail" button | Added CTA that opens pre-filled add dialog |
| 7 | **Can the page export its data?** | Enterprise audit/compliance need | Export JSON/CSV on lessons |
| 8 | **Do interactive elements give feedback?** | Actions without toast feel broken | Toast system for all mutations |
| 9 | **Does the page link to related pages?** | "View all" links, clickable tags, clickable stat cards | Tags filter, stat cards navigate |
| 10 | **Is there a search/filter mechanism?** | Large lists need narrowing | Dual search + filter panel |

**FE Dev Lead checklist** (apply every review, based on mistakes we caught):

| # | Check | Why | Example from our history |
|---|-------|-----|------------------------|
| 1 | **Is the Lesson type shared, not duplicated?** | Type drift across files | Extracted `types.ts` in lessons |
| 2 | **Does data fetching use the right pattern?** | Server Components for initial load, client for interaction | Dashboard uses client-only (correct for polling) |
| 3 | **Is `toast` accessed via `useRef` in `useCallback`?** | Direct dep causes infinite re-render | `toastRef.current` pattern |
| 4 | **Are column headers wired to `onHeaderClick`?** | Defined `handleSort` but never wired | DataTable `onHeaderClick` prop |
| 5 | **Does `FilterChips.onRemove` pass both label AND value?** | Multiple tags = same label, wrong one removed | `onRemove(label, value)` signature |
| 6 | **Do dialogs close on backdrop click?** | Inner absolute div intercepted clicks | `onClick={onClose}` on overlay div directly |
| 7 | **Are imports from `core/` barrel, not direct paths?** | Import path inconsistency | `../../core/index.js` not `../../utils/logger.js` |
| 8 | **Is auto-refresh paused when tab is hidden?** | Wastes API calls | `visibilitychange` listener |
| 9 | **Does skeleton only show on initial load?** | Re-fetch flashes entire page | `initialLoad` flag pattern |
| 10 | **Are utilities shared not duplicated?** | `relTime` was in two files | `lib/rel-time.ts` |
| 11 | **Does the backend escape ILIKE wildcards?** | SQL injection via `%` and `_` | `escapeIlike()` helper |
| 12 | **Does the backend avoid leaking internal config?** | `base_url`, `uri` in system/info | Removed from response |
| 13 | **Are API calls consolidated?** | Dashboard v1 had 9 calls, 3 redundant | Consolidated to 6 |

**Output**: Issue table (same format we've been using). Fix issues in Step 3.

### Step 3: FIX (Design)

Apply all issues from Step 2 to the mini-spec. Re-verify the checklist.
Only proceed to Step 4 when all checks pass.

### Step 4: BUILD (Backend + Frontend)

**Backend** (in order):
1. Add any new barrel exports to `src/core/index.ts`
2. Create/extend route file in `src/api/routes/`
3. Mount route in `src/api/index.ts`
4. Add methods to `gui/src/lib/api.ts`

**Frontend** (in order):
1. Create type file if page has its own types
2. Create sub-components (detail panel, dialogs, etc.)
3. Create main page component
4. Update sidebar if route structure changed

**Rules during build**:
- Import from `@/components/ui` barrel, never direct paths to ui/
- Import from `@/lib/api`, `@/lib/rel-time`, `@/lib/cn`
- Import from `../../core/index.js` in backend routes, never direct service paths
- Use `toastRef` pattern for any `useCallback` that calls toast
- Use `initialLoad` pattern for any page with auto-refresh
- Use `relTime()` from shared lib, never inline
- Every mutation shows a toast (success or error)
- Every list page has: empty state, loading skeleton, pagination (if >20 items)
- Every dialog has: ESC to close, backdrop click to close, disabled submit while loading

### Step 5: REVIEW — Dev Lead

**Code review checklist** (mechanical, apply to every file):

**Backend routes**:
- [ ] Route uses `resolveProjectIdOrThrow` for project_id
- [ ] All handlers wrapped in `try { } catch (e) { next(e); }`
- [ ] No raw SQL string interpolation (use parameterized queries — but routes don't write SQL, services do)
- [ ] `as any` only for query string union types, never for body validation
- [ ] Mounted in `src/api/index.ts` behind `bearerAuth`

**Frontend pages**:
- [ ] `"use client"` at top if any hooks/interactivity
- [ ] No unused imports
- [ ] Types not duplicated — shared types in `types.ts` or `@/components/ui`
- [ ] `useCallback` deps don't include unstable references (toast, router)
- [ ] Loading skeleton matches final layout shape
- [ ] Empty state has icon + title + description + CTA
- [ ] All `<a>` tags that navigate use `router.push` or `<Link>`, not `href`
- [ ] Clickable rows have `cursor-pointer` and hover state
- [ ] Keyboard: ESC closes panels, `/` focuses search (where applicable)

### Step 6: FIX (Code)

Apply all issues from Step 5. Run `tsc --noEmit` (backend) + `next build` (frontend) after fixes.

### Step 7: QC (Verify)

```bash
# Backend
cd /project && npx tsc --noEmit      # must be clean
cd /project && npm test               # must pass

# Frontend
cd /project/gui && npx next build    # must be clean

# Bonus: check for unused exports
grep -r "import.*from.*types" gui/src/app/  # verify type imports resolve
```

All three must pass. If any fails, go back to Step 6.

### Step 8: COMMIT

```bash
git add [specific files]
git commit -m "[descriptive message]

Co-Authored-By: Claude Opus 4.6 (1M context) <noreply@anthropic.com>"
```

One commit per batch. Commit message format:
- `Add [Page] page with [key features]`
- List backend changes, frontend changes, review fixes

### Step 9: UPDATE SESSION

Update `docs/sessions/SESSION_PATCH.md`:
- Mark page as done in "Where We Are"
- Add to "Completed This Session" with bullet points
- Update "Next Steps" to reflect remaining work

---

## Batch Execution Plan

### Pre-batch: Sidebar restructure

**What**: Update sidebar from flat 6 items to grouped navigation. Create all route directories.
**Backend**: None
**Frontend**: Update `sidebar.tsx`, create dirs + stub pages for all missing routes
**Commit**: `Restructure sidebar navigation and scaffold all page routes`

### Batch 1: Guardrails

**Backend**: Route already exists (only `POST /check`). No changes needed.
**Frontend**:
- Guardrails list (filtered lessons where `lesson_type=guardrail`)
- Test action panel at top
- "Add Guardrail" button → opens AddLessonDialog with `presetType="guardrail"`
- Reuses: DataTable, Badge, Button, PageHeader, EmptyState, Toast
**Commit**: `Add Guardrails page with test panel and filtered lesson list`

### Batch 2: Jobs

**Backend**: Add `POST /api/jobs/run-next` route (wires `runNextJob`).
**Frontend**:
- Status tabs: All / Running / Queued / Succeeded / Failed
- DataTable with JobStatusBadge (animated dots)
- Inline row expand for payload + error details
- Auto-refresh 5s for running/queued view
- Enqueue job dialog
- Reuses: DataTable, JobStatusBadge, PageHeader, EmptyState, Toast, Button
**Commit**: `Add Jobs page with status tabs, polling, and enqueue dialog`

### Batch 3: Projects + Git History + Sources

**Backend**: Extend `routes/git.ts` with:
- `GET /api/git/commits/:sha` → getCommit
- `POST /api/git/suggest-lessons` → suggestLessonsFromCommits
- `POST /api/git/analyze-impact` → analyzeCommitImpact
Add `routes/workspace.ts`:
- `POST /api/workspace/register` → registerWorkspaceRoot
- `GET /api/workspace/roots` → listWorkspaceRoots
- `POST /api/workspace/scan` → scanWorkspaceChanges
**Frontend**:
- `/projects` — Overview: project stats, summary, re-index/reflect/delete actions
- `/projects/git` — Git History: commit table, ingest action, suggest lessons from commits
- `/projects/sources` — Sources: configure project source, prepare repo, list workspace roots
- Reuses: PageHeader, DataTable, StatCard, Button, ConfirmDialog, Toast, EmptyState
**Commit**: `Add Projects pages (Overview, Git History, Sources) with full git intelligence`

### Batch 4: Generated Docs

**Backend**: Route already exists. No changes needed.
**Frontend**:
- `/knowledge/docs` — Doc list with type filter tabs (FAQ / RAPTOR / QC / All)
- Doc viewer: click row → SlideOver with rendered content
- Promote action button
- Reuses: DataTable, Badge, SlideOver, PageHeader, EmptyState, Toast, Button
**Commit**: `Add Generated Docs page with type tabs, viewer, and promote action`

### Batch 5: Code Search

**Backend**: Extend `routes/search.ts` with `POST /api/search/code` → searchCode (basic semantic).
**Frontend**:
- `/knowledge/search` — Search input + kind filter (source/test/doc/config/etc.)
- Results display: file path, snippet preview, relevance score, tier indicator
- Tiered results grouped: exact matches → glob → FTS → semantic
- Reuses: SearchBar, PageHeader, Badge, EmptyState
**Commit**: `Add Code Search page with tiered results and kind filter`

### Batch 6: Graph Explorer

**Backend**: Add `routes/kg.ts`:
- `POST /api/kg/search-symbols` → searchSymbols
- `POST /api/kg/neighbors` → getSymbolNeighbors
- `POST /api/kg/trace-path` → traceDependencyPath
- `POST /api/kg/lesson-impact` → getLessonImpact
**Frontend**:
- `/knowledge/graph` — Only shown when KG enabled (check system info)
- Symbol search bar
- Results: symbol list with type badges
- Click symbol → neighbors panel (expandable tree)
- Trace path: two symbol inputs → dependency chain
- Lesson impact: select lesson → shows affected symbols
- Reuses: SearchBar, PageHeader, SlideOver, Badge, EmptyState
**Commit**: `Add Graph Explorer page with symbol search, neighbors, and dependency tracing`

### Batch 7: Settings + Model Providers

**Backend**:
- Add DB migration `0029-model-providers.sql`:
  - `model_providers` table
  - `model_assignments` table
- Add `src/services/modelProviders.ts` — CRUD + test + detect models
- Add `routes/model-providers.ts` — 6 endpoints
- Add `routes/model-assignments.ts` — 3 endpoints
- Extend barrel exports
**Frontend**:
- `/settings` — System info page: feature flags grid, env config, server version
- `/settings/models` — Two tabs:
  - Tab 1: Provider cards (CRUD), test button, auto-detect models
  - Tab 2: Feature assignment table with dropdowns
- Reuses: PageHeader, DataTable, Button, Badge, Toast, ConfirmDialog, EmptyState
**Commit**: `Add Settings and Model Providers pages with provider CRUD and feature assignment`

### Post-batch: Final push

```bash
git push origin claude/stupefied-thompson
# Create PR or update existing PR #5
```

Update `SESSION_PATCH.md` with complete status.

---

## Checklist Reference Card (Quick Version)

Print this mentally before every review step:

### PO Quick Checks
1. Shows ALL subsystem features? (don't miss FAQ/RAPTOR/KG again)
2. Works at 500+ items? (pagination, not just prev/next)
3. Default filtered to useful view? (active-only, not all statuses)
4. Bulk operations available? (checkbox + bulk action bar)
5. Empty state with CTA? (not just blank page)
6. Export capability? (JSON/CSV for enterprise)
7. Cross-page links? (tags link, stat cards navigate, "View all →")

### FE Lead Quick Checks
1. Types shared not duplicated?
2. Toast via `useRef` in `useCallback`?
3. Sort headers wired to `onHeaderClick`?
4. FilterChips passes value?
5. Dialog backdrop click works?
6. Auto-refresh pauses on hidden tab?
7. Skeleton on initial load only?
8. Imports from barrel, not direct paths?
9. ILIKE escaped? API calls consolidated?

### Dev Quick Checks
1. `resolveProjectIdOrThrow` on all routes?
2. `try/catch/next` on all handlers?
3. No unused imports?
4. `"use client"` where needed?
5. `tsc --noEmit` clean? `next build` clean? `npm test` pass?

---

## Success Criteria

All batches complete when:
- [ ] 13 pages implemented (including Chat stub)
- [ ] Sidebar grouped: Knowledge / Project / System sections
- [ ] All backend routes wired to existing services
- [ ] `tsc --noEmit` clean
- [ ] `next build` clean (all pages prerender or client-render)
- [ ] `npm test` 4/4 pass
- [ ] `SESSION_PATCH.md` fully updated
- [ ] Single PR with all changes pushed
