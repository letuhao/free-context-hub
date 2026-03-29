# ContextHub GUI — Page & Component Design

## Design Philosophy

**Progressive disclosure**: every page has a clean default view that works immediately. Advanced controls are discoverable but never in the way. An intern browsing lessons sees a clean table. A staff engineer tuning guardrails gets full control without switching tools.

**Keyboard-first, mouse-friendly**: global shortcuts, command palette, inline actions. Never require mouse-only workflows.

**Information density**: enterprise users work with hundreds of lessons across dozens of projects. The UI must handle scale — virtualized lists, efficient pagination, compact-but-readable rows.

**Zero-to-value onboarding**: first-run experience guides users from empty project to indexed, searchable knowledge in under 2 minutes.

---

## State Management

- **`ProjectContext`** — React context providing active `project_id`. Set by sidebar project selector, consumed by all pages. Persisted to `localStorage`. Hydrated from `DEFAULT_PROJECT_ID` on first load.
- **URL state** (`useSearchParams`) — filters, pagination cursors, search queries. Single source of truth for shareable/bookmarkable views.
- **No global store** — project context + URL state covers all cases. No Redux/Zustand needed.

## API Client Architecture

- **`lib/api-server.ts`** — server-side client for Server Components. Reads `CONTEXTHUB_API_URL` (non-public env var). Supports Next.js `cache`/`revalidate`. Used for initial page loads, dashboard stats.
- **`lib/api-client.ts`** — client-side client for Client Components. Reads `NEXT_PUBLIC_CONTEXTHUB_API_URL`. Used for search, filters, pagination, mutations.
- Both share the same endpoint signatures, just different `fetch` contexts.

## Next.js File Conventions

```
/app/
  layout.tsx             ← ProjectContext provider, sidebar
  page.tsx               ← Dashboard (server component, parallel fetches)
  lessons/
    page.tsx             ← Client component (search + filters + table)
    [id]/page.tsx        ← Full lesson detail (server component)
    loading.tsx          ← Skeleton
    error.tsx            ← Error boundary
  chat/
    page.tsx             ← Client component (useChat)
  guardrails/
    page.tsx             ← Mixed: server list + client test panel
    loading.tsx
  projects/
    page.tsx             ← Server component + client action buttons
    loading.tsx
  jobs/
    page.tsx             ← Client component (polling + tabs)
    loading.tsx
```

## Toast / Notification System

All mutations (re-index, add lesson, status change, job enqueue) show feedback via toast notifications:
- **Success**: auto-dismiss after 5s. "Lesson added successfully."
- **Error**: persist until dismissed. "[Action] failed — [error]. [Retry]" button.
- **In-progress**: shown for long operations (indexing). "Indexing project... [View Job]"

---

## Global Shell

### Layout
```
┌──────────────────────────────────────────────────────┐
│ Sidebar (w-56, collapsible)  │  Page Content          │
│                              │                        │
│  ContextHub                  │  ┌─ Page Header ─────┐ │
│  [project selector ▾]       │  │ Title + Actions    │ │
│                              │  └───────────────────┘ │
│  Dashboard                   │                        │
│  Chat                        │  ┌─ Page Body ──────┐ │
│  Lessons                     │  │                   │ │
│  Guardrails                  │  │                   │ │
│  Projects                    │  │                   │ │
│  Jobs                        │  │                   │ │
│                              │  └───────────────────┘ │
│                              │                        │
│  ── bottom ──                │                        │
│  System Health ●             │                        │
│  Settings ⚙                  │                        │
└──────────────────────────────────────────────────────┘
```

### Sidebar
- **Project selector** (top): dropdown with search. Sets the active `project_id` for all pages. Persisted in `localStorage`. Shows `DEFAULT_PROJECT_ID` initially.
- **Nav items**: icon + label. Active state: zinc-800 bg. Collapsed state: icons only (w-14).
- **Collapse toggle**: bottom of sidebar, `Ctrl+B` shortcut.
- **Health indicator**: bottom dot — green (API reachable), red (unreachable). Polls `/api/system/health` every 30s.
- **Keyboard**: `Ctrl+K` opens command palette (search all pages, lessons, actions).

### Page Header Pattern
Every page uses a consistent header:
```
┌─────────────────────────────────────────────────┐
│ [Breadcrumb if nested]                          │
│ Page Title                         [Actions...] │
│ Optional subtitle / description                 │
└─────────────────────────────────────────────────┘
```

### Command Palette (`Ctrl+K`)
- Search across: pages, lessons (by title), guardrails, recent jobs.
- Actions: "Add lesson", "Check guardrail", "Re-index project".
- Recent commands section.

---

## Page 1: Dashboard (`/`)

### Purpose
At-a-glance project health. The first thing you see — answers "is everything working?" in 2 seconds.

### Layout
```
┌──────────────────────────────────────────────────┐
│ Dashboard                                        │
│                                                  │
│ ┌──────┐ ┌──────┐ ┌──────┐ ┌──────┐            │
│ │ 142  │ │  8   │ │  23  │ │  3   │            │
│ │Lessons│ │Guard-│ │Commits│ │ Jobs │            │
│ │      │ │rails │ │      │ │queued│            │
│ └──────┘ └──────┘ └──────┘ └──────┘            │
│                                                  │
│ ┌─ Project Summary ──────────────────────────┐  │
│ │ (rendered markdown from get_project_summary)│  │
│ │ Collapsible, default expanded              │  │
│ └────────────────────────────────────────────┘  │
│                                                  │
│ ┌─ Recent Lessons ───────┐ ┌─ Active Jobs ──┐  │
│ │ Last 5 lessons added   │ │ Running/queued  │  │
│ │ Click → /lessons/:id   │ │ Click → /jobs   │  │
│ └────────────────────────┘ └────────────────┘  │
└──────────────────────────────────────────────────┘
```

### Data Sources
- Stats cards: `GET /api/lessons?limit=0` (total_count), `GET /api/jobs?status=queued`
- Summary: `GET /api/projects/:id/summary`
- Recent lessons: `GET /api/lessons?limit=5`
- Active jobs: `GET /api/jobs?status=running&limit=5` + `?status=queued&limit=5`

### Interactions
- Stats cards are clickable → navigate to relevant page.
- Summary has a "Refresh" action → `POST /api/projects/:id/reflect`.
- Auto-refresh: every 60s (configurable).

### First-Run / Empty State
When all stats are zero, replace the dashboard with an onboarding flow:
```
┌──────────────────────────────────────────────────┐
│                                                  │
│       Welcome to ContextHub                      │
│                                                  │
│  Get started in 3 steps:                         │
│                                                  │
│  ① Index your project                           │
│     Point to your repo and we'll index the code  │
│     [Index Project →]                            │
│                                                  │
│  ② Add your first lesson                        │
│     Record a decision, workaround, or guardrail  │
│     [Add Lesson →]                               │
│                                                  │
│  ③ Try the AI chat                              │
│     Ask questions about your project knowledge   │
│     [Open Chat →]                                │
│                                                  │
└──────────────────────────────────────────────────┘
```
Shown only when lessons count = 0 AND indexed files = 0. Dismissed permanently once any step is completed.

---

## Page 2: Lessons (`/lessons`)

### Purpose
The power page. Browse, search, filter, add, and manage all lessons. Must handle 1000+ lessons efficiently.

### Layout — Default View
```
┌──────────────────────────────────────────────────┐
│ Lessons                              [+ Add]     │
│                                                  │
│ ┌─ Search Bar ──────────────────────────────┐   │
│ │ 🔍 Search lessons...          [Filters ▾] │   │
│ └────────────────────────────────────────────┘   │
│                                                  │
│ ┌─ Filter Chips (visible when active) ──────┐   │
│ │ Type: decision ✕  Status: active ✕        │   │
│ └────────────────────────────────────────────┘   │
│                                                  │
│ ┌─ Table ────────────────────────────────────┐  │
│ │ Title          Type       Status  Tags  ▸  │  │
│ │─────────────────────────────────────────────│  │
│ │ Use pgvector.. decision   active  db,pg    │  │
│ │ Never force-.. guardrail  active  git      │  │
│ │ Redis cache..  workaround active  cache    │  │
│ │ ...                                        │  │
│ └────────────────────────────────────────────┘  │
│                                                  │
│ Showing 1-20 of 142          [← Prev] [Next →]  │
└──────────────────────────────────────────────────┘
```

### Search Behavior
- **Instant text search** (debounced 300ms): calls `POST /api/lessons/search` with semantic search.
- **Empty search**: shows `GET /api/lessons` (paginated list).
- Search mode indicated visually: "Showing search results" vs "Showing all lessons".

### Filters (Dropdown Panel)
```
┌─ Filters ────────────────────┐
│ Type:                        │
│ ○ All  ○ decision            │
│ ○ preference  ○ guardrail    │
│ ○ workaround  ○ general_note │
│                              │
│ Status:                      │
│ ○ All  ○ active  ○ draft     │
│ ○ superseded  ○ archived     │
│                              │
│ Tags: [tag input w/ suggest] │
│                              │
│ [Clear All]     [Apply]      │
└──────────────────────────────┘
```
- Active filters shown as dismissible chips above the table.
- Filters applied to both list and search modes.
- URL query params: `/lessons?type=decision&status=active` (shareable links).

### Table
- **Columns**: Checkbox, Title, Type (badge), Status (badge), Tags (chips, max 3 + "+N"), Created (relative time).
- **Row click**: opens detail panel (slide-over from right). Detail has "Open full page" link → `/lessons/[id]`.
- **Row actions** (three-dot menu or hover): Edit status, Archive, Copy ID.
- **Sorting**: by created date (default desc), by title. Server-side via API.
- **Pagination**: cursor-based (API returns `next_cursor`). Show "Page N of ~M".

### Bulk Operations
When rows are selected, a bulk action bar appears above the table:
```
┌─ 12 selected ──────────────── [Deselect All] ──┐
│ [Archive]  [Change Status ▾]  [Export JSON]     │
└─────────────────────────────────────────────────┘
```
- **Select all**: checkbox in header selects visible page. "Select all N matching" link for cross-page.
- **Export**: downloads selected lessons as JSON or CSV. Also available as page-level action (exports all/filtered).
- **Change Status**: dropdown → applies to all selected.

### Detail Panel (Slide-over)
```
┌─ Lesson Detail ────────────────── [✕] │
│                                        │
│ Use pgvector for all embeddings        │
│ Type: decision    Status: active       │
│ Tags: database, postgres, embeddings   │
│ Created: 2026-03-15 by claude-code     │
│ ID: abc-123-def                        │
│                                        │
│ ── Content ──────────────────────────  │
│ We chose pgvector over Pinecone        │
│ because self-hosted, zero egress       │
│ cost, and lives next to the data...    │
│                                        │
│ ── Source Refs ──────────────────────  │
│ src/db/client.ts:42                    │
│ docs/adr/003-embedding-store.md        │
│                                        │
│ ── Actions ──────────────────────────  │
│ [Mark Superseded]  [Archive]  [Copy]   │
└────────────────────────────────────────┘
```
- Content rendered as markdown.
- Status changes use `PATCH /api/lessons/:id/status`.
- "Copy" copies lesson as JSON to clipboard.

### Add Lesson Dialog
```
┌─ Add Lesson ──────────────────── [✕] │
│                                       │
│ Title:    [________________________]  │
│ Type:     [decision ▾]               │
│ Content:  [________________________]  │
│           [________________________]  │
│           [________________________]  │
│ Tags:     [db] [postgres] [+ add]    │
│                                       │
│ ▸ Advanced                            │
│   Source refs: [__________________]   │
│   Captured by: [__________________]  │
│   Guardrail rule:                     │
│     Trigger: [____________________]   │
│     Requirement: [________________]   │
│     Verification: [user_confirm.. ▾]  │
│                                       │
│              [Cancel]  [Add Lesson]   │
└───────────────────────────────────────┘
```
- "Advanced" section collapsed by default (progressive disclosure).
- Guardrail fields only shown when `type = guardrail`.
- Tags: autocomplete from existing tags in the project.

---

## Page 3: Chat (`/chat`)

### Purpose
Interactive knowledge Q&A. Users ask questions in natural language, the AI searches lessons/code and answers with citations.

### Layout
```
┌──────────────────────────────────────────────────┐
│ Chat                                             │
│                                                  │
│ ┌─ Conversation ────────────────────────────┐   │
│ │                                            │   │
│ │  🤖 Welcome! Ask me anything about this   │   │
│ │     project's knowledge base.              │   │
│ │                                            │   │
│ │  👤 What database conventions do we use?   │   │
│ │                                            │   │
│ │  🤖 [Searching lessons...]                │   │
│ │     Based on the project's decisions:      │   │
│ │     1. Use pgvector for all embeddings...  │   │
│ │     2. PostgreSQL as primary store...      │   │
│ │                                            │   │
│ │     📎 Sources: "Use pgvector...",         │   │
│ │        "PostgreSQL schema conventions"     │   │
│ │                                            │   │
│ └────────────────────────────────────────────┘   │
│                                                  │
│ ┌─ Input ───────────────────────────────────┐   │
│ │ Ask about this project...        [Send ↵] │   │
│ └────────────────────────────────────────────┘   │
└──────────────────────────────────────────────────┘
```

### Empty State — Suggested Prompts
When chat has no messages, show clickable prompt chips below the welcome message:
- "What are our key architectural decisions?"
- "Show recent workarounds"
- "Can I deploy to production?"
- "Summarize project conventions"
Clicking a chip sends it as the first message.

### Technical Notes (for later implementation)
- Backend: `POST /api/chat` with AI SDK `streamText` → SSE.
- Frontend: `useChat` hook + streaming message components.
- Model: LM Studio local (qwen2.5-coder-7b-instruct via OpenAI-compatible API).
- Tools available to the AI: `search_lessons`, `check_guardrails`, `search_code`.
- Tool calls shown inline (collapsible) — user sees what the AI searched.
- Chat history is session-only (no persistence in v1).

---

## Page 4: Guardrails (`/guardrails`)

### Purpose
View enforced guardrails and test actions against them. Safety-critical — make violations visually obvious.

### Layout
```
┌──────────────────────────────────────────────────┐
│ Guardrails                     [+ Add Guardrail] │
│                                                  │
│ ┌─ Test Action ─────────────────────────────┐   │
│ │ Describe an action to check:              │   │
│ │ [git push --force to main___]  [Check ▶]  │   │
│ │                                            │   │
│ │ Result: ❌ BLOCKED                         │   │
│ │ Rule: "Never force-push to main"          │   │
│ │ Requirement: Use PR workflow instead       │   │
│ └────────────────────────────────────────────┘   │
│                                                  │
│ ┌─ Active Guardrails ───────────────────────┐   │
│ │ Trigger              Requirement     Verif │   │
│ │──────────────────────────────────────────  │   │
│ │ force push to main   Use PR workflow  user │   │
│ │ DROP TABLE           Require backup   cli  │   │
│ │ deploy to prod       Run tests first  test │   │
│ │ schema migration     Review + backup  user │   │
│ └────────────────────────────────────────────┘   │
└──────────────────────────────────────────────────┘
```

### Interactions
- **Test panel** at the top: type an action description, hit Check. Shows pass/fail with matched rule details.
- **Add Guardrail**: opens the Add Lesson dialog pre-filled with `type=guardrail`. No need to navigate to /lessons.
- **Guardrail list**: all guardrails from `GET /api/lessons?lesson_type=guardrail`.
- **Click a guardrail row** → opens lesson detail panel (same as /lessons).
- Result styling: green checkmark + "PASSED" or red X + "BLOCKED" with rule explanation.

---

## Page 5: Projects (`/projects`)

### Purpose
Project configuration, indexing controls, and workspace management. Less frequently visited — admin surface.

### Layout
```
┌──────────────────────────────────────────────────┐
│ Projects                                         │
│                                                  │
│ ┌─ Current Project ─────────────────────────┐   │
│ │ free-context-hub                           │   │
│ │                                            │   │
│ │ Indexed files: 847    Chunks: 3,201       │   │
│ │ Lessons: 142          Guardrails: 8        │   │
│ │ Last indexed: 2h ago                       │   │
│ │                                            │   │
│ │ [Re-index ↻]  [Reflect 💭]  [Delete ⚠]   │   │
│ └────────────────────────────────────────────┘   │
│                                                  │
│ ┌─ Git History ─────────────────────────────┐   │
│ │ Recent commits (from ingest)               │   │
│ │ abc1234  Fix auth middleware     2h ago    │   │
│ │ def5678  Add rate limiting       1d ago    │   │
│ │ ...                                        │   │
│ │ [Ingest New Commits]                       │   │
│ └────────────────────────────────────────────┘   │
│                                                  │
│ ▸ Danger Zone                                    │
│   [Delete Workspace] — removes all data          │
└──────────────────────────────────────────────────┘
```

### Interactions
- **Re-index**: `POST /api/projects/:id/index`. Shows progress (polling job status).
- **Reflect**: `POST /api/projects/:id/reflect`. Shows AI reflection result.
- **Ingest**: `POST /api/git/ingest`. Shows ingested commit count.
- **Delete**: confirmation dialog with project name re-type. `DELETE /api/projects/:id`.
- **Danger Zone**: collapsed by default. Red-bordered section.

---

## Page 6: Jobs (`/jobs`)

### Purpose
Monitor async job queue. Shows what's running, what's queued, what failed.

### Layout
```
┌──────────────────────────────────────────────────┐
│ Jobs                           [+ Enqueue Job]   │
│                                                  │
│ ┌─ Status Tabs ─────────────────────────────┐   │
│ │ All (47)  Running (2)  Queued (3)         │   │
│ │ Succeeded (39)  Failed (3)                │   │
│ └────────────────────────────────────────────┘   │
│                                                  │
│ ┌─ Table ────────────────────────────────────┐  │
│ │ Job ID    Type           Status    Age     │  │
│ │──────────────────────────────────────────── │  │
│ │ a1b2..   index_project  ● running  2m     │  │
│ │ c3d4..   build_faq      ● running  5m     │  │
│ │ e5f6..   ingest_git     ○ queued   1m     │  │
│ │ g7h8..   reflect        ✓ done     10m    │  │
│ │ i9j0..   index_project  ✕ failed   1h     │  │
│ └────────────────────────────────────────────┘  │
│                                                  │
│ Showing 1-20 of 47          [← Prev] [Next →]   │
└──────────────────────────────────────────────────┘
```

### Status Badges
- `running` — blue pulsing dot
- `queued` — zinc/gray hollow dot
- `succeeded` — green checkmark
- `failed` — red X
- `dead_letter` — red skull (hover shows error message)

### Interactions
- **Status tabs**: filter by status. Counts in tab labels.
- **Row click**: expands inline to show payload JSON + error details (if failed).
- **Auto-refresh**: running/queued view refreshes every 5s.
- **Enqueue dialog**: select job type from dropdown, configure payload (JSON editor for advanced, form for common types).

### Enqueue Dialog
```
┌─ Enqueue Job ─────────────────── [✕] │
│                                       │
│ Job Type: [index_project ▾]           │
│                                       │
│ ── Parameters ──                      │
│ root: [/path/to/project____]          │
│                                       │
│ ▸ Advanced                            │
│   Queue: [default__________]          │
│   Max attempts: [3]                   │
│   Raw payload: { JSON editor }        │
│                                       │
│              [Cancel]  [Enqueue]      │
└───────────────────────────────────────┘
```

---

## Shared Components

| Component | Used In | Notes |
|-----------|---------|-------|
| `PageHeader` | All pages | Title, subtitle, action buttons |
| `DataTable` | Lessons, Jobs, Git commits | Sortable, paginated, row actions |
| `SlideOver` | Lesson detail, Job detail | Right-side panel, ESC to close |
| `FilterPanel` | Lessons, Jobs | Dropdown panel with filter controls |
| `FilterChips` | Lessons, Jobs | Active filter badges, dismissible |
| `Badge` | Everywhere | Type/status badges with color coding |
| `StatCard` | Dashboard | Number + label + optional trend |
| `CommandPalette` | Global | `Ctrl+K`, search everything |
| `ProjectSelector` | Sidebar | Dropdown with project search |
| `ConfirmDialog` | Delete actions | Type-to-confirm for destructive ops |
| `JsonViewer` | Job detail, Advanced views | Collapsible, syntax-highlighted |
| `MarkdownRenderer` | Lesson content, Project summary, Chat | Rendered markdown with code blocks |
| `EmptyState` | All pages | Illustration + message + CTA |
| `LoadingSkeleton` | All pages | Shimmer placeholders matching layout |
| `ErrorBanner` | All pages | Dismissible error bar at top of page |

---

## Keyboard Shortcuts

| Shortcut | Action | Scope |
|----------|--------|-------|
| `Ctrl+K` | Command palette | Global |
| `Ctrl+B` | Toggle sidebar | Global |
| `Ctrl+N` | New lesson | Lessons page |
| `/` | Focus search | Lessons, Jobs |
| `Esc` | Close panel/dialog | Any open panel |
| `J` / `K` | Navigate rows | Tables (vim-style) |
| `Enter` | Open selected row | Tables |
| `?` | Show shortcuts help | Global |

---

## Responsive Behavior

| Breakpoint | Behavior |
|-----------|----------|
| `≥1280px` (xl) | Full layout: sidebar + content |
| `768-1279px` (md) | Collapsed sidebar (icons only), full content |
| `<768px` (sm) | Hidden sidebar, hamburger menu, stacked content |

---

## Color System

| Element | Color | Tailwind |
|---------|-------|----------|
| Background | Near-black | `zinc-950` |
| Surface (cards) | Dark gray | `zinc-900` |
| Border | Subtle | `zinc-800` |
| Text primary | White | `zinc-100` |
| Text secondary | Gray | `zinc-400` |
| Text muted | Dark gray | `zinc-500` |
| Accent (active nav, links) | Blue | `blue-500` |
| Success (pass, done) | Green | `emerald-500` |
| Error (fail, blocked) | Red | `red-500` |
| Warning | Amber | `amber-500` |
| Badge: decision | Blue | `blue-500/10` text `blue-400` |
| Badge: guardrail | Red | `red-500/10` text `red-400` |
| Badge: workaround | Amber | `amber-500/10` text `amber-400` |
| Badge: preference | Purple | `purple-500/10` text `purple-400` |
| Badge: general_note | Zinc | `zinc-700` text `zinc-300` |

---

## Data Fetching Strategy

| Pattern | When | How |
|---------|------|-----|
| **Server fetch** | Dashboard stats, initial page load | Server Components with `fetch()` |
| **Client fetch** | Search, filters, pagination, actions | `useEffect` + `api.*` client |
| **Polling** | Jobs (running), Health | `setInterval` in client component |
| **Optimistic** | Status changes, add lesson | Update UI immediately, rollback on error |
| **Cache** | Project summary, stats | `revalidate: 60` on server fetches |

---

## Error Handling

| Scenario | Behavior |
|----------|----------|
| API unreachable | Red banner: "Cannot connect to ContextHub API". Health dot → red. All data sections show last cached state or empty state. |
| 401 Unauthorized | Red banner: "Authentication failed — check your API token". |
| Network error mid-operation | Toast: "Action failed — [error]. [Retry]" button. |
| Empty data | Friendly empty state per page: illustration + "No lessons yet" + CTA button. |
| Slow response (>3s) | Loading skeleton shown immediately. No spinner — skeletons match final layout shape. |

---

## v2 Backlog (Deferred)

These features are out of scope for v1 but are acknowledged and planned:

| Feature | Rationale |
|---------|-----------|
| **Activity log / audit trail** | Enterprise need — who changed what, when. Requires backend schema (audit events table). |
| **Job cancellation** | API doesn't support cancelling running jobs yet. Add `DELETE /api/jobs/:id` first. |
| **Chat persistence** | Save chat history per project. Requires new DB table + endpoints. |
| **Lesson import** | Bulk import from JSON/CSV. Complements export. |
| **Multi-project dashboard** | Cross-project stats view for teams managing multiple repos. |
| **Dark/light mode toggle** | Currently dark-only. Add theme toggle in sidebar settings. |
| **Webhook notifications** | Notify Slack/Teams on guardrail violations or job failures. |
