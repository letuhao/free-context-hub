# DEFERRED-024 — run-next cross-project pop filter — CLARIFY (brief)

**Date:** 2026-05-21
**Workflow:** v2.2 size-S (CLARIFY brief + BUILD + VERIFY; skip DESIGN/PLAN)
**Branch:** `run-next-scope-deferred-024` (from `tenant-scope-audit-deferred-004`)
**Status:** DRAFT — pending human approval

## Scope
Close **DEFERRED-024** (the Tier-2 hole from DEFERRED-004): `POST /api/jobs/run-next`
pops the next queued job across ALL projects (`runNextJob(queue) → claimNextQueuedJob
(queue)` has no project filter). A project-scoped api key calling it can run another
project's queued job. Fix: thread an optional `projectScope` into the pop so a scoped
key drains only its own project's queue.

## Chain
`POST /jobs/run-next` → `runNextJob(queueName)` (jobExecutor.ts:507) →
`claimNextQueuedJob(queueName)` (jobQueue.ts:100) — the `next_job` CTE selects
`WHERE status='queued' AND queue_name=$1 AND available_at<=now()` with no project filter.

## Design (S, threaded param)
1. `claimNextQueuedJob(queueName='default', projectScope?: string | null)` — when
   `projectScope` is a non-empty string, add `AND project_id = $2` to the `next_job`
   CTE. When `undefined`/`null` → unchanged (pop across all projects).
2. `runNextJob(queueName='default', projectScope?: string | null)` — pass through.
3. `POST /jobs/run-next` route → `runNextJob(req.body.queue_name, req.apiKeyScope)`.
   `req.apiKeyScope`: `undefined` (auth-off) / `null` (global) → no filter (drain all);
   a scoped string → filter to that project.

The background worker (`worker.ts`) calls `runNextJob` with no scope → unchanged
(drains all). Only the REST endpoint with a scoped key filters.

## ACs
- **AC1** — `claimNextQueuedJob(queue, scope)` with a scoped string returns only a job
  whose `project_id = scope`; a queued job in another project is NOT claimed.
- **AC2** — `claimNextQueuedJob(queue)` / `(queue, null)` / `(queue, undefined)` →
  unchanged (claims the next job regardless of project).
- **AC3** — a scoped key's `run-next` skips a null-project (global) job (a scoped
  worker drains only its own project; correct).
- **AC4** — auth-off / global key → drains any project (no regression; worker unchanged).

## Note
`req.apiKeyScope` is only set under `MCP_AUTH_ENABLED=true`; auth-off (dev) → undefined
→ no filter (dev posture preserved, consistent with DEFERRED-004).

## Sign-off
- [ ] Spec approved → BUILD (size S, skip DESIGN/PLAN)
