# GUI Usage Scenarios — Human Operator

**Persona overview.** These scenarios are written from the perspective of a **human
operator** driving the free-context-hub web GUI at `http://localhost:3002` — the
single externally-published entrypoint that proxies `/api/*` to REST and `/mcp` to
the MCP server. The dominant personas are a **team lead / knowledge curator** who
reviews and approves what AI agents store, a **security/admin owner** who manages
credentials and authorization, and an **operator** who watches jobs, ingestion, and
system health. Every scenario uses only real GUI routes and real features verified
against `FEATURES.md`, `docs/features/10-gui.md`, and the actual `page.tsx` sources.

**Count:** 22 scenarios (P0: 8 · P1: 9 · P2: 5).

**Areas covered (all 11):** Memory & Lessons · Search & Retrieval · Guardrails ·
Code Intelligence · Documents & Ingestion · Coordination · Governance & Decisions ·
Access Control & Identity · Projects & Portability · GUI Dashboards
(review/analytics/activity/agents/onboarding) · Jobs & Operations.

> Note: Coordination (topics/board/leases) and most Governance decision primitives
> (motions, requests, intake, disputes) have **no human GUI surface** — they are
> MCP/REST-only. The GUI exposes those areas only through the **Review Inbox**
> (`/review`) and the read-side audit/activity views. Scenarios reflect that reality;
> the gap is flagged in the summary.

---

### SCN-GUI-01 — Curator approves an AI-generated lesson from the Review Inbox
- **Priority:** P0
- **Area:** GUI Dashboards (review)
- **Persona:** team lead reviewing AI knowledge
- **Surfaces:** GUI `/review`; (REST `GET /api/projects/:id/review-requests`, `PATCH /api/lessons/:id` status)
- **Preconditions:** A project is selected; at least one lesson exists in `draft` (auto-generated) or `pending-review` (submitted) state.
- **Steps:**
  1. Open `/review`.
  2. Confirm the two-tab mode toggle shows **Auto-generated** and **Submitted for review**; stay on Auto-generated.
  3. Click a draft lesson row to expand/preview its content.
  4. Click the **Approve** (check) action on that lesson.
- **Expected:**
  - The lesson disappears from the pending list (or its badge flips to `active`) and a success toast appears.
  - Re-opening `/lessons` with status `active` shows the now-approved lesson.
- **Watch for (bug/UX risks):** Approve silently failing (no toast, row stays); tab counts not decrementing; approving the wrong row when list reorders after the action.

### SCN-GUI-02 — Curator rejects/returns a lesson with a reason
- **Priority:** P0
- **Area:** GUI Dashboards (review)
- **Persona:** team lead reviewing AI knowledge
- **Surfaces:** GUI `/review`
- **Preconditions:** At least one lesson in the review queue.
- **Steps:**
  1. Open `/review`.
  2. On a lesson row, trigger the **Reject** (X) action.
  3. In the Reject dialog, pick a **Reason** from the dropdown (e.g. "Duplicate") and type an optional **note** for the agent.
  4. Click **Reject**.
- **Expected:**
  - Dialog closes, the lesson is returned/removed from the active review list, and a toast confirms the action.
  - The reason and note are persisted on the lesson/review record (visible later in audit/detail).
- **Watch for:** Reject button enabled with no reason selected losing context; the note silently dropped; dialog not closing on backdrop click.

### SCN-GUI-03 — Capture a new lesson manually from the Lessons Library
- **Priority:** P0
- **Area:** Memory & Lessons
- **Persona:** knowledge curator adding a team decision
- **Surfaces:** GUI `/lessons`; (REST `POST /api/lessons`)
- **Preconditions:** A project is selected.
- **Steps:**
  1. Open `/lessons`.
  2. Click **Add Lesson** to open the Add Lesson dialog.
  3. Set **Type** = `decision`, enter a **Title** and **Content** (use the rich/markdown editor — try **Ctrl+B** for bold), add 1-2 **tags**.
  4. Save.
- **Expected:**
  - The new lesson appears at the top of the list (sorted by `created_at desc`) with the correct type badge and tags.
  - Total count increments by one.
- **Watch for:** Markdown toolbar shortcuts not applying; tags not persisting; the dialog not closing or the list not refreshing after save; type defaulting incorrectly.

### SCN-GUI-04 — Find a past decision via semantic lesson search
- **Priority:** P0
- **Area:** Search & Retrieval
- **Persona:** engineer recalling a prior decision
- **Surfaces:** GUI `/lessons`; (REST `POST /api/lessons/search`)
- **Preconditions:** Several lessons exist with searchable content; embeddings service available.
- **Steps:**
  1. Open `/lessons`.
  2. Toggle the search mode from **text** to **semantic**.
  3. Type a natural-language query (e.g. "how do we handle auth tokens").
  4. Observe ranked results.
- **Expected:**
  - Results return ranked by semantic relevance (not just substring matches), within a reasonable latency.
  - Switching back to **text** mode narrows to literal substring matches.
- **Watch for:** Semantic mode falling back to text silently when embeddings are down (should surface an error/empty state, not pretend); pagination behaving oddly in semantic mode (results capped at one page); stale debounced query firing.

### SCN-GUI-05 — Edit a lesson and review its version history
- **Priority:** P1
- **Area:** Memory & Lessons
- **Persona:** curator refining captured knowledge
- **Surfaces:** GUI `/lessons/[id]`; (REST `PUT /api/lessons/:id`, `GET /api/lessons/:id/versions`)
- **Preconditions:** A lesson exists with at least one prior edit (or this edit creates v2).
- **Steps:**
  1. Open `/lessons`, click a lesson to open its detail (`/lessons/[id]`).
  2. Edit the content in the rich editor and save.
  3. Open the **version history** panel and compare the latest version to the prior one.
  4. Add a **comment** on the lesson.
- **Expected:**
  - A new version is recorded; the history list shows both versions with timestamps.
  - The comment appears in the thread immediately.
- **Watch for:** Edit overwriting without creating a version; history showing duplicate/empty versions; optimistic-lock conflict not surfaced if two tabs edit; comment posting to the wrong lesson.

### SCN-GUI-06 — Bulk approve/archive lessons and import a CSV/Markdown set
- **Priority:** P2
- **Area:** Memory & Lessons
- **Persona:** curator doing housekeeping
- **Surfaces:** GUI `/lessons` (Import / Export / bulk actions)
- **Preconditions:** Multiple lessons present; a small import file ready.
- **Steps:**
  1. Open `/lessons`.
  2. Select multiple rows and trigger a **bulk approve** or **bulk archive**.
  3. Click **Import**, choose a CSV/Markdown file in the Import dialog, and import.
  4. Click **Export/Download** to export the current set.
- **Expected:**
  - Bulk action updates all selected rows in one pass with a single toast/summary.
  - Imported lessons appear in the list; export produces a downloadable file.
- **Watch for:** Bulk action partially applying (some rows fail silently); import accepting a malformed file without validation feedback; export including archived rows unexpectedly.

### SCN-GUI-07 — Test whether a risky action would be blocked (guardrail simulate)
- **Priority:** P0
- **Area:** Guardrails
- **Persona:** team lead validating policy before trusting it
- **Surfaces:** GUI `/guardrails`; (REST `POST /api/guardrails/check`, `POST /api/guardrails/simulate`)
- **Preconditions:** At least one guardrail-type lesson exists (e.g. blocks "git push --force to main").
- **Steps:**
  1. Open `/guardrails`.
  2. In **Test** mode, click a preset such as **"git push --force to main"** (or type a custom action) and run the test.
  3. Switch to the **"What Would Block?"** / block mode, paste several candidate actions (one per line), and simulate.
- **Expected:**
  - Test returns `pass: true/false` with the matched rule(s), requirement, and verification method shown.
  - Simulate returns a per-action verdict listing matched rules for each line.
  - Test history records the recent checks (action, pass, match count, timestamp).
- **Watch for:** A blocking rule reporting `pass: true` (false negative — critical); matched-rules list empty even when blocked; simulate choking on blank lines; history not updating.

### SCN-GUI-08 — Browse and inspect guardrail rules; add a new guardrail
- **Priority:** P1
- **Area:** Guardrails
- **Persona:** policy owner authoring a new rule
- **Surfaces:** GUI `/guardrails`; (REST `GET /api/guardrails/rules`, `POST /api/lessons` type=guardrail)
- **Preconditions:** Project selected.
- **Steps:**
  1. Open `/guardrails` and review the active guardrail list (paginated).
  2. Use **Add Lesson** (guardrail type) to author a new rule with a requirement and verification method.
  3. Save, then immediately re-run a **Test** against an action the new rule should catch.
- **Expected:**
  - The new guardrail appears in the active list; the subsequent Test matches it.
- **Watch for:** New guardrail not picked up by the cache until reload; verification-method field lost on save; the rule applying to the wrong project scope.

### SCN-GUI-09 — Ingest git history and turn commits into suggested lessons
- **Priority:** P0
- **Area:** Code Intelligence
- **Persona:** engineer onboarding a repo's history
- **Surfaces:** GUI `/projects/git`; (REST `POST /api/git/ingest`, `GET /api/git/commits`, `POST /api/git/suggest-lessons`, `POST /api/git/analyze-impact`)
- **Preconditions:** Project has a configured source/repo; `GIT_INGEST_ENABLED=true`.
- **Steps:**
  1. Open `/projects/git`.
  2. Click **Ingest** to pull commit history.
  3. Expand a commit row to see its files changed (path, status, +/- lines).
  4. Click **Suggest lessons** and review the generated suggestions.
  5. Run **Analyze impact** on a commit.
- **Expected:**
  - Commits populate the table after ingest; expanding a commit loads its detail.
  - Suggestions render with title/content/type/tags; impact analysis returns affected areas.
- **Watch for:** Ingest spinner never resolving on large repos; commit detail failing to load on expand; suggest-lessons returning empty without explanation; impact analysis 500ing when KG is disabled.

### SCN-GUI-10 — Tiered code search with file-kind filter
- **Priority:** P1
- **Area:** Search & Retrieval / Code Intelligence
- **Persona:** engineer locating code/tests/docs
- **Surfaces:** GUI `/knowledge/search`; (REST `POST /api/search/code-tiered`)
- **Preconditions:** Project has an indexed workspace/source.
- **Steps:**
  1. Open `/knowledge/search`.
  2. Type a query (e.g. "rate limiter").
  3. Set the **kind** filter to `test`, then to `doc`, observing result changes.
- **Expected:**
  - Results show file path, snippet, and a **tier** badge (exact/glob/fts/semantic).
  - Changing kind re-filters; an empty query shows the idle/empty state, not an error.
- **Watch for:** Tier badge missing/incorrect; kind filter not actually scoping results; debounce firing a search on empty/whitespace; no results path crashing instead of empty state.

### SCN-GUI-11 — Explore the symbol graph and trace a dependency path
- **Priority:** P2
- **Area:** Code Intelligence
- **Persona:** engineer understanding code structure
- **Surfaces:** GUI `/knowledge/graph`; (MCP `search_symbols`, `get_symbol_neighbors`, `trace_dependency_path`)
- **Preconditions:** `KG_ENABLED=true` and project indexed into Neo4j.
- **Steps:**
  1. Open `/knowledge/graph`.
  2. Search for a symbol by name.
  3. Expand its neighbors; trace a dependency path to another symbol.
- **Expected:**
  - Symbol search returns matches; neighbors and the traced path render.
- **Watch for:** Page showing a hard error (not a graceful "KG disabled" state) when Neo4j is off; empty graph with no guidance to index first; trace path silently returning nothing.

### SCN-GUI-12 — Upload a PDF, extract, chunk, and search its content
- **Priority:** P0
- **Area:** Documents & Ingestion
- **Persona:** curator importing external knowledge
- **Surfaces:** GUI `/documents`; (REST `POST /api/documents/upload`, `GET /api/documents/:id/chunks`)
- **Preconditions:** Project selected; a small PDF available.
- **Steps:**
  1. Open `/documents`.
  2. Click **Upload**, choose the PDF; pick an **extraction mode** (fast/quality/vision) in the selector.
  3. Wait for **extraction progress** to complete, then review the extracted chunks.
  4. Open the **Chunk search** panel and query for a phrase known to be in the doc.
- **Expected:**
  - The document appears with a `pdf` type badge and a size; chunks are produced and viewable.
  - Chunk search returns hybrid (semantic + FTS) matches with the right snippet.
- **Watch for:** Progress UI stuck at a percentage; chosen extraction mode ignored; chunk search returning chunks from other documents; thumbnail/viewer crashing on large files.

### SCN-GUI-13 — Ingest a document from a URL (SSRF-hardened)
- **Priority:** P1
- **Area:** Documents & Ingestion
- **Persona:** curator pulling in a web page
- **Surfaces:** GUI `/documents`; (REST `POST /api/documents/ingest-url`)
- **Preconditions:** Project selected; outbound HTTP allowed for public URLs.
- **Steps:**
  1. Open `/documents`, choose the **URL** ingest mode.
  2. Paste a public article URL and submit.
  3. Then paste an internal/loopback URL (e.g. `http://127.0.0.1`) and submit.
- **Expected:**
  - The public URL is fetched, extracted, and added as a `url`-type document.
  - The internal/loopback URL is **rejected** by SSRF protection with a clear error.
- **Watch for:** SSRF guard allowing private-range/loopback hosts (security defect); a hung request with no timeout; the rejection error being a generic 500 instead of a clear "blocked host" message.

### SCN-GUI-14 — Browse generated docs and promote one to a lesson
- **Priority:** P1
- **Area:** Documents & Ingestion / Memory & Lessons
- **Persona:** curator harvesting auto-generated knowledge
- **Surfaces:** GUI `/knowledge/docs`; (MCP/REST `list_generated_documents`, `get_generated_document`, `promote_generated_document`)
- **Preconditions:** At least one generated doc (FAQ/RAPTOR/QC/benchmark) exists.
- **Steps:**
  1. Open `/knowledge/docs`.
  2. Filter by type tab (e.g. **FAQ** or **RAPTOR**).
  3. Open a generated doc in the slide-over to read it.
  4. Click **Promote** to convert it into a lesson.
- **Expected:**
  - Filtering switches the visible set; the slide-over shows content.
  - Promote creates a lesson (visible in `/lessons` or the review queue) and marks the generated doc as `promoted`.
- **Watch for:** Promote double-creating on double-click; promoted flag not updating; type tabs miscounting; slide-over showing stale content from the previously opened doc.

### SCN-GUI-15 — Generate an API key bound to a principal with an expiry
- **Priority:** P0
- **Area:** Access Control & Identity
- **Persona:** security admin issuing agent credentials
- **Surfaces:** GUI `/settings/access`; (REST `/api/api-keys`)
- **Preconditions:** Operator is authenticated as an admin; at least one principal exists.
- **Steps:**
  1. Open `/settings/access`.
  2. Click **Generate** (Plus) to open the create-key modal.
  3. Pick a **role** (admin/writer/reader), select a **principal** to bind the key to, and choose an **expiry** preset (default is **90 days**, not Never).
  4. Create the key and copy the revealed secret.
- **Expected:**
  - The new key is listed showing its bound principal (id/display name) and role; the raw secret is shown **once** to copy.
  - The permissions matrix reflects the chosen role's capabilities.
- **Watch for:** Raw `key_hash`/secret persisting in the list after creation (must be one-time reveal); expiry defaulting to Never; principal binding not applied; "Rebind" appearing (it was deliberately removed — only Revoke is safe).

### SCN-GUI-16 — Revoke an API key
- **Priority:** P1
- **Area:** Access Control & Identity
- **Persona:** security admin responding to a leaked credential
- **Surfaces:** GUI `/settings/access`
- **Preconditions:** At least one active API key exists.
- **Steps:**
  1. Open `/settings/access`.
  2. On a key row, click **Revoke** and confirm in the dialog.
- **Expected:**
  - The key is marked revoked/removed; a confirmation toast appears; subsequent auth with that key would fail.
- **Watch for:** Revoke not requiring confirmation (accidental destructive action); revoking the wrong row; the key still appearing usable after revoke.

### SCN-GUI-17 — Rotate a credential with overlap and mint an ephemeral key (Access Review)
- **Priority:** P1
- **Area:** Access Control & Identity / Jobs & Operations
- **Persona:** security admin doing credential hygiene
- **Surfaces:** GUI `/governance/access-review`; (REST `/api/access-review`, MCP `mint_ephemeral_key`)
- **Preconditions:** At least one aging API key; operator is admin.
- **Steps:**
  1. Open `/governance/access-review` and review the stats (key ages, stale keys).
  2. Click **Rotate** on an aging key; choose an **overlap** window (24h / 7d / no overlap) and confirm.
  3. In the **mint ephemeral key** card, name a key, pick a **TTL** (15m / 1h / 8h), and mint it.
- **Expected:**
  - Rotation reveals a successor key; the predecessor remains valid for the chosen overlap then expires.
  - The ephemeral key is revealed once with its TTL noted.
- **Watch for:** "No overlap (revoke now)" not actually revoking immediately; successor secret not revealed; ephemeral TTL ignored; age labels miscomputed.

### SCN-GUI-18 — Grant and revoke a capability in the delegation tree
- **Priority:** P1
- **Area:** Access Control & Identity / Governance
- **Persona:** admin delegating authority to an agent
- **Surfaces:** GUI `/delegation`, `/identity`, `/authorization`; (REST `/api/grants`, `/api/authz`, MCP `grant_capability`/`revoke_grant`/`explain_authorization`)
- **Preconditions:** Two principals exist (a grantor and a grantee).
- **Steps:**
  1. Open `/identity` to confirm the principal directory lists both principals.
  2. Open `/delegation`, click **Add grant**, pick grantee, **capability** (read/write/admin/delegate), and **scope** (global/project/topic/task).
  3. Observe the new edge appear in the delegation tree.
  4. Open `/authorization` to see the resolved authz tree; then return to `/delegation` and **revoke** the grant.
- **Expected:**
  - The grant edge appears under the correct grantor→grantee node with the right capability/scope badges.
  - The authorization view reflects the new capability; after revoke, the edge disappears.
- **Watch for:** Granting `delegate` not being treated specially; scope `global` granted when `project` intended; revoke leaving an orphaned child; authz tree not reflecting the change until reload.

### SCN-GUI-19 — Export a project's knowledge bundle and import with dry-run
- **Priority:** P0
- **Area:** Projects & Portability
- **Persona:** team lead moving knowledge between projects/instances
- **Surfaces:** GUI `/projects/settings` (Knowledge Exchange panel); (REST `POST /api/projects/:id/export`, `/import`, `/pull-from`)
- **Preconditions:** Source project has lessons/documents; a target project exists.
- **Steps:**
  1. Open `/projects/settings`, scroll to the **Knowledge Exchange** panel.
  2. Click **Export** to download a bundle (zip + manifest + sha256).
  3. Switch to the target project; **Import** the bundle with a **conflict policy** and **dry-run** enabled.
  4. Review the dry-run summary, then run the real import.
- **Expected:**
  - Export streams a valid bundle; dry-run reports what would change without writing; the real import applies it per the conflict policy.
  - Cross-tenant guard prevents importing into a project you don't own.
- **Watch for:** Dry-run actually mutating data; conflict policy ignored (duplicates created); export hanging on large projects; bundle missing the sha256/manifest.

### SCN-GUI-20 — Create a project group to share knowledge across projects
- **Priority:** P2
- **Area:** Projects & Portability
- **Persona:** team lead organizing related projects
- **Surfaces:** GUI `/projects/groups`, `/projects`; (REST `/api/groups`)
- **Preconditions:** At least two projects exist.
- **Steps:**
  1. Open `/projects/groups`, create a new group.
  2. Add two projects to the group.
  3. Go to `/lessons`, switch the project selector to **All Projects** (or enable include-groups), and confirm cross-project lessons appear.
- **Expected:**
  - The group is created with the two member projects; cross-project/grouped views surface lessons from both.
- **Watch for:** Group membership not persisting; "All Projects" mode not honoring group boundaries; removing a project from a group leaving stale cross-references.

### SCN-GUI-21 — Inspect agent audit trail and trust levels
- **Priority:** P1
- **Area:** GUI Dashboards (agents)
- **Persona:** team lead auditing what agents have done
- **Surfaces:** GUI `/agents`, `/activity`; (REST `/api/agents`, `/api/audit`, `/api/activity`)
- **Preconditions:** Agents have performed actions (lesson writes, guardrail checks).
- **Steps:**
  1. Open `/agents` and review the agent list with trust levels and approval stats.
  2. Open an agent's slide-over/timeline to see its actions.
  3. Open `/activity` to see the unified event timeline; adjust notification settings.
- **Expected:**
  - Each agent shows aggregate stats (approvals/rejections) and a per-agent action timeline.
  - The activity feed shows a chronologically merged event stream.
- **Watch for:** Trust level not reflecting recent reject ratio; timeline missing guardrail-audit events; activity feed pagination/ordering broken; notification settings not saving.

### SCN-GUI-22 — Operator enqueues a background job and watches it run; checks system health
- **Priority:** P1
- **Area:** Jobs & Operations
- **Persona:** operator running maintenance tasks
- **Surfaces:** GUI `/jobs`, `/settings`, `/getting-started`; (REST `/api/jobs`, `/api/system/health`, `/api/learning-paths`)
- **Preconditions:** Project selected; worker running; `QUEUE_ENABLED` as configured.
- **Steps:**
  1. Open `/jobs`, click **Enqueue**, pick a job type (e.g. `index.run` or `faq.build`), provide a JSON payload, and submit.
  2. Filter the status tabs (queued → running → succeeded/failed) and expand the job to see its payload/error/attempts.
  3. Open `/settings` to confirm server info, ports, and feature flags (health view).
  4. Open `/getting-started` and confirm the onboarding learning-path progress reflects completed steps.
- **Expected:**
  - The job is enqueued and progresses through states; a failed job shows error + attempt count and may land in `dead_letter`.
  - System settings show live server/health info; the learning path tracks progress.
- **Watch for:** Invalid JSON payload accepted without validation; job stuck in `queued` when no worker is running (should surface, not hang the UI); status tabs miscounting; health page erroring when an optional service (Redis/Neo4j) is down instead of showing "disabled".

---

## Coverage notes & gaps

- **Coordination** (`charter_topic`/`list_board`/`claim_artifact`/`replay_topic_events`)
  and the **Governance decision primitives** (motions, voting, approval requests,
  intake mailbox, disputes, decision bodies/proxies) are **MCP/REST-only** — there is
  no dedicated human GUI page. The only governance surface a human touches in the GUI
  is the **Review Inbox** (`/review`, covered by SCN-GUI-01/02) and the read-side
  **audit/activity** views. This is the most significant GUI gap for these scenarios.
- `compress_context` and `reflect` (LLM synthesis) have limited/indirect GUI surfaces
  (reflect surfaces through `/chat`); not given a standalone scenario here.
