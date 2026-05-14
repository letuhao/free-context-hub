# Sprint 13.2 Design Review — Round 1 Adversary Findings

**Round:** 1
**Reviewer:** Adversary (cold-start sub-agent)
**Date:** 2026-05-15
**Status:** REJECTED (2 BLOCK + 1 WARN)
**Files read:** sprint-13.2-design.md, sprint-13.2-clarify.md, phase-13-design.md (Mitigation A), artifactLeases.ts, jobQueue.ts, jobExecutor.ts:1-100, index.ts, 0048_artifact_leases.sql

## FINDING 1 — BLOCK

**Category:** deploy-state
**File:line:** docs/specs/2026-05-15-phase-13-sprint-13.2-clarify.md:46 and docs/specs/2026-05-15-phase-13-sprint-13.2-design.md:101,211 vs migrations/0048_artifact_leases.sql:5-14,33-34
**Issue:**
Both CLARIFY (A1, line 46) and DESIGN (line 211 rationale) are built on a counterfactual: they claim "the partial unique index in artifact_leases_active_uniq already excludes expired leases from uniqueness checks, so stale rows do not cause functional bugs — only DB bloat" and that an immediate startup sweep "would just be redundant with the lazy cleanup that runs inside every claimArtifact." But the actually-deployed migration 0048 (lines 5-14) explicitly states Postgres rejected the partial-index design ("now() is STABLE, not IMMUTABLE"), and lines 33-34 define `artifact_leases_active_uniq` as a FULL unique index on `(project_id, artifact_type, artifact_id)` with NO WHERE predicate. The consequence: every expired lease that the sweep leaves alive during its 60-minute grace window will block fresh `claim_artifact` calls on the same artifact_id until that one specific call's step-1 DELETE clears it. Worse, the 60-minute grace means an agent attempting to re-claim an artifact whose previous lease expired 5 minutes ago will succeed only because step-1 DELETE inside its own transaction runs first — not because of the sweep — meaning the sweep is irrelevant to the AC's stated benefit. The AMAW v3.1 "deploy-state vs source-state gap" blind spot applies directly: the design narrates behavior the running stack cannot produce.
**Impact:**
AC7 is shipped against a wrong mental model; the grace-window decision is unjustified; on heavy multi-agent re-claim workloads, expired-but-ungraced rows will cause spurious unique-violation paths through `fetchConflictResultOrRetry` instead of clean claims, undetected because no test exercises a "sweep grace > 0 with expired rows present" scenario.

## FINDING 2 — BLOCK

**Category:** cross-file
**File:line:** docs/specs/2026-05-15-phase-13-sprint-13.2-design.md:322 and docs/specs/2026-05-15-phase-13-sprint-13.2-clarify.md:60 vs docs/phase-13-design.md:247
**Issue:**
The Sprint 13.2 design specifies the Active Work panel as: "force-release button (handles 403)" rendered on every row regardless of role (design line 322, plus CLARIFY A8 line 60 which decided "button visible on every row in the table to all users"). The master Phase 13 design at phase-13-design.md:247 specifies the opposite: `"Force-release" column visible only to admin role API key holders`. AC8 (phase-13-design.md:734) says "admin can force-release" — the literal text is permissive about WHO can, but the master design's UX requirement is explicit role-gating of the column itself. The Sprint 13.2 design deliberately overrides this without flagging the override, citing "no /api/me/role endpoint in the codebase today" — but a one-time `/api/me` lookup or reading `api_keys.role` for the active key is the kind of work that Sprint 13.2 owns under AC8. The design instead chose a 403-after-click UX without consultation, treating the master AC as ambiguous.
**Impact:**
Sprint 13.2 ships violating the master Phase 13 AC8 UX requirement; non-admin users see an action button they can never use, generating false-positive support load and an admin-action attack-surface via UI even though the backend correctly 403s. Scope Guard at POST-REVIEW must either accept the override as documented spec drift or block.

## FINDING 3 — WARN

**Category:** doc-vs-code
**File:line:** docs/specs/2026-05-15-phase-13-sprint-13.2-design.md:127-153 (migration 0051) and self-review item 4 at line 412
**Issue:**
The design's own self-review (item 4, line 412) identifies that migration 0051 rewrites the `async_jobs.job_type` CHECK constraint by hard-coding 14 type names copied from migration 0045 (the last constraint rewrite, shipped before Phase 11/12). The design's own mitigation is: "do `\d+ async_jobs` against the running DB before writing the migration" — a manual BUILD-phase verification step performed by the agent at the keyboard. No test asserts the pre-migration constraint matches the design's list; no migration linter exists; the migration 0051 SQL itself is `DROP CONSTRAINT IF EXISTS … ADD CONSTRAINT … CHECK (job_type IN (… 14 hard-coded names …))`. If any Phase 11/12 change added a job_type that this design's author doesn't know about (the same epistemic gap the design admits to), migration 0051 will silently delete that constraint variant from production. The rollback note (lines 155-157) tells you how to undo `leases.sweep` but offers no guidance on recovering a job_type that was clobbered.
**Impact:**
Future tech debt and a latent production data-integrity hazard if the AMAW autonomous run skips the manual `\d+` step; a silently-clobbered job_type produces 500s on `enqueueJob` for the affected type only when that path is next exercised, with no error at migration time.
