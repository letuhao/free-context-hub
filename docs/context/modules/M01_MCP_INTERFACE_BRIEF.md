---
id: CH-M01  status: done  phase: MVP  depends-on: M04  updated: 2026-03-25
---

# Module Brief: M01 — MCP Interface Layer

## Outcome
Exposes all 5 ContextHub tools to MCP clients (Claude Code, Cursor) via
standard MCP protocol. Acts as the integration facade — contains no business
logic, only routing, auth, and response shaping.

## Scope
IN: Tool registration, request routing to M02–M05, JSON response formatting,
    workspace token auth, MCP stdio/SSE transport support
OUT: Business logic (delegated to M02–M05), REST API, any UI

## Acceptance
- [ ] AT-M01-01: All 5 tools register and appear in MCP tool discovery
- [ ] AT-M01-02: `index_project` delegates to M02 and returns status
- [ ] AT-M01-03: `search_code` delegates to M03 and returns structured matches
- [ ] AT-M01-04: `get_preferences` and `add_lesson` delegate to M04
- [ ] AT-M01-05: `check_guardrails` delegates to M05 and returns pass/fail
- [ ] AT-M01-06: Invalid workspace token → 401-equivalent error response
- [ ] AT-M01-07: All responses conform to defined JSON schema (no freeform text)

## API Surface
→ See WHITEPAPER.md §MCP Interface Layer for tool signatures
→ Contracts to be defined at SP-2

## Sub-phases
| SP | Scope | Status |
|---|---|---|
| SP-1 | Server scaffold + tool registration stubs | done |
| SP-2 | Tool routing to module services | done |
| SP-3 | Workspace token auth middleware | done |
| SP-4 | Integration wiring to live M02, M03, M04, M05 | done |
| SP-5 | Smoke test: full round-trip with MCP client | done |

Note: 6 tools shipped (bonus `delete_workspace` beyond original 5 in whitepaper).

## Risks (open)
- R-M01-01: MCP spec still evolving — pin `@modelcontextprotocol/sdk` version explicitly [medium]

## Recent Decisions
- DEC-001: TypeScript + `@modelcontextprotocol/sdk` chosen [2026-03-25]
