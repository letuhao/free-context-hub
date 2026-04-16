# Agent Workflow v2

> A structured development workflow for AI coding agents. Combines the best of [Superpowers](https://github.com/obra/superpowers) (execution discipline, TDD, verification gates) with session persistence, role-based review, and knowledge-driven guardrails.
>
> **How to use:** Copy this file into your project root or paste the relevant sections into your `CLAUDE.md` / agent instructions. Customize the `[CUSTOMIZE]` sections for your project.

---

## Task Workflow (11 phases)

Every task follows this workflow. The agent plays all roles sequentially.

```
Phase      | Role              | What Happens
-----------|-------------------|----------------------------------------------
1. CLARIFY | Architect + PO    | Brainstorm, ask questions, define scope
2. DESIGN  | Lead              | API contract / component API / data flow
3. REVIEW  | PO + Lead         | Review design spec before coding
4. PLAN    | Lead + Developer  | Decompose into bite-sized tasks (2-5 min)
5. BUILD   | Developer         | Write code (TDD: red -> green -> refactor)
6. VERIFY  | Developer         | Evidence-based verification gate
7. REVIEW  | Lead              | Code review (spec compliance + quality)
8. QC      | QA / PO           | Test against acceptance criteria
9. SESSION | Developer         | Update session notes + task status
10. COMMIT | Developer         | Git commit (+ push if approved)
11. RETRO  | All               | Record decision/workaround if learned
```

**Status tracking:** `[ ]` not started · `[C]` clarify · `[D]` design · `[P]` plan · `[B]` build · `[V]` verify · `[R]` review · `[Q]` QC · `[S]` session · `[✓]` done

**Task types:** `[FE]` frontend · `[BE]` backend · `[FS]` full-stack

---

## Task Size Classification (MANDATORY)

Agents misjudge task size. They call things "small" to skip phases. This protocol removes subjectivity.

**Before starting any task, count 3 things:**

| Metric | How to count |
|--------|-------------|
| **Files touched** | How many files will be created or modified? |
| **Logic changes** | How many functions/methods/handlers will change behavior? (not formatting) |
| **Side effects** | Does it change: API contract, DB schema, config, external behavior, types used by other files? |

**Classification (objective, not negotiable):**

| Size | Files | Logic | Side effects | Allowed skips |
|------|-------|-------|--------------|---------------|
| **XS** | 1 | 0-1 | None | CLARIFY + PLAN |
| **S** | 1-2 | 2-3 | None | PLAN only |
| **M** | 3-5 | 4+ | Maybe | None |
| **L** | 6+ | Any | Yes | None. Write plan file. |
| **XL** | 10+ | Any | Yes | None. Write spec + plan. Subagent recommended. |

**State it explicitly before work begins:**
```
Task: Fix pagination off-by-one
Size: XS (1 file, 1 logic change, 0 side effects)
Skipping: CLARIFY, PLAN -> straight to BUILD
```

**Anti-gaming rules:**
- The script validates counts vs claimed size — **cannot undersize**
- If you haven't read the code yet, **you don't know the size** — don't classify
- If during BUILD you discover it's larger — **STOP, reclassify, resume correct phase**

**NOT XS (agents commonly misjudge these):**
- "Simple" CSS fix -> often touches multiple components = S or M
- "Quick" API rename -> changes contract, affects callers = M+
- "Small" bug fix -> if root cause unclear = M+ (debugging protocol)
- "Just add a field" -> migration + API + UI + types = L

---

## Role Perspectives

| Role | Thinks about... |
|------|-----------------|
| **Architect** | System boundaries, dependencies, scoping, impact analysis |
| **PO (Product Owner)** | User value, acceptance criteria, design sign-off, final QC |
| **Lead** | Technical design, plan quality, code review (patterns, security, a11y) |
| **Developer** | Correctness, TDD, efficiency, verification, session tracking |
| **QA** | What can break — edge cases, regression, acceptance criteria |

When playing each role, shift perspective accordingly. Don't just check boxes — think from that role's viewpoint.

---

## Phase Details

### Phase 1: CLARIFY (Brainstorming Protocol)

Don't jump into code — clarify first.

1. **Explore context** — read relevant files, docs, git history
2. **Ask ONE question at a time** — multiple choice preferred, never overwhelm
3. **Propose 2-3 approaches** with trade-offs after enough context
4. **Present design in sections** — scale to complexity (few sentences to 300 words per section)
5. **Write spec file** to `docs/specs/YYYY-MM-DD-<topic>.md` for non-trivial tasks
6. **Self-review spec** — check for placeholders, contradictions, ambiguity, scope creep
7. **User approval gate** — do NOT proceed without user sign-off

> **Skip conditions:** Only for tasks classified **XS** (1 file, 0-1 logic, 0 side effects). If you haven't counted yet, you can't skip.

### Phase 2: DESIGN

- Define API contracts, component APIs, data flow diagrams
- Identify breaking changes and migration needs
- Consider error states, edge cases, backwards compatibility

### Phase 3: REVIEW (Design Review)

- PO: Does this meet acceptance criteria? Is scope right?
- Lead: Is the design sound? Any architectural concerns?
- Gate: Do NOT proceed to Phase 4 without sign-off

### Phase 4: PLAN (Task Decomposition)

Break work into executable chunks before coding.

- Decompose into **bite-sized tasks (2-5 minutes each)**
- Each task specifies: **exact file paths, code intent, verification command**
- **No placeholders allowed** — no "TBD", "TODO", "add error handling here"
- For large tasks (>5 files), write plan to `docs/plans/YYYY-MM-DD-<feature>.md`
- Self-review: spec coverage, placeholder scan, type/signature consistency

**Execution mode** (for large plans):
| Mode | When | How |
|------|------|-----|
| **Inline** (default) | Most tasks | Execute sequentially with checkpoints |
| **Subagent dispatch** | Multi-file, independent tasks | Fresh agent per task + 2-stage review |

Subagent 2-stage review:
1. **Spec compliance** — does it match the design?
2. **Code quality** — patterns, security, performance
3. Never skip either stage; never proceed with unfixed issues

> **Skip conditions:** Only for tasks classified **XS** or **S**. If S, CLARIFY is still required.

### Phase 5: BUILD (TDD Discipline)

For each task in the plan:

```
1. RED    — Write a failing test (must fail for the right reason)
2. GREEN  — Write minimal code to pass (no more than needed)
3. REFACTOR — Clean up while tests stay green
4. COMMIT — Small, atomic commit
```

> **When TDD doesn't apply:** UI layout, config changes, docs, migrations — just build and verify.

### Phase 6: VERIFY (Evidence Gate)

**Evidence before claims, always.**

5-step gate before ANY completion claim:

| Step | Action |
|------|--------|
| 1. Identify | What command proves the claim? (test, build, lint, curl...) |
| 2. Run | Execute it fresh — not from memory or cache |
| 3. Read | Complete output including exit codes |
| 4. Confirm | Does output actually match the claim? |
| 5. Claim | Only now state the result, with evidence |

**Red flags — stop immediately if you catch yourself:**
- Using "should work", "probably passes", "seems fine"
- Feeling satisfied before running verification
- About to commit/push without fresh test run
- Trusting prior output without re-running

**Applies before:** success claims, commits, PRs, task handoffs, session notes.

### Phase 7: REVIEW (2-Stage Code Review)

| Stage | Focus |
|-------|-------|
| **1. Spec compliance** | Does code implement what was designed? Missing requirements? Scope creep? |
| **2. Code quality** | Patterns, security, a11y, performance, maintainability |

Both stages must pass. If issues found: fix → re-verify (Phase 6) → re-review.

### Phase 8: QC

- QA perspective: test against acceptance criteria
- Edge cases, error states, regression checks
- If QC fails: loop back to Phase 5 BUILD

### Phase 9: SESSION

<!-- [CUSTOMIZE] Change the file path to match your project's session tracking location -->

Update session notes after EVERY sprint completes. Don't batch.

What to include:
- Sprint number and one-line outcome
- New/modified files, migrations, commits
- Review issues found and how fixed
- Live test results (real stack, not mocked)
- What's next

### Phase 10: COMMIT

- Write clear commit message (what + why)
- `git commit` — small and atomic preferred
- Push only with user approval or pre-authorized rules

### Phase 11: RETRO

- If a non-obvious decision was made → record it (decision log, ADR, lesson, etc.)
- If a workaround was needed → record it with context so it can be revisited
- If nothing notable → skip this phase

---

## Debugging Protocol

Activated whenever a bug is encountered during any phase.

**Rule: NO FIXES WITHOUT ROOT CAUSE INVESTIGATION FIRST.**

```
Phase      | What Happens
-----------|----------------------------------------------
1. INVEST  | Read errors fully, reproduce, trace data flow backward
2. PATTERN | Find working examples, compare every difference
3. HYPOTHE | State hypothesis, test one variable at a time
4. FIX     | Write failing test -> implement single fix -> verify
```

**Hard stop:** If 3+ fix attempts fail → stop. Question the architecture. Discuss with user before continuing.

**Anti-patterns (never do these):**
- Propose fix before tracing data flow
- Attempt multiple fixes simultaneously
- Skip test creation for the bug
- Make assumptions without verification

---

## Git Workflow

| Task size | Strategy |
|-----------|----------|
| **Small** (1-3 files) | Work on current branch |
| **Large** (>5 files, >1 hour) | `git worktree` — isolated branch, clean baseline |

**Worktree protocol:**
1. Create worktree on new branch
2. Verify tests pass before starting (clean baseline)
3. On completion: present merge/PR/discard options to user
4. Clean up worktree after merge

---

## Test Workflow (for QC/E2E tasks)

Lighter workflow for writing tests (not features).

```
Phase     | What Happens
----------|----------------------------------------------
1. SETUP  | Install deps, shared utilities, verify infra
2. WRITE  | Write tests (one sprint at a time)
3. RUN    | Execute against live stack
4. FIX    | Triage: test bug vs real bug vs infra issue
5. REPORT | Results, session notes, commit
```

Repeat 2-5 per sprint.

**Status:** `[ ]` not started · `[S]` setup · `[W]` writing · `[R]` running · `[F]` fixing · `[✓]` done

**Failure triage:**
| Type | Example | Action |
|------|---------|--------|
| **Test bug** | Wrong selector, bad assertion | Fix the test |
| **Real bug** | Endpoint 500, wrong data | Fix product code, re-run |
| **Infra issue** | Docker not ready, service down | Mark `skip`, don't fail suite |

---

## Workflow Enforcement

Agents skip phases. These mechanisms prevent that.

### Layer 1: Anti-Skip Rules (in CLAUDE.md)

Add this to your CLAUDE.md alongside the workflow:

```markdown
### Anti-Skip Rules (MANDATORY)

**Common skip patterns — ALL are violations:**

| Skip pattern | Why agents do it | Why it's forbidden |
|---|---|---|
| Skip CLARIFY, jump to BUILD | "The task seems obvious" | Unexamined assumptions cause rework |
| Skip PLAN, jump to BUILD | "It's a small change" | Small changes grow; no plan = no checkpoint |
| Skip VERIFY after BUILD | "Tests passed earlier" | Stale results are not evidence |
| Skip REVIEW after VERIFY | "I wrote it, I know it's correct" | Author blindness is real |
| Skip SESSION before COMMIT | "I'll update later" | You won't. Context is lost |
| Combine multiple phases | "CLARIFY+DESIGN+PLAN in one go" | Phases exist to create pause points |

**The only allowed skips** are documented in each phase's "Skip conditions."
If a phase doesn't list skip conditions, it CANNOT be skipped.

**If you catch yourself about to skip — STOP, announce the skip attempt, ask the user.**
User can authorize skips explicitly — agent must never self-authorize.
```

### Layer 2: State Machine (`.workflow-state.json`)

Copy `scripts/workflow-gate.sh` to your project. The agent must call it at each phase transition:

```bash
# Start a new task
./scripts/workflow-gate.sh reset
./scripts/workflow-gate.sh phase clarify

# Complete a phase with evidence
./scripts/workflow-gate.sh complete clarify "user approved design with 2 questions"

# Move to next phase
./scripts/workflow-gate.sh phase design

# Skip a phase (must give reason — gets recorded)
./scripts/workflow-gate.sh skip plan "single file change, user authorized"

# Check status
./scripts/workflow-gate.sh status

# Pre-commit gate (blocks if verify/session not done)
./scripts/workflow-gate.sh pre-commit
```

State is tracked in `.workflow-state.json` (add to `.gitignore`). The script:
- **Blocks phase jumps** — can't go from CLARIFY to BUILD without completing/skipping intermediate phases
- **Records evidence** — what was the output of each phase
- **Records skips with reasons** — auditable trail of what was bypassed and why
- **Pre-commit gate** — blocks `git commit` if VERIFY and SESSION are not completed

### Layer 3: Claude Code Hooks (hardest enforcement)

Add to `.claude/settings.json`:

```json
{
  "hooks": {
    "PreToolUse": [
      {
        "matcher": "Bash",
        "hooks": [
          {
            "type": "command",
            "command": "bash -c 'if echo \"$CLAUDE_TOOL_INPUT\" | grep -qE \"git commit\"; then bash ./scripts/workflow-gate.sh pre-commit; fi'",
            "timeout": 10000,
            "description": "Block git commit if VERIFY or SESSION phases not completed"
          }
        ]
      }
    ]
  }
}
```

This hook runs BEFORE every Bash tool call. If the command contains `git commit`, it checks the workflow state. If VERIFY or SESSION phases are not completed, **the commit is blocked** and the agent sees an error message explaining what to do.

### How the 3 layers work together

```
Layer 1 (CLAUDE.md)     → Agent reads rules, knows skipping is forbidden
                           ↓ agent tries to skip anyway
Layer 2 (State machine)  → Script blocks the phase transition, shows error
                           ↓ agent tries to commit without verify
Layer 3 (Hook)           → Hook intercepts git commit, blocks it hard
```

Layer 1 alone works ~70% of the time. Adding Layer 2 gets to ~90%. Layer 3 catches the last ~10%.

---

## Quick Reference Card

```
CLARIFY → DESIGN → REVIEW → PLAN → BUILD → VERIFY → REVIEW → QC → SESSION → COMMIT → RETRO
   C         D        R        P       B        V        R       Q       S        ✓        ✓

Skip CLARIFY+PLAN: only XS (1 file, 0-1 logic, 0 side effects)
Skip PLAN only: XS or S (1-2 files, 0 side effects)
Skip TDD for: UI layout, config, docs, migrations
Hard stop debugging after: 3 failed fix attempts
Verify gate: run command → read output → then claim
```

---

## Credits

- **Session persistence, role perspectives, guardrails** — [free-context-hub](https://github.com/) project workflow (2024-2026)
- **Brainstorming, TDD, verification gate, debugging, subagent dispatch** — [Superpowers](https://github.com/obra/superpowers) by Jesse Vincent / Prime Radiant

---

*Last updated: 2026-04-16 — Workflow v2*
