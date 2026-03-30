# Multi-Repo Project Groups — Automation Workflow

## Purpose

Fully automated workflow to implement project groups + multi-project search.
No human in the loop. Each batch follows the same proven pipeline from the GUI workflow
with built-in review gates from all 4 roles.

## Design Decision

**Groups, not trees.** Users decide which repos share knowledge with each other.
No forced global hierarchy — a project can belong to multiple groups or none.

```
┌─────────────────────────────────────────────────────┐
│  Group: "order-payment-team"                        │
│  Members: order-api, payment-gateway                │
│  → Shared lessons about API contracts, retry logic  │
├─────────────────────────────────────────────────────┤
│  Group: "all-backend"                               │
│  Members: order-api, payment-gw, inventory-api      │
│  → Shared guardrails: logging, auth, deploy rules   │
├─────────────────────────────────────────────────────┤
│  order-api (solo)                                   │
│  → Only its own lessons, no shared knowledge        │
└─────────────────────────────────────────────────────┘
```

**Search modes**:
- `search_lessons(project_id: "order-api")` — just this repo
- `search_lessons(project_id: "order-api", include_groups: true)` — this repo + all its groups
- `search_lessons(group_id: "order-payment-team")` — just the group's shared knowledge
- `search_lessons(project_ids: ["order-api", "payment-gw"])` — explicit multi-project

## Roles

| Role | When | What they check |
|------|------|-----------------|
| **Solution Architect** | Batch planning | Schema design, data flow, service deps, migration safety |
| **Product Owner** | After design, before code | Feature completeness, search UX, group management UX |
| **Frontend Dev Lead** | After design, before code | Component reuse, state management, Next.js conventions |
| **Backend Dev Lead** | After design, before code | SQL safety, API design, performance, backwards compat |
| **QC Engineer** | After implementation | Build verification, type check, review checklist |

## Pipeline Per Batch

```
┌─────────────────────────────────────────────────────────────┐
│                      BATCH PIPELINE                         │
│                                                             │
│  ┌──────────┐    ┌──────────┐    ┌──────────┐              │
│  │ 1. PLAN  │───▸│ 2. REVIEW│───▸│ 3. FIX   │              │
│  │ (Arch)   │    │ (All 4)  │    │ (Design) │              │
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

**Input**: Batch spec below + existing service code + migration history.

**Actions**:
1. Read existing schema (`migrations/`) and service code (`src/services/`, `src/api/routes/`)
2. Identify what exists vs what needs creating
3. Identify backwards compatibility risks
4. Write a mini-spec:

```markdown
### Batch N: [Feature Name]

**Migration**:
- File: `migrations/00XX_[name].sql`
- Tables/columns: [exact DDL]
- Backwards compat: [nullable? default? existing data impact?]

**Backend**:
- Service: `src/services/[name].ts` → [functions]
- Route: `src/api/routes/[name].ts`
  - `GET /api/[path]` → service.function()
  - `POST /api/[path]` → service.function()
- MCP tool changes: `src/mcp/index.ts` → [params added]
- Barrel exports: `src/core/index.ts` → [additions]
- API client: `gui/src/lib/api.ts` → [methods]

**Frontend** (if applicable):
- Page: `gui/src/app/[route]/page.tsx`
- Components: [list]
- Context changes: [list]

**Performance**:
- [SQL query strategy, index usage, expected latency]

**Backwards compat**:
- [What stays the same, what's additive]
```

### Step 2: REVIEW (All 4 Roles)

**Solution Architect checklist**:

| # | Check | Why |
|---|-------|-----|
| 1 | Migration is additive (no DROP, no NOT NULL without DEFAULT)? | Existing data must survive |
| 2 | New indexes cover the query patterns? | `ANY()` queries need proper indexes |
| 3 | Foreign keys have ON DELETE behavior defined? | Group deletion must handle members |
| 4 | Service function signatures match MCP + REST needs? | Avoid adapter layers |

**Product Owner checklist**:

| # | Check | Why |
|---|-------|-----|
| 1 | Can user search just one project (no groups)? | Must work exactly like today |
| 2 | Can user search one project + its groups? | The main use case |
| 3 | Can user search a group directly? | For shared knowledge management |
| 4 | Can user create/delete groups without breaking existing projects? | Groups are optional |
| 5 | Are search results attributed (which project/group)? | Users need to know where knowledge came from |
| 6 | Is there an empty state for "no groups yet"? | Onboarding for new users |
| 7 | Can a project belong to multiple groups? | Key requirement — not a tree |

**Backend Dev Lead checklist**:

| # | Check | Why |
|---|-------|-----|
| 1 | `WHERE project_id = ANY($1::text[])` not string interpolation? | SQL injection prevention |
| 2 | Rerank budget scales with total lessons across all projects? | Avoid over/under-ranking |
| 3 | Single embedding computation, not per-project? | Performance — embedding is the expensive part |
| 4 | Single SQL query with UNION or ANY, not N sequential queries? | Latency must stay under 1.5x |
| 5 | `resolveProjectIdOrThrow` still works for single project? | Backwards compat |
| 6 | New endpoints behind `bearerAuth` middleware? | Auth consistency |
| 7 | Group member count bounded (max 50 projects per group)? | Prevent unbounded IN-list |

**Frontend Dev Lead checklist**:

| # | Check | Why |
|---|-------|-----|
| 1 | Project context expansion is backwards compatible? | Existing pages must not break |
| 2 | Group selector doesn't break single-project workflow? | Groups are optional |
| 3 | Types shared in `types.ts`, not duplicated? | Consistency |
| 4 | Toast via `useRef` pattern? | Prevent infinite re-render |
| 5 | Next.js conventions followed (read `gui/AGENTS.md`)? | Breaking changes in Next.js 15+ |
| 6 | Color-coding for group badges consistent? | Visual clarity |

**Output**: Issue table. Fix in Step 3.

### Step 3: FIX (Design)

Apply all issues from Step 2 to the mini-spec. Re-verify all checklists.
Only proceed to Step 4 when all checks pass.

### Step 4: BUILD (Backend + Frontend)

**Backend** (in order):
1. Run migration SQL
2. Add service functions in `src/services/`
3. Add/extend routes in `src/api/routes/`
4. Mount new routes in `src/api/index.ts` behind `bearerAuth`
5. Add barrel exports to `src/core/index.ts`
6. Register/update MCP tools in `src/mcp/index.ts`
7. Add methods to `gui/src/lib/api.ts`

**Frontend** (in order):
1. Update types if needed
2. Update context provider if needed
3. Create/update components
4. Create/update pages
5. Update sidebar if navigation changed

**Rules during build**:
- All SQL uses parameterized queries, never string interpolation
- New MCP tool params are `optional()` with `.describe()` — backwards compat
- Import from `../../core/index.js` in backend routes
- Import from `@/components/ui` barrel in frontend
- `toastRef` pattern for `useCallback` that calls toast
- `initialLoad` pattern for pages with auto-refresh
- Every mutation shows a toast
- Every list page has: empty state, loading skeleton, pagination

### Step 5: REVIEW — Dev Lead

**Backend routes**:
- [ ] `resolveProjectIdOrThrow` on all routes
- [ ] `try/catch/next` on all handlers
- [ ] No raw SQL string interpolation
- [ ] Mounted in `src/api/index.ts` behind `bearerAuth`
- [ ] MCP tool schema matches REST body schema
- [ ] `project_id` (singular) still works alone — backwards compat

**Frontend pages**:
- [ ] `"use client"` at top if hooks used
- [ ] No unused imports
- [ ] Types not duplicated
- [ ] Loading skeleton on initial load only
- [ ] Empty state with CTA
- [ ] Group badges color-coded consistently

### Step 6: FIX (Code)

Apply all issues from Step 5. Run `tsc --noEmit` + `next build` after fixes.

### Step 7: QC (Verify)

```bash
# Backend
cd /project && npx tsc --noEmit      # must be clean
cd /project && npm test               # must pass

# Frontend
cd /project/gui && npx next build    # must be clean

# Migration test
# Verify migration applies cleanly on existing DB with data
```

All must pass. If any fails, go back to Step 6.

### Step 8: COMMIT

```bash
git add [specific files]
git commit -m "[descriptive message]

Co-Authored-By: Claude Opus 4.6 (1M context) <noreply@anthropic.com>"
```

One commit per batch.

### Step 9: UPDATE SESSION

Update `docs/sessions/SESSION_PATCH.md`:
- Mark batch as done
- Update "Next Steps" to reflect remaining work

---

## Batch Execution Plan

### Batch 1: Schema + Group CRUD (Backend only)

**Migration** `0030_project_groups.sql`:
```sql
CREATE TABLE IF NOT EXISTS project_groups (
  group_id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  description TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS project_group_members (
  group_id TEXT NOT NULL REFERENCES project_groups(group_id) ON DELETE CASCADE,
  project_id TEXT NOT NULL REFERENCES projects(project_id) ON DELETE CASCADE,
  added_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (group_id, project_id)
);

CREATE INDEX IF NOT EXISTS idx_pgm_project ON project_group_members(project_id);
```

**Backend**:
- Service: `src/services/projectGroups.ts`
  - `createGroup(group_id, name, description)` → group
  - `deleteGroup(group_id)` → void
  - `addProjectToGroup(group_id, project_id)` → void
  - `removeProjectFromGroup(group_id, project_id)` → void
  - `listGroups()` → group[]
  - `listGroupsForProject(project_id)` → group[]
  - `listGroupMembers(group_id)` → project_id[]
  - `resolveProjectIds(project_id, include_groups)` → string[]
- Route: `src/api/routes/projectGroups.ts`
  - `POST /api/groups` → createGroup
  - `DELETE /api/groups/:id` → deleteGroup
  - `GET /api/groups` → listGroups
  - `GET /api/groups/:id/members` → listGroupMembers
  - `POST /api/groups/:id/members` → addProjectToGroup
  - `DELETE /api/groups/:id/members/:project_id` → removeProjectFromGroup
  - `GET /api/projects/:id/groups` → listGroupsForProject
- MCP tools: `create_group`, `delete_group`, `list_groups`, `add_project_to_group`, `remove_project_from_group`
- API client: `gui/src/lib/api.ts` → add all group methods

**Frontend**: None (backend only).

**Commit**: `Add project groups schema and CRUD (migration 0030 + service + routes + MCP)`

---

### Batch 2: Multi-Project Search (Backend only)

**Backend**:
- Service: `src/services/lessons.ts`
  - New `searchLessonsMulti(params: { projectIds: string[], query, limit, filters })` → same result type + `project_id` on each match
  - Add `project_id: string` field to `SearchLessonsResult.matches[]` type
  - Rerank budget counts across all projectIds
  - Single SQL: `WHERE l.project_id = ANY($1::text[])`
- MCP `search_lessons` tool update (`src/mcp/index.ts`):
  - Add `project_ids: z.array(z.string()).optional()` — explicit multi-project
  - Add `group_id: z.string().optional()` — search a group's shared knowledge
  - Add `include_groups: z.boolean().optional().default(false)` — auto-include groups
  - Handler logic:
    1. If `group_id` → resolve group members → `searchLessonsMulti`
    2. If `project_ids` → `searchLessonsMulti` directly
    3. If `include_groups` → `resolveProjectIds(project_id, true)` → `searchLessonsMulti`
    4. Else → existing `searchLessons` (zero change)
- REST `POST /api/lessons/search` update:
  - Accept `project_ids`, `group_id`, `include_groups` in body
  - Same routing logic as MCP
- Barrel export: add `searchLessonsMulti` to `src/core/index.ts`

**Frontend**: None (backend only).

**Commit**: `Add multi-project search_lessons with group support (project_ids, group_id, include_groups)`

---

### Batch 3: List Projects Endpoint + check_guardrails Multi-Project

**Backend**:
- Route: `src/api/routes/projects.ts`
  - `GET /api/projects` → list all projects with group memberships and lesson counts
  - Each project includes: `{ project_id, name, groups: [{group_id, name}], lesson_count }`
- MCP `check_guardrails` update:
  - Add `include_groups: z.boolean().optional().default(false)`
  - When true, resolve all group member project_ids → check guardrails from all
  - Group guardrails apply to all members (shared rules)
- MCP `list_groups` tool:
  - Returns all groups with member counts

**Frontend**: None (backend only).

**Commit**: `Add list-projects endpoint and multi-project guardrail checking`

---

### Batch 4: GUI — Project Groups Management Page

**Frontend**:
- New page: `gui/src/app/projects/groups/page.tsx`
  - Lists all groups as cards
  - Each card shows: group name, description, member count, member project badges
  - "Create Group" button → dialog (group_id, name, description)
  - Click group → expand to show members
  - "Add Project" button on each group → dropdown of available projects
  - "Remove" button on each member → with confirm
  - "Delete Group" on each card → with ConfirmDialog
  - Empty state: "No groups yet. Create a group to share knowledge across projects."
- Update sidebar: add "Groups" link under Project section
- API client: add group methods to `gui/src/lib/api.ts`
- Types: `gui/src/app/projects/groups/types.ts`
  - `ProjectGroup { group_id, name, description, member_count, members?: string[] }`

**Backend**: None (already done in Batch 1).

**Commit**: `Add Project Groups management page with create, members, and delete`

---

### Batch 5: GUI — Project Selector + Multi-Project Search UX

**Frontend**:
- Expand project context (`gui/src/contexts/project-context.tsx`):
  - Add: `groups: ProjectGroup[]`, `includeGroups: boolean`, `setIncludeGroups`
  - Fetch groups for current project on projectId change
  - Compute `searchProjectIds` when `includeGroups` is true
- Replace sidebar text input (`gui/src/components/sidebar.tsx`):
  - Dropdown listing all projects from `GET /api/projects`
  - Below dropdown: toggle "Include group knowledge"
  - When toggled on, show which groups will be included (small badges)
  - Falls back to text input if `GET /api/projects` returns empty
- Update lessons search page (`gui/src/app/lessons/page.tsx`):
  - When `includeGroups` is true, pass `project_ids` or `include_groups: true` to API
  - Add `project_id` badge on each search result row
  - Color-code: own project = default, group knowledge = blue badge with group name
  - Add filter chip: "Source: [project_id]" to narrow results

**Backend**: None (already done).

**Commit**: `Add project dropdown, group toggle, and multi-project search attribution in GUI`

---

### Batch 6: CLAUDE.md Template + Seed Script

**Backend**:
- Script: `src/scripts/seedProjectGroups.ts`
  - Accepts config JSON:
    ```json
    {
      "groups": [
        {
          "group_id": "backend-shared",
          "name": "Backend Shared",
          "description": "Shared guardrails for all backend services",
          "members": ["order-api", "payment-gateway", "inventory-api"]
        }
      ],
      "guardrails": [
        {
          "group_id": "backend-shared",
          "lessons": [
            { "title": "No force push to main", "content": "...", "type": "guardrail", "tags": ["git"] }
          ]
        }
      ]
    }
    ```
  - Creates groups, adds members, seeds guardrail lessons into member projects
- MCP tool: `seed_project_groups` — runs the seed script via enqueueJob

**Documentation**:
- CLAUDE.md template for repos using groups:
  ```markdown
  # CLAUDE.md — [repo-name]
  MCP: http://localhost:3000/mcp | project_id: [repo-name]

  ## Session Start
  1. search_lessons(query: "<task>", project_id: "[repo-name]", include_groups: true)
  2. check_guardrails(action_context: {action: "<what>"}, project_id: "[repo-name]", include_groups: true)
  ```
- Update `docs/multi-repo-strategy.md` with implemented group-based architecture

**Commit**: `Add seed script, MCP seed tool, CLAUDE.md template, and update strategy docs`

---

## Checklist Reference Card (Quick Version)

### Solution Architect Quick Checks
1. Migration additive? (no DROP, no NOT NULL without DEFAULT)
2. Indexes cover `ANY($1::text[])` query pattern?
3. FK ON DELETE CASCADE for group members?
4. Max group size enforced (50 members)?

### PO Quick Checks
1. Single-project search still works exactly like before?
2. Multi-project search with groups works?
3. Direct group search works?
4. Results show which project each lesson came from?
5. Groups are optional — everything works without them?
6. Empty states for: no groups, no members, no results?
7. A project can belong to multiple groups?

### Backend Lead Quick Checks
1. `ANY($1::text[])` not string interpolation?
2. Single embedding, single SQL, single rerank?
3. Rerank budget scales with total lessons across all projects?
4. `project_id` (singular) still works alone?
5. New routes behind `bearerAuth`?
6. MCP params all `optional()` with `.describe()`?

### FE Lead Quick Checks
1. Project context backwards compatible?
2. Dropdown falls back to text input if no projects?
3. Group toggle doesn't break single-project workflow?
4. `toastRef` pattern used?
5. Next.js conventions followed (`gui/AGENTS.md`)?
6. Color-coding consistent across pages?

### QC Checks
```bash
cd /project && npx tsc --noEmit        # clean
cd /project && npm test                 # pass
cd /project/gui && npx next build      # clean
```

---

## Success Criteria

All batches complete when:
- [ ] `project_groups` + `project_group_members` tables created
- [ ] Group CRUD works via REST + MCP
- [ ] `search_lessons` supports: `project_ids`, `group_id`, `include_groups`
- [ ] `check_guardrails` supports `include_groups`
- [ ] `GET /api/projects` returns all projects with groups
- [ ] GUI: Project Groups management page functional
- [ ] GUI: Project dropdown replaces text input
- [ ] GUI: "Include group knowledge" toggle works
- [ ] GUI: Search results show source project attribution
- [ ] Seed script creates groups + members + shared guardrails
- [ ] CLAUDE.md template uses `include_groups: true`
- [ ] `tsc --noEmit` clean
- [ ] `next build` clean
- [ ] `npm test` pass
- [ ] Zero breaking changes — existing single-project workflows unaffected
- [ ] `SESSION_PATCH.md` updated

## Dependency Graph

```
Batch 1 (Schema + Group CRUD)
  │
Batch 2 (Multi-Project Search) ←── depends on Batch 1
  │
Batch 3 (List Projects + Guardrails) ←── depends on Batch 1 + 2
  │
  ├── Batch 4 (GUI: Groups Page) ←── depends on Batch 1
  │
  ├── Batch 5 (GUI: Selector + Search UX) ←── depends on Batch 2 + 3 + 4
  │
  └── Batch 6 (Templates + Seeding) ←── depends on Batch 1 + 2 + 3
```

Batches 4 and 6 can run in parallel after Batch 3. Batch 5 is last (needs everything).
