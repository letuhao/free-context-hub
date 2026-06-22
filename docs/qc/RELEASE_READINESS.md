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
| FIX-1 | No human GUI for coordination primitives (topics, board, tasks, leases) | **Full CRUD** (decided) — see [GUI design](../specs/2026-06-22-coordination-governance-gui-design.md) | ✅ DONE — G1 (list endpoint), G2 (topics list+detail), G3 (board+leases). Commits e1de2f9, db0f3c7, 9373319 |
| FIX-2 | No human GUI for governance primitives (motions/voting, requests/DoA, intake, disputes, decision bodies/proxies) | **Full CRUD** (decided) | ✅ DONE — G4 (bodies+motions 14f4ba0), G5 (requests d366d00), G6 (intake+disputes 0cb47be) |
| FIX-3 | No MCP tool for document upload/ingest (REST/GUI only) | `ingest_document` MCP tool (URL) | ✅ DONE (M1) — shared `ingestUrlAsDocument` service (authz-before-fetch hardening), REST route delegates, tool registered (104→105); 4 unit tests incl. cross-tenant reject |
| FIX-4 | `reflect`/`compress_context` have no dedicated GUI | reflect GUI added (compress stays MCP-only — no REST endpoint) | ✅ DONE (M2) — `/knowledge/reflect`: topic → top-lessons → synthesis + sources |
| FIX-5 | **GUI cannot authenticate on the hardened (auth-ON) default** — every `/api/*` 401s, project-list silently degrades to "create your first project". Root cause: login stack (`/login`, `authApi`, session cookie) already existed but **nothing redirected an unauthenticated visitor to `/login`**. | ✅ DONE (W1) — `AuthGate` (gui `contexts/auth-context.tsx`) resolves `/api/me` once → renders / redirects `/login?next=` / retries; login honors `?next=`. **Verified live tokenless:** unauth → `/login` → sign-in → page loads, 0 console errors, no baked client token. + W2 actor UX, W3 fixes, W4 runbook (`docs/ops/auth-bring-up.md`). |

> **FIX-1/FIX-2 need a scope decision** (viewer vs full CRUD) before building — they are
> L/XL each. See "Open scope decisions" below.

## B2. Gate 4–6 live findings (this QC pass)

| ID | Finding | Status |
|----|---------|--------|
| BUG-ADDLESSON | **P0 — `add_lesson` broken under auth-ON.** `POST /api/lessons` / MCP `add_lesson` / GUI "Add Lesson" all returned `404 NOT_FOUND` for every authenticated caller on the hardened stack. Root: `validateLessonType → getValidLessonTypes → getActiveProfile` ran a nested read-authz check without the threaded principal → `undefined` denies under `MCP_AUTH_ENABLED=true`. Only manifested auth-ON (auth-OFF short-circuits) → missed by prior tests. | ✅ FIXED (`075ce4d`) — thread `actingPrincipalId`; live-verified 201 on REST + MCP. |
| BUG-VERSIONS | **P1 — `list_lesson_versions` MCP tool unusable.** Returned MCP output-validation error (`changed_at`: expected string, received Date) for every call → an agent cannot read lesson version history over MCP. Root: service returned raw pg rows (Date); REST hides it via `res.json()` but the MCP SDK validates the raw object against `z.string()`. Same pg-Date-vs-MCP-string class. **NOTE:** ~40 other MCP output schemas declare `*_at: z.string()`; coordination scenarios exercised many (`list_active_claims`, `replay_topic_events`, `get_topic`, review queue) — all returned ISO strings, no sibling failures observed. | ✅ FIXED — ISO-coerce in `listLessonVersions`; re-verified over MCP. |
| FINDING-GOV | **Governance-semantics decision.** `search_lessons` + all retrieval returned `draft`+`pending-review` by default; a just-submitted pending-review lesson came back as #1 hit — contradicting "pending-review ≠ active knowledge until approved." | ✅ RESOLVED — **owner chose strictest gate (2026-06-22):** semantic retrieval (`searchLessons`/`searchLessonsMulti`) now defaults to `status = 'active'`; `include_all_statuses=true` opts back in. Human-browse `listLessons` intentionally unchanged. Live-verified (pending-review hidden by default, returned with the flag) + 3 regression tests. `add_lesson`-mints-active left as intended (review is opt-in via submit_for_review). |

Gate 4–6 scenario results: `docs/qc/gate4-gui-results.md`, `docs/qc/gate56-mcp-adversary-results.md`.
Live-passed so far: GUI-01/02/03, MCP-01–09/20–24, ADV-01/05/06/17. Bugs fixed this pass: BUG-ADDLESSON (P0), BUG-VERSIONS (P1).

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
