# V2 Draft Designs — Multi-Project UX Redesign

## Problem
The current UI treats multi-project as an afterthought. In a real company:
- Teams manage multiple projects simultaneously
- Knowledge may be shared across projects (via groups) or isolated
- A team lead needs aggregate views across all projects
- The current "one project at a time" model forces tedious switching

## Design Principles
1. **Project context is always visible** — every page shows which project(s) you're viewing
2. **"All Projects" is a first-class view** — not an afterthought
3. **Project color coding** — each project has a color that appears on its content
4. **Seamless switching** — don't lose your place when changing projects
5. **Cross-project search** — find knowledge anywhere

## Key Changes

### Sidebar: Project Selector V2
- "All Projects" option at top (shows aggregate across all)
- Multi-select mode: check multiple projects to view together
- Project color dots inline with names
- Quick-switch keyboard shortcut (Ctrl+P or number keys)

### PageHeader V2
- Project badge (color dot + name) next to page title
- "All Projects" badge when viewing aggregate
- Breadcrumb: `Project Name > Lessons` instead of `Knowledge > Lessons`

### Dashboard V2
- "All Projects" mode: stacked stat cards per project, aggregate totals
- Mini project cards showing health score per project
- Cross-project activity feed

### Lessons V2
- "Project" column visible when viewing "All Projects"
- Project color dot on each row
- Cross-project search (searches all or selected projects)
- Bulk actions across projects

### Analytics V2
- Per-project comparison charts
- Aggregate view with project breakdown
- "Compare projects" mode

## Files in this directory
- `01-page-header-v2.html` — Updated PageHeader with project context
- `02-project-selector-v2.html` — Enhanced multi-project selector
- `03-dashboard-v2.html` — Cross-project dashboard
- `04-lessons-v2.html` — Multi-project lessons table
- `05-analytics-v2.html` — Cross-project analytics
