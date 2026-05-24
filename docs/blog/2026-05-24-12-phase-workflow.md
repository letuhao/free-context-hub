# The 12-Phase Workflow That Actually Made AI Coding Useful for Me

*A practitioner's account — not a tutorial, not a sales pitch.*

---

I've shipped software with AI coding assistants across many projects, accumulating over 2,500 commits. In that time I've tried most of the popular "AI workflow" patterns: raw prompting, skeleton-driven iteration, test-first generation, the works. Most of them are fine for throwaway scripts. For production systems with real complexity — multi-service backends, evolving data schemas, security-sensitive paths — they tend to collapse around the second or third sprint.

This post is about the workflow I settled on: a 12-phase, human-in-the-loop structure that I've been refining and using to deliver real features. I want to share it because it works well for me, and because most of what's written about AI coding workflows skips the hard part: **what do you do when the AI is confidently wrong?**

The files are in this repository: [`docs/WORKFLOW.md`](../WORKFLOW.md) and the full spec is embedded in [`CLAUDE.md`](../../CLAUDE.md) at the project root.

---

## The Core Problem This Solves

AI coding assistants are very good at generating plausible-looking code. They're much worse at:

1. Knowing when they're operating on stale assumptions
2. Catching their own scope creep
3. Connecting a code change to its downstream contract obligations
4. Stopping themselves when a "small fix" turns into a refactor

The standard advice is "just review the diff." But reviewing a diff without having tracked the *intent* of the change is almost useless — you're comparing code to code, not code to requirements. The 12-phase workflow forces intent to be written down before the first line of code is written, which is what makes the diff review actually meaningful.

---

## Where It Came From

The workflow is an evolution of two ideas:

**[Superpowers](https://github.com/obra/superpowers)** — a coding agent discipline framework that introduced TDD protocol, the evidence gate (run verification fresh before claiming success), and the debugging protocol (no fix without root cause). I absorbed these directly into the workflow. If you haven't read Superpowers, it's worth your time.

**Human-in-the-loop gatekeeping** — my own addition. The core insight: a human reading a short spec + a single diff catches dramatically more than a human reading code cold. So the workflow structures every task to produce exactly those artifacts, at exactly the right moment.

The combination took me about 8 months of iteration to stabilize. The version in this repo is v2.2 (default mode) with an optional AMAW multi-agent extension for high-stakes work.

---

## The 12 Phases

```
Phase          │ Role                  │ What Happens
───────────────┼───────────────────────┼──────────────────────────────────────────
1. CLARIFY     │ Architect + Human     │ Read context, write spec, expose assumptions
2. DESIGN      │ Lead                  │ API contract / data flow → DESIGN.md
3. REVIEW      │ Adversarial self      │ Find gaps / contract holes in spec
4. PLAN        │ Lead + Developer      │ Decompose into 2–5 min tasks → PLAN.md
5. BUILD       │ Developer             │ TDD: red → green → refactor
6. VERIFY      │ Developer             │ Run tests fresh, capture exit code + output
7. REVIEW      │ Lead                  │ Code vs spec — find exactly 3 divergences
8. QC          │ QA / PO               │ Spec fingerprint vs implementation, AC coverage
9. POST-REVIEW │ Human checkpoint      │ Final gate — blocked on any unresolved issue
10. SESSION    │ Scribe                │ SESSION_PATCH.md + DEFERRED.md + AUDIT_LOG
11. COMMIT     │ Developer             │ Git commit
12. RETRO      │ All                   │ add_lesson to knowledge layer + finalize audit
```

The phases look heavy on paper. In practice, for an XS task (single file, one logic change, no side effects) you're allowed to skip CLARIFY and PLAN and go straight to BUILD — the workflow is explicit about this via a mandatory **task size classification** step.

---

## Task Size Classification: The Thing That Actually Prevents Drift

Before any work starts, you count three things:

| Metric | What you count |
|---|---|
| **Files touched** | How many files will be created or modified? |
| **Logic changes** | How many functions/handlers change *behavior*? (not formatting) |
| **Side effects** | API contract, DB schema, config, external behavior, types used by other files? |

| Size | Files | Logic | Side effects | Allowed skips |
|---|---|---|---|---|
| **XS** | 1 | 0–1 | None | CLARIFY + PLAN |
| **S** | 1–2 | 2–3 | None | PLAN only |
| **M** | 3–5 | 4+ | Maybe | None |
| **L** | 6+ | Any | Yes | None |
| **XL** | 10+ | Any | Yes | None |

You state the classification explicitly before work begins:

```
Task: Fix pagination off-by-one
Size: XS (1 file: src/api/routes/lessons.ts, 1 logic change: offset calc, 0 side effects)
Skipping: CLARIFY, PLAN → straight to BUILD
```

The hard rule: **if you haven't read the code yet, you don't know the size.** Agents routinely call things XS that turn out to be M or L once you look. The classification forces the read to happen before the label is applied.

---

## The Anti-Skip Rules (The Most Underrated Part)

Every popular AI workflow has phases that agents skip "to save time." This workflow makes the skip patterns explicit and calls them violations:

| Skip pattern | Why agents do it | Why it's forbidden |
|---|---|---|
| Skip CLARIFY, jump to BUILD | "Task seems obvious" | Unexamined assumptions cause rework |
| Skip PLAN, jump to BUILD | "It's a small change" | Small changes grow; no plan = no checkpoint |
| Skip VERIFY after BUILD | "Tests passed earlier" | Stale results are not evidence |
| Skip REVIEW after VERIFY | "I wrote it, I know it's correct" | Author blindness is real |
| Skip POST-REVIEW | "I reviewed in phase 7" | Phase 7 is code review; POST-REVIEW is the final conservative gate |
| Skip SESSION before COMMIT | "I'll update later" | You won't. Context is lost. |

Naming these patterns and treating them as violations changes the conversation. When the agent tries to jump phases, you have a handle to point at.

---

## The Evidence Gate (Absorbed from Superpowers)

Phase 6 (VERIFY) has a 5-step gate that runs before any completion claim:

1. **Identify** the verification command
2. **Run** it fresh — not from memory, not from cache
3. **Read** complete output including exit codes
4. **Confirm** output matches the claim
5. **Only then** state the result with evidence

Red flags — stop immediately if you catch yourself:
- Using "should work", "probably passes", "seems fine"
- Feeling satisfied before running verification
- About to commit without a fresh test run
- Trusting prior output without re-running

This sounds obvious. It is not obvious when you're deep in a session and the previous test run was 20 minutes ago.

---

## The Human's Role: Gatekeeper, Not Reviewer

In v2.2 (default mode), there are two mandatory human checkpoints:

1. **After CLARIFY** — human reads the spec and approves the scope before any design or code starts
2. **After POST-REVIEW** — human reviews the AUDIT_LOG summary + diff before the SESSION phase commits anything

These are not optional. The whole model is that the human reads a short spec, not a long codebase. The AI builds the spec; the human approves it; the AI builds the code against the approved spec. The POST-REVIEW diff is then code-vs-approved-spec, which is a comparison a human can actually do.

---

## AMAW: The Opt-In Multi-Agent Extension

For high-stakes work — data migrations, new service boundaries, security-critical paths — there's an optional extension called AMAW (Autonomous Multi-Agent Workflow). Instead of a human at the review gates, you spawn cold-start sub-agents:

- **Adversary** — finds exactly 3 things that could go wrong. Never says what's good.
- **Scope Guard** — compares spec fingerprint vs implementation, checks AC coverage, issues CLEAR or BLOCKED
- **Scribe** — records decisions, writes session summaries, detects deferred items
- **Audit Logger** — finalizes the audit trail at RETRO

The key insight is **cold-start sub-agents**: each agent is spawned fresh with only file access. It cannot inherit the main session's context rot or biases. It reads what's written; it can't be influenced by what was discussed in chat.

AMAW costs roughly $1–5 in sub-agent tokens and ~30 extra minutes per task. I use it for schema migrations and multi-system contracts. For everyday work, the human-in-loop default catches the same issues faster and cheaper.

---

## What Gets Recorded: The Audit Log

Every phase transition and agent verdict appends to `docs/audit/AUDIT_LOG.jsonl` — one JSON line per event:

```json
{"ts":"2026-05-15T17:42:00Z","task":"phase-14-model-swap","phase":"review-design","agent":"adversary","action":"review","status":"REJECTED","findings_count":3,"block_count":2,"warn_count":1,"note":"..."}
```

Append-only. Never modified. Main session and sub-agents both write to it, but never delete or edit existing lines.

This becomes the durable record of what was decided and why — something that doesn't exist in most AI coding setups where everything is ephemeral chat.

---

## What I've Shipped With This

Using this workflow across projects I've delivered:

- 15 development phases covering core backend (MCP, REST API), frontend (20+ pages in Next.js), RAG pipeline with reranking benchmarks, multi-agent coordination protocols, knowledge portability, and tenant-scoped access control
- 2,500+ commits, most of them structured with phase tags and evidence logs
- A running audit trail that let me diagnose context drift across sessions months apart

The hardest part was Phase 10 (SESSION) — keeping the session patch updated after every sprint without skipping it. Once that became a habit, sessions started to feel continuous rather than amnesia-punctuated.

---

## The Real Pros

**You understand your own system deeply.** Because you write the spec and approve it, you can't hide behind "the AI built it." You actually know what was built and why the trade-offs were made.

**Delivery quality is high.** Every architectural decision has a written rationale. Every code change has a spec it was validated against. Review diffs are meaningful because the intent was written before the code.

**Context drift is visible.** When an AI starts building something that wasn't in the spec, the spec fingerprint comparison catches it. Without a written spec, you'd never notice.

**Deferred items don't get lost.** The workflow forces any "we'll do this later" to be written in `DEFERRED.md` with a trigger condition. Nothing lives only in chat.

**It's incrementally adoptable.** You can start with just CLARIFY + VERIFY and get substantial value. Add the other phases as your trust in the workflow grows.

---

## The Real Cons

**Token usage is high.** Each phase generates artifacts (spec files, plan files, audit events). AMAW mode multiplies this by spawning sub-agents. A single M-sized task with AMAW can run 5,000–10,000 tokens before you write a line of code. If you're paying per token and doing high volume, this adds up fast.

**You clarify constantly.** Phase 1 (CLARIFY) is not a formality. For any task with real ambiguity — and most tasks above XS size have real ambiguity — you end up in a back-and-forth that can take 15–30 minutes before design starts. This is actually the point, but it feels slow if you're used to "just build it."

**Less automation.** Human checkpoints at CLARIFY and POST-REVIEW mean you can't fire and forget. Architecture decisions, trade-off choices, scope calls — all of these require your explicit approval. If you want fully autonomous operation, this workflow is not designed for that. It's designed for cases where you care about the outcome.

**The discipline is fragile without tooling.** The workflow is enforced by a `workflow-gate.sh` script and an append-only audit log. Without these, agents will skip phases. The first time you try this without the enforcement layer, you'll get a "completed" task that skipped VERIFY and POST-REVIEW. The tooling matters.

**Cold-start cost.** Every AMAW sub-agent reads files from scratch. There's no shared context. For a Phase 7 code review, the Adversary reads the spec, the design, and the diff — all fresh. This is also its strength, but it means sub-agents can miss things that were explained in chat and never written down.

---

## Who This Is For

This workflow is worth the overhead if:

- You're building production systems, not prototypes
- You care about knowing why each decision was made, not just that it compiles
- You work on a codebase that will outlast any single session
- You find yourself surprised by what the AI built, in ways that cost you rework

It's overkill if:

- You're doing exploratory coding or one-shot scripts
- Your sessions are short and the full context fits in one window
- You don't need an audit trail or human control over architectural decisions

---

## How to Use It

The full workflow is in this repository:

- **[`docs/WORKFLOW.md`](../WORKFLOW.md)** — standalone workflow spec you can copy into any project
- **[`docs/amaw-workflow.md`](../amaw-workflow.md)** — full AMAW spec with sub-agent prompt templates
- **[`CLAUDE.md`](../../CLAUDE.md)** — the live project instructions that embed the workflow with project-specific context

To adopt it:

1. Copy `docs/WORKFLOW.md` into your project root or paste the relevant sections into your `CLAUDE.md` / agent instructions
2. Customize the `[CUSTOMIZE]` sections for your project (tech stack, verification commands, MCP tools if applicable)
3. Start with the **task size classification** — that alone will change how you work with AI agents
4. Add one phase at a time; you don't need to adopt all 12 at once

The workflow is model-agnostic. I use it with Claude Code but there's nothing in the spec that requires it.

---

## Final Thought

The 12-phase workflow is not magic. It's a way of making explicit things that were always implicit: what are we building, how big is it, what's the verification evidence, who approved it, what did we learn? The AI does most of the work. The human stays in control of the decisions that matter.

For me, that's the right balance. Two and a half thousand commits later, it still is.

---

*Repository: [letuhao/free-context-hub](https://github.com/letuhao/free-context-hub)*  
*Full workflow files: [`docs/WORKFLOW.md`](../WORKFLOW.md) · [`docs/amaw-workflow.md`](../amaw-workflow.md) · [`CLAUDE.md`](../../CLAUDE.md)*
