# ContextHub (Self-Hosted) White Paper

## Status
Draft v0.2

## Abstract
ContextHub is a self-hosted, team-friendly system that gives MCP-enabled AI coding agents **persistent memory and guardrails across sessions**. It is designed for small teams that want the essential productivity benefits of [ContextStream](https://contextstream.io/)-like workflows, without requiring a hosted SaaS dependency.

**The core problem:** every new AI agent session starts from zero. Decisions, preferences, workarounds, and constraints are forgotten. Teams repeat the same mistakes. Engineers re-explain the same architectural choices. ContextHub solves this by making agent knowledge persistent and shared.

**Primary features (the reason this project exists):**
- **Persistent lessons** — decisions, preferences, workarounds captured once, available to every future agent session
- **Guardrails** — team rules enforced before risky actions (push, deploy, migrations)
- **Session bootstrap** — new agents onboard instantly with project context and prior knowledge

**Supplementary features (assistive, not the core goal):**
- Semantic code search (tiered retrieval with kind-filtered precision)
- Git intelligence (auto-draft lessons from commit history)
- Knowledge graph (optional symbol-level code structure via Neo4j)

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

### Phase 7: Interactive GUI
- **Knowledge Explorer**: Visual hub for humans to inspect and browse lessons, guardrails, project snapshots, and knowledge graph.

### Phase 8: Human-in-the-loop
- Allow users to correct knowledge, approve draft lessons, and add insights interactively.

### Phase 9: Multi-format Ingestion
- Support for PDF, DOCX, Excel, and Image files.

### Phase 10: IDE Native
- **VS Code Extension**: Deep integration into the Visual Studio Code ecosystem.

### Phase 11: Knowledge Portability
- **Exchange Hub**: Import/Export knowledge to/from other team-hosted ContextHubs or infrastructure.
- Standardized knowledge interchange format.

### Dropped: Multi-Agent Passive Collection

Originally planned as "Phase 7: Multi-Agent Knowledge Sharing" — passively collecting knowledge from inter-agent communications.

**Why it was dropped:**

1. **Token cost contradicts core goal.** Parsing agent conversations requires an LLM, consuming tokens. The project's purpose is to *reduce* token usage, not add new token-consuming pipelines.

2. **Low signal-to-noise ratio.** Most agent conversation is debugging, trial and error, and exploration. Extracting useful lessons from this noise requires sophisticated filtering that itself costs tokens and produces unreliable results.

3. **Explicit capture is superior.** Agents already call `add_lesson` after reaching conclusions. The agent just finished the work — it knows exactly what's worth remembering. A passive collector watching from outside extracts worse quality at higher cost.

4. **Knowledge sharing already works.** Multiple agents share the same `project_id` and `search_lessons` returns all agents' lessons. Agent B can find Agent A's decisions without needing Agent A's session transcript.

The explicit `add_lesson` pattern (100 tokens to save) is strictly better than passive extraction (1000s of tokens to parse, uncertain quality). If knowledge capture rates are low, the fix is better agent instructions (CLAUDE.md), not a monitoring pipeline.

## Appendix: Relationship to Inspiration Projects
ContextStream inspiration:
- Persistent memory, semantic code search, and guardrails are the core concept.
Reference: https://contextstream.io/

MCP reference repository inspiration:
- This project uses MCP SDK/protocol conventions and patterns inspired by the official reference implementations (as guidance for tool schemas and server structure).
Reference: https://github.com/modelcontextprotocol/servers

MCP specification reference:
- MCP website (for protocol background): https://modelcontextprotocol.io/

