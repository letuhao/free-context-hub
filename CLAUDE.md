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

## Task Workflow v2 (11 phases per task)

> v2 absorbs execution discipline from [Superpowers](https://github.com/obra/superpowers) (brainstorming protocol, plan decomposition, TDD, verification gate, debugging protocol, subagent dispatch) while keeping our strengths (session persistence, role perspectives, guardrails, MCP knowledge layer).

Every task follows this workflow. The agent plays all roles sequentially.

**ENFORCEMENT: This workflow uses a state machine (`.workflow-state.json`). You MUST call the phase transition protocol before moving between phases. Hooks will block commits if verification evidence is missing.**

```
Phase      │ Role              │ What Happens
───────────┼───────────────────┼──────────────────────────────────────
1. CLARIFY │ Architect + PO    │ Brainstorm, ask questions, define scope
2. DESIGN  │ Lead              │ API contract / component API / data flow
3. REVIEW  │ PO + Lead         │ Review design spec before coding
4. PLAN    │ Lead + Developer  │ Decompose into bite-sized tasks (2-5 min)
5. BUILD   │ Developer         │ Write code (TDD: red → green → refactor)
6. VERIFY  │ Developer         │ Evidence-based verification gate
7. REVIEW  │ Lead              │ Code review (spec compliance + quality)
8. QC      │ QA / PO           │ Test against acceptance criteria
9. SESSION │ Developer         │ Update SESSION_PATCH.md + task status
10. COMMIT │ Developer         │ Git commit + push
11. RETRO  │ All               │ Add lesson if decision/workaround learned
```

**Status tracking:** `[ ]` not started · `[C]` clarify · `[D]` design · `[P]` plan · `[B]` build · `[V]` verify · `[R]` review · `[Q]` QC · `[S]` session · `[✓]` done

### Anti-Skip Rules (MANDATORY)

Agents are known to skip phases to "save time." This is explicitly forbidden.

**Common skip patterns — ALL are violations:**

| Skip pattern | Why agents do it | Why it's forbidden |
|---|---|---|
| Skip CLARIFY, jump to BUILD | "The task seems obvious" | Unexamined assumptions cause rework |
| Skip PLAN, jump to BUILD | "It's a small change" | Small changes grow; no plan = no checkpoint |
| Skip VERIFY after BUILD | "Tests passed earlier" | Stale results are not evidence |
| Skip REVIEW after VERIFY | "I wrote it, I know it's correct" | Author blindness is real |
| Skip SESSION before COMMIT | "I'll update later" | You won't. Context is lost |
| Combine multiple phases | "CLARIFY+DESIGN+PLAN in one go" | Phases exist to create pause points for user input |

**The only allowed skips** are for tasks classified as **XS** by the size protocol below. All other tasks must complete every phase. If a phase doesn't list skip conditions, it CANNOT be skipped.

### Task Size Classification (MANDATORY — do this BEFORE any work)

Agents are bad at judging task size. This protocol removes subjectivity.

**Before starting any task, count these 3 things:**

| Metric | How to count |
|--------|-------------|
| **Files touched** | How many files will be created or modified? |
| **Logic changes** | How many functions/methods/handlers will change behavior? (not just formatting) |
| **Side effects** | Does it change: API contract, DB schema, config, external behavior, types used by other files? |

**Classification rules (objective, not negotiable):**

| Size | Files | Logic changes | Side effects | Allowed skips |
|------|-------|---------------|--------------|---------------|
| **XS** | 1 | 0-1 | None | May skip CLARIFY + PLAN (go to BUILD). Still MUST do VERIFY. |
| **S** | 1-2 | 2-3 | None | May skip PLAN only. Still MUST do CLARIFY (brief) + VERIFY. |
| **M** | 3-5 | 4+ | Maybe | No skips allowed. Full 11 phases. |
| **L** | 6+ | Any | Yes | No skips. Write plan file. Consider subagent dispatch. |
| **XL** | 10+ | Any | Yes | No skips. Write spec + plan files. Subagent dispatch recommended. |

**XS examples (the ONLY tasks that can skip):**
- Fix a typo in a string literal (1 file, 0 logic, 0 side effects)
- Update a version number in package.json (1 file, 0 logic, 0 side effects)
- Fix an off-by-one in a single function with existing tests (1 file, 1 logic, 0 side effects)

**NOT XS (agents commonly misjudge these):**
- "Simple" CSS fix → often touches multiple components = S or M
- "Quick" API param rename → changes contract, affects callers = M+
- "Small" bug fix → if root cause unclear, debugging = M+
- "Just" add a field → migration + API + UI + types = L
- Any task where you haven't read the code yet → **you don't know the size yet, don't classify**

**The classification must be stated explicitly before work begins:**
```
Task: Fix the off-by-one in pagination
Size: XS (1 file: src/api/routes/lessons.ts, 1 logic change: offset calc, 0 side effects)
Skipping: CLARIFY, PLAN → straight to BUILD
```

If during BUILD you discover the task is larger than classified — STOP, reclassify, and resume from the correct phase.

**Phase transition protocol:**
1. State task size classification before starting (XS/S/M/L/XL with counts)
2. Before starting any phase, update `.workflow-state.json` with current phase
3. Before leaving any phase, record the phase output/evidence
4. If during work you discover the task is larger than classified — STOP, reclassify, announce to user
5. User can authorize additional skips explicitly — but the agent must never self-authorize

**Task types:** `[FE]` frontend only · `[BE]` backend only · `[FS]` full-stack (backend + frontend)

### Role perspectives
- **Architect** — scoping, dependencies, system-level impact
- **PO (Product Owner)** — acceptance criteria, design sign-off, final QC
- **Lead** — technical design, plan quality, code review (patterns, security, a11y)
- **Developer** — implementation, TDD, verification, session tracking, commits
- **QA** — test against acceptance criteria, edge cases, regression

When playing each role, shift perspective accordingly. Architect thinks about system boundaries. PO thinks about user value and acceptance. Lead thinks about code quality and maintainability. Developer thinks about correctness and efficiency. QA thinks about what can break.

---

### Phase 1: CLARIFY (Brainstorming Protocol)

Absorbed from Superpowers. Don't jump into code — clarify first.

1. **Explore context** — read relevant files, docs, git history
2. **Ask ONE question at a time** — multiple choice preferred, never overwhelm
3. **Propose 2-3 approaches** with trade-offs after enough context
4. **Present design in sections** — scale to complexity (few sentences to 300 words per section)
5. **Write spec file** to `docs/specs/YYYY-MM-DD-<topic>.md` for non-trivial tasks
6. **Self-review spec** — check for placeholders, contradictions, ambiguity, scope creep
7. **User approval gate** — do NOT proceed to Phase 2 without user sign-off

**Skip conditions:** Only for tasks classified **XS** (1 file, 0-1 logic changes, 0 side effects). If you haven't counted yet, you can't skip.

---

### Phase 4: PLAN (Task Decomposition)

Absorbed from Superpowers. Break work into executable chunks before coding.

- Decompose into **bite-sized tasks (2-5 minutes each)**
- Each task specifies: **exact file paths, complete code intent, verification command**
- **No placeholders allowed** — no "TBD", "TODO", "add error handling here"
- For large tasks (>5 files), write plan to `docs/plans/YYYY-MM-DD-<feature>.md`
- Self-review checklist: spec coverage, placeholder scan, type/signature consistency

**Execution mode decision** (for large plans):
- **Inline** (default): agent executes tasks sequentially with checkpoints
- **Subagent dispatch** (multi-file, independent tasks): fresh agent per task with 2-stage review
  - Stage 1: spec compliance review
  - Stage 2: code quality review
  - Never skip either stage; never proceed with unfixed issues

**Skip conditions:** Only for tasks classified **XS** or **S**. If classified S, CLARIFY is still required.

---

### Phase 5: BUILD (TDD Discipline)

Enhanced with Superpowers TDD protocol.

For each task in the plan:
1. **Write a failing test first** (RED) — test must fail for the right reason
2. **Write minimal code to pass** (GREEN) — no more than needed
3. **Refactor** — clean up while tests stay green
4. **Commit the cycle** — small, atomic commits

**When TDD doesn't apply:** UI layout, config changes, docs, migrations — just build and verify.

---

### Phase 6: VERIFY (Evidence Gate)

New phase, absorbed from Superpowers. Evidence before claims, always.

5-step gate before ANY completion claim:
1. **Identify** the verification command (test, build, lint, curl, etc.)
2. **Run** it fresh (not from memory/cache)
3. **Read** complete output including exit codes
4. **Confirm** output matches the claim
5. **Only then** state the result with evidence

**Red flags — stop immediately if you catch yourself:**
- Using "should work", "probably passes", "seems fine"
- Feeling satisfied before running verification
- About to commit/push without fresh test run
- Trusting prior output without re-running

**This gate applies before:** success claims, commits, PRs, task handoffs, session patches.

---

### Phase 7: REVIEW (2-Stage)

Enhanced with Superpowers dual review.

- **Stage 1 — Spec compliance:** Does the code implement what was designed? Missing requirements? Scope creep?
- **Stage 2 — Code quality:** Patterns, security, a11y, performance, maintainability

Both stages must pass. If issues found → fix → re-verify (Phase 6) → re-review.

---

## Debugging Protocol

Absorbed from Superpowers. Activated whenever a bug is encountered during any phase.

**Rule: NO FIXES WITHOUT ROOT CAUSE INVESTIGATION FIRST.**

```
Phase      │ What Happens
───────────┼──────────────────────────────────────
1. INVEST  │ Read errors fully, reproduce, trace data flow backward
2. PATTERN │ Find working examples, compare every difference
3. HYPOTHE │ State hypothesis clearly, test one variable at a time
4. FIX     │ Write failing test → implement single root-cause fix → verify
```

**Hard stop:** If 3+ fix attempts fail → stop debugging, question the architecture. Discuss with user before continuing.

**Anti-patterns (never do these):**
- Propose fix before tracing data flow
- Attempt multiple fixes simultaneously
- Skip test creation for the bug
- Make assumptions without verification

---

## Git Workflow

Enhanced with Superpowers worktree isolation.

- **Small tasks:** work on current branch (default)
- **Large features (>5 files, >1 hour):** prefer `git worktree` for isolation
  - Create worktree with clean baseline
  - Verify tests pass before starting
  - On completion: merge/PR/discard decision with user
- **Always:** `check_guardrails` before push

---

### Session Patch Update Rule (always)

**Update `docs/sessions/SESSION_PATCH.md` after EVERY sprint completes.** Don't wait until the end of a multi-sprint session. The session patch is the durable narrative — it's how the next session understands what happened.

What to include per sprint:
- Sprint number and one-line outcome
- Migrations (if any)
- New files / modified files / commits
- Code review issues found and how they were fixed
- Live test results (real stack, not mocked)
- What's next

When to update:
- After Phase 9 (SESSION) of the 11-phase task workflow
- After Phase 5 (REPORT) of the test workflow
- Before moving to a new sprint (don't batch)

This rule applies to all sprints, all phases, all sessions — never skip it.

---

## Test Workflow (E2E / QC tasks)

For writing tests (not features), use this lighter workflow instead of the 11-phase task workflow.

```
Phase     │ What Happens
──────────┼──────────────────────────────────────
1. SETUP  │ Install deps, create shared utilities, verify infra runs
2. WRITE  │ Write tests (one sprint at a time from test plan)
3. RUN    │ Execute tests against live stack (docker compose)
4. FIX    │ Triage failures: test bug vs real bug, fix both
5. REPORT │ Generate report, update session patch, commit
```

Repeat phases 2–5 per sprint. No design review or PO sign-off needed.

**Status tracking:** `[ ]` not started · `[S]` setup · `[W]` writing · `[R]` running · `[F]` fixing · `[✓]` done

**Failure triage:**
- **Test bug** — wrong selector, bad assertion, missing cleanup → fix the test
- **Real bug** — endpoint 500s, page crashes, wrong data → fix the product code, then re-run
- **Infra issue** — Docker not ready, embeddings unavailable → mark test as `skip`, don't fail the suite

**Test plan:** `docs/qc/e2e-test-plan.md` — Layer 1 (smoke) + Layer 2 (scenarios), 191 total tests.

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
├── migrations/             # PostgreSQL migrations (41 files)
├── docs/
│   ├── gui-drafts/         # HTML draft designs (24 pages + 18 components)
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
Phase 6 ✅      Phase 7 ✅      Phase 8 ✅      Phase 8D ✅     Phase 8E ✅
Retrieval       GUI &           Advanced        Deferred        E2E Tests
Quality         Human-in-loop   HITL            Improvements    198 tests,
Tiered search,  20 pages,       Access control, Feature toggles Smoke + Scenario
Reranking,      Review inbox,   Custom types,   Role enforce,   + Agent visual
Redis cache,    AI editor,      Rich content,   Rich editor,    Layout fixes
QC eval loop    Documents,      Agent audit     Onboarding
                Analytics,
                Global search
    │               │               │               │               │
    ▼               ▼               ▼               ▼               ▼
Phase 9 ✅      Phase 10 ✅     Phase 11 ◐
Multi-Project   Multi-format    Knowledge
UX Redesign     Ingestion       Portability
Cross-project   PDF, DOCX,      Bundle format,
views, project  Images, URL,    full export+
selector V2,    Vision + hybrid import, GUI
"All Projects"  chunk search    (4/6 sprints)
```

| Phase | Status | Key Deliverables |
|-------|--------|-----------------|
| **1-2** | ✅ Complete | Lessons CRUD, semantic search, guardrails, MCP interface |
| **3** | ✅ Complete | LLM reflection, context compression, project summaries |
| **4** | ✅ Complete | Neo4j knowledge graph, symbol extraction (ts-morph), dependency tracing |
| **5** | ✅ Complete | Git commit ingestion, lesson suggestions, impact analysis, job queue |
| **6** | ✅ Complete | Tiered search (ripgrep→FTS→semantic), reranking, Redis cache, QC eval loop |
| **7** | ✅ Complete | GUI (20 pages, 30+ REST endpoints, 7 sprints, 38 migrations) |
| **8** | ✅ Complete | Access control (API keys/roles), custom lesson types, rich editor, agent audit, feature toggles (7 sprints, 3 migrations, 24 routes) |
| **8D** | ✅ Complete | Feature toggles BE, role enforcement middleware, rich editor in detail, onboarding checklist |
| **8E** | ✅ Complete | E2E test suite (198 tests: API smoke 75, GUI smoke 23, MCP smoke 36, API scenarios 34, GUI scenarios 21, Agent visual 9), layout fixes |
| **9** | ✅ Complete | Multi-project UX redesign — "All Projects" mode, project selector V2, ProjectBadge, cross-project views on all pages, per-project guards (11 sprints, 26 commits, 41 files) |
| **10** | ✅ Complete | Multi-format extraction (fast/quality/vision), chunking + embeddings, chunk edit/delete with optimistic lock, hybrid semantic+FTS chunk search (REST/Cmd+K/chat tool/MCP tool), vision async jobs with progress+cancel, mermaid rendering, image upload UX, SSRF-hardened URL ingestion, 47-test E2E suite (7 sprints, 7 migrations) |
| **11** | ◐ In Progress (4/6) | Knowledge portability — zip+JSONL bundle format with manifest+sha256, full project export streaming via pg-cursor, full project import with conflict policies (skip/overwrite/fail) + dry-run + cross-tenant guard, GUI Knowledge Exchange panel in Project Settings. Sprints 11.5 (cross-instance pull) and 11.6 (polish + tests) remaining. |

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

## Phase 8 — Complete

**Status:** All 7 sprints complete (8.1–8.6 + review). 3 new migrations, 4 new pages, 24 total routes.

| Sprint | Focus | Status |
|--------|-------|--------|
| 8.1 | Feature toggles (settings.features JSONB ↔ project settings UI) | ✅ |
| 8.2 | Custom lesson types (lesson_types table, CRUD API, settings page, MCP enum relaxed) | ✅ |
| 8.3 | Agent audit trail (unified timeline from guardrail_audit_logs + lessons, stats, agent slide-over) | ✅ |
| 8.4 | Rich content editor (markdown toolbar, preview/split, Ctrl+B/I, wired into add-lesson) | ✅ |
| 8.5 | Access control (api_keys table, SHA-256 hashing, roles, auth middleware, settings page) | ✅ |
| 8.6 | Dynamic lesson types in FE (useLessonTypes hook, replaced hardcoded arrays in 3 files) | ✅ |
| Review | Code review fixes (7 issues: SQL params, color validation, XSS, double-click, key_hash exposure) | ✅ |

**New pages:** Lesson Types (`/settings/lesson-types`), Agent Audit (`/agents`), Access Control (`/settings/access`), Project Settings enhanced with feature toggles

**Pre-Phase 8 (also done this session):** Multi-project support — project selector, create modal, no-project guard, project settings, project overview v2, dashboard onboarding

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
