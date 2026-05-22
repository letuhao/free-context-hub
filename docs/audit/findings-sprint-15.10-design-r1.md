# Sprint 15.10 — REVIEW-DESIGN round 1

**Date:** 2026-05-21
**Subject:** `docs/specs/2026-05-21-phase-15-sprint-15.10-design.md` rev 1 (hash `abe07f998465496aa8e828c9ec618fa426cb8f70`)
**Method:** "If you wanted to break this in production, where would you look?"

---

## F1 (BLOCK) — Lapsed re-resolve picks up live matrix changes; violates "snapshot the rules" discipline

**Where:** §2.4 lapsed branch — applyMotionToStep re-calls `resolveMatrixRow` at
escalation time to fetch the next level's body_id.

**The problem:** master design B.7 says *"The route's rules are snapshotted at
submission; the officeholder is resolved at decision time."* Sprint 15.3
snapshotted `target_office` + `doa_snapshot` at submission. Sprint 15.8
snapshotted per-step `body_id`. The 15.10 lapsed re-resolve breaks this for
the escalated level's body:

- t0: matrix says authority body = `Body-A`. Submit collective request. Steps
  populated.
- t1: admin reassigns authority body to `Body-B` (legitimate reconfig).
- t2: coordination motion lapses. Lapsed re-resolve fetches `Body-B` (not the
  `Body-A` that existed at submission). Step escalates under `Body-B`.

The submitter's expectation was the matrix at submission time. The lapsed
escalation should preserve THAT contract.

The design notes the tension (§5.1) and accepts it for escalation specifically.
This rationale is defensible but contradicts the snapshot-the-rules principle
explicitly. Either:

- (a) Persist the full body_by_level map at submission (new column
  `requests.body_by_level JSONB`), and applyMotionToStep reads from the
  persisted snapshot. Honors B.7 exactly.
- (b) Document the deliberate exception, but the design must be EXPLICIT that
  "for escalation, the matrix at decision time wins" — a real design choice,
  not a side-effect.

**Recommended fix:** (a) — persist `requests.body_by_level JSONB` at submission.
Negligible cost (few hundred bytes per request); honors B.7. applyMotionToStep
parses the JSON and looks up the level. No matrix re-resolve.

**Severity:** BLOCK — without persistence, the design violates a documented
master-design invariant. The behavioral difference is observable (admin reconfig
changes in-flight request behavior).

---

## F2 (WARN) — Event payload inconsistency: `degraded_to` (15.8) vs `escalated_to` (15.10)

**Where:** §3 — request.step_escalated payload extensions.

**The problem:** Sprint 15.8 emits `{degraded_to: 'unilateral'}` on lapsed-degrade.
Sprint 15.10's re-propose path emits `{escalated_to: 'collective', body_id}`. Same
event type, two different keys (`degraded_to` vs `escalated_to`) for the same
semantic ("what does the escalation become at the new level?").

Replay consumers must handle both keys; field-name inconsistency is confusing.

**Recommended fix:** unify on `escalated_to: 'collective' | 'unilateral'` in
15.10. Use this for BOTH paths (re-propose and degrade). 15.8 events already in
DB retain `degraded_to` — historical record. Consumers parse
`payload.escalated_to ?? (payload.degraded_to ? `unilateral` : null)`.

**Severity:** WARN — minor; both fields are documented in their respective design
docs.

---

## F3 (WARN) — Distinct-body ≠ distinct-actor across body memberships

**Where:** §2.2 distinct-body check + AC9.

**The problem:** Counter_sign+collective with TWO distinct bodies (A=[alice,bob],
B=[bob,charlie]) still allows actor `bob` to vote in both motions. The
"distinct endorser" guarantee from DEFERRED-013 (unilateral counter_sign:
distinct actor per step) does NOT carry over cleanly to collective routes —
the analogous property is "distinct body", which 15.10 enforces, but per-actor
cross-body voting is unrestricted.

**Severity:** WARN — semantic gap; not a bug per se. The "endorser" in
collective routes IS the body (the body's decision is an aggregate); a single
actor casting one vote in body A and one vote in body B contributes to TWO
SEPARATE BODY DECISIONS. This is the design.

But the spec needs to be EXPLICIT that "distinct body" is the strongest
guarantee 15.10 provides, and per-actor cross-body restriction is OUT OF SCOPE
(interlocks with DEFERRED-015 participant level authority model).

**Recommended fix:** document in CLARIFY AC9 + DESIGN §2.2. No code change.

**Severity:** WARN — accept-with-doc.

---

## Summary

| F# | Severity | Where | Action |
|----|----------|-------|--------|
| F1 | BLOCK | §2.4 lapsed re-resolve breaks snapshot discipline | FIX in rev 2: persist `requests.body_by_level JSONB` at submission |
| F2 | WARN | §3 payload `degraded_to` vs `escalated_to` | FIX in rev 2: unify on `escalated_to` for both paths |
| F3 | WARN | AC9 + §2.2 distinct-body ≠ distinct-actor | ACCEPT-with-doc; explicit scope note |

**Verdict:** REJECTED — 1 BLOCK. Revise DESIGN to rev 2 + update CLARIFY AC9.
