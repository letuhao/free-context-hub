# DEFERRED-051/052/053/054 — CLARIFY+DESIGN: F2g-flip least-privilege & robustness batch

**Date:** 2026-06-21 · Size **M** (4 source + tests) · auth OFF (inert). All four are latent/worker-only
hardening items whose trigger is "the flip's authz audit." Batched as one coherent least-privilege pass.

## DEFERRED-051 — `runJobById` claims-then-strands on denial
`src/services/jobExecutor.ts` — `runJobById` calls `claimQueuedJobById` (marks the job `running`) BEFORE its
authz gate. A denied caller leaves the job stranded in `running`. Worker-only today (system principal, never
denied) → latent. **Fix:** peek the job's `project_id` with a non-claiming `SELECT` and gate BEFORE claiming;
only claim once authorized. A not-queued/missing job → `idle` (unchanged). No claim happens on denial → no
strand. (TOCTOU on project_id is benign — a job's project_id never changes.)

## DEFERRED-052 — `loadLeafBodiesFromDb` unguarded raw read
`src/services/builderMemoryLarge.ts` — the private `loadLeafBodiesFromDb(projectId, runId)` issues a raw
`SELECT … FROM generated_documents` with no authz, and runs as the FIRST DB op in
`buildLargeRepoProjectMemory` (before the first `upsertGeneratedDocument` gate). The parent already carries
`input.actingPrincipalId`. **Fix:** thread it in — `loadLeafBodiesFromDb(projectId, runId, actingPrincipalId)`
— and `assertAuthorized(actingPrincipalId, 'read', {kind:'project', id: projectId})` at the top. auth-off →
no-op.

## DEFERRED-053 — `hasUsableSystemIdentity` allows a broader-than-write system grant
`src/services/bootstrap.ts` — the gate requires an active `global write` grant EXISTS but does not forbid the
system principal ALSO holding admin/delegate/other grants. `bootstrapSystem` only ever mints `global write`,
so the supported flow is bounded — but an operator who hand-grants admin escapes the gate's least-privilege
intent. **Fix:** additionally require the system principal holds NO active grant OTHER than that single
`global write` (i.e. `NOT EXISTS` an active grant for it that isn't `scope_type='global' AND capability='write'`).
So enforce-ready REFUSES a system principal carrying any broader grant — least-privilege is now enforced, not
just assumed. (`global write` already covers read via the capability lattice, so one grant suffices.)

## DEFERRED-054 — suspending the system principal bricks the worker (availability)
`src/services/principals.ts` — `setPrincipalStatus` guards `is_root = false` (root status is axiomatic) but
not `is_system`. The system principal is a hard singleton (`principals_single_system_uniq ON (is_system) WHERE
is_system=true` — one row EVER, any status), and suspending/retiring it strips authorization from every root it
stamped → the index/embed/knowledge pipeline breaks worker-wide. **Fix:** extend the guard to `is_system =
false` too, so the singleton system principal cannot be suspended/retired through the normal path (mirrors
`is_root`); a typed CONFLICT explains why. Rotation (delete + reseed) is an explicit destructive op, out of
scope. Fail-safe: the worker identity stays available.

## Acceptance criteria
1. `runJobById`: a denied caller does NOT claim the job (it stays `queued`); the worker (global) still runs it.
2. `loadLeafBodiesFromDb`: rejects a non-reader (auth-on) before the raw read; the worker (global) passes.
3. `hasUsableSystemIdentity`: returns false if the system principal holds any active grant beyond `global write`
   (e.g. a hand-granted `global admin`); true for exactly-write.
4. `setPrincipalStatus`: suspending/retiring the system principal → CONFLICT; a normal principal still toggles.
5. auth-OFF behavior unchanged. Full suite green, tsc clean. `MCP_AUTH_ENABLED` flip NOT touched.
