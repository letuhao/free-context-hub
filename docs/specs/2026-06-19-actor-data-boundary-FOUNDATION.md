# Actor Data Boundary — FOUNDATION (the small real thing; substrate for DLF growth)

**Status:** APPROVED direction (supersedes v1–v5 as the *near-term build plan*).
**Date:** 2026-06-19 · **Branch:** `feature/actor-data-boundary`
**Relationship to v1–v5:** those five design rounds + five evals are the **governance-OS research
track** (the DLF theory, hardened by adversarial debate) — kept as reference for later phases, NOT the
near-term build. This note is the small, buildable foundation they overshot.

## The cleared insight (why this is now small)
A security system's **root of trust is axiomatic and out-of-band** — you never gate the root from
inside the system. Five rounds of findings (genesis backdoor, bootstrap master key, re-consecration
loop, self-kind escalation, seal "who-approves-the-approval") were all the *same* error: trying to
authorize the root in-system, so the gate kept needing its own gate. Deleting that error deletes them.

## The model (five lines)
1. **Root is axiomatic + out-of-band.** Set at install by whoever holds `DATABASE_URL`. **Single**
   (1-of-1) or **peer** (k-of-n) — same machinery, just a threshold. For *this* deployment: single
   (the project owner). Peer-root is available later as a Phase-15 body (no new machinery).
2. **A compromised root is OUT OF SCOPE.** This is the threat boundary / stopping condition.
3. **Everything below root is a delegation tree.** Root grants scoped authority downward; the data
   boundary = that chain **+** project/task scope (reusing `callerScope`/`assertXScope` + the fence).
4. **Human/agent is an attribute** on the principal, not the axis; the axis is delegated role/scope.
5. **A Codex is an additive capability/policy unit** plugged into the same grant tables later — the
   foundation is built Codex-ready so governance grows without a rewrite.

## The Codex seam (how this stays a foundation, not a dead-end)
- A **grant** = `(grantee_principal, scope{project|topic|task}, capability)`. Today `capability` is a
  small fixed set (e.g. `read`/`write`/`admin`). Later, a **Codex** is just a named capability+policy
  bundle referenced by the same grant row — no schema change to the boundary.
- **Policy hooks** (human/agent attribute, refer-back, collective decision) attach as *optional*
  evaluators on top of the grant decision — absent in the foundation, addable per Codex/phase.
- So Phase-15 governance, refer-back, sealed Codices etc. become **new Codices + bodies**, not a new
  access-control system.

## Build plan (phased, TDD-first, NO paper eval loop)
Each phase: failing test → implement → **per-phase cold-start adversary review against the CODE**
(the safety policy's requirement; this is where enforcement-mechanism correctness — txn/lock/trigger —
actually gets proven, which 5 paper rounds showed it can't be on paper).

- **F1 — Identity + out-of-band root.** `principals` (opaque id, kind, status); `api_keys → principal`;
  root configured out-of-band (a seeded root principal + `ROOT_*` config; compromised-root OOS);
  **stop trusting asserted `actor_id`** (inject the authenticated principal). AC: identity un-spoofable
  with auth on; auth-off = root/dev context unchanged.
- **F2 — Delegation + scope (the boundary).** `grants(grantee, scope, capability, granted_by)`; root
  is the delegation source; `authorize(principal, action, resource)` = covering grant ∧ project/task
  scope (reuse `assertXScope`). AC: a scoped actor cannot read/act outside its grants; cross-project
  still `NOT_FOUND`.
- **F3 — Human/agent attribute + the fence.** Attribute on principal; key the Phase-15 Board fence on
  the authenticated principal/instance so concurrent agent runs don't collide. AC: two agent instances
  can't clobber one task; human/agent visible to policy.
- **F4 — Enforcement posture.** Auth-on = boundary enforced; auth-off = root/dev (single trusted
  operator) — documented, not a leak. Optional advisory dry-run before enforce. AC: cross-actor denial
  verified live in the auth-on CI lane.

## Threat model (the stopping condition)
In scope: spoofed identity, cross-project/cross-actor over-reach, concurrent-actor collision, agents
exceeding delegated scope. **Out of scope: a compromised root** (it's the trust anchor — secured
operationally, like a DB password), and a fully-compromised operator/`DATABASE_URL`.

## Deferred → DLF growth track (recorded, not lost)
Sealed Codices + re-consecration, refer-back (*obedezco pero no cumplo*), collective-decision routing,
retention/erasure, full RBAC matrix — all become **added Codices / Phase-15 bodies** on this
foundation. Design reference: v1–v5 + the five evals on this branch. Trigger to pick up: when a real
multi-actor governance need (human sign-off, disputes, voting) actually arises.
