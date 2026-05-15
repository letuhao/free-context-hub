---
id: PHASE-13-LONGRUN-PLAN
date: 2026-05-15
type: meta-plan
mode: AMAW autonomous (no human-in-loop until done or budget exhausted)
branch: phase-13-dlf-coordination-amaw (continue from 6c9e3f6)
budget: Claude Max 5h × up to 20 sessions (~100h) — best-effort, not contractual
purpose_dual:
  - product: ship Phase 13 sprints 13.2–13.7 (F1 TTL+GUI · F2 core+GUI · F3 core+GUI · E2E)
  - research: stress-test AMAW v3.1 over a multi-sprint horizon; collect calibration data
risk_accepted: AI agents may miss issues, make wrong architectural choices, or overcorrect. User explicitly accepts.
---

# Phase 13 Long-Run Plan — AMAW autonomous, multi-sprint, self-healing

> **Read this first if you are the resuming agent.** This plan is **idempotent**: a fresh session re-reads `.workflow-state.json` + `docs/audit/AUDIT_LOG.jsonl` + the most recent `SESSION_PATCH.md` to determine *exactly* where the previous session stopped. There is no implicit state in chat.

---

## 1. Mission

Complete Phase 13 (sprints 13.2 through 13.7) without per-task human checkpoints, using AMAW v3.1 (Adversarial Multi-Agent Workflow, opt-in) plus a new **self-healing post-sprint audit cycle** that codifies the Sprint 13.1 post-audit pattern.

Secondary goal: produce a measured dataset on:
- How AMAW degrades (or doesn't) over a 6-sprint horizon
- Whether the two known blind spots (deploy-state, cross-file context) recur with mitigations in place
- Cost vs catch rate at scale (Sprint 13.1 measured ~$3–5 per sprint + 7 residuals AMAW missed)

This is an **experimental calibration run**. We accept that wrong decisions may ship and need reversal. We instrument heavily so the wrongs are visible.

---

## 2. Scope — what is in this run

### In scope
- Sprint 13.2 — F1 TTL sweep job + Active Work GUI panel
- Sprint 13.3 — F2 core (review_requests, submit_for_review, list_review_requests, REST approve/return, status enum centralization)
- Sprint 13.4 — F2 GUI (Submitted for Review tab, badge sum, approve/return actions)
- Sprint 13.5 — F3 core (taxonomy_profiles, project_taxonomy_profiles, codex-guardrail engine integration, lesson_type centralization, dlf-phase0 seed)
- Sprint 13.6 — F3 GUI (Project Settings → Taxonomy tab, deactivation dialog, profile activation UI, label rendering)
- Sprint 13.7 — E2E + integration (concurrent claim, TTL expiry, renew, submit→approve→DLF write, taxonomy + codex-guardrail, Phase 1–12 regression sweep)

### Explicitly out of scope (do not invent extra work)
- Per-project model routing (DEFERRED-001, ABANDONED)
- Automated `reckoning-record.md` export (deferred per design doc §DLF-specific workflow note)
- DEFERRED-003 (`race_exhausted` test) — addressed in 13.7 via short-TTL stress test, not a separate sprint
- AMAW workflow changes — calibration data informs a *future* spec, not edits during this run
- Anything not in `docs/phase-13-design.md` "Sprint Plan" table

---

## 3. Pre-flight (run once at start of session 1)

The resuming agent MUST execute these steps in order before opening Sprint 13.2 CLARIFY. If any step fails, write a blocking entry to AUDIT_LOG and stop the run.

| # | Step | Verification |
|---|---|---|
| 1 | Confirm branch = `phase-13-dlf-coordination-amaw`, HEAD = `6c9e3f6` (or descendant if a prior long-run session has committed) | `git rev-parse HEAD` |
| 2 | Confirm working tree clean | `git status --porcelain` empty |
| 3 | Pre-run DB snapshot: `docker exec contexthub-db pg_dump -U contexthub contexthub > backups/2026-05-15-pre-longrun.dump` | file exists, > 10MB |
| 4 | Stack health: `docker compose ps` — mcp, worker, db, gui all running; embeddings provider reachable (`curl -s ${EMBEDDINGS_BASE_URL}/v1/models` returns 200) | log embedded in AUDIT_LOG pre-flight event |
| 5 | Sprint 13.1 still green: `npm test -- src/services/artifactLeases.test.ts` → 22/22 pass; `tsc --noEmit` clean | log to AUDIT_LOG |
| 6 | Append AUDIT_LOG event: `{phase:"longrun_preflight", agent:"main", action:"phase_complete", note:"branch+tree+db+stack+regression all green"}` | line appended |
| 7 | Update `.workflow-state.json`: reset for `phase-13-longrun`, current_phase=`clarify`, size=`XL` (multi-sprint orchestration) | file shows `started_at` = now |

---

## 4. Sprint loop — runs 6 times (13.2 → 13.7)

Each sprint follows the **standard 12-phase AMAW cycle** (`docs/amaw-workflow.md`) with the **two v3.1 mitigations applied** plus a **post-sprint audit cycle** appended.

### 4.1 Standard cycle (per sprint)

```
1. CLARIFY      → main writes docs/specs/2026-05-15-phase-13-sprint-13.X-clarify.md
                  (includes assumption list, scope, open questions)
                  AC checklist from docs/phase-13-design.md copied verbatim into spec
2. DESIGN       → main writes docs/specs/2026-05-15-phase-13-sprint-13.X-design.md
                  + records spec_hash (sha256 of design.md normalized) into AUDIT_LOG
3. REVIEW-DESIGN → Adversary cold-start, ≥1 round, max 3 rounds. Stop when round-N finds
                   ≤1 BLOCK that can be fixed inline AND finds no novel category.
                   *** MITIGATION A *** Adversary prompt MUST include
                   docs/phase-13-design.md alongside the immediate spec.
4. PLAN         → main writes docs/plans/2026-05-15-phase-13-sprint-13.X-plan.md
                  no placeholders; each task has file path + verification cmd
5. BUILD        → TDD where applicable. Each sub-task: red → green → refactor → commit-cycle
                  intermediate (kept local until SESSION).
6. VERIFY       → `tsc --noEmit` + `npm test -- <affected paths>` fresh run.
                  Exit code + raw output appended to AUDIT_LOG.
7. REVIEW-CODE  → Adversary cold-start, ≥1 round, max 3 rounds. Same stop rule.
                  *** MITIGATION A *** same as DESIGN review.
8. QC           → Scope Guard: spec_hash match? AC coverage? Drift? Writes verdict event.
9. POST-REVIEW  → Scope Guard final + *** MITIGATION B *** deploy-state smoke:
                   a. `docker compose up -d --build mcp worker`
                   b. curl smoke against running REST endpoints touched this sprint
                   c. (if MCP tools touched) MCP smoke via tools/list + 1 happy-path call
                  Verdict event in AUDIT_LOG. BLOCKED if any smoke fails.
10. SESSION     → append a per-sprint section to docs/sessions/SESSION_PATCH.md
                  (sprint summary, files, commits, AMAW events, residuals if any)
                  + write any new entries to docs/deferred/DEFERRED.md
11. COMMIT      → git commit -m "phase-13 sprint 13.X: <topic> (AMAW longrun)"
                  + git push origin phase-13-dlf-coordination-amaw
12. RETRO       → add_lesson to MCP (sprint outcome, blind spots seen, AMAW cost)
                  + sprint_complete event to AUDIT_LOG with token+findings counts
```

### 4.2 Post-sprint audit (self-healing layer — NEW for this run)

Immediately after RETRO of each sprint, before starting the next sprint, run **one** post-sprint audit cycle:

```
A1. Spawn Adversary (cold-start) with prompt:
    "Read docs/specs/<sprint-design>.md, the diff for commits <sprint-shas>,
     docs/audit/AUDIT_LOG.jsonl (last 50 lines), and docs/phase-13-design.md.
     Find residuals AMAW missed in-loop. Categorize each:
       (a) deploy-state gap (code ok, deployment wrong)
       (b) cross-file context (spec in adjacent file ignored)
       (c) doc/code drift (doc says X, code does Y)
       (d) test gap (claimed covered but no real test)
       (e) other
     For each: severity (HIGH/MED/LOW), file:line, recommended fix.
     If 0 residuals → return CLEAR. If ≥1 → return REJECTED with list."
A2. If CLEAR → append AUDIT_LOG event, proceed to next sprint.
    If REJECTED → fix residuals in a single commit "phase-13 sprint 13.X post-audit: <N> residuals fixed".
                   Re-run VERIFY (tests fresh) + the deploy-state smoke from §4.1 step 9.
                   Append AUDIT_LOG event.
A3. **Aggressive mode (selected for this run):** up to **4 post-audit cycles** per sprint, **blocking** — next sprint does not start while HIGH/MED residuals remain. Only LOW residuals may be deferred (with DEFERRED.md entry + trigger condition).
    After 4 cycles still REJECTED on HIGH/MED → escalate to Hard Stop HS-1.
```

Rationale: Sprint 13.1 had 7 residuals AMAW missed in-loop, all caught by manual user-prompted audit afterwards. Codifying that audit as a structured cycle is the cheapest way to recover those misses without changing the AMAW core. We measure how many residuals each sprint's post-audit catches as the primary calibration metric. Aggressive mode trades budget for cleanliness — if a sprint burns the cycle cap on one residual category, that's signal worth Hard Stop (HS-7-adjacent) attention from the user.

### 4.3 Mid-phase cumulative scope check (every 2 sprints)

After sprints 13.3, 13.5, and at the end of 13.7, run a **cumulative Scope Guard**:

```
M1. Spawn Scope Guard (cold-start) with prompt:
    "Read docs/phase-13-design.md (the master design). Read the diff from <pre-13.2-sha>
     to HEAD. Compare every Acceptance Criterion in the design to the implementation.
     Mark each AC: COVERED / PARTIAL / UNCOVERED / DRIFT (covered but differently than designed).
     Return matrix with file:line evidence per row. Flag drift items even if 'better'
     than the spec — drift is drift."
M2. If any DRIFT or UNCOVERED outside the sprint scope just completed → fix in a
    targeted commit "phase-13 cumulative-scope-fix after 13.X".
M3. Append AUDIT_LOG event.
```

This is the AMAW v3.1 "shifts human role to per-sprint boundaries" framing applied at the **cumulative** level — catches drift that accumulates *across* sprints (each sprint's Scope Guard only sees that sprint's diff).

---

## 5. Session-boundary protocol — surviving compaction & 5h timeouts

A 100h budget across 20 × 5h sessions guarantees that **multiple sessions** will run this plan. The plan must be resumable from any phase boundary.

### Rules for the running agent

| Situation | Action |
|---|---|
| Approaching context compaction (>~70% context used) | Finish the *current phase*, append a `session_boundary` event to AUDIT_LOG with `state_snapshot` (current_phase, last_completed_task), update SESSION_PATCH, stop. Do NOT start a new phase. |
| 5h session limit approaching (~4h 30m elapsed wall-clock from session start) | Same — finish current phase, write boundary event, stop. |
| Mid-BUILD when boundary hits | Commit work-in-progress to a branch `phase-13-wip-<sprint>-<timestamp>` — do NOT leave dirty tree. Note WIP commit SHA in boundary event. Next session resumes from WIP and squashes before sprint COMMIT phase. |
| Mid-VERIFY when boundary hits | Treat verify as failed; next session re-runs from VERIFY. |
| Mid-Adversary spawn when boundary hits | Do NOT abandon the sub-agent mid-flight if avoidable. If unavoidable, next session re-spawns the same Adversary with the same prompt — it's cold-start, so re-running is fine. |

### Resumption protocol (first action of every session after session 1)

```
R1. Read .workflow-state.json → identify current_phase + last completed phase
R2. Read last 50 lines of docs/audit/AUDIT_LOG.jsonl → identify last session_boundary event
R3. Read tail of docs/sessions/SESSION_PATCH.md → identify last sprint completed + WIP commit if any
R4. Run `git status` + `git log --oneline -10` → reconcile with state files
R5. If state files agree with git → proceed from current_phase
    If state files DISAGREE with git → STOP, append AUDIT_LOG conflict event, do not
    auto-resolve. (This is a "weird state" signal — better to halt than guess.)
R6. Append AUDIT_LOG event: {action:"session_resume", from_phase:"<X>", last_commit:"<sha>"}
```

---

## 6. Budget guardrails & stopping conditions

### Token / cost ledger (kept inside AUDIT_LOG as `cost_checkpoint` events)

Per sprint, log at COMMIT phase:
- Approximate input+output token count (estimated from sub-agent call count × ~80K avg)
- Wall-clock minutes elapsed (sprint start → commit)
- AMAW sub-agent call count (Adversary rounds × phases reviewed + Scope Guard calls + post-audit Adversary)

### Soft alarms (continue but flag in SESSION_PATCH)

- Sprint > 600K tokens total (Sprint 13.1 used ~400K — 50% over is concerning)
- Post-audit found >5 HIGH/MED residuals (AMAW catch rate degrading)
- Cumulative scope check found ≥2 DRIFT items
- Same blind-spot category (deploy-state OR cross-file) appears in ≥3 sprints despite mitigation

### Hard stops (write handoff, stop the run, do NOT continue without user)

- **HS-1** Any sprint fails to clear HIGH/MED residuals within 4 post-audit cycles (aggressive mode threshold)
- **HS-2** Cumulative token usage > 80% of 100h × est. budget by start of sprint 13.5
- **HS-3** Production smoke (§4.1 step 9) fails 2× on the same sprint after fix attempts
- **HS-4** Scope Guard reports `spec_drift: true` on the master design (§4.3) and the fix would require redesigning a feature
- **HS-5** Resumption protocol (§5) detects "weird state" — git/state-file mismatch
- **HS-6** Any agent (main or sub) detects what it believes to be **data corruption** in the running stack (DB inconsistency, lost rows, FK violations from migrations). DB integrity is non-recoverable from chat — stop.
- **HS-7** The same BLOCK finding appears in code-review round 3 in any sprint (signals architectural issue the agent can't see)

On any hard stop:
1. Append AUDIT_LOG `hard_stop` event with HS-N code + full context
2. Write a detailed handoff to SESSION_PATCH including: what's done, what's pending, what went wrong, recommended next step for user
3. Commit current state if tree is dirty (WIP branch) — do NOT push if push would propagate broken state
4. Stop. Wait for user.

---

## 7. Calibration data — what we collect

Stored implicitly in `docs/audit/AUDIT_LOG.jsonl`; a final summary `docs/audit/phase-13-longrun-calibration.md` is written at completion or hard stop.

Per sprint:
| Field | Source |
|---|---|
| Sprint ID | Manual |
| Wall-clock minutes | start event timestamp → commit event timestamp |
| Sub-agent calls | Count of `agent:"adversary"\|"scope-guard"` events |
| Findings (BLOCK/WARN per round) | Each review event has `block_count` + `warn_count` |
| In-loop catches | Total BLOCKs resolved before COMMIT |
| Post-audit residuals | Post-audit Adversary event `findings_count` |
| Residual categories | Post-audit Adversary event `categories[]` |
| Cumulative-scope drift count | Mid-phase Scope Guard event (every 2 sprints) |
| Estimated token cost | `cost_checkpoint` event |
| Deploy-state smoke result | POST-REVIEW event `smoke_result` field |
| Cross-file context fix hit-rate | Did Mitigation A surface a finding Adversary would otherwise miss? Manual tag in review event note. |

End-of-run summary will compute:
- **AMAW v3.1 residual rate:** post-audit residuals ÷ in-loop findings per sprint, averaged
- **Mitigation A effectiveness:** % of sprints where including `phase-13-design.md` in Adversary prompt produced a finding traceable to that doc
- **Mitigation B effectiveness:** count of issues caught only by deploy-state smoke (would have shipped otherwise)
- **Cost per sprint:** ~$ amount (input + output tokens × rate)
- **Cost vs catches:** $ per BLOCK found, $ per residual avoided

---

## 8. Sprint-specific notes (lookup tables, not full plans)

Full per-sprint specs are written *during* the run (CLARIFY phase). These notes anchor scope to design doc references so the agent doesn't drift.

### Sprint 13.2 — F1 TTL + GUI
- Design ref: `docs/phase-13-design.md` lines ~231–248 (TTL) + ~240–248 (Active Work panel)
- New: `leases.sweep` job (job_type union update), `setTimeout` scheduler in `src/index.ts`
- New: Active Work table component, 10s auto-refresh, force-release for admin role
- ACs to satisfy: F1 ACs 7, 8 in design doc §"Feature 1 complete when"
- Pre-existing F1 ACs 1–6 already satisfied by Sprint 13.1 — verify no regression
- Estimated size: M (3–5 files)

### Sprint 13.3 — F2 core
- Design ref: `docs/phase-13-design.md` lines ~257–411
- New: Migration 0049, `src/services/reviewRequests.ts`, `src/constants/lessonStatus.ts`
- Touch: `src/mcp/index.ts` 4 enum sites (3 → LESSON_STATUS_ALL, 1 keep WRITABLE + runtime guard)
- New MCP tools: `submit_for_review`, `list_review_requests`
- New REST: `/api/projects/:id/review-requests` CRUD + approve + return
- Audit log integration (existing `audit_logs` table)
- ACs: F2 ACs 1, 2, 3, 4, 5, 6, 7 (8 is GUI in 13.4)
- Estimated size: L (6–8 files)

### Sprint 13.4 — F2 GUI
- Design ref: `docs/phase-13-design.md` lines ~414–431
- Touch: `gui/src/app/review/page.tsx` — add second tab; modify badge calculation
- New cards for `pending-review` lessons; approve/return actions wire to REST
- ACs: F2 AC 8
- Estimated size: M

### Sprint 13.5 — F3 core
- Design ref: `docs/phase-13-design.md` lines ~436–646
- New: Migration 0050, `src/services/taxonomyService.ts`, `src/constants/lessonTypes.ts`,
       `config/taxonomy-profiles/dlf-phase0.json`, seed-on-startup logic
- Touch: `src/mcp/index.ts` 3 lesson_type enum sites → `z.string()` + runtime validation
- Touch: `src/kg/linker.ts` line ~7 — add `codex-guardrail` → `CONSTRAINS`
- Touch: guardrail engine query (find via grep `lesson_type = 'guardrail'`) →
       `lesson_type = ANY(GUARDRAIL_LESSON_TYPES)`
- New REST: `/api/taxonomy-profiles` CRUD + project activation endpoints
- New MCP tools: (TBD during CLARIFY — design doc doesn't enumerate; cross-reference §"Profile management")
- ACs: F3 ACs 1, 2, 3, 4, 5, 8 (6, 7 are GUI in 13.6)
- Estimated size: L (8–10 files)
- **High residual risk** — F3 has the most cross-cutting changes (KG linker, guardrail engine, lesson_type pipeline). Allocate extra Adversary rounds.

### Sprint 13.6 — F3 GUI + search/reflect labels
- Design ref: `docs/phase-13-design.md` lines ~648–672
- New tab in Project Settings page; deactivation dialog with behavior warning
- Touch: `list_lessons` / `search_lessons` rendering — show profile labels via service call
- Touch: `reflect` grouping output to use profile labels
- ACs: F3 ACs 6, 7
- Estimated size: M

### Sprint 13.7 — E2E + integration + Phase 1–12 regression
- Design ref: `docs/phase-13-design.md` Sprint Plan row 7 + ACs section
- New: E2E test file(s) under `tests/e2e/phase-13/` exercising concurrent claim,
       TTL expiry (short-TTL stress test — covers DEFERRED-003 race_exhausted), renew,
       submit → approve → simulated reckoning-record.md write, taxonomy activation,
       codex-guardrail in check_guardrails
- Run full existing test suite as regression
- ACs: "Phase 13 complete when:" master line in design doc
- Estimated size: L
- Cumulative Scope Guard at end of this sprint = final phase audit

---

## 9. Constraints the agent MUST respect during the run

These are non-negotiable. The user has not pre-approved exceptions.

| # | Constraint | Why |
|---|---|---|
| C1 | NEVER force-push, NEVER `git reset --hard` on a pushed commit | User work / experiment history must be preserved |
| C2 | NEVER drop tables / DROP DATABASE / truncate user data | Hard stop HS-6 zone |
| C3 | NEVER `--no-verify` on commits | Hook failures must be fixed, not bypassed |
| C4 | NEVER skip a phase (per CLAUDE.md anti-skip rules) — only XS-classified tasks may skip CLARIFY/PLAN, and no sprint here is XS | Workflow integrity |
| C5 | NEVER merge `phase-13-dlf-coordination-amaw` → `phase-13-dlf-coordination` or `main` autonomously | Merge decisions are strategic and require user |
| C6 | NEVER delete `docs/audit/AUDIT_LOG.jsonl` or rewrite its history | Append-only is the trust anchor |
| C7 | NEVER modify `docs/phase-13-design.md` AC checklist mid-run | If the design is wrong, that's a Hard Stop, not a self-edit |
| C8 | NEVER touch `.env` secrets in commits | Standard hygiene |
| C9 | NEVER commit `backups/*.dump` files | Backups are local, not source-controlled |
| C10 | If unsure between two architectural choices → choose the one closer to the design doc, document the alternative in DEFERRED.md, move on | Decision rot prevention; design doc is the tiebreaker |

---

## 10. Acceptance — when is this run "done"

The run terminates successfully when ALL of:

1. Sprints 13.2 through 13.7 each have a `sprint_complete` event in AUDIT_LOG with `status: CLEAR`
2. The cumulative Scope Guard at end of 13.7 reports zero UNCOVERED ACs in the design doc master AC list (or each UNCOVERED has an explicit DEFERRED entry with trigger)
3. `tsc --noEmit` clean
4. Full unit test suite passes (`npm test`)
5. E2E suite from 13.7 passes against the running Docker stack
6. `docs/audit/phase-13-longrun-calibration.md` is written with the data from §7
7. Final handoff section in `SESSION_PATCH.md` summarizes run outcome
8. A merge-decision note added to SESSION_PATCH "Open question: merge `-amaw` → `phase-13-dlf-coordination`?" — but the merge itself is NOT done autonomously (per C5)

The run terminates unsuccessfully on any Hard Stop (§6). Both outcomes produce a handoff; the user decides next steps.

---

## 11. What the user should expect to see when they return

- Last commit on `phase-13-dlf-coordination-amaw` is either a sprint commit, a post-audit fix, or a `hard_stop` SESSION-only commit
- `docs/sessions/SESSION_PATCH.md` has a "Long-Run 2026-05-15" section with per-sprint summaries
- `docs/audit/AUDIT_LOG.jsonl` has dozens of events — searchable
- `docs/audit/phase-13-longrun-calibration.md` exists if the run completed; absent if hard-stopped
- MCP has 6 new lessons (one per sprint) + any retrospective lessons from the post-audit cycles
- `docs/deferred/DEFERRED.md` may have new entries — each with concrete trigger conditions

---

## 12. Out-of-band kill switch

If the user returns mid-run and wants to halt:
- Killing the Claude Code session is sufficient — the workflow is durable via `.workflow-state.json` + AUDIT_LOG
- A subsequent session will resume from the last completed phase (§5)
- The user can edit `.workflow-state.json` to set `current_phase: "halted"` if they want the next session to *not* auto-resume

---

## Appendix A: AMAW Adversary prompt template (with Mitigation A)

```
You are an Adversary reviewing a {DESIGN | CODE} artifact for sprint 13.X.
Your goal: find exactly 3 things that could go wrong. Frame each as BLOCK
(must be fixed before proceeding) or WARN (should be fixed but not blocking).
Never say what is good. Never suggest fixes. Never rate overall quality.

Read these files:
  - {immediate artifact: spec file OR diff}
  - docs/phase-13-design.md      [Mitigation A — cross-file context]
  - docs/specs/2026-05-15-phase-13-sprint-13.X-design.md (if reviewing code)
  - The relevant prior AUDIT_LOG events (review rounds, qc, post-review)

Output format (append directly to docs/audit/AUDIT_LOG.jsonl as one JSON line):
  {"ts":"<iso>","task":"phase-13-sprint-13.X","phase":"review-{design|code}",
   "agent":"adversary","action":"review","round":<N>,
   "status":"<APPROVED|APPROVED_WITH_WARNINGS|REJECTED>",
   "findings_count":<int>,"block_count":<int>,"warn_count":<int>,
   "artifact":"docs/audit/findings-sprint-13.X-{design|code}-r<N>.md","note":"<one-line summary>"}

Also write the full findings detail to docs/audit/findings-sprint-13.X-{design|code}-r<N>.md
in markdown with file:line citations.
```

## Appendix B: Scope Guard prompt template

```
You are a Scope Guard performing {QC | POST-REVIEW | CUMULATIVE-SCOPE} review for sprint 13.X.
You enforce spec compliance. You do not propose fixes — you produce a verdict.

Read these files:
  - docs/phase-13-design.md (master design — the spec fingerprint)
  - docs/specs/2026-05-15-phase-13-sprint-13.X-design.md (sprint design)
  - The diff for commits in this sprint (provided in prompt)
  - docs/audit/AUDIT_LOG.jsonl (prior events this sprint)

For each Acceptance Criterion in the design doc that this sprint owns:
  Mark: COVERED / PARTIAL / UNCOVERED / DRIFT (covered but differently than spec)
  Cite: file:line where it is implemented (or note absence)

Output verdict:
  CLEAR    = all ACs COVERED or explicitly deferred + no drift
  BLOCKED  = ≥1 UNCOVERED that is not in DEFERRED.md, OR ≥1 DRIFT, OR spec_hash mismatch

Append to AUDIT_LOG as:
  {"ts":"<iso>","task":"phase-13-sprint-13.X","phase":"<qc|post-review|cumulative>",
   "agent":"scope-guard","action":"qc","status":"<CLEAR|BLOCKED>",
   "spec_drift":<bool>,"ac_covered":<int>,"ac_partial":<int>,"ac_uncovered":<int>,
   "note":"<one-line>"}
```

## Appendix C: Deploy-state smoke template (Mitigation B)

For every sprint that touches REST endpoints or MCP tools:

```bash
# 1. Rebuild affected services
docker compose up -d --build mcp worker

# 2. Wait for health
sleep 15  # or poll /healthz

# 3. Smoke endpoints touched this sprint (sprint-specific list)
# Example for 13.2 (TTL sweep):
curl -fsS http://localhost:3001/api/projects/free-context-hub/artifact-leases \
  -H 'X-API-Key: <admin-key>' | jq '.claims | length'

# 4. (If MCP touched) MCP tools/list + happy-path call
# Use the MCP smoke script in scripts/ (write if missing)

# 5. If any 4xx/5xx unexpected → POST-REVIEW BLOCKED
```

---

End of plan.
