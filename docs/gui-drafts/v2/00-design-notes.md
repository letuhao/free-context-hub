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

## Page Scoping Audit

| Page | Scoping | Cross-project? | V2 Draft? |
|------|---------|---------------|-----------|
| Dashboard | Per-project | **YES — aggregate stats + project cards** | 03 |
| Chat | Per-project | No — chat context is per-project | — |
| Lessons | Per-project | **YES — Project column, cross-project search** | 04 |
| Review Inbox | Per-project | **YES — grouped by project, batch approve** | 08 |
| Guardrails | Per-project | **YES — cross-project check, project column** | 07 |
| Documents | Per-project | Minor — add project badge | — |
| Getting Started | Per-project | Minor — add project badge | — |
| Generated Docs | Per-project | Minor — add project badge | — |
| Code Search | Per-project | No — code is per-project | — |
| **Graph Explorer** | Per-project | **NO — must stay per-project. Company-wide graph is useless.** | 06 |
| Projects Overview | Cross-project | Already correct | — |
| Groups | Global | No change | — |
| Git History | Per-project | Minor — add project badge | — |
| Sources | Per-project | No change | — |
| Project Settings | Per-project | No change | — |
| Jobs | Per-project | Cross-project job queue view | — |
| Activity | Per-project | Already in dashboard V2 | — |
| Analytics | Per-project | **YES — per-project comparison** | 05 |
| Settings | Global | No change | — |
| Model Providers | Global | No change | — |
| Lesson Types | Global | No change | — |
| Agent Audit | Per-project | Cross-project agent trail | — |
| Access Control | Global | No change | — |

### Pages that MUST stay per-project (no "All Projects" mode):
- **Graph Explorer** — A company-wide symbol graph is too large, unfocused, and useless. Show a warning when "All Projects" is selected.
- **Code Search** — Code is always per-repository, per-project.
- **Sources** — Source configuration is per-project.
- **Project Settings** — Settings are per-project by definition.

### Pages that benefit from "All Projects" mode:
- Dashboard, Lessons, Guardrails, Review Inbox, Analytics, Activity, Agent Audit, Jobs

## Files in this directory
- `01-page-header-v2.html` — Updated PageHeader with project context
- `02-project-selector-v2.html` — Enhanced multi-project selector
- `03-dashboard-v2.html` — Cross-project dashboard
- `04-lessons-v2.html` — Multi-project lessons table
- `05-analytics-v2.html` — Cross-project analytics
- `06-graph-explorer-v2.html` — Project-scoped graph with "All Projects" warning
- `07-guardrails-v2.html` — Cross-project guardrail check + rules table
- `08-review-inbox-v2.html` — Cross-project review inbox grouped by project
