# Phase 15 — Longrun Plan (sprints 15.2 → 15.7)

**Date:** 2026-05-16 · **Mode:** AMAW autonomous longrun (user-authorized 2026-05-16)
**Design:** `docs/phase-15-design.md` (rev 4) · **Predecessor:** Sprint 15.1 ✅ (PR #13)

## Execution contract

- Each sprint runs the **full AMAW 12-phase cycle** (CLARIFY→…→RETRO), tracked by
  `scripts/workflow-gate.sh` + `docs/audit/AUDIT_LOG.jsonl`, with cold-start sub-agents
  (Adversary at REVIEW-DESIGN / REVIEW-CODE, Scope Guard at POST-REVIEW).
- **Autonomous within a sprint** — no per-phase human gate. The main session drives all 12
  phases; mechanical fixes (Adversary findings with a clear, non-design-altering fix) are
  applied without asking.
- **Check in with the user ONLY at:** (a) each sprint boundary — a sprint-completion report;
  (b) a genuine BLOCK that needs a *scope / design decision* (not a mechanical fix); (c) the
  3-failed-fix-attempts architecture stop.
- **Commit policy (pre-authorized):** each sprint → its own branch `phase-15-sprint-15.N`,
  committed + pushed + a PR to `main` (the Sprint 15.1 pattern the user chose).
- `check_guardrails` before push — noted: the contexthub MCP client is not connected this
  session; prior calls this session returned 0 configured rules.

## Sprint sequence

| Sprint | Deliverable | AMAW mode | Est size |
|--------|-------------|-----------|----------|
| 15.2 | **Board** — `tasks`, `artifacts` + versioning/states, `claims` + fencing, abandoned-claim sweep | FULL (schema + concurrency) | XL |
| 15.3 | **Request-Approval** — `requests` + `request_steps` multi-level routing; step deadline + escalation sweep | FULL (routing/escalation, cross-cutting) | L–XL |
| 15.4 | **Collective decision** — `decision_bodies`, `motions`, `votes`, quorum/threshold/proxy, veto | FULL (voting correctness + tally concurrency) | L–XL |
| 15.5 | **Intake + dispute** — intake mailbox, dispute resolution | FULL-light (routing patterns over existing primitives — expect fewer Adversary rounds) | M–L |
| 15.6 | **GUI** — Topic view, Board, live event stream (SSE), approval & voting UI | COMPRESSED (GUI, no DB/concurrency — Phase 13 13.4/13.6 precedent) | L |
| 15.7 | **E2E** — the multi-agent coordination test, re-run properly | FULL on the test plan (Phase 13 13.7 precedent) | L–XL |

## Round caps & abort thresholds

- **Design review:** 3-round cold-start Adversary cap (AMAW calibration). After round 3 the
  main session self-reviews the final revision and proceeds; an unresolved BLOCK that is a
  genuine *decision* → escalate to the user.
- **Code review:** 1–3 rounds; `APPROVED_WITH_WARNINGS` proceeds (WARNs fixed or deferred with
  a DEFERRED entry).
- **Debugging:** 3+ failed fix attempts on one bug → STOP, question the architecture, ask the
  user (CLAUDE.md Debugging Protocol hard stop).
- A sprint that reclassifies materially larger, or hits a genuine design fork → pause, report,
  ask.

## Session boundaries (context budget)

A session realistically runs ~2–3 sprints before context pressure. At a session boundary the
main session writes a "LONGRUN SESSION-N BOUNDARY" handoff to `SESSION_PATCH.md`. Resume
protocol for the next session:
1. Read this longrun plan + the latest `SESSION_PATCH.md` boundary section.
2. Read `docs/audit/AUDIT_LOG.jsonl` (tail) + `.workflow-state.json` — pick up the next
   pending sprint.
3. `docs/phase-15-design.md` is the spec; per-sprint specs/plans/findings live under
   `docs/specs/`, `docs/plans/`, `docs/audit/`.

Everything is files-as-truth — the handoff is lossless.

## State

- **15.1** ✅ COMPLETE — PR #13; commits `e6e57d2` + `ee1394f`; branch `phase-15-sprint-15.1`.
- **15.2** ⏳ IN PROGRESS — CLARIFY done; DESIGN next. This longrun begins here.
- **15.3–15.7** — pending.
