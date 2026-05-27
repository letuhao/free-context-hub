# Competitive Landscape — AI Agent Governance Space

**Date:** 2026-05-27
**Purpose:** Survey of public projects in the AI agent governance / coordination / runtime-enforcement space, to inform positioning and identify real differentiation for free-context-hub.

---

## Framing note — Dead Light Framework lineage

free-context-hub is not a generic "agent governance toolkit." It is the **MCP-served, software-substrate implementation of the Dead Light Framework (DLF)** — a governance methodology designed for hybrid human + AI organizations. This shapes the coordination primitives (motions, proxies, disputes, decision bodies, multi-tier routing, 3-phase topic close, append-only event log per topic) in ways that are deliberately different from generic policy/quorum tooling.

The competitors below were surveyed for **functional overlap**, not philosophical alignment. Most of them solve adjacent problems (pre-action policy enforcement, M-of-N approval, agent identity, content safety) without committing to a coherent governance model. DLF commits to one — that is the wedge, not the absence of competitors.

---

## TL;DR

- The space is **forming fast** — multiple serious projects shipped in April-May 2026 alone
- **No single competitor combines** (a) persistent semantic memory of decisions, (b) full collective-decision primitives (motions/proxies/disputes/multi-tier routing), and (c) pre-action policy enforcement under one MIT roof
- **Real threats** to positioning: Microsoft Agent Governance Toolkit (brand + maturity + sub-ms policy), USC Aegis (closest spiritual sibling — HITL + audit + GUI + framework auto-patching)
- **Honest gaps** vs leaders: no cryptographic agent identity, TS-only SDK, no framework auto-patching, Phase 5 runtime enforcement not yet built, no published attack-benchmark numbers

---

## Direct competitor: Microsoft Agent Governance Toolkit

**Threat level:** HIGH on policy/approval; LOW on memory/coordination

- **Repo:** https://github.com/microsoft/agent-governance-toolkit
- **License:** MIT
- **Maturity:** ~2.9k stars, 17 releases, v3.7.0 (May 2026), 1,733 commits, 992 conformance tests. Self-described "Public Preview." No named production deployments yet.
- **Language SDKs:** Python / TS / .NET first-class; Go / Rust mentioned
- **What it ships:**
  - 7 packages: Agent OS, Agent Mesh, Agent Runtime, Agent SRE, Agent Compliance, Agent Marketplace, Agent Lightning
  - Agent OS = stateless policy engine, <0.1ms p99, YAML + OPA Rego + Cedar
  - Agent Mesh = decentralized identifiers (Ed25519), Inter-Agent Trust Protocol, 0–1000 behavioral trust score
  - Agent Runtime = saga orchestration, kill-switch, CPU-ring-style execution privileges
  - Agent Compliance = mappings to EU AI Act, HIPAA, SOC 2, OWASP Agentic Top 10
  - **Approval Quorum & Fatigue Detection** — `QuorumConfig(required_approvals=2, total_approvers=3)` is real and shipped
- **Coordination primitives:** M-of-N quorum approval (real); trust-score decay; majority voting for memory-poisoning defense (narrow technical use). **No motions, no proxy/delegation, no dispute resolution, no multi-tier routing.**
- **Memory layer:** None. Append-only audit logs with Merkle chains are for compliance, not retrieval.
- **What free-context-hub does that MS doesn't:**
  - Persistent semantic memory of decisions/lessons with embeddings + reranker
  - Full motion/vote/proxy/dispute primitives (parliamentary, not single-gate)
  - Topic-scoped append-only event log with 3-phase close
  - Review inbox GUI
  - CallerScope tenant isolation threaded through every service fn
- **What MS does that free-context-hub doesn't:**
  - Cryptographic agent identity (DIDs / Ed25519)
  - Behavioral trust scoring
  - Sub-ms pre-action policy interception (shipped, not planned)
  - OPA Rego + Cedar support
  - SRE primitives (SLOs, chaos, circuit breakers)
  - Compliance regulatory mappings
  - Signed marketplace
  - 5 language SDKs vs TS-only

---

## Direct competitor: USC Aegis

**Threat level:** HIGH on architecture (closest spiritual sibling)

- **Repo:** https://github.com/Justin0504/Aegis
- **Paper:** arXiv 2603.12621 (March 2026)
- **License:** MIT
- **Maturity:** 359 stars, 174 commits, v0.1.0 desktop release (May 2026)
- **What it ships:**
  - Pre-execution firewall + audit layer
  - **Auto-patches 14 frameworks zero code change:** Anthropic, OpenAI, LangChain/LangGraph, CrewAI, Gemini, Bedrock, Mistral, LlamaIndex, smolagents (Python); Anthropic/OpenAI/LangChain/Vercel AI (JS); Go SDK
  - YAML/JSON Policy DSL per tenant on JSON-schema defaults
  - Ed25519-signed, SHA-256 hash-chained audit
  - "Compliance Cockpit" Next.js GUI (10+ tabs: live feed, approvals, policies, cost, sessions, alignment audit, forensic export)
  - Multi-tenancy + RBAC
  - 13 deployment templates (Docker / K8s / Railway / Render)
  - **Concrete benchmarks:** 100% block on 48-attack suite, 1.2% FPR, 8.3ms median latency
- **Coordination primitives:** Single-stream human approval. No quorum / voting / motion.
- **Memory layer:** None.
- **What free-context-hub does that Aegis doesn't:**
  - Semantic memory of decisions/lessons
  - Coordination primitives (motions / votes / proxies / disputes)
  - Topic-scoped event log with 3-phase close
- **What Aegis does that free-context-hub doesn't:**
  - Zero-code framework auto-patching (14 frameworks)
  - Ed25519 / hash-chain audit cryptography
  - 13 ready deployment templates
  - Published attack-block benchmarks

---

## Adjacent: Galileo Agent Control

**Threat level:** MED on policy enforcement; NONE on memory or coordination

- **Repo:** https://github.com/agentcontrol/agent-control
- **License:** Apache-2.0 (true OSS, self-host complete; paid Galileo SaaS also exists)
- **Maturity:** 252 stars, 40 releases, v7.9.0 (May 25, 2026) — extremely active
- **What it ships:**
  - `@control()` Python decorator turns any function into a governance hook
  - Returns `deny | steer | warn | log | allow`
  - Remote JSON policies evaluated by Agent Control server (Postgres-backed, Docker Compose)
  - Built-in evaluator types: regex, list, JSON, SQL
  - UI dashboard for visual control creation
- **Coordination primitives:** **None.** Strictly per-function policy evaluation.
- **Memory layer:** None.
- **Mature thing they have:** multi-vendor evaluator chaining (Luna + NeMo + Bedrock + regex in one policy); decorator-level granularity inside agent function chains.

---

## Adjacent: AgentWorkforce relay

**Threat level:** LOW — despite name, it's messaging plumbing, not coordination primitives

- **Repo:** https://github.com/AgentWorkforce/relay
- **License:** Apache-2.0
- **Maturity:** 697 stars, v7.1.1 (May 25, 2026), very active
- **What it ships:**
  - Multi-agent messaging bus: channels, DMs, threads
  - SDK to spawn Claude Code (and other) agents and route messages
  - "Agent Relay Observer" for message visibility
- **Coordination primitives:** **None.** No voting, no quorum, no motions, no consensus algorithms. State persistence model not publicly documented.
- **Memory layer:** None — agents maintain their own state.
- **Note:** The name is misleading — this is plumbing, not governance.

---

## Adjacent: Meta LlamaFirewall

**Threat level:** LOW — different layer entirely (content safety, not action governance)

- **Lives in:** https://github.com/meta-llama/PurpleLlama (~4.2k stars)
- **License:** Tiered — MIT for evals/benchmarks, Llama Community License for models
- **What it ships:**
  - PromptGuard 2 (jailbreak detector)
  - Agent Alignment Checks (chain-of-thought auditor for prompt injection / goal misalignment)
  - CodeShield (static analysis for unsafe code generation)
  - Customizable regex/LLM scanners
- **Coordination primitives:** None.
- **Memory layer:** None.

---

## Adjacent: Superagent

**Threat level:** LOW — guardrails SDK, not governance

- **Repo:** https://github.com/superagent-ai/superagent
- **License:** MIT SDK + paid SaaS API
- **Maturity:** 6.6k stars
- **What it ships:** Guard (prompt-injection / unsafe tool-call), Redact (PII/PHI/secrets), Scan (repo poisoning); Test (red-team) coming soon. TS + Python SDKs + MCP server.
- **Coordination primitives:** None.
- **Memory layer:** None. GUI: None.

---

## Adjacent: lastmile-ai/mcp-agent

**Threat level:** LOW — orchestration patterns, not governance

- **Repo:** https://github.com/lastmile-ai/mcp-agent
- **License:** Apache-2.0
- **Maturity:** 8.3k stars but v0.0.21 (May 2025) — gap suggests slowing
- **What it ships:** Workflow framework — Parallel, Router, Orchestrator-Workers, Evaluator-Optimizer, Swarm, Intent-Classifier patterns. `HumanInputRequest` durably pauses workflow via Temporal-backed persistence.
- **Coordination primitives:** Orchestration patterns; no voting / quorum / motion / policy.

---

## Adjacent: DX Heroes MCP Gateway

**Threat level:** LOW — different layer (transport gateway vs application-level governance)

- **Page:** https://dxheroes.io/insights/mcp-governance-landscape-early-2026
- **License:** Proprietary, commercial, self-host
- **What it ships:** MCP gateway with profiles (different tool sets per team); per-profile tool-description overrides; tool-call-granularity audit (SOC 2 / GDPR); unified visibility across Copilot / Claude Code / Cursor / VS Code / Windsurf / ChatGPT / Claude Desktop.
- **Coordination primitives:** None. Memory: None.

---

## Confirmed non-overlap on governance

| Project | Category | Reason for non-overlap |
|---------|---------|----------------------|
| mem0 | Memory SDK | No policy / voting / coordination |
| Letta / MemGPT | Agent runtime with three-tier memory | No policy enforcement / no voting |
| Basic Memory MCP | Memory MCP | Memory only |
| mcp-memory-service | Memory + KG | Memory only |
| LangChain | Framework | No governance |
| LlamaIndex | Framework | No governance |
| CrewAI | Multi-agent orchestration | Role definitions + task graphs, no formal voting |
| AutoGen | Multi-agent orchestration | Same |
| Mastra | Multi-agent orchestration | Same |

---

## Capability matrix

| Pillar | MS Toolkit | Aegis | Galileo | Memory tools | free-context-hub |
|--------|------------|-------|---------|--------------|------------------|
| Pre-action policy enforcement | shipped, sub-ms | shipped | shipped | none | planned (Phase 5) |
| Quorum approval (M-of-N) | yes | no | no | no | yes |
| Motions / votes | no | no | no | no | **yes (DLF)** |
| Proxies / delegation | no | no | no | no | **yes (DLF)** |
| Dispute resolution | no | no | no | no | **yes (DLF)** |
| Multi-tier routing | no | no | no | no | **yes (DLF)** |
| 3-phase topic close | no | no | no | no | **yes (DLF)** |
| Append-only event log per topic | no | hash-chain audit | no | no | **yes (DLF)** |
| Persistent decision memory + semantic recall | no | no | no | yes (memory only) | **yes** |
| Cryptographic agent identity | yes (DIDs / Ed25519) | yes (Ed25519) | no | no | **no — gap** |
| Multi-language SDK | yes (5 langs) | no (auto-patch instead) | Python only | mixed | **no — TS only, gap** |
| Framework auto-patching | no | yes (14 frameworks) | decorator-based | no | **no — gap** |
| Published attack benchmarks | conformance suite | 48-attack suite + FPR / latency | no | no | **no — gap** |
| Compliance regulatory mappings | yes (EU AI Act, HIPAA, SOC 2) | partial | no | no | **no — gap** |

---

## Honest verdict

### What free-context-hub uniquely owns

The combination of:
1. **DLF-derived collective-decision primitives** — motions, proxies, disputes, multi-tier routing, 3-phase topic close, append-only event log per topic. **No competitor ships this.**
2. **Persistent semantic memory of decisions / lessons / workarounds** — memory tools have this but lack governance; governance tools lack this.
3. **Tenant-scope isolation** enforced at the service layer (CallerScope threaded through every fn, REST + MCP both inherit) — most competitors enforce at the gateway / decorator layer.
4. **MIT-licensed, single self-hosted MCP server** combining all three pillars.

### What free-context-hub does NOT own (yet)

1. **Pre-action policy enforcement** — MS Toolkit + Aegis both ship this; free-context-hub has it in Phase 5 ideation. Until shipped, this is a real gap.
2. **Cryptographic agent identity** — no plan; the design assumes operator-trusted env or scoped API keys.
3. **Multi-language SDKs** — TS-only is a real adoption ceiling vs MS's 5-language coverage.
4. **Zero-code framework auto-patching** — Aegis's 14-framework auto-patch is a real UX moat.
5. **Published attack benchmarks** — Aegis ships concrete numbers (100% block on 48 attacks, 8.3ms p50); free-context-hub has retrieval benchmarks but no attack-block / FPR / latency benchmarks on the governance / policy paths.

### Honest answer to "how is this different from MS Agent Governance Toolkit?"

> MS ships best-in-class pre-action policy interception, cryptographic identity, and 5 language SDKs — I don't compete there yet. What I ship that they don't: persistent semantic memory of decisions / lessons, and a full collective-decision protocol — motions, proxies, disputes, multi-level routing — not just M-of-N approval. Their approval primitive is a single quorum gate; mine is a parliamentary system, built on the Dead Light Framework governance methodology. If you're securing one agent's tool calls, use MS. If you're coordinating an org of agents that need to reason over past decisions and vote on shared actions, that's my wedge.

### Honest answer to "how is this different from Aegis?"

> Aegis is the closest spiritual sibling — HITL + audit + multi-tenancy + Compliance Cockpit GUI + 14-framework auto-patching. Architecturally we converge. What they ship that I don't: zero-code framework auto-patching, Ed25519 / hash-chain audit, published attack benchmarks. What I ship that they don't: semantic memory of decisions, collective-decision primitives beyond single-stream approval, the DLF governance model. We're solving overlapping but not identical problems — they want to firewall any agent stack with minimum integration; I want to give a team a substrate for governing AI as an organizational member.

---

## Sources

- Microsoft Agent Governance Toolkit (https://github.com/microsoft/agent-governance-toolkit)
- Agent OS package docs — quorum config (https://microsoft.github.io/agent-governance-toolkit/packages/agent-os/)
- MS launch blog (https://opensource.microsoft.com/blog/2026/04/02/introducing-the-agent-governance-toolkit-open-source-runtime-security-for-ai-agents/)
- MS architecture deep-dive (https://techcommunity.microsoft.com/blog/linuxandopensourceblog/agent-governance-toolkit-architecture-deep-dive-policy-engines-trust-and-sre-for/4510105)
- Galileo Agent Control (https://galileo.ai/blog/announcing-agent-control)
- agentcontrol/agent-control on GitHub (https://github.com/agentcontrol/agent-control)
- AgentWorkforce/relay on GitHub (https://github.com/AgentWorkforce/relay)
- LlamaFirewall paper, arXiv 2505.03574 (https://arxiv.org/abs/2505.03574)
- Meta PurpleLlama (https://github.com/meta-llama/PurpleLlama)
- Aegis paper, arXiv 2603.12621 (https://arxiv.org/abs/2603.12621)
- Justin0504/Aegis (https://github.com/Justin0504/Aegis)
- Superagent (https://github.com/superagent-ai/superagent)
- DX Heroes MCP governance landscape (https://dxheroes.io/insights/mcp-governance-landscape-early-2026)
- lastmile-ai/mcp-agent (https://github.com/lastmile-ai/mcp-agent)
- Mem0 vs Letta vs MemGPT 2026 comparison (https://tokenmix.ai/blog/ai-agent-memory-mem0-vs-letta-vs-memgpt-2026)

---

## Related papers worth reading

- **DAO-AI** — arXiv 2510.21117 (Oct 2025). Closest academic strand to free-context-hub's thesis — AI agents inside collective decision-making structures (motions, votes, tallies) rather than as workers reporting to humans. Most aligned framing in the literature.
- **Authenticated Delegation and Authorized AI Agents** — arXiv 2501.09674
- **Decentralized Governance of Autonomous AI Agents** — arXiv 2412.17114
- **Bounding Decision Authority in Autonomous Agents** — arXiv 2602.14606
