# F2g / DEFERRED-048 — re-validate `payload.root` at job EXECUTION time: CLARIFY

**Branch:** `feature/actor-data-boundary` · **Date:** 2026-06-20 · Size **M**. Auth stays OFF (inert).
Security-sensitive (arbitrary-filesystem capability) → cold-start adversary at REVIEW.

## The gap (from DEFERRED-048)
`payload.root` lets a job index an ARBITRARY filesystem path (`resolveProjectRoot` honors `explicitRoot`
unconditionally — `src/utils/resolveProjectRoot.ts:31`). The enqueue gate (`28ec95f`,
`jobQueue.enqueueJob:91`) blocks a NON-global principal from SETTING `payload.root`. But:
- (a) rows enqueued before the flip (or while auth was OFF, where `hasGlobalGrant` returns true for
  everyone) already carry arbitrary `payload.root` with no provenance;
- (b) execution honors `payload.root` UNCONDITIONALLY — a write-time-only gate is weaker than gating
  where the capability is USED, across the durable async-queue boundary.

## Design (provenance stamp + exec re-verify) — largely forced by the F2g bounded worker
1. **Enqueue stamps the authorizer.** In `enqueueJob`, when `payload.root` is set (the gate already
   guarantees the enqueuer is global), stamp `payload.root_authorized_by = actingPrincipalId`. Internal
   re-enqueues (`enqueueChained`, post-F2g) carry the system principal → stamped with it. Under auth-off
   `actingPrincipalId` is null → stamp is null (inert; the exec check only fires under auth-on).
2. **Execution re-verifies.** In `jobExecutor.resolveRoot`, when `payload.root` is present AND
   `MCP_AUTH_ENABLED`: honor it ONLY if `payload.root_authorized_by` is present AND
   `hasGlobalGrant(root_authorized_by, 'write')`. This re-checks the provenance where the capability is
   used; no `actingPrincipalId` threading needed (the authorizer rides in the payload). The check reads
   the stamp, not the executing worker — so a revoked authorizer is caught at exec.

### Decisions (stated; security-forced — POST-REVIEW is the gate)
- **Capability = global `write`, NOT global `admin`.** The F2g system worker is bounded to global-write
  by design, and its OWN repo chains (`repo.sync` → `index.run` with the repo-cache root, which escapes
  the project tree) need `payload.root`. Requiring global-`admin` would break the bounded worker. So the
  root capability must be exactly what the worker holds: global write. (Rejects the DEFERRED note's
  "consider global-admin" — it is incompatible with the bounded-worker decision.)
- **Unstamped / unauthorized root under auth-ON ⇒ THROW (fail the job loudly), not silent fallback.**
  Falling back to the project-config root would silently index a DIFFERENT tree than the job intended —
  worse than a visible failure. A `FORBIDDEN` with "re-enqueue under enforcement" is the conservative,
  surfaced behavior. Pre-flip leftover rows fail visibly (and are drained before the flip — runbook).
- **Flip runbook gains a step:** drain the job queue before flipping `MCP_AUTH_ENABLED`, so no pre-stamp
  rows remain to fail. The exec check is the belt-and-suspenders for any that slip through.

## Also (from the DEFERRED note)
- Add an explicit unit test: a project/topic/task-scope grant ⇒ `hasGlobalGrant === false` (today proven
  only indirectly by jobqueue-authz's non-global cases).

## Acceptance criteria
1. Auth-ON: a job whose `payload.root` was stamped by a global principal → root honored (no throw).
2. Auth-ON: a job carrying `payload.root` with NO stamp (or a stamp whose principal lacks global write,
   e.g. revoked) → `resolveRoot` throws FORBIDDEN (not silently falling back).
3. Auth-OFF: behavior byte-for-byte unchanged (no stamp required, root honored — inert).
4. `hasGlobalGrant` returns false for a project/topic/task-scope grant (explicit test).
5. Worker internal chains (`repo.sync`→`index.run`) still work auth-ON (system-principal stamp).
6. tsc clean; full suite green; auth OFF.

## Out of scope (separate deferred items)
- DEFERRED-049 (resolveProjectIds authz + group namespace), DEFERRED-050 (notification identity),
  DEFERRED-051/052/053 (F2g least-privilege residuals), Domain 8, the flip itself.
