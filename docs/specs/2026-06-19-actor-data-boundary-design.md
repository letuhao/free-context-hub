# DESIGN — Explicit Actor / Project / Task Data Boundaries (Phases A–E)

**Status:** DESIGN (awaiting human approval before BUILD)
**Branch:** `feature/actor-data-boundary`
**Date:** 2026-06-19
**CLARIFY spec:** `docs/specs/2026-06-19-actor-data-boundary.md`
**Scope class:** XL

## 0. Decisions locked (CLARIFY checkpoint)

| Decision | Choice |
|---|---|
| Boundary axes | ALL: authenticated identity · human/agent policy · actor ownership · task/topic access |
| Enforcement posture | **Advisory-first**, then flip to enforce |
| Governance goal | **Full per-actor RBAC** |
| Start | **Full design of all phases first** (this document), one review, then build |

**Design principles**
1. *Compose, don't replace.* Reuse DEFERRED-029 `CallerScope` (project tenant line) and
   Phase 15 governance (Board/requests/motions/DoA). The new layer sits *after* the
   project check and *integrates with* governance for approvals.
2. *Identity before authority.* No boundary is meaningful until the caller's identity is
   authenticated, not asserted. Phase A is the keystone.
3. *One decision point.* A single `authorize(principal, action, resource)` engine — every
   surface (REST, MCP, service) funnels through it. No scattered ad-hoc checks.
4. *Advisory before deny.* The engine runs in `audit` mode first (log would-deny, never
   block), so we observe real multi-actor traffic before turning on enforcement.
5. *Fail closed when enforcing, fail safe when migrating.* Backfill assigns sane defaults
   so nothing breaks; the flip to enforce is explicit and reversible per resource class.

---

## 1. Conceptual model

```
            credential (api_key / session)
                     │  authenticates as
                     ▼
              ┌──────────────┐     global identity, stable across projects
              │  PRINCIPAL   │     { principal_id, type: human|agent|system }
              └──────┬───────┘
        member of    │   (per-project projection = existing `actors` row)
                     ▼
   ┌─────────────────────────────────────────────┐
   │ ROLE ASSIGNMENTS  principal × scope × role    │  scope ∈ global|project|topic|task
   └─────────────────────────────────────────────┘
                     │ grants
                     ▼
   ┌─────────────────────────────────────────────┐
   │ PERMISSIONS  (action, resource_type)          │  e.g. lesson:write, task:claim
   └─────────────────────────────────────────────┘

   RESOURCE { project_id, owner_principal_id, visibility, (topic_id/task_id) }

   DECISION = authorize(principal, action, resource):
       1. project scope        (DEFERRED-029 assertCallerScope)   — hard gate
       2. ownership/visibility  (owner? visibility allows?)
       3. RBAC                  (role grants permission at applicable scope?)
       4. human/agent policy    (actor_type overlay: allow|deny|require_approval)
       5. mode                  (audit → log only | enforce → throw on deny)
```

Five primitives:
- **Principal** — the authenticated identity behind a credential. Global. Typed
  human/agent/system.
- **Membership** — a principal's participation in a project (the existing project-scoped
  `actors` row, now linked to a principal).
- **Role assignment** — a principal holds a role at a scope (global / project / topic / task).
- **Permission** — `(action, resource_type)`; roles bundle permissions.
- **Resource attributes** — every ownable resource carries `owner_principal_id` +
  `visibility`, plus its existing `project_id` (and `topic_id`/`task_id` where applicable).

---

## 2. Data model

### 2.1 New tables

```sql
-- Global identity behind every credential. Stable across projects.
principals (
  principal_id  TEXT PRIMARY KEY,           -- stable slug, e.g. 'human:alice', 'agent:claude-code'
  type          TEXT NOT NULL CHECK (type IN ('human','agent','system')),
  display_name  TEXT NOT NULL,
  status        TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active','suspended','retired')),
  created_by    TEXT,                        -- principal_id of the operator who created it
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now()
)

-- Named permission bundles. Built-in roles are seeded; custom roles are per-project.
roles (
  role_id        TEXT PRIMARY KEY,           -- 'admin','writer','reader','owner','auditor', or custom
  owner_project  TEXT,                       -- NULL = built-in/global; else project-scoped custom role
  display_name   TEXT NOT NULL,
  description    TEXT,
  created_at     TIMESTAMPTZ NOT NULL DEFAULT now()
)

-- (action, resource_type) a role grants. Wildcards allowed: action='*' / resource_type='*'.
role_permissions (
  role_id        TEXT NOT NULL REFERENCES roles(role_id),
  resource_type  TEXT NOT NULL,             -- 'lesson','document','task','motion','apikey',... or '*'
  action         TEXT NOT NULL,             -- 'read','write','delete','claim','propose','mint',... or '*'
  PRIMARY KEY (role_id, resource_type, action)
)

-- A principal holds a role at a scope. Scope tuple narrows from global → task.
role_assignments (
  assignment_id  TEXT PRIMARY KEY,
  principal_id   TEXT NOT NULL REFERENCES principals(principal_id),
  role_id        TEXT NOT NULL REFERENCES roles(role_id),
  scope_type     TEXT NOT NULL CHECK (scope_type IN ('global','project','topic','task')),
  scope_id       TEXT,                       -- NULL for global; else project_id/topic_id/task_id
  granted_by     TEXT NOT NULL,             -- authenticated principal_id (injected, never body-supplied)
  created_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (principal_id, role_id, scope_type, scope_id),
  CHECK (granted_by IS DISTINCT FROM principal_id)   -- HIGH-2: no self-grant, enforced in DB
)
-- Bootstrap rule (HIGH-2): the first project-admin assignment is seeded at project creation
-- to the project creator-principal and is immutable (mirrors topic-owner permanence). Only an
-- existing project-admin / global-admin may grant `role:grant`. `granted_by` is always the
-- authenticated caller (added to the §4 identity-injection list), never trusted from the body.

-- Human/agent (and system) policy overlays. Evaluated after RBAC.
actor_policies (
  policy_id      TEXT PRIMARY KEY,
  actor_type     TEXT NOT NULL CHECK (actor_type IN ('human','agent','system','*')),
  resource_type  TEXT NOT NULL,             -- or '*'
  action         TEXT NOT NULL,             -- or '*'
  effect         TEXT NOT NULL CHECK (effect IN ('allow','deny','require_approval')),
  scope_project  TEXT,                       -- NULL = global default; else per-project override
  note           TEXT,
  created_at     TIMESTAMPTZ NOT NULL DEFAULT now()
)

-- Every authorization decision (audit + enforce). The advisory-mode evidence base.
authorization_decisions (
  decision_id    TEXT PRIMARY KEY,
  ts             TIMESTAMPTZ NOT NULL DEFAULT now(),
  principal_id   TEXT,                       -- NULL when unauthenticated (auth-off)
  actor_type     TEXT,
  action         TEXT NOT NULL,
  resource_type  TEXT NOT NULL,
  resource_id    TEXT,
  project_id     TEXT,
  effect         TEXT NOT NULL,             -- 'allow' | 'deny' | 'require_approval'
  mode           TEXT NOT NULL,             -- 'audit' | 'enforce'
  reason         TEXT NOT NULL,             -- which rule decided (scope|owner|visibility|rbac|policy)
  surface        TEXT                        -- 'rest' | 'mcp' | 'service'
)
```

### 2.2 Column additions to existing tables

- **`api_keys`**: `principal_id TEXT REFERENCES principals` (the credential authenticates AS
  this principal). Keep `role` + `project_scope` for back-compat during migration; RBAC
  supersedes `role` once enforcing.
- **`actors`** (project-scoped membership): add `principal_id TEXT REFERENCES principals`,
  and **migrate the `type` CHECK from `('human','ai')` → `('human','agent','system')` with a
  data migration `ai → agent`** (CRITICAL-3: today's `actors.type` has no `system` value and
  uses `ai`≠`agent`; without this the `system:worker` principal can't materialize an actor).
  `type` is *derived from* the principal (no longer asserted).
- **Ownable resources** — add `owner_principal_id TEXT` + `visibility TEXT NOT NULL DEFAULT
  'project' CHECK (visibility IN ('private','project','shared','restricted'))` to:
  `lessons`, `documents`, `document_chunks`, `tasks`, `artifacts` (via artifact head),
  `generated_documents`, `guardrails`, `topics` (topic-level visibility), and others per the
  inventory in §10. (Coordination decision objects — motions/votes/requests — are governed
  by Phase 15 rules + RBAC, not per-row visibility.)
- **Fix unscoped collaboration tables** — add `project_id` to `lesson_comments`,
  `lesson_feedback`, `bookmarks` (backfilled via their lesson) so boundary checks don't need
  a join and can't leak cross-project.
- **Durable task ownership** — add `assigned_to TEXT` (principal_id) to `tasks` (distinct
  from the ephemeral artifact `claim`); a task can be assigned/owned independent of an active
  claim.

### 2.3a Identity mapping — canonical rules (resolves design-review CRITICAL-3)

The three identity tables have mismatched cardinality; these rules remove every ambiguous /
impossible state:

1. **One `principals` row per identity** (global). `principal_id` is the single identity
   namespace.
2. **`actor_id == principal_id` invariant.** The project-scoped `actors` row is a *lazily
   materialized membership* of a principal in a project; its `actor_id` **is** the
   `principal_id` (drop the dual namespace — it was the root of the ambiguity and the reason
   Phase 15 grants — keyed on `actor_id` — could disagree with RBAC keyed on `principal_id`).
   So `role_assignments.principal_id`, `topic_participants.actor_id`, `votes.actor_id`, etc.
   are all the *same string*, and the two authz systems check the same identity column.
3. **Membership is 0-or-1 per (principal, project)**, materialized on first action
   (`INSERT ... ON CONFLICT DO NOTHING`), `type` copied from the principal.
4. **Global key (`api_keys.project_scope IS NULL`)** authenticates as a principal that holds
   a **`global`-scope role assignment** (e.g. `system` → `*:*`, or an ops admin). It passes
   RBAC everywhere by an *explicit grant*, not by a hole — and needs no per-project `actors`
   row to act (membership is materialized lazily if it ever creates owned resources). This
   closes the "global admin locked out of a project it never joined" cliff.
5. **`created_by`/owner columns are soft references** to `principals` (not hard FKs) so a
   principal can be retired without orphan-blocking historical rows.

### 2.3 Visibility semantics

| visibility | who can read | who can write |
|---|---|---|
| `private` | owner + project admins | owner + project admins |
| `project` (default) | any project member with `:read` | members with `:write` per RBAC |
| `shared` | per explicit cross-project grant (`role_assignments` with `scope_type='global'` or a share row) | per grant |
| `restricted` | only principals with an explicit role granting the resource_type | same |

---

## 3. Authorization engine (`src/core/security/authorize.ts`)

Single entry point used by every surface:

```ts
type Principal = {
  principal_id: string | null;          // null = unauthenticated (auth-off)
  actor_type: 'human' | 'agent' | 'system' | null;
  project_scope: CallerScope;           // reuse DEFERRED-029 three-valued scope
};

type ResourceRef = {
  resource_type: string;
  resource_id?: string;
  project_id?: string;
  owner_principal_id?: string | null;
  visibility?: string;
  topic_id?: string; task_id?: string;
};

type Decision = { effect: 'allow' | 'deny' | 'require_approval'; reason: string };

function authorize(
  principal: Principal,
  action: string,
  resource: ResourceRef,
  opts?: { conn?: PoolClient; mode?: AuthzMode },   // mode default from env AUTHZ_MODE
): Promise<Decision>;
```

**Two-stage shape (this resolves design-review CRITICAL-1, CRITICAL-2, HIGH-4, MED-2):**
the engine computes a **provisional grant** (ownership/visibility/RBAC) and then applies a
**mandatory policy + governance overlay that can always veto or escalate** — the overlay is
NOT a short-circuit step. Ownership grants *capability*, never *immunity from governance*.

**Hard preconditions (run before the engine, never softened by mode):**
- **Tenant scope** is enforced by the DEFERRED-029 `assertXScope` gate that already runs
  *before* `authorize()` and **always throws** on cross-tenant — it is NOT re-implemented as
  an engine step and is **exempt from advisory mode** (CRITICAL-2). `authorize()` assumes the
  project gate has passed.
- **Attribute load** — `authorize()` loads `owner_principal_id` / `visibility` / `project_id`
  / `topic_id` / `task_id` **from the DB by `resource_id`**; it never trusts these from the
  caller-supplied `ResourceRef` (the optional fields are a perf hint only, re-validated)
  (HIGH-4). For any per-resource action, a **missing `resource_id` in enforce mode = `deny`
  (reason `missing_resource_id`)** — never skip.

**Stage 1 — provisional grant (compute `granted: bool`):**
1. **Auth-off** — `principal.project_scope === undefined` → provisional allow (`auth_off`);
   still logged; still subject to Stage 2 overlay logging.
2. **Owner** — authenticated `principal_id === owner_principal_id` → provisional allow
   (`owner`). (Capability only; Stage 2 can still veto/escalate — CRITICAL-1.)
3. **Visibility** — `project` → project members granted read; `private`/`restricted` →
   no grant unless owner or an explicit role; `shared` → requires a cross-project grant.
4. **RBAC** — any role assignment whose scope covers the resource (global ⊇ project ⊇ topic ⊇
   task) grants `(action, resource_type)` → provisional allow (`rbac`). **Exception
   (HIGH-1):** for *governance-delegated* resource types (`motion, request, dispute,
   decision_body, vote, topic-level`), RBAC may only *restrict*, never *grant* — Stage 1 for
   these calls the existing Phase 15 level/DoA predicate, and the final effect is the **AND**
   of RBAC and Phase 15 (deny if either denies).

**Stage 2 — mandatory overlay (always runs, regardless of Stage 1):**
5. **Human/agent policy** — consult `actor_policies` for `(actor_type, resource_type,
   action)`: `deny` overrides any provisional allow; `require_approval` downgrades any allow
   to an approval hand-off; absence = no change.
6. **Resolve effect** — `deny` (any veto) > `require_approval` (any escalation) > `allow`
   (provisional grant survived) > `deny` (reason `default_deny`, nothing granted).

**Existence-oracle rule (MED-2):** when the resolved effect is deny and the resource is
`private`/`restricted` and the caller has no read grant, return **`NOT_FOUND`** (not
`FORBIDDEN`) — extend the no-existence-oracle posture to the intra-project ownership layer.
`FORBIDDEN` is reserved for resources the caller is allowed to know exist (e.g. `project`
visibility, write denied).

**Modes (`AuthzMode = off | audit | enforce`):**
- `off` — engine not consulted (explicit opt-out only).
- `audit` — compute the decision, **write `authorization_decisions`**, but **return as if
  allowed** to callers (never block) — **for the ownership/visibility/rbac/policy effects
  only**. The tenant gate (above) and governance/identity-mutation actions (below) are NEVER
  advisory.
- `enforce` — deny throws `NOT_FOUND` (private/cross) or `FORBIDDEN` (visible/unpermitted);
  `require_approval` throws `ApprovalRequiredError` → a Phase 15 request (see §7.1).

**Never-advisory invariant (HIGH-2):** identity- and governance-mutating actions —
`role:grant/revoke`, `apikey:mint`, `principal:write`, `actor_policy:write`, and the
governance-delegated set — run in **enforce** from day one via `authz_mode_overrides`, even
while reads/writes are still in `audit`. The escalation surface is never open during the
advisory window.

Granularity: `AUTHZ_MODE` is the global default; `authz_mode_overrides` (table) sets mode per
`resource_type`/`action`. The enforce flip is staged (governance/identity → writes → reads).

**Multi-resource contract (HIGH-4):** cross-table actions (the DEFERRED-029 SEC-4 shape, e.g.
`linkDocumentToLesson`) use `authorizeEdge(principal, action, [resA, resB])` which checks
owner/visibility/RBAC on **every** resource. A single `ResourceRef` cannot express a
two-sided check.

Helper wrappers mirror DEFERRED-029 ergonomics: `assertAuthorized(principal, action, res)`
(throws in enforce, logs in audit) used inside service fns right after `assertXScope`.

---

## 4. Phase A — Authenticated identity (foundation)

**Goal:** the caller's identity is trusted, not asserted.

- Add `principals` + `api_keys.principal_id` + `actors.principal_id` (migration).
- **Credential → principal resolution**: `bearerAuth` (REST) and `resolveMcpCallerScope`
  (MCP) resolve the api_key to its `principal_id` + `type` and attach a `Principal` to the
  request/tool context (`req.principal`, MCP `ctx.principal`).
- **Stop trusting asserted identity**: every tool/route that today takes `actor_id` /
  `created_by` / `captured_by` / `submitted_by` / **`granted_by`** / `proposed_by` /
  `seconded_by` / `decided_by` from the body either (a) **injects** the authenticated
  `principal_id` (preferred) or (b) **rejects** a mismatch when auth is on. `granted_by` in
  particular is identity-mutating and must NEVER be body-supplied (HIGH-2). Auth-off keeps
  current behavior (asserted, for dev).
- **Provenance**: `created_by`-style columns become the authenticated principal; add the FK
  intent (soft FK to `principals` — not a hard FK, to tolerate retired principals).
- **System principal**: the worker/distiller run as a seeded `system` principal
  (`system:worker`), replacing the implicit `callerScope=null` trust.

**Back-compat:** legacy `CONTEXT_HUB_WORKSPACE_TOKEN` maps to a seeded `system:legacy-admin`
principal (and is still gate-able via `MCP_LEGACY_TOKEN_DISABLED`).

**Acceptance:** with auth on, an api_key bound to `agent:x` cannot create a lesson/task/vote
attributed to any other actor; identity in events + audit reflects the credential, not the
body. Auth-off unchanged. No data-access denials yet (that's C).

---

## 5. Phase B — Ownership data model

**Goal:** resources carry owner + visibility; no new denials yet.

- Migrations add `owner_principal_id` + `visibility` to the ownable resources (§2.2, §10).
- Add `project_id` to `lesson_comments`/`lesson_feedback`/`bookmarks`; add `tasks.assigned_to`.
- **Backfill**: `owner_principal_id` = the resource's existing `created_by`/`captured_by`
  mapped to a principal (or `system:legacy-admin` when unknown); `visibility='project'`
  (preserve current "everyone in the project sees it" behavior).
- Service create-paths set `owner_principal_id = principal.principal_id` and accept an
  optional `visibility`.
- APIs/GUI expose owner + visibility (read-only first), so humans can see ownership before it
  starts gating anything.

**Acceptance:** every ownable row has a non-null owner + visibility; collaboration tables are
project-scoped; reads still return everything in-project (no behavior change).

---

## 6. Phase C — Boundary enforcement (advisory-first)

**Goal:** the `authorize()` engine runs on every access in **audit mode** — logging
would-deny without blocking — then we read the audit log to tune policy before enforcing.

- Wire `assertAuthorized(principal, action, resource)` into every service read/write path,
  right after the existing `assertXScope` project gate. Resource attributes (owner,
  visibility, topic/task) are loaded in the same query used for the scope derive (no extra
  round-trips where avoidable).
- REST: a thin `authorize` middleware factory `requirePermission(action, resourceSpec)`
  complements `requireResourceScope` (which still does the project gate).
- MCP: tool handlers call `assertAuthorized` after `resolveMcpCallerScope`.
- **Mode = `audit`** ships here. `authorization_decisions` accumulates real allow/deny
  evidence. A GUI/report surfaces "would-deny" hotspots so we fix policy gaps (missing role
  grants, wrong visibility) *before* turning on enforcement.

**Acceptance:** every boundary-relevant access produces an `authorization_decisions` row with
a correct effect; zero behavior change for callers (audit never blocks); a report shows the
would-deny set.

---

## 7. Phase D — Human/agent governance policy (RBAC + overlays)

**Goal:** the per-actor RBAC and human/agent rules that make this a "government."

- Seed built-in roles + permission catalog (§8). Provide role CRUD (custom per-project
  roles) and `role_assignments` management (admin-gated, audited, no self-escalation —
  mirror the Phase 15.11 grant rules: `granted_by !== principal_id`, owner permanence).
- Seed default `actor_policies` (the human/agent semantics), e.g.:
  - `agent` + `delete` + any → `require_approval`
  - `agent` + `write` + `governance`/`apikey`/`role` → `require_approval`
  - `agent` + cross-project (`scope_type='global'` actions) → `deny`
  - `human` + most → `allow` (subject to RBAC)
  These are *configurable rows*, not hardcode.
- **`require_approval` → Phase 15**: an agent action needing sign-off creates a
  Request-Approval (DoA-routed) or a Board task for a human, instead of executing. This is
  the integration seam with existing governance.

### 7.1 `require_approval` → Phase 15 hand-off — loop & abuse guards (resolves HIGH-3)

- **Valid approver = human (or explicit `approve` permission agents can't hold).** An
  agent's `require_approval` MUST route to a `human` principal; the DoA routing for
  agent-origin approvals filters out `agent`/`system` approvers. No agent rubber-stamps
  another agent.
- **No self-approval** at the DoA layer: `approver_principal !== requester_principal`
  (mirrors no-self-grant).
- **Dedup + rate-limit:** at most one *open* request per `(principal, action, resource_id)`;
  duplicate attempts attach to the existing request rather than minting new ones. Per-principal
  request-creation rate limit guards against retry-loop spam / inbox flooding.
- **One-shot post-approval execution:** approval mints a single-use authorization token; on
  re-entry `authorize()` sees `reason=approved_request` and allows **once** (consumes it), so
  the approved action does not re-trigger `require_approval` into an infinite loop. The action
  executes under an explicit "approved-by `<human>`" provenance, recorded in the audit log.

**Acceptance:** an agent principal attempting a sensitive action gets routed to **human**
approval (enforce) or logged as `require_approval` (audit); duplicate/looping attempts don't
multiply requests; the approved action runs once and is attributed to the approver; role
assignment respects the HARD authz triggers; no agent can approve an agent.

---

## 8. RBAC catalog (initial)

**Resource types:** `lesson, document, chunk, guardrail, task, topic, artifact, motion,
request, dispute, intake, decision_body, project, apikey, principal, role, taxonomy, job,
source, group`.

**Actions:** `read, write, delete, claim, complete, propose, second, vote, decide, mint,
grant, revoke, configure, export, import, admin`.

**Built-in roles (seed `role_permissions`):**
| role | grants |
|---|---|
| `reader` | `*:read` |
| `writer` | `reader` + `{lesson,document,task,artifact,intake}:write`, `task:claim/complete` |
| `contributor` | `writer` + `motion:propose/second/vote` (governance participation) |
| `project-admin` | `*:*` within a project scope (incl. `role:grant`, `apikey:mint`) |
| `auditor` | `*:read` + `authorization_decisions:read` (read-only oversight) |
| `owner` | implicit per-resource (owner_principal_id) — full control of own resources |
| `system` | `*:*` global (worker/distiller) |

Wildcards resolve narrowest-deny-wins only via `actor_policies`; within RBAC it's
grant-union (any covering grant allows).

---

## 9. Phase E — Secure-by-default + session auth + flip to enforce

- Flip `AUTHZ_MODE` default `audit → enforce` (per-resource-class staged: governance/apikey
  first, then writes, then reads), once the audit log shows the would-deny set is clean.
- **Flip gate (MED-1):** a resource class may flip only when the advisory **"would-deny for
  currently-working traffic" report shows zero rows** for that class (keyed to real
  principals). Don't flip `read` classes until `write`/governance have soaked. **Rollback
  contract:** set the class's `authz_mode_overrides` row back to `audit` (instant, no
  redeploy). `system:legacy-admin` holds a `global` `*:*` assignment so legacy-owned rows
  (backfilled to it) stay reachable by admins post-flip.
- Resolve **DEFERRED-041** (human session login) so the browser GUI has a real human
  principal (httpOnly+SameSite session cookie; CSRF token for state-changing same-origin
  calls) instead of a shared bearer token. Humans authenticate → human principal → RBAC.
- Default `MCP_AUTH_ENABLED=true` for non-loopback gateway bindings (ties to the gateway
  hardening already shipped).
- Full boundary-decision audit retained; add alerting on deny spikes.

---

## 10. Migration & backfill plan

Migrations (new files `0064+`), each reversible, each its own review:
1. `principals`, `roles`, `role_permissions`, `role_assignments`, `actor_policies`,
   `authorization_decisions` (Phase A/D scaffolding; seed built-in roles + system principal).
2. `api_keys.principal_id`, `actors.principal_id` + **`actors.type` CHECK migration
   `('human','ai') → ('human','agent','system')` with data fix `ai → agent`** + backfill
   (Phase A). Seed `system:legacy-admin` with a `global` `*:*` role assignment.
3. `owner_principal_id` + `visibility` on ownable tables + backfill (Phase B).
4. `project_id` on `lesson_comments`/`lesson_feedback`/`bookmarks` + backfill; `tasks.assigned_to`.

**Backfill rules:** unknown creators → `system:legacy-admin`; all existing resources
`visibility='project'`; existing api_keys → a principal derived from `name` (`agent:<name>`
or `human:<name>` heuristically, operator-correctable in GUI). **Project IDs remain
immutable** (load-bearing for no-TOCTOU).

---

## 11. Surface changes

- **REST:** `req.principal`; `/api/me` returns principal + effective roles + assignments;
  new admin routes `/api/principals`, `/api/roles`, `/api/role-assignments`,
  `/api/actor-policies`, `/api/authz/decisions` (auditor); resource payloads gain
  `owner`/`visibility`. `requirePermission()` middleware.
- **MCP:** tools drop body-supplied `actor_id` (derived from credential; kept optional +
  validated in auth-off); add governance tools (`grant_role`, `set_visibility`,
  `list_my_permissions`); tool results carry resolved identity.
- **GUI:** Actors/Principals admin, Roles & permissions matrix, per-resource owner +
  visibility controls, an Authorization audit page (would-deny report in advisory phase),
  approval inbox for agent `require_approval` actions.

---

## 12. Composition & non-regression

- **DEFERRED-029**: `assertXScope` remains the first gate; `authorize()` runs *after* it.
  The three bypass patterns (optional-id, secondary-id, trusted-payload) are re-checked in
  every adversary pass for the new code.
- **Phase 15 governance (composition rule — HIGH-1):** for the *governance-delegated*
  resource types (`motion, request, dispute, decision_body, vote, topic-level`), the two
  authz systems are **AND-composed — RBAC may only further RESTRICT, never GRANT.** The
  Phase 15 level-grant chain / DoA predicate remains the authority; `authorize()` denies if
  *either* RBAC or Phase 15 denies. This prevents a global `contributor` RBAC role from
  bypassing the topic level-grant chain (the Sprint-15.3 bug class). `require_approval`
  routes through Request-Approval/DoA; role assignment honors owner permanence + no-self-grant
  (DB CHECK); quorum/veto logic unchanged.
- **Gateway**: enforce-mode + session auth align with the single-port gateway + DEFERRED-041.

---

## 13. Test & review strategy

- **Unit:** `authorize()` truth table (every reason path; audit vs enforce; human/agent
  overlays; ownership/visibility; scope coverage global⊇project⊇topic⊇task).
- **Service scope/authz tests:** per domain (mirror existing `*-scope.test.ts`).
- **E2E (auth-on):** cross-actor denial, agent require-approval routing, role-grant rules,
  advisory-mode audit-log assertions.
- **Cold-start hostile-actor adversary review** (multi-pass, per CLAUDE.md safety policy)
  on every phase that adds an authz/governance primitive (A, C, D, E) + live verification.
- **Advisory dry-run:** ship C in audit mode, collect `authorization_decisions`, review the
  would-deny set with the user before E flips enforcement.

---

## 14. Phase task breakdown (acceptance-gated)

- **A. Identity** — migrations 1–2; principal resolution (REST+MCP); identity injection;
  system principal; back-compat. AC: identity un-spoofable with auth on; auth-off unchanged.
- **B. Ownership model** — migrations 3–4; backfill; create-path owner/visibility; read-only
  surfacing. AC: every ownable row owned; collaboration tables scoped; no behavior change.
- **C. Enforcement (audit)** — `authorize()` engine + wiring on all paths; `AUTHZ_MODE=audit`;
  decisions log + report. AC: correct decision per access; never blocks; report exists.
- **D. RBAC + policy** — role/permission/assignment + actor_policies CRUD; `require_approval`
  → Phase 15; seed defaults. AC: agent sensitive action routed to human; grant rules safe.
- **E. Enforce + session** — staged flip to enforce; DEFERRED-041 session login;
  secure-by-default. AC: cross-actor/cross-task denied; GUI works with human session.

---

## 14a. Design-review resolutions (cold-start adversary, 2026-06-19)

A cold-start hostile-actor review of this design (pre-build) found 4 CRITICAL + 4 HIGH/MED
holes; all are resolved **in the design text above** before BUILD:

| # | Finding | Resolution (section) |
|---|---|---|
| CRITICAL-1 | Owner short-circuit bypassed the human/agent policy overlay | §3 two-stage: overlay always runs, can veto/escalate any provisional allow |
| CRITICAL-2 | Advisory mode would soften the DEFERRED-029 tenant gate | §3: tenant gate is a hard precondition outside the engine, never advisory |
| CRITICAL-3 | `principal`/`actor`/`api_key` mapping had impossible states (`ai`≠`agent`, no `system`, global-key projection) | §2.3a canonical rules: `actor_id==principal_id`; `actors.type` migration; global-key via explicit global grant |
| HIGH-1 | RBAC could contradict / bypass Phase 15 governance | §3 Stage 1 exception + §12: governance types AND-composed, RBAC restricts only |
| HIGH-2 | `role_assignments` self-grant / bootstrap escalation; `granted_by` trusted | §2.1 DB CHECK + bootstrap rule; §3 never-advisory invariant; §4 injects `granted_by` |
| HIGH-3 | `require_approval` loop / spam / agent-approves-agent | §7.1 human-only approvers, no self-approve, dedup+rate-limit, one-shot token |
| HIGH-4 | Engine trusting caller-supplied attrs / optional resource_id (DEFERRED-029 patterns) | §3: attrs loaded from DB; missing resource_id = deny; `authorizeEdge` for cross-table |
| MED-1 | Enforce-flip back-compat cliff | §9 flip gate (zero would-deny) + rollback + legacy-admin global grant |
| MED-2 | `FORBIDDEN` vs `NOT_FOUND` intra-project existence oracle | §3: private/restricted unread → `NOT_FOUND` |

These resolutions are **stated invariants the per-phase code adversary passes will check
against** (esp. the never-advisory rule, load-attrs-from-DB, and governance AND-composition).

## 15. Risks & open questions

- **Principal granularity for agents:** is each agent *instance* a principal, or each agent
  *type*? (Recommend: type-level principal + per-session sub-identity in events. Decide in A.)
- **`require_approval` UX:** approval latency for agents — need a clear pending state + the
  approval inbox (D).
- **Backfill heuristic** for api_key → human/agent type may misclassify; GUI must allow
  operator correction (B).
- **Performance:** `authorize()` adds a per-access decision; mitigate by loading resource
  attrs in the existing scope-derive query and caching role assignments per request.
- **Scope of "shared" visibility / cross-project grants** — keep minimal in v1 (explicit
  global role assignment only); richer sharing later.
```
