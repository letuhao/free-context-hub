# 02 — MCP Agent Usage Scenarios

These scenarios model a **production AI coding agent** (Claude Code, Cursor, etc.)
connected to free-context-hub over MCP at `http://localhost:3002/mcp`. They are
written from the agent's perspective and drive automated MCP/REST test cases.

**Grounding:** every tool name below is verified against `FEATURES.md` (104 MCP
tools) and the per-area docs under `docs/features/`. No invented tools. The
canonical agent contract from `CLAUDE.md` is: **start each session with
`search_lessons` + `check_guardrails`**, capture decisions with `add_lesson`,
and gate risky actions through `check_guardrails`.

**Conventions used in steps**
- All `add_lesson` calls wrap args in `lesson_payload: { project_id, lesson_type, title, content, tags }`.
- `project_id` is `free-context-hub` unless a scenario creates its own.
- "Surfaces" lists the MCP tool(s) exercised; REST shown only where a test may assert parity.

**Priority key:** P0 = core agent loop, must always work. P1 = important
secondary flows. P2 = advanced/feature-gated or edge behavior.

---

### SCN-MCP-01 — Session bootstrap: load prior decisions before touching code
- **Priority:** P0
- **Area:** Memory & Lessons
- **Persona:** agent starting a fresh session on a familiar repo
- **Surfaces:** MCP `search_lessons`; (REST `POST /api/lessons/search`)
- **Preconditions:** project `free-context-hub` exists with ≥1 active lesson whose content matches the task intent.
- **Steps:**
  1. `search_lessons(query: "authentication approach for this service", project_id: "free-context-hub")`
  2. Inspect the returned lessons' `lesson_type`, `title`, `status`, score.
- **Expected:**
  - Returns a ranked, de-duplicated list of lessons relevant to the query.
  - Each hit carries an id, type, title, and a similarity/salience score; `superseded`/`archived` lessons do not outrank `active` ones.
- **Watch for (bug/UX risks):** empty result when a clearly-relevant lesson exists (embedding/indexing gap); duplicate lessons returned (missing dedup); cross-project leakage when `project_id` is scoped; results not salience-weighted (stale lesson ranked top).

### SCN-MCP-02 — Guardrail check before a risky action (block path)
- **Priority:** P0
- **Area:** Guardrails
- **Persona:** agent about to run a destructive/irreversible operation
- **Surfaces:** MCP `check_guardrails`; (REST `POST /api/guardrails/check`)
- **Preconditions:** a `guardrail`-type lesson exists that matches "git push to main" (e.g. requires approval).
- **Steps:**
  1. `check_guardrails(action_context: { action: "git push to main" })`
  2. Read `pass` and `prompt`.
- **Expected:**
  - Response shape `{ pass: false, prompt: "<human-readable reason / approval ask>" }`.
  - `prompt` is non-empty and actionable; the agent surfaces it and does NOT proceed.
- **Watch for:** `pass: true` when a matching guardrail exists (rule not evaluated); missing/empty `prompt` on a block (agent has nothing to show the user); 500 instead of a structured block; non-deterministic verdict across identical calls.

### SCN-MCP-03 — Guardrail check returns pass for a benign action
- **Priority:** P0
- **Area:** Guardrails
- **Persona:** agent about to do something routine and safe (read a file, run tests)
- **Surfaces:** MCP `check_guardrails`
- **Preconditions:** no guardrail rule matches the benign action.
- **Steps:**
  1. `check_guardrails(action_context: { action: "run unit tests locally" })`
- **Expected:**
  - `{ pass: true }` (prompt may be empty/omitted).
- **Watch for:** false-positive block on a benign action (over-broad rule match); slow response that would discourage the agent from checking at all.

### SCN-MCP-04 — Capture a decision as a durable lesson
- **Priority:** P0
- **Area:** Memory & Lessons
- **Persona:** agent that just made an architectural choice mid-task
- **Surfaces:** MCP `add_lesson`; (REST `POST /api/lessons`)
- **Preconditions:** auth/scope allows writes to `free-context-hub`.
- **Steps:**
  1. `add_lesson(lesson_payload: { project_id: "free-context-hub", lesson_type: "decision", title: "Use cursor pagination, not offset, for /lessons", content: "Offset paging drifts under concurrent inserts; switched to keyset.", tags: ["pagination","api"] })`
  2. `search_lessons(query: "pagination strategy for lessons endpoint")` to confirm retrievability.
- **Expected:**
  - Step 1 returns a created lesson id; lesson defaults to a sensible status (`active` or `draft` per policy) and is embedded.
  - Step 2 returns the new lesson (proves write→embed→search round-trips).
- **Watch for:** write succeeds but lesson is not searchable (embedding not triggered on write); `lesson_type` rejected even though it's a default type; created with wrong/empty project scope; XSS-unsafe content stored verbatim and reflected later.

### SCN-MCP-05 — Capture a new guardrail rule, then prove it fires
- **Priority:** P0
- **Area:** Guardrails
- **Persona:** agent encoding a "never do X before Y" team rule it just learned
- **Surfaces:** MCP `add_lesson` (type `guardrail`), `check_guardrails`
- **Preconditions:** no existing guardrail covers the new action.
- **Steps:**
  1. `add_lesson(lesson_payload: { project_id: "free-context-hub", lesson_type: "guardrail", title: "No schema migration without backup", content: "Block any DB migration unless a fresh backup exists.", tags: ["db","migration"] })`
  2. `check_guardrails(action_context: { action: "run schema migration 0064" })`
- **Expected:**
  - Step 2 now returns `pass: false` with a prompt referencing the backup requirement.
- **Watch for:** guardrail not picked up until a cache/embedding refresh (stale rule set); rule matches far too broadly (e.g. blocks "read migration file"); `prompt` doesn't reflect the rule's content.

### SCN-MCP-06 — Update a lesson and confirm re-embedding + version snapshot
- **Priority:** P1
- **Area:** Memory & Lessons
- **Persona:** agent correcting/expanding a prior decision
- **Surfaces:** MCP `update_lesson`, `list_lesson_versions`, `search_lessons`; (REST `PUT /api/lessons/:id`, `GET /api/lessons/:id/versions`)
- **Preconditions:** an existing lesson id from SCN-MCP-04.
- **Steps:**
  1. `update_lesson(id: <id>, content: "...added: keyset cursor is base64(id,created_at)...", tags: ["pagination","api","keyset"])`
  2. `list_lesson_versions(id: <id>)`
  3. `search_lessons(query: "base64 keyset cursor format")`
- **Expected:**
  - Update returns the new revision; prior content is preserved as a version entry.
  - The new text is now searchable (re-embed occurred); version count increments by exactly 1.
- **Watch for:** edit overwrites without snapshotting the prior version (lost history); search still returns only old content (no re-embed on update); version list returns dupes or wrong ordering.

### SCN-MCP-07 — Move a lesson through its lifecycle
- **Priority:** P1
- **Area:** Memory & Lessons
- **Persona:** agent superseding an outdated decision
- **Surfaces:** MCP `update_lesson_status`, `list_lessons`, `search_lessons`; (REST `PATCH /api/lessons/:id/status`)
- **Preconditions:** an active lesson that a newer one replaces.
- **Steps:**
  1. `update_lesson_status(id: <old>, status: "superseded")`
  2. `list_lessons(status: "active")` and confirm the old id is absent.
  3. `search_lessons(query: <topic>)` and confirm the superseded lesson is deprioritized.
- **Expected:**
  - Status transitions only along the legal lifecycle (`draft→active→superseded→archived`); illegal jumps are rejected.
  - Superseded lessons drop out of `active` filters and rank below active ones in search.
- **Watch for:** illegal status transition accepted; superseded lesson still ranks #1 in search (retrieval ignores status); `list_lessons` status filter not applied.

### SCN-MCP-08 — Reflect: LLM synthesis across multiple lessons
- **Priority:** P1
- **Area:** Memory & Lessons
- **Persona:** agent asking "what's our overall stance on X" rather than fetching one lesson
- **Surfaces:** MCP `reflect`; (REST `POST /api/projects/:id/reflect`)
- **Preconditions:** ≥2 lessons on a shared theme; `DISTILLATION_ENABLED` / a chat model reachable.
- **Steps:**
  1. `reflect(project_id: "free-context-hub", query: "summarize our API pagination and auth conventions")`
- **Expected:**
  - Returns a synthesized answer grounded in the underlying lessons (cites or draws only from stored content, not hallucinated facts).
- **Watch for:** answer invents conventions not present in any lesson; hard error (not graceful degrade) when the chat model is down; ignores `project_id` scope and pulls other projects' lessons.

### SCN-MCP-09 — Tiered code search to locate a test file
- **Priority:** P0
- **Area:** Search & Retrieval
- **Persona:** agent that needs the existing test for a module before editing it
- **Surfaces:** MCP `search_code_tiered`; (REST `POST /api/search/code-tiered`)
- **Preconditions:** project indexed (`index_project` has run) OR repo on disk for ripgrep tier.
- **Steps:**
  1. `search_code_tiered(query: "model resolver env tests", kind: "test", project_id: "free-context-hub")`
- **Expected:**
  - Returns ranked file/snippet hits; the `kind: "test"` profile biases toward test files (e.g. `*.test.ts`).
  - Result includes path + line/snippet; escalation stops at the first confident tier.
- **Watch for:** `kind` filter ignored (returns non-test files first); empty result despite an obvious test file (tier escalation broke); reranker absence causes a hard failure instead of graceful fallback.

### SCN-MCP-10 — Tiered code search for a doc/topic
- **Priority:** P1
- **Area:** Search & Retrieval
- **Persona:** agent looking for existing documentation before writing new docs
- **Surfaces:** MCP `search_code_tiered`
- **Preconditions:** docs exist under the repo and are indexed.
- **Steps:**
  1. `search_code_tiered(query: "baseline stack invariant", kind: "doc")`
- **Expected:**
  - Returns markdown/doc hits ranked by relevance, with the matching section/snippet.
- **Watch for:** code files returned instead of docs (profile selection wrong); duplicated hits for the same file across tiers (no merge/dedup).

### SCN-MCP-11 — Direct vector code search (no tier escalation)
- **Priority:** P2
- **Area:** Search & Retrieval
- **Persona:** agent doing a semantic "find similar code" lookup
- **Surfaces:** MCP `search_code`
- **Preconditions:** project indexed with embeddings.
- **Steps:**
  1. `search_code(query: "resolve the canonical chat model from env", project_id: "free-context-hub")`
- **Expected:**
  - Returns nearest-neighbor code chunks by vector similarity with scores.
- **Watch for:** returns lessons or docs instead of code chunks (corpus bleed); identical scores for all hits (embedding/scoring bug); errors when project never indexed instead of an empty/typed result.

### SCN-MCP-12 — Document chunk search (hybrid semantic + FTS)
- **Priority:** P1
- **Area:** Documents & Ingestion
- **Persona:** agent grounding an answer in an ingested PDF/DOCX
- **Surfaces:** MCP `search_document_chunks`; (REST `GET /api/documents/:id/chunks`)
- **Preconditions:** at least one document uploaded + chunked + embedded.
- **Steps:**
  1. `search_document_chunks(query: "retention policy for audit logs", project_id: "free-context-hub")`
- **Expected:**
  - Returns chunk hits with document id, chunk text, and a combined semantic+FTS score; exact-term matches and semantic matches both surface.
- **Watch for:** only FTS or only semantic contributing (hybrid scoring not combined); returns chunks from documents outside the caller's scope; stale chunks after a document was re-extracted.

### SCN-MCP-13 — Browse generated documents and promote one to active knowledge
- **Priority:** P2
- **Area:** Documents & Ingestion
- **Persona:** agent reviewing system-generated FAQ/RAPTOR/QC docs
- **Surfaces:** MCP `list_generated_documents`, `get_generated_document`, `promote_generated_document`
- **Preconditions:** ≥1 generated document exists in `draft` state.
- **Steps:**
  1. `list_generated_documents(project_id: "free-context-hub")`
  2. `get_generated_document(id: <id>)`
  3. `promote_generated_document(id: <id>)`
- **Expected:**
  - List returns generated docs with type (FAQ/RAPTOR/QC/benchmark) and status; get returns full content; promote flips draft→active and makes it discoverable.
- **Watch for:** promote is not idempotent (double-promote errors or duplicates); promoting a doc from another project succeeds (scope hole); get returns truncated/empty content.

### SCN-MCP-14 — Ingest git history, then browse commits
- **Priority:** P1
- **Area:** Code Intelligence
- **Persona:** agent onboarding to a repo's recent history
- **Surfaces:** MCP `ingest_git_history`, `list_commits`, `get_commit`; (REST `POST /api/git/ingest`, `GET /api/git/commits`)
- **Preconditions:** `GIT_INGEST_ENABLED=true`; a configured git source for the project.
- **Steps:**
  1. `ingest_git_history(project_id: "free-context-hub", limit: 50)`
  2. `list_commits(project_id: "free-context-hub")`
  3. `get_commit(sha: <sha from list>)`
- **Expected:**
  - Ingest reports the count of commits stored; list returns ordered commits (newest first) with sha/author/message; get returns the commit plus its changed files.
- **Watch for:** re-running ingest duplicates commits (not idempotent on sha); `get_commit` returns no changed-files set; ingest hangs / no progress on a large repo.

### SCN-MCP-15 — Suggest lessons from commit patterns
- **Priority:** P2
- **Area:** Code Intelligence
- **Persona:** agent mining recurring fixes into reusable knowledge
- **Surfaces:** MCP `suggest_lessons_from_commits`, `link_commit_to_lesson`; (REST `POST /api/git/suggest-lessons`)
- **Preconditions:** commits already ingested.
- **Steps:**
  1. `suggest_lessons_from_commits(project_id: "free-context-hub")`
  2. (optionally) `add_lesson(...)` for an accepted suggestion, then `link_commit_to_lesson(lesson_id: <id>, sha: <sha>)`
- **Expected:**
  - Returns draft lesson proposals tied to commit clusters; link attaches commit refs/files to the lesson.
- **Watch for:** suggestions are empty or one-per-commit (no clustering); link accepts a sha that wasn't ingested; proposals auto-created as active lessons without review.

### SCN-MCP-16 — Symbol graph: search + neighbors + dependency path (KG-gated)
- **Priority:** P2
- **Area:** Code Intelligence
- **Persona:** agent doing impact analysis before refactoring a hot function
- **Surfaces:** MCP `search_symbols`, `get_symbol_neighbors`, `trace_dependency_path`, `get_lesson_impact`
- **Preconditions:** `KG_ENABLED=true`, Neo4j up, project indexed into the graph.
- **Steps:**
  1. `search_symbols(query: "resolveChatModel", project_id: "free-context-hub")`
  2. `get_symbol_neighbors(symbol: <id>)`
  3. `trace_dependency_path(from: <symA>, to: <symB>)`
- **Expected:**
  - Symbol search returns matching TS/JS symbols; neighbors lists callers/callees; trace returns the shortest path (or a clear "no path").
- **Watch for:** tools 500 (instead of a clean "KG disabled") when `KG_ENABLED=false`; neighbors missing obvious callers (extraction gap); path search infinite-loops on a cycle.

### SCN-MCP-17 — Analyze a commit's blast radius (KG-gated)
- **Priority:** P2
- **Area:** Code Intelligence
- **Persona:** agent assessing risk of cherry-picking a commit
- **Surfaces:** MCP `analyze_commit_impact`; (REST `POST /api/git/analyze-impact`)
- **Preconditions:** `KG_ENABLED=true`; commit ingested; graph populated.
- **Steps:**
  1. `analyze_commit_impact(sha: <sha>, project_id: "free-context-hub")`
- **Expected:**
  - Returns affected symbols/files/lessons (blast radius) for the commit.
- **Watch for:** returns an empty impact set for a commit that clearly touches shared code; graceful-degrade message when KG is off vs. hard error.

### SCN-MCP-18 — Index a project (idempotent discover→chunk→embed)
- **Priority:** P1
- **Area:** Code Intelligence / Jobs
- **Persona:** agent preparing a newly-added repo for code search
- **Surfaces:** MCP `index_project`; (REST `POST /api/projects/:id/index`)
- **Preconditions:** project has a workspace root / source configured; embeddings endpoint reachable.
- **Steps:**
  1. `index_project(project_id: "free-context-hub")`
  2. Re-run `index_project(project_id: "free-context-hub")` (idempotency check).
  3. `search_code(query: "<symbol from a known file>")` to confirm coverage.
- **Expected:**
  - First run reports files discovered/chunked/embedded; second run is a near-no-op (no duplicate chunks); subsequent search finds indexed content.
- **Watch for:** second run re-embeds everything (not idempotent → wasted compute); partial index left on embedding-endpoint failure with no error surfaced; chunks duplicated.

### SCN-MCP-19 — Async job: enqueue, run, and verify
- **Priority:** P1
- **Area:** Jobs & Operations
- **Persona:** agent kicking off heavy work without blocking
- **Surfaces:** MCP `enqueue_job`, `run_next_job`, `list_jobs`; (REST `/api/jobs`)
- **Preconditions:** server up; (worker optional — `run_next_job` covers the no-worker case).
- **Steps:**
  1. `enqueue_job(type: "index.run", payload: { project_id: "free-context-hub" }, correlation_id: "scn-19")`
  2. `run_next_job()`
  3. `list_jobs(correlation_id: "scn-19")`
- **Expected:**
  - Enqueue returns a job id + queued status; `run_next_job` executes it; list shows the job transition to succeeded/failed with the same `correlation_id`.
- **Watch for:** `correlation_id` not persisted (can't trace the job); `run_next_job` silently no-ops when a queue exists but is empty; failed job reported as succeeded; job status never leaves "queued".

### SCN-MCP-20 — Identity check: whoami before scope-sensitive work
- **Priority:** P0
- **Area:** Access Control & Identity
- **Persona:** agent verifying its principal + tenant scope at session start
- **Surfaces:** MCP `whoami`; (REST `GET /api/me`)
- **Preconditions:** agent connected with an API key (auth on or off).
- **Steps:**
  1. `whoami()`
- **Expected:**
  - Returns the caller's principal id/name, role, and the tenant/project scope it is bound to.
- **Watch for:** returns a privileged/admin identity when called with a scoped key (scope not derived from the credential); empty/anonymous identity when a valid key was supplied; leaks `key_hash` or secret material in the response.

### SCN-MCP-21 — Artifact lease: claim → check → release (anti-collision)
- **Priority:** P1
- **Area:** Coordination
- **Persona:** one of several agents that must not edit the same file concurrently
- **Surfaces:** MCP `claim_artifact`, `check_artifact_availability`, `list_active_claims`, `release_artifact`; (REST `/api/projects/:id/artifact-leases`)
- **Preconditions:** project exists; an artifact key the agents agree on (e.g. `src/qc/runBaseline.ts`).
- **Steps:**
  1. `claim_artifact(project_id: "free-context-hub", artifact: "src/qc/runBaseline.ts", ttl_seconds: 600)`
  2. `check_artifact_availability(project_id: "free-context-hub", artifact: "src/qc/runBaseline.ts")` → expect "leased".
  3. `list_active_claims(project_id: "free-context-hub")` → claim visible.
  4. `release_artifact(...)` → then availability returns "free".
- **Expected:**
  - Claim returns a lease with a fencing token + TTL; a second concurrent `claim_artifact` on the same key is rejected while held; release frees it.
- **Watch for:** two callers both get an active lease on the same artifact (no mutual exclusion); released lease still shows in `list_active_claims`; expired lease (TTL passed) still blocks claims (sweep not running); fencing token reused after release.

### SCN-MCP-22 — Renew a lease before it expires
- **Priority:** P2
- **Area:** Coordination
- **Persona:** agent doing long-running work that outlasts the initial TTL
- **Surfaces:** MCP `renew_artifact`, `check_artifact_availability`
- **Preconditions:** an active lease held by the caller (from SCN-MCP-21).
- **Steps:**
  1. `renew_artifact(project_id: "free-context-hub", artifact: "src/qc/runBaseline.ts")`
  2. `check_artifact_availability(...)` → still leased, new expiry later than before.
- **Expected:**
  - Renew extends the TTL (up to a documented cap); only the holder of the fencing token may renew.
- **Watch for:** a non-holder can renew/steal the lease; renew beyond the cap accepted (unbounded hold); renew on an already-expired lease silently re-grants instead of failing.

### SCN-MCP-23 — Submit AI-generated work for human review
- **Priority:** P1
- **Area:** Governance & Decisions
- **Persona:** agent that authored a lesson/artifact and wants a human gate before it goes active
- **Surfaces:** MCP `submit_for_review`, `list_review_requests`; (REST `/api/projects/:id/review-requests`)
- **Preconditions:** a draft/pending-review lesson or artifact exists.
- **Steps:**
  1. `submit_for_review(project_id: "free-context-hub", lesson_id: <id>)`
  2. `list_review_requests(project_id: "free-context-hub")` → the item appears as pending.
- **Expected:**
  - Submit creates a review request and moves the lesson to `pending-review`; it shows in the queue and does NOT count as active knowledge until approved.
- **Watch for:** lesson goes straight to `active` (review bypassed); duplicate review requests on re-submit; pending-review lessons leaking into `search_lessons` active results; cross-project submission accepted.

### SCN-MCP-24 — Topic re-entry: join and replay the event log
- **Priority:** P2
- **Area:** Coordination
- **Persona:** agent resuming a multi-agent initiative after a context reset
- **Surfaces:** MCP `join_topic`, `get_topic`, `replay_topic_events`, `list_board`
- **Preconditions:** an open topic with prior events and a populated board.
- **Steps:**
  1. `join_topic(topic_id: <id>)` → receive induction pack + roster.
  2. `replay_topic_events(topic_id: <id>, cursor: 0)` → ordered event history.
  3. `list_board(topic_id: <id>)` → current tasks + artifact ids.
- **Expected:**
  - Join registers the actor and returns roster + induction context; replay returns the append-only log in order from the cursor; board reflects current task/claim state.
- **Watch for:** replay skips or reorders events (log not strictly append-only/ordered); join double-registers the same actor; board shows claims that were already released; replaying a closed/sealed topic errors instead of returning the sealed log.

---

## Coverage summary

| Area | Scenarios |
|------|-----------|
| Session bootstrap | 01, 20 |
| Memory & Lessons | 01, 04, 06, 07, 08 |
| Guardrails | 02, 03, 05 |
| Search & Retrieval | 09, 10, 11 |
| Documents & Ingestion | 12, 13 |
| Code Intelligence | 14, 15, 16, 17, 18 |
| Jobs & Operations | 18, 19 |
| Access Control & Identity | 20 |
| Coordination | 21, 22, 24 |
| Governance & Decisions | 23 |

Feature-gated scenarios (KG/Neo4j, queue/worker, distillation) are marked in their
preconditions so the test harness can skip rather than fail when the flag is off.
