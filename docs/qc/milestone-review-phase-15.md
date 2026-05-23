# Milestone Review Plan — Phases 9–15 (post Phase 15 closeout)

**Status:** DRAFT for approval — no tests written yet
**Created:** 2026-05-23
**Trigger:** Phase 15 complete, entire deferred backlog cleared, PR #17 merged to `main`
**Baseline at start:** 723/723 unit/service tests green, `tsc` clean, `DEFERRED.md` 0 OPEN

---

## 1. Why now / what this is

Phases 1–8D have a comprehensive E2E safety net (`docs/qc/e2e-test-plan.md`, 191 tests, last
run 2026-05-15). **Phases 9–15 do not.** The 723 tests that pass today are almost entirely
**unit/service-level** (they call services directly via `getDbPool()`); they do *not* exercise
the full stack (HTTP → service → DB) or the **MCP transport** for the newer tools.

This matters because past incidents prove service-green ≠ system-green:
- **DEFERRED-007** — MCP tools with discriminated-union `outputSchema` crashed at the transport
  layer while their service tests passed and `tools/list` looked fine. Invisible until a real
  `tools/call` was issued.
- **DEFERRED-004 F1** — a declared `project_id` was bypassable by a cross-tenant resource id;
  only caught by reasoning about the route layer, not the service.

**Scope decision (approved 2026-05-23): full 15 phases — but split by *activity type*, not by
phase range.** Re-writing E2E for Phases 1–8D (already covered by 191 tests) would be wasted
effort; but *re-running* that suite is essential, because later phases provably mutated old
surfaces (see §1a). So:

| Activity | Phase scope | Why |
|---|---|---|
| **Regression run** (WS0) | **All 15** | Existing 191-test suite last ran 2026-05-15 — before Phase 13.x/14/15 touched old code |
| **New E2E writing** (WS2) | **Phase 9+** | 1–8D already have E2E; the gap is 9–15 |
| **Drift audit** (WS1) | **All 15** | Every phase's goals vs current behavior |
| **Seam bug-hunt** (WS3) | **All 15** (focus on new×old joins) | Cross-phase joins are where unit tests are blind |

Four work-streams:

| Work-stream | Question it answers | Output |
|---|---|---|
| **WS0 — Regression run** | Does the existing 191-test E2E suite still pass on current `main`? | Run report + triaged failures |
| **WS1 — Drift audit** | Does the implementation still match WHITEPAPER goals/non-goals? | Findings list (drift items) |
| **WS2 — E2E coverage** | Do Phases 9–15 work end-to-end through REST *and* MCP against a live stack? | New E2E tests + report |
| **WS3 — Seam bug-hunt** | Do cross-phase integration seams hide bugs unit tests can't see? | Findings list (bugs) |

### 1a. Proof that old phases already drifted (this session)
- **Phase 8 `lesson_types`** was unified with **Phase 13 `taxonomy_profiles`** — old schema reshaped.
- **Phase 14** swapped the embedding model globally and re-embedded all projects — changes the
  retrieval behavior of Phases 1–6/10.
- **DEFERRED-004** added tenant-scope middleware to 8 *old* route files: `chat`, `chatHistory`,
  `documents`, `git`, `jobs`, `learningPaths`, `projectGroups`, `workspace`.
- The 191-test E2E suite has **not run since 2026-05-15** (before any of the above) → its current
  pass/fail state is unknown. WS0 establishes it.

---

## 2. Coverage gap analysis (what exists vs. what's missing)

| Surface | Has unit/service tests | Has full-stack E2E | Has MCP-transport E2E |
|---|---|---|---|
| Phases 1–8D (lessons, guardrails, search, docs, auth, types) | ✅ | ✅ (191-test plan) | ✅ (mcp-smoke 45) |
| Phase 9 (multi-project UX, cross-project guards) | ✅ | ⚠️ partial | n/a |
| Phase 10 (multi-format ingest, chunk search, vision jobs) | ✅ | ❌ | ⚠️ chunk-search tool only |
| Phase 11 (bundle export/import, cross-instance pull) | ✅ (61 api e2e + 39 unit) | ✅ for v1 surface | n/a |
| Phase 12 (rerank pipeline slot) | ✅ (benchmarks) | ❌ | n/a |
| Phase 13 (artifact leasing, pending-review, taxonomy) | ✅ | ❌ | ⚠️ claim tools only |
| Phase 15 (topics, board, requests, motions, disputes, intake, authz, tenant-scope) | ✅ (route+service tests) | ❌ **none** | ❌ **none** |

**Biggest gap:** the entire Phase 15 coordination protocol — `topics`, `board`, `requests`,
`motions`, `disputes`, `intake`, the authorization model, and end-to-end tenant-scope — has
**zero full-stack and zero MCP-transport E2E coverage.**

---

## 2b. WS0 — Regression run of the existing suite (do this FIRST)

Cheapest, highest-value single action. The 191-test E2E suite (`test/e2e/`) exists and is
runnable; it just hasn't been run since Phase 13 started.

- [ ] Bring up the live stack: `docker compose up -d` (confirm embeddings endpoint reachable).
- [ ] Run `npm run test:e2e` (smoke → api → gui → agent) against current `main`.
- [ ] Capture a timestamped report in `docs/qc/` (same format as existing reports).
- [ ] **Triage every failure** — this is the critical part, because some failures are *expected
  design changes*, not bugs:
  - **Stale-test failure** (we intentionally changed behavior — e.g. model-swap reranked search
    results, tenant-scope now returns 404/400 where a test expected 200) → update the test.
  - **Real regression** (old behavior broke unintentionally) → file a finding, fix product code,
    re-run.
  - **Infra** (model/vision unavailable) → `skip`.

WS0 output directly narrows WS1 and WS3 — a failing old test often *is* a drift finding.

## 3. WS1 — Feature-drift audit (read-only; cheapest signal)

Compare current behavior against the WHITEPAPER's stated goals/non-goals. Produce a findings
list; do not fix in this pass (queue fixes as their own tasks).

### 3a. Primary-goal integrity
- [ ] **Persistent cross-session memory** still the spine — has the coordination layer (Phase 15)
  added state that *should* be a lesson but isn't searchable via `search_lessons`?
- [ ] **Guardrails derived from lessons** — does `check_guardrails` still gate the documented
  risky actions, and are the new authz triggers (15.11) consistent with the guardrail model?
- [ ] **Self-hostable, one-node, minimal** — did Phases 13–15 add hard dependencies (queue,
  Redis, Neo4j) that break the "all core features work without them" promise?

### 3b. Phase 13/15 non-goals (the drift-prone ones)
- [ ] **"Not a task orchestrator"** — does `board` (`tasks`) schedule/assign/sequence work, or
  only signal? Confirm it stayed a visibility primitive.
- [ ] **"Not a messaging bus"** — do actors signal *to each other* anywhere, or strictly through
  shared state + the human? Check requests/motions/disputes notification paths.
- [ ] **"Coordination remains human-driven"** — can a chain (15.7 primitive-outcome chaining)
  auto-advance a governance decision with no human gate where the whitepaper implies one?
- [ ] **"No background conversation parser / passive monitoring"** — confirm nothing added a
  passive ingest of agent chatter.

### 3c. MVP non-goals
- [ ] No automated cross-repo code modification without approval.
- [ ] No SAML/SSO creep in the authz model (15.11 should be API-key/role scoped, not enterprise IdP).

### 3d. Doc ↔ reality consistency
- [ ] MCP tool count: `e2e-test-plan.md` says 45, CLAUDE.md says 36, `src/mcp/index.ts` registers
  ~39 via `name:` + the coordination tools. Reconcile and pick one source of truth.
- [ ] REST endpoint count claims across CLAUDE.md / whitepaper / e2e-plan reconciled.

---

## 4. WS2 — E2E coverage extension (the build work)

Extend the existing two-layer model (`docs/qc/e2e-test-plan.md`) rather than inventing a new
shape. Same dirs: `e2e/smoke/`, `e2e/scenarios/{api,gui,agent}/`. Run against a live
`docker compose` stack. Use the project's **test workflow** (SETUP → WRITE → RUN → FIX → REPORT),
not the 12-phase feature workflow.

### 4a. Layer 1 — Smoke (every new surface once)
- [ ] **REST smoke** — one call per new endpoint in: `topics`, `board`, `requests`, `motions`,
  `disputes`, `intake`, `artifactLeases`, `me`, `taxonomy`, `reviewRequests`, plus Phase 10
  chunk/vision routes. Assert non-5xx + shape.
- [ ] **MCP smoke** — one `tools/call` per coordination tool (topic/board/request/motion/vote/
  dispute/intake/claim) through the **real MCP transport** — this is the DEFERRED-007 guard.
- [ ] **GUI smoke** — screenshot each Phase 9–15 page that exists (cross-project views, ActiveWork
  panel, any coordination surfaces).

### 4b. Layer 2 — Scenario (key flows, correctness)
Concrete coordination flows to cover end-to-end:
- [ ] **Leasing:** claim → conflict on 2nd claimant → TTL expiry → re-claim succeeds → background sweep removes abandoned.
- [ ] **Board:** post task → claim with fencing token → stale fencing token rejected → abandoned-claim sweep.
- [ ] **Request-Approval:** open request → multi-level routing → approve each level → final outcome; reject mid-chain → stops.
- [ ] **Collective Decision:** open motion → cast votes → tally crosses threshold → veto path → closed.
- [ ] **Intake + Dispute:** inbound item → triage → dispute raised → adjudication → resolution event.
- [ ] **Topic-closing drain:** open topic with in-flight claim+request → close → 3-phase drain force-lapses cleanly → writers reject `closing`.
- [ ] **Chaining (15.7):** approved request step chains into the next primitive; confirm a human gate exists where required.
- [ ] **Authorization (15.11):** non-owner cannot grant levels; owner grants; demoted-owner retains grant power; self-grant refused.
- [ ] **Tenant-scope (15.12 / DEFERRED-004/024):** project-scoped key blocked cross-tenant (404, no oracle); auth-off unrestricted; `jobs/run-next` pops only caller's project.

### 4c. Cross-phase regression flows
- [ ] **Exchange × tenant-scope × taxonomy:** export project A → import into B → owner rebound,
  `lesson_types.scope` preserved, built-in profiles not injected (DEFERRED-008/023/004 together).
- [ ] **Lesson lifecycle × pending-review:** draft → pending-review → human approve → active,
  visible in Review Request queue.

---

## 5. WS3 — Hidden-bug hunt at integration seams (read + targeted probes)

Seams where two independently-tested phases meet — unit tests rarely cover these:
- [ ] **MCP transport × every new tool's `outputSchema`** — re-confirm no discriminated-union or
  schema-shape that repeats DEFERRED-007 across the ~10 coordination tools.
- [ ] **Tenant-scope × exchange** — can a scoped key export/import across tenants? Pull endpoint
  (DNS-rebinding pinning) still honored under the new scope middleware?
- [ ] **Authz × MCP** — do the 15.11 triggers fire on the MCP path, or only REST?
- [ ] **`lesson_types` ↔ `taxonomy_profiles` unification** — type deletion/rename while a profile
  references it; import of a profile referencing an unknown type.
- [ ] **Job queue scope × worker** — worker (no scope) still drains all projects; scoped
  `run-next` skips null-project jobs (confirm no starvation).
- [ ] **closeTopic drain × concurrent writers** — race between drain and a late claim/vote.

---

## 6. Execution approach

- **Workflow:** the lighter **Test Workflow** (SETUP → WRITE → RUN → FIX → REPORT), one sprint per
  work-stream, per CLAUDE.md. WS1/WS3 are read-only audits → findings; WS2 writes tests.
- **Live stack:** `docker compose up -d`; embeddings via configured `EMBEDDINGS_BASE_URL`. Tests
  that need embeddings/vision degrade to `skip` if the model is unavailable (don't fail the suite).
- **Failure triage (per CLAUDE.md):** test bug → fix test; real bug → log finding, fix product
  code, re-run; infra issue → `skip`.
- **Findings handling:** WS1 + WS3 findings go to `docs/deferred/DEFERRED.md` (or direct-fix tasks
  if small). Real bugs get their own debugging-protocol task — not bundled into the test PR.
- **Reports:** timestamped reports in `docs/qc/` like the existing E2E reports; update
  `docs/qc/e2e-test-plan.md` counts when new tests land.

---

## 7. Deliverables & exit criteria

**Deliverables**
1. WS1 drift-audit findings (this doc → a findings section or DEFERRED entries)
2. WS2 new E2E tests (smoke + scenario for Phases 9–15) + a run report
3. WS3 seam bug-hunt findings
4. Updated `docs/qc/e2e-test-plan.md` (counts + Phase 9–15 sections)
5. A milestone-review summary (pass/fail per surface, open findings)

**Exit criteria**
- Every Phase 9–15 REST endpoint and coordination MCP tool hit at least once at Layer 1 (live stack).
- All Layer 2 coordination flows in §4b pass or have a tracked, justified `skip`.
- Drift audit complete with an explicit verdict per WHITEPAPER goal/non-goal.
- Seam hunt complete; each finding either fixed or filed in DEFERRED.md with severity.

---

## 8. Suggested sequencing & rough effort

| Order | Work-stream | Nature | Rough effort |
|---|---|---|---|
| 0 | WS0 regression run (all 15) | run + triage | ~half day — establishes current pass/fail; failures feed WS1/WS3 |
| 1 | WS1 drift audit (all 15) | read-only | ~half–1 day — fast, high signal |
| 2 | WS3 seam bug-hunt (all 15) | read + probes | ~half–1 day |
| 3 | WS2 Layer 1 smoke (9+) | write tests | ~1 day |
| 4 | WS2 Layer 2 scenarios (9+) | write tests | ~1–2 days |
| 5 | Reconcile docs + milestone summary | docs | ~half day |

Total ≈ 3.5–5.5 days if done fully. WS0 first is deliberate: it's nearly free and its failures
often *are* drift/bug findings, narrowing where WS1/WS3 dig.

---

## 9. Decisions
1. **Scope:** ✅ APPROVED 2026-05-23 — full 15 phases, all four work-streams (WS0–WS3), split by
   activity type per §1.
2. **GUI depth:** ✅ APPROVED 2026-05-23 — include Playwright GUI scenarios for the Phase 9–15
   coordination surfaces (board/requests/disputes/etc.), not REST+MCP only.
3. **Branch strategy:** ✅ APPROVED 2026-05-23 — single branch `milestone-review-phase-15` off
   `main`; all WS0–WS3 land there; one final PR.
