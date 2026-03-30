# Multi-Repo Strategy for free-context-hub

## Context

The user operates multiple repositories across different systems (not just microservices within one system). These systems integrate with each other (e.g., Order system integrates with Payment system), but they are distinct bounded contexts — possibly owned by different teams.

**Key distinction:** Microservices are internal parts of a system. Integration is how separate systems communicate across boundaries. They share contracts, not internals.

## Implemented: Project Groups (Many-to-Many)

**Design choice: Groups, not trees.** Users decide which repos share knowledge with each other. A project can belong to multiple groups or none. No forced global hierarchy.

```
┌─────────────────────────────────────────────────────┐
│  Group: "backend-shared"                            │
│  Members: order-api, payment-gateway, inventory-api │
│  → Shared guardrails: logging, auth, deploy rules   │
├─────────────────────────────────────────────────────┤
│  Group: "order-payment-integration"                 │
│  Members: order-api, payment-gateway                │
│  → API contracts, retry policies, error mapping     │
├─────────────────────────────────────────────────────┤
│  order-api (solo)                                   │
│  → Only its own lessons when include_groups=false    │
└─────────────────────────────────────────────────────┘
```

### Schema

```sql
-- project_groups: named groups of projects
CREATE TABLE project_groups (
  group_id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  description TEXT
);

-- project_group_members: many-to-many relationship
CREATE TABLE project_group_members (
  group_id TEXT REFERENCES project_groups(group_id) ON DELETE CASCADE,
  project_id TEXT REFERENCES projects(project_id) ON DELETE CASCADE,
  PRIMARY KEY (group_id, project_id)
);
```

### Search Modes

| Mode | API Call | What it searches |
|------|----------|-----------------|
| Single project | `search_lessons(project_id: "order-api")` | Just this repo's lessons |
| Include groups | `search_lessons(project_id: "order-api", include_groups: true)` | This repo + all groups it belongs to |
| Specific group | `search_lessons(group_id: "order-payment-integration")` | Just the group's shared knowledge |
| Explicit multi | `search_lessons(project_ids: ["order-api", "payment-gw"])` | Any combination of projects |

### CLAUDE.md Template (per repo)

```markdown
# CLAUDE.md — order-api
MCP: http://localhost:3000/mcp | project_id: order-api

## Session Start
1. search_lessons(query: "<task>", project_id: "order-api", include_groups: true)
2. check_guardrails(action_context: {action: "<what>"}, project_id: "order-api", include_groups: true)
```

One call, full knowledge. `include_groups: true` automatically resolves all groups this project belongs to.

### Setup

```bash
# Seed groups from config
npx tsx src/scripts/seedProjectGroups.ts docs/example-group-seed.json
```

See `docs/CLAUDE-template-multi-repo.md` for full template.
See `docs/example-group-seed.json` for config format.

### GUI

- **Project Groups page** (`/projects/groups`): Create/delete groups, add/remove members
- **Project selector** (sidebar): Dropdown with all projects, "Include group knowledge" toggle
- **Lessons search**: Shows source project badge when searching across groups

## Implementation

### Backend
- Migration: `migrations/0030_project_groups.sql`
- Service: `src/services/projectGroups.ts` — Group CRUD + `resolveProjectIds()`
- Service: `src/services/lessons.ts` — `searchLessonsMulti()` for multi-project search
- Routes: `src/api/routes/projectGroups.ts` — 7 REST endpoints
- MCP: `search_lessons` supports `project_ids`, `group_id`, `include_groups`
- MCP: `check_guardrails` supports `include_groups`
- MCP: 7 new group management tools

### Frontend
- Context: `gui/src/contexts/project-context.tsx` — expanded with projects, groups, includeGroups
- Sidebar: `gui/src/components/sidebar.tsx` — project dropdown + group toggle
- Page: `gui/src/app/projects/groups/page.tsx` — group management
- Lessons: `gui/src/app/lessons/page.tsx` — project attribution badges

### Performance
- Single SQL query with `WHERE project_id = ANY($1::text[])` — not N separate queries
- Single embedding computation per search
- Single rerank pass on merged results
- Latency: under 1.5x single-project search

## Limitations

- Single auth token (`CONTEXT_HUB_WORKSPACE_TOKEN`) — no per-project auth
- All projects share the same server instance
- Max 50 members per group (enforced in service layer)
