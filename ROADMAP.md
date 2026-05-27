# Roadmap

**free-context-hub** is the MCP-served, software-substrate implementation of the **Dead Light Framework (DLF)** — a governance methodology for hybrid human + AI organizations.

This document describes the **strategic arc** — the five-phase research program the project is executing against. The detailed sprint-level history (15+ shipped phases with migrations, sprints, and PRs) lives in [WHITEPAPER.md](WHITEPAPER.md) and [CLAUDE.md](CLAUDE.md). This doc is the higher-level view.

---

## The five-phase strategic arc

```
Phase 1 ─── Phase 2 ─── Phase 3 ─── Phase 4 ─── Phase 5
Memory      Eval +      Governance  Benchmark   Runtime
+ Knowledge RAG Quality Primitives  Governance  Enforcement
                                                + Isolation
✅ SHIPPED   🔄 IN PROG  🔄 IN PROG   ⏳ PLANNED   💡 RESEARCH
```

Phase 1 is the foundation. Phase 2 and Phase 3 are being built in parallel on separate branches. Phase 4 depends on Phase 3 landing. Phase 5 is still in the ideation / literature-review stage and has no detailed design yet.

---

## Phase 1 — Memory & Knowledge Layer ✅ SHIPPED

**Goal:** AI agents stop starting from zero every session. Decisions, workarounds, and team conventions persist across sessions and across agents.

**What was built:**

- Persistent **lessons** store (decisions, preferences, workarounds, guardrails) with type-aware retrieval
- **Semantic search** via Postgres + pgvector with embedding model swap (bge-m3, 8192-token context)
- **Tiered retrieval** — ripgrep → FTS → semantic, with optional reranker
- **MCP server** exposing the knowledge layer to Claude Code, Cursor, and any MCP-compatible client
- **Guardrails** that block dangerous actions (git push, deploys, migrations) before they execute
- **GUI** with 20+ pages for humans to review, approve, and refine AI-generated knowledge
- **Knowledge graph** (optional Neo4j) for symbol-level code structure
- **Git intelligence** — auto-draft lessons from commit history
- **Multi-format ingestion** — PDF / DOCX / EPUB / images / URL with vision-LLM fallback
- **Knowledge portability** — zip bundle export/import + cross-instance pull

**Sprint-phase mapping:** README/WHITEPAPER Phases 1–11.

---

## Phase 2 — Eval Dataset & RAG Production Quality 🔄 IN PROGRESS (separate branch)

**Goal:** Push the RAG pipeline from "retrieval scores measured, generation un-measured" to "**generation faithfulness and answer relevance gated by automated LLM-as-judge**" — so every downstream change (reranker, query rewrite, semantic chunking, CoVe) can be A/B-tested against a real signal of answer quality.

**Why it matters:** A retrieval change that improves recall@5 by 5 points can still degrade answer faithfulness if the reranker pulls in distractors. Without gen-eval, that regression is invisible.

**What is being built:**

- **152-row gen-eval dataset** — 127 retrieval queries + 25 hand-curated edge cases (multi-hop, no-answer, contradictory-source, paraphrase, distractor)
- **Ragas judge sidecar** — Python / FastAPI service running `google/gemma-4-26b-a4b-it` as the LLM judge
- Metrics: faithfulness, answer_relevancy, context_precision, context_recall, refusal_correctness, groundedness_self_eval
- Industry thresholds: faithfulness > 0.9, answer_relevancy > 0.85, context_precision > 0.8 (ship as WARN-only until 2 weeks of baseline variance data, then flip to BLOCK)
- **Anti-hallucination experiments (Phase 17)** — citation-forced prompt templates, selective abstention, Chain-of-Verification synthesizer

**Status:** Sprint 16.1–16.3 shipped; Phase 17.1–17.2 in progress.

**Sprint-phase mapping:** README/WHITEPAPER Phase 12 (retrieval measurement, shipped) and Phase 16 / 17 (generation measurement and anti-hallucination, active).

---

## Phase 3 — Governance Primitives 🔄 IN PROGRESS (separate branch)

**Goal:** Give agents and humans a shared substrate for coordinated decision-making. Every state change is an append-only event on a topic, and authority is derived from participation — never asserted by the caller.

**Why it matters:** Once AI agents operate with delegated authority, the problem shifts from memory to governance. Who can authorize an action? How do review chains work? What happens when two actors disagree? How are decisions chained, audited, and reversed?

**Primitives shipped or in progress:**

- **Coordination substrate** — durable append-only event log; Topic / Actor / participant model
- **The Board** — `tasks` with dependency-gated claiming, derived-identity `artifacts` with versioning, `claims` with fencing tokens and abandoned-claim sweep
- **Request / Approval** — multi-level routing with approval chains (unilateral and collective procedures)
- **Collective Decision** — motions, votes (weighted / proxy / abstain), tally, veto, quorum
- **Intake mailbox + dispute resolution**
- **Topic-closing drain** — 3-phase `closing → drain → closed` with force-lapse of in-flight items
- **Primitive-outcome chaining** — an approved request step or carried motion auto-materializes into the next primitive
- **Multi-tier collective routing** — escalation across tiers (coordination committee → authority board)
- **Authorization model** — non-owner level-grant flow, owner permanence, three HARD pre-production triggers
- **Tenant-scope enforcement** — `CallerScope` threaded through every service function so REST and MCP both inherit isolation

**Foundation:** Built on the **Dead Light Framework** governance methodology — taxonomy profiles for `reckoning-finding`, `candidate-decision`, `failure-candidate`, `implicit-principle`, `codex-guardrail` ship as the reference profile.

**Sprint-phase mapping:** README/WHITEPAPER Phases 13–15 (coordination, governance, multi-actor primitives, tenant-scope enforcement) and DEFERRED-029 (MCP tenant-scope enforcement closure).

---

## Phase 4 — Governance Benchmark ⏳ PLANNED

**Goal:** Validate the Phase 3 governance design across varied real-world scenarios. The bet is that the same primitives behave correctly across a wide range of org topologies (flat, hierarchical, federated), conflict patterns (collaborative, adversarial, byzantine), and actor mixes (all-human, human-led + AI assistants, AI-led + human review, all-AI with human escape valve).

**Why it matters:** The Phase 3 primitives are designed against a coherent theory. They have not been validated against a diverse benchmark of governance scenarios. Until they have been, claiming "this governance model holds up in practice" is premature.

**Approach (under design):**

- Catalog of governance scenarios drawn from real org structures, public DAO post-mortems, and DLF case studies
- Per-scenario success metric — was the right outcome reached, in the right number of steps, by the right principals, with auditability intact?
- Adversarial scenarios — what happens when an actor abuses their level? When two authority-level actors disagree at the final step? When a topic is closed mid-dispute?
- A long-running external project ([LoreWeave](#)) serves as a live benchmark substrate — see the thesis below.

**Status:** Not yet started. Will begin once Phase 3 primitives reach feature-complete on the active branch.

---

## Phase 5 — Runtime Enforcement & Isolation 💡 RESEARCH / DESIGN

**Goal:** Move from after-the-fact audit to **before-the-action enforcement**. A policy engine that constrains or mediates agent behavior *before* it occurs — and an isolation environment for experimental or dangerous actions that should be sandboxed even if the policy decision is "allow."

**Why it matters:** Phase 1's guardrails block at the application layer — they intercept tool calls inside the MCP server. Phase 5 is about a coherent runtime substrate that handles policy decision, policy enforcement, sandboxing, and post-action attestation as one system. Most of the current public ecosystem (Microsoft Agent Governance Toolkit, USC Aegis, Galileo Agent Control) ships pre-action policy enforcement; this is the layer free-context-hub does not yet have.

**Open design questions:**

- Policy language — adopt OPA Rego / Cedar (industry standard, MS pattern), or design a DLF-native policy DSL?
- Where does the enforcement live — gateway, SDK shim, OS-level sandbox?
- What is the contract between Phase 3 governance decisions and Phase 5 runtime enforcement? (A motion carries → runtime policy updates; a request is approved → an isolated execution env is provisioned; etc.)
- Cryptographic agent identity — adopt DIDs / Ed25519 (MS / Aegis pattern), or scoped API keys (current model)?
- Isolation primitives — container / VM / WASM / process-level seccomp?

**Status:** Literature review in progress (DAO-AI, Microsoft Agent OS, Aegis architecture, Cedar policy language, AGT-style trust scoring). No detailed design yet.

---

## The thesis underneath

The deeper bet is whether the same governance substrate can let **one person operate at the throughput that normally takes a team of dozens** — by treating AI agents as governed organizational members with delegated authority, not as copilots.

A separate long-running project of the founder's serves as the live benchmark for the thesis — a substrate-stress-test under real workload, in parallel with the Phase 4 governance benchmark suite.

This is the experiment. The roadmap above is the apparatus.

---

## Where this sits in the public landscape

A detailed competitive survey of the AI agent governance / coordination / runtime-enforcement space lives at [`docs/research/2026-05-27-competitive-landscape.md`](docs/research/2026-05-27-competitive-landscape.md).

The short version:

- The space is **forming fast** — Microsoft Agent Governance Toolkit, Galileo Agent Control, USC Aegis, and several others all shipped real things in April–May 2026
- **No competitor combines** persistent semantic memory of decisions + full collective-decision primitives (motions / proxies / disputes / multi-tier routing) + the DLF governance model under one MIT roof
- **Real gaps vs leaders:** no cryptographic agent identity yet, TS-only SDK, no framework auto-patching, Phase 5 runtime enforcement not yet built, no published attack-block benchmarks

free-context-hub is not trying to be "the agent governance toolkit." It is one implementation of one specific governance methodology, served via MCP, designed to scale across mixed human + AI organizations.

---

## License & adoption

MIT-licensed. No revenue model. The only success metric the project tracks is whether the framework actually gets used.

For the detailed sprint-level history (15+ phases shipped, migration counts, test counts, PR stacks, audit logs), see [WHITEPAPER.md](WHITEPAPER.md). For workflow conventions and how the project is built, see [CLAUDE.md](CLAUDE.md).
