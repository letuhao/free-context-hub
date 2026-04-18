# ContextHub (Self-Hosted) White Paper

## Status
Draft v0.4 (Phase 11 complete — 2026-04-18)

## Abstract
ContextHub is a self-hosted, team-friendly system that gives MCP-enabled AI coding agents **persistent memory and guardrails across sessions**. It is designed for small teams that want the essential productivity benefits of [ContextStream](https://contextstream.io/)-like workflows, without requiring a hosted SaaS dependency.

**The core problem:** every new AI agent session starts from zero. Decisions, preferences, workarounds, and constraints are forgotten. Teams repeat the same mistakes. Engineers re-explain the same architectural choices. ContextHub solves this by making agent knowledge persistent and shared.

**The expanded vision:** ContextHub has evolved from an AI-only tool to an **AI-to-AI and AI-to-Human bridge**. While agents capture knowledge automatically via MCP, humans need to review, approve, refine, and teach agents through that knowledge. The system serves both audiences — agents produce knowledge, humans curate it, and everyone benefits.

**Primary features (the reason this project exists):**
- **Persistent lessons** — decisions, preferences, workarounds captured once, available to every future agent session
- **Guardrails** — team rules enforced before risky actions (push, deploy, migrations)
- **Session bootstrap** — new agents onboard instantly with project context and prior knowledge
- **Human-in-the-loop GUI** — web dashboard for reviewing, approving, editing, and enriching AI-generated knowledge

**Supplementary features (assistive, not the core goal):**
- Semantic code search (tiered retrieval with kind-filtered precision)
- Git intelligence (auto-draft lessons from commit history)
- Knowledge graph (optional symbol-level code structure via Neo4j)
- Document management (attach reference docs, generate lessons from documents)

Code search is supplementary because modern AI agents already have capable built-in tools for code navigation (Grep, Glob, file reading). What they lack — and what no built-in tool provides — is **persistent cross-session memory**. That is ContextHub's unique value.

ContextHub is inspired by ContextStream's "persistent memory + semantic code search + guardrails" concept. Reference: https://contextstream.io/

## Problem Statement
AI coding assistants often suffer from:
- Context loss: useful decisions, preferences, and constraints are forgotten between sessions/tools
- Search friction: engineers re-explain architectures or re-locate code manually because the assistant cannot reliably "find the right place"
- Safety regressions: teams repeatedly make the same mistakes (for example, pushing without running tests)

Large products solve this via hosted persistent memory and indexing, but small teams typically need:
- Self-hosting (control, cost predictability, and data residency)
- Minimal complexity (avoid enterprise-grade overhead)
- Clearly scoped core features that work well out-of-the-box

## Goals (Priority Order)

### Primary Goals (Core Value)
1. **Persistent cross-session memory** — the #1 reason this project exists
   - Store decisions, preferences, workarounds, and "lessons learned" that persist after sessions end
   - Share knowledge across multiple agents and team members within the same `project_id`
   - Enable instant onboarding: new agent sessions bootstrap from accumulated team knowledge
2. **Guardrails that prevent repeated mistakes**
   - Enforce critical workflow rules (tests before push, migration review, etc.) using simple, auditable checks
   - Derived from lessons — the team's own captured experience drives enforcement
3. **Self-hostable with minimal complexity**
   - One-node deployment (Docker Compose); no cloud dependency
   - Data stays on team's hardware; full control and data residency

### Supplementary Goals (Assistive Features)
4. **Code search** — assists agents in finding relevant code
   - Tiered retrieval (ripgrep > symbol > FTS > semantic) with kind-filtered precision
   - Useful but not essential — agents have built-in Grep/Glob that work well for most searches
5. **Git intelligence** — auto-draft lessons from commit history
   - Reduces manual lesson capture effort
6. **Knowledge graph** — optional symbol-level structure (Neo4j)
   - Enables cross-reference queries (callers, importers, impact analysis)
   - Optional: all core features work without it

## Non-Goals (MVP Scope Limits)
- Full dependency impact analysis across the entire repo (deferred to later versions)
- Complex knowledge-graph UI/visualization (optional in later versions)
- Automated code modification across the repo without explicit user approval (safety by design)
- Enterprise identity integrations (SAML/SSO) in MVP

## User Roles and Primary Workflows
### Developer Workflow: "Remember my preferences"
1. The developer states a preference or constraint once (e.g., "We use strict TypeScript").
2. ContextHub stores it as a lesson or preference node.
3. In later sessions, the assistant queries ContextHub and reuses the stored preferences automatically.

### Developer Workflow: "Find the right code by intent"
1. Developer asks a natural language question (e.g., "Where do we verify sessions?").
2. ContextHub returns matching code excerpts and metadata (files, symbols, and relevance).
3. The assistant uses that context to answer or implement changes.

### Developer Workflow: "Never repeat workflow mistakes"
1. A previous failure is captured as a lesson (e.g., "Do not push without tests").
2. A guardrail rule is generated.
3. Before executing risky actions (for example, `git push`), ContextHub runs the guardrail check and prompts for required confirmation.

## System Overview (High-Level Architecture)
ContextHub is composed of:
- **Lessons/Knowledge Store** (core — the primary service)
  - Stores lessons, preferences, guardrails, and workarounds keyed by `project_id`
  - Semantic search over lesson embeddings for retrieval
  - Lifecycle management (draft → active → superseded → archived)
- **Guardrails Engine** (core)
  - Translates lessons into rule checks
  - Enforces preconditions before risky tool execution
- **Session Bootstrap** (core)
  - Project summaries, context bootstrapping, and knowledge onboarding for new sessions
- **MCP Server** (core)
  - Exposes tools/resources to MCP clients (Claude Code, Cursor, etc.)
- **Code Indexing & Retrieval** (supplementary)
  - Discovers files, chunks, embeds, and stores in pgvector
  - Tiered search (ripgrep > symbol > FTS > semantic) with kind-filtered precision
- **Git Intelligence** (supplementary)
  - Ingests commit history, suggests lessons from changes
- **Knowledge Graph** (optional)
  - Neo4j symbol-level structure for cross-reference queries

Typical flow (core):
1. Agent starts session → `get_context()` + `search_lessons()` to bootstrap
2. Agent works → `check_guardrails()` before risky actions
3. Agent learns something → `add_lesson()` to persist for future sessions
4. Next agent session → benefits from all previously captured knowledge

Supplementary flow:
5. `index_project()` for code search (on-demand or background)
6. `search_code_tiered()` to find relevant code when agent needs it

## Core Components (MVP Design)
### 1. MCP Interface Layer
MVP provides a small set of MCP tools:
- `index_project(root, options)` (idempotent)
- `search_code(query, filters, limit)` (structured results)
- `get_preferences(project_id)` (lessons tagged as preferences)
- `add_lesson(lesson_payload)` (captures a decision/constraint/mistake)
- `check_guardrails(action_context)` (returns pass/fail + required user confirmation)

Design principle: tools are deterministic where possible and responses are structured (JSON) to support robust client behavior.

### 2. Ingestion / Indexing
Indexing must be:
- Incremental: re-index only changed files
- Configurable: allow explicit include/exclude patterns
- Secret-aware: default ignore patterns exclude `.env`, keys, credentials, and lockfiles if configured

MVP indexing pipeline:
1. File discovery
2. Filtering via:
   - allowed roots
   - ignore rules (e.g., `.contexthub/ignore`)
3. Chunking (by file + semantic boundaries if possible)
4. Embedding generation
5. Storage:
   - vectors
   - chunk metadata (path, line ranges, language, timestamps, symbols if available)

### 3. Semantic + Hybrid Retrieval
MVP retrieval:
- Semantic similarity search over embeddings
- Optional lexical/symbol signals if cheap to compute

Returned context format (example):
- `matches[]: { path, start_line, end_line, snippet, score, match_type }`
- `explanations[]` (short, optional): why results were selected (useful for debugging)

Reranking:
- MVP can use vector similarity directly.
- Later versions can add lightweight reranking.

### 4. Persistent Memory Model (Lessons & Preferences)
ContextHub stores "lessons" as first-class objects (scoped by `project_id`):
- `lesson_type`: `decision | preference | guardrail | workaround | general_note`
- `title`: short human label
- `content`: structured text
- `tags`: e.g. `typescript`, `ci`, `auth`
- `source_refs`: optional references to file paths, commits, or MCP events
- `created_at`, `updated_at`, `captured_by`

Preferences are lessons with special tags (for example: `preference-*`).

Guardrails are lessons with a rule form:
- `trigger`: what action or context should cause enforcement
- `requirement`: what must be true (e.g., "tests run")
- `verification_method`: minimal check (CLI exit codes, recorded CI status, or explicit user confirmation)

### 5. Guardrails Engine (Minimal, Auditable)
MVP goal: prevent the most common workflow failures with simple checks.

Example guardrail:
- Lesson: "Always run full test suite before any push."
- Guardrail action:
  - Trigger when MCP client requests `git push` (or an equivalent action tool)
  - Check for a recent completed test event recorded in the workspace
  - If missing:
    - return `needs_confirmation: true`
    - provide a clear prompt: "Run tests locally or proceed anyway"

Auditing:
- Log guardrail decisions and the reason for pass/fail

## Storage and Data Model (Self-Host Friendly)
To keep MVP practical for self-hosters, ContextHub should support multiple storage backends.

Minimum viable storage options:
- Relational metadata store: `PostgreSQL` or `SQLite`
- Vector index: `pgvector` (Postgres) or a local vector store

MVP recommendation:
- Default: `PostgreSQL + pgvector` for simplicity and reliability
- Dev mode: `SQLite` where feasible, with a pluggable vector strategy

Indexing data:
- `projects` table (project_id, name, settings)
- File table (project_id, path, hash, last_indexed_at)
- Chunk table (project_id, file_id, chunk_id, line ranges, content, embedding metadata)
- Lesson table (project_id, lesson_id, type, tags, title, content, timestamps)
- Guardrail table (project_id, rule payload)
- Vector rows linked to their owner records (chunk_id and/or lesson_id)

## Security, Privacy, and Threat Model
ContextHub is designed for local/team scenarios:
- Data must not be silently shared outside the self-host environment
- Secrets must be excluded by default
- Access must be controlled per `project_id`

Security requirements (MVP):
1. Secret exclusion by default
   - Ignore patterns for `.env`, `*.key`, credential files, and optionally dependency caches
2. Encryption in transit
   - Use HTTPS/TLS for any network endpoints
3. Encryption at rest (where possible)
   - Enable database encryption options and/or OS-level encryption recommendations
4. Access control
   - Workspace token-based access for MCP clients
5. Delete and retention controls
   - Provide a mechanism to delete workspace data on request

Prompt-injection considerations:
- Indexing: content comes from files; treat retrieved text as untrusted input
- Guardrails: validate rule triggers/contexts strictly and do not execute arbitrary commands

## Deployment Model
### MVP Deployment Targets
- Local developer machine
- Small team, single node (Docker Compose or equivalent)

Recommended deployment steps:
1. Configure workspace:
   - root paths to index
   - ignore rules
   - API tokens / credentials
2. Start ContextHub services
3. Run initial indexing
4. Connect MCP clients via configuration

## Observability and Operations
Core operational features:
- Indexing status:
  - last successful index time
  - number of files/chunks processed
  - last error (if any)
- Retrieval debugging:
  - show top-k match metadata for audit
- Guardrail logs:
  - rule triggered, inputs used, decision output

MVP metrics (lightweight):
- indexing duration and throughput
- search latency (p50/p95)
- guardrail enforcement count

## Evaluation Plan
To ensure the MVP delivers value, measure:
1. Retrieval quality
   - Use a curated set of "questions -> expected code locations"
   - Track recall@k and/or manual validation rate
2. Lesson usefulness
   - Track how often preferences/lessons appear in successful answers
3. Guardrail effectiveness
   - Track how often the guardrail prevents a known class of mistakes

Safety evaluation:
- Ensure guardrails never silently allow risky actions without required verification steps.

## Roadmap

### Phase 1-2: Core MVP
- MCP interface (index/search/preferences/lessons)
- Local indexing with ignore rules and secret exclusion
- Semantic search returning structured snippets (vector-first)
- Lesson capture + basic guardrails enforcement (project-scoped)

### Phase 3: Knowledge Distillation
- LLM-powered lessons distillation (Phase 3)
- Semantic reflection and context compression
- Project snapshots and automated briefings

### Phase 4: Advanced Indexing & Knowledge Graph
- **Neo4j 5.x** optional backend (`KG_ENABLED`); TS/JS extraction via **ts-morph** during `index_project`
- Deterministic node ids + idempotent `MERGE` upserts (Project/File/Symbol/Lesson)
- Code edges: `DECLARES`, `CALLS`, `IMPORTS`, `EXTENDS`, `IMPLEMENTS`
- Lesson edges from `add_lesson`: `MENTIONS`, `CONSTRAINS` (guardrails), `PREFERS` (preferences) — driven by `source_refs` paths (optional `path:Symbol`)
- MCP tools: `search_symbols`, `get_symbol_neighbors`, `trace_dependency_path`, `get_lesson_impact`
- **Fallback:** when `KG_ENABLED=false`, graph ingest/query is skipped with explicit warnings; Phase 1–3 flows remain unchanged

### Phase 5: Automation & Git Intelligence
- Postgres-backed git ingestion tables (`git_commits`, `git_commit_files`, `git_ingest_runs`) with idempotent upsert by `project_id + sha`
- MCP tools: `ingest_git_history`, `list_commits`, `get_commit` for read/write automation flow
- Draft automation: `suggest_lessons_from_commits` + `link_commit_to_lesson` (review-first, no forced auto-activation)
- Graph-assisted impact: `analyze_commit_impact` reuses Phase 4 symbol/lesson links when `KG_ENABLED=true`
- Fallback: when `GIT_INGEST_ENABLED=false`, Phase 5 tools return graceful warnings and do not affect Phase 1–4

### Phase 5 Hardening Addendum
- Correlation-scoped queue reporting: `list_jobs` supports filtering by `correlation_id` so one run window can be reported deterministically; worker fan-out jobs inherit parent correlation.
- Operational smoke coverage: dedicated optional smoke block validates `prepare_repo`, `enqueue_job`, `run_next_job`, and `scan_workspace` in one execution path.
- Deep worker validation: `validate:phase5-worker` now checks clone/sync evidence, queue-chain completion (`repo.sync -> git.ingest -> index.run`), retrieval quality, and DB-side proof (`chunks`, `files`, `git_commits`).
- Continuous verification: scheduled CI workflow runs Phase 5 worker validation periodically against `https://github.com/letuhao/free-context-hub` with a mock embeddings service for stable, reproducible runtime checks.

**Acceptance Criteria (Release Checklist)**
- `list_jobs(correlation_id=...)` returns only jobs in that run window; `repo.sync` child jobs (`git.ingest`, `index.run`) share the same correlation id.
- `prepare_repo` succeeds for the target repository and returns a non-empty `last_sync_commit` and valid `repo_root`.
- Worker pipeline completes with `repo.sync -> git.ingest -> index.run` all reaching `succeeded` within the configured timeout.
- Validation evidence exists in storage: `git_commits > 0`, `files > 0`, and `chunks > 0` for the validated `project_id`.
- CI scheduled workflow (`phase5-worker-validation`) passes and produces a machine-readable validation artifact with all gates marked pass.

### Phase 6: Active Knowledge & Deep Learning Loop

Phases 1–5 are primarily **passive learning**: index source, build vectors, optionally ingest git and upsert a knowledge graph—knowledge reflects what is already in the repository and its history. Phase 6 adds a **controlled improvement loop** so teams can raise retrieval quality (recall, MRR, usefulness) without giving up provenance and audit trails.

**Motivation**

- Passive indexing misses “implicit” context: canonical entrypoints, naming conventions, and intent that engineers know but that do not surface strongly in embeddings alone.
- Cold starts and mid-project pivots leave RAG weak until large bodies of code or docs exist.
- Phase 6 targets measurable uplift (e.g. golden-set recall@k, MRR, latency budgets) while keeping every promoted artifact traceable.

**Actors**

- **Coder / IDE agent:** proposes facts, lesson drafts, and structured `source_refs` (paths, optional symbols/commits); may attach confidence or scope.
- **Builder agent:** aggregates candidates into durable artifacts (e.g. FAQ/RAPTOR-style summaries, synthetic indexed paths), triggers re-indexing through existing pipelines.
- **QC agent:** runs curated evaluations (golden queries, `qc:rag`-style harnesses), compares before/after metrics, and checks regressions on defined failure clusters.
- **Judge / gate:** rule-based thresholds plus fixed budgets—not self-grading LLM loops alone; human review remains optional for sensitive promotions.

**Data & lifecycle**

- Lessons and generated knowledge follow explicit lifecycle states (e.g. `draft` → `active` → `superseded` / `archived`) aligned with Phase 3 lesson semantics.
- Canonical storage remains **DB-first** for generated artifacts where applicable, with optional filesystem exports; see `docs/storage/storage-contract.md`.
- Provenance is mandatory for promotion: `source_refs` and, where available, links to Phase 4 symbols or Phase 5 commits.

**Worker model: shallow pass → deep pass**

- **Shallow pass:** after `index_project` or on a schedule—enqueue digest jobs (FAQ/RAPTOR generation, snapshot refresh), index synthetic document paths, bump retrieval cache as today.
- **Deep pass (bounded recursion):** up to *N* rounds per run. Each round: Builder proposes candidates → incremental index → QC measures deltas → accept only if metrics improve within gates and critical clusters do not regress; otherwise discard, keep draft, or rollback.
- **Early stop:** marginal gain below epsilon, time/token budget exhausted, or hard QC failure.

**Acceptance & safety gates**

- Example gates: minimum delta on `recall@k` / MRR, p95 latency ceiling, and no worsening on named query groups (e.g. server entrypoints, config) without a mitigation path.
- Optional human approval for promoting high-impact `draft` content to `active`.

**Risks & mitigations**

- **Feedback loops that reinforce errors:** version artifacts, retain A/B or run-scoped artifacts, support rollback to last-known-good.
- **Overfitting to internal benchmarks:** diversify golden sets and re-run evaluations on a cadence.
- **Cost:** async workers, Redis-backed retrieval/rerank caching where enabled, and strict caps on recursion depth and candidate volume.

**Relationship to later phases**

- **Phase 7:** GUI makes it easier to review drafts and inspect knowledge before promotion.
- **Phase 8–9:** Human-in-the-loop editing and multi-format ingestion widen the surface of facts the deep loop can safely absorb.

### Phase 7: Interactive GUI & Human-in-the-Loop (In Progress)

Phase 7 represents a major shift: ContextHub evolves from an **agent-only backend** to an **AI-Human collaboration platform**. The web GUI (Next.js 16 + React 19 + Tailwind CSS) serves as the bridge where humans review, approve, and refine AI-generated knowledge.

**Status:** Core 14 pages and 15 shared components are functional. GUI enhancement phase is in **draft design** stage — 21 page drafts + 16 component drafts completed as standalone HTML references (`docs/gui-drafts/`). Implementation pending.

**Core pages (functional):**
- Dashboard, Chat (AI SDK streaming), Lessons (CRUD + search), Guardrails (test panel), Jobs (queue monitor), Knowledge (Generated Docs, Graph Explorer, Code Search), Projects (Overview, Groups, Git History, Sources), Settings (System info, Model Providers)

**Planned enhancements (drafted, not yet implemented):**

*AI-to-Human bridge features:*
- **Review Inbox** — Draft→Review→Active approval pipeline for AI-generated lessons, with agent trust levels and batch review
- **AI-Assisted Editor** — Select text chunks → Ask AI (Clarify/Simplify/Expand/Custom prompt) → diff view with per-chunk Accept/Reject → dirty indicator
- **"Create Lesson from Answer"** — One-click conversion of chat responses to lessons with pre-filled fields
- **Feedback signals** — Thumbs up/down on lessons with retrieval count tracking, enabling quality metrics

*Knowledge management features:*
- **Document Management** — Upload/link reference docs (PDF, MD, URL), in-document search, generate lessons from documents
- **Knowledge Analytics** — Retrieval trends, dead knowledge detection, agent activity tracking, approval rates
- **Global Search (Cmd+K)** — Cross-entity search across lessons, documents, code, guardrails, commits
- **Comments & Discussions** — Threaded comments on lessons with @mentions and auto-review bot
- **Bookmarks / Favorites** — Personal quick-access collections

*Onboarding & adoption:*
- **Guided Onboarding** — Curated learning path for new team members with section-based progress tracker
- **Keyboard Shortcuts** — Power-user overlay (? key) with navigation, editor, and AI action shortcuts

*UI polish:*
- Lucide React icon library (replacing emoji), breadcrumbs, sticky table headers, modal/toast animations, markdown rendering in chat with syntax highlighting, enhanced pagination (page numbers + jump box)
- Import/Export (JSON, CSV, Markdown parsing)

**Relationship to later phases:** Phase 7 absorbs significant portions of what was originally planned for Phase 8 (human-in-the-loop) and Phase 9-10 (document ingestion, import/export). The GUI enhancement drafts serve as the design specification for implementation.

### Phase 8: Advanced Human-in-the-Loop — ✅ Complete
Delivered across 8 + 8D + 8E sprints. Shipped: access control (API keys with reader/writer/admin roles), custom lesson types (table-backed, GUI-editable), rich content editor (markdown toolbar), agent audit trail (unified timeline from guardrail logs + lessons), feature toggles (per-project). E2E test suite: 198 tests (API smoke 75 / GUI smoke 23 / MCP smoke 36 / API scenarios 34 / GUI scenarios 21 / Agent visual 9).

### Phase 9: Multi-Project UX Redesign — ✅ Complete
Originally framed as "Multi-format Ingestion" — that scope was split. The ingestion work shipped as Phase 10 (below). Phase 9 became the multi-project UX redesign: "All Projects" first-class mode, project selector V2 (multi-select checkboxes), ProjectBadge on all 23 pages, cross-project data on 8 pages, per-project guards on 4 pages. 11 sprints, 26 commits, 41 files.

### Phase 10: Multi-Format Extraction Pipeline — ✅ Complete
The "Multi-format Ingestion" feature set, renumbered and shipped in full. PDF / DOCX / EPUB / ODT / RTF / HTML / markdown + image (PNG/JPEG/WebP) support. Three extraction tiers:
- **Fast**: pdf-parse + mammoth — sync, no external deps
- **Quality**: pdftotext + pandoc — sync, tool-dependent
- **Vision**: LLM via OpenAI-compatible API — async, per-page, progress + cancel

Plus: chunking + pgvector embeddings (hierarchical/naive strategies, table/code/mermaid detection), hybrid semantic+FTS chunk search (REST/Cmd+K/chat tool/MCP tool), chunk edit/delete with optimistic locking, bulk re-extract, SSRF-hardened URL ingestion, mermaid rendering. 7 sprints, 7 migrations, 47-test E2E suite.

### Phase 11: Knowledge Portability — ✅ Complete
The "Exchange Hub" vision, shipped as 9 sub-sprints:
- **Bundle format**: zip + manifest.json + per-entity JSONL with sha256 per entry — streaming encoder/decoder
- **Full export**: `GET /api/projects/:id/export` streaming via pg-cursor
- **Full import**: `POST /api/projects/:id/import` with 3 conflict policies (skip / overwrite / fail) + dry-run + **cross-tenant UUID guard** (refuses to overwrite rows owned by another project)
- **GUI panel**: drag-drop Knowledge Exchange in Project Settings (Preview → Apply)
- **Cross-instance pull**: `POST /api/projects/:id/pull-from` with **DNS-rebinding pinning** (via custom undici Agent) + **slow-loris body-stall defense** (60s idle timer)
- **Streaming polish**: ~99% peak memory reduction on JSONL decode, ~45% on document base64 encode
- **Perf polish**: ~99% SELECT-count reduction on import via batched `= ANY($1::uuid[])`

61 API e2e + 1 GUI Playwright + 39 unit tests. All 9 sub-sprints shipped through the v2.2 12-phase workflow with `/review-impl` — 23+ findings caught across the phase, zero regressions in live reruns.

### What's deferred beyond Phase 11
- Merge conflict policy (beyond skip/overwrite/fail)
- Bundle caching for repeat cross-instance pulls
- Webhook / scheduled pulls
- GUI for cross-instance pull (currently API-only)
- Encryption / signing on bundles
- Migrate `documents.content` TEXT → BYTEA (lifts V8 ~512 MB string heap ceiling; Phase-10-level change)

### Dropped: Multi-Agent Passive Collection

Originally planned as "Phase 7: Multi-Agent Knowledge Sharing" — passively collecting knowledge from inter-agent communications.

**Why it was dropped:**

1. **Token cost contradicts core goal.** Parsing agent conversations requires an LLM, consuming tokens. The project's purpose is to *reduce* token usage, not add new token-consuming pipelines.

2. **Low signal-to-noise ratio.** Most agent conversation is debugging, trial and error, and exploration. Extracting useful lessons from this noise requires sophisticated filtering that itself costs tokens and produces unreliable results.

3. **Explicit capture is superior.** Agents already call `add_lesson` after reaching conclusions. The agent just finished the work — it knows exactly what's worth remembering. A passive collector watching from outside extracts worse quality at higher cost.

4. **Knowledge sharing already works.** Multiple agents share the same `project_id` and `search_lessons` returns all agents' lessons. Agent B can find Agent A's decisions without needing Agent A's session transcript.

The explicit `add_lesson` pattern (100 tokens to save) is strictly better than passive extraction (1000s of tokens to parse, uncertain quality). If knowledge capture rates are low, the fix is better agent instructions (CLAUDE.md), not a monitoring pipeline.

### Dropped: Session History Sharing

Considered as a feature to store and share full session transcripts between agents, enabling one agent to "see" what another agent did in a previous session.

**Why it was dropped:**

1. **Transcripts are massive.** A single agent session produces 50k-200k tokens of conversation. Storing and retrieving these consumes more context window than the knowledge they contain. This directly contradicts the project's goal of *reducing* token usage.

2. **The value is in conclusions, not the journey.** An agent debugging a problem for 30 minutes produces 40k tokens of trial and error, but the useful output is one sentence: "Redis cache must be flushed after changing retrieval logic." That sentence is already captured by `add_lesson` in ~100 tokens.

3. **Existing tools cover the use case.** When Agent B needs to know what Agent A decided:
   - `search_lessons("what happened with auth refactor")` → returns the decision (~200 tokens)
   - `SESSION_PATCH.md` → contains session status and next steps (~500 tokens)
   - Both are orders of magnitude cheaper than reading a 100k-token transcript

4. **Context window is the scarcest resource.** AI agents have limited context windows (100k-200k tokens). Filling that with another agent's raw session history leaves less room for the actual work. Every token of transcript loaded is a token not available for code, reasoning, or tool output.

The design principle: **capture distilled knowledge (lessons), not raw conversations.** 100 well-written lessons are more useful than 100 session transcripts, at 1/1000th the token cost.

### Dropped: IDE Native (VS Code Extension)

Originally planned as a dedicated VS Code extension for browsing and managing knowledge from the editor.

**Why it was dropped:**

1. **Agents don't need it.** Agents interact via MCP tools — that's already done and working. The extension would only serve humans.

2. **Web GUI covers the same use case.** The Phase 7 web dashboard works in any browser, including VS Code's built-in Simple Browser. Same functionality, accessible from any IDE, no extension maintenance.

3. **High maintenance, low unique value.** A VS Code extension requires: learning the VS Code extension API, building webview panels, packaging for the marketplace, testing across VS Code versions, and updating when APIs change. All for a UI that duplicates the web dashboard.

4. **Incremental path exists.** If deeper IDE integration is proven valuable later (inline guardrail warnings, CodeLens annotations), a lightweight extension can link to the web GUI rather than reimplementing the full knowledge browser.

## Appendix: Relationship to Inspiration Projects
ContextStream inspiration:
- Persistent memory, semantic code search, and guardrails are the core concept.
Reference: https://contextstream.io/

MCP reference repository inspiration:
- This project uses MCP SDK/protocol conventions and patterns inspired by the official reference implementations (as guidance for tool schemas and server structure).
Reference: https://github.com/modelcontextprotocol/servers

MCP specification reference:
- MCP website (for protocol background): https://modelcontextprotocol.io/

