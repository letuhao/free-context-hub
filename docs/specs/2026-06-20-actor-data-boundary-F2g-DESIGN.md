# F2g sub-step 1 — System-worker identity: DESIGN

**Branch:** `feature/actor-data-boundary` · **Date:** 2026-06-20 · CLARIFY: `…-F2g-clarify.md`
**Decision (PO):** Option B — dedicated non-root `kind=system` principal, one `global write` grant.
**Threading:** explicit (no ambient/ALS authority) — confirmed bounded by reachability analysis below.

## Reachability analysis (why explicit threading is L, not XL)
F2f already gave `actingPrincipalId` to every guarded leaf AND most pipeline services the worker
reaches. The worker's `executeByType` fan-out, and the gap per service:

| executeByType calls | file | takes actingPrincipalId today? | action |
|---|---|---|---|
| `indexProject` | indexer.ts | ✅ (guarded) | forward from executeByType |
| `ingestGitHistory`, `analyzeCommitImpact` | gitIntelligence.ts | ✅ (guarded) | forward |
| `prepareRepo` | repoSources.ts | ✅ (guarded) | forward |
| `scanWorkspaceChanges` | workspaceTracker.ts | ✅ (guarded) | forward; **fix internal `indexProject` at :115 (drops principal)** |
| `upsertGeneratedDocument` | generatedDocs.ts | ✅ (guarded) | forward |
| `buildFaq` | faqBuilder.ts | ❌ calls `searchCode`/`upsertGeneratedDocument`/`addLesson` unprincipaled | **add param + forward** |
| `buildRaptorSummaries` | raptorBuilder.ts | ❌ calls `upsertGeneratedDocument` unprincipaled | **add param + forward** |
| `runQualityEvalAndPersist` | qcEval.ts | ❌ calls `searchCode`/`upsertGeneratedDocument`/`getGeneratedDocument` unprincipaled | **add param + forward** |
| `buildProjectMemoryArtifact` (via knowledge.loop.deep) | builderMemory.ts:374 | ❌ calls `upsertGeneratedDocument` unprincipaled | **add param + forward** *(REVIEW-DESIGN adv #1)* |
| `buildLargeRepoProjectMemory` (via knowledge.loop.deep + knowledge.memory.build) | builderMemoryLarge.ts:376,448,518,570 | ❌ calls `upsertGeneratedDocument` unprincipaled | **add param + forward** *(REVIEW-DESIGN adv #1)* |
| `runExtraction` (via document.extract.vision) | extraction/pipeline.ts:48 | ❌ self-guarded (`write@project`) but called with no principal | **forward (param already exists)** *(REVIEW-DESIGN tail-trace)* |
| internal `enqueueJob` re-enqueues (repo.sync, workspace.scan, faq/raptor/memory chains) | jobExecutor.ts | ✅ (guarded) | forward |
| `sweepExpiredLeases` (via leases.sweep) | artifactLeases.ts:467 | ✅ intentionally-global unguarded DELETE | **no change** (no per-project guard) |

Net code gaps to thread: **5 pipeline services + `runExtraction` forward + 1 internal call + executeByType
forwarding** — the rest is already plumbed. (Original DESIGN listed 3 pipeline services; REVIEW-DESIGN
adversary #1 caught the two builder-memory leaves, the tail-trace caught `runExtraction`.)

## The substrate (mirrors the existing `is_root` machinery exactly)

### 1. Migration `0067_system_principal.sql`
```sql
ALTER TABLE principals ADD COLUMN IF NOT EXISTS is_system BOOLEAN NOT NULL DEFAULT false;
COMMENT ON COLUMN principals.is_system IS
  'The one non-root machine identity internal callers (background worker / internal job execution) authenticate as. NOT root: least-privilege via a single global-write grant. Set only by bootstrap:system; never grantable. Partial unique index enforces at most one.';
-- at most one system-worker principal across the deployment (mirrors principals_single_root_uniq)
CREATE UNIQUE INDEX IF NOT EXISTS principals_single_system_uniq
  ON principals (is_system) WHERE is_system = true;
-- [REVIEW-DESIGN adv #2] the mutual-exclusion invariant must live in the DDL, not just prose.
ALTER TABLE principals
  ADD CONSTRAINT principals_root_xor_system_chk CHECK (NOT (is_root AND is_system));
```
Notes: `is_root` and `is_system` are mutually exclusive — enforced by the CHECK above (a row cannot be
both root and the system-worker), in addition to the separate seed paths. The CHECK is the real net:
if it were prose-only, a future bootstrap/backfill bug could make `getSystemPrincipal()` return the
root row → worker silently runs with root short-circuit ALLOW, the exact over-privilege Option B avoids.
(`ADD CONSTRAINT` is not `IF NOT EXISTS`-able pre-PG16; the migration guards with a `DO $$ … $$`
catch on duplicate_object so re-runs are idempotent.)

### 2. `principals.ts`
- `COLS` += `is_system`; `Principal` type += `is_system: boolean`.
- `getSystemPrincipal(): Promise<Principal | null>` — `SELECT … WHERE is_system = true LIMIT 1`.
- `seedSystemPrincipal({ display_name }): Promise<Principal>` — mirrors `seedRootPrincipal`:
  `INSERT … (kind, status, display_name, is_system) VALUES ('system','active',$1,true)`; pre-checks
  `getSystemPrincipal`; 23505 → typed CONFLICT (race-safe). `createPrincipal` stays is_system=false
  (only this path sets it), same guarantee as is_root.

### 3. `bootstrap.ts` — `bootstrapSystem()` + CLI `npm run bootstrap:system`
Idempotent, requires root first (root is the delegation origin for the grant):
```
1. root = getRootPrincipal(); if !root → CONFLICT "run bootstrap:root first"
2. sys = getSystemPrincipal()
3. if !sys → sys = seedSystemPrincipal({display_name: 'system-worker'})
4. ensure ONE active global-write grant on sys granted_by root:
   if none active → createGrant({grantee: sys, scope_type:'global', scope_id:null,
                                 capability:'write', granted_by: root.principal_id})
5. return {status: created|noop, principal: sys}
```
`createGrant` already enforces the delegation invariant; root (is_root) may grant anything. CLI at
`src/scripts/bootstrapSystem.ts`.

### 4. `bootstrap.ts` — enforce-ready gate
- `hasUsableSystemIdentity(): Promise<boolean>` — a single JOINed query (mirrors
  `hasUsableRootCredential`): the system principal is `status='active'` AND an active (`revoked_at IS
  NULL`) `scope_type='global' capability='write'` grant on it exists AND **that grant's `granted_by`
  resolves to an active root** (`principals.is_root=true AND status='active'`). Real DB check,
  **independent of MCP_AUTH_ENABLED** (unlike `hasGlobalGrant`, which short-circuits true under
  auth-off). [REVIEW-DESIGN adv #3a] — the granted_by-root join stops an orphaned/dangling grant from
  rubber-stamping enforce-ready.
- `assertEnforceReady()` gains: if `!(await hasUsableSystemIdentity())` → CONFLICT
  "not enforce-ready: no system-worker identity; run `npm run bootstrap:system` (else the worker is
  locked out at the flip)." Placed after the grant-backfill gate.

## The wiring (explicit threading)
### 5. `worker.ts`
After `applyMigrations()`, resolve ONCE:
`const systemPrincipalId = (await getSystemPrincipal())?.principal_id ?? null;`
- Pass `{ actingPrincipalId: systemPrincipalId }` to `runNextJob(queueName, undefined, …)` and into
  `runJobById(jobId, { actingPrincipalId: systemPrincipalId })`.
- **Auth-off tolerance:** if bootstrap:system hasn't run, `systemPrincipalId` is null — fine, because
  authorize() short-circuits ALLOW while auth is off. Under auth-on, `assertEnforceReady` guarantees
  it's non-null before anyone flips.
- **[REVIEW-DESIGN adv #3b] Fast-fail under auth-on:** at startup, if `MCP_AUTH_ENABLED` is true AND
  `hasUsableSystemIdentity()` is false, the worker logs `fatal` and `process.exit(1)` BEFORE entering
  the consume/poll loop — a clean, surfaced "misconfigured: run bootstrap:system" rather than every
  job silently dying in `failJob`. (Mid-run revocation after a healthy start is out of scope for this
  substrate step — it surfaces as job failures + logs; a live re-gate is noted as a follow-up, not a
  blocker, since `assertEnforceReady` already gates the flip itself.)

### 6. `jobExecutor.ts`
- `runJobById(jobId, opts?: { actingPrincipalId?: string | null })` — new opts; forward to executeByType.
- `executeByType(…, actingPrincipalId?: string | null)` — new trailing param; forward to every service
  call in the table above (incl. the internal `enqueueJob` re-enqueues and the deep
  `knowledge.loop.deep` body).
- `runNextJob` already carries `opts.actingPrincipalId` — forward it into executeByType.

### 7. Pipeline gaps
- `faqBuilder.buildFaq` — add `actingPrincipalId?` to params; forward to `searchCode`,
  `upsertGeneratedDocument`, `addLesson`.
- `raptorBuilder.buildRaptorSummaries` — add `actingPrincipalId?`; forward to `upsertGeneratedDocument`.
- `qcEval.runQualityEvalAndPersist` — add `actingPrincipalId?`; forward to `searchCode`,
  `getGeneratedDocument`, `upsertGeneratedDocument`.
- `builderMemory.buildProjectMemoryArtifact` — add `actingPrincipalId?`; forward to
  `upsertGeneratedDocument` (:374). [adv #1]
- `builderMemoryLarge.buildLargeRepoProjectMemory` — add `actingPrincipalId?`; forward to all four
  `upsertGeneratedDocument` calls (:376,448,518,570). [adv #1]
- `workspaceTracker.scanWorkspaceChanges` — forward `params.actingPrincipalId` into its internal
  `indexProject` call (line ~115).
- `extraction/pipeline.runExtraction` — already accepts `actingPrincipalId`; the
  `document.extract.vision` case in jobExecutor must FORWARD it (currently omitted). [tail-trace]
- `leases.sweep` → `sweepExpiredLeases` — **no change** (intentionally-global unguarded DELETE).

## Tests (TDD + AMAW)
- `principals.test.ts` += seedSystemPrincipal singleton (second seed → CONFLICT), getSystemPrincipal,
  createPrincipal never sets is_system.
- `bootstrap.test.ts` += hasUsableSystemIdentity true/false; assertEnforceReady refuses when system
  identity/grant missing, passes when present (with root + backfill satisfied).
- NEW `system-identity-authz.test.ts` (auth-ON lane, PREFIX cleanup, setAuth toggle):
  1. system principal `assertAuthorized(write, {project: any})` → ALLOW (global-write covers).
  2. system principal `assertAuthorized(read, …)` → ALLOW; **`admin`/`delegate` → DENY** (bounded; not
     root) — the least-privilege proof.
  3. `runNextJob('default', undefined, {actingPrincipalId: sys})` passes the global-grant gate
     (no BAD_REQUEST) where a project-scoped principal is rejected.
  4. enforce-ready: with system identity present → no system-identity CONFLICT.

## REVIEW-CODE cold-start adversary (post-implementation) — 3 findings, all fixed
1. **[HIGH→fixed] enforce-ready gate accepted `admin`.** `hasUsableSystemIdentity` matched
   `capability IN ('write','admin')`; admin covers write (so the worker would function) but grants
   delete/admin reach across all projects. Tightened to `capability = 'write'` (exact) so an admin-only
   system principal is not accepted as ready. (`bootstrap.ts`.) **Scope note [review-impl #2]:** the
   gate verifies a write grant EXISTS; it does not also FORBID a separately-granted admin on the same
   principal. Bounded-ness is guaranteed at CREATION (bootstrapSystem grants only write) — not by this
   readiness probe. Auditing-out broader grants would be a deliberate extension (left to the flip's
   least-privilege check), not folded in here.
2. **[HIGH→fixed] test false-green.** The `runNextJob` "passes the gate" check accepted `idle|ok|error`
   on an empty queue — proving nothing (a real `NO_PRINCIPAL` deny would read as `error`). Replaced
   with a real `index.run` job (empty temp dir → `indexProject` no-ops, no embedder) run via
   `runJobById` under the system identity, asserting NO authz denial — a genuine regression guard that
   a future leaf dropping `actingPrincipalId` would trip. (`system-identity-authz.test.ts`.)
3. **[MED→fixed] `runJobById`/rabbit path ungated.** `runNextJob` gates the actor, but `runJobById`
   (the by-id/rabbit execute path) reached `executeByType` with no upfront check, so a non-covering
   principal would fail at the first leaf instead of being rejected. Added the symmetric gate on the
   CLAIMED job's project (project job → write@project; global job → globally-privileged). Worker
   (system, global write) passes both. (`jobExecutor.ts`.) Latent today — `runJobById` is worker-only.

## /review-impl (coverage-gap lens, pre-commit) — no HIGH; fixes folded
- **#1 [MED→fixed] 6 pipeline forwards untested.** `buildFaq`/`buildRaptorSummaries`/
  `runQualityEvalAndPersist`/`buildProjectMemoryArtifact`/`buildLargeRepoProjectMemory`/`runExtraction`
  were threaded + tsc-typed but unexercised — a dropped forward (optional param) would compile and
  silently NO_PRINCIPAL-deny at the flip. Added `pipeline-threading-authz.test.ts`: each service is
  called with the COVERING system principal under auth-ON and must not hit an authz denial at its leaf
  (real embedder/LLM/fs failures tolerated; distillation off + closed-port embedder keep it fast +
  deterministic; builderMemory single-pass skips honestly when no LLM). **Mutation-verified**: dropping
  a forward makes the test fail. 5 pass / 1 honest-skip.
- **#2 [LOW] gate wording overstated** — corrected in `bootstrap.ts` + above (gate ensures write EXISTS;
  bounded-ness is guaranteed at creation, not by forbidding a hand-granted admin).
- **#3 [LOW] stale `executeByType` comments** — updated (enqueueChained forwards the identity now).
- **#6 [COSMETIC] threading-test authz regex** — tightened to `/not authorized to|^not found$/` so an
  incidental "...not found" can't false-positive.
- **#4 (runJobById claims-then-strands on denial) / #5 (loadLeafBodiesFromDb unguarded read)** —
  accepted: both worker-only/latent. Logged to DEFERRED for the flip's least-privilege pass.

## Invariants / drift risks (for the adversary)
- **Mutual exclusion** is_root vs is_system (CHECK + separate seed paths).
- **Singleton** system principal (partial unique index).
- The enforce-ready check must use a **flag-independent** grant query (not `hasGlobalGrant`), else it
  rubber-stamps under auth-off.
- Threading must reach the **deep** knowledge-loop body, not just the shallow cases.
- Nothing here flips `MCP_AUTH_ENABLED`; every change is inert under auth-off (AC2: byte-for-byte).
