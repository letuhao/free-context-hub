# Milestone Review Summary — Phases 9–15

**Date:** 2026-05-23
**Branch:** `milestone-review-phase-15`
**Baseline:** 723 unit tests → **728** at close; `tsc` clean; full E2E suite green.
**Plan:** `docs/qc/milestone-review-phase-15.md`

## What was done

| Work-stream | Status | Output |
|---|---|---|
| **WS0** — regression run of the existing 191-test E2E suite (all 15 phases) | ✅ done | `ws0-regression-findings.md` — suite still passes; 5 findings |
| **WS1** — feature-drift audit vs WHITEPAPER (all 15 phases) | ✅ done | `ws1-drift-audit-findings.md` — 1 significant drift, rest faithful |
| **WS3** — cross-phase seam bug-hunt | ✅ done | `ws3-seam-bughunt-findings.md` — 1 significant gap, rest guarded |
| **WS2** — write new E2E for Phases 9–15 | ⏸️ deferred | A focused follow-up effort (smoke + scenario + GUI Playwright + auth-ON slice incl. MCP) |

WS2 was intentionally split out: it is a ~2–3 day test-writing effort best reviewed
separately from the audit + fixes. The auth-ON slice must cover the **MCP path** (per WS3-S3 /
WS0-F5), so it is naturally sequenced after DEFERRED-029.

## Headline outcome

- **No real regressions** from Phases 13.x/14/15 in any covered surface — the existing E2E
  suite still passes on `main`. (First-run failures were infra: the embedding model JIT-unloads.)
- The system is **largely faithful** to its WHITEPAPER goals/non-goals. Audited and PASSING:
  not-a-messaging-bus, no-passive-monitoring, self-hostable-minimal, no-IdP-creep,
  guardrails-derived-from-lessons, persistent-memory spine, no-cross-repo-automation,
  DEFERRED-007 (discriminated-union MCP crash) not regressed.

## Findings & disposition (5)

| ID | Sev | Finding | Disposition |
|---|---|---|---|
| **026** | MED | global search selected non-existent `author` col on `git_commits` → commits silently dropped | ✅ FIXED (`author_name AS author` + regression test) |
| **027** | LOW-MED | `updateLessonStatus`/`updateLesson` leaked raw uuid SQL 500 | ✅ FIXED (service-layer `assertUuid` → 400; 3 tests) |
| **025** | MED | hard 500 when embeddings unavailable (drift from Phase 6 fallback promise) | ✅ FIXED (search → FTS fallback; writes → clean 503; test + live-verified) |
| **028** | LOW | Board is a task orchestrator (`depends_on` gating + `raci`) vs Phase 13 non-goal | ✅ RESOLVED (doc: WHITEPAPER non-goal scope note acknowledging dependency-sequenced coordination) |
| **029** | MED | tenant isolation enforced on REST but **absent on MCP** (binary shared token, no per-project scope) | 📋 SCOPED + SCHEDULED — multi-tenant IS a goal; mechanism = explicit `callerScope` param in the service layer + scoped MCP tokens; its own post-review phase with DESIGN + security review |

## Doc reconciliation (WS1-D3)

Surface counts were stale/inconsistent. Actual at this milestone:
- **MCP tools:** ~50 (≈39 core via `name:` + ~10 Phase 15 coordination tools). CLAUDE.md said
  "36"; `e2e-test-plan.md` said "45" (frozen at Phase 8D). **Action:** treat `src/mcp/index.ts`
  as the source of truth; the WS2 MCP-smoke layer will enumerate the exact count.
- REST endpoints / GUI pages similarly grew through Phases 9–15; reconcile when WS2 lands its
  smoke layer (one test per surface gives an authoritative count).

## New deferred items opened this review
- DEFERRED-025 (RESOLVED), 026 (RESOLVED), 027 (RESOLVED), 028 (RESOLVED), 029 (OPEN, scheduled).

## Next steps
1. Merge this branch (audit + 4 fixes + docs).
2. **DEFERRED-029** as a dedicated phase (DESIGN + security review; Option B explicit scope param + scoped MCP tokens).
3. **WS2** E2E for Phases 9–15 (after 029 so the auth-ON slice can exercise scoped MCP).
