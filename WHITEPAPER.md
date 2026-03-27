# ContextHub (Self-Hosted) White Paper

## Status
Draft v0.1 (MVP-first)

## Abstract
ContextHub is a self-hosted, team-friendly system that gives MCP-enabled AI tools persistent memory and semantic code understanding, with intentionally minimal core features. It is designed for small teams that want the essential productivity benefits of ContextStream-like workflows, without requiring a hosted SaaS dependency.

At a high level, ContextHub provides:
- Persistent "lessons" and preferences captured across sessions
- Vector-first semantic code search (with optional hybrid later) for fast retrieval of relevant context
- Lightweight, always-on guardrails derived from lessons
- Local indexing and secure retrieval (with explicit ignore rules)

ContextHub is inspired by ContextStream's "persistent memory + semantic code search + guardrails" concept. For reference, see ContextStream's product description: https://contextstream.io/ .

This project is built from scratch to keep the MVP small, self-hostable, and tailored to the required core flows (project-scoped persistent lessons + vector-first semantic retrieval + minimal guardrails).

## Problem Statement
AI coding assistants often suffer from:
- Context loss: useful decisions, preferences, and constraints are forgotten between sessions/tools
- Search friction: engineers re-explain architectures or re-locate code manually because the assistant cannot reliably "find the right place"
- Safety regressions: teams repeatedly make the same mistakes (for example, pushing without running tests)

Large products solve this via hosted persistent memory and indexing, but small teams typically need:
- Self-hosting (control, cost predictability, and data residency)
- Minimal complexity (avoid enterprise-grade overhead)
- Clearly scoped core features that work well out-of-the-box

## Goals
1. Provide persistent memory for small teams
   - Store decisions, preferences, and "lessons learned" persistently across chat sessions
   - Share memory across multiple users within the same `project_id`
2. Provide semantic code search
   - Retrieve relevant code context by intent using embeddings (semantic)
   - Optionally add cheap lexical/symbol signals for hybrid retrieval later
3. Provide lightweight guardrails from lessons
   - Enforce critical workflow rules using simple, auditable checks before tool actions
4. Be self-hostable and operate locally
   - One-node deployment for the team; minimal external dependencies
5. Keep MVP scope intentionally small
   - Focus on core retrieval and guardrail workflows; defer advanced graph analysis and deep analytics

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
- Indexing Service
  - Discovers files in allowed roots
  - Chunks and embeds both code content and lesson content
  - Stores metadata and vectors (vector-first)
- Lessons/Preferences Store (project-scoped)
  - Stores lessons, preferences, and retrieval history keyed by `project_id`
  - Stores lesson embeddings metadata for semantic retrieval
- Retrieval Service
  - Executes semantic search (vector similarity) and returns structured context
  - Optionally enriches with lexical/symbol signals when available
  - Reranks results and returns structured context to the MCP layer
- Guardrails Engine
  - Translates lessons into rule checks
  - Enforces preconditions before tool execution
- MCP Server(s)
  - Exposes tools/resources to MCP clients (Cursor/Claude Code/etc.)

Typical flow:
1. Indexing (background or on-demand)
2. MCP client calls `search_code(query)` and/or `get_preferences()`
3. MCP client calls `get_guardrails(context)` or runs guarded actions via MCP tool
4. Lessons can be captured via an MCP tool (from user corrections or structured events)

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
- Automation knowledge building: auto-collect data from git commits
- Semantic commit analysis to update lessons/guardrails
- Historical context reconstruction

### Phase 6-7: Communication & Visualization
- **Multi-Agent Knowledge**: Collect knowledge from inter-agent and agent-to-builder communications.
- **Interaction GUI**: Visual hub for humans to inspect and browse the knowledge graph.

### Phase 8-9: Human Interface & Multi-Format
- **Human-in-the-loop**: Allow users to correct knowledge and add new insights interactively.
- **Expanded Ingestion**: Support for PDF, DOCX, Excel, and Image files.

### Phase 10-11: Insights & Integration
- **RAG to Insight**: Convert complex knowledge into human-readable text and diagrams on demand.
- **VS Code Extension**: Deep integration into the Visual Studio Code ecosystem.

### Phase 12: Knowledge Portability
- **Exchange Hub**: Import/Export knowledge to/from other team-hosted ContextHubs or infrastructure.
- Standardized knowledge interchange format.

## Appendix: Relationship to Inspiration Projects
ContextStream inspiration:
- Persistent memory, semantic code search, and guardrails are the core concept.
Reference: https://contextstream.io/

MCP reference repository inspiration:
- This project uses MCP SDK/protocol conventions and patterns inspired by the official reference implementations (as guidance for tool schemas and server structure).
Reference: https://github.com/modelcontextprotocol/servers

MCP specification reference:
- MCP website (for protocol background): https://modelcontextprotocol.io/

