# DESIGN v3 — Actor / Project / Task Data Boundaries (mechanism-complete)

**Status:** ⚠️ SUPERSEDED by `-design-v4.md` (2026-06-19) — v4 tightens every mechanism's *binding
rule* and anchors each to the as-built code, after the v3 eval found the gates existed but their
bindings were a notch loose (and several claims didn't match real code). Kept for history.

**Status (original):** DESIGN v3 (awaiting human approval + 3rd eval before BUILD)
**Supersedes:** v2 (`-design-v2.md`), which superseded v1. **Inputs:** v2 + v2-eval (8 CRITICAL
clusters C1–C8 + H1–H4 + MED) + DLF (Codex, Tier Card, cross-unit/refer-back).
**Principle of v3:** *every DLF property is a concrete gate — a column, constraint, trigger, or
engine step — never prose.* The v2-eval traceability is in §16.

## 0. Decisions (unchanged from v2, now mechanized)
All-four axes · advisory→enforce (= paperwork→runtime tier crossing) · sealed Codices ·
Role(Codex)·Topic(job)·Appointment·Instance · human/agent = attribute · refer-back · on_behalf_of
(system = infra) · retention in scope.

---

## 1. Identity (C2, H4)

### 1.1 principals — opaque, non-PII
```sql
principals (
  principal_id  TEXT PRIMARY KEY,          -- OPAQUE ULID (H4: never name-derived; display_name is the only PII)
  kind          TEXT NOT NULL CHECK (kind IN ('human','agent','system')),
  kind_verified BOOLEAN NOT NULL DEFAULT false,
  display_name  TEXT NOT NULL,             -- the ONLY PII; erasure anonymizes THIS only
  status        TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active','suspended','retired')),
  is_authority_root BOOLEAN NOT NULL DEFAULT false,  -- the global break-glass human seat (C3)
  created_by    TEXT, created_at TIMESTAMPTZ NOT NULL DEFAULT now()
)
```
- **kind_verified fail-closed (MED/A-S8):** rows created *before* migration 0064 may be heuristic
  (`kind_verified=false` → treated as **human**, fail-open, one-time). Rows created *after* 0064
  MUST set kind explicitly; an unverified post-0064 principal performing a sensitive action is
  treated as **agent** (fail-closed), never human.
- **Non-reusable:** retire sets `status='retired'`; the row (and PK) is retained → re-mint of a slug
  is impossible. (Opaque ULIDs make collision irrelevant anyway.)

### 1.2 instances — the per-task fence handle (C2: the actual mechanism finding-H needed)
```sql
instances (
  instance_id   TEXT PRIMARY KEY,          -- server-minted ULID at principal resolution; NEVER body-suppliable
  principal_id  TEXT NOT NULL REFERENCES principals,
  surface       TEXT NOT NULL,             -- 'rest'|'mcp'|'worker'
  started_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  ended_at      TIMESTAMPTZ                -- set on disband; "provenance, not inheritance"
)
```
- Minted in `bearerAuth` (REST) / `resolveMcpCallerScope` (MCP) / job pickup (worker). Returned to
  the caller (response header `X-ContextHub-Instance` / MCP context) so it can be presented on
  follow-up calls. **The server validates a presented instance_id belongs to the authenticated
  principal**; a forged/foreign instance_id → mint a fresh one (never trust it).
- **Fence key (C2):** Board `claims` and `tasks.assigned_to` carry `(principal_id, instance_id,
  fencing_token)`. Two concurrent instances of one agent type now have **distinct instance_ids** →
  the fence distinguishes them; abandoned-claim sweep keys on instance liveness.

### 1.3 actor_id → principal reconciliation (C2: enumerate ALL tables)
Add `principal_id TEXT REFERENCES principals` (+ `instance_id` where concurrency matters) and
backfill, on **every** actor-keyed table — not just `actors`:
`claims.actor_id`, `votes.actor_id`+`proxy_for`, `topic_participants.actor_id`+`granted_by`,
`proxies.principal/proxy/granted_by`, `artifact_leases.agent_id`, `tasks.created_by`+`assigned_to`,
`requests.submitted_by`, `request_steps.decided_by`, `motions.proposed_by/seconded_by`,
`disputes.parties`, `intake_items.submitted_by`, `lessons.captured_by`, `lesson_versions.changed_by`.
- `actor_id == principal_id` invariant holds (opaque ULID is the single namespace).
- `actors` (project membership) gains `principal_id`; `type` CHECK migrated `('human','ai') →
  ('human','agent','system')`, data-fix `ai→agent` (via the expand-contract sequence §10.3).

### 1.4 api_keys
`api_keys.principal_id TEXT REFERENCES principals` — credential authenticates AS this principal.
Credential-agnostic (a Phase-5 cryptographic identity can later back the same principal).

---

## 2. Roles = sealed Codices (C1)

### 2.1 Schema
```sql
roles (
  role_id       TEXT PRIMARY KEY,
  owner_project TEXT,                       -- NULL = framework/global base; else project custom
  base_role_id  TEXT REFERENCES roles,      -- override extends a base ("extend, never relax")
  display_name  TEXT, description TEXT,
  sealed        BOOLEAN NOT NULL DEFAULT false,
  sealed_by     TEXT, sealed_at TIMESTAMPTZ, version TEXT
)
codex_permissions ( role_id TEXT REFERENCES roles, resource_type TEXT, action TEXT,
                    PRIMARY KEY (role_id, resource_type, action) )   -- GRANT-only; '*' allowed
codex_rules (                                -- Hard-Stop / Notify / require-approval overlay
  rule_id TEXT PRIMARY KEY, role_id TEXT REFERENCES roles,         -- NULL = applies to all
  actor_kind TEXT NOT NULL DEFAULT '*' CHECK (actor_kind IN ('human','agent','system','*')),
  resource_type TEXT NOT NULL, action TEXT NOT NULL, predicate TEXT,
  effect TEXT NOT NULL CHECK (effect IN ('deny','refer_back','notify')),
  blocking BOOLEAN NOT NULL DEFAULT true )
re_consecrations ( id TEXT PRIMARY KEY, target_kind TEXT, target_id TEXT, old_version TEXT,
                   new_version TEXT, motion_id TEXT, reason TEXT, approved_by TEXT, approved_at TIMESTAMPTZ )
```

### 2.2 Sealing enforced at the DB (C1 — not convention)
A trigger on `roles` (seal cols), `codex_permissions`, `codex_rules`:
```sql
CREATE FUNCTION assert_not_sealed() RETURNS trigger AS $$
BEGIN
  IF (SELECT sealed FROM roles WHERE role_id = COALESCE(NEW.role_id, OLD.role_id))
     AND current_setting('app.reconsecration_id', true) IS NULL
  THEN RAISE EXCEPTION 'sealed role: change requires re-consecration';
  END IF; RETURN COALESCE(NEW, OLD);
END $$ LANGUAGE plpgsql;
```
The **only** write path that may mutate a sealed Codex is the re-consecration ceremony, which (in
one txn) inserts the `re_consecrations` row and `SET LOCAL app.reconsecration_id = '<id>'`. No
route, migration, or worker can bypass it.

### 2.3 Base→override = "extend, never relax" (C1, A-S4)
- **Effective sets are the transitive closure of the base chain:**
  `eff_perms(r) = perms(r) ∪ eff_perms(base(r))`; `eff_rules(r) = rules(r) ∪ eff_rules(base(r))`.
- **A base `deny`/`refer_back` rule always wins** in RESOLVE — an override cannot delete an
  inherited rule (it can only add rows; rule rows are never inherited-then-removed).
- **Validation at role amend:** reject inserting a `codex_permissions(r, X, Y)` when an inherited
  `codex_rules` `deny` covers `(X,Y)` — an override may not grant what the base denies.

---

## 3. Topic (job), Appointment, Authority root (C3, C7)

### 3.1 Appointment
```sql
appointments (
  appointment_id TEXT PRIMARY KEY,
  principal_id   TEXT NOT NULL REFERENCES principals,
  role_id        TEXT NOT NULL REFERENCES roles,
  scope_type     TEXT NOT NULL CHECK (scope_type IN ('global','project','topic','task')),
  scope_id       TEXT,                       -- normally a topic_id (the job); NULL for global
  granted_by     TEXT NOT NULL REFERENCES principals,   -- AUTHENTICATED; injected, never body-supplied
  status         TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active','rolled_off')),
  rolled_off_at  TIMESTAMPTZ, created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CHECK (granted_by IS DISTINCT FROM principal_id),     -- no self-grant
  UNIQUE (principal_id, role_id, scope_type, scope_id)
)
```
- **Scope confinement of custom roles (C7):** a trigger rejects an appointment where
  `role.owner_project = P` and the resolved scope is not inside P (global/other-project forbidden).
- **No-escalation `assertGrantSubset` (C7):** on `role:grant`, the engine computes the **granter's**
  effective permission set *at the target scope* and rejects if `eff_perms(role) ⊄
  eff_perms(granter @ target_scope)`. `role:grant`/`apikey:mint` additionally require `granter.kind
  = human` (§5-O2).
- **Lifetime:** ends when the topic closes (topic-scoped, §8.1) or on explicit roll-off; retirement
  rolls off all. Past work stays attributed (instance/provenance survives).

### 3.2 Authority root — a real, resolvable mechanism (C3)
```sql
-- topics gains:  authority_principal_id TEXT REFERENCES principals  (must be kind='human' at charter)
--                parent_topic_id        TEXT REFERENCES topics       (the ancestor chain; NULL = top)
```
- **Resolution function** `resolveAuthority(topic)`: walk `authority_principal_id` up
  `parent_topic_id` → then the **project authority** (an appointment of an `authority` role at
  `scope_type='project'` held by a `human`) → then the **global break-glass human**
  (`principals.is_authority_root = true`). Returns the nearest **active human**.
- **Charter invariant (trigger/service):** a topic cannot be chartered unless `resolveAuthority`
  yields an active human (directly or via the global root). So "the root" is always a real row.
- **Honesty (C3):** if `resolveAuthority` ever returns none (all-agent org with the global human
  seat vacated), refer-back/re-consecration enters **forced-triage** (alert + block, 90/180 style)
  — we *surface* the liveness residual exactly as DLF does; we do **not** claim to dissolve it.

### 3.3 Genesis & re-consecration (C3 — breaks the bootstrap circularity)
- Migration 0064 seeds two principals: `human:root` (`kind='human', is_authority_root=true`) and
  `system:bootstrap-admin` (`kind='system'`, infra). It mints the bootstrap **human** credential
  (idempotent CLI, §10.4) bound to `human:root`.
- **Genesis exception:** when **no quorate Ascension Council exists**, `human:root` may seal/amend a
  Codex *without a motion* — `re_consecrations(reason='genesis', motion_id=NULL)` — gated by a
  `codex:consecrate` capability held only by `is_authority_root`. This is the unsealed root that
  makes the first Codex amendable.
- **Steady state:** a re-consecration is a Phase-15 **collective decision** (motion) by an appointed
  Ascension Council; the **global human root is always an eligible voter** so a re-consecration
  motion can never be quorum-starved (mirrors the refer-back root — closes C3-#2). Once a Council is
  appointed, genesis authority is dormant (used only if the Council becomes un-quorate).

---

## 4. Action catalog (MED A-S11)
```sql
action_catalog ( resource_type TEXT, action TEXT, kind TEXT
                 CHECK (kind IN ('create','per_resource','collection')),
                 security_sensitive BOOLEAN NOT NULL DEFAULT false,   -- never-advisory flag (C1/C8, per-action not a list)
                 produces_state_for TEXT[],   -- for the flip-ordering graph (§9.4)
                 PRIMARY KEY (resource_type, action) )
```
- `create` → no resource_id; authorize against target project/topic + assigns `owner_principal_id =
  caller`. `per_resource` → resource_id required (PRE deny if missing). `collection` → list/search,
  uses the **batch authorizer** (§9.3).
- `security_sensitive=true` ⇒ **never advisory** (always enforce) regardless of `AUTHZ_MODE` — set
  for `role:grant`, `apikey:mint`, `principal:write`, `codex:amend`, `codex:consecrate`,
  `visibility:promote`, `authz:override:write`, `authz:kill:write`, and the governance set.

---

## 5. The authorize() engine (C5, C6 + the v2 algorithm, fully specified)
```
authorize(principal, action, resource, { conn, mode, on_behalf_of }) -> Decision
  actor := on_behalf_of ?? principal          # delegated exec authorizes AS the originator (C4)
  cat   := action_catalog[resource.resource_type, action]

  PRE  (hard; NEVER advisory; status NEVER cached — C8):
    P1. live SELECT principals.status WHERE principal_id=actor → must be 'active' else DENY
    P2. assertXScope(actor.project_scope, resource.project_id)   cross-tenant → NOT_FOUND
    P3. if cat.kind='per_resource' and resource.resource_id is null → DENY missing_resource_id
        load owner_principal_id/visibility/topic_id/task_id FROM DB by resource_id  (never trust ResourceRef)

  STAGE 1 — provisional grant:
    if actor owns resource (principal_id == owner_principal_id) → grant := true (capability)
    elif resource.resource_type in GOVERNANCE_TYPES:                                   # C5
        grant := phase15_grants(actor, action, resource) AND NOT codex_denies(actor, action, resource)
        # absence of a codex GRANT is NEVER a deny for governance types
    else:
        grant := visibility_allows(actor, resource) AND codex_grants(actor, action, resource)   # C6 below

  STAGE 2 — mandatory overlay (always runs; can veto/escalate any grant):
    for rule in eff_rules matching (actor.kind|'*', resource.resource_type|'*', action|'*', predicate):
        deny       → effect := DENY
        refer_back → effect := REFER_BACK (open one; route to resolveAuthority — §7)
    # base deny/refer_back wins (extend-never-relax, §2.3)

  RESOLVE:  DENY (any) > REFER_BACK (any) > ALLOW (grant) > DENY (default_deny)
  EXISTENCE: private/restricted + no read grant → NOT_FOUND (not FORBIDDEN)
  MODE:  security_sensitive OR governance → ENFORCE always.
         else paperwork(audit): compute+log, return-as-allowed for owner/visibility/codex effects.
         else runtime(enforce): DENY throws (NOT_FOUND/FORBIDDEN); REFER_BACK throws ApprovalRequired.
```
### 5.1 codex_grants with scope coverage (C6)
```
codex_grants(actor, action, res) :=
  ∃ active appointment A of actor :
     (action,res.resource_type) ∈ eff_perms(A.role)  AND  covers(A.scope_type, A.scope_id, res)
covers(global,_,res)        = res in actor's tenant
covers(project, pid, res)   = res.project_id == pid
covers(topic,   tid, res)   = res.topic_id   == tid          # resources without topic_id: only project/global cover
covers(task,    kid, res)   = res.task_id    == kid
```
### 5.2 Batch authorizer (C8/perf) — mandatory on `collection` actions
`authorizeMany(principal, action, rows[])`: load appointments+eff_perms/eff_rules **once** (cached
per request, §9.1); the search/list query SELECTs owner/visibility alongside rows; evaluate
visibility+codex in-memory per row → **zero per-row DB round-trips**. Per-row `authorize()` on list
surfaces is forbidden (CI perf test).
### 5.3 Multi-resource edge
`authorizeEdge(principal, action, [res...])` checks each side (read on referenced, write on owning);
strictest mode wins; existence rule per side.

---

## 6. on_behalf_of — plumbed through the real seams (C4)
- `jobs.enqueued_by_principal TEXT REFERENCES principals` + `chain_depth INT DEFAULT 0`, set at
  enqueue from the **authenticated** caller (never body). Internal re-enqueues copy it **verbatim**
  (like `correlation_id`).
- `executeByType(jobType, projectId, payload, correlationId, sourceJobId, onBehalfOf)` — new param;
  the worker calls `authorize(systemPrincipal, action, res, { on_behalf_of: onBehalfOf })` at
  **execute-time with live authority** (appointment/topic/status re-read, never the enqueue
  snapshot — MED C3-#16). topic-closed/appointment-rolled-off mid-flight → fail closed (dead-letter
  + reason).
- `emitChain`: a **carried-outcome** task sets `created_by/origin_principal = the proposer/origin`
  (not `system:sweep`); `system:sweep` is used ONLY for the sweep's own lapse/expire bookkeeping
  events. Invariant test: no substantive Board task is `created_by` a `system` principal.
- **Depth bound:** `chain_depth` increments per hop; `> MAX_CHAIN_DEPTH` → refer-back/dead-letter.
- **Absent origin (legacy backlog) → fail closed:** run as a restricted `system:legacy-runner`
  with **no** sensitive-action grants (a laundered `delete`/`promote` still denies); pre-0064 jobs
  dead-lettered or requeued with origin.

---

## 7. Refer-back — full state machine (H2, C3)
```sql
refer_backs (
  id TEXT PRIMARY KEY, originating_principal TEXT REFERENCES principals,
  action TEXT, resource_type TEXT, resource_id TEXT, topic_id TEXT,
  facts_hash TEXT,                            -- H2: re-affirm-binds / new-facts gate
  security_fingerprint TEXT,                  -- owner+visibility+topic_state @ approval (NOT content version)
  authority_principal TEXT REFERENCES principals,  -- resolveAuthority(topic) at open time
  one_shot_token TEXT,
  status TEXT CHECK (status IN ('open','reaffirmed','amended','withdrawn','consumed','force_lapsed')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
)
```
- **Routing (C3):** `authority_principal = resolveAuthority(topic)` (§3.2) — a real human row, or
  forced-triage if none.
- **Consume binds to the authority (H2/B-S14):** the approve/consume path requires
  `approver == authority_principal` (or an appointment whose scope ⊇ resource.topic with an
  authority role). A bare `kind='human'` is necessary but not sufficient.
- **Re-affirm binds (H2/B-S3):** after `reaffirmed`, a new refer_back for the same
  `(principal,action,resource_id)` is rejected `PROTOCOL_VIOLATION` unless `facts_hash` differs from
  all prior rows for that tuple; hard per-tuple re-refer cap regardless.
- **One-shot token (H2/B-S4):** bound to the **security fingerprint** (owner/visibility/topic_state),
  not content version. On re-entry: re-check actor status + tenant + topic-open + re-run Stage-2
  overlay; fingerprint mismatch → invalid → re-escalate. Bypasses only the re-escalation, never the
  hard preconditions.
- **Open-cap (H2/B-S13):** `MAX_OPEN_REFER_BACKS_PER_PRINCIPAL` + per-(principal,topic) sub-cap,
  enforced transactionally (count `open` FOR UPDATE); exceed → the gated action hard-DENIES
  (`too_many_pending`).

---

## 8. Lifecycle operations (H1 — gates become operations)
### 8.1 Topic close cascade
`closeTopic` Phase-2 drain gains a pass over **`refer_backs`** (force-lapse `open` → `force_lapsed`,
emit event, invalidate token) — added to `ForceLapsedCounts` alongside the existing 5 entity types;
plus: roll off `appointments WHERE scope_type='topic' AND scope_id=T`, and sweep `claims WHERE
topic_id=T`. The refer-back drain pass runs as `system:closing-recovery` (an *infra lapse*, not a
human withdrawal; distinct `refer_back.force_lapsed` event for audit).
### 8.2 Suspend / retire operation
A first-class op (not just the status flag): on suspend/retire — (a) roll off appointments;
(b) sweep claims (invalidate fencing); (c) reroute `open` refer_backs whose `authority_principal` is
the affected principal up to the next `resolveAuthority`; (d) exclude from quorum / `body_members`;
(e) **reassign owned private/restricted resources** to a designated successor or project-admin (or
relax to `restricted` with an explicit admin grant), logged — so retire never strands data.

---

## 9. Rollout / invalidation (C8, H3) — the runtime tier
### 9.1 Versioning & cache
- `authz_version (scope_kind TEXT, scope_id TEXT, version BIGINT)` — **per-project and
  per-principal** (not one global counter — avoids thundering-herd). Bumped on **any
  authority-affecting write**: `principals.status`, appointments, role/codex seal+amend, overrides.
- Per-request cache of appointments/eff_perms/eff_rules keyed off the relevant `authz_version`.
- **`principals.status` is NEVER cached** — a live cheap point-read every request (C8/C3-#13).
- Long on_behalf_of jobs re-authorize **per protected action**, not once per job (C3-#6/#16).
### 9.2 Kill switch & mode (DB, not env — C8/C3-#5)
- `authz_runtime_flags (global_kill BOOLEAN, updated_at)` + `authz_mode_overrides (resource_type,
  action, mode, updated_at)` — DB rows read per-request with a 1–2 s TTL keyed off `authz_version`.
  Coherent across mcp + worker + all replicas within the TTL (env only sets a boot-time floor).
  Writing either is `security_sensitive` (never-advisory) + `human` + **global-admin only** (C8/#12).
### 9.3 Coverage telemetry (C8/C3-#4 — decoupled from sampling)
- `authz_observed_actions (resource_type, action, project_id, last_seen)` — idempotent `ON CONFLICT
  DO NOTHING`/upsert, one row per distinct action (bounded, **not sampled**).
- `authorization_decisions` stays the **sampled** (all denies/refer-backs + N% allows),
  **monthly-partitioned**, retained+rolled-up forensic log. Read path **and rollups** tenant-filtered
  per-project (C3-#14); rollups stored per-project; `resource_id` of private/restricted resources
  hashed in any cross-tenant-visible surface.
### 9.4 Flip gate & ordering (H3)
- **Positive coverage by synthetic replay (not waiver):** the gate replays **every** catalogued
  `(resource_type,action)` through `authorize()` in advisory against representative fixtures and
  asserts no surprising effect; organic `authz_observed_actions` augments it. Rare/un-exercisable
  actions stay `audit` with a loud `never_enforced` registry entry. A waiver must cite a synthetic-
  evidence id.
- **Surprise = deny OR refer_back** (both are behavior change at flip).
- **Flip-ordering graph (C3-#11):** `action_catalog.produces_state_for` — an action may flip to
  enforce only when all actions that *produce the state it reads* are already enforce (write/create/
  visibility-promote before read).
- Flip granularity is **per (resource_type, action)**.

---

## 10. Migrations (0064+) — expand-contract, online, reversible (H3, H4)
1. **0064 identity scaffold:** `principals` (opaque ULID), `instances`, `roles`/`codex_*`/
   `re_consecrations`, `appointments`, `action_catalog`, `authz_version`/`authz_runtime_flags`/
   `authz_mode_overrides`/`authz_observed_actions`, `authorization_decisions` (partitioned),
   `refer_backs`; seal trigger; seed `human:root` + `system:bootstrap-admin`; seed framework base
   Codices (sealed) + action catalog. Boot self-check (§10.4).
2. **0065 api_keys/actors principal binding + actor-table reconciliation** (§1.3): add
   `principal_id` (+ instance where needed) FKs; backfill (legacy name→opaque id re-key map, H4).
3. **0066 ownership/visibility** on ownable tables (online): add nullable `owner_principal_id` +
   `visibility DEFAULT 'project'` → deploy app code that sets owner on every new INSERT → **batched
   backfill** (PK-range, throttled) → `ADD CONSTRAINT NOT NULL … NOT VALID` then `VALIDATE
   CONSTRAINT` → gate: `COUNT(*) WHERE owner IS NULL = 0` stable. Sentinel owner `system:legacy-import`
   for genuinely ownerless legacy rows. Add `project_id` to comments/feedback/bookmarks;
   `tasks.assigned_to`.
4. **0067 governance binding:** `topics.authority_principal_id` + `parent_topic_id` + charter
   invariant; jobs `enqueued_by_principal`/`chain_depth`.
### 10.3 actors.type expand-contract (H3/C3-#9)
(1) expand CHECK to superset `('human','ai','agent','system')`, deploy; (2) deploy new code writing
only `agent/system`, **wait 100% rollout**; (3) re-sweep `UPDATE ai→agent` (idempotent); (4) a
**separate later** migration, gated on "no old pods" + stable `COUNT(type='ai')=0`, contracts the
CHECK to drop `ai`.
### 10.4 Bootstrap-admin (C3/C3-#7)
Boot self-check is **warn-only while `MCP_AUTH_ENABLED=false`**; **fail-loud only when auth on** and
no resolvable human authority root. Credential mint is an **idempotent, re-runnable CLI** (`npm run
bootstrap-admin:mint`) that generates+prints the secret on demand (rotates with confirmation) — never
a once-only migration side effect; the migration only creates the principal row + a NULL-hash
placeholder.

---

## 11. Retention / erasure (H4)
Opaque `principal_id` (ULID) means **erasure = anonymize `display_name` only**; every audit/
governance/appointment row keeps the opaque id and still resolves to "[erased principal]" — satisfies
GDPR erasure AND append-only audit immutability. Legacy name-derived slugs are re-keyed to opaque ids
in 0065 before erasure is offered. `authorization_decisions` retention = raw N days → per-project
rollup → drop raw.

---

## 12. Surfaces
REST `req.principal` + minted `instance_id`; `/api/me` returns appointments + effective codex;
admin routes for principals/roles(codices, re-consecration ceremony)/appointments/codex-rules/
authz-overrides (all `security_sensitive`); tenant-filtered `/api/authz/decisions`. MCP drops body
`actor_id` (derived), returns instance_id in context, adds `grant_role`/`refer_back`/`approve`/
`list_my_permissions`/`consecrate`. GUI: principals/roles matrix, sealed badges + re-consecration
flow, owner/visibility controls, refer-back approval inbox + **batch-approve**, authz audit/would-flip
report.

## 13. Composition / non-regression
`assertXScope` stays the first hard gate (P2). Governance types AND-compose with Phase-15
(Phase-15 grants; Codex deny-only — C5). HARD authz triggers (owner permanence, no-self-grant DB
CHECK, no-escalation subset) preserved + extended. DEFERRED-029 three bypass patterns re-checked each
adversary pass. Phase-15 drain/sweep/chaining now carry origin (C4) and include refer_backs (H1).

## 14. Test & review
`authorize()` truth-table (every PRE/STAGE/RESOLVE/EXISTENCE/MODE path; scope-coverage matrix;
governance `AND NOT codex_denies`; status-never-cached; on_behalf_of execute-time; batch authorizer
parity). Sealing trigger tests (direct mutate of sealed Codex throws; ceremony path succeeds).
Refer-back state-machine tests (re-affirm-binds, token fingerprint, authority-bound consume, open-cap).
Lifecycle tests (topic-close drains refer_backs; suspend reroutes/reassigns). Rollout tests (DB
kill-switch coherence across worker; status-suspend visible immediately; flip-ordering). **Mandatory
auth-on + enforce-mode CI lane** (extend `docker-compose.auth-test.yml`) with positive cross-actor /
refer-back / escalation-blocked assertions + a 100-row search p95 perf budget. **Cold-start
hostile-actor adversary (multi-pass)** on every phase that adds an authz/governance primitive
(A/C/D/E) + live verification of the documented end-state.

## 15. Phases (advisory-first; each adversary-reviewed before the next)
- **A Identity:** migrations 0064–0065; principal+instance resolution; opaque ids; stop-trusting-
  asserted-identity; actor-table reconciliation; genesis seed + boot check. AC: identity
  un-spoofable; finding-H concretely resolved (instance fence); auth-off unchanged.
- **B Ownership+retention:** 0066; online backfill; visibility-AND surfacing; erasure. AC: every
  ownable row owned (0 NULL); collaboration tables scoped.
- **C Engine (paperwork):** authorize() (scope-coverage, governance formula, batch authorizer) wired
  after assertXScope; `authz_observed_actions` + sampled decisions; would-flip report (deny+refer).
  AC: correct decision per access; never blocks non-sensitive; security_sensitive enforce from day 1.
- **D Codices + refer-back + governance:** seal triggers + ceremony; base→override; appointment CRUD
  (human granter, no-escalation subset); refer-back state machine → resolveAuthority; suspend/retire
  + topic-close cascades. AC: sealed Codex unmutable except by ceremony; agent sensitive action
  refers to a real human; escalation blocked.
- **E Tier crossing:** synthetic-replay flip gate + flip-ordering; DB kill switch; DEFERRED-041
  human session; secure-by-default non-loopback. AC: cross-actor/cross-task denied at enforce; rollback
  coherent across worker+replicas.

## 16. v2-eval traceability
C1→§2.2/§2.3 · C2→§1.2/§1.3 · C3→§3.2/§3.3 · C4→§6 · C5→§5(STAGE1 governance) · C6→§5.1 ·
C7→§3.1 · C8→§9 · H1→§8 · H2→§7 · H3→§9.4/§10 · H4→§1.1/§11 · MED(kind_verified)→§1.1 ·
MED(action kinds)→§4 · MED(null actor_kind)→§5(treat typeless as agent, fail-closed) ·
MED(decisions rollup)→§9.3 · MED(on_behalf_of live)→§6.

## 17. Residual risks (honest)
- **All-agent liveness residual** — refer-back/re-consecration with no human resolvable is *surfaced*
  (forced-triage + alert), not dissolved. This is a DLF CAP-AP property, not a bug we can engineer away.
- **Performance** of authorize() on hot paths — mitigated by batch authorizer + per-request caching;
  must be validated by the CI perf budget, not assumed.
- **Re-consecration ceremony UX** (Council composition, quorum) — concrete mechanism here; the
  *policy* (who sits) is a per-deployment choice.
