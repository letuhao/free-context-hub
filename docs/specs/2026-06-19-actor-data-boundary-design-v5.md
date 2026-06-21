# DESIGN v5 — Actor / Project / Task Data Boundaries (code-accurate, contradiction-resolved)

**Status:** 📚 GOVERNANCE-OS RESEARCH TRACK (not the near-term build). The near-term plan is
`-FOUNDATION.md` — the small real data boundary, built Codex-ready so this governance design grows on
top of it additively. v1–v5 + the 5 evals are kept as the DLF design reference for later phases.
**Supersedes:** v4. **Inputs:** v4 + v4-eval (4 false anchors + ~5 design contradictions + ~24 binding
edges) + the as-built code the v4 eval verified (file:line cited inline).
**What v5 fixes vs v4:** (1) corrects the **4 false code anchors** by designing *around the real
constraints*; (2) resolves the **5 genuine design contradictions** as decisions; (3) integrates the
binding edges. **Rule for v5:** assert ONLY code facts verified by the v4 eval; where the code lacks a
capability v4 assumed, v5 adds an explicit infra step or works within the constraint.

> **Standing honesty (carried from v4-eval):** 4 paper rounds did not converge in count, and round 4
> showed the spec drifting from code. v5 tightens the verified anchors, but the BUILD phase (TDD +
> per-phase cold-start adversary) remains where these close — a failing test, not a paragraph. v5 is
> the most code-accurate buildable paper spec achievable without writing code.

---

## A. The 4 false-anchor corrections (verified against real code)

**A1 — Versioning needs a NEW table (not `cacheVersions.ts`).** `project_cache_versions` (migration
0008) has a **single-column `project_id` PK** and `cacheVersions.ts` hardcodes `WHERE project_id=$1` —
it cannot carry `(scope_kind, scope_id)`. → v5 adds a **new** `authz_version(scope_kind, scope_id,
version, updated_at, PRIMARY KEY(scope_kind, scope_id))` + a new `authzVersions.ts` modeled on the
upsert-bump idiom. `project_cache_versions` stays untouched (different concern).

**A2 — No "outside the migration txn" step exists.** `applyMigrations.ts` wraps **every `.sql` file in
one `BEGIN…COMMIT`** (verified; 0063's header restates it); there is no non-transactional or
post-migration maintenance hook. → v5 does NOT put `VALIDATE CONSTRAINT` or batched backfills in a
`.sql` migration. Instead it adds **operational maintenance CLIs** (`npm run authz:backfill:<n>`,
`authz:validate:<n>`) that connect **DB-direct** (like the `bootstrap-admin:mint` CLI), run outside any
migration txn, are batched + resumable, and are gated steps in the deploy runbook. Migrations only do
fast catalog ops (`ADD COLUMN nullable`, `ADD CONSTRAINT … NOT VALID`). (If the team prefers, a future
infra task can add a `*.notx.sql` class to the runner — but v5 does not depend on it.)

**A3 — Instance minting cannot live in `bearerAuth`/`resolveMcpCallerScope`.** `bearerAuth`
(auth.ts:17-67) is a sync middleware with no pool handle and **returns `next()` early on auth-off
(line 19)**; `resolveMcpCallerScope` returns a bare `CallerScope`. → v5 mints instances in a **separate
always-on async middleware `attachInstance` mounted AFTER `bearerAuth`** (runs even in auth-off, where
it mints `principal_id='system:anonymous'`), and surfaces the id via an `X-ContextHub-Instance`
response header; for MCP, a wrapper around `resolveMcpCallerScope` returns `{ scope, instanceId }` and
the tool layer puts it in the MCP result context. Worker mints at job pickup. (§C2)

**A4 — `closeTopic` Phase-2 is lock-free by design; the drain does NOT take `FOR UPDATE`.**
(topics.ts:463 "no FOR UPDATE on item rows… avoid deadlock"; guarded `UPDATE … WHERE status='open'` per
row in independent txns.) → v5's refer-back drain follows the **same lock-free pattern**; the
"drain wins on closing" guarantee comes NOT from a row lock but from the **consume path re-reading
`topics.status` in its own txn and self-aborting to `topic_closing` when status ∈ {closing,closed}**
(Phase-1 commits `status='closing'` before Phase-2 runs, so a consume that started earlier still sees
it). (§H1)

## B. The 5 design-contradiction resolutions

**B1 — Authority is APPOINTMENT-or-ROOT-FLAG (resolves the flag-vs-appointment deadlock).** The
refer-back **consume gate** = `approver.is_authority_root = true OR (∃ active authority appointment of
approver whose scope ⊇ resource.topic)`. `resolveAuthority` may return the flag-root; consume accepts
it. So on a minimal install the global human root can always approve. (§C3/§H2)

**B2 — Governance predicates become pure functions (resolves the entanglement).** Phase-A/D extracts a
**pure `phase15_grants[rt,action](actor,res) → bool`** dispatch table from the as-built lifecycle fns
(`motions.ts`, `requests.ts`) — `vote`=body-member, `propose`=eligible, `second`=distinct-actor,
`veto`=veto-holder. **`tally` is a STATE gate, not an actor grant** — it dispatches to
`phase15_state_ok[motion,tally] = (status='balloting' AND now>=deadline)` with **no actor term** (anyone
incl. `system:tally` may trigger a tally). The engine evaluates the pure predicate *before* the
mutation; the existing lifecycle fns keep their inline checks as defense-in-depth (belt+suspenders).
This is a **named refactor**, a Phase-D acceptance item, not an assumed capability. (§C5)

**B3 — on_behalf_of gates BOTH principal and actor status (resolves the auth bypass).** PRE-P1 requires
`principals.status='active'` for **both** `actor (= on_behalf_of ?? principal)` AND `principal` (the
authenticating credential holder) — a suspended credential cannot act even on behalf of an active
actor. (§5 PRE)

**B4 — `system:*` principals are non-authenticable sentinels.** A trigger on `api_keys` rejects binding
to any `kind='system'` principal **except `system:bootstrap-admin`** (the one credentialed system
identity, §10.4). So `system:custodian`/`system:sweep`/`system:tally`/`system:legacy-runner`/etc. own
rows for provenance but **no credential can authenticate as them** → the owner fast-path can never be
exploited via a system identity. (§1.1, §8.2)

**B5 — Sealing: the `re_consecrations` row is approval-gated and one-shot (closes the relocated
magic-password).** `re_consecrations` gains `approved_by`, `approved_at`, **`consumed_at`**. (a) a
trigger rejects `INSERT` with `approved_at` non-null — approval is a **separate later `UPDATE`** that a
trigger gates on `approver.is_authority_root OR a carried Council motion`; (b) the seal trigger requires
the referenced row to be `approved_at IS NOT NULL AND consumed_at IS NULL`, and an AFTER trigger stamps
`consumed_at` so the row authorizes **exactly one** committed change-set (no replay). (§2.2)

---

## 1. Identity
### 1.1 principals (opaque ULID; non-authenticable system; self-kind-locked)
```sql
principals ( principal_id TEXT PRIMARY KEY,                 -- opaque ULID (never name-derived)
  kind TEXT NOT NULL CHECK (kind IN ('human','agent','system')), kind_verified BOOLEAN NOT NULL DEFAULT false,
  display_name TEXT NOT NULL, status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active','suspended','retired')),
  is_authority_root BOOLEAN NOT NULL DEFAULT false, created_by TEXT, created_at TIMESTAMPTZ NOT NULL DEFAULT now() )
```
- **api_keys → kind!='system' (B4):** trigger rejects `api_keys.principal_id` referencing a
  `kind='system'` principal except `system:bootstrap-admin`.
- **kind self-lock (engine-actor bound, fixes v4 S-A4):** the kind trigger reads
  `current_setting('app.actor_principal_id', true)` (set `SET LOCAL` by the engine, like the seal GUC)
  and rejects `UPDATE OF kind/kind_verified WHERE NEW.principal_id = that actor`. `principal:verify`
  additionally requires `on_behalf_of IS NULL AND caller.kind='human'` (a job can never self-verify).
- **genesis seed:** 0064 seeds `human:root` with `kind='human', kind_verified=true, is_authority_root=true`
  (axiomatic trust root — the only unverified-source verification; fixes v4 S-A12 chicken-egg).
- **last-root + non-reusable:** triggers as v4 §1.1.
### 1.2 instances (single-live-binding; minted in attachInstance — A3)
`instances(instance_id PK ULID, principal_id FK, surface, bound BOOL, started_at, ended_at)`. Worker
mints-only at pickup (never accepts presented). REST/MCP honor a presented id iff `bound AND ended_at
IS NULL`; **no advisory lock** (v4 S-A2 over-engineering removed — worker-mint-only already gives
distinct ids to concurrent runs; same-session REST sharing is benign because the Board fence keys on
`fencing_token`). Fence tuple `(principal_id, instance_id, fencing_token)`.
### 1.3 actor reconciliation: scalar FKs as v4 §1.3; **`disputes.parties` → `dispute_parties` join
table** (parties frozen read-only legacy, authoritative = join table — no sync trigger). **Composite
re-key keyed on `(project_id, actor_id)`, with `system:*` literals pre-seeded as single canonical
principals and EXCLUDED from the 1:1 assertion** (fixes v4 S-A18 system-literal edge).

## 2. Roles = sealed Codices
### 2.1 schema as v4; `base_role_id` linear, cycle-guarded at write (`WITH RECURSIVE … CYCLE`) — the
confinement+cycle trigger fires `BEFORE INSERT OR UPDATE OF base_role_id` and re-walks the **full
transitive chain** (fixes v4 S-A15 re-point gap); forbid re-pointing a base on a role with active
appointments.
### 2.2 sealing (B5 one-shot ceremony): trigger requires GUC → an **approved, unconsumed**
`re_consecrations` row for this role; approval is a separate authority-gated UPDATE; AFTER trigger
stamps `consumed_at`. `BEFORE TRUNCATE` triggers on all three tables; app runs as **non-owner role**;
ceremony uses a dedicated client + `SET LOCAL` + `DISCARD ALL` on release (CI lint forbids non-LOCAL
`SET`). `sealed` false→true is itself ceremony-gated.
### 2.3 base→override extend-never-relax: closure with cycle/depth guard; **unconditional** base deny
blocks an override grant at amend time (predicated denies coexist, applied at runtime); one shared
`ruleCovers` for amend-validation and Stage-2.

## 3. Topic, Appointment, Authority
### 3.1 appointments + no-escalation: confinement to `confined_project(role)` over the **full base
chain**; `assertGrantSubset` = `eff_perms(role) ⊆ ⋃{eff_perms(a.role): a active ∧ scopeCovers(a.scope,
targetScope)}` with `ruleCovers` wildcard math; `role:grant`/`apikey:mint` require `granter.kind=human`.
**Root genesis superset is GENESIS-GATED (fixes v4 S9):** `is_authority_root`'s subset-exemption applies
ONLY while `genesis_active` (no quorate Council has ever existed OR a forced-triage re-arm window) —
outside genesis, even root grants via Council motion. `is_authority_root` itself is **not grantable**
except by Council motion (never root's unilateral genesis).
### 3.2 resolveAuthority(resource): walks `authority_principal_id` up `parent_topic_id` (visited-set +
`MAX_TOPIC_DEPTH`; write-time cycle trigger; `CHECK(parent_topic_id<>topic_id)`; **same-project only**,
trigger-enforced) → project authority → global `is_authority_root` human. **Accepts `topic_id=NULL`**:
starts at project authority from `resource.project_id` (fixes v4 S11 create-private chicken-egg).
Returns nearest active human.
### 3.3 genesis + re-consecration: `human:root` consecrates under `genesis_active` (B5 + §3.1 gate);
**anti-sockpuppet (fixes v4 S8):** genesis re-arm requires no-quorate-Council to persist past a
forced-triage window AND **no principal in `human:root`'s provenance graph** (minted/verified by root,
transitively) caused the un-quorum; genesis amendments are flagged for **retroactive Council
ratification**, auto-flagged-stale if unratified (dependent-amendment rollback is *flagging+freeze*, not
silent revert — honestly bounded, §16). Steady-state re-consecration = Council motion; global human root
is always an eligible voter.

## 4. Action catalog
`action_catalog(rt, action, kind, security_sensitive, produces_state_for[], reads_no_managed_state,
PK(rt,action))`. **Actions are a closed compile-time `ACTIONS` enum** (no template-literal action
strings — CI grep forbids `:${`); the completeness check diffs catalog rows vs the enum (both static).
Miss → DENY `unknown_action`. `create` owner = `actor`. Agent create-private → `refer_back` seed rule.
`produces_state_for` validated acyclic+complete or auto-derived. `security_sensitive` set for the
governance + identity-mutation + `authz:set_kill`/`authz:set_mode` + `visibility:promote` set.

## 5. authorize() engine
```
authorize(principal, action, resource, {conn, mode, on_behalf_of}):
  actor := on_behalf_of ?? principal ; cat := action_catalog[rt,action] (miss→DENY)
  SET LOCAL app.actor_principal_id = actor                         # for the kind trigger (B-fix)
  PRE (hard, never advisory; status NEVER cached):
    P1 live status('active') for BOTH actor AND principal else DENY    # B3 dual-status
    P2 assertXScope(actor.project_scope, resource.project_id) cross→NOT_FOUND
    P3 per_resource & no resource_id → DENY; load owner/visibility/topic/task FROM DB by id
  STAGE1 grant:
     owner == actor → grant (capability)
     governance rt → grant := phase15_grants[rt,action](actor,res) AND NOT codex_denies(...)   # B2 pure fn; tally=state gate
     else → grant := visibility_allows(actor,res) AND codex_grants(actor,action,res)            # §5.1 scope coverage
  STAGE2 overlay (always): codex_rules (ruleCovers+predicate) → deny | refer_back
  RESOLVE deny>refer_back>allow(grant)>DENY ; EXISTENCE private/restricted+no-read → NOT_FOUND
  MODE security_sensitive|governance → ENFORCE always; else audit(log,allow vis/codex)|enforce(throw)
```
### 5.1 codex_grants scope coverage: `covers(global)=true` (P2 is the outer tenant clamp);
`covers(project,pid)=res.project_id==pid`; `covers(topic,tid)=res.topic_id==tid OR ∃task(t.topic_id=tid
∧ res.task_id=t.task_id)`; `covers(task,kid)=res.task_id==kid`. **Knowledge tables gain nullable
`topic_id`, set by a BEFORE-INSERT trigger from `task_id` (derived, not caller-supplied) and IMMUTABLE
post-create** (trigger rejects `UPDATE OF topic_id`; re-home = security_sensitive). Project-level
resources (no task) are project/global-only **by design** (stated AC, fixes v4 S5).
### 5.2 authorizeMany (collection): load appointments/eff once + status-live-once; **per row apply P1
(status) + P2 (assertXScope, CPU compare) + visibility+codex**; zero per-row DB; parity test vs single.
Re-read status every K rows on long batches.

## 6. on_behalf_of (wired to verified seams)
- `jobs.enqueued_by_principal` FK + `jobs.chain_depth`; set at enqueue from authenticated caller;
  internal `enqueueJob` (jobExecutor.ts:58/65) copies both verbatim; `callerScope:null` stays for tenant.
- `executeByType(…, onBehalfOf, chainDepth)` (jobExecutor.ts:29); worker calls
  `authorize(systemPrincipal, action, res, {on_behalf_of})` per protected `case` (enumerate which cases
  are protected). **Scope (fixes v4 S7):** derive from the job's `project_id`; **a NULL-project job MUST
  NOT carry on_behalf_of** (worker-internal global jobs are never delegated — reject at enqueue);
  require the originator to hold a covering active appointment at execute-time or **dead-letter**
  (never null→unrestricted).
- **emitChain origin (fixes v4 S5 — names ALL THREE sites):** `tallyMotion` (motions.ts:786) +
  `sweepExpiredMotions` (coordinationSweep.ts:519) add `proposed_by` to their SELECTs and pass it as
  `acting_actor`; **`applyMotionToStep` (requests.ts:1080) passes `req.submitted_by`** (already SELECTed
  at 1007) instead of `motion:<id>`. `system:*` stays on bookkeeping *events* only. Invariant test: no
  `tasks.created_by` is a `system:`/`motion:` literal.
- **chain_depth boundary (fixes v4 S6):** add `chain_depth` to `motions`/`requests` (seeded from the
  originating task/request); `emitChain` sets the task depth = source depth+1; `>MAX_CHAIN_DEPTH` →
  dead-letter.

## 7. Refer-back state machine
`refer_backs` + `facts_hash` (server-derived, **audit-only**), `security_fingerprint`
(owner+visibility+**topic-active-vs-not**, not content version), one-shot `token`, `authority` (B1
appointment-or-root), `status`, **open-cap** (concrete `MAX_OPEN_REFER_BACKS_PER_PRINCIPAL=20` +
per-(principal,topic)=5; counts **open** rows — **resolution/force-lapse frees the budget**; an
authority may dismiss to free it; cap is on open, not lifetime — fixes v4 S12 permanent-denial). Consume
binds to `authority` (B1) under a row-lock-free re-check of `topics.status` (A4). Re-affirm-binds = cap
+ server-derived facts_hash novelty.

## 8. Lifecycle
### 8.1 topic close: add a lock-free `refer_backs` drain pass to `closeTopic` Phase-2 (guarded
`UPDATE … WHERE status='open'`, per-row txn — matches topics.ts:541+) + `ForceLapsedCounts`; roll off
topic appointments; sweep claims. "Drain wins" via the consume-side `topics.status` re-check (A4).
### 8.2 suspend/retire op: roll off appointments; sweep claims; re-route open refer_backs; exclude from
quorum; **reassign owned private to a kind='human' successor/admin, else QUARANTINE owner=
`system:custodian` (non-authenticable, B4) + visibility restricted + forced-triage** (never to an agent).

## 9. Rollout / invalidation
### 9.1 NEW `authz_version` table (A1), `scope_kind ∈ {project, principal, role, global}`. **Bump matrix:**
status→`(principal,X)`; appointment→`(principal,X)`; sealed amend (project role)→`(role,id)` **+ fan-out
`(principal,*)` for every appointee whose base-chain closure includes that role** (so the hot-path key
is just `hash(principal_ver, project_ver, global_ver)` — **one batched read**, no per-role fan-out; fixes
v4 S2/S14 depth-truncation); global base amend→`(global,'*')`. status NEVER cached. Per-process
version-keyed cache (survives stateless MCP; saves the closure load).
### 9.2 DB kill/mode (A-fix, not env): `authz_runtime_flags(global_kill)` **seeded `false` in 0064**;
`authz_mode_overrides` (absent→catalog default). Read per protected action, ≤2s TTL off `(global,'*')`.
Writes `security_sensitive`+human+global-admin (root's genesis superset covers them so the kill switch
is settable pre-Council; fixes v4 S9). Hot-path reads pipelined into ONE CTE `SELECT` with P1+instance+
versions (budget: ≤1 round-trip per cached authorize; CI p95 on single-call MCP + 100-row search).
### 9.3 coverage: `authz_observed_actions` + `authz_observed_shapes` — **async fire-and-forget upsert**
(buffered, flushed every N/T — no read-path write hotspot; fixes v4 S10). `authorization_decisions`
sampled+partitioned+tenant-filtered (read AND rollups; cross-project rollup = global-scope only).
### 9.4 flip gate: replay the **FULL bounded shape space** per `(rt,action)` (≤144 combos — enumerate,
not just observed; **this closes the window-coverage class**, fixes v4 S11), assert no surprise (deny OR
refer_back); observed shapes only weight alerting. `produces_state_for` forces write/create/visibility
before read. Per-(rt,action) granularity.

## 10. Migrations + maintenance CLIs (A2)
- **0064** identity scaffold + `authz_version`/flags(seeded)/mode/observed_*/decisions(partitioned)/
  refer_backs/dispute_parties + all triggers; seed `human:root`(verified)+`system:bootstrap-admin`+
  canonical `system:*` sentinels + sealed base Codices + ACTIONS catalog.
- **0065** principal binding + scalar actor FKs + a **separate write-once `principal_id` column** on
  `coordination_events` (+ a `BEFORE UPDATE OF principal_id` trigger making it write-once; honest note:
  the legacy `actor_id` immutability remains **app-level only** — `coordination_events` has no DB
  immutability trigger today and v5 adds one ONLY for the new column).
- **0066** ownership/visibility + knowledge `topic_id` (nullable, derive-trigger, immutable) +
  comments/feedback/bookmarks `project_id` + `tasks.assigned_to/chain_depth` + `motions/requests
  .chain_depth`. Columns added nullable + `DEFAULT 'system:legacy-import'` **for the rolling-deploy
  window only**; `ADD CONSTRAINT … NOT VALID`.
- **0067** `topics.authority_principal_id/parent_topic_id` + charter/cycle/tenant triggers; `jobs.
  enqueued_by_principal/chain_depth`.
- **Maintenance CLIs (DB-direct, batched, resumable, outside any migration txn — A2):**
  `authz:backfill:0065/0066` (incl. coordination_events `principal_id` batched by `(topic_id,seq)`),
  `authz:validate:0066` (`VALIDATE CONSTRAINT`, no statement timeout, post-window
  `COUNT(owner='system:legacy-import' AND created_at>window)=0` assertion catches forgot-owner +
  reconciliation; `system:legacy-import` seeded as a real principal so legacy rows are administrable),
  `bootstrap-admin:mint` (DB-direct; no-op if usable hash exists, `--rotate` to replace; prints secret
  to a TTY/0600 file only, never the logger). Boot self-check identical in `index.ts` + `worker.ts`,
  keyed on `MCP_AUTH_ENABLED`, warn-only when off, fail-loud (with mint hint) when on + no usable root.
- **actors.type expand-contract:** expand→deploy(writes agent/system, 100%)→re-sweep ai→agent→separate
  later migration (gated on no-old-pods + stable `COUNT(type='ai')=0`) contracts.

## 11. Retention/erasure: opaque ULID → erasure anonymizes `display_name` only; audit resolves to
"[erased principal]" via FK. **Honest scoping:** append-only of `coordination_events` is **app-level
(single-writer `appendEvent`)**; v5 enforces write-once only on the NEW `principal_id` column.

## 12-14. Surfaces / composition / test: as v4, plus CI tests pinned for every v5 fix (seal-replay-
rejected, on_behalf_of-both-status, instance-mint-auth-off, drain-vs-consume-status-recheck, governance-
pure-predicate, flip-gate-full-shape-space, VALIDATE-via-CLI, system-not-authenticable, emitChain-3-sites,
chain_depth-boundary, genesis-sockpuppet-blocked, topic_id-derived-immutable). **Mandatory auth-on +
enforce CI lane + per-phase cold-start hostile-actor adversary** (the real edge-closer).

## 15. Worked bootstrap (unchanged shape from v4 §15) + genesis-gated superset (§3.1).

## 16. Residual risks (honest): all-agent liveness residual (surfaced, not dissolved); genesis with a
fully-compromised root or a pre-existing colluding human (out of scope — root is the trust anchor);
genesis dependent-amendment rollback is freeze+flag, not silent revert; perf must be proven by the CI
lane; and — per the v4-eval convergence thesis — a 5th eval will likely find the next-finer binding;
those close in BUILD via failing tests. v5 is the most code-accurate buildable paper spec.

## 17. v4-eval traceability: A1→§9.1 · A2→§10 · A3→§1.2/§C(A3) · A4→§4(A4)/§7/§8.1 · B1→§7 · B2→§5 · B3→§5
· B4→§1.1 · B5→§2.2. v4 binding edges: topic_id S5→§5.1 · re-key S7→§1.3 · confinement-repoint S9→§2.1 ·
catalog S10→§4 · chain_depth S6→§6 · cap S12→§7 · perf S2/S3→§9.1/§9.2 · shapes-hotspot S10→§9.3 ·
flip-shape S11→§9.4 · DEFAULT-sentinel S7→§10 · mint S8→§10 · flags-seed S9→§9.2 · append-only S4→§10/§11.
