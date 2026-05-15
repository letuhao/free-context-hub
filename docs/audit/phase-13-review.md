# Phase 13 — Post-hoc Review & AMAW Quality Assessment

> Review doc (not a design doc). Created 2026-05-15. Reviewer: main session (self-review), human in the loop.
> Method: per-sprint code review (spec/AC compliance + quality/security) + AMAW meta-eval
> (adversary effectiveness, process integrity, size accuracy). Bugs collected here, fixed later per human decision.

## Commit ↔ Sprint map

| Sprint | Commits | Notes |
|--------|---------|-------|
| 13.1 | `1e36c95` (sprint), `0c98166` (post-audit: 7 residuals + AMAW v3.1 reframe) | pre-longrun |
| 13.2 | `416e48b` (sprint), `2f9f3b6` (post-audit cycle 1: 4 residuals), `024f827` (post-audit cycle 2: dead import) | longrun session 1 |
| 13.3 | `03f736c` (sprint) | longrun session 1 |
| (infra) | `e8d9b66` (DEFERRED-005 Geist fix) | longrun session 2 |
| 13.4 | `779775b` (sprint) | longrun session 2 |
| 13.5 | `47954d1` (sprint) | longrun session 2 |
| 13.6 | `7d690a1` (sprint) | longrun session 2 |
| 13.7 | `0360eff` (sprint + Phase 13 closeout) | longrun session 3 |
| (boundary) | `6673c20`, `22583ca`, `199b8f5` | longrun plan + handoffs |

## Severity legend

`BLOCK` ship-stopper / correctness or security bug · `HIGH` real bug, non-blocking ·
`MED` defect worth fixing · `LOW` minor · `COSMETIC` style.

---

## Sprint 13.1 — F1 Artifact Leasing

**Reviewed:** 2026-05-15. Commits `1e36c95` + `0c98166`. Files: service (`artifactLeases.ts`),
route (`artifactLeases.ts`), migration 0048, 5 MCP tools, 310-line test file.

### Code review findings

**BUG-13.1-1 (MED) — invalid `artifact_type` on claim returns HTTP 500 instead of 400.**
`src/api/routes/artifactLeases.ts:56-61` — the `POST /` catch block matches only
`err.message.startsWith('artifact_id must be')` and `'claim_artifact:'`. `validateClaimInput`
also throws a plain `Error('artifact_type must be one of: ...')` which matches neither prefix →
`next(e)` → `errorHandler` treats non-`ContextHubError` as 500. A client input error surfaces
as a server error. Service-layer unit tests pass (they assert the `throw` directly); route
error-mapping is untested; e2e `phase13-leases.test.ts` only ever sends `artifact_type:'custom'`.

**BUG-13.1-2 (MED) — `POST /artifact-leases/check` returns HTTP 500 for ANY validation error.**
`src/api/routes/artifactLeases.ts:68-83` — catch is bare `next(e)` with no 400 mapping at all.
`checkArtifactAvailability` throws plain `Error` for both invalid `artifact_type` and malformed
`artifact_id` → both become HTTP 500. Same root class as BUG-13.1-1.

**BUG-13.1-3 (LOW) — renew route status→HTTP code inconsistency.**
`src/api/routes/artifactLeases.ts:85-113` — `PATCH /:leaseId` maps only `not_found`→404;
`not_owner` and `expired` fall through to `res.json(result)` → HTTP 200. The sibling
`DELETE /:leaseId` (release) maps `not_owner`→403. Inconsistent contract for the same
ownership-failure condition.

### Service-layer assessment
`artifactLeases.ts` core logic is solid: claim transaction (lazy-delete → rate-count → conflict
check → INSERT with 23505 race handler + bounded retry), `renewArtifact` uses `FOR UPDATE`,
`forceReleaseArtifact` is project-scoped (tenant isolation). No correctness bug found in the
service. Self-conflict (re-claiming an artifact you already hold returns `conflict` pointing at
yourself) is a design choice, not a bug — noted only.

### AMAW evaluation
- **Adversary effectiveness:** Strong on design (r1 caught 3 real BLOCKs: cross-tenant
  force-release, silent renew no-op at cap, synthetic-incumbent race) and code (r1 BLOCK:
  GET/:leaseId service bypass). **Miss:** code-review r2 flagged "asymmetric artifact_type
  validation" and fixed it at the *service* layer — but neither Adversary, the 7-residual
  post-audit, Scope Guard, nor the 13.7 e2e suite caught the *route* error-mapping consequence
  (BUG-13.1-1/-2). The theme was circled and the concrete bug still shipped.
- **Process integrity:** All 12 phases present + post-audit — the most complete sprint.
  **Defect:** AUDIT_LOG has duplicate events (design-r2, code-r1, code-r2, post-review each
  appear twice with differing timestamps); timestamps are non-monotonic (design-review-r1
  ts=01:42 precedes clarify ts=02:00). The "append-only trust anchor" is not trustworthy as a
  timeline.
- **Size accuracy:** classified **L**; 19 files + new DB table + new MCP contract + new API
  contract → by the CLAUDE.md table this is **XL** (10+ files, side effects). Mild under-class.
- **Cost:** ~5 Adversary/Scope-Guard calls, ~400K tokens (per retro event). 9 in-loop findings
  + 7 post-audit residuals = 16 real issues surfaced for the sprint.

## Sprint 13.2 — F1 TTL sweep + Active Work GUI

**Reviewed:** 2026-05-15. Commits `416e48b` + `2f9f3b6` (post-audit 1) + `024f827` (post-audit 2).
Files: `sweepScheduler.ts`, `requireScope.ts`, `me.ts`, migration 0051, `jobExecutor` wiring,
`sweepExpiredLeases`, GUI `agents/page.tsx` Active Work panel.

### Code review findings

**BUG-13.2-1 (LOW / design-accuracy) — advisory lock does not achieve "leader election".**
`src/services/sweepScheduler.ts:53-141` — each cycle acquires `pg_try_advisory_lock`, enqueues,
then `pg_advisory_unlock` *immediately*. Two replicas whose 15-min timers are offset (the normal
case) each acquire the lock sequentially with no contention and each enqueue a `leases.sweep`
job → ~N jobs per cycle for N replicas, not 1. The lock only prevents the sub-millisecond
*simultaneous* case. Functionally harmless (the sweep DELETE is idempotent) so severity LOW,
but the file header comment "advisory lock (leader election for multi-replica)" overstates
the mechanism — real per-cycle dedup would need holding the lock for the interval or a
`last_swept_at` staleness check. Neither the Adversary code review (3 rounds) nor the 13.7
e2e suite flagged the gap between comment and behavior.

### Assessment — solid work
- `me.ts` — refactored to a pure `buildMeResponse` + `createMeRouter` factory; the r3 fix
  (consult both role AND scope, restrictive default for the scope-without-role shape) is
  correct and well-reasoned. No bug.
- `requireScope.ts` — fallback keyed on `apiKeyScope === undefined` (decoupled from role in
  r2). Correct. The 403/400 branches are right.
- Migration 0051 — idempotent DO-block with set-equality pre/post detection + loud abort on
  drift. Genuinely defensive; among the best migrations in the phase.
- `sweepExpiredLeases` / `clampGrace` — NaN/null/negative/over-max all guarded. Clean.
- GUI Active Work panel — auto-refresh paused on hidden tab, interval + ticker both have
  cleanup, per-row `canForceReleaseRow` scope logic correct after R1 fix.

### AMAW evaluation
- **Adversary effectiveness:** ran the full **3 design + 3 code rounds** (cap) — the most
  expensive sprint. The r1/r2/r3 chain produced real fixes (requireScope role-coupling →
  scope-coupling, migration regex anchoring, me.ts shape handling). 3 post-audit cycles caught
  4 more residuals (dead `useMemo` import, GUI header gate). Effective, but expensive: 6 review
  rounds + 3 post-audit cycles for one sprint. **Miss:** BUG-13.2-1 — 6 rounds of review never
  questioned whether the advisory lock does what its own comment claims.
- **Process integrity:** code review reached round 3 — verify HS-7 ("same BLOCK in round 3")
  was correctly evaluated as a *new* finding, not a repeat (it did not Hard Stop, so presumably
  new). Post-audit cycle ran (unlike later sprints). AUDIT_LOG duplicate-event / non-monotonic
  timestamp defect persists.
- **Size accuracy:** longrun plan §8 pre-classified **M** (3-5 files). Actual: ~16 code files +
  new middleware + new endpoint + new migration + new job_type + GUI panel + side effects →
  **L**. Under-classified.
- **Cost vs value:** highest-cost sprint of the phase (6 rounds + 3 post-audit). Caught real
  issues but the cost/catch ratio is the worst — candidate evidence that the 3-round cap +
  aggressive post-audit is over-tuned for a sprint this size.

## Sprint 13.3 — F2 core (review requests)

**Reviewed:** 2026-05-15. Commit `03f736c`. Files: migration 0049, `constants/lessonStatus.ts`,
`services/reviewRequests.ts` (329 lines), `routes/reviewRequests.ts`, 2 MCP tools, 247-line test
file (11 tests), 4 enum sites + runtime guard in `mcp/index.ts`, `activity.ts`/`lessons.ts` union
extensions. Master design ref: `docs/phase-13-design.md` §"Feature 2" (L251-430), F2 ACs L736-744.

### Code review findings

**BUG-13.3-1 (MED) — F2's human-review gate is advisory, not enforced.**
`src/api/routes/reviewRequests.ts:48,68` — `POST .../approve` and `/return` are gated by
`requireRole('writer')` only, and the reviewer identity `resolved_by` is an unverified,
client-supplied body string (`:52-56`, `:72-76`). Agents hold writer keys. So an agent can
`submit_for_review` a lesson it authored, then immediately `approve` it passing
`resolved_by: "project-owner"` — the lesson goes `active` with a forged reviewer in the audit
trail. This *matches* spec A8 ("approve/return = writer+. No admin requirement") and the master
design's writer-level REST contract (design L405-406), so it is a **spec-sanctioned** gap — but
it contradicts F2's stated purpose: "the agent is done; a human decision is required before the
artifact can be promoted to `active`" (design L257). The design r1-F1 BLOCK correctly killed the
original `resolved_by = apiKeyRole` design, but the replacement (a free-text body field) improved
audit *granularity* without giving it *trustworthiness* — no review round asked whether a
client-supplied identity can anchor an audit trail. Severity is threat-model-dependent: MED if
project writers are trusted; HIGH if F2 is meant to gate against agent self-approval. Phase D must
decide: code fix (gate `approve` to `admin`, derive `resolved_by` from the authenticated key) vs
master-design correction.

**BUG-13.3-2 (HIGH — reported fixed in 13.7, verify in 13.7 review) — the review gate is
bypassable; nothing blocks a lesson leaving `pending-review` via `update_lesson_status`.**
The master design lifecycle (L269-273) shows `pending-review` exiting only to `active` (approve)
or `draft` (return), and L279-280 explicitly marks `active → pending-review` ✗ and
`pending-review → superseded` ✗. But the design's *implementation spec* (L283-310) enforces only
the `→ pending-review` **target** edge: `update_lesson_status` keeps the `LESSON_STATUS_WRITABLE`
enum (excludes `pending-review`) plus a runtime guard. Nothing checks the **source** status. So
`update_lesson_status(lesson, status='active')` on a lesson currently in `pending-review`
succeeds — `active` is writable — promoting the lesson and skipping the human gate entirely. The
`review_requests` row is then orphaned `pending` forever: `resolveRequest`'s lesson UPDATE is
`WHERE ... status='pending-review'`, which never matches again — and because the partial unique
index is `WHERE status='pending'`, that orphan also blocks the lesson from ever being
re-submitted. Sprint 13.3 implemented the master design's implementation-spec faithfully — but
that spec is incomplete against its own lifecycle diagram. Neither the 13.3 design Adversary (r1)
nor the code Adversary (r1) questioned the source side. 13.7's full-mode design r3-F1 caught
exactly this ("updateLessonStatus has no source-status check; master design ✗ transitions NOT
enforced anywhere") and SESSION_PATCH records a 13.7 Part-A fix adding a source-status guard with
a transition rule table to `lessons.ts`. **HIGH at 13.3 ship-state; resolution to be confirmed in
the 13.7 review.** Location: `mcp/index.ts:1638-1645` (guard covers target only) + master design
gap L283-310.

**BUG-13.3-3 (LOW) — `GET /review-requests?limit=abc` (or `offset=abc`) → HTTP 500.**
`src/api/routes/reviewRequests.ts:32-33` — `parseInt(String(req.query.limit), 10)` returns `NaN`
for non-numeric input. `NaN` is passed to `listReviewRequests`, where
`Math.min(Math.max(params.limit ?? 20, 1), 100)` cannot recover it: `??` only catches
null/undefined, so `NaN` flows through `Math.max(NaN,1)`→`NaN`→`Math.min(NaN,100)`→`NaN` →
`LIMIT $n` bound to `NaN` → Postgres `invalid input syntax for type bigint: "NaN"` → `next(e)` →
HTTP 500. Same for `offset`. Third instance of the "client input error → HTTP 500 not 400" class
after BUG-13.1-1/-2. The MCP `list_review_requests` tool is immune (`z.number().int()` rejects
it). Location: `routes/reviewRequests.ts:32-33` + `reviewRequests.ts:159-160`.

**BUG-13.3-4 (LOW / doc-vs-impl) — `submit_for_review` output `status` collides with the design's
documented meaning and with `list_review_requests`.**
Master design L371-376 documents `submit_for_review` output as `status: 'pending'` (the
review-request status). The implementation returns `status: 'submitted'` — a discriminated-union
*result tag* (`submitted | lesson_not_found | wrong_lesson_status | already_pending`).
`list_review_requests` items, meanwhile, use `status` = the request status
(`pending|approved|returned`). So `status` carries two unrelated meanings across the two F2 MCP
tools. The implementation is internally consistent with the Sprint 13.1 tool family (which also
uses `status` as the result discriminator), so it's the master design's output spec that is
stale — but a client coded against the design doc mis-handles the field. `reviewRequests.ts:24-28`.

### Service-layer assessment
`reviewRequests.ts` core logic is solid. The three race guards are real and correct: (1)
`submitForReview`'s `UPDATE lessons ... WHERE status='draft' RETURNING title` closes the
pre-check→update window (design r1-F2 fix); (2) the `INSERT ... catch 23505` handles concurrent
submits against the partial unique index; (3) `resolveRequest`'s `UPDATE review_requests ... WHERE
status='pending'` plus the tightened lesson `UPDATE ... WHERE project_id=$3 AND
status='pending-review'`, with full transaction rollback on 0 rows (code-r1 F1+F3 fix), is
genuinely defensive against both cross-tenant drift and concurrent state mutation. Migration 0049
reuses the 0051-class idempotent DO-block (regex-parse the CHECK, set-equality pre/post detection,
loud abort on drift) for both constraint extensions — among the better migrations in the phase.
Three minor notes, none rising to a numbered bug:
- `submitForReview` returns `created_at` from the JS clock (`new Date().toISOString()`, line 124)
  rather than the row's DB `created_at` (`DEFAULT now()`) — the INSERT has no `RETURNING
  created_at`. Sub-second drift, cosmetic, but it means a client cannot match the value against
  `list_review_requests`'s (DB-sourced) `created_at`.
- The `already_pending` 23505 path (`:103`) returns `existing_request_id: ''` if the winning
  request is concurrently resolved before the re-fetch SELECT — degenerate, near-unhittable.
- review-request REST routes carry no `requireScope` — consistent with spec A8's explicit
  DEFERRED-004 deferral, not a new gap. GET routes carry no `requireRole('reader')` — harmless
  (`reader` is the role floor; `bearerAuth` enforces authn).

### AMAW evaluation
- **Adversary effectiveness:** design r1 found 3 genuine BLOCKs (resolved_by-as-role-string, the
  missing `WHERE status='draft'` UPDATE guard, raw UUID in the activity title) — all real, all
  fixed in v2. Code r1 found 2 BLOCK + 1 WARN; the cross-tenant/state-race lesson-UPDATE
  tightening was a real catch. **Misses:** (a) BUG-13.3-2 — no round questioned whether
  `pending-review` is protected as a transition *source*, the central state-machine hole; (b)
  BUG-13.3-1 — design r1-F1 fixed the *symptom* (role-as-identity) but no round asked whether a
  client-supplied body field is a *trustworthy* identity; (c) the AC2/AC7 test gaps below.
  Compressed mode (2 rounds total vs 13.2's 6) correlates directly with these escapes.
- **Process integrity:** materially weaker than 13.1/13.2.
  - **No `qc`, `post-review`, or `session` events in AUDIT_LOG** — the sprint jumps
    `review-code` → `build/fixes_applied` → `retro`. CLAUDE.md marks POST-REVIEW "NEVER
    skippable"; it was skipped. The "Scope Guard CLEAR / AC1-AC7 COVERED" verdict exists only in
    the commit-message prose — never written as an auditable event.
  - **Adversary r2-design and r2-code both skipped** (both explicitly logged: "longrun session
    time pressure"). Design v2 and the code fixes went un-re-reviewed.
  - **1 BLOCK deferred, not resolved** — code-r1 F2 (the unreachable runtime guard / its missing
    test). The deviation is logged and the real risk is low (dead code), but CLAUDE.md/AMAW says a
    BLOCK must be *resolved* before SESSION. The `retro` event records `deviations:4`.
  - **AC coverage is over-credited.** The commit claims "AC1-AC7 all COVERED." In fact: AC7
    (`update_lesson_status` rejects `→pending-review`) has **no** unit test — the test file's own
    header says "covered by mcp guard — smoke." AC2's `already_pending` outcome has **no** test —
    the test named `'rejects when pending request exists'` actually asserts `wrong_lesson_status`
    (its own inline comment admits the lesson is in `pending-review` by then). The
    `submitForReview` 23505 race-catch is also untested. The Scope Guard's CLEAR verdict rests on
    a coverage claim that does not hold.
  - 13.3's deploy-state smoke checked `tools/list` (registration) but not `tools/call`
    (invocation), so it missed that `submit_for_review` — shipped with a `discriminatedUnion`
    outputSchema — was broken over MCP transport (DEFERRED-007). The gap stayed invisible until
    13.4's end-to-end smoke.
  - On the positive side: 13.3's own AUDIT_LOG events ARE chronologically monotonic
    (11:55→14:10) with no duplicates — the 13.1 duplicate-event / non-monotonic-timestamp defect
    does **not** recur here.
- **Size accuracy:** classified **L** (8-10 files). Actual: 11 code/migration files + a new DB
  table + a new MCP contract (2 tools) + a new REST contract + the migration + `LessonStatus` /
  `EventType` union side-effects → **XL** by the CLAUDE.md table (10+ files, side effects).
  Under-classified by one tier — consistent with 13.1 (L→XL) and 13.2 (M→L); every sprint
  reviewed so far is under-classified.
- **Cost vs value:** ~1h wall-clock, 2 Adversary rounds, +11 tests, "compressed AMAW mode (~50%
  time savings)." But F2 *is* an enforcement gate — its entire value is that a human decides. A
  feature with a security-relevant state machine was the wrong place to compress: the skipped
  r2/r3 rounds are precisely what full-mode 13.7 later used to catch BUG-13.3-2. Concrete evidence
  *against* the 13.2 review's "compressed is the sweet spot for moderate-risk backend" — F2 was
  not moderate-risk.

## Sprint 13.4 — F2 GUI (Submitted for Review tab)

**Reviewed:** 2026-05-15. Commit `779775b`. Files: `gui/src/lib/api.ts` (+46 — 4 methods +
`ReviewRequest` type), `gui/src/app/review/page.tsx` (+289 — `ReviewMode`, tab strip,
`fetchReviewRequests` fan-out, `ReturnReviewDialog`, approve/return handlers). Spec: a single
combined `clarify+design+plan` doc; **0 Adversary rounds; 0 tests added.** Master design ref:
§"GUI: Review Inbox update" L414-430, F2 AC8 (L744).

### Code review findings

**BUG-13.4-1 (MED) — "View Full Lesson" opens an empty lesson, and the modal exposes a second,
wrong "Approve" button.**
`review/page.tsx:731-746` — the Submitted-for-Review card's "View Full Lesson" button fabricates
a stub `Lesson` with `content: ""`, `tags: []`, `source_refs: []` and passes it to `<LessonDetail>`
(`:853`). `LessonDetail` renders `lesson.content` directly (`lesson-detail.tsx:454`) and never
fetches by id — so the reviewer's primary "read the lesson" affordance shows a **blank Content
section**. F2's whole purpose is that a human reads the lesson and decides; the dedicated review
UI cannot display it. Neither layer supplies the content: Sprint 13.3's `GET
/review-requests/:reqId` returns `lesson_title`/`lesson_type` but no `content` (despite master
design L404 — "detail + full lesson content"), and the 13.4 button does not call `getReviewRequest`
or any get-lesson endpoint anyway — so the fix spans both layers. Compounding it: the stub's
`status: "pending_review"` trips `LessonDetail`'s footer (`:814`) into rendering an "Approve"
button that calls `changeStatus("active")` → `update_lesson_status`→`active` — the **BUG-13.3-2
bypass path**. So the modal opened from a review card offers a *second* approve action, one click
from the card's correct "Approve → Active", that skips review-request resolution and orphans the
`review_requests` row (pre-13.7) — or errors out once 13.7's source-status guard lands.

**BUG-13.4-2 (MED) — GUI/API status-slug mismatch: `pending_review` (underscore) vs
`pending-review` (hyphen).**
The backend status value is `pending-review` (hyphen — `LessonStatus`, migration 0049 CHECK,
`LESSON_STATUS_ALL`). The GUI uses `pending_review` (underscore) in `ReviewFilter`
(`review/page.tsx:23`), `fetchReviewItems`' status query (`:284`), `pendingCount` (`:403`), the
"Pending Review" filter tab (`:472`), the View-stub (`:740`), `LessonDetail`'s footer (`:814`),
and — critically — the sidebar badge query (`sidebar.tsx:131`). Two live consequences:
- **(a) GUI-AC6 ("badge = auto-generated + pending-review") is NOT satisfied.** `sidebar.tsx:129-133`
  *does* compute the badge as a sum — `fetch(.../api/lessons?status=draft)` +
  `fetch(.../api/lessons?status=pending_review)` — but the second fetch's `pending_review` never
  matches the DB's `pending-review`, so its `total_count` is always 0 and the badge = draft count
  only. The Scope Guard nonetheless marked GUI-AC6 COVERED — so the verdict is really **5/6, not
  6/6**. 13.4 never touched `sidebar.tsx`; its spec R-med flagged exactly this risk ("skip if the
  existing sidebar already handles pending-review correctly") and the sprint mis-judged that it did.
- **(b)** The "Auto-Generated → Pending Review" filter is permanently empty: `fetchReviewItems`
  queries `?status=pending_review` and `pendingCount` filters `l.status === "pending_review"` —
  neither matches the API's hyphen value → the tab shows `(0)` and lists nothing even with
  pending-review lessons present.
Root cause is a pre-existing GUI/API vocabulary split that Sprint 13.3 *activated* (it introduced
the real `pending-review` status) and Sprint 13.4 — the F2 GUI sprint restructuring this exact
page — did not reconcile.

**BUG-13.4-3 (MED) — the GUI fills `resolved_by` with a role label, re-introducing the defect the
13.3 design-r1-F1 BLOCK was raised to kill.**
`review/page.tsx:194-199` — `resolvedByLabel()` returns `"anonymous"`, `"dev-mode-admin"`,
`"env-admin"`, or `` `${role}@${scope}` `` (e.g. `"writer@free-context-hub"`), and that value is
sent as `resolved_by` for every approve/return. It is a *role+scope label*, not a human identity.
The Sprint 13.3 design Adversary's r1-F1 BLOCK was raised precisely to kill `resolved_by =
apiKeyRole` ("collapses all reviewers to the role string; the audit trail cannot distinguish two
reviewers"); the 13.3 backend fix made `resolved_by` an explicit field so a *real* identity could
be supplied. The 13.4 GUI — the only non-API caller — fills that field with a role label again.
Every GUI approval in dev mode logs `resolved_by: "dev-mode-admin"`; under auth, two different
humans on writer-scoped keys both log as `"writer@<proj>"`. With 0 Adversary rounds on 13.4,
nothing re-checked that the GUI honored the prior finding's intent. Combined with BUG-13.3-1
(approve is `writer+`, `resolved_by` unverified), F2's human-review audit story is inert
end-to-end.

**BUG-13.4-4 (LOW) — approve/return `already_resolved` / `not_found` handling is unreachable dead
code.**
`handleApproveReview`/`handleReturnReview` (`review/page.tsx:238-246,264-272`) branch on
`r.status === "resolved" | "already_resolved"` and an `else`. But the REST routes return HTTP 409
for `already_resolved` and 404 for `not_found` (`routes/reviewRequests.ts:62-63,85-86`), and the
GUI's `request()` **throws** on every non-2xx (`api.ts:20-28`). So `r` is assigned only on HTTP
200 (`status:"resolved"`); the `already_resolved` and `else` branches can never run. On a
concurrent resolve the loser gets a raw `API error (409): ...` toast instead of "Already approved
by another reviewer" — and, worse, the list does **not** refresh, because `fetchReviewRequests()`
sits inside the dead `already_resolved` branch; the stale row lingers until a manual tab switch.
Rare path, degraded-not-broken (hence LOW) — but a clear symptom of writing the handler without
checking the 13.3 route's status codes.

### GUI assessment
The sprint is not sloppy where it was reasoned-through: the multi-project fan-out in
`fetchReviewRequests` (`:205-217`) catches per-project failures so one bad project can't blank the
list; `ReturnReviewDialog` correctly enforces a non-empty note (trimmed, button disabled);
`effectiveProjectIds`/`projectsLoaded` gating and the `useCallback`/`useEffect` deps are correct.
Two minor notes, un-numbered: the "Submitted for Review" tab badge shows `0` until the tab is
first opened (`reviewRequests` is fetched only when `mode === "submitted_for_review"`), so a
reviewer on the default Auto-Generated tab never sees the pending count at a glance; and there is
no auto-refresh on Tab 2 (acceptable — refetch-on-action covers it).

### AMAW evaluation
- **Adversary effectiveness: zero.** 13.4 ran **0 Adversary rounds** — no design review; code
  review explicitly skipped (`review-code` event: "Skipped Adversary code-review round
  (compressed-mode deviation): GUI sprint inherently lower risk (no DB, no race conditions, no
  schema)... Scope Guard QC will be the gate"). The 4 findings falsify that premise: every one is
  a correctness defect that needs no DB and no concurrency — an API-contract slug mismatch
  (13.4-2), a dead-code branch from misreading HTTP status codes (13.4-4), a missing data fetch
  (13.4-1), a regressed prior Adversary finding (13.4-3). "Lower risk" conflated "no concurrency"
  with "no correctness risk." A single code-review round that grepped `pending` or read the 13.3
  route's status codes would very likely have caught 13.4-2 and 13.4-4.
- **Process integrity:** the most compressed sprint so far.
  - clarify + design + plan **collapsed into one `phase_complete` event** — CLAUDE.md's anti-skip
    rules explicitly forbid combining phases ("each phase boundary triggers a different sub-agent
    — combining skips the agent"). No standalone DESIGN doc, no `review-design`.
  - **No `qc`, `post-review`, or `session` events** — the AUDIT_LOG is `clarify+design+plan` →
    `build` → `review-code`(skipped) → `retro`. POST-REVIEW skipped for the 2nd consecutive sprint
    despite "NEVER skippable."
  - The Scope Guard verdict ("6/6 ACs COVERED") lives only in the commit message and is **wrong**
    — GUI-AC6 is not met (BUG-13.4-2a). The one gate the sprint relied on over-credited.
  - `retro` event: `adversary_rounds:0, tests_added:0, deviations:1`. Timestamps monotonic, no
    duplicates — the 13.1 log defect still does not recur.
- **Size accuracy:** classified **M**. 2 files → **S** by file count; ~4 logic changes (mode
  state, fan-out fetch, 2 handlers, new dialog) → M by logic count — roughly accurate, the first
  sprint not under-classified. But the "side effects: Maybe" judgment under-weighted reality: by
  consuming 13.3's new `pending-review` status, 13.4 *activated* latent slug bugs in `sidebar.tsx`
  and its own filter (BUG-13.4-2) — a 2-file diff with a correctness effect in a third, untouched
  file.
- **Cost vs value:** ~45 min, 0 rounds, 0 tests — the cheapest sprint of the phase, and 4 bugs
  shipped plus a falsely-COVERED AC. Direct evidence that hyper-compressed (0 Adversary rounds) is
  miscalibrated for a GUI sprint that wires up a brand-new backend contract — exactly the
  situation where contract-mismatch bugs breed.

## Sprint 13.5 — F3 core (taxonomy profiles + codex-guardrail)

**Reviewed:** 2026-05-15. Commit `47954d1`. 17 files (5 new code + 7 modified + 5 docs): migration
0050, `constants/lessonTypes.ts`, `services/taxonomyService.ts` (322 lines),
`services/taxonomyBootstrap.ts`, `services/taxonomyService.test.ts` (212 lines, 12 tests),
`routes/taxonomy.ts`, `config/taxonomy-profiles/dlf-phase0.json`, + diffs to `lessons.ts`,
`kg/linker.ts`, `mcp/index.ts` (3 enum sites + 4 new tools), `index.ts`, `core/index.ts`,
`api/index.ts`. Master design: §"Feature 3" (L434-650), F3 ACs L746-754.

### Code review findings

**BUG-13.5-1 (HIGH) — the new `validateLessonType` gate ignores the Phase 8 `lesson_types` table;
Sprint 13.5 breaks the Phase 8 custom-lesson-types feature.**
13.5 adds `validateLessonType(project_id, lesson_type)` at the top of `addLesson`
(`lessons.ts:200`) — the r1-F1 fix that funnels REST `POST /api/lessons`, `/import`, and MCP
`add_lesson` through one gate. The gate's accepted set is `getValidLessonTypes` =
`[...BUILTIN_LESSON_TYPES, ...activeProfile.lesson_types]` (`taxonomyService.ts:292-296`) — the 5
hardcoded built-ins plus the active *taxonomy profile*. It does **not** query the Phase 8
`lesson_types` table (`src/services/lessonTypes.ts`, route `/api/lesson-types`, GUI
`/settings/lesson-types`, the `useLessonTypes` hook — that table is even part of the Phase 11
export bundle, `exchange/importProject.ts:261` / `exportProject.ts:128`). Consequence: a lesson
type created through the Phase 8 custom-types feature is no longer accepted — `add_lesson` and
`POST /api/lessons` return HTTP 400 `Invalid lesson_type '<x>'`. The GUI add-lesson form still
lists the type in its dropdown (it reads the `lesson_types` table) — the user picks it, submits,
gets a 400. Two parallel custom-lesson-type systems now coexist and the mandatory write-path gate
knows only the newer one. Root cause is design-level: the master design's `getValidLessonTypes`
spec (L541) itself omits the Phase 8 table, so 13.5 implemented the design faithfully — the gap
survived CLARIFY, DESIGN, the r1 Adversary, and the Scope Guard. **Severity HIGH**, with one
caveat for Phase D: it only bites projects/instances that actually used Phase 8 custom types —
but the feature, its API, its GUI page, and its export support all still ship, so this is a live
regression of a live feature, not a dormant one. `taxonomyService.ts:292-309` + `lessons.ts:200`.

**BUG-13.5-2 (LOW) — `kg/linker.ts` hardcodes the guardrail-type literals instead of the
`GUARDRAIL_LESSON_TYPES` constant, violating the sprint's own spec A3.**
Spec A3 designates `GUARDRAIL_LESSON_TYPES` the single source of truth for the guardrail-class
type set, "used in 2 places: `lessons.ts:290` and `kg/linker.ts:7`", so "adding a third
guardrail-class type later requires only updating the constant." `lessons.ts` honors it
(`(GUARDRAIL_LESSON_TYPES as readonly string[]).includes(...)`). `kg/linker.ts` does **not** — it
inlines `if (t === 'guardrail' || t === 'codex-guardrail')`. Adding a future guardrail-class type
to the constant would update the guardrails-INSERT trigger but silently *not* the KG edge mapping
→ edges for the new type misclassified `MENTIONS` instead of `CONSTRAINS`. No current data impact
(the lists agree today) — hence LOW — but a mechanical code-vs-spec deviation the skipped
code-review Adversary round would likely have caught. `kg/linker.ts:7`.

**BUG-13.5-3 (LOW) — `createTaxonomyProfile` accepts `lesson_types[].color` with no validation.**
`taxonomyService.ts:144-164` validates each entry's `type` and `label` (non-empty, no shadowing,
no duplicates) but never inspects `color`. The Phase 8 custom-lesson-type work explicitly
hardened exactly this — the Phase 8 review fixed both a "color validation" issue and an XSS issue
(SESSION_PATCH Phase 8 review: "7 issues: SQL params, color validation, XSS, ..."). 13.5's
profile-creation path re-opens an unvalidated color field. Whether it is *exploitable* depends on
how Sprint 13.6's Taxonomy panel renders the color (inline `style`, `className`, …) — flagged
here as the input-validation gap and carried to the 13.6 review for the render-side check.
`taxonomyService.ts:144-164`.

### Service-layer assessment
`taxonomyService.ts` is otherwise solid. The slug-scoping schema is well-judged: `UNIQUE NULLS
NOT DISTINCT (slug, owner_project_id)` makes built-in slugs globally unique (all share
`owner_project_id=NULL`) while custom slugs scope per-owner — matches master design L516-519.
`activateProfile`'s lookup (`WHERE slug=$1 AND (owner_project_id IS NULL OR owner_project_id=$2)`)
correctly prevents activating another project's custom profile (test 7 confirms), and `ORDER BY
owner_project_id NULLS LAST` lets a project's own same-slug profile shadow a built-in — a
defensible choice. `upsertBuiltinProfile`'s `ON CONFLICT (slug, owner_project_id)` works against
the `NULLS NOT DISTINCT` index, making re-seeding idempotent. `createTaxonomyProfile` forces
`is_builtin=false` structurally (hardcoded in the INSERT; the route doesn't even destructure
`is_builtin` from the body) so F3-AC4 holds. The REST routes carry the r1-F2 fixes —
`requireScope('id')` on `/activate` + `DELETE`, the `callerScope` check on `POST
/api/taxonomy-profiles` — and, unlike the Sprint 13.1 routes (BUG-13.1-1/-2), this router *does*
map `ContextHubError BAD_REQUEST`→400. Notes (un-numbered): migration 0050 hard-requires Postgres
15+ (`UNIQUE NULLS NOT DISTINCT`) where 0049/0051 do not; `createTaxonomyProfile` never checks
that `owner_project_id` references a real project (orphan profile possible);
`validateLessonType` adds one `getActiveProfile` SELECT per `add_lesson`. On the `codex-guardrail`
engine path: the implementation widens the `lessons.ts` guardrails-INSERT trigger rather than the
`check_guardrails` query the master design sketched (L547-554) — the design's SQL is explicitly
labelled "conceptual", and the trigger approach matches how the existing `guardrail` type already
works (only lessons carrying a structured `guardrail` payload become engine rules), so this is a
sound deviation, not a defect.

### AMAW evaluation
- **Adversary effectiveness:** 1 round (design r1; code-review Adversary skipped — compressed
  mode). Design r1 found 3 genuine findings — F1 BLOCK (REST validation gap), F2 BLOCK
  (cross-tenant taxonomy routes), F3 WARN (dropped OR-branch) — all real, all fixed inline. **But
  the r1-F1 fix is what created BUG-13.5-1:** the Adversary correctly said "move validation to the
  service layer so REST can't bypass it", and the fix did — yet no round asked the next question,
  *what set of types should that gate accept?* Both the Adversary and the team took the master
  design's `getValidLessonTypes` = builtins+profile at face value and never cross-referenced the
  Phase 8 `lesson_types` table. An adversarial pass on the *fix itself* — the code-review round
  that was skipped — is exactly where "this new gate's accept-set vs. what REST used to accept"
  gets asked. **Misses:** BUG-13.5-1 (HIGH), BUG-13.5-2 (mechanical spec-A3 deviation), the
  unvalidated color.
- **Process integrity:** the worst phase-combining in the phase so far.
  - clarify + design + plan **collapsed into one event** (as in 13.4).
  - **qc + post-review + session + commit collapsed into a single event** whose `action` is
    `phase_complete_batch` — four phases, one event, under an action type CLAUDE.md never defines.
    POST-REVIEW ("NEVER skippable") has now been absorbed into a batch event for the 3rd
    consecutive sprint. The "Scope Guard CLEAR" + "cumulative scope check CLEAR across 13.2-13.5"
    verdict lives inside that batch event's free-text `note` — not a discrete `qc`/`post-review`
    event with a `status` field.
  - The `clarify` `phase_enter` announced "Returning to fuller AMAW mode due to F3 cross-cutting
    impact"; the sprint then ran compressed (1 design round, code review skipped). Stated intent
    ≠ actual mode.
  - Timestamps monotonic, no duplicates.
- **Size accuracy:** the spec **explicitly self-classified XL** ("size_class: XL (12 files)") and
  that is **correct** — 12 code files + 2 new tables + new MCP + new REST contracts. The first
  sprint reviewed whose classification is accurate (13.1 L→XL, 13.2 M→L, 13.3 L→XL were all
  under; 13.4 M≈right). But note the perverse result: 13.5, an *accurately-classified XL* sprint
  that modifies the core `addLesson` write path, received **1** Adversary round; Sprint 13.2, an
  *L*, received **6**. Review depth is inversely correlated with blast radius across the phase.
- **Cost vs value:** ~75 min, 1 round, 12 tests. The phase's most consequential backend sprint —
  it introduces a parallel custom-type system and a mandatory gate on the most-called write path
  — got its second-lightest review. The HIGH regression is the direct price: BUG-13.5-1 needed
  exactly the adversarial question a code-review round asks. AMAW mode here was chosen by
  feature-area heuristic ("F3 backend → compressed") rather than by blast radius. Coverage gap:
  of 8 F3-ACs, the 12 unit tests directly exercise AC1/AC2/AC3 (via the validator and
  `getValidLessonTypes`); **AC5 (codex-guardrail in `check_guardrails` — decision D2, the
  headline F3 behavior), AC6 (KG edge), AC7 (deactivation safety), AC8 (startup seed) have no
  automated test** — smoke-only — yet the Scope Guard marked ACs 1-8 CLEAR.

## Sprint 13.6 — F3 GUI (taxonomy panel)

**Reviewed:** 2026-05-15. Commit `7d690a1`. 3 code files: `gui/.../settings/taxonomy-panel.tsx`
(NEW, 213 lines), `settings/page.tsx` (+4 — mount), `gui/src/lib/api.ts` (+47 — 4 methods + 2
types). **0 Adversary rounds; 0 tests.** Master design ref: §"GUI: Project Settings → Taxonomy tab".

### BUG-13.5-3 follow-up (resolved here)
The Sprint 13.5 review flagged `createTaxonomyProfile` accepting an unvalidated `color` and
deferred the exploitability check to this render site. **Verified not exploitable.**
`taxonomy-panel.tsx:144-148` feeds `lt.color` into a React `style` *object*
(`{backgroundColor, borderColor, color}`), not a raw `style` string. React assigns each value via
the CSSOM, which silently rejects malformed values — no `;`-breakout, no script-execution path,
and `color`/`backgroundColor`/`borderColor` don't accept `url()`. A garbage `color` just renders a
chip with no color. **BUG-13.5-3 is downgraded to COSMETIC.** One real (cosmetic) nit remains: the
renderer assumes `#rrggbb` hex — it appends `15`/`40` alpha bytes (`` `${lt.color}15` ``) — so a
non-hex profile color yields an invalid 8-char value and the chip loses its background/border.
dlf-phase0's colors are all hex, so this is latent.

### Code review findings

**BUG-13.6-1 (LOW) — switch-profile picker: the Activate button is stuck disabled until the user
re-picks.**
`taxonomy-panel.tsx:43-47` — `fetchAll` preselects `selectedSlug = merged[0].slug` **only when no
profile is active**; when a profile *is* active it sets `selectedSlug = ""`. The "Switch to
another profile" `<select>` (`:172-183`) is a controlled component with `value=""`, so the
browser displays its first `<option>` while React state holds `""`. The Activate button is
`disabled={acting || !selectedSlug}` → `!"" === true` → **disabled**. A user who opens Project
Settings with a profile active, sees a profile named in the dropdown, and clicks Activate finds
nothing happens; they must open the dropdown and re-select an item (firing `onChange`) to enable
the button. Controlled-value/displayed-value desync — LOW (functional once you interact), the
kind of papercut a single code-review round catches.

### GUI assessment
The panel is otherwise clean and correct: `fetchAll` fetches active + built-ins + this-project's
custom in parallel and correctly filters the active profile out of the switch list; profile
scoping is right (it requests `owner_project_id: projectId` for custom — never other projects');
the deactivate `ConfirmDialog` is `destructive` and its copy accurately explains that lesson_type
strings persist as raw text after deactivation (GUI-F3-AC4); the colour-chip rendering satisfies
GUI-F3-AC5. Two un-numbered notes:
- `handleActivate`'s `else` branch ("Profile not found") is unreachable for the same reason as
  BUG-13.4-4 — the route 404s on `profile_not_found` and the GUI `request()` throws on non-2xx.
  Near-unhittable here (the picker only lists profiles that exist), so not numbered — but it is
  the *third* occurrence of GUI code written as if the taxonomy/review routes return 200 + a
  discriminated body when they actually return 404/409.
- The Sprint 13.5 `GET /api/taxonomy-profiles?owner_project_id=X` route carries no `requireScope`
  — any caller can enumerate another project's custom profile names/vocabularies. Low-sensitivity
  metadata, squarely inside the existing DEFERRED-004 read-scope gap; the 13.6 panel only ever
  queries its own project, so the GUI itself does not leak. Noted, not numbered.

### AMAW evaluation
- **Adversary effectiveness:** 0 rounds (hyper-compressed, "follows the 13.4 pattern"). One LOW
  papercut + a recurring dead-branch pattern slipped through. But unlike 13.4, 13.6 *is* genuinely
  the lowest-risk sprint of the phase — a self-contained settings panel consuming an
  already-shipped, already-smoke-tested REST surface, no new contract. The honest read:
  hyper-compressed was defensible for 13.6 and indefensible for 13.4 — yet the calibration gave
  both the identical 0 rounds. The mode knob does not distinguish them.
- **Process integrity:** the thinnest audit trail in the phase. **The AUDIT_LOG for 13.6 stops at
  `build+verify`** — three events only: `clarify` enter, `clarify+design+plan` complete,
  `build+verify` complete. **No `review-code`, `qc`, `post-review`, `session`, `commit`, or
  `retro` event exists** — even though commit `7d690a1` was made and SESSION_PATCH narrates a
  "Sprint 13.6 retro boundary." POST-REVIEW skipped for the 4th consecutive sprint; the
  commit-message "Scope Guard + live REST smoke as gate" has no machine-readable event anywhere.
  clarify+design+plan combined; build+verify combined. The `clarify` enter announced "label
  rendering" in scope; the spec then deferred cross-page label rendering — minor in-sprint scope
  drift.
- **Size accuracy:** classified **M** (3 files). Defensible — 3 files is the M floor; ~3 logic
  changes in one new component edge toward S. Roughly accurate, no side effects (self-contained).
- **Cost vs value:** ~25 min, 0 rounds, 0 tests — the cheapest sprint of the phase, and the one
  place cheap is mostly justified. The instructive contrast is 13.5 vs 13.6: an XL core-write-path
  sprint and an M leaf-settings-panel both ran under "compressed/hyper-compressed" with 1 and 0
  Adversary rounds. The mode was picked by surface area ("GUI → hyper-compressed"), not blast
  radius — which is why 13.5 (high radius) was under-reviewed and 13.6 (low radius) was reviewed
  about right, by luck rather than calibration.

## Sprint 13.7 — E2E suite + DEFERRED closure

**Reviewed:** 2026-05-15. Commit `0360eff`. 18 files (1407 insertions): 6 new e2e test files
(`phase13-{leases,reviews,taxonomy,mcp,cross-feature,auth-scope}.test.ts`), test infra
(`runner.ts`, `cleanup.ts`, `authHelpers.ts`, `constants.ts`, `auth.test.ts`),
`docker-compose.auth-test.yml`, + production diffs to `lessons.ts` (source-status guard) and
`mcp/index.ts` (DEFERRED-007 flatten). 3 design Adversary rounds (full-mode, max cap). Master
design: F1/F2/F3 "complete when" + the DEFERRED list.

### Code review findings

**BUG-13.7-1 (HIGH) — the Sprint 13.7 source-status guard does NOT fully close BUG-13.3-2:
`update_lesson_status` still permits `pending-review → active` and `pending-review → draft`.**
`updateLessonStatus` (`lessons.ts:1512-1548`, the r3-F1 fix) adds two rules: (a) any
`→ pending-review` is rejected; (b) `pending-review → superseded|archived` is rejected. It does
**not** reject `pending-review → active` or `pending-review → draft` — the 13.7 spec's transition
table (L162-163) explicitly declares both ✓, reasoning "this is what approve_review_request /
return_review_request does internally." That reasoning is wrong: `approveReviewRequest` moves the
lesson to `active` **and** marks the `review_requests` row `approved`, atomically;
`update_lesson_status` moves *only* the lesson. So `update_lesson_status(lesson, 'active')` on a
`pending-review` lesson still publishes it while bypassing the human review and leaving the
`review_requests` row orphaned `pending` forever (`resolveRequest`'s `WHERE status='pending-review'`
never matches again; the partial unique index then blocks re-submission) — exactly BUG-13.3-2's
harm. The master design L277-278 marks `pending-review→active/draft` ✓ but qualifies "human
approves / returns *via REST [approve/return]*", not via `update_lesson_status`; the 13.7
transition table dropped that qualifier. r3 (the max-cap round) correctly found the production code
had *no* source-status guard — but no round then reviewed whether the guard the team designed was
*correct*; the patch shipped un-re-reviewed. Consequence: **BUG-13.4-1's "wrong Approve button"**
(the `LessonDetail` footer calling `changeStatus('active')` on a pending-review lesson) **still
corrupts state post-13.7** — the 13.4-review note that it "errors out once 13.7's guard lands" was
wrong; the guard permits `→active`.

**BUG-13.7-2 (MED) — Part A's "E2E test suite" is substantially SKIPs and shape-checks; the F1/F2
lifecycles it was chartered to cover are not exercised end-to-end.**
The marquee deliverable of the final sprint — full-mode AMAW, 3 rounds — ships hollow on F1/F2:
- `phase13-reviews.test.ts`: the only F2-lifecycle test, `review-submit-happy-path`, is an
  **unconditional SKIP**. F2 submit→approve→return→re-submit has **zero** transport-level coverage
  — only the Sprint 13.3 service-layer unit tests (the exact "tests bypass the HTTP/MCP transport"
  gap that DEFERRED-007 was born from). The SKIP reason ("submit_for_review is MCP-only; covered
  by … phase13-mcp.test.ts") is doubly wrong: `phase13-mcp.test.ts` does **not** test
  `submit_for_review`, and the MCP-call harness the test would need (`callMcpTool`) *exists in
  that very file*.
- `phase13-reviews.test.ts` is **missing the promised ✗-transition test (b)** —
  `pending-review→superseded`. The file's own header comment (L4-7) claims it covers (a)(b)(c);
  only (a) and (c) exist. So even rule (b) of the 13.7 guard has no regression test.
- `phase13-leases.test.ts`: the sweep test is an **unconditional SKIP** after ~45 lines of dead
  setup — F1-AC7 (sweep DELETE) is not e2e-tested. `lease-release-by-owner` is **mislabeled** — it
  calls force-release; the owner-release / `not_owner` path is not e2e-tested.
- `phase13-cross-feature.test.ts`: 3 of its 4 tests are bare `GET → expect 200` shape checks. The
  master design's headline "Inter-feature integration" (`submit_for_review` implicitly releasing
  the artifact lease) is **not tested** — `cross-f1-f2-leases-orthogonal-to-reviews` just does two
  GETs.
- `phase13-mcp.test.ts` omits 2 of the 4 DEFERRED-007-affected tools (`submit_for_review`,
  `renew_artifact`).
"94/94 PASS" is therefore a weak assurance: a large share of the +30 e2e tests are
SKIP / shape-only / trivial, and the feature most central to Phase 13 — the F2 review lifecycle —
is the least covered. Not a runtime bug (a coverage / false-confidence defect) — hence MED.

**BUG-13.7-3 (LOW) — `phase13-mcp.test.ts:mcp-claim-artifact-no-zod-error` leaks its lease.**
The test claims a lease via `claim_artifact` and never registers it for cleanup — `:92-94` are
*comments* describing the intent ("Push to leaseIds"), with no `cleanup.leaseIds.push(...)` coded;
the test doesn't even destructure `cleanup` from ctx. Each run leaks one lease
(`mcp-claim-${runMarker}`). Mildly ironic in the sprint whose r1-F2 Adversary finding was
specifically about CleanupRegistry gaps and cross-test pollution.

### What was done well
The DEFERRED cleanups are the strong half of this sprint. **DEFERRED-007 is genuinely fixed** —
all 4 discriminatedUnion outputSchemas flattened to `z.object`; a grep confirms **zero**
`z.discriminatedUnion` remain in `mcp/index.ts` (only a comment). **DEFERRED-006 is genuinely
closed** — `phase13-auth-scope.test.ts`'s 6 cases (esp. AUTH-4: cross-tenant force-release → 403
from `requireScope`) are well-constructed and were exercised on the auth-enabled override (the
"2 SKIPs" count confirms the verification run used it). The test *infrastructure* — the product of
the r1/r2/r3 Adversary rounds — is solid: `CleanupRegistry` extended with `leaseIds` /
`taxonomyActivations` + runAll branches, `createTestApiKey(role, {project_scope})`,
`E2E_PROJECT_ID_B`, the `docker-compose.auth-test.yml` override (the `auth.test.ts` callsite was
correctly migrated to the new helper signature). `phase13-taxonomy.test.ts` (9 tests) is genuinely
thorough — it gives F3-AC5 (codex-guardrail → guardrails table → `GET /api/guardrails/rules`) the
real e2e test the 13.5 suite lacked. DEFERRED-004 is honestly marked PARTIAL with a per-route
policy; DEFERRED-003 is honestly left OPEN. Notes (un-numbered): the flattened `z.object`
outputSchemas lose the discriminated union's field-correlation enforcement (a handler returning
`{status:'claimed'}` with no `lease_id` would now pass schema validation) — an inherent cost of
the DEFERRED-007 workaround, already accepted in Sprint 13.5; `phase13-taxonomy.test.ts` tests are
order-coupled on the shared project's active-profile state (mostly defended by re-check/re-activate
guards); the `review-reject-*` tests assert leniently (`status===200 && body.status!=='error'`),
implying `update_lesson_status` may surface guard rejections as HTTP 200 + error body rather than
4xx — the recurring BUG-13.1-3 "error → non-4xx" theme, unverified here.

### AMAW evaluation
- **Adversary effectiveness:** 3 design rounds (full-mode, max cap) — and they were *productive on
  infrastructure*: r1 (CleanupRegistry gaps, sweep-test infeasibility, writer-vs-scope axis), r2
  (`createTestApiKey` lacks `project_scope`, no MCP regression guard, negative-transition ACs), r3
  (the production code has no source-status guard, `E2E_PROJECT_ID_B` missing). r3-F1 in
  particular caught a real BUG-13.3-2-class production hole. **Two structural misses, both about
  *what the rounds reviewed*:** (1) **all 3 rounds reviewed the test DESIGN (the spec); none
  reviewed the test CODE.** BUILD then shipped tests that deviate sharply from the reviewed plan —
  the SKIPped F2 happy-path, the missing ✗-transition (b), the mislabeled owner-release test, the
  shape-only cross-feature tests, the omitted `submit_for_review` MCP guard. A single code-review
  round would have caught "the plan said test X; the file SKIPs it." (2) **r3-F1 found the missing
  guard but no round verified the guard the team then wrote** — the transition table mis-derived
  `pending-review→active` as ✓ (BUG-13.7-1). The Adversary found the hole; the patch for the hole
  shipped un-reviewed.
- **Process integrity:** clarify+design+plan combined; build+verify combined; then straight to a
  combined `session+retro` event — **no `qc`, no `post-review`, no discrete `commit` event.**
  POST-REVIEW skipped for the **5th consecutive sprint (13.3–13.7)** — on the very sprint that
  carries the "final cumulative scope check." The "Scope Guard CLEAR / 24-of-24 ACs" verdict lives
  only in the commit message and the `session+retro` note — never a discrete auditable event. The
  3 `review-design` rounds, by contrast, *are* properly logged — the design-phase trail is the one
  solid stretch of the phase's audit log.
- **Size accuracy:** self-classified **XL** — correct (18 files, 1407 insertions). Second sprint
  running with an accurate classification.
- **Cost vs value:** the 3-round full-mode investment bought excellent *scaffolding* and one real
  production catch (r3-F1) — but the *tests* the scaffolding carries are thin, and the production
  fix r3 triggered is itself incomplete (BUG-13.7-1). Reviewing the test plan three times while
  never reviewing the resulting test code is the precise process gap that let a SKIP-heavy suite
  ship under a "94/94 PASS, full-mode AMAW" banner. The deferred-cleanup half of 13.7 (006/007
  closed and verified, 004/003 honestly marked) was executed well; the E2E-suite half was not.

---

## AMAW Quality Assessment (Phase C — filled after all sprints)

### Dimension 1 — Adversary effectiveness

**Per-sprint Adversary rounds vs. bugs that escaped to this review:**

| Sprint | Mode | Adversary rounds | Escaped bugs | Escaped severity |
|--------|------|------------------|--------------|------------------|
| 13.1 | full | 2 design + 2 code + 7-residual post-audit | 3 | 2 MED, 1 LOW |
| 13.2 | full | 3 design + 3 code + 3 post-audit cycles | 1 | 1 LOW |
| 13.3 | compressed | 1 design + 1 code | 4 | 1 HIGH, 1 MED, 2 LOW |
| 13.4 | hyper-compressed | 0 | 4 | 3 MED, 1 LOW |
| 13.5 | compressed | 1 design | 3 | 1 HIGH, 1 LOW, 1 COSMETIC |
| 13.6 | hyper-compressed | 0 | 1 | 1 LOW |
| 13.7 | hybrid | 3 design (0 code) | 3 | 1 HIGH, 1 MED, 1 LOW |

**When it runs, the Adversary finds real things.** Every design round that ran produced genuine
BLOCKs that were genuinely fixed: 13.1 r1 (cross-tenant force-release, silent renew no-op,
synthetic-incumbent race), 13.2's `requireScope` role→scope chain, 13.3 r1 (resolved_by-as-role,
missing UPDATE guard, UUID-in-title), 13.5 r1 (REST validation gap, cross-tenant taxonomy routes),
13.7 r1-r3 (CleanupRegistry gaps, `createTestApiKey`, the missing source-status guard). The
cold-start design review is the workflow's strongest component.

**Three systemic effectiveness gaps, in descending order of importance:**

1. **Fixes are not adversarially reviewed.** The Adversary reviews the design and the
   code-as-built; it does *not* review the *remediation* of its own findings. All 3 HIGH bugs
   trace here: BUG-13.3-2 (no round asked whether `pending-review` was protected as a transition
   *source*); BUG-13.5-1 (the r1-F1 fix "move validation to the service layer" *created* the
   Phase-8 regression — no round checked the new gate's accept-set); BUG-13.7-1 (r3-F1 found the
   missing guard; the guard the team then wrote is incomplete and shipped un-reviewed). Recurring
   shape: **Adversary finds symptom → team writes fix → fix ships unreviewed → fix is wrong or
   incomplete.** Compressed mode, which skips the r2/r3 rounds that would re-review, makes it
   structural.
2. **The cold-start, single-sprint Adversary is structurally blind to cross-sprint regressions.**
   The AMAW isolation rule ("read only these files, never chat history") buys fresh-eyes design
   review — but no agent ever holds the whole phase in view. Three bugs are only visible with
   multi-sprint context: BUG-13.4-2 (the `pending_review`/`pending-review` slug split — needs
   13.3's status + 13.4's GUI + the pre-existing sidebar together), BUG-13.5-1 (needs Phase 8
   knowledge the 13.5 Adversary was never handed), BUG-13.7-1 (needs 13.3's and 13.7's code side
   by side). A per-sprint Adversary cannot, by construction, catch a regression that spans sprints.
3. **Code-review coverage collapsed after 13.2.** Cold-start *code* review (vs. design review) ran
   only in 13.1 and 13.2. 13.3 skipped r2-code; 13.5 skipped code review entirely; 13.7's 3 rounds
   were all design (on the test plan). So 13.3-13.7 shipped with essentially no adversarial code
   review — and **15 of the 19 bugs are in those 5 sprints.** 13.4's 4 bugs are all contract-level
   defects one code round would very likely have caught (a `pending` grep; reading the route's
   HTTP codes).

**Verdict:** the Adversary mechanism has real positive value, but as deployed it was front-loaded
(13.1-13.2 absorbed 10 of ~16 in-loop rounds), it never reviews its own fixes, and it cannot see
across sprint boundaries. The closeout's "12 Adversary rounds" is technically true and practically
misleading — 6 were one sprint (13.2), 3 more were one sprint's test-plan design (13.7).

### Dimension 2 — Process integrity

The preliminary scan's worry about *duplicate / non-monotonic AUDIT_LOG events* is **13.1-only** —
confirmed: every 13.3-13.7 event is chronologically monotonic with no duplicates. That defect did
not recur. The real story is worse: **process integrity degraded monotonically across the longrun.**

| Sprint | Phases combined | POST-REVIEW event | Post-sprint audit | Gate verdict recorded as |
|--------|-----------------|-------------------|-------------------|--------------------------|
| 13.1 | none — "all 12 phases present" | ✅ present | ✅ 7-residual audit | discrete events |
| 13.2 | none | ✅ present | ✅ 3 audit cycles | discrete events |
| 13.3 | jumps review-code → build → retro | ❌ absent | ❌ none | commit-message prose |
| 13.4 | clarify+design+plan | ❌ absent | ❌ none | commit-message prose |
| 13.5 | clarify+design+plan; **qc+post-review+session+commit** as one `phase_complete_batch` | ❌ absent | ❌ none | batch-event `note` |
| 13.6 | clarify+design+plan; build+verify; **log stops at build+verify** | ❌ absent | ❌ none | nowhere |
| 13.7 | clarify+design+plan; build+verify; session+retro | ❌ absent | ❌ none | commit-message prose |

- **POST-REVIEW — "NEVER skippable" per CLAUDE.md — was skipped as a discrete gate for all 5
  back-half sprints (13.3-13.7).**
- **Phase-combining** — explicitly forbidden by CLAUDE.md's anti-skip rules ("each phase boundary
  triggers a different sub-agent — combining skips the agent") — happened in 4 of 5 back-half
  sprints. 13.5 introduced `phase_complete_batch`, an `action` type CLAUDE.md never defines, to
  paper over a 4-phase combine.
- **The post-sprint audit cycle** (mandatory per the longrun plan) ran for 13.1 and 13.2 only.
- **Gate verdicts left the trust anchor.** AUDIT_LOG.jsonl is billed as the "append-only trust
  anchor." For 13.3-13.7 the Scope Guard "CLEAR / N-of-N ACs" verdict appears only in
  commit-message prose or a batch-event's free-text `note` — never as a discrete `qc`/`post-review`
  event with a `status` field. The log is a faithful record for 13.1-13.2 and a thinning sketch
  thereafter; 13.6's stops at `build+verify` entirely.

**One mitigating point, stated fairly:** the skipping was *self-logged*. The AUDIT_LOG carries
explicit deviation notes ("longrun session time pressure", "compressed-mode deviation", "r2 code
review skipped"). The workflow did not *hide* the corner-cutting — it *documented* it, which is
meaningfully better than silent skipping. But it also means the "NEVER skippable" rules functioned
as advisory: a deviation was logged and the sprint proceeded; nothing *gated* on the deviation. A
logged skip is still a skip.

### Dimension 3 — Size classification accuracy

| Sprint | Classified | Actual (this review) | Accuracy |
|--------|-----------|----------------------|----------|
| 13.1 | L | XL | under 1 tier |
| 13.2 | M | L | under 1 tier |
| 13.3 | L | XL | under 1 tier |
| 13.4 | M | S–M | ≈ accurate |
| 13.5 | XL | XL | ✅ accurate |
| 13.6 | M | M (≈S) | ≈ accurate |
| 13.7 | XL | XL | ✅ accurate |

Size accuracy is the one dimension that **improved** over the longrun — the inverse of process
integrity. The first three sprints were each under-classified by exactly one tier; from 13.5 the
specs began writing `size_class:` explicitly in the frontmatter and the estimates landed.

**But size classification turned out to be nearly inert.** Under CLAUDE.md, size is meant to drive
allowed skips and review depth. In practice the AMAW *mode* (full / compressed / hyper-compressed)
was chosen by **feature area** — "backend core → compressed, GUI → hyper-compressed, test sprint →
full-on-the-plan" — not by size or blast radius. 13.5 was correctly classified XL and still got 1
round; 13.4's mild misclassification didn't matter because GUI sprints were going to be
hyper-compressed regardless. Size accuracy improved and it didn't help, because nothing downstream
consumed it.

### Dimension 4 — Cost vs value

**Review effort was inversely correlated with blast radius.**

| Sprint | Blast radius | Adversary rounds | Wall-clock | Bugs escaped |
|--------|--------------|------------------|------------|--------------|
| 13.2 | moderate — new middleware + endpoint + GUI panel | 6 + 3 post-audit | ~3h | 1 LOW |
| 13.5 | **high — modifies the core `addLesson` write path; parallel type system** | 1 | ~75m | **1 HIGH** + 2 |
| 13.4 | **high — wires a brand-new backend contract into the GUI** | 0 | ~45m | **3 MED** + 1 |
| 13.7 | high — final closeout + "cumulative scope check" | 3 (design-only) | ~4h | 1 HIGH + 2 |

The 13.2 review already flagged its own 6-round + 3-post-audit run as the phase's "worst
cost/catch ratio." Meanwhile 13.4 (a new contract into the GUI) and 13.5 (the core write path) —
the two sprints whose blast radius most warranted scrutiny — got 0 and 1 rounds. Both back-half
HIGH bugs (BUG-13.5-1, and BUG-13.3-2 which 13.7 only partially fixed) sit in the under-reviewed
sprints.

**The trade that wasn't made:** one ~30-45 min code-review round on 13.4 and on 13.5 would, on the
evidence, have caught most of those 7 back-half bugs — including BUG-13.5-1 (HIGH) and
BUG-13.4-2/-3 (MED). The longrun spent ~3h over-reviewing 13.2 and ~0 under-reviewing 13.4.

**AMAW's value is real but oversold by its own closing numbers.** It caught genuine, severe issues
in-loop (13.1's cross-tenant force-release, 13.2's `requireScope` chain, 13.5 r1's 3 BLOCKs, 13.7
r3's missing guard). Phase 13's features do function — the deploy-state smokes were real, and the
19 bugs are overwhelmingly contract / edge-case / coverage defects, not "the feature is broken."
But the closeout's headline metrics — "12 Adversary rounds", "94/94 PASS", "24/24 ACs CLEAR" —
overstate the assurance: the rounds were front-loaded, the e2e suite is hollow on F2, and the AC
verdicts were never recorded as auditable events. A reader of the AUDIT_LOG and the closeout commit
would reasonably believe Phase 13 was rigorously verified; this review found 19 bugs (3 HIGH) the
rigor did not.

### Bottom line

The AMAW workflow is not ineffective — its adversarial design rounds are its best feature and they
earned their keep on 13.1, 13.2, and 13.7's test infrastructure. Three things undercut it across
this longrun:

1. **It never reviews the fixes it triggers** — and all 3 HIGH bugs live there.
2. **Review budget was allocated by surface area, not risk** — the highest-blast-radius sprints
   (13.4, 13.5) got the least scrutiny.
3. **Under self-logged "time pressure", the non-negotiable gates became negotiable** — POST-REVIEW,
   the post-sprint audit, and one-phase-one-event were all dropped for 5 straight sprints.

The workflow's files-as-truth principle held: the spec / design / audit artifacts exist and are
mostly honest — the DEFERRED ledger in particular is tracked with real integrity (003 left OPEN,
004 marked PARTIAL with per-route reasoning, 005/006/007 resolved with root-cause detail). But the
*gates* those files were meant to enforce were not enforced. The result is a longrun that looks
more rigorously verified in its AUDIT_LOG and closeout than it actually was.

---

## Consolidated bug list (Phase D)

| ID | Sev | Sprint | Summary | Location |
|----|-----|--------|---------|----------|
| BUG-13.1-1 | MED | 13.1 | invalid `artifact_type` on claim → HTTP 500 not 400 | `routes/artifactLeases.ts:56-61` |
| BUG-13.1-2 | MED | 13.1 | `POST /check` any validation error → HTTP 500 not 400 | `routes/artifactLeases.ts:68-83` |
| BUG-13.1-3 | LOW | 13.1 | renew `not_owner`/`expired` → HTTP 200 (release uses 403) | `routes/artifactLeases.ts:85-113` |
| BUG-13.2-1 | LOW | 13.2 | advisory lock released immediately → no real multi-replica leader election; comment overstates | `services/sweepScheduler.ts:53-141` |
| BUG-13.3-1 | MED | 13.3 | F2 human-review gate advisory only — `approve` is writer+ & `resolved_by` is unverified free text; an agent can self-approve & forge the reviewer | `routes/reviewRequests.ts:48,52,68,72` |
| BUG-13.3-2 | HIGH | 13.3 | review gate bypassable — `update_lesson_status` leaves `pending-review`, orphans the `review_requests` row. **PARTIALLY fixed in 13.7**: `→superseded/archived` blocked; `→active`/`→draft` still open (see BUG-13.7-1) | `mcp/index.ts:1638` + `lessons.ts:1512` |
| BUG-13.3-3 | LOW | 13.3 | `GET /review-requests?limit=abc` → HTTP 500 (`NaN` → `LIMIT NaN`) | `routes/reviewRequests.ts:32-33` |
| BUG-13.3-4 | LOW | 13.3 | `submit_for_review` output `status='submitted'` collides with design's documented `status='pending'` | `services/reviewRequests.ts:24-28` |
| BUG-13.4-1 | MED | 13.4 | "View Full Lesson" shows empty content — stub `Lesson` with `content:""` fed to `LessonDetail` (no fetch); stub also exposes a wrong `update_lesson_status` "Approve" button | `review/page.tsx:731-746` + `reviewRequests.ts getReviewRequest` |
| BUG-13.4-2 | MED | 13.4 | slug mismatch `pending_review` (GUI) vs `pending-review` (API) → sidebar badge undercounts (GUI-AC6 NOT met) + "Pending Review" filter always empty | `review/page.tsx:23,284,403` + `sidebar.tsx:131` |
| BUG-13.4-3 | MED | 13.4 | GUI `resolved_by` = role+scope label from `/api/me`, not a reviewer identity — regresses the 13.3 design-r1-F1 fix | `review/page.tsx:194-199` |
| BUG-13.4-4 | LOW | 13.4 | approve/return `already_resolved`/`not_found` branches are dead code (`request()` throws on 409/404) → no friendly toast, no list refresh on concurrent resolve | `review/page.tsx:241-246,267-272` |
| BUG-13.5-1 | HIGH | 13.5 | `validateLessonType` (new mandatory `addLesson` gate) ignores the Phase 8 `lesson_types` table → `add_lesson`/`POST /api/lessons` HTTP 400s every Phase 8 custom lesson type | `taxonomyService.ts:292-309` + `lessons.ts:200` |
| BUG-13.5-2 | LOW | 13.5 | `kg/linker.ts` hardcodes `t==='guardrail'\|\|t==='codex-guardrail'` instead of `GUARDRAIL_LESSON_TYPES.includes(t)` — spec-A3 single-source-of-truth violated; future guardrail types mis-mapped | `kg/linker.ts:7` |
| BUG-13.5-3 | COSMETIC | 13.5 | `createTaxonomyProfile` accepts `lesson_types[].color` unvalidated — verified NOT XSS-exploitable (13.6 renders via React `style` object); chip renderer assumes `#rrggbb` hex | `taxonomyService.ts:144-164` |
| BUG-13.6-1 | LOW | 13.6 | switch-profile picker: when a profile is active, `selectedSlug` inits to `""` → `<select>` shows option 1 but Activate stays `disabled` until the user manually re-picks | `taxonomy-panel.tsx:43-47` |
| BUG-13.7-1 | HIGH | 13.7 | source-status guard only partially closes BUG-13.3-2 — `update_lesson_status` still allows `pending-review → active`/`draft`, bypassing review + orphaning the request | `lessons.ts:1512-1548` |
| BUG-13.7-2 | MED | 13.7 | Part A "E2E suite" hollow — F2 lifecycle SKIPped, sweep SKIPped, ✗-transition (b) missing, cross-feature tests shape-only; "94/94 PASS" overstates coverage | `test/e2e/api/phase13-*.test.ts` |
| BUG-13.7-3 | LOW | 13.7 | `phase13-mcp.test.ts` claim-artifact test leaks its lease (cleanup is commented-out, never coded) | `phase13-mcp.test.ts:79-95` |
