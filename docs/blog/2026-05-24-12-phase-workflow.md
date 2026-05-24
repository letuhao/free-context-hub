# The 12-Phase Workflow That Actually Made AI Coding Useful for Me

*A practitioner's account — not a tutorial, not a sales pitch.*

---

**Quick screen:** if you're writing throwaway scripts or solo prototypes, this workflow is overkill — skip to the [Cons](#the-real-cons) and [Who This Is For](#who-this-is-for) sections first.

---

I've been using an iterative 12-phase workflow I refined iteratively — across [free-context-hub](https://github.com/letuhao/free-context-hub) (a self-hosted persistent memory and guardrails layer for AI agents), [lore-weave](https://github.com/letuhao/lore-weave) (described below), and a handful of private internal systems. Across all of them, the workflow has accumulated 4,000+ commits and a trail of written specs and audit logs I can still query months after the sessions that produced them.

The free-context-hub project alone covers 15 development phases: backend (MCP server, REST API), a full Next.js frontend (20+ pages), RAG pipelines with reranking benchmarks, multi-agent coordination protocols, knowledge portability, and tenant-scoped access control.

I'm sharing the workflow because it's worked better than anything else I've tried, and because the honest trade-offs are worth knowing before you adopt it.

The files are in the repository:
- **[`docs/WORKFLOW.md`](../WORKFLOW.md)** — standalone 12-phase template to copy into any project
- **[`CLAUDE.md`](../../CLAUDE.md)** — the live project spec with project-specific tooling and AMAW wiring
- **[`docs/amaw-workflow.md`](../amaw-workflow.md)** — opt-in multi-agent extension spec

---

## The Second Project: LoreWeave

[LoreWeave](https://github.com/letuhao/lore-weave) is the project where the workflow gets the most sustained stress-testing. It's a multi-agent cloud platform for multilingual novel workflows — translation, analysis, knowledge graph construction, and AI-assisted creative writing — cloud-hosted (AWS) with Docker Compose for local development.

The architecture is a microservices monorepo: 19 services across three language stacks:

| Stack | Services |
|---|---|
| **Go / Chi** | auth, books, sharing, catalog, provider-registry, usage-billing, translation, glossary |
| **Python / FastAPI** | chat (LiteLLM), knowledge (Postgres + Neo4j), video-gen (ComfyUI gateway) |
| **TypeScript / NestJS** | api-gateway-bff (all external traffic), notification |

Supporting that are two async workers (`worker-infra`, `worker-ai`), plus the infrastructure tier: per-service Postgres DBs, Redis Streams for job queues, MinIO for object storage.

After 67 sessions and 1,497 commits since March 2026, the five core modules are closed (smoke-tested):

| Module | Domain |
|---|---|
| M01 | Identity & Auth — JWT, refresh, multi-device sessions |
| M02 | Books & Sharing — book lifecycle, visibility policy, public catalog |
| M03 | Provider Registry — BYOK AI provider credentials, platform model catalog |
| M04 | Raw Translation Pipeline — async job lifecycle, chunked chapter translation |
| M05 | Glossary & Lore Management — multilingual lore entities, evidence tracking, RAG export |

The current work (Phase 6) is the usage-billing subsystem: budget reservation before job execution, streaming billing (so a 10,000-token chat job can't blow past a daily cap), per-model `usage_logs` audit rows, and the hierarchical book extraction engine (structural decomposer → parallel map + checkpoint → hierarchical reduce + per-level summaries — the three-phase sequence that gives the platform 50MB-novel local processing capability).

Planning artifacts across all modules total 137 documents. The audit log (append-only JSONL) has 140 entries from AMAW-verified tasks alone — not counting the regular per-session SESSION_PATCH entries.

The project is designed as a hobby + open-source platform. No deadlines, no external audience pressure, which is why the workflow's "don't rush past quality issues" rule is actually enforceable — there's no release clock to override it.

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

**[Superpowers](https://github.com/obra/superpowers)** — a coding agent discipline framework that introduced TDD protocol, the evidence gate (run verification fresh before claiming success), and the debugging protocol (no fix without root cause). I absorbed these directly. If you haven't read Superpowers, it's worth your time.

**Human-in-the-loop gatekeeping** — my own addition. The core insight: a human reading a short spec + a single diff catches dramatically more than a human reading code cold. The workflow structures every task to produce exactly those artifacts, at exactly the right moment.

The combination took multiple iterations to stabilize. What's here is v2.2 (default mode) with an optional AMAW (Autonomous Multi-Agent Workflow) extension for high-stakes work.

---

## The 12 Phases

```
Phase          │ Role (default v2.2)   │ What Happens
───────────────┼───────────────────────┼──────────────────────────────────────────
1. CLARIFY     │ Architect + Human     │ Read context, write spec, expose assumptions
2. DESIGN      │ Lead                  │ API contract / data flow → DESIGN.md
3. REVIEW      │ Adversarial self      │ Find gaps / contract holes in spec
4. PLAN        │ Lead + Developer      │ Decompose into 2–5 min tasks → PLAN.md
5. BUILD       │ Developer             │ TDD: red → green → refactor
6. VERIFY      │ Developer             │ Run tests fresh, capture exit code + output
7. REVIEW      │ Lead                  │ Code vs spec — find exactly 3 divergences
8. QC          │ Main session          │ Spec fingerprint vs implementation, AC coverage
9. POST-REVIEW │ Human checkpoint      │ Final gate — blocked on any unresolved issue
10. SESSION    │ Scribe                │ SESSION_PATCH.md + DEFERRED.md + AUDIT_LOG
11. COMMIT     │ Developer             │ Git commit
12. RETRO      │ All                   │ Record lessons + finalize audit log
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
| Skip POST-REVIEW | "I reviewed in phase 7" | Phase 7 is code review; POST-REVIEW is the final conservative gate — different scope |
| Skip SESSION before COMMIT | "I'll update later" | You won't. Context is lost. |
| Combine multiple phases | "CLARIFY+DESIGN+PLAN in one go" | Each phase boundary is a deliberate pause point; skipping it removes the checkpoint |

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
2. **After POST-REVIEW** — human reviews the AUDIT_LOG, the spec, and the diff before SESSION commits anything

These are not optional. The whole model is that the human reads a short spec, not a long codebase. The AI builds the spec; the human approves it; the AI builds the code against the approved spec. The POST-REVIEW diff is then code-vs-approved-spec, which is a comparison a human can actually do.

---

## AMAW: The Opt-In Multi-Agent Extension

For high-stakes work — data migrations, new service boundaries, security-critical paths — there's an optional extension: **AMAW (Autonomous Multi-Agent Workflow)**. In AMAW mode, cold-start sub-agents replace or augment the human review gates:

- **Adversary** — finds exactly 3 things that could go wrong. *Why 3? Enough to surface real issues, few enough to force prioritization rather than a laundry list.* Never says what's good.
- **Scope Guard** — compares spec fingerprint vs implementation, checks AC coverage, issues CLEAR or BLOCKED
- **Scribe** — records decisions, writes session summaries, detects deferred items
- **Audit Logger** — finalizes the audit trail at RETRO

The key insight is **cold-start**: each agent is spawned fresh with only file access. It cannot inherit the main session's context rot or biases. It reads what's written; it can't be influenced by what was discussed in chat.

> **Note:** AMAW removes the human from all review gates — including POST-REVIEW, which is held by the Scope Guard instead. At CLARIFY, rather than a human approving the spec, the Adversary challenges it at the next phase. In practice this means AMAW sessions can run with minimal human interaction, but they still require a human to kick off the task and review the final audit log. Pure fire-and-forget is not the design intent.

AMAW costs roughly $1–5 in sub-agent tokens and ~30 extra minutes per task. I use it for schema migrations and multi-system contracts. For everyday work, the human-in-loop default catches the same issues faster and cheaper.

---

## What Gets Recorded: The Audit Log

Every phase transition and agent verdict appends to `docs/audit/AUDIT_LOG.jsonl` — one JSON line per event:

```json
{"ts":"2026-05-15T17:42:00Z","task":"phase-14-model-swap","phase":"review-design","agent":"adversary","action":"review","status":"REJECTED","findings_count":3,"block_count":2,"warn_count":1,"note":"..."}
```

Append-only. Never modified. Main session and sub-agents both write to it, never delete or edit existing lines.

This becomes the durable record of what was decided and why — something that doesn't exist in most AI coding setups where everything lives in ephemeral chat.

---

## What I've Shipped With This

### free-context-hub

On [free-context-hub](https://github.com/letuhao/free-context-hub) I've delivered 15 development phases covering:

- Core backend: MCP server (36 tools), REST API (70+ endpoints), background worker
- Frontend: Next.js 16 + React 19, 20+ pages, human-in-loop review UI
- RAG pipeline: tiered search (ripgrep → FTS → semantic), 8-model embedding benchmark, reranking benchmarks with reproducible reports
- Multi-agent coordination: artifact leases with TTL/fencing, pending-review state, taxonomy profiles
- Knowledge portability: zip+JSONL bundle format, streaming import/export, cross-instance pull with SSRF hardening
- Tenant-scoped access control: authz model, 3-tier routing, event log, collective decisions

### LoreWeave

On lore-weave I've delivered 5 full vertical modules and am mid-way through a sixth, accumulating 1,497 commits since March 2026 across 19 microservices. The modules completed so far cover:

- **Identity & Auth** — JWT issuance, refresh rotation, multi-device session management (Go/Chi + NestJS gateway)
- **Books & Sharing** — book and chapter lifecycle, visibility policy, public catalog browse (Go/Chi, Postgres, MinIO)
- **Provider Registry** — BYOK AI provider credential vault, platform model catalog, streaming proxy, budget pre-flight (Go/Chi + worker-ai)
- **Raw Translation Pipeline** — async chunk-level translation job lifecycle, job queue via Redis Streams, per-chapter result storage, BYOK + platform model routing (Go/Chi + Python/FastAPI + worker-infra)
- **Glossary & Lore Management** — multilingual entity management, chapter M:N evidence linking, wiki article generation, RAG-ready glossary export (Go/Chi, Postgres, glossary-service + knowledge-service two-layer pattern)

The current Phase 6 work — usage-billing and hierarchical book extraction — is where the cross-service contract surface gets the most complex: streaming billing that can't exceed a daily cap mid-stream, usage_logs audit rows that must fire for both streamed and non-streamed paths, and a three-phase extraction engine (structural decomposer → parallel map+checkpoint → hierarchical reduce) that operates across book-service, knowledge-service, and worker-infra simultaneously.

That's 400+ commits on free-context-hub and 1,497 on lore-weave — part of a wider 4,000+ commit track record — with a live audit trail I can query across sessions that ran months apart.

The hardest part was Phase 10 (SESSION) — keeping the session patch updated after every sprint without skipping it. Once that became a habit, sessions started to feel continuous rather than amnesia-punctuated.

---

## The Real Pros

**You understand your own system deeply.** Because you write the spec and approve it, you can't hide behind "the AI built it." You actually know what was built and why the trade-offs were made. This is the biggest practical advantage for me — not velocity, but comprehension.

**Architectural decisions have a paper trail.** Every trade-off is in a spec file that was approved before code was written. When a future session revisits a design choice, the rationale is readable, not reconstructed from diff archaeology.

**Context drift is visible.** When an AI starts building something that wasn't in the spec, the spec fingerprint comparison at POST-REVIEW catches it. Without a written spec, you'd never notice until integration time.

**Deferred items don't get lost.** The workflow forces any "we'll do this later" to be written in `DEFERRED.md` with a specific trigger condition. Nothing lives only in chat — chat is ephemeral, files are truth.

**It's incrementally adoptable.** You can start with just CLARIFY + VERIFY and get substantial value. Add phases as your trust in the workflow grows.

---

## The Real Cons

**Token usage is genuinely high.** Each phase generates artifacts: spec files, plan files, audit events. AMAW mode multiplies this by spawning sub-agents. A single M-sized task with AMAW can burn 5,000–10,000 tokens before a line of code is written. At scale, this is a real budget consideration.

**You clarify constantly — and it takes real time.** Phase 1 (CLARIFY) is not a quick preamble. For any task with real ambiguity — architecture decisions, new API contracts, trade-off calls — you're in a back-and-forth that can run 20–40 minutes before design starts. At a medium-sized project cadence (10–20 above-XS tasks per sprint), this adds up to multiple hours per sprint spent purely on scoping. This is actually the point of the workflow, but if you're used to "just build it," the overhead feels significant early on.

**Human approval gates limit automation.** Every architecture decision, trade-off, and scope call requires your explicit approval. You cannot queue up a batch of tasks and walk away. If you need fully autonomous overnight runs, this workflow is the wrong tool.

**The discipline needs enforcement tooling to hold.** Left to their own devices, agents will skip phases. The workflow holds together because of `workflow-gate.sh` (a pre-commit gate that blocks commits if VERIFY and SESSION aren't done) and the append-only `AUDIT_LOG.jsonl`. If you copy `docs/WORKFLOW.md` into your project without also setting up the enforcement layer, expect phases to get skipped within a few sessions. The tooling is in the repository — it's not hidden — but it's a real setup step, not just copy-paste.

**Cold-start sub-agents (AMAW only) miss things said in chat.** Because each AMAW sub-agent reads files from scratch, anything that was decided verbally in the session but never written to a file is invisible to them. This is a feature for preventing bias, but it means you must be disciplined about writing things down as you go. The Scribe sub-agent helps, but it can only record what's already in files.

---

## Who This Is For

Worth the overhead if:

- You're building production systems — not prototypes — that will be maintained and extended
- You care about knowing *why* each decision was made, not just that it compiles today
- You find yourself surprised by what the AI built, in ways that cost you rework later
- Sessions run over weeks or months and you need continuity across context windows

Overkill if:

- You're doing exploratory coding, one-shot scripts, or time-boxed experiments
- Your sessions are short and the full context fits in one window
- You don't need an audit trail or human-approved architectural decisions
- Speed of iteration matters more than correctness of decision-making

The workflow is designed for the first category. Using it for the second is just friction.

---

## How to Use It

**Start with the template:**

1. Copy [`docs/WORKFLOW.md`](../WORKFLOW.md) into your project root or paste the relevant sections into your `CLAUDE.md` / agent instructions — this is the full 12-phase spec
2. Customize the `[CUSTOMIZE]` sections for your stack (verification commands, test runner, any MCP tools you use — MCP is the Model Context Protocol, an interface for giving AI agents access to external tools and knowledge stores; the workflow works without it)
3. Add `workflow-gate.sh` from the repository root to enforce the phase gates mechanically — without this, agents will skip phases
4. For high-stakes tasks, see [`docs/amaw-workflow.md`](../amaw-workflow.md) for the AMAW multi-agent extension
5. Start with just **task size classification + VERIFY** — those two alone change how you work with agents

The workflow is model-agnostic. I use it with Claude Code but nothing in the spec requires it.

---

## Final Thought

The 12-phase workflow is not magic. It's a way of making explicit things that were always implicit: what are we building, how big is it, what's the verification evidence, who approved it, what did we learn? The AI does most of the work. The human stays in control of the decisions that actually matter.

The cost is real — more tokens, more time spent clarifying, more things requiring your approval before the AI proceeds. The benefit is also real: you end up with a system you understand deeply, and a trail of why it was built the way it was.

For me, after 4,000+ commits across multiple projects, that trade-off is still worth it.

---

*Repositories: [letuhao/free-context-hub](https://github.com/letuhao/free-context-hub) · [letuhao/lore-weave](https://github.com/letuhao/lore-weave)*
*Workflow files: [`docs/WORKFLOW.md`](../WORKFLOW.md) · [`docs/amaw-workflow.md`](../amaw-workflow.md) · [`CLAUDE.md`](../../CLAUDE.md)*
