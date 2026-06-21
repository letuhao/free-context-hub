# Scenario Evaluation — DESIGN v3 (mechanism-complete) + convergence analysis

**Date:** 2026-06-19 · **Branch:** `feature/actor-data-boundary`
**Input:** `-design-v3.md` · **Method:** 3 cold-start red-teams, ~46 scenarios.

## Bottom line

v3 is a **large, genuine advance** — every CRITICAL cluster from the v2 eval now has a concrete
column/trigger/engine-step where v2 had a sentence, and many single-actor/single-request paths are
confirmed **HANDLED**. But the eval found a fresh layer of **mechanism-edge** bugs, and — critically —
**several were found by reading the as-built code, not the doc** (e.g. `emitChain` hardcodes
`system:sweep` and never SELECTs `proposed_by`; `disputes.parties` is a `TEXT[]` that can't take the
FK v3 specifies; `executeByType` has no principal param; `coordination_events` has no immutability
trigger). **That is the signal that paper design has hit diminishing returns** — the remaining work is
to tighten mechanisms *against real code with tests*, which is BUILD (TDD + per-phase cold-start
adversary), not another doc revision.

## The convergence pattern (why a v4 doc won't converge)

| Round | What the eval found |
|---|---|
| v1 eval | architecture-level gaps (8 clusters) |
| v2 eval | "DLF property declared in prose, no mechanism" (8 clusters) |
| **v3 eval** | "mechanism exists but its **binding/edge** is too loose" — and the looseness is only visible against the real code |

The recurring shape, three rounds running: *the gate exists; its binding condition is under-tight* —
GUC not bound to an approved ceremony row (S-A2); instance not bound to a session (S-A9); confinement
not bound to the base chain (S-A15); version not bound to global roles (S-C1); batch authorizer not
bound to the PRE gates (S-C5); replay not bound to prod data shapes (S-C3). A v4 doc would specify
these one level finer and a v4 eval would find the *next* finer binding. **This class of bug is
closed by a failing test, not a paragraph.**

## v3-eval findings, split by where they belong

### Group A — genuine design decisions to settle in a short v3.1 delta (shape the schema/axes)
1. **Instance fence still principal-granular (C2, S-A9).** Two concurrent runs share the credential
   → each can present the other's *valid* same-principal `instance_id`. **Decide:** workers
   **mint-only, never accept a presented instance_id**; presented ids are for follow-up REST/MCP within
   one session; one live binding per instance. (finding-H — third appearance; needs a *binding rule*,
   then a test.)
2. **Topic axis unbuildable for lessons/documents (C6, S-A11).** `covers(topic)` needs `topic_id`,
   which knowledge tables lack. **Decide:** add/derive `topic_id` on ownable knowledge tables
   (a lesson linked to a task inherits the task's topic) — OR formally restrict the topic axis to
   coordination artifacts and correct the axis claim. A stated feature is non-functional until this.
3. **`disputes.parties` can't take the FK (schema, bonus).** It's `TEXT[]`. **Decide:** normalize to a
   `dispute_parties(dispute_id, principal_id)` join table; carve the array exception explicitly in §1.3.
4. **Append-only audit vs opaque-id re-key (H4, S-C4).** Re-keying `actor_id` in sealed events vs the
   immutability claim are mutually exclusive under real enforcement. **Decide:** 0065 adds a **separate
   write-once `principal_id` column** (backfill on NULL ≠ mutation) and leaves the legacy slug
   untouched; erasure anonymizes `display_name` only. Resolves H4 cleanly.
5. **Genesis is a re-armable backdoor (C3, S-B3).** `human:root` can suspend Council members below
   quorum to re-activate unilateral consecration. **Decide:** genesis re-activation requires a
   forced-triage window + alert + can't be caused by the root's own suspensions, or auto-rollback
   without retroactive Council ratification. State the threat + mitigation in §17.
6. **`on_behalf_of` execute-time scope provenance (C4, S-B15).** Undefined; collides with
   null-scope-means-unrestricted → revoked-key launder. **Decide:** derive scope from the job's
   `project_id` + require the originator to currently hold a covering appointment; **never** the
   `null`→unrestricted dev convention for delegated execution. Fail closed.
7. **Version-scope matrix incl. global roles (C8, S-C1/S-C8).** Per-project/principal versioning
   provably misses a global base-Codex amend. **Decide:** add a `global_codex_version` folded into
   every cache key + publish the per-write bump matrix (status→principal; appointment→appointee
   principal; global codex→global version) to avoid the `(project,P)` hotspot.

### Group B — "mechanism right, binding too loose" → fix in BUILD with a failing test first
These are already written as concrete fixes in the agent outputs; each becomes a Phase AC + test:
- Seal trigger: validate GUC → approved `re_consecrations` row + target; `OF` includes `sealed`;
  `BEFORE TRUNCATE` triggers; non-owner app role; `SET LOCAL` pool discipline (S-A1/A2/A3/A4/A5).
- `base_role_id` + `parent_topic_id` **cycle guards** (`WITH RECURSIVE … CYCLE`, write-time reject) (S-A6, S-B6).
- Action-catalog **miss = DENY** + boot completeness check (S-A16).
- `emitChain` reads `proposed_by`/`submitted_by` → chain `created_by`; `chain_depth` lives on tasks +
  threaded through `executeByType`; invariant test "no substantive task created_by `^system:`" (S-B1/B2).
- Batch authorizer runs **P1 (live status) + P2 (tenant)** per row; parity test vs single `authorize`
  (S-C5).
- `facts_hash` **server-derived**; the **per-tuple hard cap** is the real re-affirm-binds defense (S-B5).
- `resolveAuthority` **same-tenant ancestry only** + TOCTOU re-check on consume under row lock (S-B7/B8).
- Online backfill: **column DEFAULT sentinel during the rolling-deploy window** (no NULL ever) (S-C10).
- `VALIDATE CONSTRAINT` on huge tables run **outside the migration txn**, no statement timeout (S-C11).
- `kind`/`kind_verified` **not self-modifiable**; verification is human-authority-gated (S-A17).
- Legacy re-key keyed on the **composite `(project_id, actor_id)`**, 1:1 assertion (S-A18).
- `owner_project` confinement checks the **most-restrictive owner_project in the base chain** (S-A15).
- Predicated base-deny: amend-time validation **predicate-aware** (only unconditional denies block) (S-A7/A8).
- Bootstrap: boot check requires a **usable credential** (non-NULL hash), mint CLI is **DB-direct**,
  flip runbook documented, last `is_authority_root` protected from retire (S-C2, S-B10).
- Synthetic replay fixtures **derived from prod data shapes** (`authz_observed_shapes`), coupled to
  observed_actions; `produces_state_for` graph **validated** (acyclic+complete) or auto-derived (S-C3/C12/C13).
- `create` owner = **`actor` (on_behalf_of)**, not the worker; agent **create-private** is catalogued/
  gated (S-A19/A20).
- Proxy vote routed through `on_behalf_of` (delegator standing + proxy grant) — or dropped from §1.3
  if out of scope (S-B16).
- Retire reassigns owned private data to a **human** successor or quarantines (never to an agent) (S-B13).
- Refer-back drain vs approve **row-lock + winner = drain on `closing`** (S-B11).
- Decisions rollup: cross-project aggregate gated **global-scope only** (S-C9).
- Per-process appointment cache keyed off version (stateless MCP perf) (S-C14).

### Confirmed HANDLED in v3 (mechanism holds)
Governance formula `Phase15_grants AND NOT codex_denies` (eval-E fixed, core cases); DB kill-switch
coherence across the worker; status live + checked before mode (suspend is immediate); first-topic
charter chicken-egg (via `is_authority_root`); visibility-change re-gates the one-shot token;
single-actor instance distinguishing (honest concurrent runs); roll-off bumps version → cache miss.

## Recommendation (honest)

**Stop the paper design→eval loop; it has converged as far as paper can.** The evidence: round 3's
findings are mechanism-edge and several are only visible against the real code — that is BUILD work.
Proposed path:

1. **A short v3.1 delta** resolving only the **7 Group-A decisions** (they shape the schema/axes and
   can't be deferred). ~1 focused pass, not a rewrite.
2. **BUILD Phase A (identity)** with TDD + the **mandatory cold-start hostile-actor adversary review
   per the safety-sensitive policy** — the Group-B items become **acceptance criteria with failing
   tests written first** (seal-trigger-bypass test, cycle-guard test, batch-PRE-parity test, etc.).
   Building Phase A also *forces* C2 (instance fence) and H4 (opaque ids) into tested code, which is
   where they actually get resolved.
3. Carry the Phase-D/E Group-B items (refer-back, rollout, governance) as pinned ACs for those
   phases — don't fully pre-specify Phase E before Phase A exists.

The alternative (v4 full doc) will produce a v4 eval at the next finer binding level; the marginal
return is now lower than building Phase A and letting tests close the edges.
