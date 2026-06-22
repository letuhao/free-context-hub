# Release Readiness — v0.1.0

Master tracker for the pre-release QC program. Durable across sessions; this is the
source of truth for what must happen before tagging `v0.1.0`. Chat is ephemeral —
update this file as work lands.

**Branch:** `release/v0.1.0-prep` · **Started:** 2026-06-22

---

## A. Scaffolding (done)

- [x] LICENSE/MIT alignment, `package.json` → 0.1.0, description/author/keywords
- [x] CONTRIBUTING, CODE_OF_CONDUCT, SECURITY, CHANGELOG, issue/PR templates
- [x] CI workflow (`ci.yml`: backend typecheck + GUI build)
- [x] `FEATURES.md` + `docs/features/` (11 areas) + `docs/USER_GUIDE.md`
- [x] In-app `/guide` page (verified: prerenders, nav-wired)
- [x] Gate 1 — docs↔source verified (104/104 tools, all routes, REST coverage complete)
- [x] Unit tests green (1329 pass / 0 fail) on live stack
- [x] Stale "36 tools" counts corrected → 104

## B. Fix-list — build before release (user decision 2026-06-22)

> Decision: the product gaps surfaced in scenario brainstorming are **in scope** for v0.1.0.

| ID | Gap | Scope (proposed) | Status |
|----|-----|------------------|--------|
| FIX-1 | No human GUI for coordination primitives (topics, board, tasks, leases) | TBD — read-only viewer vs full CRUD | ☐ scoping |
| FIX-2 | No human GUI for governance primitives (motions/voting, requests/DoA, intake, disputes, decision bodies/proxies) | TBD — read-only viewer vs full CRUD | ☐ scoping |
| FIX-3 | No MCP tool for document upload/ingest (REST/GUI only) | Add `ingest_document` MCP tool (URL + maybe base64) | ☐ |
| FIX-4 | `reflect`/`compress_context` have no dedicated GUI | Minor — surface in a tool/panel | ☐ |

> **FIX-1/FIX-2 need a scope decision** (viewer vs full CRUD) before building — they are
> L/XL each. See "Open scope decisions" below.

## C. Security verifications — confirm before release (P0)

These are **hypotheses** from the adversary scenarios; verify against the live stack.
If any reproduces → release blocker.

| ID | Scenario | Hypothesis | Status |
|----|----------|-----------|--------|
| SEC-A | SCN-ADV-06 | Retired legacy workspace token still accepted on REST (admin bypass) | ✅ DEFENDED — legacy token set + disabled flag on; `GET /api/lessons` w/ legacy Bearer → `401 "legacy single-shared token disabled"` (REST mirrors MCP) |
| SEC-B | SCN-ADV-17 | Bootstrap-token abuse → root takeover on fresh/re-exposed deploy | ✅ DEFENDED — `/bootstrap/status` no-token → `401` (no recon oracle); `/root` empty/wrong token → `401` (no rogue root) |
| SEC-C | SCN-ADV-11 | DNS-rebinding TOCTOU on `ingest-url` / `pull-from` → metadata exfil | ✅ DEFENDED (code+tests) — `urlFetch.ts` pre-validates DNS, **pins** the IP (no 2nd lookup), re-checks each of ≤5 redirect hops, strips `Authorization` cross-origin; `pinnedHttpAgent.test.ts` green |

> Live re-probe of SEC-B against a real rebinding DNS harness is deferred (structural
> proof via pinning is sufficient); add to the Gate-5 negative-test suite for regression.

## D. Coordination edges to confirm (from coord brainstorm)

- [ ] `coordination_events.seq` allocation under true concurrency
- [ ] SSE live-push vs cursor replay correctness
- [ ] Cross-instance `actor_id` remap on import
- [ ] `check_guardrails` interaction with coordination writes

## E. Scenario execution — all 94, one by one (user decision: no priority skipping)

Status legend: ☐ pending · 🔎 testing · 🐛 bug found · ✅ pass · 🔧 fixed

| Suite | File | Count | Pass | Bugs | Pending |
|-------|------|-------|------|------|---------|
| GUI user | `scenarios/01-gui-user.md` | 22 | 0 | 0 | 22 |
| MCP agent | `scenarios/02-mcp-agent.md` | 24 | 0 | 0 | 24 |
| Multi-agent coord | `scenarios/03-multi-agent-coordination.md` | 26 | 0 | 0 | 26 |
| Adversary/abuse | `scenarios/04-adversary-abuse.md` | 22 | 0 | 0 | 22 |
| **Total** | | **94** | **0** | **0** | **94** |

Per-scenario status is tracked inline in each file (append a **Status:** line as verified).

## F. Test harness (Gates 4–6)

- [ ] Playwright specs for GUI scenarios
- [ ] MCP/REST automated tests for agent + coordination + adversary scenarios
- [ ] Playwright MCP + computer-vision pass for UX/visual defects
- [ ] Bug triage + fixes
- [ ] Full e2e suite green (authenticated, hardened stack)

## Open scope decisions (need owner input)

1. **FIX-1/FIX-2 GUI depth:** read-only monitoring views, or full create/act CRUD for
   coordination + governance? (Drives weeks of work either way.)
2. **e2e auth mode:** run the suites authenticated against the hardened stack (needs a
   minted Bearer token path) vs default auth-off. (User chose authenticated.)

---

## Ship gate

`v0.1.0` is tagged only when: B (or explicitly deferred), C (all clear), E (all
scenarios pass or bugs fixed), and F (e2e green) are complete.
