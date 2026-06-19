# Scenario Evaluation — DESIGN v5 + the conclusive non-convergence finding

**Date:** 2026-06-19 · **Branch:** `feature/actor-data-boundary`
**Input:** `-design-v5.md` · **Method:** 3 cold-start red-teams, ~46 scenarios, verified against real code.

## Conclusive finding: the paper loop is NOT converging — it is relocating

Five rounds now. The finding *count* did not drop (round 5: ~10 BREAKS again). Two patterns make it
conclusive that more paper iteration cannot finish this:

1. **The headline security mechanisms relocate one indirection per round, never closing.**
   - Sealing (C1/B5): v2 "convention" → v3 "DB trigger" → v4 "GUC magic-password" → v5 "approved
     re_consecrations row" — and round 5 shows it **moved again** ("reference any unrelated carried
     motion") plus a new `consumed_at` double-consume race. Four relocations, still open.
   - System-identity master key (B4): v4 found `system:*` could be a master key → v5 made them
     non-authenticable **except `system:bootstrap-admin`** → round 5: that exception *is* the
     reintroduced master key. Relocated, still open.
   - Self-kind escalation: v4 "session-actor trigger" → v5 "GUC-actor trigger" → round 5: the GUC is
     **NULL on non-engine writes → fail-open**. Relocated, still open.
   This is the textbook signature of a problem whose fix-correctness depends on schema/trigger/txn
   details that **can only be verified by running them** — whack-a-mole on paper.

2. **Despite v5 being explicitly code-grounded, it introduced TWO MORE false anchors.**
   - `ADD CONSTRAINT … NOT NULL NOT VALID` is **not valid PostgreSQL** (column NOT-NULL isn't
     NOT-VALID-able; you need `CHECK (col IS NOT NULL) NOT VALID`).
   - "like the `bootstrap-admin:mint` CLI" references a CLI that **does not exist** in the repo.
   I read the flagged files before writing v5 specifically to prevent this, and it happened anyway —
   because you cannot validate DDL/CLIs you haven't run.

Every red-team independently concluded the same: *"these close with failing tests in BUILD, not a v6
paragraph."*

## What v5 DID close (real progress, verified)
- **A1** new `authz_version` table — anchor **accurate** (no longer claims to reuse `cacheVersions`).
- **A3** `attachInstance` after `bearerAuth` — **feasible**, verified against real `bearerAuth` (line 19
  returns `next()`; later same-path middleware runs in auth-off). The one cleanly-corrected v4 anchor.
- Several HANDLED: async observed-shapes (no read-path hotspot), DEFAULT-sentinel/owner/write-once
  (no conflict), drain idempotency under stuck-closing re-entry, retention/erasure coherence.

## The genuine design contradictions still open (the only things worth a decision, not a test)
- **"Drain wins" is not guaranteed** — two separate txns + lock-free `closeTopic` Phase-2; the consume
  status re-check only narrows the window. Needs `SELECT … FOR SHARE` on `topics` in the consume txn.
- **B4 bootstrap-admin** must be `kind='human'` (credentialed break-glass), not `kind='system'`, so the
  non-authenticable trigger has **zero** exceptions.
- **B5 approval** must be subject-bound (`motion.subject_role_id = this role`) + consume = a guarded
  conditional `UPDATE … WHERE consumed_at IS NULL` (atomic one-shot).
- **kind trigger** must be **fail-closed** (require the GUC for any kind write), not fail-open on NULL.
- **Genesis provenance** needs a `verified_by` column (only `created_by` exists) or the verify-axis
  sockpuppet is unaudited.
- **Bump-matrix** must key reads on a `role_version` fold (not fan-out per-principal at amend time) or
  a project-wide Codex amend is a write storm.

## Everything else (~20 items) is BUILD/TDD: write the failing test, then implement
seal-replay-rejected, on_behalf_of-both-status, NOT-VALID-via-CHECK, CLI-completion boot interlock,
appendEvent-writes-principal_id, emitChain-no-system-literal (incl. `proposeStepMotion`), chain_depth
through `proposeStepMotion`, instance-mint-GC, re-key-excludes-`motion:`, base-repoint-lock,
flip-gate-reachable-shapes-only, hot-path-miss-budget, quarantine:reclaim, system:* seed-completeness,
proxy-grant-engine-revalidation, root-inbox-tenant-partition, authority-vs-visibility-consume, etc.

## Recommendation (now firm, not hedged)
**Stop. Build Phase A.** After five rounds the evidence is conclusive: the paper loop does not converge
(headline items relocate; the spec keeps drifting from code). The remaining rigor lives in failing
tests against real `applyMigrations`/`bearerAuth`/`closeTopic`/`motions.ts`/`coordination_events`, run
under the per-phase cold-start adversary review the safety policy already mandates — which is *more*
rigorous than a 6th paper pass, because it tests what actually runs.

Path: (1) a ~1-page reconciliation of the **6 genuine contradictions** above (decisions); (2) BUILD
Phase A TDD-first; every BUILD/TDD item above becomes an acceptance criterion with its failing test
written first. A v6 will, on this evidence, repeat round 5: ~10 relocated/edge findings + new anchor
drift, at near-zero marginal value over building.
