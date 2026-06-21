# Scenario Evaluation — DESIGN v2 (DLF-grounded)

**Date:** 2026-06-19 · **Branch:** `feature/actor-data-boundary`
**Input:** `2026-06-19-actor-data-boundary-design-v2.md` · **Method:** 3 cold-start red-teams, ~48 scenarios.

## Bottom line

The **authz truth-table holds** — the v1 fixes are real in v2's concrete mechanism (visibility-AND
defeats blanket `*:read`; the Stage-2 overlay vetoes an agent-owner's allow; a suspended
originator's queued job denies at execution **if** on_behalf_of is wired). But the **DLF-native
machinery v2 newly introduced is largely *asserted, not mechanized*** — stated as a property with
no DB constraint, engine step, or column behind it. v2 is the right *architecture*; it is not yet
an enforceable *specification*. **A v3 pass is needed before BUILD** to convert the cross-cutting
properties into mechanisms; the rest become per-phase design ACs.

**The one meta-finding:** every CRITICAL below is the same shape — *"DLF property declared in prose,
no enforcing mechanism in §2/§3."* Sealing, the instance fence (finding-H), the human-authority
root, on_behalf_of, no-escalation, scope-coverage, and the rollout-invalidation model are all
goals without gates.

## CRITICAL clusters (must be resolved in v3 before BUILD)

**C1 — Sealing is convention-only.** `codex_permissions`/`codex_rules`/`authz_mode_overrides` have
no seal enforcement; any write path (or a forgotten route, migration, worker) mutates a sealed
Codex with no re-consecration. DLF HS-1 is a Hard Stop; v2 demotes it to honor system.
→ **Fix:** DB trigger on seal-relevant tables `RAISE EXCEPTION WHEN roles.sealed` unless a
ceremony GUC (`app.reconsecration_id`) is set; evaluate the **full base→override rule chain** at
decision time (base `deny`/`refer_back` always wins → "extend, never relax" becomes real);
classify `authz:override:write` + `authz:kill:write` as never-advisory + human + **global-admin only**.
*(scenarios A-S3, A-S4, C3-#12)*

**C2 — Finding-H is NOT actually resolved.** v2 says the fence keys on an "instance token," but no
table has an `instance_id`/`session_id` column; it is never minted or authenticated; `claims`,
`votes`, `topic_participants` all key on `actor_id == principal_id` → two concurrent instances of
one agent type are indistinguishable. And `actor_id`→`principal` reconciliation covers only
`actors`, not the Phase-15 coordination tables.
→ **Fix:** add a **server-minted `instance_id`** (per session at principal-resolution, never
body-suppliable); fence on `(actor_id, instance_id, fencing_token)`; enumerate + FK **every**
actor_id-keyed table to `principals`. *(A-S5, A-S6)*

**C3 — "Human Authority at root" is asserted, not mechanized.** There is no `topics.authority_principal`,
no topic ancestry/parent link, no guaranteed human seat. v2's headline claim that refer-back
"dissolves the all-agent deadlock" is **false as written** — DLF itself only *surfaces* this as a
CAP-AP liveness residual ("only a person can break it"). Bootstrap-admin is `type=system` (infra),
so even genesis has no human authority root; and re-consecration has a **bootstrap circularity**
(amending the first sealed Codex needs a Council that is itself defined by a sealed Codex).
→ **Fix:** add `topics.authority_principal_id` (must be `type=human`, enforced at charter) + a
fallback chain `topic→project→global break-glass human seat`; a **boot/charter invariant** that a
human authority root is resolvable; a **genesis exception** (bootstrap-admin may consecrate without
a motion when no Council can be quorate, logged `reason='genesis'`, self-revoking once a Council is
appointed); adopt DLF's *honest* posture (forced-triage liveness residual + alert) where no human
exists, instead of claiming dissolution. *(B-S1, B-S2, B-S16, C3-#1, C3-#2, C3-#7)*

**C4 — on_behalf_of is not plumbed through the real seams.** As-built, `jobExecutor.executeByType`
carries no principal; worker enqueues set `callerScope:null`; the auto-tally chain hardcodes
`acting_actor:'system:sweep'`. So originator-status (P1) is unenforced at execution and substantive
chained tasks are mis-attributed to `system` — the eval-B laundering hole reopened at two seams. No
depth bound; legacy backlog (NULL origin) launders to system.
→ **Fix:** add `jobs.enqueued_by_principal` + chain `origin_principal`, captured authenticated at
enqueue/propose, **never body-trusted**; thread through `executeByType` + `emitChain` (replace the
`system:sweep` literal on the carried-outcome chain with the originator; keep `system:sweep` only
for the sweep's own bookkeeping); a chain-depth bound; **fail-closed on absent origin** (treat as
non-human agent, never system); migrate/dead-letter the pre-0064 backlog. *(B-S5/7/12, A-S16)*

**C5 — Governance AND-composition formula reproduces the eval-E regression.** `Phase15_predicate AND
codex` reads literally as *missing-grant → deny*, disenfranchising every existing Phase-15
participant (who has no codex grant) at the enforce flip — the exact bug eval-E flagged, relabeled.
→ **Fix:** rewrite as `effect = Phase15_grants(P) AND NOT codex_denies(P, action)` — absence of a
codex grant is **never** a deny for governance types; only an explicit deny rule subtracts. Add the
eval-E test. *(A-S14, B-S8)*

**C6 — Scope coverage is never computed.** `codex_permissions` is `(role_id, resource_type, action)`
— **scope-blind**. The engine never intersects appointment-scope with resource-location, so a
topic-admin grant leaks to sibling topics / the whole project. "Single biggest missing piece of the
engine."
→ **Fix:** STAGE-1 effective permission = `⋃ over active appointments of (codex_perms[role] where
appointment.scope covers resource.location)`; define coverage (`topic` appt ⇒ `resource.topic_id ==
scope_id`, etc.). *(A-S2)*

**C7 — No-escalation / grant-subset is prose, not mechanism.** Both eval-C fixes (custom role
`owner_project=P` assignable only ⊆ P; `granted ⊆ granter`) are named in §5-D with no DB constraint
and no engine step → project→global escalation via human-sockpuppet still works.
→ **Fix:** DB constraint tying `appointments.scope` to `roles.owner_project`; a concrete
`assertGrantSubset(granter, role, target_scope)` engine step in O2. *(A-S10)*

**C8 — Rollout invalidation model is holistically broken (3 scenarios, 1 root cause).** v2 invalidates
cache only on "override writes," but the security-load-bearing mutations live outside that path:
(a) `AUTHZ_GLOBAL_KILL` is an **env var** → `getEnv()` is a per-process snapshot → worker/replicas
never see the "instant" rollback; (b) a **suspended principal keeps acting** through a cached
appointment (status write doesn't bump the version); (c) **sampled allow-logging contradicts the
positive-coverage gate** (the gate needs proof-of-exercise that sampling discards).
→ **Fix:** never-cache the `status` hard precondition (cheap point-read, always live); move global
flags to a **DB row read per-request with a short TTL** keyed off a version (reuse the
`project_cache_versions` pattern); bump the version on **any** authority-affecting write (status,
appointment, seal, override); track coverage in a separate idempotent `authz_observed_actions` set
(not sampled); **batch authorizer** for list/search (no per-row DB authorize). *(C3-#4/5/6/13/15)*

## HIGH (resolve in v3 or as a pinned Phase AC)

- **H1 — Lifecycle cascades are gates without operations.** Topic-close has no cascade (orphaned
  claims/appointments/refer-backs); `refer_backs` is absent from the `closeTopic` 3-phase drain
  (only 5 hardcoded entity types); suspend/retire set the status flag but don't reroute in-flight
  refer-backs / sweep claims / reassign owned private data (dead-owner orphaning). *(A-S1/9/13,
  B-S11, B-S13)* → define topic-close + suspend/retire as **operations** with explicit teardown;
  add `refer_backs` to the drain + `ForceLapsedCounts`.
- **H2 — Refer-back protocol incompleteness.** "Re-affirmation binds / needs new facts" not modeled
  → indefinite re-refer liveness attack (add `facts_hash` + protocol-violation reject); one-shot
  token fingerprint over-invalidates on legitimate content version bumps (fingerprint **security
  attributes** — owner/visibility/topic-state — not raw content version); "a human" ≠ "the
  authority" (consume must bind to the resolved `authority_principal`, else low-priv human approves
  high-priv act); open-cap asserted without a concrete bound. *(B-S3/4/13/14)*
- **H3 — Migration/flip soundness.** Coverage gate's "observed-or-waived" relabels absence-of-
  evidence for rare jobs → require **synthetic replay** of every catalogued action, not human
  waiver; online backfill leaves **in-flight NULL owners** (set owner on new INSERTs *before*
  backfilling; specify the NOT VALID/VALIDATE sequence); `actors.type` contract step not gated on
  full rollout (straggler re-sweep); **mixed-mode read-enforce over advisory-write state** needs a
  flip-ordering graph (write/create/visibility before read). *(C3-#3/8/9/11)*
- **H4 — Opaque principal_id (GDPR vs append-only audit).** Name-derived "stable slugs" make
  erasure either violate GDPR (slug is PII) or dangle audit FKs. → mandate **opaque non-PII
  `principal_id`** (ULID); `display_name` is the only PII; erasure anonymizes display_name only,
  audit keeps the opaque id. Foundational — affects Phase A. *(C3-#10)*

## MEDIUM (pin as Phase ACs)
- `type_verified DEFAULT false` is a standing human-exemption — fail-open only for pre-0064 rows;
  new principals fail-closed (unverified sensitive → treat as agent/deny). *(A-S8)*
- create-vs-per-resource action **catalog** (`kind ∈ create|per_resource|collection`) — without it,
  P3's "missing resource_id → deny" breaks all creates. *(A-S11)*
- null `actor_type` → match `'*'` rules but treat typeless-authenticated as most-restricted
  (agent), fail-closed for sensitive; auth-off skips the whole overlay → force auth-on on
  non-loopback. *(A-S12, B/C cross-refs)*
- decisions **rollup/aggregate** must be tenant-filtered too (not just the raw read); partition/
  store rollups per-project. *(C3-#14)*
- on_behalf_of job re-authorizes at **execute-time live** authority (appointment/topic/status),
  never the enqueue-time snapshot; topic-closed mid-flight → fail closed. *(C3-#16, B-S16)*

## Confirmed HANDLED (v1 fixes that hold in v2's concrete mechanism)
- visibility-AND: a default `reader` can no longer read a `private` resource → `NOT_FOUND` (no
  oracle). *(A-S7a)*
- CRITICAL-1: an agent **owner** is still subject to a codex_rule `deny` on its own private
  resource (Stage-2 overlay vetoes the owner allow). *(A-S7b)*
- on_behalf_of + status: a suspended originator's queued sensitive job denies at execution —
  **conditional on C4 plumbing existing.** *(B-S7, A-S16-new)*
- non-reusable slug blocks re-mint (PK + retained tombstone). *(A-S9-remint)*

## Recommendation
**DESIGN v3** resolving the **8 CRITICAL clusters** (they change the data-model shape and
cross-phase invariants — instance_id, opaque ids, authority-root, on_behalf_of columns, sealing
triggers, scope-coverage, governance formula, the invalidation model) + **H1–H4**. The MEDIUM items
become **per-phase acceptance criteria** (don't fully specify Phase-E rollout before Phase-A
identity is built). The recurring lesson: **state every DLF property as a concrete gate (column /
constraint / engine step), never as prose** — the next adversary pass will check mechanisms, not goals.
