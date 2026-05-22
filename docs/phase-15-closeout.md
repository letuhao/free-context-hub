# Phase 15 Closeout — Multi-Actor Coordination Protocol

**Status:** ✅ COMPLETE — 2026-05-23
**Sprints:** 15.1 → 15.12 (12 sprints)
**Migrations:** 0050–0063
**Test baseline at close:** 723/723 green, `tsc --noEmit` clean
**Deferred backlog:** fully cleared (0 OPEN items across all phases)

---

## What Phase 15 is

Phase 13 gave agents *signaling* primitives (leases, review-request state) so parallel
work wouldn't silently collide. Phase 15 goes further: it makes **multiple actors
coordinate through durable, governed state** — a topic-scoped append-only event log plus a
set of decision primitives (requests, motions, disputes, intake) that humans and agents
drive together. Coordination remains human-driven; Phase 15 supplies the substrate, the
audit trail, and the authorization model that make multi-actor governance safe and
inspectable.

Everything is built on one invariant: **every state change is an append-only event** on a
topic, and identity/authority is derived from participation, not asserted by the caller.

---

## Sprint map

| Sprint | Deliverable | Notable |
|--------|-------------|---------|
| 15.1 | **Coordination substrate** — durable append-only event log + Topic/Actor/participant model | Verbatim Phase 13 txn/connection contract; every later sprint builds on this |
| 15.2 | **The Board** — `tasks`, derived-identity `artifacts` + versioning, `claims` (evolves Phase 13 leasing) + fencing tokens, abandoned-claim sweep | |
| 15.3 | **Request-Approval** — `requests` + `request_steps`, multi-level routing | + 15.3.1 security fix-up |
| 15.4 | **Collective Decision** — motions, votes, tally, veto (the voting half of governance) | |
| 15.5 | **Intake mailbox + dispute resolution** — the inbound-item + adjudication halves | |
| 15.6 | **Topic-closing 3-phase drain** + request-consistency residuals | `closing → drain → closed`; 4 writer paths reject `closing` |
| 15.7 | **Primitive-outcome chaining** (DEFERRED-019 + 011) | |
| 15.8 | **Collective wired into Request-Approval** (DEFERRED-018) — `procedure='collective'` | motion-chain suppressed when subject is a `request_step:` |
| 15.9 | Multi-tier routing prep | |
| 15.10 | **Multi-tier collective routing** (DEFERRED-022) — emits `escalated_to` | |
| 15.11 | **Authorization model** (DEFERRED-015/016/017) — 3 interlocking HARD pre-prod triggers; non-owner level-grant flow, owner-permanence | |
| 15.12 | **Tenant-scope authz + induction-pack tail** (DEFERRED-009/010) — `/api/topics/:id/*` route-param scope | closed the Phase 15 deferred backlog |

---

## Cross-phase deferred cleanup (this longrun, post-15.12)

After Sprint 15.12 closed the Phase-15-specific backlog, the same longrun cleared the
remaining **cross-phase** deferred items so the whole project backlog reached zero:

| Item | Phase origin | Resolution |
|------|--------------|------------|
| DEFERRED-008 | Phase 11 (exchange) | `lesson_types.scope` now round-trips through export/import |
| DEFERRED-004 | cross-phase (authz) | writer-route tenant-scope enforcement (`requireProjectScope` + `requireResourceScope` derive-on-id) across ~45 routes |
| DEFERRED-024 | cross-phase (authz) | `/api/jobs/run-next` scoped to caller's project (`claimNextQueuedJob` project filter) |
| DEFERRED-023 | Phase 11 (exchange) | `taxonomy_profiles` is now a bundle entity; owner rebound on import; built-ins can't be injected (owner-NULL export filter) |
| DEFERRED-003 | Phase 13 (leases) | `race_exhausted` retry-loop coverage via injectable `_claimWithRetry` seam |

DEFERRED-001 (per-project model routing) remains **ABANDONED** by decision — the Phase 14
global model swap made it unnecessary.

---

## Engineering posture that held across the phase

- **Files-as-truth workflow (v2.2 + AMAW opt-in):** spec / design / plan / `AUDIT_LOG.jsonl`
  are durable; chat is ephemeral. Every sprint went through the 12-phase gate.
- **REVIEW-DESIGN repeatedly caught real BLOCKs before BUILD** — e.g. body-project omission
  → `DEFAULT_PROJECT_ID` scope-escape (15.12 F1); a declared `project_id` being bypassable by
  a cross-tenant resource id → must DERIVE the project from the id (DEFERRED-004 F1); explicit
  column lists silently dropping new columns (DEFERRED-008).
- **Tenant isolation as a first-class concern:** cross-tenant + unknown both → 404 (no
  existence oracle); scoped-key semantics (undefined/null → unrestricted dev posture, string →
  must match the resource's project). Auth-off keeps the dev baseline green.
- **Derived identity / authority, never caller-asserted** — the throughline from 15.1's
  participant model to 15.11's authorization triggers.

---

## Verification at close

```
npx tsc --noEmit      # clean
npm test              # tests 723 / pass 723 / fail 0
DEFERRED.md           # 0 OPEN (23 RESOLVED, 1 ABANDONED)
```

---

## Documentation follow-ups (not blocking)

- **WHITEPAPER.md** is still at draft v0.5 — it documents through Phase 12 and lists Phase 13
  as "in progress"; it has no Phase 14/15 sections. Updating it to v0.6 (Phases 13–15
  complete) is a separate documentation task, tracked here so it isn't lost.
