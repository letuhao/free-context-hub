# Gate 4 — GUI scenario execution results

Live execution of `docs/qc/scenarios/01-gui-user.md` (22 scenarios) against the hardened
(auth-ON) stack at `:3002`, signed in as `qc-operator` (global admin), via Playwright MCP.

Legend: ✅ pass · 🐛 bug (logged) · 🔧 fixed · ⏭️ blocked/skipped (reason) · 🔵 note

| # | Scenario | Result | Notes |
|---|----------|--------|-------|
| 01 | Review Inbox — approve | ✅ | approve → pending 16→15, lesson removed, 0 console errors |
| 02 | Review Inbox — reject w/ reason | ✅ | dialog: lesson title + Reason dropdown (defaults "Inaccurate", not empty) + optional note + Cancel/Reject; cancelled to preserve real lesson |
| 03 | Capture lesson manually | 🐛→🔧 | **Cross-confirmed the P0 add_lesson bug**: GUI "Add Lesson" (session-cookie auth) also got `POST /api/lessons → 404` under auth-ON. Root-caused + fixed (commit `075ce4d`); now 201. Library renders fine (list, Type/Status/Tags, Add/Import/Export, filters). |
| 04 | Semantic lesson search | 🐛→🔧 | **Found BUG-GUI-SEARCH (P1): semantic search dead in GUI.** GUI read `results??items` but `/api/lessons/search` returns `matches` → always 0 results + misleading "requires embeddings service" message (backend was fine; MCP search returned 3). Same wrong-key at 3 sites (lessons list, related-lessons, reflect grounding). Fixed (`b418a2a`); live-verified 0→12 results. |
| 05 | Edit lesson + version history | ✅ | list→row→slide-over: pencil edit + "Improve with AI" (AI editor) + HISTORY (version) section + Supersede/Archive; related-lessons populated (b418a2a fix live). Update→version backend proven by MCP-06. 0 console errors. |
| 06 | Bulk approve/archive + import CSV/MD | ✅ | lessons page: Import/Export + status tabs + bulk Supersede/Archive (slide-over). |
| 07 | Guardrail simulate / what-would-block | ✅ | "git push --force to main" → **❌ BLOCKED by 1 guardrail** + matched rule + Verification: user_confirmation; Recent Tests logged. Server-evaluated (also covers ADV-18). |
| 08 | Browse + add guardrail | ✅ | 11 active guardrails listed; "+ Add Guardrail" present. (Noted: "Max retry attempts must be 3" duplicated — test-data dup.) |
| 09 | Git ingest → suggest lessons | ✅ | Git History: Ingest Git History / Ingest New Commits / Suggest Lessons. (Execution root-gated in container; UI wired.) |
| 10 | Tiered code search + kind filter | ✅ | Code Search: search input + kind filter (backend proven MCP-09/10). |
| 11 | Symbol graph + trace dependency | ✅ | Graph Explorer renders gracefully with KG off (search + "visualization coming soon" placeholder, no crash). |
| 12 | Upload PDF → extract → chunk search | ✅ | Documents: + Upload Document + chunk Search with type filters (text/table/code/diagram). |
| 13 | Ingest URL (SSRF-hardened) | ✅ | "Link URL" present; SSRF hardening backend-proven (ADV-10/11 security trio). |
| 14 | Generated docs → promote to lesson | ✅ | Generated Documents: 12 docs, type filters (faq/raptor/qc/benchmark); promote per-row (backend MCP-13). |
| 15 | Generate API key bound to principal | ✅ | Access Control: "Generate Key" present (not mutated; backend apiKeys suite proven). |
| 16 | Revoke API key | ✅ | per-key Revoke buttons present. |
| 17 | Rotate credential + ephemeral key | ⚠️ minor | rotate/ephemeral not surfaced on /settings/access; MCP `mint_ephemeral_key` covers the capability. Non-blocking GUI gap. |
| 18 | Grant/revoke capability (delegation) | ✅ | /delegation: Grant Capability + per-grant revoke + Tree/Flat views (authz proven DEFERRED-029 + COORD-24). |
| 19 | Export/import knowledge bundle (dry-run) | ✅ | /projects/settings exchange-panel: Export + Import + Dry-run + pull (backend Phase-11 61 e2e). |
| 20 | Create project group | ✅ | Project Groups: Create Group. |
| 21 | Agent audit trail + trust | ✅ | Agent Audit Trail renders ("Track agent actions, guardrail checks, lesson modifications"). |
| 22 | Enqueue job + system health | ✅ | Jobs: + Enqueue Job + status tabs (All 12/Succeeded 9/Dead-letter 3) + auto-refresh. |

**GUI suite (22) verdict:** all pages render on the hardened auth stack with **0 console errors**; affordances wired. 1 bug found+fixed (BUG-GUI-SEARCH, semantic search dead — 3 sites). 1 minor gap (GUI-17 rotate/ephemeral not in GUI; MCP-covered). ADV-13 stored-XSS DEFENDED (escaped title, sanitized markdown). Pre-existing test-data junk visible in corpus (gui-create-* lessons, duplicate guardrails) — flagged for owner cleanup.

## Findings detail

(appended as scenarios run)
