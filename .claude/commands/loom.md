---
description: Run the 12-phase v2.2 human-in-loop workflow on a task — classify size, then drive CLARIFY→…→RETRO with PO checkpoints and the workflow-gate. General-purpose, for any service/track.
---

# /loom — Run the human-in-loop 12-phase workflow

`/loom` weaves a task through the **12-phase v2.2 human-in-loop workflow**. The phases, roles, size table, and anti-skip rules live in **`CLAUDE.md` → "Task Workflow"** — that file is the SSOT; this command is just the invocation harness around it. `/loom` is **general-purpose**: it is NOT tied to any one feature, service, or track.

**Argument** (optional): what to work on — a free-text task, a ticket/milestone id, or `continue`.
- A task/id → scope the workflow to it.
- `continue` or empty → read the **latest checkpoint at the top of `docs/sessions/SESSION_PATCH.md`** (this repo's durable session narrative) and resume from its "What's next" items.

## The 12 phases
`CLARIFY → DESIGN → REVIEW → PLAN → BUILD → VERIFY → REVIEW → QC → POST-REVIEW → SESSION → COMMIT → RETRO`
- **PO checkpoints — STOP and WAIT for the human:** end of **CLARIFY** and at **POST-REVIEW**. On a multi-part effort these are **batched per-milestone** (one CLARIFY for the whole effort; POST-REVIEW at each shippable risk boundary), **not** per sub-task.
- Phases may be skipped **only** per the size-table allowances in `CLAUDE.md` (XS: CLARIFY+PLAN · S: PLAN). Never self-authorize a skip — STOP and ask.
- **Continuous-flow (2026-06-12):** size by **complexity+risk, not file count**, and classify the **whole effort** as ONE run. On ample context budget, drive straight through; checkpoint/commit at **risk boundaries** (contract, migration, cross-service seam, milestone) or when context >~80% — never fragment a coherent effort into N size→build→review→commit cycles.

## Process when /loom is invoked
1. **Scope** the task from the argument (or the ▶ NEXT block on `continue`/empty). State the task + its goal in one line.
2. **Classify size of the whole EFFORT** — from the **repo root only** (a subdir invocation splits the state file):
   `bash scripts/workflow-gate.sh size <XS|S|M|L|XL> <files> <logic> <side_effects>`
   ⚠️ This repo's gate takes **4 args** (no `context_pct`) and **validates against file count** — it
   will BLOCK if you classify smaller than the counts imply (`undersize` guard, `workflow-gate.sh`
   `cmd_size`). So pass honest counts; if a change is wide-but-mechanical, classify by the gate's
   rule (file count) and just drive straight through the cheap phases. See the `CLAUDE.md` size table.
3. **AMAW opt-in** when the task is **L+ and load-bearing**: data migrations, schema changes, tenant/isolation boundaries, security-critical paths, multi-system contracts. AMAW is **text-triggered** here (no `/amaw` command file installed) — announce "AMAW mode" and follow [`docs/amaw-workflow.md`](../../docs/amaw-workflow.md) (spawn cold-start Adversary/Scope Guard/Scribe sub-agents) before BUILD. Don't invoke for everyday work. *(If you want a real `/amaw` command, copy it from the source repo — ask.)*
4. **Enter CLARIFY** (`bash scripts/workflow-gate.sh phase clarify`); recover the acceptance criteria from the task's spec/plan row. **STOP at CLARIFY end** for the PO checkpoint (skip the stop only when resuming a phase already past it).
5. Drive the phases with the gate (`phase <name>` / `complete <name> "<evidence>"`). **VERIFY is an evidence gate** — run the command, read the full output, *then* claim. If the change touches **≥2 services**, the VERIFY evidence needs a **live-smoke token** (or `LIVE-SMOKE deferred to D-<NAME>` / `live infra unavailable: <reason>`).
6. **REVIEW (code)** is 2-stage (spec compliance + code quality). **At POST-REVIEW:** present a concise summary (files, decisions, verify evidence), **STOP and WAIT**. Proactively suggest **`/review-impl`** for load-bearing code (auth/credentials, tenant isolation, destructive ops, injection defenses, new service boundaries, concurrency, migrations).
7. **SESSION:** **prepend a checkpoint** to [`docs/sessions/SESSION_PATCH.md`](../../docs/sessions/SESSION_PATCH.md) (the durable narrative — sprint/milestone outcome, migrations, new/modified files, review fixes, live-test result, what's next). Also append a `phase_complete` event to [`docs/audit/AUDIT_LOG.jsonl`](../../docs/audit/AUDIT_LOG.jsonl). Land it in the **same commit** as the code.
8. **COMMIT:** stage only changed files (no `git add -A`); message names the phase/milestone + review fixes + test count. **Push only with explicit user approval.**
9. **RETRO:** non-obvious decisions or workarounds → `add_lesson` to ContextHub if the MCP server is connected, else a note in `SESSION_PATCH.md`. Skip if nothing notable.

## Operational notes
- Run `bash scripts/workflow-gate.sh` **from the repo root** — a subdir invocation splits the `.workflow-state.json`. (This repo has only the `.sh` gate; there is no `workflow-gate.py`.) Gate phase names: `clarify · design · review-design · plan · build · verify · review-code · qc · post-review · session · commit · retro`.
- This repo runs as **backend + worker + gui** containers (`docker-compose.yml`), not a wide monorepo. When a change must be verified **live**, rebuild the affected image(s) — `docker compose up -d --build` (stale-image false-greens are a real trap). Don't rebuild just to commit; batch deploys (CLAUDE.md § Git Workflow).
- `check_guardrails` before any `git push` (CLAUDE.md). The default is **trunk-based — commit to `main`**; branch/PR only for the reasons listed in CLAUDE.md § Git Workflow.

## What /loom does NOT do
- Does NOT skip phases or the PO checkpoints.
- Does NOT self-authorize a size/skip change — if the task turns out bigger than classified, STOP, reclassify, announce.
- Is NOT tied to any single track, service, or feature — scope comes from the argument or the handoff.
