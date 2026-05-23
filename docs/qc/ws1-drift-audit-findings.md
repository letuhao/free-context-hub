# WS1 — Feature-drift audit findings (milestone review)

**Date:** 2026-05-23
**Method:** read-only comparison of current implementation vs WHITEPAPER goals/non-goals, all 15 phases.

## Verdict

The system is **largely faithful** to its stated goals and non-goals. One **significant drift**
(D1, the coordination layer became a light task orchestrator) and two minor items. Everything
else audited PASSES.

## Findings

### D1 — The Board is now a task orchestrator (SIGNIFICANT DRIFT, undocumented)
**WHITEPAPER (Phase 13, "What Phase 13 is not"):**
> "Not a task orchestrator. Phase 13 does not assign work to agents, schedule agent runs, or
> **manage dependencies between tasks**."

**Reality (Phase 15 Board, `src/services/board.ts`):**
- Tasks carry `depends_on: string[]` (task UUIDs), validated to exist within the same topic.
- `claimTask` ([board.ts:392-412](src/services/board.ts#L392)) **blocks a claim** when any
  dependency is missing or not `completed`, returning `status: 'unmet_dependencies'`. That is
  **dependency-gated sequencing of work** — exactly the disclaimed behavior.
- Tasks also carry `raci` (Responsible/Accountable/Consulted/Informed) — an **assignment** model,
  vs the "does not assign work to agents" non-goal.

This is real, intentional-looking functionality (15.2), but it **contradicts a stated
system-level non-goal and no doc records the scope change.** Not a bug — needs a product
decision: either (a) update the non-goal to acknowledge the system now does dependency-sequenced
task coordination, or (b) reconsider hard-gating vs advisory dependencies. → **DEFERRED-028**

### D2 — Chaining auto-advances workflow (MINOR, related to D1)
`chaining.ts` (15.7) auto-emits a follow-up task when a request resolves `approved` or a motion
is `carried`. The **decision itself stays human/collective-driven** (the vote/approval is the
human gate), so "coordination remains human-driven" holds at the decision point. But the
*consequence* (task creation, then dependency-gated by D1) is automated — together they make the
system behave as an **active workflow engine**, not the "visibility/signaling only" framing of
the Phase 13 prose. Document the boundary; no code change implied. (Folded into DEFERRED-028.)

### D3 — Stale/inconsistent surface counts in docs (MINOR, doc hygiene)
- CLAUDE.md: "MCP tools (36 tools)"
- `docs/qc/e2e-test-plan.md`: "105 REST endpoints, 45 MCP tools, 23 GUI pages" (frozen at Phase 8D)
- Actual: higher — Phase 15 added ~10+ coordination tools (`create_topic`, `join_topic`,
  `post_task`, `claim_task`, `submit_request`, `propose_motion`, `cast_vote`, `raise_dispute`,
  `post_intake`, …) on top of the ~39 core.

Reconcile to a single source of truth during the WS-summary step. No DEFERRED entry.

## Audited and PASSING

| Goal / non-goal | Verdict | Evidence |
|---|---|---|
| **Not a messaging bus** (no actor→actor) | ✅ PASS | No `send_message`/recipient paths in board/requests/motions/disputes/intake; all flows through topic state |
| **No passive monitoring / conversation parser** | ✅ PASS | No background parser in services or worker; coordination is explicit MCP/REST calls only |
| **Self-hostable, minimal (works without queue/redis/neo4j)** | ✅ PASS | Coordination services are Postgres-only; no hard dep on QUEUE/REDIS/KG |
| **No enterprise IdP creep (SAML/SSO)** | ✅ PASS | Authz is an internal level model (`authority`/`coordination`/`execution`) + API-key/role; no SAML/OAuth/OIDC/LDAP |
| **Guardrails derived from lessons** | ✅ PASS | `guardrails JOIN lessons ON rule_id`; only active-parent guardrails enforced; `check_guardrails` intact |
| **Persistent cross-session memory is the spine** | ✅ PASS | Coordination events are a separate durable store by design (not a substitute for lessons); `search_lessons` unchanged |
| **No automated cross-repo code modification** | ✅ PASS | No write-to-repo automation added by Phases 13–15 |

## Triage summary
- Significant drift needing a product/doc decision: **D1** (+ D2) → **DEFERRED-028**.
- Doc hygiene: **D3** → handled in WS-summary (recount + single source of truth).
- All other goals/non-goals: faithful.
