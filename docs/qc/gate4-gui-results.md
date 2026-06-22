# Gate 4 — GUI scenario execution results

Live execution of `docs/qc/scenarios/01-gui-user.md` (22 scenarios) against the hardened
(auth-ON) stack at `:3002`, signed in as `qc-operator` (global admin), via Playwright MCP.

Legend: ✅ pass · 🐛 bug (logged) · 🔧 fixed · ⏭️ blocked/skipped (reason) · 🔵 note

| # | Scenario | Result | Notes |
|---|----------|--------|-------|
| 01 | Review Inbox — approve | ✅ | approve → pending 16→15, lesson removed, 0 console errors |
| 02 | Review Inbox — reject w/ reason | ✅ | dialog: lesson title + Reason dropdown (defaults "Inaccurate", not empty) + optional note + Cancel/Reject; cancelled to preserve real lesson |
| 03 | Capture lesson manually | ✅ (renders) | /lessons library renders via session cookie (list, Type/Status/Tags, Add Lesson, Import/Export, filter tabs), 0 errors; add-dialog spot-checked |
| 04 | Semantic lesson search | — | |
| 05 | Edit lesson + version history | — | |
| 06 | Bulk approve/archive + import CSV/MD | — | |
| 07 | Guardrail simulate / what-would-block | — | |
| 08 | Browse + add guardrail | — | |
| 09 | Git ingest → suggest lessons | — | |
| 10 | Tiered code search + kind filter | — | |
| 11 | Symbol graph + trace dependency | — | |
| 12 | Upload PDF → extract → chunk search | — | |
| 13 | Ingest URL (SSRF-hardened) | — | |
| 14 | Generated docs → promote to lesson | — | |
| 15 | Generate API key bound to principal | — | |
| 16 | Revoke API key | — | |
| 17 | Rotate credential + ephemeral key | — | |
| 18 | Grant/revoke capability (delegation) | — | |
| 19 | Export/import knowledge bundle (dry-run) | — | |
| 20 | Create project group | — | |
| 21 | Agent audit trail + trust | — | |
| 22 | Enqueue job + system health | — | |

## Findings detail

(appended as scenarios run)
