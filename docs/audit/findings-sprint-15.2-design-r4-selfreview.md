---
agent: main+self-review
phase: review-design
sprint: phase-15-sprint-15.2-board
round: 4-final
reviewed: docs/specs/2026-05-16-phase-15-sprint-15.2-design.md
spec_hash: f1898f1af5ede266
status: APPROVED
basis: >-
  The 3-round cold-start design-review cap is reached (docs/plans/2026-05-16-phase-15-longrun-plan.md;
  AMAW calibration; Phase 13/14/15.1 precedent). Rev 4 resolves round-3's 3 findings and adds
  no new mechanism, so REVIEW-DESIGN closes with a main-session self-review of rev 4. The
  implemented code is checked fresh by the REVIEW-CODE cold-start Adversary.
---

## Round-3 resolution — verified

**r3-F1 (lock-order proof asserted not derived; `appendEvent`'s `topics` lock hidden) —
RESOLVED.** Rev 4 §0.2 names that `appendEvent` does `UPDATE topics SET next_seq…` (a
`topics`-row lock); §10 is a new **derived** table — for each of the 7 transactions
(`postTask`, `claimTask`, `releaseTask`, `completeTask`, `writeArtifact`, `baselineArtifact`,
the sweep) it lists the contended row-lock acquisition sequence (incl. each `appendEvent`'s
`topics` lock) and shows it is a prefix-consistent subsequence of the corrected canonical
order **`task → claim → artifact → topics`**. Verified by independent re-derivation: no two
transactions acquire a shared lock pair in opposed order — no ABBA cycle.

**r3-F2 (`completeTask`'s claim SELECT non-locking) — RESOLVED.** §2.5's claim SELECT now
carries `FOR UPDATE` — the claim row is write-locked at first touch, before the `UPDATE
artifacts`, so `completeTask`'s order is `task → claim → artifact → topics` (canonical) and
§9 invariant 8 is genuinely lock-enforced.

**r3-F3 (the `postTask` fix rests on an unnamed invariant) — RESOLVED.** §0.3 names the
"topics are permanent" invariant; the 0054 migration carries an FK comment stating the
`tasks`/`artifacts`/`claims` → `topics` FKs declare no `ON DELETE` by design; §2.1 references
it; §9 invariant 11 records it.

## New-issue scan — does rev 4 introduce a new BLOCK? (the fix-interaction check)

Rev 4 contains **no new mechanism**: (a) the canonical lock order is *corrected*
(`artifact`↔`claim` swapped to match a `FOR UPDATE`'d `completeTask`) and *derived* in a
table — not a behaviour change; (b) `completeTask` gains one keyword (`FOR UPDATE`); (c) the
sweep's step (2)/(3) are ordered claim-then-artifact; (d) §0.3 + invariant 11 are
documentation. Checks performed:
- Re-derived all 7 transactions' lock orders against the corrected canonical
  `task → claim → artifact → topics` — every one is a prefix-consistent subsequence
  (the §10 table); the two non-`task`-starting transactions (`writeArtifact`/`baselineArtifact`)
  lock only `artifact → topics` and cannot be a cycle's back-edge; `postTask` has one
  contended lock (`topics`). No ABBA.
- The sweep's reordered locks (claim at step 2, artifact at step 3) still hold every lock the
  open-branch recovery needs (`DELETE claims` / `UPDATE tasks` / `revertArtifact` /
  `appendEvent` all on already-locked rows) — verified.
- `completeTask` with the `FOR UPDATE` claim SELECT: locks task → claim → artifact → topics;
  the `DELETE claims` later re-touches the already-locked claim row — verified consistent.

No new BLOCK. One pre-existing item stands (not introduced by rev 4): `topology`/`depends_on`
ship as columns but active topology-ordering enforcement is out of scope (CLARIFY) — a
DEFERRED candidate, to be logged at SESSION if still open.

## Verdict

REVIEW-DESIGN closes **APPROVED** at the 3-round cap. 9 findings across rounds 1–3 (7 BLOCK,
2 WARN) all resolved; rev 4 introduces no new BLOCK. The design is BUILD-ready — proceed to PLAN.
