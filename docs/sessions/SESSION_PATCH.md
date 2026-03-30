---
id: CH-MULTI-REPO-GROUPS
date: 2026-03-30
module: Multi-Repo-Groups
phase: Implementation Complete
---

# Session Patch — 2026-03-30

## Where We Are
Phase: **Multi-repo project groups — fully implemented.** Chose groups (many-to-many) over tree hierarchy based on user feedback. All 6 batches complete.

## What Was Done This Session

### Batch 1: Schema + Group CRUD
- Migration `0030_project_groups.sql`: `project_groups` + `project_group_members` tables
- Service `src/services/projectGroups.ts`: 8 functions (CRUD + resolveProjectIds + listAllProjects)
- Routes `src/api/routes/projectGroups.ts`: 7 REST endpoints
- MCP: 7 new group management tools (create_group, delete_group, list_groups, etc.)
- GUI API client updated with all group methods

### Batch 2: Multi-Project Search
- `searchLessonsMulti()` in `src/services/lessons.ts` — single SQL with `ANY()`, single rerank
- `project_id` attribution on every search result match
- MCP `search_lessons` extended: `project_ids`, `group_id`, `include_groups` params
- REST `POST /api/lessons/search` extended with same params
- Backwards compatible: existing single `project_id` calls unchanged

### Batch 3: List Projects + Multi-Project Guardrails
- `GET /api/projects` — lists all projects with group memberships and lesson counts
- `check_guardrails` MCP + REST extended with `include_groups` — checks group-level guardrails
- `listAllProjects()` service function

### Batch 4: GUI — Project Groups Page
- New page: `gui/src/app/projects/groups/page.tsx`
- Create/delete groups, expand to see members, add/remove members
- Empty state with CTA, confirm dialog for delete
- Sidebar updated with "Groups" nav item

### Batch 5: GUI — Project Selector + Search Attribution
- Project context expanded: `projects`, `includeGroups`, `setIncludeGroups`, `refreshProjects`
- Sidebar: project dropdown (falls back to text input if no projects), "Include group knowledge" toggle
- Lessons page: "Source" column with project_id badge when searching across groups (blue for group, gray for own)

### Batch 6: Templates + Seeding
- Seed script: `src/scripts/seedProjectGroups.ts` — accepts config JSON
- Example config: `docs/example-group-seed.json`
- CLAUDE.md template: `docs/CLAUDE-template-multi-repo.md`
- Updated `docs/multi-repo-strategy.md` with full implementation details

## Key Decision
**Groups, not trees.** User defines which repos share knowledge. Many-to-many, not parent-child. A project can belong to 0..N groups. Groups are optional — everything works without them.

## Next Steps
1. Run integration tests with real multi-project data
2. Consider adding group-level lessons page in GUI (filter by group_id)
3. Consider cross-group search (search across multiple groups at once)
4. Evaluate performance with 100+ projects / 10+ groups

## Prior Session Context
- Phase 7 GUI: 14/14 pages complete
- Open: Model Providers backend, KG routes, integration testing
