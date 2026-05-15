# AMAW — Autonomous Multi-Agent Workflow

**Version:** 1.1 (revised 2026-05-15 post-first-run)
**Date:** 2026-05-14 (initial), 2026-05-15 (calibration update)
**Status:** **OPT-IN** — default workflow is v2.2 human-in-loop. AMAW is invoked when user types `/amaw` or includes "use AMAW workflow" in the task description.
**Quick reference:** CLAUDE.md — "Task Workflow (default v2.2 · AMAW opt-in)"

## Migration note — 2026-05-15

The original AMAW spec below uses `.phase-gates/<phase>.gate` files as evidence. After Phase 14 (first real AMAW run) we learned this pollutes the repo with ~10 ephemeral files per task. **The current implementation uses `docs/audit/AUDIT_LOG.jsonl`** — an append-only JSONL file with one event per phase transition / agent verdict. References to `.phase-gates/<phase>.gate` below should be read as "append an event to AUDIT_LOG.jsonl with the same content" — see event schema in the "AUDIT_LOG.jsonl Schema" section. The architectural intent (files-as-truth, fingerprint tracking, conservative wins) is unchanged.

## When NOT to use AMAW

Phase 14 case study found AMAW worth its cost (~$1-5 / ~30 min wallclock per task) for:
- Data migrations (vector schema, model swaps)
- New service boundaries / multi-system contracts
- Auth/tenant isolation / security-sensitive paths
- Bulk operations affecting >1 project simultaneously

For everyday work (single-file bug fixes, doc updates, small refactors), AMAW is overkill — the human-in-loop default catches the same issues at a fraction of the token cost.

---

## Overview

Workflow v2.2 treats Phase 9 (POST-REVIEW) as a human-interactive checkpoint. This works when a human is available and engaged. It breaks when:

- Sessions run autonomously (no human in the loop)
- Context rot causes the main session to forget deferred items
- Power creep silently expands scope beyond the original design
- "later" items are mentioned in chat but never written anywhere

AMAW replaces the human checkpoint with a structured set of cold-start sub-agents. The core insight: **a sub-agent spawned fresh with only file access cannot inherit the main session's biases or context rot**. It can only judge what it reads.

### What AMAW is NOT

- Not a task orchestrator — agents decide what to work on; AMAW lets them signal and verify those decisions
- Not a messaging bus — agents communicate through files and MCP, not directly
- Not passive monitoring — sub-agents are spawned explicitly by the main session at defined phase gates
- Not a replacement for good code — AMAW catches drift and rot; it does not substitute for correct implementation

---

## Core Principles

### 1. Files are truth, not chat

Chat is ephemeral. Everything important that happens in a session MUST be written to a file before it can be verified, reviewed, or passed to a sub-agent. Main session writes; sub-agents read. No exceptions.

### 2. Cold-start sub-agents

Every sub-agent is spawned fresh — it does not see the main session's conversation history. It reads only:
- The files specified in its prompt
- MCP tools (`search_lessons`, `check_guardrails`)

This is the only way to guarantee independent perspective. A sub-agent that reads the main session's context is not independent — it inherits the same rot.

### 3. Conservative wins

When a sub-agent returns `status: REJECTED` or `status: BLOCKED`, the main session MUST fix the underlying issue before proceeding. No voting, no negotiation, no "we'll address it later." The workflow-gate.sh script enforces this mechanically.

### 4. Deferred items are first-class

A deferred item mentioned only in chat does not exist. It MUST be written to `docs/deferred/DEFERRED.md` with a specific trigger condition. OPEN items older than 3 sessions escalate to WARNING in the audit log.

---

## File Architecture (v1.1 — AUDIT_LOG.jsonl as single source)

```
docs/
  amaw-workflow.md                     # This file — full AMAW spec
  deferred/
    DEFERRED.md                        # Deferred items lifecycle (Scribe-managed)
  audit/
    AUDIT_LOG.jsonl                    # Append-only audit trail (one JSON line per event)
                                        # REPLACES the per-phase .phase-gates/*.gate files
                                        # from v1.0. All phase completions, agent verdicts,
                                        # deferred-detected events, size changes go here.
  specs/
    YYYY-MM-DD-<topic>.md              # Design specs (main session writes; spec_hash
                                        # recorded in AUDIT_LOG design events)
  plans/
    YYYY-MM-DD-<topic>.md              # Task plans (main session writes)
  sessions/
    SESSION_PATCH.md                   # Session summary (Scribe writes)

.workflow-state.json                   # workflow-gate.sh state machine (gitignored)
```

**Phase invariant (v1.1):** a phase cannot be marked complete in `.workflow-state.json` unless an `action: phase_complete` event exists for it in `AUDIT_LOG.jsonl` AND any associated review event has `status: APPROVED`, `APPROVED_WITH_WARNINGS`, or `CLEAR`. The main session writes phase_complete events; agents write review events.

---

## Sub-Agent Taxonomy

### Scribe

**Role:** Secretary and context guardian. Records decisions, detects deferred items, writes session summaries, maintains AUDIT_LOG.  
**Trigger points:** CLARIFY end, PLAN end, mid-BUILD checkpoint (if context budget exceeded), SESSION end  
**Reads:** All existing `.phase-gates/*.gate` files, `docs/deferred/DEFERRED.md`  
**Writes:** `docs/sessions/SESSION_PATCH.md`, `docs/deferred/DEFERRED.md`, `docs/audit/AUDIT_LOG.jsonl`, `.phase-gates/session.gate`  
**Cannot do:** Make decisions, approve or reject anything, modify code or specs

### Adversary

**Role:** Devil's advocate. Finds exactly 3 things that could go wrong. Frames every output as a BLOCK or WARN. Never says what is good.  
**Trigger points:** DESIGN end (reviews spec), REVIEW end (reviews code vs spec)  
**Reads:** The specific file being reviewed + its gate file. Nothing else.  
**Writes:** `.phase-gates/design-review.gate` or `.phase-gates/code-review.gate`  
**Cannot do:** Suggest fixes, rate overall quality, approve without findings

> **Critical framing note:** The Adversary prompt must say "find 3 things that could go wrong" — NOT "review this." The framing determines the output. A nicely-worded review prompt produces rubber-stamps.

### Scope Guard

**Role:** Spec compliance enforcer. Compares implementation against design spec fingerprint. Flags scope drift and spec divergence.  
**Trigger points:** QC phase, POST-REVIEW  
**Reads:** `docs/specs/DESIGN.md` (current), `.phase-gates/design.gate` (fingerprint), code diff or file list  
**Writes:** `.phase-gates/qc.gate`, `.phase-gates/post-review.gate`  
**Cannot do:** Override Adversary findings, approve code quality (that's Adversary's job)

### Audit Logger

**Role:** Immutable record keeper. Writes all decisions and phase transitions to AUDIT_LOG.jsonl and `add_lesson` in MCP.  
**Trigger points:** RETRO phase, and called by Scribe at SESSION  
**Reads:** All gate files for the current sprint  
**Writes:** `docs/audit/AUDIT_LOG.jsonl`, calls `add_lesson` MCP tool  
**Cannot do:** Modify what happened — only record it

---

## Phase × Agent Spawn Map

```
Phase           │ Main session action                │ Spawn agent   │ Agent output
────────────────┼────────────────────────────────────┼───────────────┼──────────────────────────
1. CLARIFY      │ Read MCP + files, write assumptions│ Scribe        │ clarify.gate
                │ to docs/specs/<topic>.md           │               │ DEFERRED.md open-item scan
────────────────┼────────────────────────────────────┼───────────────┼──────────────────────────
2. DESIGN       │ Write docs/specs/DESIGN.md         │ —             │ —
                │ Compute sha256(DESIGN.md)          │               │
                │ Write design.gate with fingerprint │               │
────────────────┼────────────────────────────────────┼───────────────┼──────────────────────────
3. REVIEW       │ —                                  │ Adversary     │ design-review.gate
(design)        │                                    │ (reads spec)  │ status: APPROVED | REJECTED
                │ If REJECTED → fix DESIGN.md        │               │
                │ → re-compute fingerprint           │               │
                │ → spawn Adversary again            │               │
────────────────┼────────────────────────────────────┼───────────────┼──────────────────────────
4. PLAN         │ Write docs/plans/PLAN.md           │ Scribe        │ plan.gate
                │ (bite-sized tasks, no placeholders)│               │ validates: no TBD/TODO,
                │                                    │               │ task count, size class
────────────────┼────────────────────────────────────┼───────────────┼──────────────────────────
5. BUILD        │ Implement (TDD: red→green→refactor)│ —             │ —
                │ Mid-BUILD checkpoint if 3+ tasks   │               │
                │ done without gate write → Scribe   │               │
────────────────┼────────────────────────────────────┼───────────────┼──────────────────────────
6. VERIFY       │ Run tests fresh                    │ —             │ verify.gate
                │ Write verify.gate with raw output  │               │ (exit code + evidence)
                │ + exit code                        │               │
────────────────┼────────────────────────────────────┼───────────────┼──────────────────────────
7. REVIEW       │ Write code diff summary            │ Adversary     │ code-review.gate
(code)          │                                    │ (reads code   │ status: APPROVED | REJECTED
                │                                    │  + spec)      │
────────────────┼────────────────────────────────────┼───────────────┼──────────────────────────
8. QC           │ Write AC checklist results         │ Scope Guard   │ qc.gate
                │                                    │ (reads spec   │ spec_drift: true|false
                │                                    │  fingerprint) │ status: PASS | FAIL
────────────────┼────────────────────────────────────┼───────────────┼──────────────────────────
9. POST-REVIEW  │ —                                  │ Scope Guard   │ post-review.gate
                │                                    │ (final gate)  │ status: CLEAR | BLOCKED
                │ If BLOCKED → fix → re-run QC       │               │
────────────────┼────────────────────────────────────┼───────────────┼──────────────────────────
10. SESSION     │ —                                  │ Scribe        │ session.gate
                │                                    │               │ SESSION_PATCH.md updated
                │                                    │               │ DEFERRED.md updated
                │                                    │               │ AUDIT_LOG.jsonl updated
────────────────┼────────────────────────────────────┼───────────────┼──────────────────────────
11. COMMIT      │ git commit                         │ —             │ commit.gate
                │ Write commit.gate with hash        │               │
────────────────┼────────────────────────────────────┼───────────────┼──────────────────────────
12. RETRO       │ —                                  │ Audit Logger  │ retro.gate
                │                                    │               │ lessons in MCP
```

---

## Sub-Agent Prompt Templates

> **v1.1 path note:** the templates below reference `.phase-gates/<phase>.gate` for backward compatibility. In current implementation, replace those instructions with "**append your verdict as a JSONL event to `docs/audit/AUDIT_LOG.jsonl`** with fields `ts`, `task`, `phase`, `agent`, `action: review`, `status`, `findings_count`, `block_count`, `warn_count`, `note`". The fingerprint reads (`spec_hash`) come from prior design events in AUDIT_LOG instead of from `design.gate`. Functional behavior is identical.

### Adversary — Design Review

```
You are the Adversary reviewer. Your ONLY job is to find problems with this design spec.

Read ONLY these files (do NOT read anything else, do NOT search the web):
  - docs/specs/DESIGN.md
  - .phase-gates/design.gate

Instructions:
- Find EXACTLY 3 things that could go wrong with this design.
- Do NOT say what is good.
- Do NOT be diplomatic.
- Do NOT suggest the design is mostly fine.
- Each finding must be concrete and specific — not vague.

For each finding, write:
  severity: BLOCK | WARN
    BLOCK = this will cause a failure or security issue if not fixed
    WARN  = this is a risk or gap that should be noted
  finding: [what specifically could go wrong]
  impact: [what breaks or is harmed]
  required_fix: [one concrete action to address it]

Decision rule (no exceptions):
  - Any finding with severity BLOCK → write: status: REJECTED
  - All findings with severity WARN  → write: status: APPROVED_WITH_WARNINGS

Output to: .phase-gates/design-review.gate
Use this exact format:

---
agent: adversary
phase: design-review
status: APPROVED_WITH_WARNINGS | REJECTED
findings:
  - severity: BLOCK|WARN
    finding: ...
    impact: ...
    required_fix: ...
  - severity: BLOCK|WARN
    finding: ...
    impact: ...
    required_fix: ...
  - severity: BLOCK|WARN
    finding: ...
    impact: ...
    required_fix: ...
---
```

### Adversary — Code Review

```
You are the Adversary reviewer. Your ONLY job is to find divergences between the
design spec and the implementation.

Read ONLY these files:
  - docs/specs/DESIGN.md
  - .phase-gates/design.gate  (original spec fingerprint)
  - .phase-gates/build.gate   (files changed list)
  - [the actual changed files listed in build.gate]

Instructions:
- Find EXACTLY 3 things that are wrong with the implementation relative to the spec.
- Focus on: missing requirements, spec violations, security gaps, untested behavior.
- Do NOT comment on style or formatting.
- Do NOT say what is implemented correctly.

For each finding, write:
  severity: BLOCK | WARN
  finding: [what specifically diverges]
  spec_ref: [which part of DESIGN.md this violates]
  required_fix: [one concrete action]

Decision rule (no exceptions):
  - Any BLOCK → status: REJECTED
  - All WARN  → status: APPROVED_WITH_WARNINGS

Output to: .phase-gates/code-review.gate using the same format as design-review.gate
  (replace phase: design-review → phase: code-review)
```

### Scribe — Session End

```
You are the Scribe. Your job is to record — not decide.

Read these files (read ALL of them; if a file is missing, note it as a gap):
  - .phase-gates/*.gate  (all files in .phase-gates/)
  - docs/deferred/DEFERRED.md  (may not exist yet — create if missing)
  - docs/audit/AUDIT_LOG.jsonl  (may not exist yet — create if missing)

Tasks (execute in this order):

TASK 1 — Write SESSION_PATCH.md entry
  Append to docs/sessions/SESSION_PATCH.md:
  - Sprint ID and one-line outcome
  - Files modified (from build.gate)
  - Verify evidence (from verify.gate)
  - Agent review results (from design-review.gate, code-review.gate)
  - Spec drift finding (from qc.gate)
  - What's next
  DO NOT invent content. Only write what you read from gate files.

TASK 2 — Scan for deferred items
  Read all gate files. Find any phrase matching: "later", "deferred", "future sprint",
  "out of scope", "TODO", "TBD", "next sprint", "will handle", "not in scope".
  For each phrase found:
    - Extract the surrounding sentence as "What"
    - Note which gate file it came from
    - Assign a DEFERRED-NNN ID (increment from highest existing ID in DEFERRED.md)
    - Append to docs/deferred/DEFERRED.md using the schema below

TASK 3 — Audit log entry
  Append one JSON line to docs/audit/AUDIT_LOG.jsonl per significant event:
  (phase transitions, agent reviews, deferred items found, spec drift)

TASK 4 — Write session.gate
  Write .phase-gates/session.gate:
    status: COMPLETE
    session_patch_updated: true|false
    deferred_items_found: N
    audit_entries_written: N
    gaps: [list any missing gate files]

Do NOT modify any files except SESSION_PATCH.md, DEFERRED.md, AUDIT_LOG.jsonl,
and session.gate.
```

### Scribe — Session Start (Deferred Scan)

```
You are the Scribe. This is a session-start deferred scan.

Read: docs/deferred/DEFERRED.md

For each item with status: OPEN:
  1. Count sessions_open (increment by 1 for this session)
  2. Check if trigger_condition is met for this session
     (read the trigger_condition text and evaluate against current context:
      branch name, sprint ID if known, or explicit date if given)
  3. Output a summary

Output format:
  triggered: [list of DEFERRED-NNN IDs where trigger is met — need mini-plan]
  warning:   [list of DEFERRED-NNN IDs where sessions_open > 3]
  monitoring:[list of remaining OPEN items]

If triggered is non-empty: for each triggered item, write a mini-plan entry to
  .phase-gates/deferred-plan.md with:
    item_id: DEFERRED-NNN
    what: [copy from DEFERRED.md]
    estimated_size: [copy from DEFERRED.md]
    suggested_sprint: [append to current sprint or new sprint]

This output is for the main session to read and act on — not for you to act on.
```

### Scope Guard — QC + POST-REVIEW

```
You are the Scope Guard. Your job is to verify the implementation matches the
original design spec and has not drifted.

Read these files:
  - docs/specs/DESIGN.md         (current spec)
  - .phase-gates/design.gate     (original fingerprint — sha256 at design-complete time)
  - .phase-gates/verify.gate     (test evidence)
  - .phase-gates/code-review.gate (Adversary findings)
  - .phase-gates/build.gate      (files changed)

Step 1 — Spec drift check:
  Compute sha256 of current docs/specs/DESIGN.md.
  Compare to spec_hash in .phase-gates/design.gate.
  If different → spec_drift: true. Note what section appears to have changed
  (read both and describe the delta — do not just flag the hash mismatch).

Step 2 — AC coverage check:
  Read the Acceptance Criteria section of DESIGN.md.
  For each criterion, check verify.gate for evidence it was tested.
  List: covered / not_covered / partial.

Step 3 — Adversary finding resolution check:
  Read code-review.gate. For each BLOCK finding: verify it appears resolved
  (check the changed files listed in build.gate — does the fix exist?).
  If a BLOCK finding exists with no evidence of resolution → add to blockers.

Decision rule:
  - spec_drift: true AND unexplained → status: BLOCKED
  - Any unresolved BLOCK from code-review → status: BLOCKED
  - AC coverage gap (any criterion not_covered) → status: BLOCKED
  - All clear → status: CLEAR

Output to .phase-gates/qc.gate (QC phase) or .phase-gates/post-review.gate (POST-REVIEW):
---
agent: scope-guard
phase: qc | post-review
status: CLEAR | BLOCKED
spec_drift: true | false
spec_drift_delta: [description if true]
ac_coverage:
  covered: [list]
  not_covered: [list]
  partial: [list]
blockers: [list — empty if CLEAR]
---
```

### Audit Logger — RETRO

```
You are the Audit Logger. Your job is to create durable records.

Read ALL .phase-gates/*.gate files for this sprint.

Task 1 — Finalize AUDIT_LOG.jsonl
  For each phase gate that exists, append a final summary line to
  docs/audit/AUDIT_LOG.jsonl if a RETRO entry for this sprint does not exist yet.
  Format: {"ts":"<ISO>","sprint":"<id>","phase":"retro","action":"sprint_complete",
           "gate_files_present":[...],"adversary_findings":N,"deferred_items":N}

Task 2 — add_lesson for each decision
  Read all gate files. For each decision, workaround, or constraint mentioned:
    - Call add_lesson with:
        lesson_type: "decision" | "workaround" | "guardrail"
        title: [one-line description]
        content: [what was decided and why]
        tags: ["amaw", "sprint:<id>", "<feature-area>"]
  Do NOT add_lesson for findings that were resolved — only for decisions that STAND.

Task 3 — Write retro.gate
  Write .phase-gates/retro.gate:
    status: COMPLETE
    lessons_added: N
    audit_entries: N
```

---

## DEFERRED.md Schema

```markdown
# Deferred Items

<!-- Managed by Scribe. Do not edit manually. -->
<!-- Next ID: NNN -->

## DEFERRED-001

- **What:** [Description of the deferred item — specific enough to act on]
- **Why deferred:** [Reason — scope, time, dependency, or explicit decision]
- **Trigger condition:** [Specific condition to pick this up — MUST be concrete, not "later"]
  Examples: "Before Sprint 13.2 merge", "When Phase 13 E2E suite passes",
            "If rate-limiting becomes a reported issue", "2026-06-01"
- **Estimated size:** XS | S | M | L
- **Priority:** HIGH | MED | LOW
- **Session deferred:** YYYY-MM-DD
- **Sessions open:** 1
- **Status:** OPEN | RESOLVED | ABANDONED
- **Source:** [gate file and phrase that triggered this entry]

---
```

**Lifecycle rules:**

| Event | Action |
|-------|--------|
| Sessions open increments to 4 | Scribe writes WARNING to AUDIT_LOG + flags in SESSION_PATCH |
| Trigger condition is met | Scribe writes mini-plan to `.phase-gates/deferred-plan.md` |
| Item is implemented | Main session sets Status: RESOLVED + sprint reference |
| Deliberate abandon | Main session sets Status: ABANDONED + reason (must be explicit) |
| ABANDONED without reason | Scribe treats as OPEN (abandoned-without-reason is OPEN) |

---

## AUDIT_LOG.jsonl Schema

One JSON object per line. Append-only — never modify existing lines.

```jsonl
{"ts":"2026-05-14T10:00:00Z","sprint":"phase-13-s13.1","phase":"design","agent":"main","action":"design_complete","artifact":"docs/specs/DESIGN.md","spec_hash":"abc123def456"}
{"ts":"2026-05-14T10:05:00Z","sprint":"phase-13-s13.1","phase":"design-review","agent":"adversary","action":"review","status":"APPROVED_WITH_WARNINGS","findings_count":3,"block_count":0,"warn_count":3}
{"ts":"2026-05-14T10:30:00Z","sprint":"phase-13-s13.1","phase":"build","agent":"main","action":"deferred_detected","ref":"DEFERRED-004","trigger":"before sprint 13.2 merge","source":"plan.gate"}
{"ts":"2026-05-14T11:00:00Z","sprint":"phase-13-s13.1","phase":"code-review","agent":"adversary","action":"review","status":"REJECTED","findings_count":3,"block_count":1,"warn_count":2}
{"ts":"2026-05-14T11:15:00Z","sprint":"phase-13-s13.1","phase":"code-review","agent":"adversary","action":"review","status":"APPROVED_WITH_WARNINGS","findings_count":3,"block_count":0,"warn_count":3,"note":"re-review after block resolved"}
{"ts":"2026-05-14T11:30:00Z","sprint":"phase-13-s13.1","phase":"qc","agent":"scope-guard","action":"qc","status":"CLEAR","spec_drift":false,"ac_covered":12,"ac_not_covered":0}
{"ts":"2026-05-14T11:35:00Z","sprint":"phase-13-s13.1","phase":"retro","agent":"audit-logger","action":"sprint_complete","lessons_added":3}
```

---

## workflow-gate.sh Extension Spec

The current script checks `.workflow-state.json` phase state. Add these three functions:

### check_gate_file_exists

```bash
check_gate_file_exists() {
  local phase="$1"
  local gate_file=".phase-gates/${phase}.gate"
  if [[ ! -f "$gate_file" ]]; then
    echo "GATE FAIL: ${gate_file} does not exist."
    echo "Main session must write this file before marking phase ${phase} complete."
    exit 1
  fi
}
```

### check_agent_review_approved

```bash
check_agent_review_approved() {
  local review_gate="$1"   # e.g. ".phase-gates/design-review.gate"
  if [[ ! -f "$review_gate" ]]; then
    echo "GATE FAIL: Agent review gate missing: ${review_gate}"
    exit 1
  fi
  if grep -q "status: REJECTED" "$review_gate"; then
    echo "GATE FAIL: Agent review REJECTED — fix issues before proceeding."
    echo "Review gate: ${review_gate}"
    grep "finding:" "$review_gate" | head -5
    exit 1
  fi
  if grep -q "status: BLOCKED" "$review_gate"; then
    echo "GATE FAIL: Scope Guard BLOCKED — resolve blockers before proceeding."
    grep "blockers:" "$review_gate"
    exit 1
  fi
}
```

### check_deferred_updated (SESSION phase only)

```bash
check_deferred_updated() {
  if [[ ! -f "docs/deferred/DEFERRED.md" ]]; then
    echo "GATE FAIL: docs/deferred/DEFERRED.md missing."
    echo "Scribe must run and update deferred items before SESSION is complete."
    exit 1
  fi
}
```

### Phase gate command additions

Extend the `complete <phase>` command to call the appropriate checks:

```
complete design     → check_gate_file_exists design
                    → check_agent_review_approved .phase-gates/design-review.gate
complete verify     → check_gate_file_exists verify
                    → grep exit_code .phase-gates/verify.gate | check_exit_code_zero
complete review     → check_gate_file_exists code-review
                    → check_agent_review_approved .phase-gates/code-review.gate
complete qc         → check_gate_file_exists qc
                    → check_agent_review_approved .phase-gates/qc.gate
complete post-review→ check_gate_file_exists post-review
                    → check_agent_review_approved .phase-gates/post-review.gate
complete session    → check_gate_file_exists session
                    → check_deferred_updated
complete retro      → check_gate_file_exists retro
```

---

## Spec Fingerprint Protocol

At DESIGN complete, main session writes to `.phase-gates/design.gate`:

```
phase: design
status: COMPLETE
spec_path: docs/specs/DESIGN.md
spec_hash: <sha256 of DESIGN.md at time of writing>
spec_hash_computed_at: 2026-05-14T10:00:00Z
```

**Computing the hash (bash):**
```bash
sha256sum docs/specs/DESIGN.md | awk '{print $1}'
```

**At QC phase**, Scope Guard re-hashes and compares. If hashes differ:
- `spec_drift: true` in qc.gate
- Scope Guard describes what appears to have changed
- Main session must explicitly acknowledge the drift: intended change or scope creep

**If intended change:** Main session updates spec hash in design.gate with note:
```
spec_hash_updated: <new hash>
spec_hash_update_reason: "Added renew_artifact tool — in-scope extension"
```

**If scope creep:** Stop. Reclassify task size. Announce to audit log.

---

## Context Budget Guard

A proxy for context growth. No window measurement needed.

**Rule:** If main session is in BUILD phase and has completed 3+ tasks from PLAN.md without writing a gate file or spawning an agent → spawn Scribe with "checkpoint" task.

**Checkpoint Scribe task:**
```
You are the Scribe running a mid-BUILD checkpoint.

Read:
  - docs/plans/PLAN.md (the current plan)
  - .phase-gates/build.gate (if exists)

Task 1: List tasks completed vs remaining per the plan.
Task 2: Check if any deferred items were mentioned in build.gate.
Task 3: Write a checkpoint entry to docs/audit/AUDIT_LOG.jsonl.
Task 4: Update .phase-gates/build.gate with current completed_tasks count.

Output summary to main session: N tasks done, M remaining, K deferred items found.
```

---

## Anti-Consensus Mechanisms

When two sub-agents review the same artifact, use different framing prompts to prevent them from agreeing for the wrong reasons.

**Default (single Adversary):** Sufficient for most sprints.

**High-stakes review (auth, tenant isolation, destructive ops, new service boundary):** Spawn two Adversary instances with different framing:

- Adversary A prompt: `"You are a security auditor. Find attack vectors and data leaks."`
- Adversary B prompt: `"You are the engineer who will maintain this code in 12 months. Find what will be confusing or break silently."`

If both return APPROVED → high confidence. If they disagree → conservative wins (any BLOCK from either = REJECTED).

---

## Failure Modes & Mitigations

| Failure mode | Symptom | Mitigation |
|---|---|---|
| **Context rot** | Main session forgets earlier decisions | Scribe writes decisions to gate files; main session reads MCP at each phase start |
| **Hallucinated compliance** | Main session claims test passed without evidence | verify.gate requires raw exit code; workflow-gate.sh rejects missing exit code |
| **Deferred-but-forgotten** | "Later" item never picked up | Scribe detects deferred phrases; DEFERRED.md with sessions_open counter |
| **Scope creep** | Implementation quietly exceeds spec | Spec fingerprint in design.gate; Scope Guard checks at QC |
| **Adversary rubber-stamp** | Review agent says "looks good" | Adversary prompt requires exactly 3 findings with no positive framing allowed |
| **Sub-agent context bleed** | Sub-agent reads main conversation | Cold-start protocol: prompt specifies ONLY the files to read |
| **Consensus hallucination** | Two agents agree for wrong reasons | Anti-consensus framing (different perspectives) for high-stakes reviews |
| **Power creep via plan expansion** | Plan grows during BUILD without reclassification | Scribe context-budget checkpoint after 3 tasks; size reclassification rule |

---

## Acceptance Criteria (AMAW is working when...)

- [ ] Every sprint produces all required `.phase-gates/*.gate` files
- [ ] workflow-gate.sh blocks on any REJECTED or BLOCKED gate file
- [ ] `docs/deferred/DEFERRED.md` exists and is updated every sprint
- [ ] No "later" mention appears in gate files without a corresponding DEFERRED entry
- [ ] `docs/audit/AUDIT_LOG.jsonl` has at least one entry per phase per sprint
- [ ] Spec fingerprint is written at DESIGN and checked at QC
- [ ] Adversary findings always number exactly 3 (never 0, never vague)
- [ ] MCP has `add_lesson` entries for decisions from each sprint (searchable in future sessions)
- [ ] Sessions-open counter in DEFERRED.md increments correctly across sessions

---

## Changelog

| Version | Date | Change |
|---------|------|--------|
| 1.0 | 2026-05-14 | Initial spec — supersedes v2.2 Phase 9 human-in-loop |
