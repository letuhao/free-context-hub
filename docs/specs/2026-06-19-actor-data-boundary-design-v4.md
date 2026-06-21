# DESIGN v4 — Actor / Project / Task Data Boundaries (code-grounded, binding-complete)

**Status:** ⚠️ SUPERSEDED by `-design-v5.md` (2026-06-19) — v5 corrects v4's 4 inaccurate code anchors
and resolves the 5 design contradictions the v4 eval surfaced. Kept for history.

**Status (original):** DESIGN v4 (awaiting 4th eval + approval before BUILD)
**Supersedes:** v3 (`-design-v3.md`). **Inputs:** v3 + v3-eval (7 Group-A decisions + ~24 Group-B
binding fixes) + the as-built code the v3 eval cited.
**What changed from v3 → v4 (the method change):** v3 was mechanism-complete but its *bindings* were
loose and several claims didn't match the as-built code. v4 (a) states every mechanism's **binding
rule** explicitly (the recurring round-3 gap), and (b) **anchors each mechanism to the real file it
modifies** so the spec is buildable, not abstract. Read with v3 for the unchanged rationale; v4 is the
authoritative schema/algorithm.

> **Standing caveat (honest):** three eval rounds converged on "the gate exists; its binding is one
> notch loose," and round 3's findings were only visible against real code. v4 tightens the known
> bindings, but the BUILD phase (TDD + per-phase cold-start adversary) remains where edge bindings are
> *proven*, because a failing test closes them, not a paragraph. v4 is the best buildable paper spec;
> it is not a substitute for the per-phase adversary reviews the safety policy mandates.

---

## 0. The binding-rule principle
Every gate below is stated as `MECHANISM` + `BINDING` (the exact condition that must hold, and to
*what* it is bound) + `ANCHOR` (the as-built file it adds to / modifies). A mechanism without a tight
binding is the bug class all three evals found.

---

## 1. Identity (C2, H4 + Group-A #1, #4; Group-B kind/​re-key)

### 1.1 principals — opaque, non-PII
```sql
principals (
  principal_id  TEXT PRIMARY KEY,          -- OPAQUE ULID (H4). NEVER name-derived. display_name is the only PII.
  kind          TEXT NOT NULL CHECK (kind IN ('human','agent','system')),
  kind_verified BOOLEAN NOT NULL DEFAULT false,
  display_name  TEXT NOT NULL,
  status        TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active','suspended','retired')),
  is_authority_root BOOLEAN NOT NULL DEFAULT false,
  created_by    TEXT, created_at TIMESTAMPTZ NOT NULL DEFAULT now()
)
```
- **BINDING (kind self-mod, Group-B S-A17):** a trigger forbids any UPDATE of `kind`/`kind_verified`
  where the row's own principal is the authenticated actor; these columns are writable ONLY by a
  `kind='human'` authority via the `principal:verify` action (`security_sensitive`). An agent can never
  flip itself to human.
- **BINDING (last-root, Group-B S-B10):** a trigger rejects `status != 'active'` on the last active
  `is_authority_root=true` principal.
- **BINDING (kind_verified default, MED S-A8):** pre-0064 backfilled rows `kind_verified=false` →
  treated as **human** (fail-open, one-time). Post-0064 rows MUST set kind at mint; an unverified
  post-0064 principal on a sensitive action is treated as **agent** (fail-closed).

### 1.2 instances — fence handle bound to a session, not just a principal (C2 / finding-H, Group-A #1)
```sql
instances ( instance_id TEXT PRIMARY KEY, principal_id TEXT NOT NULL REFERENCES principals,
            surface TEXT NOT NULL, bound BOOLEAN NOT NULL DEFAULT true,
            started_at TIMESTAMPTZ NOT NULL DEFAULT now(), ended_at TIMESTAMPTZ )
```
- **MECHANISM:** server-mints a fresh `instance_id` (ULID) at principal resolution (REST `bearerAuth`
  / MCP resolve / worker job pickup). **ANCHOR:** `src/api/middleware/auth.ts`, `src/mcp/auth.ts`,
  `src/services/jobExecutor.ts`.
- **BINDING (the round-3 fix, S-A9):** an `instance_id` is **single-live-binding** — it cannot be
  attached to two concurrent execution contexts. The **worker NEVER accepts a presented instance_id**
  (always mints fresh at pickup). A presented id is honored only for follow-up REST/MCP calls *within
  one session* and only if `bound=true AND ended_at IS NULL AND not already in use by another live
  request* (enforced by a short-lived advisory lock on `instance_id`). Two concurrent runs of one
  principal therefore get **distinct** instance_ids and cannot share one → the Board fence on
  `(principal_id, instance_id, fencing_token)` distinguishes them. A presented `ended_at IS NOT NULL`
  id → mint fresh (never resurrect).
- **PERF:** instance validation is a cached PK point-read `(instance_id → principal_id, ended_at)` with
  the value immutable except the one `ended_at` flip; included in the §14 perf budget.

### 1.3 actor_id → principal reconciliation (C2; Group-B S-A18 composite key; disputes Group-A #3)
- Add `principal_id TEXT REFERENCES principals` (+ `instance_id` where the fence needs it) to the
  scalar actor-keyed tables: `claims.actor_id`, `votes.actor_id`+`proxy_for`,
  `topic_participants.actor_id`+`granted_by`, `proxies.principal/proxy/granted_by`,
  `artifact_leases.agent_id`, `tasks.created_by`+`assigned_to`, `requests.submitted_by`,
  `request_steps.decided_by`, `motions.proposed_by/seconded_by`, `intake_items.submitted_by`,
  `lessons.captured_by`, `lesson_versions.changed_by`, `actors.actor_id`.
- **`disputes.parties` is `TEXT[]` (ANCHOR: migration 0058) — FK is structurally impossible.** Normalize
  to `dispute_parties(dispute_id REFERENCES disputes, principal_id REFERENCES principals,
  PRIMARY KEY(dispute_id, principal_id))`; keep `disputes.parties` deprecated/derived.
- **BINDING (re-key 1:1, S-A18):** the legacy re-key map is keyed on the **full old composite
  `(project_id, actor_id)`** → a fresh ULID per pair (the old `actors` PK was composite). Migration
  assertion: `COUNT(DISTINCT (project_id, actor_id)) == COUNT(DISTINCT new principal_id)`. A genuine
  cross-project identity is a deliberate, reviewed merge — never an automatic name-collision merge.
- `actors.type` CHECK `('human','ai') → ('human','agent','system')`, data-fix `ai→agent` via §10.3
  expand-contract.

### 1.4 api_keys
`api_keys.principal_id TEXT REFERENCES principals` (credential-agnostic; Phase-5 crypto can back the
same principal later).

---

## 2. Roles = sealed Codices (C1; Group-B S-A1..A8)

### 2.1 Schema (as v3 §2.1) + cycle guard
`roles`, `codex_permissions` (GRANT-only), `codex_rules` (HS/N overlay), `re_consecrations`.
- **BINDING (base cycle, S-A6):** `base_role_id` is a single column (linear chain — diamonds
  impossible). A write-time trigger walks the proposed chain and rejects if it revisits `NEW.role_id`;
  the engine computes closure with `WITH RECURSIVE … CYCLE` + `MAX_BASE_DEPTH`.

### 2.2 Sealing — bound to an approved ceremony row (S-A1/A2/A4/A5)
```sql
CREATE FUNCTION assert_sealed_change_authorized() RETURNS trigger AS $$
DECLARE rc TEXT := current_setting('app.reconsecration_id', true);
BEGIN
  IF (SELECT sealed FROM roles WHERE role_id = COALESCE(NEW.role_id, OLD.role_id)) THEN
    IF rc IS NULL
       OR NOT EXISTS (SELECT 1 FROM re_consecrations r
                      WHERE r.id = rc AND r.target_id = COALESCE(NEW.role_id, OLD.role_id)
                        AND r.approved_at IS NOT NULL)
    THEN RAISE EXCEPTION 'sealed Codex: change requires an approved re_consecration for this role';
    END IF;
  END IF; RETURN COALESCE(NEW, OLD);
END $$ LANGUAGE plpgsql;
```
- **BINDING (the headline fix, S-A2):** the GUC is **not** a magic password — the trigger requires it
  to reference an **approved `re_consecrations` row whose `target_id` is this role**. Setting a random
  GUC achieves nothing.
- Trigger fires `BEFORE INSERT/UPDATE/DELETE` on `roles` (incl. the `sealed` column — `sealed`
  true→false also requires ceremony, S-A1), `codex_permissions`, `codex_rules`; plus `BEFORE TRUNCATE`
  statement triggers on all three (S-A4: row triggers skip TRUNCATE).
- **BINDING (privilege, S-A4):** the application connects as a **non-owner role** lacking
  `ALTER TABLE`/`TRUNCATE`/`session_replication_role`; owner/superuser is reserved for migrations
  (governed by review, not the trigger). Honest scope: "no *application* path bypasses sealing;
  DDL-privileged migrations are governed by review + ceremony."
- **BINDING (pool, S-A3):** the ceremony acquires a dedicated client and runs
  `BEGIN; SET LOCAL app.reconsecration_id=$1; …; COMMIT` on that one client; `SET LOCAL` (never `SET`);
  connection release does `DISCARD ALL`. CI lint forbids non-LOCAL `SET` of the GUC.
- **BINDING (seal transition, S-A5):** `sealed` false→true is itself `security_sensitive` + requires
  `codex:consecrate` (authority-root) or a Council motion — sealing is part of the ceremony, not a free
  UPDATE.

### 2.3 base→override "extend, never relax" — predicate-aware (S-A7/A8)
- `eff_perms(r) = perms(r) ∪ eff_perms(base(r))`; `eff_rules(r) = rules(r) ∪ eff_rules(base(r))`
  (closure with cycle/depth guard).
- **BINDING (S-A7):** an **unconditional** (`predicate IS NULL`) base `deny`/`refer_back` always wins
  and blocks an override grant at amend time; a **predicated** base deny is allowed to coexist with an
  override grant (the Stage-2 overlay applies the predicate at runtime). Reword the v3 "base deny always
  wins" to "*unconditional* base deny always wins; predicated wins when its predicate holds."
- **BINDING (S-A8):** amend-time validation and Stage-2 matching share ONE `ruleCovers(rule, rt, act)
  = (rule.rt='*' OR rule.rt=rt) AND (rule.action='*' OR rule.action=act)`.

---

## 3. Topic(job), Appointment, Authority root (C3, C7 + Group-A #5, #6; Group-B)

### 3.1 Appointment + no-escalation (S-A13/A14/A15)
`appointments` as v3 §3.1 (CHECK granted_by ≠ principal_id; status active/rolled_off).
- **BINDING (confinement, full chain — S-A15):** `confined_project(r)` = the non-NULL `owner_project`
  among `{r} ∪ base-chain ancestors` (reject role creation if two ancestors disagree). A trigger rejects
  an appointment whose resolved scope is not inside `confined_project(role)`. A global-labeled override
  wrapping a project-confined base is **confined to that base's project** (closes the leaf-only hole).
- **BINDING (subset, S-A13/A14):** `assertGrantSubset(granter, role, targetScope)` — reject unless
  `eff_perms(role) ⊆ effPermsAt(granter, targetScope)`, where `effPermsAt(G,ts) = ⋃ { eff_perms(appt.role)
  : appt active AND scopeCovers(appt.scope, ts) }` (union of ALL covering appointments) and subset uses
  `ruleCovers` so `*:*` ⊇ anything. `scopeCovers` is equal-or-narrower (project covers its topics/tasks;
  global covers all) — narrowing delegation allowed, widening rejected. `role:grant`/`apikey:mint` also
  require `granter.kind=human`.

### 3.2 resolveAuthority — cycle-guarded, same-tenant, role-based (S-B6/B7/B8/B9; Group-A #5)
```sql
-- topics + authority_principal_id TEXT (kind='human' at charter) , parent_topic_id TEXT REFERENCES topics
--   CHECK (parent_topic_id IS DISTINCT FROM topic_id)
```
- **MECHANISM:** `resolveAuthority(topic)` walks `authority_principal_id` up `parent_topic_id` → project
  authority → global `is_authority_root` human. Returns nearest **active human**.
- **BINDING (cycle, S-B6):** walk with a visited-set + `MAX_TOPIC_DEPTH`; a write-time trigger rejects a
  `parent_topic_id` that would create a cycle.
- **BINDING (tenant, S-B7):** `parent_topic_id` must be **same project** (trigger); the walk
  `assertXScope`s each hop and never returns a foreign-tenant human.
- **BINDING (multiplicity, S-B9):** `refer_backs.authority` is satisfied by **any active holder of an
  authority appointment whose scope ⊇ the resource's topic** (role-based, not a single principal id) —
  so multiple project authorities all qualify; no nondeterministic tiebreak.
- **BINDING (TOCTOU, S-B8):** the consume path re-runs PRE-P1 (live status) on the approver and
  re-resolves authority under a `refer_backs FOR UPDATE` lock.

### 3.3 Genesis & re-consecration — non-backdoor (S-B3/B4; Group-A #5)
- 0064 seeds `human:root` (`kind='human', is_authority_root=true`) + `system:bootstrap-admin` (infra).
- **BINDING (charter chicken-egg, S-B10 HANDLED):** `is_authority_root` needs no appointment/scope, so
  the first topic charters against it.
- **BINDING (council bootstrap, S-B4):** the `council` role IS sealed; its FIRST appointment is by
  `human:root` under genesis. The seal trigger guards Codex *content* (`roles`/`codex_*`), **not**
  `appointments` — so appointing to a sealed role is allowed; `is_authority_root` holds an implicit
  global-superset for `assertGrantSubset` during genesis. (Worked example in §15.)
- **BINDING (anti-backdoor, S-B3):** genesis re-activation requires `no quorate Council` to **persist
  past a forced-triage window with an emitted alert**, AND the engine refuses genesis if the same
  `human:root` *caused* the un-quorum (audit the suspensions in the window); any genesis amendment is
  flagged `reason='genesis'` and **auto-flagged for retroactive Council ratification**, auto-rolled-back
  if not ratified once quorum returns. State this threat+mitigation in §16.
- Steady-state re-consecration = a Phase-15 collective decision (motion) by the Council; the global human
  root is always an eligible voter (re-consecration can't be quorum-starved).

---

## 4. Action catalog (MED S-A11/A16/A19; never-advisory as a flag)
`action_catalog(resource_type, action, kind CHECK IN('create','per_resource','collection'),
security_sensitive BOOL, produces_state_for TEXT[], reads_no_managed_state BOOL, PRIMARY KEY(...))`.
- **BINDING (miss = fail-closed, S-A16):** a `(resource_type,action)` absent from the catalog →
  **DENY `unknown_action`**; a boot/CI completeness check asserts every route/MCP-reachable action has a
  row.
- **BINDING (create owner, S-A20):** `create` assigns `owner_principal_id = actor` (= `on_behalf_of ??
  principal`), never the executing worker. (Reconciles v3's "caller" wording to `actor`.)
- **BINDING (agent create-private, S-A19):** a `codex_rules` seed `(actor_kind=agent, *, create,
  predicate='visibility IN (private,restricted)', effect=refer_back)` so an agent hiding a fresh artifact
  from humans is surfaced; `visibility:promote` stays `security_sensitive`.
- **BINDING (graph, S-C13):** `produces_state_for` is validated acyclic+complete at boot (every
  `per_resource`/`collection` read either declares ≥1 producer or `reads_no_managed_state=true`); edges
  reading owner/visibility/topic auto-derive from the resource type's create + visibility:promote.

---

## 5. authorize() engine (C5, C6 + Group-B S-A12, S-C5)
```
authorize(principal, action, resource, { conn, mode, on_behalf_of }) -> Decision
  actor := on_behalf_of ?? principal ;  cat := action_catalog[rt, action]  (miss → DENY unknown_action)
  PRE (hard, never advisory; status NEVER cached):
    P1 live SELECT principals.status WHERE principal_id=actor → 'active' else DENY
    P2 assertXScope(actor.project_scope, resource.project_id)   cross-tenant → NOT_FOUND
    P3 cat.kind='per_resource' & resource_id null → DENY; load owner/visibility/topic/task FROM DB by id
  STAGE 1 grant:
    owner: actor==owner_principal_id → grant (capability)
    governance types (motion,request,dispute,decision_body,vote,topic-level):
        grant := phase15_grants[rt,action](actor,res) AND NOT codex_denies(actor,action,res)   # C5
        # absence of a codex GRANT is NEVER a deny here; phase15_grants is a per-action dispatch (S-B14)
    else: grant := visibility_allows(actor,res) AND codex_grants(actor,action,res)             # C6 §5.1
  STAGE 2 overlay (always; can veto/escalate): codex_rules (ruleCovers + predicate) → deny | refer_back
  RESOLVE: deny > refer_back > allow(grant) > DENY(default_deny)
  EXISTENCE: private/restricted + no read grant → NOT_FOUND
  MODE: security_sensitive OR governance → ENFORCE always; else audit(log,allow owner/vis/codex) | enforce(throw)
```
### 5.1 codex_grants with scope coverage — incl. topic-less resources (C6, Group-A #2, S-A11/A12)
```
codex_grants(actor,action,res) := ∃ active appt A of actor:
   (action,res.rt) ∈ eff_perms(A.role)  AND  covers(A.scope_type, A.scope_id, res)
covers(global,_,res) = true        # P2/assertXScope is the OUTER tenant clamp; "global" never exceeds the credential's project_scope (S-A12)
covers(project,pid,res) = res.project_id == pid
covers(topic,tid,res)   = res.topic_id == tid OR EXISTS(task t: t.topic_id=tid AND res.task_id=t.task_id)
covers(task,kid,res)    = res.task_id == kid
```
- **Group-A #2 decision:** ownable **knowledge tables gain a nullable `topic_id`** (a lesson/document
  created within a task inherits the task's topic; project-level artifacts keep `topic_id=NULL`). So a
  topic-scoped appointment can cover topic-linked knowledge — the topic axis is now buildable. Pure
  project-level resources are covered only by project/global appointments (intended).
### 5.2 Batch authorizer — runs the PRE gates (S-C5)
`authorizeMany(principal, action, rows[])`: load appointments/eff_perms/eff_rules + live status **once**;
the list query SELECTs `project_id, owner_principal_id, visibility, topic_id`; **per row apply P1 (the
single live status), P2 `assertXScope(actor.project_scope, row.project_id)` (CPU compare — drop
cross-tenant via existence rule), then visibility+codex** in memory. Zero per-row DB round-trips, but the
PRE gates are NOT skipped. CI parity test: `authorizeMany` result == row-by-row `authorize` (incl.
suspended-principal + cross-tenant cases).
### 5.3 authorizeEdge — per-side action + strictest mode (unchanged from v3 §5.3).

---

## 6. on_behalf_of — wired to the real seams (C4; Group-A #6; S-B1/B2/B15)
- Schema: `jobs.enqueued_by_principal TEXT REFERENCES principals` + `jobs.chain_depth INT DEFAULT 0`;
  set at enqueue from the **authenticated caller** (never body). **ANCHOR:** `jobQueue.enqueueJob`.
- **executeByType (ANCHOR jobExecutor.ts:29):** add params `(…, onBehalfOf, chainDepth)`; the worker
  calls `authorize(systemPrincipal, action, res, { on_behalf_of: onBehalfOf })` per protected action at
  **execute-time with live authority**. Internal `enqueueJob` calls (jobExecutor.ts:58/65/…) copy
  `enqueued_by_principal` + `chain_depth+1` **verbatim** (like `correlation_id`); the `callerScope:null`
  comment stays for the *tenant* gate, but authority now flows via `on_behalf_of`.
- **BINDING (execute-time scope, S-B15):** derive `actor.project_scope` from the **job's `project_id`**
  AND require the originator to currently hold a covering active appointment; a revoked/rotated-out
  originator → **fail closed (dead-letter)**, NEVER `null`→unrestricted.
- **emitChain / buildChainedTaskParams (ANCHOR chaining.ts:174,196):** the carried-outcome chain passes
  `acting_actor = motions.proposed_by` (resp. `requests.submitted_by`) — **add `proposed_by`/
  `submitted_by` to the tally-path SELECTs** in `tallyMotion` (motions.ts) and `sweepExpiredMotions`
  (coordinationSweep.ts). `system:sweep`/`system:tally` remain ONLY on the sweep's own bookkeeping
  *events*, never on `tasks.created_by`. Invariant test: no `tasks.created_by ~ '^system:'`.
- **BINDING (depth, S-B2):** `chain_depth` lives on `tasks` too; `emitChain` reads the triggering
  primitive's depth+1; `> MAX_CHAIN_DEPTH` → refer-back/dead-letter.
- **BINDING (absent origin, legacy backlog):** run as restricted `system:legacy-runner` with **no**
  sensitive grants (laundered delete/promote still denies); pre-0064 jobs dead-lettered/requeued.

---

## 7. Refer-back state machine (H2; S-B5/B11/B12; B14 governance dispatch)
`refer_backs` as v3 §7 + `facts_hash`, `security_fingerprint`, one-shot `token`, `authority` (role-based
per §3.2), `status`, open-cap.
- **BINDING (facts_hash, S-B5):** `facts_hash` is **server-derived** from a canonicalized facts payload;
  it is an **audit/dedup aid only** — the **hard per-tuple re-refer cap is the real liveness defense**
  (re-affirm-binds: after `reaffirmed`, a new refer_back for the same `(principal,action,resource_id)` is
  rejected unless `facts_hash` differs AND the cap isn't hit; hash-novelty alone never authorizes).
- **BINDING (token, S-B12):** fingerprint = owner+visibility+**topic active-vs-not** (NOT content
  version). Re-entry re-checks status+tenant+topic + re-runs Stage-2; security-attr change → re-escalate.
- **BINDING (consume = authority, S-B14-prev):** consume requires `approver` holds an authority
  appointment whose scope ⊇ resource.topic (role-based), not merely `kind='human'`.
- **BINDING (close race, S-B11):** consume and the §8.1 drain both take `refer_backs FOR UPDATE`; on a
  `closing`/`closed` topic the **drain wins** — consume returns terminal `topic_closing` (never
  re-escalates).
- **BINDING (open-cap, S-B13-prev):** `MAX_OPEN_REFER_BACKS_PER_PRINCIPAL` + per-(principal,topic)
  sub-cap, transactional (`count open FOR UPDATE`); exceed → the gated action hard-DENIES.
- **BINDING (governance dispatch, S-B14):** `phase15_grants` is a dispatch table keyed on
  `(resource_type, action)` → the existing per-action Phase-15 predicate (vote=body-member, propose,
  second=distinct-actor, veto=veto-holder, tally=post-deadline). **ANCHOR:** `motions.ts`, `requests.ts`.
- **Proxy (S-B16):** routed through `on_behalf_of` — `actor = delegator` (P1 checks delegator status,
  formula checks delegator standing) + verify a live `proxies` grant from delegator to the caster; record
  `cast_by`. (If out of scope, drop `proxies`/`proxy_for` from §1.3 — but v4 keeps it, wired here.)

---

## 8. Lifecycle operations (H1; S-B11/B13)
### 8.1 Topic close cascade (ANCHOR topics.ts closeTopic Phase-2; `ForceLapsedCounts`)
Add a Phase-2 drain pass over `refer_backs` (force-lapse `open`→`force_lapsed`, emit
`refer_back.force_lapsed`, invalidate token) — extend `ForceLapsedCounts`; plus roll off
`appointments WHERE scope_type='topic' AND scope_id=T` and sweep `claims WHERE topic_id=T`. The pass runs
as `system:closing-recovery` (infra lapse). Per-row independent-txn pattern matches the existing drain;
the `FOR UPDATE` from §7 serializes against in-flight consume.
### 8.2 Suspend/retire operation (S-B13 privacy fix)
A first-class op: (a) roll off appointments; (b) sweep claims; (c) re-route `open` refer_backs whose
authority is the affected principal to the next `resolveAuthority`; (d) exclude from quorum/`body_members`;
(e) **reassign owned private/restricted resources to a `kind='human'` successor/admin; if none exists,
QUARANTINE (owner→`system:custodian`, visibility `restricted`, no agent grant) + forced-triage alert** —
**never** transfer human-private ownership to an agent.

---

## 9. Rollout / invalidation (C8, H3; S-C1..C3, C8..C14)
### 9.1 Versioning + bump matrix (S-C1/C8/C15)
`authz_version(scope_kind, scope_id, version)` with `scope_kind ∈ {project, principal, role, global}`.
**Bump matrix (explicit):**
- `principals.status` → bump `(principal, X)`.
- appointment grant/roll-off for X → bump `(principal, X)` (the appointee) — **not** `(project,P)`
  (avoids the hot-row, S-C8).
- sealed Codex amend (project-owned role) → bump `(role, role_id)`; **global base Codex amend** → bump
  `(global, '*')` (S-C1 — the per-project scheme provably missed this).
- **Cache key** = `hash(principal_ver, project_ver, global_ver, [role_ver ∀ role in the appointment
  base-chain closure])`. **ANCHOR:** reuse `cacheVersions.ts` (`INSERT … ON CONFLICT DO UPDATE
  version=version+1`).
- `principals.status` is **NEVER cached** (live point-read, P1).
### 9.2 Kill switch + mode in DB, not env (S-C5/C6/C7) — **ANCHOR env.ts `_cachedEnv` is per-process**
`authz_runtime_flags(global_kill BOOL, updated_at)` + `authz_mode_overrides(resource_type,action,mode)`
— DB rows read per-protected-action with a ≤2s TTL keyed off `(global, '*')` version; coherent across
mcp+worker+replicas within the TTL. Writing either is `security_sensitive`+human+**global-admin only**.
Within a long batch, re-read every TTL/`K` rows.
### 9.3 Coverage telemetry feeds replay (S-C3/C4/C12)
`authz_observed_actions(rt,action,project_id,last_seen)` + `authz_observed_shapes(rt,action, owner_kind,
visibility, topic_present, caller_kind, owner_match, count)` — both idempotent upserts, **not sampled**.
`authorization_decisions` stays the sampled, monthly-partitioned, retained+rolled-up forensic log;
read-path **and rollups** tenant-filtered per-project; cross-project rollup endpoint gated
**global-scope only** (S-C9); private/restricted `resource_id` hashed cross-tenant.
### 9.4 Flip gate — synthetic replay from observed shapes (S-C3/C13)
Replay every catalogued `(rt,action)` through `authorize()` in advisory against **fixtures generated from
`authz_observed_shapes`** (real prod column distributions), asserting no surprising effect (surprise =
deny OR refer_back). A waiver cites the synthetic-evidence id + the shapes it covered. Zero-observed,
non-synthesizable actions stay `audit` with a `never_enforced` registry entry. Flip granularity per
`(rt,action)`; the `produces_state_for` graph (§4) forces write/create/visibility before read.

---

## 10. Migrations 0064+ (H3, H4; S-C2/C4/C10/C11)
1. **0064** identity scaffold (opaque ULID principals, instances, roles/codex_*/re_consecrations, seal
   triggers incl. BEFORE TRUNCATE, appointments + confinement/subset triggers, action_catalog,
   authz_version/runtime_flags/mode_overrides/observed_*, partitioned authorization_decisions,
   refer_backs, dispute_parties); seed `human:root`+`system:bootstrap-admin`+sealed base Codices+catalog.
2. **0065** api_keys/actors principal binding + actor-table reconciliation; **append-only-safe re-key
   (S-C4):** add a **separate write-once `principal_id` column** to `coordination_events` and other
   append-only tables and backfill it (NULL→value is not a mutation of sealed content); **leave the
   legacy `actor_id` slug untouched.** Re-key map keyed on composite `(project_id, actor_id)` (S-A18).
3. **0066** ownership/visibility online (S-C10/C11): add nullable `owner_principal_id` + `visibility
   DEFAULT 'project'` with a **column DEFAULT `system:legacy-import` during the rolling-deploy window so
   no INSERT is ever NULL regardless of pod version**; deploy app code setting real owner; batched
   backfill; `ADD CONSTRAINT NOT NULL NOT VALID` then `VALIDATE CONSTRAINT` **run outside the migration
   txn / no statement timeout** (document expected scan time on `document_chunks` millions); drop the
   DEFAULT after contract. Add `topic_id` (nullable) to knowledge tables (§5.1); `project_id` to
   comments/feedback/bookmarks; `tasks.assigned_to`+`chain_depth`.
4. **0067** governance binding: `topics.authority_principal_id`+`parent_topic_id`+charter invariant+cycle/
   tenant triggers; `jobs.enqueued_by_principal`+`chain_depth`.
### 10.3 actors.type expand-contract (S-C9-prev): expand to superset → deploy new code (writes
agent/system), wait 100% → re-sweep `ai→agent` → **separate later migration gated on "no old pods" +
stable `COUNT(type='ai')=0`** contracts the CHECK.
### 10.4 Bootstrap (S-C2): boot self-check is **warn-only when `MCP_AUTH_ENABLED=false`; fail-loud when
auth on AND no *usable* human-authority-root credential (non-NULL hash)** — the error prints the mint
command. Mint CLI `npm run bootstrap-admin:mint` connects **DB-direct** (works while the app is down),
idempotent/re-runnable. Runbook: run mint **before** flipping auth on.

---

## 11. Retention / erasure (H4; S-C4)
Opaque ULID `principal_id` → erasure anonymizes `principals.display_name` only; all audit/governance/
appointment rows keep the opaque id and resolve to "[erased principal]" via the FK — satisfies GDPR
erasure AND append-only-audit immutability *because* 0065 added a separate write-once `principal_id`
(no in-place rewrite of sealed events). `authorization_decisions` retention = raw N days → per-project
rollup → drop raw.

## 12. Surfaces / 13. Composition / 14. Test
As v3 §12/§13/§14, plus: CI tests pinned for every Group-B binding (seal-GUC-bound-to-ceremony,
TRUNCATE-blocked, base-cycle-rejected, catalog-miss-denied, batch-PRE-parity, emitChain-no-system-created_by,
chain-depth-trips, facts_hash-server-derived, resolveAuthority-cross-tenant-rejected, backfill-no-NULL-window,
kind-not-self-mutable, composite-rekey-1:1, confinement-base-chain, predicated-deny-coexist, mint-vs-boot,
global-codex-version-invalidates, append-only-rekey-no-mutation, MCP single-call perf). **Mandatory
auth-on + enforce CI lane** + **per-phase cold-start hostile-actor adversary** (the real edge-closer).

## 15. Worked bootstrap example
Fresh install → 0064 seeds `human:root`(authority-root)+`system:bootstrap-admin` → operator runs
`bootstrap-admin:mint` (DB-direct) → flips `MCP_AUTH_ENABLED=true` (boot check passes: usable root
credential) → `human:root` (genesis) seals the base Codices + appoints the first Council to the sealed
`council` role (seal trigger guards content not appointments; root has implicit global-superset) → genesis
goes dormant → steady-state re-consecration now flows through Council motions.

## 16. Residual risks (honest)
- All-agent liveness residual (refer-back/re-consecration with no human) — *surfaced* (forced-triage +
  alert), not dissolved (DLF CAP-AP property).
- Genesis backdoor — *mitigated* (forced-triage window + causal-suspension audit + retroactive
  ratification), not eliminated; a fully-compromised `human:root` is out of scope (it's the trust root).
- Performance — batch authorizer + per-process version-keyed cache + MCP single-call budget; **must be
  proven by the CI perf lane**, not assumed.
- **Convergence:** a 4th eval will likely find the next-finer binding; per the v3-eval analysis these are
  best closed by failing tests in BUILD. v4 is the most complete buildable paper spec.

## 17. v3-eval traceability
Group-A #1→§1.2 · #2→§5.1 · #3→§1.3 · #4→§10(0065)/§11 · #5→§3.3 · #6→§6 · #7→§9.1. Group-B: seal
S-A1..A8→§2.2/§2.3 · instance S-A9→§1.2 · topic-less S-A11/A12→§5.1 · catalog S-A16/A19/A20→§4 · kind
S-A17→§1.1 · re-key S-A18→§1.3 · confinement S-A15→§3.1 · emitChain/chain S-B1/B2→§6 · genesis S-B3/B4→§3.3
· facts_hash S-B5→§7 · resolveAuthority S-B6/B7/B8/B9→§3.2 · drain race S-B11→§7/§8.1 · retire S-B13→§8.2 ·
governance dispatch S-B14→§7 · proxy S-B16→§7 · global-version S-C1→§9.1 · bootstrap S-C2→§10.4 · replay
S-C3/C12→§9.4 · append-only S-C4→§10/§11 · batch PRE S-C5→§5.2 · TTL S-C6/C7→§9.2 · contention S-C8→§9.1 ·
rollup S-C9→§9.3 · backfill S-C10→§10(0066) · VALIDATE S-C11→§10(0066) · graph S-C13→§4 · MCP cache S-C14→§9.1.
