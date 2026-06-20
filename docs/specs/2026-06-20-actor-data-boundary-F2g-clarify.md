# F2g — Posture-flip prerequisite: a system identity for the worker + internal callers (CLARIFY)

**Branch:** `feature/actor-data-boundary` · **Date:** 2026-06-20 · **Phase:** F2g (after F2f COMPLETE)
**Mode:** AMAW (L + new auth-identity boundary → cold-start adversary at REVIEW)

## The problem (one line)
After F2f, every guarded service starts with `assertAuthorized(actingPrincipalId, …)`. The background
worker and other machine-initiated callers pass **no principal** — fine today (auth-off short-circuits
to ALLOW), but the instant `MCP_AUTH_ENABLED` flips to `true` they hit `NO_PRINCIPAL` → deny → the
worker's whole job pipeline (index / embed / knowledge-refresh / reflect / distill / quality-eval)
throws. **This milestone gives the worker a real identity so the flip can't kill it.** It does NOT
flip the flag.

## What already exists (substrate we build on)
- A single **root principal** (`kind=system, is_root=true`) minted out-of-band by `seedRootPrincipal`
  via `bootstrapRoot` (`ROOT_BOOTSTRAP_TOKEN`); fetched by `getRootPrincipal()`.
- `is_root` **short-circuits `authorize()` to ALLOW** (logged). So an identity the worker assumes that
  is root passes every guard automatically.
- `authorize()` / `assertAuthorized()` are inert while auth is OFF — so this whole change is invisible
  in dev and only "lights up" at the flip.

## The identity-less call sites (blast radius at flip)
- `src/worker.ts:63` — `runNextJob(queueName)` (poll loop), and `:39` `runJobById(jobId)` (rabbit).
- `src/services/jobExecutor.ts` `executeByType` → leaf calls with no principal: `indexProject`
  (index.run / workspace.delta_index / knowledge.refresh chains), reflect/distill, quality.eval,
  knowledge.loop.*, plus the internal `enqueueJob` re-enqueues (workspace.scan fan-out).
- **To be enumerated in DESIGN:** any other startup/cron/ingest path that calls a guarded service with
  no request-bound identity (git ingestion job, scheduled sweeps). The request-bound paths (REST/MCP
  handlers, chat tool) already carry a principal and are NOT in scope.

## The design fork (this checkpoint)
**Decision 1 — what identity does the worker assume?**

- **Option A — reuse root.** Worker loads `getRootPrincipal()` at startup, threads its `principal_id`
  through `runNextJob`/`runJobById` → `executeByType` → leaf calls. Root short-circuits ALLOW, so all
  jobs pass. *Least code (root already exists), most privilege.* A malicious/poisoned job payload
  (e.g. `payload.root` arbitrary-FS) then executes with **root** authority — DEFERRED-048 becomes
  load-bearing.
- **Option B — dedicated non-root system principal (RECOMMENDED).** Mint a `kind=system` principal
  (NOT root) with a single **`global` `write`** grant (write ⊃ read; covers index/embed/knowledge/
  reflect/eval). It canNOT grant/revoke/delegate or do admin-only ops. Worker loads it at startup and
  threads it the same way. *Slightly more substrate (a well-known lookup + the seed + a backfill-gate
  awareness), least privilege.* Matches the entire point of F2 (scope authority) instead of handing
  the busiest code path a master key.

**Recommendation: B.** The worker is high-volume and runs attacker-influenced payloads; giving it
exactly `global write` (and nothing else) is the defense-in-depth choice and keeps DEFERRED-048's
blast radius bounded to "write", not "root/admin/delegate".

**RESOLVED (2026-06-20 checkpoint): Option B — dedicated non-root system principal with one
`global write` grant.** (Human go.)

## Decisions that FOLLOW from Decision 1 (stated, not asked — will confirm in DESIGN)
- **Threading = explicit** (pass `actingPrincipalId` down through `executeByType` into each leaf
  call), NOT an AsyncLocalStorage ambient context — same pattern F2f used everywhere; no hidden
  authority. The internal `enqueueJob` re-enqueues forward the system principal too.
- **Lookup:** a `getSystemWorkerPrincipal()` analogous to `getRootPrincipal()`. Option B needs a way
  to find the one system-worker principal — proposed: a reserved well-known marker (a dedicated
  boolean column `is_system` on `principals`, or a reserved `display_name`), seeded idempotently
  alongside root in `bootstrapRoot`/a new `npm run bootstrap:system`. DESIGN picks the exact marker.
- **`assertEnforceReady`** gains awareness: refuse enforce-ready unless the system-worker principal
  exists with its covering grant (so the flip can't silently strand the worker). Mirrors the existing
  root-credential / coordination-migration / grant-backfill gates.
- **DEFERRED-048** (worker exec-time `payload.root` re-validation) is **adjacent** — it bounds what a
  job payload can reach regardless of identity. In scope to at least *note* under Option B (global
  write), mandatory hardening under Option A (root). Proposed: keep 048 as the next F2g sub-step after
  the identity lands, not folded into it.

## Out of scope for this checkpoint (separate sub-steps / separately gated)
- **DEFERRED-049** (resolveProjectIds authz + project/group id-namespace; listGroups read-model) and
  **DEFERRED-050** (user-scoped notification list/mark identity) — flip-*correctness* gaps (open read
  surfaces under auth-on), independent of "worker doesn't die". Sequence after the identity.
- **Domain 8** (retire legacy REST `requireScope`/`requireResourceScope`/role middleware) — only safe
  AFTER the flip; not now.
- **The `MCP_AUTH_ENABLED` default flip itself** — the one-way door, its own final checkpoint +
  cold-start security adversary + live auth-ON verification. Explicitly NOT this milestone.

## Acceptance criteria (for the identity sub-step)
1. With auth **ON** in a test lane, the worker executes a full job (e.g. `index.run`) end-to-end with
   no `NO_PRINCIPAL` denial — proven by an auth-ON jobExecutor test.
2. With auth **OFF**, behavior is byte-for-byte unchanged (short-circuit path; existing suite green).
3. The system-worker identity has exactly its intended capability (Option B: `global write` — a
   negative test proves it canNOT, e.g., grant/revoke or admin-delete).
4. `assertEnforceReady` refuses if the system identity / its grant is missing.
5. `tsc` clean; full suite green; auth stays OFF by default (no flip).
