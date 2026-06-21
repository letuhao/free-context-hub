# F2g sub-step 1 — System-worker identity: PLAN

Design: `docs/specs/2026-06-20-actor-data-boundary-F2g-DESIGN.md` (post-adversary). Size L, AMAW.
Auth stays OFF. TDD where stateful; verify command per task.

## Substrate
- **T1 — migration** `migrations/0067_system_principal.sql`: `is_system` column (default false) +
  `principals_single_system_uniq` partial index + `principals_root_xor_system_chk` CHECK wrapped in an
  idempotent `DO $$ … duplicate_object … $$`. Verify: `npm run build` + migration applies in test DB
  (the test suite runs applyMigrations).
- **T2 — principals.ts**: `COLS` += `is_system`; `Principal.is_system: boolean`; `getSystemPrincipal()`
  (`WHERE is_system=true LIMIT 1`); `seedSystemPrincipal({display_name})` mirroring `seedRootPrincipal`
  (pre-check + 23505→CONFLICT). RED test in `principals.test.ts`: second seed → CONFLICT; getSystemPrincipal
  returns it; `createPrincipal` leaves is_system=false.
- **T3 — bootstrap.ts**: `hasUsableSystemIdentity()` (JOIN system-principal active + active global-write
  grant + granted_by active root); `bootstrapSystem()` (requires root → seed if absent → ensure one
  active global-write grant granted_by root; idempotent noop); `assertEnforceReady()` gains the
  system-identity gate after the backfill gate. RED test in `bootstrap.test.ts`.
- **T4 — CLI**: `src/scripts/bootstrapSystem.ts` (calls bootstrapSystem, prints status); package.json
  `"bootstrap:system": "tsx src/scripts/bootstrapSystem.ts"`.

## Wiring (explicit threading; all additive optional params → inert under auth-off)
- **T5 — jobExecutor.ts**: `runJobById(jobId, opts?)`; `executeByType(..., actingPrincipalId?)` forwarding
  to EVERY service call incl. builders + runExtraction + internal `enqueueJob` re-enqueues;
  `runNextJob` forwards `opts.actingPrincipalId` into executeByType.
- **T6 — pipeline gaps**: add+forward `actingPrincipalId?` in `faqBuilder.buildFaq`,
  `raptorBuilder.buildRaptorSummaries`, `qcEval.runQualityEvalAndPersist`,
  `builderMemory.buildProjectMemoryArtifact`, `builderMemoryLarge.buildLargeRepoProjectMemory`; forward
  into `scanWorkspaceChanges`'s internal `indexProject` (workspaceTracker:~115); forward into
  `runExtraction` from the `document.extract.vision` case.
- **T7 — worker.ts**: resolve `systemPrincipalId = (await getSystemPrincipal())?.principal_id ?? null`
  after migrations; if `MCP_AUTH_ENABLED` && `!hasUsableSystemIdentity()` → `logger.fatal` + `exit(1)`;
  pass `{actingPrincipalId: systemPrincipalId}` to `runNextJob` and `runJobById`.

## Tests
- **T8 — NEW** `src/services/system-identity-authz.test.ts` (auth-ON lane, PREFIX cleanup, setAuth):
  (1) seed system principal + global-write grant; `assertAuthorized(write,{project:any})` ALLOW,
  `read` ALLOW; (2) `admin` & `delegate` → DENY (bounded, not root); (3) `runNextJob('default',
  undefined,{actingPrincipalId:sys})` no BAD_REQUEST where a project-scoped principal is rejected;
  (4) `hasUsableSystemIdentity()` true when present, false when grant revoked / principal suspended /
  granted_by non-root; (5) `assertEnforceReady` no system-CONFLICT when present.
- **T9 — package.json** test list += `src/services/system-identity-authz.test.ts`.

## Verify (evidence gate)
- **T10**: `npx tsc --noEmit` clean; `npm test` full suite green (expect 1194+ baseline + new);
  confirm `MCP_AUTH_ENABLED` unset/false in committed env. AMAW: cold-start REVIEW-CODE adversary on
  the security primitive before POST-REVIEW (CLAUDE.md safety-sensitive policy).
