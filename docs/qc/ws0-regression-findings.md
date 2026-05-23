# WS0 — Regression run findings (milestone review)

**Date:** 2026-05-23
**Branch:** `milestone-review-phase-15`
**Suite:** existing E2E (`test/e2e/`), last run before this was 2026-05-15
**Stack:** local `docker compose` (all services up), embeddings via LM Studio `text-embedding-bge-m3`

## Verdict

**The existing E2E suite still passes on current `main`.** No real regressions from Phase
13.x / 14 / 15 in the surfaces the suite covers.

| Layer | Result | Notes |
|---|---|---|
| Smoke (`test:e2e:smoke`) | 111/111 | 2 cold-start failures on first run = infra (embeddings unloaded); 111/111 once warm |
| API scenarios (`test:e2e:api`) | 105/105 | several `phase13-auth-scope` tests **skipped** (auth-off baseline) — see F5 |
| GUI (`test:e2e:gui`) | 52/52 | 1 failure on first run (phase10 extraction) = infra (embeddings unloaded mid-request); 7/7 on warm re-run |
| Agent (`test:e2e:agent`) | 9/9 | — |

## Findings

### F1 — Embedding model JIT-unloads under idle/contention (INFRA, not a product bug)
LM Studio unloads `text-embedding-bge-m3` between bursts ("Model has not started loading /
has been unloaded", "Model was unloaded while the request was still in queue"). Caused all
first-run failures. **Action:** pin the model (disable auto-unload / raise idle TTL) for E2E
runs. Resolved during this run by warming the model. No code change.

### F2 — Hard 500 when embeddings unavailable (DRIFT from Phase 6; real)
`searchLessons` ([lessons.ts]), `updateLesson`, and `runExtraction`
([extraction/pipeline.ts]) propagate `embedTexts` HTTP 400 as an unhandled 500. Phase 6's
design promised **graceful fallback when the model is unavailable** (tiered search → FTS).
Drift: search should degrade to FTS; write paths (update/extract) should enqueue re-embed as
a job rather than failing the request. → **DEFERRED-025**

### F3 — global search references a non-existent column (REAL BUG)
[globalSearch.ts:80](src/services/globalSearch.ts#L80) runs
`SELECT sha, message, author, committed_at AS date` against `git_commits`, but that table has
`author_name` / `author_email` (migration 0005), **no `author`**. The per-source error is
swallowed, so smoke stays green while the **commits section is silently dropped** from global
search results. Fix: `author` → `author_name` (or alias). → **DEFERRED-026**

### F4 — `updateLessonStatus` leaks a raw SQL 500 on a bad uuid (REAL BUG)
Observed `error: invalid input syntax for type uuid: "undefined"` from `updateLessonStatus`
(`lessons.ts` ~status path) reaching the client as a 500. A malformed/absent id (or
`superseded_by`) should be validated and returned as **400**, not leaked as an unhandled DB
error. → **DEFERRED-027**

### F5 — tenant-scope / authz paths are NOT exercised E2E (COVERAGE GAP → WS2)
All `phase13-auth-scope` scenario tests **skip** under the auth-off baseline. The Phase 15
authorization model (15.11), tenant-scope middleware (DEFERRED-004/15.12), and `run-next`
scoping (DEFERRED-024) therefore have **zero end-to-end coverage**. WS2 must run an
auth-ON slice. No DEFERRED entry — this is WS2 scope.

## Triage summary
- Infra: F1 (and the two derived first-run failures).
- Real bugs to fix in dedicated tasks: F3 (DEFERRED-026), F4 (DEFERRED-027).
- Drift to address: F2 (DEFERRED-025).
- Coverage gap feeding WS2: F5.
