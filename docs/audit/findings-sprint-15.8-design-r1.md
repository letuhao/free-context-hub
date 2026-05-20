# Sprint 15.8 — REVIEW-DESIGN round 1 (self-review, adversarial framing)

**Date:** 2026-05-20
**Subject:** `docs/specs/2026-05-20-phase-15-sprint-15.8-design.md` rev 1 (hash `b68018dc40c17728067e4da5b6cf0feea2c65adb`)
**Method:** "If you wanted to break this, where would you look?" — find exactly 3 problems.

---

## F1 (BLOCK) — `applyMotionToStep` lapsed branch is under-specified for matrix re-resolution at the escalated level

**Where:** §2.8 lapsed-case bullet.

**The problem:** my draft says "re-targeting a step preserves the matrix row's procedure
setting at the new level. If the matrix has no row at the higher level for this kind/
weight, treat as escalation_exhausted."

But a SINGLE matrix row covers ONE (kind, weight) range — it doesn't span levels. The
existing 15.3 escalation sweep bumps `target_office` UP a level WITHOUT re-resolving
the matrix (because for unilateral the matrix only dictates LEVEL, not body — the new
level's officeholder just decides).

For collective lapsed escalation, the new level might have a DIFFERENT matrix row
(different procedure / different body_id). My draft has no clear contract for which
of these holds at the escalated level:

- (a) **Re-resolve matrix at the new level**: requires calling `resolveMatrixRow` again
  with the same `kind`/`weight` and looking for a matching `required_level >= newLevel`.
  Adds complexity (the existing escalation sweep doesn't do this); risks the matrix
  having no row at the higher level (treat as exhausted).
- (b) **Degrade to unilateral on escalation**: the new level uses unilateral decision
  regardless of its matrix row. Simple; defensible — "if the body couldn't decide,
  fall back to a single officeholder at the higher tier."
- (c) **Stay collective with the SAME body**: semantically wrong (a coordination body
  deciding an authority-level step).

**Recommended fix:** option (b) — degrade to unilateral on escalation. After lapse-
escalation, the step's procedure flips to `'unilateral'`, body_id stays NULL on the
new step (or NULL'd). A unilateral officeholder at the higher tier decides via
`decideStep`. Documented as: "lapsed-escalation degrades to unilateral — design choice
for 15.8 simplicity. Multi-tier collective escalation is DEFERRED."

**Severity:** BLOCK — the user chose Q2 option (a) "escalate up one level". The design
must specify HOW the step's procedure transitions at the new level. Without a concrete
rule, the implementation is unspecified.

---

## F2 (BLOCK) — AC8 contradicts §2.2: distinct-body for counter_sign collective vs blanket-reject multi-step counter_sign collective

**Where:** CLARIFY AC8 vs DESIGN §2.2.

**The problem:** CLARIFY AC8 says: "no two collective steps on the same request may
use the same `body_id` (otherwise the 'distinct endorser' guarantee collapses to a
single body). Enforced at submitRequest (matrix row distinct-body check)..."

DESIGN §2.2 hard-rejects ALL multi-step counter_sign + collective routes with `BAD_
REQUEST`: "counter_sign collective routes are not supported in 15.8 (would collapse
distinct-endorser)".

Both can't be true. AC8 implies multi-step counter_sign + collective is allowed IF
the bodies are distinct. §2.2 doesn't even check bodies — it rejects on route_shape
+ procedure pair alone.

**Recommended fix:** reconcile by picking one direction:
- **Drop AC8** (acknowledge the limitation): §2.2 stands. 15.8 supports collective
  ONLY on (a) `escalate_to_authority` single-step routes, (b) single-step
  `counter_sign` routes. Multi-tier collective is deferred to a future sprint that
  introduces per-level body assignment in the DoA matrix.
- (alt) Widen §2.2: require the submitter to supply a `collective_bodies: {step_index
  → body_id}` map at submission. Bigger contract change.

**Recommended for 15.8:** drop AC8; update CLARIFY to acknowledge the single-step-
collective-only restriction. The smaller scope still resolves DEFERRED-018 in
principle — multi-tier collective is its own M-sized sprint with per-level matrix.

**Severity:** BLOCK — the spec contradicts itself; the implementation can't honor both.

---

## F3 (WARN) — §2.2 single-step-collective restriction significantly limits sprint value

**Where:** §2.2 — "15.8 supports collective steps but only on single-step counter_sign
routes or escalate_to_authority routes".

**The problem:** the master design B.6 vision is *"every level on the path must endorse
[...] A step's decision procedure may itself be unilateral or collective"*. A
realistic governance use-case is "coordination committee endorses, then authority
board endorses" — TWO collective steps with two DISTINCT bodies. Sprint 15.8 won't
support this; the DoA matrix only has one `body_id` per row, and a matrix row covers
ONE level.

Supporting multi-tier collective requires either:
- DoA matrix per-level body table (`doa_matrix_levels` with `(matrix_id, level,
  body_id)` rows)
- OR a per-request body map in submitRequest (`collective_bodies` blob)

Both are substantial design surface — likely a separate M-sized sprint.

**Recommended fix:** ACCEPT-with-doc. Document the limitation in CLARIFY explicitly:
"15.8 ships single-step collective. Multi-tier collective is deferred to a future
sprint (DEFERRED-022) that introduces per-level body assignment in the DoA matrix
or a per-submission body map."

**Severity:** WARN — the work is still valuable; collective single-step is the most
common pattern (a single committee deciding). But mark the scope honestly.

---

## Summary

| F# | Severity | Where | Action |
|----|----------|-------|--------|
| F1 | BLOCK | §2.8 lapsed → unilateral degrade vs re-resolve matrix | FIX in rev 2: degrade to unilateral on escalation |
| F2 | BLOCK | AC8 vs §2.2 contradiction | FIX in rev 2: drop AC8; update CLARIFY |
| F3 | WARN | §2.2 single-step restriction | ACCEPT-with-doc; record as future deferred sprint |

**Verdict:** REJECTED — 2 BLOCKs. Revise DESIGN to rev 2.
