# QC Scenarios

Production-grade usage scenarios for free-context-hub, brainstormed from four
role perspectives. These drive the Playwright / MCP / vision test suites
(Gates 4–6 of the release QC program). Every scenario is grounded in a **real**
feature — verified against [`FEATURES.md`](../../../FEATURES.md) and the code.

| File | Role lens | Scenarios |
|------|-----------|-----------|
| [01-gui-user.md](01-gui-user.md) | Human operator (web GUI) | 22 |
| [02-mcp-agent.md](02-mcp-agent.md) | AI coding agent (MCP) | 24 |
| [03-multi-agent-coordination.md](03-multi-agent-coordination.md) | Multiple agents + humans coordinating | 26 |
| [04-adversary-abuse.md](04-adversary-abuse.md) | Authorized white-hat abuse testing | 22 |
| **Total** | | **94** |

**Priority distribution:** 41 P0 · 38 P1 · 15 P2.

## Scenario schema

Each scenario carries: an ID (`SCN-<ROLE>-<NN>`), priority, capability area /
abuse class, persona/actors, the surfaces it touches (GUI route / MCP tool / REST
endpoint), preconditions, numbered steps, observable expected outcomes, and the
bug/UX risks to watch for. This maps 1:1 to a Playwright/automated test in Gate 4.

## Cross-cutting findings (surfaced during brainstorming)

These are **product observations** to triage, not test failures:

1. **Coordination & most Governance primitives have no human GUI** (topics, board,
   leases, motions, voting, requests, intake, disputes) — they are MCP/REST-only.
   The only GUI governance touchpoints are the Review Inbox and read-side audit/
   activity views. Likely intentional (agent-facing protocol) — decide whether to
   document as such for v0.1.0.
2. **No MCP tool for document upload/ingest** — `/api/documents/upload` and
   `/ingest-url` are REST/GUI only, so an agent can `search_document_chunks` but
   cannot ingest a document over MCP.
3. **`reflect` / `compress_context` have no dedicated GUI** (`reflect` surfaces only
   indirectly via `/chat`).
4. **Coordination edges to confirm:** `coordination_events.seq` allocation under true
   concurrency; SSE live-push vs cursor replay; cross-instance `actor_id` remap on
   import; `check_guardrails` interaction with coordination writes.

## Highest-risk scenarios to verify first (adversary)

- **SCN-ADV-06** — retired legacy workspace token still accepted on REST (SEC-7
  doc/impl mismatch → admin-role bypass).
- **SCN-ADV-17** — bootstrap-token abuse → root takeover on a fresh/re-exposed deploy.
- **SCN-ADV-11** — DNS-rebinding TOCTOU on `ingest-url` + `pull-from` → metadata
  credential exfiltration.

These are **hypotheses** until verified; if any reproduces, it is a release blocker.
