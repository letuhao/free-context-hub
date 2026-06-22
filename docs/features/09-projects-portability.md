# Projects & Portability

Everything in free-context-hub is organized under a **project** (a tenant). Projects
can be grouped to share knowledge, and a project's entire knowledge base can be
exported, imported, or pulled from another instance.

## Key concepts

- **Project** — the top-level tenant boundary. Each has a `project_id`, settings,
  feature toggles, and its own lessons/documents/guardrails.
- **Multi-project / "All Projects"** — most views can span projects or focus one, via
  the project selector.
- **Groups** — projects can be grouped so knowledge (and guardrail checks) apply
  across members.
- **Sources** — a project's git source (remote URL or local path) and registered
  workspace roots drive indexing and ripgrep search.
- **Knowledge portability** — a project exports to a **zip + JSONL bundle** with a
  manifest and sha256 integrity. Import supports conflict policies and a dry-run.
  **Cross-instance pull** fetches a project from another instance with DNS-rebinding
  pinning and slow-loris defense.

## How to use it

### MCP (agents)

| Tool | Purpose |
|------|---------|
| `get_project_summary` | Fast project briefing |
| `delete_workspace` | Delete all ContextHub data for a `project_id` |
| `create_group` / `delete_group` / `add_project_to_group` / `remove_project_from_group` | Group management |
| `list_groups` / `list_group_members` / `list_project_groups` | Group queries |
| `configure_project_source` / `get_project_source` / `prepare_repo` | Source config |
| `register_workspace_root` / `list_workspace_roots` / `scan_workspace` | Workspace roots |

### REST

- `/api/projects` — CRUD, `/summary`, `/index`, `/reflect`
- `POST /api/projects/:id/export` — zip bundle (streamed via cursor)
- `POST /api/projects/:id/import` — bundle import with conflict policy + dry-run
- `POST /api/projects/:id/pull-from` — cross-instance pull
- `/api/groups` — group CRUD/membership
- `/api/workspace` — source + workspace root config

### GUI

- **Projects Overview** (`/projects`) — all projects, health scores, switcher.
- **Project Settings** (`/projects/settings`) — name/color, feature toggles,
  Knowledge Exchange (export/import/pull), taxonomy profiles, delete.
- **Groups** (`/projects/groups`) — create/manage groups and membership.
- **Project Sources** (`/projects/sources`) — git source + workspace roots, scan/prepare.

## Related

- [Code Intelligence](04-code-intelligence.md) · [Access Control & Identity](08-access-control-identity.md) · [Jobs & Operations](11-jobs-operations.md)
