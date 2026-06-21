---
description: Run a task in /warp parallel mode — decompose into provably-disjoint slices, fan them out as native worktree sub-agents, reconcile at a defined node, keep the human junction. For decomposable M/L/XL tasks where wall-clock matters. Falls back to serial /loom when the work can't be sliced independently.
---

# /warp — parallel-execution workflow mode (slim, harness-native)

`/warp` weaves a task as **parallel threads on the loom**: decompose the work into
**provably-disjoint slices**, fan them out as isolated worktree sub-agents running concurrently,
then **reconcile at a junction you control**. It is `/loom`'s 12-phase spine with 3 phases changed +
2 nodes inserted — **not** a new workflow.

> **This is the slim, repo-native variant.** The original `/warp` depended on a Python toolkit
> (`scripts/warp/*`, `workflow-gate.py slices`, `docs/warp/`, `docs/raid/`) that this repo does NOT
> have. This version drops all of that and uses the **harness's native primitives** instead —
> `Agent(isolation: "worktree", run_in_background: true)` per slice, or the `Workflow` tool for
> deterministic fan-out. The discipline (frozen interface, disjoint write-sets, human junction) is
> preserved; the machinery is gone. The serial spine + gate is [`/loom`](loom.md); read it first —
> `/warp` only changes the marked (`‡`/`＋`) steps.

**Argument** (optional): the task — free-text, a ticket/milestone id, or `continue`.

## When to invoke /warp — and when NOT

**Use it when** the work is **additive across ≥2 independent boundaries** (separate
modules/services, or many independent mechanical sites) AND the inter-slice contract can be **fully
frozen up front**. Best fit: a feature spanning several modules behind a contract; a mechanical
migration over many independent files.

**Do NOT use it** (take `/loom` instead) for:
- XS/S tasks — orchestration overhead dwarfs the win.
- **Refactors of a shared type/API** — they mutate a shared surface; slices aren't independent.
- Anything touching a **shared-write magnet** that can't be confined to one slice: the **migration
  sequence number** (`migrations/NNNN_*.sql` — only one slice may add migrations), the MCP tool
  registry (`src/mcp/index.ts`), the **`package.json` test list**, `src/env.ts`, shared service
  barrels, or the append-only docs (`SESSION_PATCH.md`, `DEFERRED.md`, `AUDIT_LOG.jsonl`).

**Bias to serial:** a missed parallelization costs some wall-clock; a *wrong* one costs merge hell +
wasted tokens + maybe a silent cross-module bug. When in doubt → `/loom`.

**Opt-in note:** invoking `/warp` IS your explicit opt-in to multi-agent orchestration (required
before the `Workflow` tool or a fan-out of background sub-agents).

## The phase flow

`/warp` runs `/loom`'s phases against the **single** `.workflow-state.json` orchestrator track; the
`‡`/`＋` steps are what differ. **Slices do NOT call the workflow-gate** — only this orchestrator does.

```
0.  TRIAGE-pre  ＋ Parallelization rubric — answer all four from the task + a quick scan:
                   (1) ≥2 independent boundaries?  (2) write-sets path-prefix disjoint?
                   (3) can the shared interface be FROZEN now?  (4) no shared-write magnet in a slice?
                   Any "no" → STOP, run /loom instead.
1.  CLARIFY        loom — scope + acceptance criteria. PO checkpoint at end (STOP + WAIT).
2.  DESIGN     ‡ BOUNDARY-FINDING. Produce three artifacts (in docs/specs/<task-slug>-warp.md):
                   (a) the FROZEN interface — settle every shared decision (types, signatures, the
                       one migration number, MCP registrations); nothing below may edit these files.
                   (b) the SLICE TABLE — one row per slice: id · label · writes[] (path prefixes,
                       proven pairwise-disjoint by inspection) · reads[] · acceptance.
                   (c) the MERGE PLAN — integrate order + reconcile evidence; on a write-set
                       conflict at merge: HALT_REDESIGN (the slicing was wrong, do not patch).
3.  REVIEW(des)‡ GO/NO-GO. Two gates, both must pass:
                   • Disjointness check (by hand): every pair of slice write-sets is path-prefix
                     disjoint, and no slice writes a frozen-interface file or a shared-write magnet.
                   • Cold-start Adversary on the SLICING (docs/amaw-workflow.md Adversary prompt,
                     read-only): hidden coupling? an under-declared `reads`? a magnet hiding in a
                     slice? → GO / NO-GO.
                   NO-GO → fall back to serial /loom BUILD in THIS session (CLARIFY/DESIGN not wasted).
4.  PLAN       ‡ Write one hermetic slice brief per slice (a short markdown block is fine); each
                   references ONLY the frozen interface + its own write-set. Zero cross-slice refs.
5.  BUILD      ‡ FAN-OUT (see coordinator flow below): N slice sub-agents, concurrent.
5.5 RECONCILE  ＋ Merge slice branches in integrate_order. By disjointness, expect ZERO write-set
                   conflicts. Run the full suite (`npm test` + `npx tsc --noEmit`). A real conflict
                   on a write-set ⇒ the slicing was wrong ⇒ HALT_REDESIGN.
6.  VERIFY        loom evidence gate — `npm test`, `tsc`, and (if ≥2 services touched) a live
                   `docker compose up -d --build` smoke IS the reconcile proof.
7.  REVIEW(code)  2-stage (spec compliance + quality); may fan out by DIMENSION (security/perf/
                   contract) via a cold-start Adversary per dimension.
8.  QC            loom / Scope Guard — diff vs the frozen interface + acceptance.
9.  POST-REVIEW   HUMAN STOP + WAIT — the junction you control (NOT auto). Suggest /review-impl for
                   load-bearing code (auth, tenant isolation, destructive ops, migrations, concurrency).
10. SESSION       Prepend a checkpoint to docs/sessions/SESSION_PATCH.md (name the slices + reconcile);
                   append an AUDIT_LOG.jsonl event. Land in the same commit.
11. COMMIT        Stage changed files only (no `git add -A`); message names slices + reconcile.
                   `check_guardrails` before any push; push only on explicit approval.
12. RETRO         add_lesson to ContextHub if connected, else a note in SESSION_PATCH.md.
```

## BUILD + RECONCILE — coordinator flow (harness-native)

```
You (main session) are the /warp COORDINATOR.

PRE-FLIGHT
  • COMMIT the DESIGN artifacts FIRST (frozen interface + slice table + briefs) so the worktree
    sub-agents are based on a HEAD that contains them. Uncommitted edits are invisible to a fresh
    worktree.  BASE = current HEAD after that commit.
  • `git worktree list` — confirm no stale warp worktrees linger before fan-out.

BUILD — fan out (one message, all slices, concurrent)
  Two options; pick ONE:

  (A) Background worktree sub-agents (default — simplest):
      For each slice, spawn in a SINGLE message so they run concurrently:
        Agent({ subagent_type: "general-purpose", isolation: "worktree",
                run_in_background: true,
                description: "<slice-label>",
                prompt: <hermetic brief: frozen interface (read-only) + THIS slice's write-set +
                         acceptance + "commit your work on a branch; return branch + commit sha +
                         a ≤200-word summary; do NOT edit any path outside your write-set"> })
      The harness gives each a fresh worktree off HEAD and auto-notifies on completion (no polling).

  (B) Workflow tool (deterministic fan-out / built-in reconcile):
      Use the `Workflow` tool with one stage that maps slices → agents (isolation:"worktree"),
      returning {branch, commit_sha, summary} per slice. Prefer this when you want a single
      structured result object and journaled resume.

  On each slice return:
    • DONE → record branch + commit_sha. Sanity-check it built on BASE:
        `git merge-base --is-ancestor <BASE> <branch>` (exit 0 = good). If non-zero, the worktree
        didn't base on HEAD → re-run that slice; do NOT reconcile a branch not descended from BASE.
    • A slice that needs to write OUTSIDE its declared write-set, or finds the frozen interface
      insufficient → that's a DESIGN signal: STOP, return to DESIGN (re-slice / re-freeze). Do NOT
      let it patch around the boundary.

RECONCILE (5.5)
  • Merge each DONE branch onto BASE in merge_plan integrate_order. Disjoint write-sets ⇒ no
    conflict expected. A conflict on a write-set ⇒ HALT_REDESIGN (the disjointness claim was false).
  • Run the FULL suite (`npm test` + `npx tsc --noEmit`); fix root cause in product code, never
    weaken a test. Rebuild touched images before a cross-service smoke (stale images false-green).

CLEANUP (after COMMIT)
  • `git worktree remove` each slice worktree; delete merged slice branches.
```

## The disjointness dividend

Reconcile is near-trivial **by construction**: you proved at REVIEW(des) that every slice's
write-set is path-prefix-disjoint and that no slice writes the frozen interface. So integrating N
branches touches N non-overlapping file sets — a sequential merge cannot conflict on them. If it
*does* conflict, that is not a merge to resolve — it is proof the slicing was wrong, so the response
is **HALT_REDESIGN**, not a patch.

**Caveat (the dividend's limit):** disjoint write-sets guarantee no *file* collision — NOT semantic
independence. A slice that under-declares a `reads` dependency can compile-then-break at merge with
zero file conflict. Catching that is the REVIEW(des) Adversary's job, not the disjointness check's.
"Disjoint", not "provably independent".

## Reuse map (this repo)

| Need | Asset |
|---|---|
| Serial spine + gate + size table | [`/loom`](loom.md) · `bash scripts/workflow-gate.sh` · `CLAUDE.md` |
| Cold-start Adversary / Scope Guard prompts | [`docs/amaw-workflow.md`](../../docs/amaw-workflow.md) |
| Parallel fan-out | native `Agent(isolation: "worktree", run_in_background)` or the `Workflow` tool |
| Human junction | [`/loom`](loom.md) POST-REVIEW |
| Durable record | `docs/specs/<task-slug>-warp.md` (frozen interface + slice table + briefs) |
| Session narrative / audit | `docs/sessions/SESSION_PATCH.md` · `docs/audit/AUDIT_LOG.jsonl` |

## Operational notes

- Run `bash scripts/workflow-gate.sh` from the **repo root** (one `.workflow-state.json` = the
  orchestrator's). Slices are stateless sub-agents that build + return; they don't call the gate.
- COMMIT the DESIGN before fan-out — a fresh worktree only sees committed HEAD.
- The **one-migration-per-warp** rule is absolute: migration sequence numbers are a shared-write
  magnet; at most one slice may add `migrations/NNNN_*.sql`, and that number is settled in the
  frozen interface.

## What /warp does NOT do

- Does NOT slice a task that can't be made independent — it **falls back to `/loom`** (same session).
- Does NOT skip phases or the PO checkpoints (CLARIFY end, POST-REVIEW are human STOPs).
- Does NOT auto-gate POST-REVIEW — the human controls the merge junction.
- Does NOT let a slice edit outside its write-set, the frozen interface, or a shared-write magnet.
- Does NOT push to origin without explicit approval (`check_guardrails` first).
