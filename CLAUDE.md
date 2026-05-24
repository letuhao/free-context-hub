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

## Task Workflow (default: v2.2 human-in-loop · AMAW opt-in)

> **Default behavior (v2.2):** human stays in the loop. The same 12 phases run, but REVIEW + POST-REVIEW use main-session self-review with human checkpoints at CLARIFY end and POST-REVIEW end. Cheap, fast, works for most tasks.
>
> **AMAW opt-in (v3.0):** main session spawns cold-start sub-agents (Adversary, Scope Guard, Scribe) at REVIEW + POST-REVIEW. Catches issues human review misses (cache coherence, semantic edge cases, scope drift) but costs ~$1-5 in sub-agent tokens per task and ~30 extra min wall-clock per review loop. Reserve for high-stakes work: data migrations, schema changes, security-critical paths, multi-system contracts.
>
> **How to enable AMAW for a task:** user types `/amaw` OR includes "use AMAW workflow" / "spawn Adversary" / "AMAW mode" in the task description. Without this trigger, default = v2.2.
>
> v2.2 heritage (always-on regardless of mode): Superpowers TDD discipline, plan decomposition, evidence gate, session persistence, MCP knowledge layer.
>
> **Both modes use the same files-as-truth principle:** spec, plan, audit log are durable; chat is ephemeral. Full AMAW spec: `docs/amaw-workflow.md`.

**ENFORCEMENT (both modes):** state machine via `.workflow-state.json` + append-only `docs/audit/AUDIT_LOG.jsonl`. workflow-gate.sh tracks phase transitions. In default mode, human is the final review gate. In AMAW mode, Scope Guard sub-agent is the gate — conservative wins, any REJECTED/BLOCKED finding from any agent must be resolved before SESSION.

```
Phase          │ Default role          │ AMAW role             │ What Happens
───────────────┼───────────────────────┼───────────────────────┼─────────────────────────────────
1. CLARIFY     │ Main + human          │ Main + Scribe         │ Read MCP, write spec, scan DEFERRED.md
2. DESIGN      │ Main                  │ Main                  │ API contract / data flow → docs/specs/DESIGN.md + hash
3. REVIEW      │ Main self-review      │ Adversary (cold-start)│ Find spec gaps / contract holes — find exactly 3 problems
4. PLAN        │ Main                  │ Main + Scribe         │ Decompose into tasks → docs/plans/PLAN.md, no placeholders
5. BUILD       │ Main                  │ Main                  │ Write code (TDD: red → green → refactor)
6. VERIFY      │ Main                  │ Main                  │ Run tests fresh, capture raw exit code + output
7. REVIEW      │ Main self-review      │ Adversary (cold-start)│ Code vs spec — find exactly 3 divergences
8. QC          │ Main                  │ Scope Guard           │ Spec fingerprint vs implementation, AC coverage
9. POST-REVIEW │ Human checkpoint      │ Scope Guard           │ Final gate — BLOCKED on any unresolved issue
10. SESSION    │ Main (acting as Scribe)│ Scribe               │ SESSION_PATCH.md + DEFERRED.md + AUDIT_LOG.jsonl
11. COMMIT     │ Main                  │ Main                  │ Git commit
12. RETRO      │ Main                  │ Audit Logger          │ add_lesson to MCP + finalize AUDIT_LOG.jsonl
```

**AUDIT_LOG.jsonl:** committed file at `docs/audit/AUDIT_LOG.jsonl`. One event per line. Main + sub-agents append-only — never modify existing lines. Replaces per-phase `.phase-gates/*.gate` files from earlier AMAW iterations (which polluted the repo with ephemeral state). Schema documented in `docs/amaw-workflow.md`.

**Status tracking:** `[ ]` not started · `[C]` clarify · `[D]` design · `[P]` plan · `[B]` build · `[V]` verify · `[R]` review · `[Q]` QC · `[PR]` post-review · `[S]` session · `[✓]` done

### Anti-Skip Rules (MANDATORY)

Agents are known to skip phases to "save time." This is explicitly forbidden.

**Common skip patterns — ALL are violations:**

| Skip pattern | Why agents do it | Why it's forbidden |
|---|---|---|
| Skip CLARIFY, jump to BUILD | "The task seems obvious" | Unexamined assumptions cause rework |
| Skip PLAN, jump to BUILD | "It's a small change" | Small changes grow; no plan = no checkpoint |
| Skip VERIFY after BUILD | "Tests passed earlier" | Stale results are not evidence |
| Skip REVIEW after VERIFY | "I wrote it, I know it's correct" | Author blindness is real |
| Skip POST-REVIEW | "I already reviewed in phase 7" | Phase 7 is a code-review pass; POST-REVIEW is the final conservative gate (human in default mode, Scope Guard in AMAW). Different scope, different agent. **NEVER skippable.** |
| Skip SESSION before COMMIT | "I'll update later" | You won't. Context is lost. Scribe must run. |
| Combine multiple phases | "CLARIFY+DESIGN+PLAN in one go" | Each phase boundary triggers a different sub-agent — combining skips the agent |

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
| **M** | 3-5 | 4+ | Maybe | No skips allowed. Full 12 phases. |
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
2. Detect mode: AMAW if user trigger present (`/amaw`, "use AMAW"), else default v2.2
3. Before starting any phase, update `.workflow-state.json` (workflow-gate.sh phase <name>)
4. Before leaving any phase, append an event to `docs/audit/AUDIT_LOG.jsonl` (one JSON line)
5. After completion: `./scripts/workflow-gate.sh complete <phase> "<evidence>"`
6. If during work you discover the task is larger than classified — STOP, reclassify, append `size_change` event to AUDIT_LOG
7. Default mode: human is the gate at CLARIFY end and POST-REVIEW. AMAW mode: Scope Guard. Either way: no self-authorized skips.

**Task types:** `[FE]` frontend only · `[BE]` backend only · `[FS]` full-stack (backend + frontend)

### Role perspectives

**Main session roles (executor, both modes):**
- **Architect** — scoping, dependencies, system-level impact
- **Developer** — implementation, TDD, verification, session tracking, commits

**Default mode (v2.2) review:**
- Main session does self-review at REVIEW phases with explicit adversarial framing ("if you wanted to break this, where would you look?")
- Human approves at CLARIFY end + POST-REVIEW end before SESSION

**AMAW mode sub-agent roles (cold-start, read files only):**
- **Adversary** — finds exactly 3 problems (design review + code review). Never says what's good.
- **Scope Guard** — compares spec fingerprint vs implementation, checks AC coverage, final gate
- **Scribe** — records all decisions, detects deferred items, writes SESSION_PATCH + DEFERRED.md + AUDIT_LOG
- **Audit Logger** — writes `add_lesson` to MCP, finalizes AUDIT_LOG.jsonl at RETRO

See `docs/amaw-workflow.md` for full AMAW prompt templates and spawn protocol.

---

### AMAW Sub-Agent Spawn Protocol (opt-in, when AMAW mode is active)

**When main session spawns a sub-agent (AMAW mode only):**
1. Ensure required input files exist (spec, plan, prior AUDIT_LOG events)
2. Spawn the agent with a prompt that specifies ONLY the files it should read — never the chat history
3. Agent appends its verdict event to `docs/audit/AUDIT_LOG.jsonl`
4. Main session reads the agent's event — if REJECTED/BLOCKED, fix and respawn
5. After completion: `./scripts/workflow-gate.sh complete <phase> "<evidence>"`

**AUDIT_LOG.jsonl event format (one line per event):**
```jsonl
{"ts":"2026-05-15T17:42:00Z","task":"phase-14-model-swap","phase":"review-design","agent":"adversary","action":"review","status":"REJECTED","findings_count":3,"block_count":2,"warn_count":1,"note":"..."}
```

Common actions: `phase_enter`, `phase_complete`, `review`, `qc`, `deferred_detected`, `size_change`, `commit`, `sprint_complete`.

**Deferred item protocol (both modes):**
Any time main session output contains "later", "deferred", "future sprint", "out of scope", "TODO", "TBD" → write it to `docs/deferred/DEFERRED.md` before SESSION phase completes. In AMAW mode the Scribe handles this; in default mode the main session does. An item mentioned only in chat does not exist.

**Context budget guard (AMAW only):**
If BUILD phase has 3+ tasks completed without spawning any agent → spawn Scribe checkpoint before continuing.

**Full AMAW prompt templates:** `docs/amaw-workflow.md` — Sub-Agent Prompt Templates section.

---

### Phase 1: CLARIFY

Don't jump into code — clarify first.

1. **Explore context** — `search_lessons(query: "<task intent>")`, read relevant files, git history
2. **Scan DEFERRED.md** for items whose trigger condition is now met (AMAW mode: spawn Scribe to do this; default mode: main session does)
3. **Write assumptions** — explicit scope, constraints, open questions to `docs/specs/YYYY-MM-DD-<topic>.md`
4. **Propose 2-3 approaches** with trade-offs
5. **Self-review spec** — check for placeholders, contradictions, ambiguity, scope creep
6. **Default mode:** present spec to human, get explicit OK before proceeding. **AMAW mode:** assumptions are written explicitly and challenged by Adversary at next phase — no human approval gate.
7. **Append `phase_complete`** event to AUDIT_LOG.jsonl, then `./scripts/workflow-gate.sh complete clarify "<one-liner>"`

**Skip conditions:** Only for tasks classified **XS** (1 file, 0-1 logic changes, 0 side effects).

---

### Phase 4: PLAN (Task Decomposition)

Break work into executable chunks before coding.

- Decompose into **bite-sized tasks (2-5 minutes each)**
- Each task specifies: **exact file paths, complete code intent, verification command**
- **No placeholders allowed** — no "TBD", "TODO", "add error handling here"
- Write plan to `docs/plans/YYYY-MM-DD-<feature>.md`
- **AMAW mode:** spawn Scribe to validate plan (no placeholders, tasks are concrete, size classification correct). **Default mode:** main session self-validates.
- Append `phase_complete` event to AUDIT_LOG.jsonl
- **Run** `./scripts/workflow-gate.sh complete plan "<N> tasks, size <XS|S|M|L>"`

**Execution mode decision** (for large plans):
- **Inline** (default): main session executes tasks sequentially with context-budget checkpoints
- **Subagent dispatch** (multi-file, independent tasks): fresh agent per task, Adversary review per batch

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

### Phase 9: POST-REVIEW — NEVER skippable

**Why this phase exists:** the final conservative gate before SESSION. Reads the full picture (verify events + code-review events + qc events from AUDIT_LOG) and issues a single verdict. Any unresolved issue from any prior review = BLOCKED.

**Default mode:** human reviews the AUDIT_LOG, the spec, and the diff. Confirms all REVIEW findings addressed, AC coverage matches, no spec drift. Approves with "POST-REVIEW OK" or rejects with specific findings.

**AMAW mode:** spawn Scope Guard (cold-start). Reads AUDIT_LOG.jsonl events + spec + design + diff. Writes verdict event with `status: CLEAR | BLOCKED`. If BLOCKED → fix the specific blocker → re-run QC → re-run POST-REVIEW.

**What gets checked (either mode):**
1. Spec fingerprint (design event hash vs current DESIGN.md) — unexplained drift = BLOCKED
2. All REVIEW-CODE BLOCK findings resolved
3. AC coverage complete (all listed acceptance criteria covered or explicitly deferred)
4. No OPEN deferred items with trigger condition already met

**Completion evidence:**
```
./scripts/workflow-gate.sh complete post-review "<reviewer> CLEAR: <one-liner>"
```

**For safety-sensitive code** (auth, tenant isolation, destructive ops, injection defense, new service boundary): in AMAW mode, spawn a second Adversary with security framing before Scope Guard runs. In default mode, the human should explicitly walk a security checklist. See `docs/amaw-workflow.md` — Anti-Consensus Mechanisms.

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
- After Phase 10 (SESSION) of the 12-phase task workflow (v2.2)
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
Phase 9 ✅      Phase 10 ✅     Phase 11 ✅
Multi-Project   Multi-format    Knowledge
UX Redesign     Ingestion       Portability
Cross-project   PDF, DOCX,      Bundle format,
views, project  Images, URL,    export+import,
selector V2,    Vision + hybrid cross-instance
"All Projects"  chunk search    pull, GUI
    │               │               │
    ▼               ▼               ▼
Phase 12 ✅     Phase 13 ✅     Phase 14 ✅     Phase 15 ✅
RAG Quality &   Multi-Agent     Global Model    Multi-Actor
Rerank Optim.   Coordination    Swap            Coordination
Golden-set,     Artifact leases bge-m3 +        Event log, Board,
recall@k/MRR,   pending-review, nemotron-nano,  Requests, Collective
8+8 model       taxonomy        re-embed        Decision, Disputes,
benchmarks      profiles        in-place        Authz model, tenant
                                                scope (15.1–15.12)
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
| **11** | ✅ Complete | Knowledge portability — zip+JSONL bundle format with manifest+sha256, full project export streaming via pg-cursor, full project import with conflict policies + dry-run + cross-tenant guard, GUI Knowledge Exchange panel, cross-instance pull endpoint with DNS-rebinding pinning + slow-loris defense, streaming JSONL decode + streaming base64 encode, batched SELECT import (~99% query reduction), 61 API e2e + 1 GUI Playwright + 39 unit tests (9 sub-sprints, 6 commits, all through v2.2 workflow with /review-impl). |
| **12** | ✅ Complete | RAG quality measurement & rerank optimization — golden-set harness (recall@k, MRR), p50/p95 latency budgets, 8-model embedding benchmark + 8-model reranker benchmark (qwen3-4b-instruct-ranker 85% pass @1.8s recommended; no-rerank baseline 76% @99ms), reranker slot in tiered search with graceful fallback, reproducible reports in `docs/benchmarks/` (7 sprints). |
| **13** | ✅ Complete | Multi-agent coordination protocol — artifact ownership/leasing (`artifact_leases`, TTL + lazy/background sweep, fencing), `pending-review` lesson state + Review-Request queue, taxonomy profiles (unified with `lesson_types`), agent-attributed claims; 19-bug post-hoc review fully cleared (7 sprints). |
| **14** | ✅ Complete | Global embedding/distillation model swap — mxbai-large→bge-m3 + qwen-coder→nemotron-3-nano, all projects re-embedded in-place. DEFERRED-002 (mxbai 512-token truncation) RESOLVED; per-project model routing (DEFERRED-001) ABANDONED as unneeded. |
| **15** | ✅ Complete | Multi-actor coordination protocol — durable append-only event log + Topic/Actor model, the Board (tasks/artifacts/claims + fencing + abandoned-claim sweep), Request-Approval (multi-level routing), Collective Decision (motions/votes/tally/veto), intake mailbox + dispute resolution, topic-closing 3-phase drain, primitive-outcome chaining, multi-tier collective routing, authorization model (3 HARD pre-prod triggers), end-to-end tenant-scope enforcement. 12 sprints (15.1–15.12), migrations 0050–0063. Closeout: `docs/phase-15-closeout.md`. |
| **DEFERRED-029** | ✅ Complete | MCP tenant-scope enforcement — service-layer `callerScope` threaded through ~115 fns across 8 domain PRs (B/C1/C2/C3/D1/D2/D3/D4) + PR E (retire legacy `CONTEXT_HUB_WORKSPACE_TOKEN` with `MCP_LEGACY_TOKEN_DISABLED` opt-out) + PR F (auth-ON E2E + 5 verification passes catching 7 bypasses). 10 helpers (`assertCallerScope` + 8 DB-derive `assertXScope` + Multi). Tests: 843 unit + 300 E2E (api/gui/smoke/agent). Closeout: `docs/deferred-029-closeout.md`. Migration: `docs/specs/2026-05-23-deferred-029-pr-e-legacy-token-migration.md`. |

## Safety-sensitive review policy

For any sprint that introduces an **authorization primitive**, **tenant-isolation logic**,
**governance/decision primitive**, **new service boundary**, or **destructive operation**:

- Run a **cold-start hostile-actor adversary review** (not `/review-impl` coverage) during
  REVIEW-CODE or POST-REVIEW. Adversary must have NO prior context — read files only.
- **Multi-pass is not redundant** — each pass catches a different class of pattern. Expect
  3–4 passes to saturate (curve usually 3→2→1→0). Sprint 15.3 lost 2 CRITICAL bugs by
  skipping this; DEFERRED-029 PR F caught 7 bypasses across 5 passes.
- **Live verification of the documented end-state** catches what static review misses.
  When adding a security flag, grep for every authn/authz fast-path the flag should affect.

Enforced via guardrail (`5c0b7b25`) and reusable lesson `5287a774`. See
`docs/deferred-029-closeout.md` § "Architectural lessons" for the four-pass pattern.

## Baseline-stack invariant (Phase 17.x)

**Before running `npm run qc:baseline:gen`, the LM Studio + sidecar stack
must be in a controlled state.** Otherwise LM Studio's auto-unload will swap
models mid-run, producing 6-11% baseline ECONNRESET / Channel Error failures
(per [lmstudio-bug-tracker#945](https://github.com/lmstudio-ai/lmstudio-bug-tracker/issues/945))
and contaminating measurement.

**The invariant:**

1. LM Studio has **exactly two models loaded** simultaneously:
   - Chat model (e.g. `mistralai/mistral-nemo-instruct-2407`) — answerer, judge, reranker all share it
   - Embeddings model (`text-embedding-bge-m3`)
2. **All chat callers** (answerer, judge sidecar, MCP reranker, distillation worker) point at the SAME chat model so no swap is ever triggered.
3. The ragas-judge sidecar's `JUDGE_AGENT_MODEL` env matches what the runner sets `ANSWERER_AGENT_MODEL` to.
4. `DISTILLATION_MODEL` is unset/empty during baseline (worker no-ops; prevents background swap).

**Enforcement:**

- `.env.baseline` — canonical pins for every chat/judge/rerank/distillation env var.
- `scripts/start-baseline-stack.sh` — restarts MCP + worker + ragas-judge with `.env.baseline` overrides, then runs preflight.
- `scripts/preflight-baseline.mjs` — standalone preflight check (also invoked from inside `runBaseline.ts`); refuses to proceed if invariant violated.
- `runBaseline.ts` has a built-in preflight call. Use `--no-preflight` only for dev iteration, NEVER for committed measurements.

**Recommended invocation:**

```bash
# 1. Load the two expected models in LM Studio (Developer page or `lms load`)
# 2. Start the controlled stack:
bash scripts/start-baseline-stack.sh
# 3. Run the baseline:
ANSWERER_AGENT_MODEL=mistralai/mistral-nemo-instruct-2407 \
RAGAS_JUDGE_URL=http://localhost:3005 \
  npx tsx src/qc/runBaseline.ts --tag <date>-<descriptor> --gen-eval on
```

**Documented in:** `docs/qc/2026-05-24-phase-17-answerer-model-selection.md` (model rationale) + the smoke baselines under `docs/qc/baselines/`.

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
