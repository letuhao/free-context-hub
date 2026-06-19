# DESIGN v2 — Actor / Project / Task Data Boundaries (DLF-grounded)

**Status:** DESIGN v2 (awaiting human approval before BUILD)
**Supersedes:** `2026-06-19-actor-data-boundary-design.md` (v1)
**Branch:** `feature/actor-data-boundary` · **Date:** 2026-06-19 · **Scope:** XL
**Inputs:** CLARIFY spec, v1 design, scenario eval (`-eval.md`), and the **Dead Light
Framework** (`D:\Works\source\dead-light-framework` — Codex, Tier Card, Paperwork Standard).

> v2 rebuilds the identity/authority model on DLF primitives after a 46-scenario red-team
> found v1's generic-RBAC frame caused multiple CRITICAL breaks. The authz *truth-table* from
> v1 (§14a fixes) is retained; the *shape* of authority, approval, and rollout is replaced.

## 0. Decisions locked

| Decision | Choice |
|---|---|
| Boundary axes | authenticated identity · human/agent policy · actor ownership · task/topic access |
| Posture | **advisory-first → enforce** (= DLF paperwork→runtime **tier crossing**) |
| Authority model | **sealed Codices** (per-role rulebooks), not freely-mutable RBAC |
| Identity | **Role(Codex) · Topic(job) · Appointment · Task(instance)**; type-level agent principals |
| Human/agent | **cross-cutting attribute**, not the primary axis (the **role** is) |
| Approval shape | **refer-back** (*obedezco pero no cumplo*) up the ancestor chain to a human Authority |
| Delegated exec | **on_behalf_of** — worker/chaining/proxy act as the originating principal; `system` = infrastructure |
| Retention | **in scope** (partition + rollup + principal erasure) |

## 1. The DLF mapping (the conceptual spine)

ContextHub is the **runtime tier** of DLF. v2 expresses DLF primitives 1:1:

| DLF concept | ContextHub object | Lifetime |
|---|---|---|
| **Chapter** (agent *type*) / role | **Principal** (type-level for agents) + the **Role** it's appointed to | principal persistent; role persistent per project |
| **Codex** (a Chapter's sealed rulebook: operational bounds, Hard Stops, Notify Triggers, output contract) | **Role = a sealed Codex** (permissions + rules) | persistent, **sealed**; change = re-consecration |
| **Astronomican** (sealed immutable laws) | **Sealed guardrails / laws** (existing `codex-guardrail` + `<!-- sealed -->`) | persistent, sealed |
| **Topic / chartered initiative (a "job")** | **Topic** (Phase 15) | a long run of many tasks; closes |
| **Task** | **Board task** (Phase 15) | one unit of work |
| **Appointment** (staff a Chapter) | **Appointment** = principal→role @ scope (normally **topic**) | held while topic open / until roll-off |
| **Instance** (per-task, anonymous, "provenance not inheritance", no state — HS-7) | per-task **session/claim token** | ephemeral; **the runtime fence handle**, not an identity |
| **Refer-back** (*obedezco pero no cumplo*) | suspend → escalate up the chain → human Authority re-affirms/amends/withdraws | per incident |
| **Re-consecration** (Ascension Council un-seals + re-seals) | a **collective decision** (reuse Phase 15 motions/bodies) to amend a sealed Codex/law | ceremony |
| **Paperwork tier** (Available + eventually-consistent; *detect & reconcile*) | **advisory (audit) mode** | rollout phase |
| **Runtime tier** (real-time integrity; locks/transactions; *prevent*) | **enforce mode** + Board fencing | end state |

**Core principle (DLF):** *authority lives in the sealed role (Codex), not in the principal
and not in the instance.* A principal is **appointed** to a role for a **topic (job)**;
**instances** assume it per task and disband ("recorded for provenance, not inheritance");
human/agent is an **attribute** only specific Codex rules read (e.g. HS-2: a sealed/final act
needs a **human** appointment to sign off).

## 2. Data model

### 2.1 Identity & appointment
```sql
principals (                            -- durable identity (the org member)
  principal_id  TEXT PRIMARY KEY,        -- stable slug; NON-REUSABLE (tombstoned on retire — eval S11)
  type          TEXT NOT NULL CHECK (type IN ('human','agent','system')),
  type_verified BOOLEAN NOT NULL DEFAULT false,  -- backfill heuristic → unverified treated as human (eval #2)
  display_name  TEXT NOT NULL,
  status        TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active','suspended','retired')),
  created_by    TEXT, created_at TIMESTAMPTZ NOT NULL DEFAULT now()
)
-- api_keys.principal_id TEXT  -- credential authenticates AS this principal (credential-agnostic:
--                                a Phase-5 cryptographic identity can back the same principal later)
-- actors.principal_id  TEXT   -- project membership = a principal's projection; actor_id == principal_id
--   + migrate actors.type CHECK ('human','ai') → ('human','agent','system'), data fix ai→agent (eval S-CRIT3)

appointments (                          -- principal HOLDS a role for a scope (the durable grant)
  appointment_id TEXT PRIMARY KEY,
  principal_id   TEXT NOT NULL,
  role_id        TEXT NOT NULL,          -- the Codex
  scope_type     TEXT NOT NULL CHECK (scope_type IN ('global','project','topic','task')),
  scope_id       TEXT,                   -- normally a topic_id (the "job"); NULL for global
  granted_by     TEXT NOT NULL,          -- AUTHENTICATED principal, injected, never body-supplied
  status         TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active','rolled_off')),
  rolled_off_at  TIMESTAMPTZ,
  created_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
  CHECK (granted_by IS DISTINCT FROM principal_id),                 -- no self-grant (eval C)
  UNIQUE (principal_id, role_id, scope_type, scope_id)
)
-- Appointment ends when the topic closes (topic-scoped) or on explicit roll-off; retirement
-- (principal.status) rolls off all appointments. Past work stays attributed (provenance).
```

### 2.2 Roles as sealed Codices
```sql
roles (                                 -- a Role IS a Codex
  role_id       TEXT PRIMARY KEY,
  owner_project TEXT,                    -- NULL = framework/global base; else project custom
  base_role_id  TEXT,                    -- override extends a base Codex ("extend, never relax")
  display_name  TEXT, description TEXT,
  sealed        BOOLEAN NOT NULL DEFAULT false,
  sealed_by     TEXT, sealed_at TIMESTAMPTZ, version TEXT
)
codex_permissions (                     -- GRANT entries only (RBAC has no deny — eval A/§9)
  role_id TEXT, resource_type TEXT, action TEXT,
  PRIMARY KEY (role_id, resource_type, action)         -- wildcards '*' allowed
)
codex_rules (                           -- Hard Stops / Notify / require-approval overlay (HS-*/N-*)
  rule_id       TEXT PRIMARY KEY,
  role_id       TEXT,                    -- NULL = applies to all roles
  actor_type    TEXT NOT NULL DEFAULT '*' CHECK (actor_type IN ('human','agent','system','*')),
  resource_type TEXT NOT NULL, action TEXT NOT NULL,   -- or '*'
  predicate     TEXT,                    -- e.g. 'target_sealed','visibility_promote','cross_project'
  effect        TEXT NOT NULL CHECK (effect IN ('deny','refer_back','notify')),
  blocking      BOOLEAN NOT NULL DEFAULT true,
  sealed        BOOLEAN NOT NULL DEFAULT true
)
re_consecrations (                      -- the ceremony log to change any sealed artifact (HS-1)
  id TEXT PRIMARY KEY, target_kind TEXT, target_id TEXT,
  old_version TEXT, new_version TEXT, motion_id TEXT,  -- reuse Phase 15 collective decision
  approved_by TEXT, approved_at TIMESTAMPTZ
)
```

### 2.3 Ownership / visibility (on ownable resources)
- `owner_principal_id TEXT` + `visibility TEXT NOT NULL DEFAULT 'project'
  CHECK (visibility IN ('private','project','shared','restricted'))` on lessons, documents,
  document_chunks, tasks, artifacts, generated_documents, guardrails, topics.
- Add `project_id` to `lesson_comments`/`lesson_feedback`/`bookmarks`; `tasks.assigned_to`.
- **Read access = `visibility_allows(principal,res) AND codex_grants(read)`** — visibility is a
  RESTRICTION, not an OR-alternative (eval A; "explicit role" = a resource-scoped/admin grant,
  never blanket `*:read`). `private`/`restricted` deny → `NOT_FOUND` (no oracle, eval MED-2/S5).
- **`visibility` promotion** (`private/project → shared/restricted`) is itself a privileged,
  refer-back-gated action (eval S15).

### 2.4 Decision log / modes / approvals
```sql
authorization_decisions (               -- SAMPLED (all denies + N% allows), MONTHLY-PARTITIONED, retained+rolled-up
  id TEXT, ts TIMESTAMPTZ, principal_id TEXT, on_behalf_of TEXT, actor_type TEXT,
  action TEXT, resource_type TEXT, resource_id TEXT, project_id TEXT, topic_id TEXT,
  effect TEXT, tier TEXT, mode TEXT, reason TEXT, surface TEXT
)   -- read path TENANT-FILTERED (project-scoped auditor sees only own project — eval #8)
refer_backs (                           -- obedezco pero no cumplo
  id TEXT PRIMARY KEY, originating_principal TEXT, action TEXT,
  resource_type TEXT, resource_id TEXT, resource_fingerprint TEXT,  -- owner+visibility+topic+version@approval
  status TEXT CHECK (status IN ('open','reaffirmed','amended','withdrawn','consumed')),
  authority_principal TEXT, one_shot_token TEXT, topic_id TEXT, created_at TIMESTAMPTZ
)   -- one OPEN per (principal,action,resource_id) (dedup); per-principal open cap (eval #4)
authz_mode_overrides ( resource_type TEXT, action TEXT, mode TEXT, updated_at TIMESTAMPTZ )
authz_config_version ( version BIGINT )  -- bumped on any override write → cache invalidation (eval #6)
```
- Env `AUTHZ_MODE` (global default) + `AUTHZ_GLOBAL_KILL=audit` (per-request read; instant
  rollback, no redeploy — eval #6). Mode read is cheap + cached against `authz_config_version`.

## 3. Authorization engine (`src/core/security/authorize.ts`)

```
DECISION = authorize(principal, action, resource, { conn, mode, on_behalf_of }):
  PRE (hard, never advisory):
    P1. principal.status == active            else DENY (suspended/retired — eval F)         [never-advisory]
    P2. tenant scope (assertXScope)           cross-tenant → NOT_FOUND                        [never-advisory]
    P3. load owner/visibility/topic/task FROM DB by resource_id (never trust ResourceRef);
        per-resource action with missing resource_id (enforce) → DENY missing_resource_id     [eval HIGH-4]
  STAGE 1 — provisional grant (capability):
    S1. owner_principal_id == principal        → provisional allow (capability only)
    S2. visibility AND codex grant:  read ⇒ visibility_allows AND codex_grants;               [eval A]
        for GOVERNANCE types (motion,request,dispute,decision_body,vote,topic-level):
          effect = Phase15_predicate AND codex (Codex may RESTRICT, never GRANT — eval E)
  STAGE 2 — mandatory overlay (ALWAYS runs; can veto/escalate any S1 allow):                  [eval CRIT1]
    O1. codex_rules / actor_policies for (actor_type, resource_type, action, predicate):
          deny  → DENY (overrides allow)
          refer_back → suspend + REFER UP (one OPEN per resource; human Authority at root)     [eval G/#3]
    O2. identity/governance-mutating actions (role:grant, apikey:mint, principal:write,
        codex:amend, visibility:promote) are NEVER advisory + require a HUMAN granter          [eval C/HIGH-2]
  RESOLVE: deny > refer_back > allow(S1) > DENY(default_deny)
  EXISTENCE: private/restricted + no read grant → NOT_FOUND (not FORBIDDEN)                    [eval MED-2]
  MODE/TIER:
    paperwork(audit): compute + log; return-as-allowed for owner/visibility/codex effects only
    runtime(enforce): deny throws; refer_back throws ApprovalRequiredError → refer_backs row
    (the audit→enforce flip per resource_type/action = the DLF paperwork→runtime tier crossing)
```
- **Multi-resource:** `authorizeEdge(principal, action, [resA,resB])` checks each side; per-side
  action semantics defined (read referenced, write owning); strictest mode wins (eval #5/S15).
- **`authorize()` runs on the mutation's `conn`/transaction** (no check-then-act TOCTOU — eval #7).

## 4. on_behalf_of (delegated execution) — cross-cutting

The worker, Phase-15 chaining, and proxy voting **never act as themselves** — they re-run
`authorize()` as the **originating principal** (`enqueued_by_principal`, captured authenticated
at enqueue, never body-trusted), re-applying the Codex overlay for the real actor_type. So an
agent-enqueued job that would refer-back still refers-back when the worker runs it. **`system`
principals are infrastructure** (sweeps, tally, heartbeats) — scoped to those actions only,
never a `*:*` ambient authority (eval B/#10/#16). Proxy votes: delegator's standing grants;
proxy's credential must be authorized to *act as proxy*; recorded `cast_by` provenance (eval #9).

## 5. Phases (advisory-first; each adversary-reviewed before the next)

- **A — Identity & appointment.** `principals`, `appointments`, api_keys↔principal,
  actors.principal_id + `type` CHECK migration; principal resolution on REST+MCP; **stop
  trusting asserted `actor_id`/`created_by`/`granted_by`/…** (inject authenticated). System
  principal = infra. **Bootstrap-admin seeded in migration 1 + one-time credential mint + boot
  self-check** that fails loud if no global admin (eval #10/#11). AC: identity un-spoofable;
  finding-H resolved (principal=role; fence=instance token); auth-off unchanged.
- **B — Ownership + retention.** owner/visibility columns + backfill (online, **batched**, not
  one UPDATE — eval #3); collaboration-table `project_id`; `tasks.assigned_to`; **retention**:
  partition + rollup `authorization_decisions`, principal erasure (anonymize+tombstone). Read-only
  surfacing. AC: every ownable row owned; no new denials.
- **C — Engine in paperwork (advisory) mode.** `authorize()` wired after `assertXScope` on all
  paths; **sampled** decision logging; tenant-filtered decisions read; would-deny + would-refer
  report. AC: correct decision per access; never blocks; report includes **deny AND refer_back**
  (both are behavior change — eval #13).
- **D — Codices + refer-back governance.** Seed framework base Codices + per-project overrides
  (extend-never-relax); seed `codex_rules` (HS-*/N-*); appointment CRUD (human granter,
  no-escalation: granted ⊆ granter); **refer-back** wired to Phase-15 (human Authority at
  ancestor/Imperial root → dissolves all-agent deadlock, eval #1); one-shot token bound to
  resource fingerprint + re-checks status/tenant/topic on re-entry (eval #2/#3). AC: agent
  sensitive action refers up to a human; grant rules safe.
- **E — Tier crossing (enforce) + session auth.** Flip per resource_type/action audit→enforce
  using the **DLF Tier-Card trigger** (real-time integrity / same-artifact concurrency) +
  **positive-coverage gate** (every catalogued action observed-or-waived; zero deny/refer-back
  surprises — eval #1/#13); `AUTHZ_GLOBAL_KILL` rollback; DEFERRED-041 human session login;
  secure-by-default for non-loopback gateway.

## 6. Surfaces, migration, composition, test
- **Migrations 0064+**, each reversible + reviewed; **expand-contract** for the `actors.type`
  CHECK so rolling deploys don't break (old code writes `ai`) — eval #9.
- **REST/MCP/GUI:** `req.principal` + on_behalf_of; `/api/me` returns appointments+effective
  codex; admin routes for principals/roles(codices)/appointments/codex-rules; tenant-filtered
  `/api/authz/decisions`; MCP drops body `actor_id` (derived); refer-back **approval inbox** +
  **batch-approve** (eval #4); GUI surfaces owner/visibility, sealed badges, re-consecration.
- **Composition / non-regression:** `assertXScope` stays the first gate; governance types
  AND-compose (Phase 15 grants, Codex restricts); HARD authz triggers (owner permanence,
  no-self-grant) preserved; DEFERRED-029 bypass patterns re-checked each pass.
- **Test:** `authorize()` truth-table (every reason; tiers; overlay; visibility-AND; governance
  AND; status gate; on_behalf_of); per-domain scope/authz tests; **mandatory auth-on +
  enforce-mode CI lane** (extend `docker-compose.auth-test.yml`) with a positive
  cross-actor/refer-back assertion (eval #7/#15); cold-start hostile-actor adversary (multi-pass)
  on A/C/D/E; advisory dry-run reviewed with the user before any enforce flip.

## 7. Scenario-eval traceability
All 8 root-cause clusters from `-eval.md` are addressed: A→§2.3/§3 (visibility AND); B→§4
(on_behalf_of); C→§2.1/§2.2/§3-O2 (sealed Codices + no-escalation + human granter);
D→§2.4/§5-E (tier-crossing gate + overrides + kill switch + bootstrap + heuristic + decisions
tenant-filter + CI); E→§3-S2 (governance AND, Codex deny-only); F→§3-P1 (status gate);
G→§2.4/§5-D (refer-back: deadlock + token + dedup/cap); H→§1 (Role/Topic/Appointment/Instance).
Underspecified items (create-vs-per-resource, null actor_type→`*` fail-closed, key-rotation
preserves principal, non-reusable slugs, edge per-side action, online backfill, expand-contract,
set_visibility, authz-vs-mutation txn, topic-closing writer paths, never-advisory-as-property)
are each pinned to the section above.

## 8. Risks / open questions
- **Re-consecration on a live system** — amending a sealed Codex via a Phase-15 collective
  decision needs a concrete ceremony spec (who is the Ascension Council? quorum?). Drafted in D.
- **Astronomican ↔ data layer** — how sealed *immutable laws* (guardrails) bind a write, beyond
  refer-back, is a Phase-D detail to nail.
- **Performance** of `authorize()` on hot paths — resolve attrs in the scope-derive query;
  cache appointments/codex per request against `authz_config_version`.
- **Phase-5 crypto identity** — principal kept credential-agnostic so it can be strengthened in
  place; no model reshape required later.
