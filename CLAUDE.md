# CLAUDE.md

## Project
free-context-hub — self-hosted persistent memory + guardrails for AI agents, with human-in-the-loop GUI.
MCP: `http://localhost:3000/mcp` | API: `http://localhost:3001` | GUI: `http://localhost:3002`
project_id: `free-context-hub`

## Session Start (do these 2 things)
1. `search_lessons(query: "<your task intent>")` — load relevant prior decisions/workarounds
2. `check_guardrails(action_context: {action: "<what you plan to do>"})` — if doing anything risky

That's it. Don't call `help()` every session — only on first use or after tool changes.

## When to Use MCP (saves tokens) vs Built-in Tools (faster)

| Task | Use MCP | Use Grep/Glob/Read |
|------|---------|-------------------|
| "What did the team decide about X?" | `search_lessons` | - |
| "Any workarounds for X bug?" | `search_lessons` | - |
| "Is X allowed before deploy?" | `check_guardrails` | - |
| "Where is function X defined?" | - | `Grep "functionX"` |
| "Find all .ts files in src/" | - | `Glob "src/**/*.ts"` |
| "Find the test file for X" | `search_code_tiered(kind: "test")` | - |
| "Any docs about X topic?" | `search_code_tiered(kind: "doc")` | - |
| "What does the project do?" | `get_project_summary` (first time only) | - |

**Rule: use MCP for knowledge (lessons, guardrails, docs). Use built-in tools for code navigation.**

## After Making Decisions
Call `add_lesson` with:
- `lesson_type: "decision"` — architectural choice
- `lesson_type: "workaround"` — bug fix or workaround
- `lesson_type: "preference"` — team convention
- `lesson_type: "guardrail"` — rule to enforce before actions

**Note:** wrap args in `lesson_payload: { project_id, lesson_type, title, content, tags }`.

## Before Risky Actions
Always `check_guardrails` before: git push, deploy, schema migration, delete data.
If `pass: false` → show prompt to user and wait for approval.

## Session End
Update `docs/sessions/SESSION_PATCH.md` with what was done and what's next.

## Tool Reference
Call `help(output_format: "json_pretty")` for full tool docs, parameters, and examples.
Don't memorize tool schemas — `help()` is always current.

---

## Task Workflow (9 phases per task)

Every task follows this workflow. The agent plays all roles sequentially.

```
Phase     │ Role              │ What Happens
──────────┼───────────────────┼──────────────────────────────────────
1. PLAN   │ Architect + PO    │ Define scope, acceptance criteria, deps
2. DESIGN │ Lead              │ API contract / component API / data flow
3. REVIEW │ PO + Lead         │ Review design before coding
4. BUILD  │ Developer         │ Write code (backend then frontend)
5. TEST   │ Developer         │ Run locally, fix bugs, write unit tests
6. REVIEW │ Lead              │ Code review (patterns, security, a11y)
7. QC     │ QA / PO           │ Test against acceptance criteria
8. SESSION│ Developer         │ Update SESSION_PATCH.md + task status
9. COMMIT │ Developer         │ Git commit + push
```

**Status tracking:** `[ ]` not started · `[P]` plan · `[D]` design · `[B]` build · `[R]` review · `[Q]` QC · `[S]` session · `[✓]` done

**Task types:** `[FE]` frontend only · `[BE]` backend only · `[FS]` full-stack (backend + frontend)

**Role perspectives:**
- **Architect** — scoping, dependencies, system-level impact
- **PO (Product Owner)** — acceptance criteria, design sign-off, final QC
- **Lead** — technical design, code review (patterns, security, a11y)
- **Developer** — implementation, testing, session tracking, commits
- **QA** — test against acceptance criteria, edge cases, regression

When playing each role, shift perspective accordingly. Architect thinks about system boundaries. PO thinks about user value and acceptance. Lead thinks about code quality and maintainability. Developer thinks about correctness and efficiency. QA thinks about what can break.

---

## Architecture Overview

```
┌─────────────────────────────────────────────────────────┐
│                    AI Agents (MCP)                       │
│              Claude Code, Cursor, etc.                   │
│    add_lesson / search_lessons / check_guardrails        │
└──────────────────────┬──────────────────────────────────┘
                       │ MCP :3000
┌──────────────────────┼──────────────────────────────────┐
│                 ContextHub Backend                       │
│  ┌───────────┐ ┌──────────┐ ┌─────────┐ ┌───────────┐  │
│  │ MCP Server│ │ REST API │ │ Worker  │ │ Chat (AI) │  │
│  │   :3000   │ │  :3001   │ │  (bg)   │ │ streaming │  │
│  └───────────┘ └──────────┘ └─────────┘ └───────────┘  │
│         │            │            │            │         │
│  ┌──────┴────────────┴────────────┴────────────┘        │
│  │              Services Layer                          │
│  │  lessons · guardrails · search · git · jobs · docs   │
│  └──────────────────────┬───────────────────────┘       │
│                         │                               │
│  ┌──────────┐ ┌─────────┴──┐ ┌──────────┐ ┌─────────┐  │
│  │ Postgres │ │  pgvector  │ │  Neo4j   │ │  Redis  │  │
│  │ (data)   │ │(embeddings)│ │(KG, opt) │ │(cache)  │  │
│  └──────────┘ └────────────┘ └──────────┘ └─────────┘  │
└─────────────────────────────────────────────────────────┘
                       │ REST :3001
┌──────────────────────┼──────────────────────────────────┐
│               GUI (Next.js :3002)                       │
│  Dashboard · Chat · Lessons · Guardrails · Jobs         │
│  Knowledge (Docs/Graph/Search) · Projects · Settings    │
│  [Planned] Review Inbox · Documents · Analytics         │
│            Notifications · Onboarding                   │
└─────────────────────────────────────────────────────────┘
                       │
               Human (browser)
```

## Project Structure

```
free-context-hub/
├── src/                    # Backend (Node.js + TypeScript)
│   ├── index.ts            # Main entry — MCP :3000 + REST API :3001
│   ├── worker.ts           # Background job worker
│   ├── api/routes/         # REST endpoints (14 route files, 70+ endpoints)
│   ├── mcp/                # MCP tools (36 tools)
│   ├── services/           # Business logic
│   ├── db/                 # Database utilities
│   ├── core/               # Logger, migrations, KG bootstrap
│   └── env.ts              # Environment config
├── gui/                    # Frontend (Next.js 16 + React 19 + Tailwind)
│   ├── src/app/            # Pages (20 functional)
│   ├── src/components/     # Shared components (18)
│   ├── src/contexts/       # React contexts
│   ├── src/lib/            # API client, utilities
│   └── Dockerfile          # Multi-stage Next.js Docker build
├── migrations/             # PostgreSQL migrations (38 files)
├── docs/
│   ├── gui-drafts/         # HTML draft designs (21 pages + 16 components)
│   ├── screenshots/        # README screenshots
│   ├── phase7-task-breakdown.md  # Sprint plan (7 sprints, 73 tasks)
│   └── sessions/           # Session patches
├── Dockerfile              # Backend Docker build
├── docker-compose.yml      # Full stack: db, neo4j, rabbitmq, redis, mcp, worker, gui
├── WHITEPAPER.md           # Project whitepaper (v0.3)
└── CLAUDE.md               # This file
```

## Development Phases

```
Phase 1-2 ✅    Phase 3 ✅      Phase 4 ✅      Phase 5 ✅
Core MVP        Distillation    Knowledge       Git Intelligence
Lessons,        Reflect,        Graph (Neo4j),  Ingest commits,
Search,         Compress,       Symbol search,  Suggest lessons,
Guardrails      Summarize       Impact analysis Commit analysis
    │               │               │               │
    ▼               ▼               ▼               ▼
Phase 6 ✅      Phase 7 ✅      Phase 8 ○       Phase 9 ○       Phase 10 ○
Retrieval       GUI &           Advanced        Multi-format    Knowledge
Quality         Human-in-loop   HITL            Ingestion       Portability
Tiered search,  20 pages,       Access control, PDF, DOCX,      Exchange hub,
Reranking,      Review inbox,   Custom types,   Images,         Cross-instance
Redis cache,    AI editor,      Rich content,   Parsing         sync
QC eval loop    Documents,      Agent audit     pipelines
                Analytics,
                Global search
```

| Phase | Status | Key Deliverables |
|-------|--------|-----------------|
| **1-2** | ✅ Complete | Lessons CRUD, semantic search, guardrails, MCP interface |
| **3** | ✅ Complete | LLM reflection, context compression, project summaries |
| **4** | ✅ Complete | Neo4j knowledge graph, symbol extraction (ts-morph), dependency tracing |
| **5** | ✅ Complete | Git commit ingestion, lesson suggestions, impact analysis, job queue |
| **6** | ✅ Complete | Tiered search (ripgrep→FTS→semantic), reranking, Redis cache, QC eval loop |
| **7** | ✅ Complete | GUI (20 pages, 30+ REST endpoints, 7 sprints, 38 migrations) |
| **8** | ○ Planned | Access control (roles), custom lesson types/templates, rich content, agent audit |
| **9** | ○ Planned | PDF/DOCX/Image ingestion pipelines (document foundation in Phase 7) |
| **10** | ○ Planned | Import/export exchange hub, cross-instance sync (basic I/O in Phase 7) |

## Phase 7 — Complete

**Status:** All 7 sprints complete. 20 pages, 30+ REST endpoints, 38 migrations.

**Task tracking:** `docs/phase7-task-breakdown.md`

| Sprint | Focus | Status |
|--------|-------|--------|
| 7.1 | Foundation & FE refactor (icons, breadcrumbs, animations, keyboard shortcuts) | ✅ |
| 7.2 | Lesson editing & review workflow (version history, review inbox, status tabs) | ✅ |
| 7.3 | AI-assisted features (markdown, chat sidebar, AI editor, pinned messages) | ✅ |
| 7.4 | Documents & knowledge management (upload, viewer, AI lesson generation) | ✅ |
| 7.5 | Collaboration & feedback (comments, thumbs, bookmarks, import/export) | ✅ |
| 7.6 | Activity, analytics & onboarding (timeline, donut chart, learning path) | ✅ |
| 7.7 | Polish (global search, agent trust, guardrail simulate, drag-drop, CSV/MD import, AI editor toolbar, suggested tags, SVG chart, chat history loading) | ✅ |

**GUI pages:** Dashboard, Chat, Lessons, Review Inbox, Guardrails, Documents, Getting Started, Activity, Analytics, Generated Docs, Code Search, Graph Explorer, Projects (Overview/Groups/Git/Sources), Jobs, Settings, Model Providers

**Design drafts:** `docs/gui-drafts/` — 21 pages + 16 components as standalone HTML (used as reference during implementation).

## Dev Commands

```bash
# Backend
npm run dev              # Start MCP + API (dev mode, tsx watch)
npm run worker           # Start background worker
npm run build            # TypeScript compile
npm run smoke-test       # Verify basic setup

# GUI
cd gui && npm run dev    # Start Next.js dev server
cd gui && npm run build  # Production build

# Docker (full stack)
docker compose up -d     # Start all services
docker compose up -d --build  # Rebuild + start

# Testing
npm test                 # Unit tests
npm run test:integration # Integration tests
```

## Key Environment Variables

```bash
# Required
DATABASE_URL=postgresql://contexthub:contexthub@localhost:5432/contexthub
EMBEDDINGS_BASE_URL=http://localhost:1234   # LM Studio or compatible

# Ports
MCP_PORT=3000
API_PORT=3001
GUI_PORT=3002

# Optional features
KG_ENABLED=false          # Neo4j knowledge graph
QUEUE_ENABLED=false       # RabbitMQ job queue
REDIS_ENABLED=false       # Redis cache
GIT_INGEST_ENABLED=true   # Git history ingestion
```
