# Deferred Items

<!-- Managed by Scribe. Do not edit manually. -->
<!-- Next ID: 025 -->

## DEFERRED-024

- **What:** `POST /api/jobs/run-next` pops the next queued job across ALL projects
  (`runNextJob(queue_name)` has no project filter). A project-scoped api key calling it
  could run another project's queued job. DEFERRED-004 (the writer-route tenant-scope
  audit) guarded every body/query/resource route but could NOT close this one with a
  request-time guard — there is no project in the request; the cross-project reach is in
  the SERVICE's pop semantics.
- **Why deferred:** DEFERRED-004 CLARIFY Q3 — Tier-2. Closing it needs a
  `runNextJob(queue, projectScope?)` signature change so the pop filters by the caller's
  scope (and the route passes `req.apiKeyScope`). That is a scheduling-semantics change
  (a scoped worker only drains its own project's queue) with its own design + test
  surface, distinct from the request-time guard work.
- **Trigger condition:** a sprint that touches the job queue / worker, OR enabling
  `MCP_AUTH_ENABLED=true` with project-scoped keys that call `run-next`.
- **Estimated size:** S–M — `runNextJob` gains an optional project filter; the route
  passes the scope; tests for scoped vs global pop.
- **Priority:** LOW — `run-next` is a worker/operator endpoint; in the dev posture
  (`MCP_AUTH_ENABLED=false`) there is no scope. Exploitable only auth-on with a scoped
  key deliberately draining another project's queue.
- **Session deferred:** 2026-05-21
- **Sessions open:** 1
- **Status:** RESOLVED — 2026-05-21 (`run-next-scope-deferred-024`):
  `claimNextQueuedJob(queue, projectScope?)` adds `AND project_id = $2` to the pop CTE
  when a non-empty `projectScope` is supplied; `runNextJob(queue, projectScope?)` threads
  it; `POST /api/jobs/run-next` passes `req.apiKeyScope`. A project-scoped api key drains
  ONLY its own project's queue (and correctly skips null-project/global jobs). The
  background worker, auth-off, and global-scope keys pop across all projects unchanged
  (undefined/null scope → no filter). 5 tests in `jobQueueScope.test.ts`. Closes the last
  tenant-scope hole (Tier-2 of DEFERRED-004).
- **Source:** DEFERRED-004 CLARIFY Q3 / DESIGN §4 (`docs/specs/2026-05-21-deferred-004-tenant-scope-design.md`).

---

## DEFERRED-023

- **What:** `taxonomy_profiles` is not a knowledge-bundle entity. The Phase 11 export/
  import path carries `lesson_types` (incl. `scope` as of DEFERRED-008), but the
  `taxonomy_profiles` table itself does not round-trip. A `scope='profile'` lesson type
  imported with correct scope (post-DEFERRED-008) attaches to a profile of the same key
  ONLY if that profile exists on the destination — which today happens only via the
  config-seed (`config/taxonomy-profiles/*.json`) on a fresh instance, not via the bundle.
- **Why deferred:** DEFERRED-008 (2026-05-21) CLARIFY Q1 — the user chose the scope-only
  fix (close the data-integrity leak) and deferred the profiles round-trip as a separate
  feature. Adding `taxonomy_profiles` as a bundle entity is a new ENTRY_NAME + export
  iterable + import handler + manifest + conflict policy + tests (its own S–M scope).
- **Trigger condition:** a sprint that touches `src/services/exchange/*` for a feature
  reason, OR a user report that a cross-instance import lost taxonomy-profile definitions
  (not just type classification — DEFERRED-008 fixed the classification).
- **Estimated size:** S–M — new bundle entity `taxonomy_profiles.jsonl` (ENTRY_NAMES,
  encode iterable, BundleReader method), export SELECT, import apply handler with a
  conflict policy, manifest count, `bundleFormat.test.ts` + import e2e coverage.
- **Priority:** LOW — profiles re-seed from config on a fresh instance; the
  DEFERRED-008 fix already stops the scope-LEAK (the data-integrity issue). This is the
  remaining round-trip-completeness enhancement.
- **Session deferred:** 2026-05-21
- **Sessions open:** 1
- **Status:** RESOLVED 2026-05-23 — `taxonomy_profiles` is now a bundle entity. `bundleFormat.ts`
  (ENTRY_NAMES + BundleData + BundleReader.taxonomy_profiles + encode/iterate), `exportProject.ts`
  (owner-project cursor; owner_project_id NOT carried), `importProject.ts` (counts/conflict union +
  processBatched + `applyTaxonomyProfile` — owner rebound to target, built-in overwrite refused).
  Export's `WHERE owner_project_id=$1` filter + built-ins being owner-NULL means a bundle can never
  carry/inject a system built-in. 4 round-trip tests in `scopeRoundTrip.test.ts`; 720/720 green; no
  migration. Branch=taxonomy-profiles-bundle-deferred-023.
- **Source:** DEFERRED-008 CLARIFY Q1 (`docs/specs/2026-05-21-deferred-008-exchange-scope-clarify.md`); the original DEFERRED-008 "related" note.

---

## DEFERRED-022

- **What:** Multi-tier collective request-step routing. Sprint 15.8 supports collective
  steps ONLY on single-step routes (`escalate_to_authority` OR single-step `counter_sign`).
  The DoA matrix carries one `body_id` per row; a multi-step `counter_sign` collective
  route would inherit ONE body across all steps, collapsing the "distinct endorser at
  each level" guarantee to a single body. 15.8 hard-rejects multi-step counter_sign+
  collective at `submitRequest` with `BAD_REQUEST`. The realistic governance pattern
  ("coordination committee endorses, then authority board endorses" — two different
  bodies, one per level) is therefore unsupported.
- **Why deferred:** Sprint 15.8 REVIEW-DESIGN r1 F3 (WARN) — accepted-with-doc. The
  feature requires either (a) per-level body assignment in the DoA matrix (a new
  `doa_matrix_levels` table or a JSON column mapping level→body_id) or (b) a per-
  submission `collective_bodies` blob. Both are substantial design surface in their
  own right; 15.8 shipped the single-step common case to close DEFERRED-018 in a
  contained M sprint.
- **Trigger condition:** a Phase 15 sprint that implements per-level body assignment,
  OR a user-reported case where single-step collective insufficiency surfaces in
  practice.
- **Estimated size:** M — schema design + matrix lookup changes + submitRequest
  per-step body resolution + tests + the lapsed-escalation handling at each level
  (currently degrades to unilateral; with per-level bodies, could re-propose under
  the new level's body).
- **Priority:** LOW — single-step collective covers the most common "a single
  committee decides" pattern. Multi-tier collective is a governance enhancement.
- **Session deferred:** 2026-05-20
- **Sessions open:** 2
- **Status:** RESOLVED — Sprint 15.10 (2026-05-21): new `doa_matrix_levels (matrix_id,
  level, body_id)` table for per-level body assignment + `requests.body_by_level JSONB`
  snapshot column (honors B.7 snapshot-the-rules). submitRequest resolves per-step
  body via Map (table preferred, single-body fallback for 15.8 compat); distinct-body
  check on counter_sign+collective routes; missing_collective_body rejection.
  applyMotionToStep lapsed path reads the snapshot → re-propose under next level's
  collective body if configured, else fallback degrade-to-unilateral (Q2(a)).
  Event payload unified on `escalated_to: 'collective' | 'unilateral'` field (F2 fix —
  replaces 15.8's `degraded_to`). Backward compatible with 15.8 single-step collective
  matrix rows. Per-actor cross-body collusion documented as out-of-scope (interlocks
  with DEFERRED-015 — F3 accept-with-doc). 6 new tests + live smoke confirmed.
- **Source:** Phase 15 Sprint 15.8 REVIEW-DESIGN r1 F3 + DESIGN §2.2.

---

## DEFERRED-021

- **What:** MCP `decide_step` + `tally_motion` outputSchema does not declare the
  Sprint 15.7 `chain: {kind:'posted'|'deferred', ...}` field. The chain result is
  service-side correct (included in REST responses and the coordination_events log),
  but MCP `structuredContent` silently drops it because the outputSchema lacks the
  property. MCP clients reading `structuredContent.chain` see `undefined`.
- **Why deferred:** Sprint 15.7 REVIEW-CODE F3 (LOW). Adding a clean discriminated-
  union shape (`chain.kind='posted'` vs `'deferred'`) interlocks with DEFERRED-007
  (MCP SDK known issue with discriminated-union outputSchemas — `tool/call` returns
  `_zod` error). A flat-optional shape would work but is loose; defer the proper
  design to 15.8.
- **Trigger condition:** Sprint 15.8 OR the next sprint touching MCP outputSchemas,
  OR a reported MCP-client regression where the caller depends on `structuredContent.chain`.
- **Estimated size:** S — schema update + a regression test for `tool/call` end-to-end
  asserting the chain field; interlocks with DEFERRED-007 resolution.
- **Priority:** LOW — REST and event log carry the field; MCP callers can fall back to
  text parsing or REST.
- **Session deferred:** 2026-05-20
- **Sessions open:** 2
- **Status:** RESOLVED — Sprint 15.9 (2026-05-20): MCP `decide_request_step` and
  `tally_motion` outputSchemas declare optional `chain` field with FLAT-OPTIONAL shape
  (kind: required string, task_id/artifact_id/reason/deferred_event_id: optional strings)
  to avoid DEFERRED-007 discriminated-union SDK issue. Live `tools/list` smoke confirmed
  both schemas include the chain object property.
- **Source:** Phase 15 Sprint 15.7 REVIEW-CODE r1, F3 (`docs/audit/findings-sprint-15.7-code-r1.md`).

---

## DEFERRED-020

- **What:** Three LOW-severity test coverage gaps from the Sprint 15.6 `/review-impl` pass.
  **(a)** LOW-7: No API-level test for the route-layer fractional step-index guard (`/^\d+$/`
  in `routes/requests.ts:169`) — the existing service-layer test (`AC17`) hits `decideStep`
  directly; the route guard adds a 400 before it. **(b)** LOW-8: No test for the
  `artifact_advanced:true` path on the approved branch (AC15 covers `false`); no test that the
  `escalation_exhausted` sweep event in `coordinationSweep.ts` carries `artifact_advanced:false`
  (the field was added in 15.6 but only the `reject` path is test-asserted). **(c)** LOW-9: No
  event-ordering assertions in the drain tests `AC2`/`AC3` — tests verify counts and final state
  but do not assert `claim.force_lapsed` / `request.force_closed` precede `topic.closed` in the
  event log.
- **Why deferred:** All three are test coverage improvements, not production risks. Fixing them in
  the Sprint 15.6 POST-REVIEW cycle would have been batching LOW items with a HIGH fix — against
  the workflow's fix-HIGH-now, defer-LOW policy.
- **Trigger condition:** Any sprint that edits the affected code paths, or a dedicated test-
  coverage pass.
- **Estimated size:** XS–S — one route test for (a); one service test each for (b); two
  assert additions for (c).
- **Priority:** LOW
- **Session deferred:** 2026-05-18
- **Sessions open:** 3
- **Status:** RESOLVED — Sprint 15.9 (2026-05-20):
  (a) LOW-7 — 2 route-level tests added in `src/api/routes/requests.test.ts` covering
      fractional (`1.5`) + negative (`-1`) step-index inputs; assert 400 + BAD_REQUEST
      code from the route layer (not the service);
  (b) LOW-8 — positive `artifact_advanced:true` test in `requests.test.ts` (approve
      branch, cross-checked with artifact state→'final'); added assertion to T18 sweep
      test in `coordinationSweep.test.ts` that `escalation_exhausted` payload carries
      `artifact_advanced:false`;
  (c) LOW-9 — added event-ordering assertions to topics drain AC2+AC3 in `topics.test.ts`
      asserting `claim.force_lapsed` / `request.force_closed` events precede `topic.closed`
      by `seq` ordering.
- **Source:** Phase 15 Sprint 15.6 `/review-impl` LOW-7, LOW-8, LOW-9.

---

## DEFERRED-019

- **What:** Master design C.4 specifies that a **resolved Request** or a **carried Motion**
  emits an event whose handler **posts a new board task** ("execute the approved/carried
  outcome") — unless the topic is `closing`/`closed`, in which case it emits `task.deferred`.
  Neither Sprint 15.3 (request) nor Sprint 15.4 (motion) implemented this chaining: a 15.3
  `approved` request's outcome = the artifact advance + `request.resolved`; a 15.4 `carried`
  motion's outcome = the status flip + `motion.tallied`. No chained board task is posted by
  either primitive.
- **Why deferred:** Sprint 15.3 CLARIFY out-of-scope ("underspecified — *what task?* — and it
  interlocks with the topic `closing`-drain, DEFERRED-012") and Sprint 15.4 CLARIFY out-of-scope
  (the same, for motions). The chaining is one concern spanning both primitives and interlocks
  with DEFERRED-012 — the `closing`-drain handler must *suppress* chaining (emit `task.deferred`
  into the sealed trail) so a draining topic is never re-filled. Best built once, with
  DEFERRED-012, after the "what task does a carried motion / approved request spawn?" question
  is settled.
- **Trigger condition:** a Phase 15 sprint that implements primitive-outcome chaining — likely
  alongside or after DEFERRED-012 (the `closing`-drain), since the two interlock. No hard
  deadline; a feature follow-on.
- **Estimated size:** M — an event handler that posts a board task on `request.resolved`
  (approved) / `motion.tallied` (carried), suppressed on a `closing`/`closed` topic; tests;
  interlocks with DEFERRED-012.
- **Priority:** LOW — the resolved/carried outcome is fully recorded in the event log; a human
  or a successor process acts on it from the log. Automatic chaining is an ergonomics
  enhancement.
- **Session deferred:** 2026-05-18
- **Sessions open:** 2
- **Status:** RESOLVED — Sprint 15.7 (2026-05-20): chain emits at 3 sites (decideStep approve,
  tallyMotion carried, sweepExpiredMotions carried). Submitter-specified `execution_task` JSONB
  blob on requests + motions (migration 0060); chain merges blob over derived defaults. Dual-
  emit `task.deferred` (subject_type='topic') on closing/closed. Throws
  CHAINED_TASK_DEPENDENCY_INVALID → source ROLLBACK on bad blob. Source event payload extended
  with `chain: {kind, ...}` + `deferred_event_id` cross-ref on deferral. 5 tests cover AC1+
  AC3 (decision + blob), AC6 (negative outcomes), AC7 (closing → deferred), AC10
  (invalid_depends_on → rollback).
- **Source:** Phase 15 Sprint 15.3 + 15.4 CLARIFY out-of-scope; master design
  `docs/phase-15-design.md` C.4.

---

## DEFERRED-018

- **What:** A Sprint 15.3 `request_steps` row carries a `procedure` column
  (`unilateral`/`collective`); `submitRequest` (`src/services/requests.ts`) rejects
  `procedure='collective'` with "collective steps are Sprint 15.4". Sprint 15.4 built the
  **standalone** collective-decision primitive (`decision_bodies`/`motions`/`votes`/tally/veto)
  but did **not** wire it into request-step decision — a `procedure='collective'` step decided
  by a motion's tally instead of one officeholder's `decideStep`. `submitRequest` still rejects
  `collective`.
- **Why deferred:** Sprint 15.4 CLARIFY Q1 — the user's decision: 15.4 = the standalone motion
  machinery (the master roadmap's stated 15.4 scope). The `procedure='collective'` request-step
  integration is a cross-primitive contract (a request step's deadline/escalation interacting
  with a motion's full lifecycle) deserving its own design focus; folding it in would have
  re-expanded the security-review surface of the just-hardened (15.3.1) `requests.ts`.
- **Trigger condition:** a Phase 15 sprint that wires the Request and collective-decision
  primitives — makes a request step resolvable by a decision body. No hard deadline; a feature
  follow-on.
- **Estimated size:** M — `decideStep` (or a new path) routes a `collective`-procedure step to
  a motion; the motion's `carried`/`failed` maps to the step's `endorsed`/`returned`; the step
  deadline ↔ the motion deadline reconciled; per-path tests.
- **Priority:** LOW — `unilateral` (the only shipped request procedure) covers the current
  need; `collective` request steps are an enhancement.
- **Session deferred:** 2026-05-18
- **Sessions open:** 2
- **Status:** RESOLVED — Sprint 15.8 (2026-05-20): collective request-step wiring shipped.
  Migration 0061 added `doa_matrix.procedure+body_id` + `request_steps.body_id+motion_id` +
  status='motion_proposed'. submitRequest accepts collective; `proposeStepMotion` auto-proposes
  a motion at step 0; `decideStep` early-rejects collective with 'procedure_is_collective';
  `applyMotionToStep` (called from tallyMotion + vetoMotion + sweepExpiredMotions) handles
  4 outcomes (carried→step.endorsed advance, failed→returned, lapsed→degrade-to-unilateral
  escalation, vetoed→rejected). 15.7 chain fires on collective-carried-final via the same
  emitChain path; motion-chain suppressed on step-proposal motions to avoid duplicate tasks.
  Limitation: only single-step routes supported (multi-step counter_sign+collective rejected
  → DEFERRED-022).
- **Source:** Phase 15 Sprint 15.4 CLARIFY Q1 / out-of-scope
  (`docs/specs/2026-05-18-phase-15-sprint-15.4-clarify.md`); the Sprint 15.3 design decision D6.

---

## DEFERRED-017

- **What:** Phase 15 Sprint 15.4's collective-decision primitive
  (`decision_bodies`/`body_members`/`motions`/`votes`) carries the **same self-declared-authority
  class as DEFERRED-015/016**. `createBody` (`src/services/decisionBodies.ts`) is **ungated** —
  any `writer`-role caller mints a body with itself as the sole weighted member + itself in
  `veto_holders`. `addBodyMember` is ungated — anyone adds anyone at any weight. `castVote`'s
  `proxy_for` is **recorded but the proxy grant is unverified** (no `proxies` table). And
  `proposeMotion`'s `not_participant` gate is itself satisfiable by any caller because
  `joinTopic` is ungated (the Sprint 15.4 POST-REVIEW Adversary WARN-1). The *mechanism* is
  sound — quorum/threshold/veto/the vote-weight snapshot/the atomic ballot FSM cannot be
  subverted by a mutually-distrusting body member, and the early-tally vector is closed — but
  *who* may create a body / grant veto power / set a vote weight / hold a proxy is **not
  authorized**. Also (Sprint 15.4 REVIEW-CODE LOW-3): `decision_bodies.veto_holders` has no
  array-length / element-length cap — input hygiene on the same body-creation surface.
- **Why deferred:** Sprint 15.4 DESIGN §0.5 (the explicit honest-scope section) + CLARIFY (the
  user's decision — 15.4 = the standalone motion *mechanism*, coordinator-trusted under the
  `MCP_AUTH_ENABLED=false` single-operator dev posture). Body / membership / veto-power
  authorization is the **Phase 15 authorization model** — the same subsystem as DEFERRED-015
  (self-declared participant `level`), DEFERRED-016 (api-key multiplicity), DEFERRED-009
  (topic-scope authz); best built once as a coherent piece, not bolted onto the motion
  primitive.
- **Trigger condition:** **HARD trigger — same class as DEFERRED-015/016: MUST be resolved
  (together with 015 + 016) before ANY of:** (a) `MCP_AUTH_ENABLED=true` in a deployment with
  more than one non-mutually-trusting actor; (b) Sprint 15.6 (the GUI makes coordination
  interactively self-serve); (c) any production / multi-tenant use of the coordination
  primitives. Whichever comes first.
- **Estimated size:** M–L — a body/membership authorization model (who may create a body, grant
  veto power, assign a vote weight); a `proxies` grant table + verification; the `veto_holders`
  length cap (an S sub-item); interacts with the Phase 15 authz model
  (DEFERRED-009/015/016).
- **Priority:** HIGH — a residual of a governance primitive; only the `MCP_AUTH_ENABLED=false`
  single-operator dev posture keeps it non-exploitable now (the same posture as 015/016).
- **Session deferred:** 2026-05-18
- **Sessions open:** 1
- **Status:** RESOLVED — Sprint 15.11 (2026-05-21): decision-body authorization shipped.
  `createBody` + `addBodyMember` routes raised to `requireRole('admin')` (project-config
  operation). `veto_holders` length cap (≤64 entries, ≤256 chars each). `castVote.proxy_for`
  verification: new `proxies` table (migration 0063) + `grantProxy`/`revokeProxy`/`listProxies`
  (principal-only grant — granted_by must equal principal); `castVote` verifies the grant when
  auth-on (`proxy_not_granted`), preserves 15.4 unverified behavior auth-off (Q2 posture).
  Security review CLEAR. (DEFERRED-017 was the decision-body half of the Phase 15 authz model.)
- **Source:** Phase 15 Sprint 15.4 DESIGN §0.5; POST-REVIEW security Adversary WARN-1
  (`docs/audit/findings-sprint-15.4-post-review.md`); REVIEW-CODE LOW-3
  (`docs/audit/findings-sprint-15.4-code-r1.md`).

---

## DEFERRED-016

- **What:** Phase 15 coordination identity has no bound on **api-key multiplicity**. One
  operator who can mint api keys (`createApiKey`, `src/services/apiKeys.ts` — no per-operator
  key limit) can create N distinct DB keys; Sprint 15.3.1's F1 token-binding faithfully
  stamps each request/step with that key's `name`. So F1 makes the acting identity a
  token-bound credential handle, but it does **not** make "one human = one principal": an
  operator with key-minting power obtains as many distinct coordination identities as it
  creates keys, and can still drive a multi-level approval single-handed. (`api_keys.name`
  is also not schema-`UNIQUE`, but same-`name` keys *collapse* to one identity and are caught
  by `decideStep`'s self-decision guard — non-uniqueness is an audit-trail ambiguity, not a
  forgery vector. The residual here is key *multiplicity*, not name collision.)
- **Why deferred:** Surfaced at Sprint 15.3.1 REVIEW-DESIGN round 2 (Adversary NEW FINDING 1).
  Sprint 15.3.1's F1 closes the body-string identity-forgery vector (audit Finding 1's "pick
  two JSON strings"); bounding how many credentials one principal may hold is the
  **key-provisioning authorization model** — a different subsystem (`api_keys` /
  `createApiKey` / the `/api/api-keys` admin surface, related to DEFERRED-004) with its own
  design. An early 15.3.1 design draft wrongly described this residual as "covered by
  DEFERRED-015's trigger"; DEFERRED-015 scopes strictly to making the participant `level`
  authoritative (a `joinTopic` change) and does not own key provisioning. This item gives
  the residual a real owner.
- **Trigger condition:** Same HARD class as DEFERRED-015 — MUST be resolved (together with
  DEFERRED-015) before ANY of: (a) `MCP_AUTH_ENABLED=true` in a deployment with more than
  one non-mutually-trusting actor; (b) Sprint 15.6 (GUI self-serve coordination); (c) any
  production / multi-tenant use of the Board or Request-Approval primitives. **The Sprint
  15.3 audit's CRITICAL Finding 1 is fully closed only when F1 (Sprint 15.3.1, done),
  F2/level-authority (DEFERRED-015), and key-multiplicity bounding (this item) are all
  resolved.**
- **Estimated size:** M — a provisioning-side rule (who may mint keys; and/or binding a
  coordination actor to exactly one credential — a 1:1 actor↔key map, or per-key
  coordination-actor scoping); interacts with DEFERRED-004 (tenant-scope on admin endpoints)
  and the Phase 15 authz model (DEFERRED-009). **Verification (Sprint 15.3.1 POST-REVIEW WARN-1):** bundle an auth-on (`MCP_AUTH_ENABLED=true`) end-to-end smoke of Sprint 15.3.1's F1 (identity binding) + F4 (GET role gate) with this work — 15.3.1 verified F1/F4 via a route test-shim that reproduces `bearerAuth`'s `apiKeyName`/`apiKeyRole` contract, not a live auth-on stack.
- **Priority:** HIGH — a residual of a CRITICAL finding; only the `MCP_AUTH_ENABLED=false`
  single-operator dev posture keeps it non-exploitable now (same as DEFERRED-015).
- **Session deferred:** 2026-05-18
- **Sessions open:** 1
- **Status:** RESOLVED — Sprint 15.11 (2026-05-21): api-key provisioning hardened.
  (a) Actor-identity uniqueness — partial unique index `api_keys_active_name_uniq (name)
  WHERE revoked=false` (migration 0063); `createApiKey` catches 23505 → `duplicate_active_
  key_name`. (b) Per-operator key-count limit — `api_keys.created_by` column + env
  `MAX_KEYS_PER_CREATOR` (default 50); `createApiKey` counts active keys by creator and
  rejects `key_limit_exceeded`. The api-keys route passes `created_by` from `req.apiKeyName`.
  The one-human-two-keys residual is documented + bounded (security review §8 / probe P5):
  capped by the key limit + the level-grant audit chain (a key still can't self-grant
  authority). Security review CLEAR.
- **Source:** Phase 15 Sprint 15.3.1 REVIEW-DESIGN round 2, Adversary NEW FINDING 1
  (`docs/audit/findings-sprint-15.3.1-design-r2.md`).

---

## DEFERRED-015

- **What:** Phase 15 participant `level` is **self-declared and unverified**. `joinTopic` (`src/services/topics.ts`) inserts a `topic_participants` row with whatever `level` (`authority` / `coordination` / `execution`) the caller passes — there is no gate on who may become `authority` and no approval step. Sprint 15.3's `decideStep` (`src/services/requests.ts`) authorizes a step decision by `topic_participants.level === target_office` — so the officeholder check is only as trustworthy as a self-asserted level: a caller joins as `authority` and decides `authority`-target steps. (Sprint 15.3.1 binds the acting *identity* to the authenticated token, forcing a real distinct principal per actor; this item is the remaining half — making the *level* of that principal authoritative rather than self-asserted.)
- **Why deferred:** Sprint 15.3 human-in-loop review, security audit Finding F2 (CRITICAL). The user chose the "15.3.1 fix-up, defer levels" disposition: 15.3.1 closes the identity-spoofing half (F1 — token-bound `submitted_by`/`actor_id`); making `level` authoritative is a change to the 15.1 `joinTopic` write-path + the participant model with its own design surface (who may grant a level — a topic owner? an existing `authority`? an out-of-band role?), best built once as a coherent piece rather than bolted onto a fix-up.
- **Trigger condition:** **HARD trigger — MUST be resolved before ANY of:** (a) `MCP_AUTH_ENABLED=true` in a deployment with more than one non-mutually-trusting actor; (b) Sprint 15.6 (the GUI makes the coordination system interactively self-serve); (c) any production / multi-tenant use of the Board or Request-Approval primitives. Whichever comes first. Until then, the coordination authorization model is sound only under a single trusted operator (the current `MCP_AUTH_ENABLED=false` dev posture).
- **Estimated size:** M–L — a `level`-grant path (level set/changed only by a topic owner or an existing `authority` participant, not self-asserted at join); `joinTopic` defaults a new participant to `execution`; a level-change operation + event; tests. Interacts with the broader Phase-15 authorization model (DEFERRED-009).
- **Priority:** HIGH — the residual half of a CRITICAL finding; only the `MCP_AUTH_ENABLED=false` single-operator dev posture keeps it non-exploitable now.
- **Session deferred:** 2026-05-18
- **Sessions open:** 1
- **Status:** RESOLVED — Sprint 15.11 (2026-05-21): level-grant chain shipped. `joinTopic`
  no longer self-asserts level — the topic OWNER (`created_by`, a permanent grant root) may
  set their own level at first join (bootstrap); every other joiner is forced to `execution`
  (non-owner non-execution → `BAD_REQUEST level_grant_required`). New `grantLevel(topic_id,
  actor_id, level, granted_by)` op: only the owner or an existing `authority` may grant;
  self-grant forbidden; emits `topic.level_granted` (migration 0063 adds
  `topic_participants.granted_by`). Enforced ALWAYS (auth-on + auth-off, keyed on actor_id).
  `decideStep`'s `level === target_office` check is now authoritative. Owner-permanence: a
  demoted owner retains grant power (tested). Security review CLEAR — HARD pre-prod authz
  trigger satisfied for the coordination-role surface. (Tenant-scope authz remains DEFERRED-009.)
- **Source:** Phase 15 Sprint 15.3 human-in-loop review, security audit Finding F2 (`docs/audit/findings-sprint-15.3-human-review-security.md`).

---

## DEFERRED-014

- **What:** Two LOW-severity consistency residuals from the Sprint 15.3 REVIEW-CODE `/review-impl` pass, both in `src/services/requests.ts`. **(a)** `listRequests` does not check topic existence — `GET /api/topics/<unknown>/requests` returns `200 {requests:[]}`, whereas the 15.2 sibling `listBoard` carries an explicit topic-existence check (`board.ts` `[LOW-7]`) returning `NOT_FOUND`, and `getRequest` returns 404 for an unknown request; a caller cannot distinguish "topic has no requests" from "topic does not exist". **(b)** The `request.resolved` event payload is non-uniform — `approved`/`returned` carry `artifact_advanced`, while `rejected` (`requests.ts`) and `escalation_exhausted` (`coordinationSweep.ts`) omit it, so a consumer replaying the event log (AC11's authoritative record) sees the field on only 2 of 4 outcomes. **(c)** [Sprint 15.3.1 POST-REVIEW WARN-2] the REST decide route (`routes/requests.ts`) derives `step_index` via `parseInt(req.params.n)`, which truncates a fractional path segment (`/steps/1.5/decide` → `1`) — so Sprint 15.3.1's F5 fractional-rejection in `decideStep` is unreachable from REST (cosmetic: the truncated step fails safe to `not_current_step`; the negative case still reaches `decideStep` and is rejected; MCP rejects fractionals at `z.number().int()`). **(d)** [Sprint 15.3.1 REVIEW-CODE LOW-5] `submitted_by` / `actor_id` are not length-capped while 15.3.1's F7 caps `kind`/`subject_id` at 256 — an asymmetry (defensible: auth-on binds the identity to `apiKeyName` ≤128, auth-off is operator-trusted).
- **Why deferred:** Sprint 15.3 REVIEW-CODE `/review-impl` findings #4 + #5, both LOW. The code faithfully implements design rev 3 (which passed 3 cold-start Adversary rounds) — both items are "the reviewed contract could be marginally more consistent", not defects. Changing them in REVIEW-CODE would deviate from the reviewed design contract without re-running REVIEW-DESIGN. The REVIEW-DESIGN round-3 Adversary explicitly considered (a) and judged the current behavior "defensible, not worth a finding". Bundled for a future touch of the requests surface.
- **Trigger condition:** Sprint 15.6 (the GUI lists requests — a 404-vs-empty distinction becomes user-visible) OR any sprint that edits `src/services/requests.ts` or the coordination event-payload schema. **Re-defer note (Sprint 15.3.1):** 15.3.1 edited `requests.ts` / `routes/requests.ts` — nominally this trigger — but it was a deliberately-minimal security fix-up (F1/F3a/F4/F5/F7 only); bundling these non-security consistency residuals would have broadened the change and the security-review surface. Re-deferred — the trigger now means the next *feature* touch of the requests surface, or Sprint 15.6.
- **Estimated size:** S — (a) a plain `SELECT 1 FROM topics` existence check in `listRequests` + a test; (b) emit `artifact_advanced:false` on the reject + `escalation_exhausted` paths for a uniform payload + adjust the assertions; (c) a route-layer integer check on `req.params.n` for an honest 400; (d) a 256-char cap on `submitted_by` / `actor_id`.
- **Priority:** LOW — (a) `topic_id` is a UUID (not guessable) and an empty list is functional; (b) a replay consumer can treat a missing `artifact_advanced` as `false`.
- **Session deferred:** 2026-05-18
- **Sessions open:** 2
- **Status:** RESOLVED — Sprint 15.6 (2026-05-18): (a) `listRequests` NOT_FOUND check + AC14 test; (b) `artifact_advanced:false` on reject + escalation_exhausted paths + AC15; (c) route `parseInt` guard `/^\d+$/` + AC17; (d) `submitted_by` 256-char cap + AC18.
- **Source:** Phase 15 Sprint 15.3 REVIEW-CODE `/review-impl` review, findings #4 + #5 (`docs/audit/findings-sprint-15.3-code-r1.md`); extended (c)+(d) by Sprint 15.3.1 POST-REVIEW WARN-2 + REVIEW-CODE LOW-5.

---

## DEFERRED-013

- **What:** A `counter_sign` request route requires a *distinct* endorsement at each level on the route — that is its multi-party guarantee. Sprint 15.3's escalation sweep (`sweepStalledSteps`, `src/services/coordinationSweep.ts`) climbs a timed-out step's `target_office` up one level in place (design D9); when it climbs to a level a *later* step on the same route also targets, the route then has two steps at the same level. `decideStep` (`src/services/requests.ts`) authorizes by `level == target_office` (+ `actor ≠ submitted_by`) and does **not** track which actors decided earlier steps — so a single officeholder at that level can endorse both steps, collapsing the counter-sign's distinct-endorser guarantee into a single-endorser approval. Neither same-level step-collapse/de-duplication nor distinct-endorser enforcement (`decideStep` rejecting an actor who already decided an earlier step of the same request) is implemented in 15.3.
- **Why deferred:** Sprint 15.3 REVIEW-DESIGN round-2 Adversary finding W1 (WARN — non-fatal). It arises only on the post-deadline escalation path (already an abnormal route), the outcome is fully recorded in the event log, and the request still terminates correctly. The 15.3 design (§11.2, invariant 3) accepts it explicitly. The clean fix interacts with the collective-decision model (15.4) and the dispute model (15.5) — a route's quorum / distinct-endorser semantics should be settled once, alongside motions and votes, not bolted onto 15.3.
- **Trigger condition:** Sprint 15.5 (dispute), OR a reported case of an escalated counter-sign request being approved by a single endorser. Whichever sprint formalizes multi-party endorsement should add distinct-endorser enforcement to `decideStep` and/or same-level step-collapse at escalation time. **Re-defer note (Sprint 15.4):** Sprint 15.4 (collective decision) was a named trigger here, but the user's CLARIFY Q2 decision kept 15.4 to the standalone motion primitive — 15.4 does **not** touch `requests.ts` / `decideStep`, so folding the distinct-endorser fix in would have re-opened the just-hardened (15.3.1) security surface for an unrelated reason. Re-deferred to **Sprint 15.5** (dispute — which also formalizes multi-party adjudication of a request route).
- **Estimated size:** S–M — `decideStep` checks the request's already-decided `request_steps.decided_by` set and rejects a repeat endorser; optionally collapse adjacent same-`target_office` steps when the escalation sweep climbs a step; per-path tests.
- **Priority:** LOW — post-timeout-only, fully auditable, the request still terminates correctly.
- **Session deferred:** 2026-05-17
- **Sessions open:** 2
- **Status:** RESOLVED — Sprint 15.6 (2026-05-18): `decideStep` for `counter_sign` routes queries prior `request_steps.decided_by IS NOT NULL`; same actor in any prior step → `repeat_endorser` (→ HTTP 409). AC13 (negative) + AC16 (positive/distinct-actor) tests added.
- **Source:** Phase 15 Sprint 15.3 REVIEW-DESIGN round 2, Adversary finding W1 (`docs/audit/findings-sprint-15.3-design-r2.md`).

---

## DEFERRED-012

- **What:** `closeTopic` (`src/services/topics.ts`) is **atomic** — a topic flips `chartered|active → closed` in one step and the `coordination_events` log seals immediately. There is no intermediate `closing` drain-state in which in-flight items are force-lapsed *before* the seal. Sprint 15.1 design decision D4 specified "Sprint 15.2 adds the drain"; Sprint 15.2 re-deferred it. Consequence: a topic can be closed with a live or abandoned claim still attached; such claims are cleaned up after the fact by the abandoned-claim sweep's closed-topic branch (claim row dropped, task → `abandoned`, artifact left frozen with no revert — to preserve event-log/state coherence), rather than drained cleanly through the normal recovery path before the seal.
- **Why deferred:** Re-deferred by the Sprint 15.2 design and **ratified at the 2026-05-17 Phase 15 longrun human-in-loop review**. A `closing` drain-state must force-lapse *every* in-flight item type — claims (15.2), requests (15.3), motions/votes (15.4), disputes (15.5). Building it claims-only now would be reworked three times as the later primitives land. Deferred so it is built once over the complete in-flight set. `coordinationConstants.ts` `TOPIC_STATUSES` already includes `'closing'` (currently unused).
- **Trigger condition:** Sprint 15.5 (intake + dispute) — by which point the full in-flight item set exists. Build `closeTopic` two-phase (`active → closing`, drain/force-lapse all in-flight items, `closing → closed`); the log seal moves to the `closing → closed` step.
- **Estimated size:** M–L.
- **Priority:** MED — until then, closed topics rely on each primitive's sweep closed-topic branch for after-the-fact cleanup (functional, but not a clean pre-seal drain).
- **Session deferred:** 2026-05-17
- **Sessions open:** 1
- **Status:** RESOLVED — Sprint 15.6 (2026-05-18): three-phase `closeTopic` drain implemented in `src/services/topics.ts` — Phase 1 (`active → closing` + topic.closing), Phase 2 (drain claims/requests/motions/disputes/intake_items in individual short transactions), Phase 3 (`closing → closed` + topic.closed seal). All writer paths block on 'closing'. Sweeps skip 'closing' alongside 'closed'.
- **Source:** Phase 15 Sprint 15.1 design decision D4; re-deferred by Sprint 15.2 design; ratified at the 2026-05-17 longrun human-in-loop review.

---

## DEFERRED-011

- **What:** Sprint 15.2 ships the `tasks.topology` (`parallel|sequential|rolling`) and `tasks.depends_on` (`UUID[]`) columns (migration 0054) and records them at `postTask`, but **nothing enforces them**. `claimTask` (`src/services/board.ts`) grants a claim on any `posted` task regardless of whether a `sequential` task's `depends_on` predecessors are `completed`; there is no gating of a `rolling` consumer on a `baselined` upstream artifact. The columns capture coordinator intent; no service acts on it. `baselineArtifact` ships (the rolling-handoff primitive) but the rolling *wiring* does not.
- **Why deferred:** Explicitly scoped out at Sprint 15.2 CLARIFY (in-scope table ships the columns + `baselineArtifact`; enforcement is named a follow-up). Confirmed a pre-existing CLARIFY decision (not a new mechanism) by the design-r4 self-review, and re-flagged by the Sprint 15.2 QC matrix and the POST-REVIEW Scope Guard. The Board's core loop (post → claim → write → baseline → complete + the abandoned-claim sweep) is correct topology-agnostically; ordering enforcement is a coherent follow-on, best built once the wider in-flight item set (requests / motions / disputes) exists so the dependency model is uniform.
- **Trigger condition:** A Phase 15 sprint that implements task-dependency / topology enforcement, OR a reported case of a `sequential` / `rolling` task being claimed or worked out of order. **Sharpened at the 2026-05-17 longrun human-in-loop review: this MUST be resolved before Sprint 15.6 (the GUI makes the board interactively usable) OR before any production multi-agent self-serve run off the board — whichever comes first.**
- **Estimated size:** M — `claimTask` checks the `depends_on` predecessors' status for a `sequential` task (reject or queue the claim until every predecessor is `completed`); a `rolling` consumer gates on the upstream output artifact being `baselined`; per-topology tests.
- **Priority:** LOW — `parallel` (the common case) needs no enforcement; `sequential` / `rolling` producers currently rely on coordinator discipline, and the event log makes any out-of-order work auditable after the fact.
- **Session deferred:** 2026-05-17
- **Sessions open:** 3
- **Status:** RESOLVED — Sprint 15.7 (2026-05-20): claimTask topology enforcement on sequential
  (all depends_on must be `completed`) + rolling (upstream artifact must be `baselined`); parallel
  unchanged. Plus the closing-recovery half — sweepStuckClosingTopics scans topics in 'closing'
  whose most recent `topic.closing` event is > 5 minutes old, calls closeTopic with a 60s
  statement_timeout, capped at 10 topics per cycle (REVIEW-CODE F2). 6 topology tests
  (AC15–AC19) + 2 recovery-sweep tests (AC11, AC12). New error statuses: `unmet_dependencies`,
  `upstream_not_baselined`.
- **Source:** Phase 15 Sprint 15.2 CLARIFY out-of-scope (`docs/specs/2026-05-16-phase-15-sprint-15.2-clarify.md`); re-flagged by QC (`docs/audit/sprint-15.2-qc-ac-coverage.md`) + POST-REVIEW Scope Guard (`docs/audit/findings-sprint-15.2-post-review.md`).

---

## DEFERRED-010

- **What:** `replayEvents` (`src/services/coordinationEvents.ts`) caps results at `DEFAULT_REPLAY_LIMIT=1000` with no real pagination API beyond `next_cursor`. `joinTopic`'s induction pack uses `replayEvents`, so on a topic with >1000 events past the cursor a fresh joiner's pack `events` is the oldest 1000 and omits the joiner's own just-emitted `topic.actor_joined`; `your_cursor` is the high-water of that prefix and the agent must continue via `replay_topic_events` to fully re-prime. The behaviour is correct cursor semantics, but the first-pack ergonomics on a large topic are poor.
- **Why deferred:** REVIEW-CODE r1 finding 1 (WARN). Sprint 15.1 topics are small (only `topic.chartered`/`actor_joined`/`closed` events — a topic would need >1000 joins to hit the cap), so it is latent, not reachable. The design §3.2/§E already flag pagination as a future concern. A real paginated-pack API (or a fresh-joiner "tail" mode) is its own small design. The §9.8 coherence invariant was corrected (design rev 5) to describe the cursor-continuation contract honestly.
- **Trigger condition:** Phase 15 Sprint 15.2 (the Board adds `task.*`/`artifact.*`/`claim.*` events — topics will accrue many events), OR a reported case of an induction pack missing recent events.
- **Estimated size:** M — a paginated induction-pack API or a tail-mode read for fresh joiners; expose `has_more` / pagination in the pack.
- **Priority:** LOW
- **Session deferred:** 2026-05-16
- **Sessions open:** 1
- **Status:** RESOLVED — Sprint 15.12 (2026-05-21): `replayEvents` gains a `tail` mode
  (most-recent N events, `ORDER BY seq DESC LIMIT N` re-sorted ASC; `has_more` via
  `EXISTS(seq < min)` — no full COUNT). `joinTopic`'s FRESH-join (since_seq=0) induction
  pack uses tail mode so a joiner on a >N-event topic gets recent context incl. their own
  `topic.actor_joined`, with `your_cursor` = max seq (primed to HEAD). A re-prime
  (since_seq>0) keeps the forward cursor-continuation contract. 3 tail tests + a fresh-join
  induction-pack test.
- **Source:** Phase 15 Sprint 15.1 REVIEW-CODE r1, finding 1 (`docs/audit/findings-sprint-15.1-code-r1.md`).

---

## DEFERRED-009

- **What:** Phase 15 Sprint 15.1 topic operations — `getTopic`/`joinTopic`/`closeTopic` (`src/services/topics.ts`), `replayEvents` (`coordinationEvents.ts`), the `/api/topics/*` REST routes, and the 5 MCP tools — operate purely by the global `topic_id` PK with **no project-scope check**. A `writer`-role bearer token issued for project A can `POST /api/topics/<project-B-topic-id>/close` and irreversibly seal project B's coordination log — or join/read it — by `topic_id` alone. `closeTopic` is the destructive path.
- **Why deferred:** REVIEW-CODE r1 finding 2 (WARN). Same class as DEFERRED-004 (codebase-wide tenant-enforcement audit of writer-role handlers). The Phase 15 design deliberately punted authorization (design §4.4 defers level-based authz) and the REST surface is intentionally top-level (`topic_id` is a global PK — a design decision). Dev runs `MCP_AUTH_ENABLED=false`, so no caller-project context exists yet. `topic_id` is a UUID (not guessable). A proper fix belongs in a coherent Phase 15 authorization pass (the actor/level model's enforcement), not a 15.1 bolt-on.
- **Trigger condition:** a Phase 15 sprint that introduces topic-level authorization, OR `MCP_AUTH_ENABLED=true` adopted in a real deployment, OR a dedicated security-audit sprint.
- **Estimated size:** M — every topic operation loads `topics.project_id` and rejects with `NOT_FOUND` (to avoid id-probing) when it does not match the caller's resolved project scope (`req.apiKeyScope`); at minimum for the destructive `closeTopic`. A `requireTopicScope`-style middleware or service-layer guard, plus tests.
- **Priority:** MED — exploitable only with `MCP_AUTH_ENABLED=true` plus a leaked or logged `topic_id`.
- **Session deferred:** 2026-05-16
- **Sessions open:** 1
- **Status:** RESOLVED — Sprint 15.12 (2026-05-21): tenant-scope enforcement.
  New `requireResourceScope(entity)` middleware (8 resolvers — topic/request/motion/dispute/
  intake/body/task/artifact — each loads the owning `project_id` and compares to
  `req.apiKeyScope`; cross-tenant + unknown → 404 NOT_FOUND, no existence oracle) +
  `requireBodyProjectScope` (create routes with project_id in body — injects the key's scope
  on omission, no DEFAULT_PROJECT_ID escape) + `requireBodyTopicScope` (openDispute's
  body.topic_id). Applied across topics/board/requests/motions/disputes/intake routes
  (complete coverage per CLARIFY Q1, incl. indirect entity-derived scope). Auth-off /
  global-scope → unrestricted (dev posture preserved). Light tenant-isolation security
  checklist CLEAR. MCP path (unscoped workspace token, single operator) out of scope.
- **Source:** Phase 15 Sprint 15.1 REVIEW-CODE r1, finding 2 (`docs/audit/findings-sprint-15.1-code-r1.md`).

---

## DEFERRED-008

- **What:** Phase 11 knowledge-bundle export/import does not carry the `lesson_types.scope` column added by migration `0052_unify_lesson_types.sql`. `exportProject.ts:127` selects an explicit column list (`type_key, display_name, description, color, template, is_builtin, created_at`) that omits `scope`; `importProject.ts:464` INSERTs the same explicit list. Net effect: `scope` is dropped on export, and every imported `lesson_types` row lands as `scope='global'` via the migration 0052 column default — a source `scope='profile'` type silently becomes a global type on the destination instance, leaking it into the global registry for all projects there. Related: the `taxonomy_profiles` table is not in the bundle entry list at all (pre-existing Phase 13 gap), so profile-scoped types do not round-trip meaningfully even setting `scope` aside.
- **Why deferred:** Surfaced by the phase-13 bug-fix `/review-impl` pass (Finding 3, LOW) as an out-of-scope adjacent gap — the SS2 type-system unification introduced the `scope` column; updating the Phase 11 exchange path to carry it is a separate change with its own test surface. LOW because cross-instance export/import is opt-in, the `global` default keeps imported types functional (just mis-categorized), and profile-scoped types are independently re-seeded from `config/taxonomy-profiles/*.json` on a fresh instance.
- **Trigger condition:** Next sprint that touches `src/services/exchange/*` OR a user report that a cross-instance import lost taxonomy-profile type classification.
- **Estimated size:** S-M — add `scope` to the export SELECT + import INSERT/UPDATE + conflict-check SELECT; decide whether to add `taxonomy_profiles` as a new bundle entity (the M part); extend `bundleFormat.test.ts` + the import e2e suite.
- **Priority:** LOW
- **Session deferred:** 2026-05-15
- **Sessions open:** 1
- **Status:** RESOLVED — 2026-05-21 (`fix-exchange-scope-deferred-008`): the scope-LEAK
  fixed. `exportProject` lesson_types SELECT now includes `scope`; `importProject`
  INSERT (create) + UPDATE (overwrite) persist `scope` via a `normalizeScope` helper
  that defaults a pre-fix bundle (no `scope` field) or a malformed value to `'global'`
  (prior behavior + no CHECK violation). A `scope='profile'` type now round-trips as
  'profile' instead of silently becoming 'global' on the destination's global registry.
  4 round-trip tests (AC1 export carries scope; AC4 profile + global round-trip; AC5
  pre-fix bundle defaults global). The `taxonomy_profiles`-as-bundle-entity round-trip
  (the "related" gap) is split out to DEFERRED-023.
- **Source:** phase-13 bug-fix `/review-impl` review (commit 00acfa4), Finding 3.

---

## DEFERRED-007

- **What:** MCP tool calls that use `z.discriminatedUnion` in their `outputSchema` return error `"Cannot read properties of undefined (reading '_zod')"` to the client, even when the underlying handler executed successfully and the side effects landed. Confirmed affects: `claim_artifact`, `check_artifact_availability`, `renew_artifact`, `submit_for_review` (and any Phase 13 tool using discriminated-union output).
- **Why deferred:** Latent regression — these tools' tests pass at the service level (bypass HTTP/MCP transport) and `tools/list` returns them correctly, so the issue was invisible until Sprint 13.4's end-to-end smoke directly invoked `tools/call`.
- **Status:** RESOLVED 2026-05-15 (longrun session 3, Sprint 13.7 Part D)
- **Resolution:** Root cause found in `node_modules/@modelcontextprotocol/sdk/dist/cjs/server/zod-compat.js:114-156` — `normalizeObjectSchema` only handles `def.type === 'object'` for zod-v4 schemas. ZodDiscriminatedUnion has `def.type === 'union'` (not 'object'), so the function returns `undefined`, and the SDK's output-validation path crashes on the subsequent property access. The cleanest fix without upstream SDK patches is to flatten the discriminated union outputs to a plain `z.object` with optional/nullable fields keyed on a `z.enum` status. Applied in commit (Sprint 13.7) to 4 tools: claim_artifact, renew_artifact, check_artifact_availability, submit_for_review. Verified live via curl: `check_artifact_availability` now returns `structuredContent: {"available": true}` cleanly with no _zod error. Regression guard added in `test/e2e/api/phase13-mcp.test.ts`.
- **Source:** Sprint 13.4 deploy-state smoke discovered the regression; Sprint 13.7 Part D fixed.

---

## DEFERRED-006

- **What:** Integration-level smoke verification of `requireScope` 403 path under `MCP_AUTH_ENABLED=true`.
- **Status:** RESOLVED 2026-05-15 (longrun session 3, Sprint 13.7 Part B)
- **Resolution:** Shipped `docker-compose.auth-test.yml` (override that sets MCP_AUTH_ENABLED=true for mcp + worker services) + 6 e2e test cases in `test/e2e/api/phase13-auth-scope.test.ts` covering: env_token /api/me shape, db_key /api/me shape with scope, in-scope admin force-release (200), cross-tenant admin force-release blocked by requireScope (403 — the actual DEFERRED-006 closure), cross-tenant writer blocked by requireRole (403 — regression guard), mismatched body.owner_project_id on taxonomy create (403). Tests SKIP gracefully when auth not enabled. Helper updates: `createTestApiKey` accepts `project_scope`, `E2E_PROJECT_ID_B` added to constants. To run the full smoke: `docker compose -f docker-compose.yml -f docker-compose.auth-test.yml up -d mcp worker && npm run test:e2e:api`. The 6 cases ship code-validated (tsc clean) and run as opt-in via the override.

---

## DEFERRED-005

- **What:** GUI production build (`npm run build` AND `docker compose up -d --build gui`) fails on Geist font resolution: `Module not found: Can't resolve '@vercel/turbopack-next/internal/font/google/font'` from `[next]/internal/font/google/geist_*.module.css`. Affects Next.js 16.2.1 + Turbopack default build path. Reproduced 2026-05-15 during Sprint 13.2 POST-REVIEW deploy-state smoke.
- **Why deferred:** Pre-existing issue (the running gui container at 4h uptime predates this regression). Sprint 13.2's tsc check is clean and the new code follows existing component patterns. Fixing the Geist resolution is a Next.js / Turbopack dependency issue outside Sprint 13.2's scope.
- **Trigger condition:** Next planned GUI work that requires a fresh container build (e.g., Sprint 13.4 or 13.6 in the current Phase 13 longrun); OR any urgent GUI hotfix that needs a deploy.
- **Estimated size:** S-M (likely a `next` version pin, font module installation, or Turbopack opt-out config flag).
- **Priority:** MED — blocks GUI deploys; running container survives but won't pick up Sprint 13.2's ActiveWorkPanel until resolved. The Sprint 13.2 backend ships fine (sweep, /api/me, requireScope all live).
- **Session deferred:** 2026-05-15
- **Sessions open:** 1
- **Status:** RESOLVED 2026-05-15 (longrun session 2 start)
- **Source:** Sprint 13.2 POST-REVIEW deploy-state smoke (Mitigation B step F1) discovered local AND docker GUI builds both fail with identical error.
- **Resolution:** Root cause was `next/font/google` requiring network access to fonts.gstatic.com at build time; the build host couldn't reach it (firewall/proxy). Replaced `next/font/google` with the official `geist` npm package (v1.7.0) which ships the font files locally. Updated `gui/src/app/layout.tsx`: import `GeistSans`/`GeistMono` from `geist/font/sans` and `geist/font/mono` respectively. Build now succeeds (24 routes prerendered). GUI container rebuilt + redeployed; Sprint 13.2's ActiveWorkPanel verified live in browser via curl on /agents.

---

## DEFERRED-004

- **What:** Backend tenant-scope enforcement on admin-role endpoints.
- **Status:** RESOLVED 2026-05-21 (see full closure note at the end of this entry). The
  PARTIAL → RESOLVED history is preserved below for context.
- **Phase 13 progress:**
  - Sprint 13.2 (commit 416e48b): created `requireScope` middleware + applied to `DELETE /api/projects/:id/artifact-leases/:leaseId/force`.
  - Sprint 13.5 (commit 47954d1): applied `requireScope('id')` to `POST /api/projects/:id/taxonomy-profile/activate` and `DELETE /api/projects/:id/taxonomy-profile`; added inline body.owner_project_id scope-check on `POST /api/taxonomy-profiles`.
- **Sprint 13.7 audit findings:**
  - `/api/lesson-types` (requireRole('admin') only) — global admin route for managing custom lesson types across all projects; no `:id` URL param. Project-scoped admins can manage types globally per current design. Decision: keep global (custom lesson types are a server-wide concern in this codebase).
  - `/api/api-keys` (requireRole('admin') only) — global admin route for key management; per design, admin tokens manage keys for any project. Decision: keep global (matches the documented role design where admin tokens are global by definition).
  - `/api/git`, `/api/jobs`, `/api/workspace`, `/api/chat`, `/api/documents`, `/api/learning-paths`, `/api/groups` (writer+) — none have `:id` URL params at mount; route handlers read project_id from query/body. Service-layer enforcement should verify apiKeyScope against the body's project_id where applicable, but this is per-handler work outside the route-mount layer. Decision: deferred to a follow-up sprint that audits each service handler.
- **Remaining scope:** Service-layer audit of every writer-role handler that takes a `project_id` body/query param to verify it filters by `req.apiKeyScope`. This is ~7 service modules and is a larger audit than Sprint 13.7 budget allows.
- **Trigger condition:** Dedicated security-audit sprint OR external pen-test report.
- **Priority:** MED — exploitable but only by misconfigured project-scoped admin keys.
- **Sprint 13.7 closure decision:** mark as PARTIAL with explicit decisions for each top-level admin mount documented above. The remaining service-handler audit is acceptable as a follow-up because (a) the most exploitable routes (force-release, taxonomy activation) are already closed, (b) the global admin routes are global-by-design, (c) the writer-role routes require explicit per-handler audit that doesn't fit a single sprint.
- **Status:** RESOLVED — 2026-05-21 (`tenant-scope-audit-deferred-004`): the writer-role
  service-handler audit shipped. New `requireProjectScope(source, {multi})` middleware
  (strict-reject: a scoped key must declare a project equal to its scope; absent → 400
  `project_scope_required`, cross-tenant → 404, multi out-of-scope → 404) for COLLECTION
  routes; `requireResourceScope` extended with `document`/`learning_path`/`conversation`
  resolvers for RESOURCE-`:id` routes (DERIVE the project from the id — REVIEW-DESIGN F1:
  a declared project_id is bypassable by a cross-tenant resource id). Applied across
  git/jobs/workspace/chat/chatHistory/documents/learningPaths/projectGroups (~45 routes).
  Auth-off / global-scope → unrestricted (dev posture; 711-test baseline preserved). 10
  new D004 middleware tests. The global admin routes (lesson-types, api-keys) remain
  global-by-design (13.7 decisions). `POST /api/jobs/run-next` cross-project pop is split
  to a new Tier-2 deferred (scheduling-semantics service change). Light tenant-isolation
  security checklist CLEAR.

---

## DEFERRED-003

- **What:** `race_exhausted` code path in `src/services/artifactLeases.ts:74-82` (claimArtifact retry loop) is not covered by unit tests. The path triggers when two concurrent 23505-race winners both expire microseconds before our re-SELECT — statistically near-unhittable under MAX_TTL=240min defaults.
- **Why deferred:** Test would require deterministic control over Postgres transaction commit timing + system clock manipulation. Disproportionate setup cost for a near-unhittable rare path. Sprint 13.7 (E2E suite) can stress-test with synthetic short TTLs (e.g., 1-second leases) where the race window is naturally wider.
- **Trigger condition:** Sprint 13.7 E2E test design. OR: production observability shows the path firing (we'd log it via `logger.warn` for visibility).
- **Estimated size:** S (test scaffolding + 1 test)
- **Priority:** LOW
- **Session deferred:** 2026-05-15
- **Sessions open:** 1
- **Status:** RESOLVED 2026-05-23 — the retry loop was extracted from `claimArtifact` into an
  exported, injectable seam `_claimWithRetry(p, once=_claimArtifactOnce)`. Production behavior is
  unchanged (default `once` = the real `_claimArtifactOnce`); the loop, `setImmediate` backoff, and
  `race_exhausted` return are identical. The full real-DB integration race is genuinely
  non-deterministic (step-1 lazy DELETE cleans the expired incumbent before any retry can re-observe
  it; forcing it with a competing connection deadlocks on the claim's uncommitted DELETE), so a
  deterministic unit test of the loop is the pragmatic resolution the original defer note anticipated.
  3 DB-free tests in `artifactLeases.test.ts`: all-retry → `race_exhausted` (asserts exactly 2 `once`
  invocations, pinned to `MAX_INTERNAL_RACE_RETRIES=1`); retry-then-claim → `claimed`; terminal-first
  → no retry. 723/723 green; no migration. Branch=race-exhausted-coverage-deferred-003.
- **Source:** Sprint 13.1 post-audit (`docs/audit/sprint-13.1-residuals.md` R5); design review r2 acknowledged "exceedingly rare" but didn't write a deferred entry.

---


## DEFERRED-001

- **What:** Phase 14 — Per-project embedding/distillation model routing. Add `embedding_model` and `distillation_model` columns to `project_sources` (or new `project_model_config` table). Modify `src/services/embeddings.ts` and chat-model callers to select model from project config.
- **Why deferred:** ~~Out of Phase 13 scope; user chose option C (Phase 14 defer).~~
- **Trigger condition:** N/A
- **Estimated size:** L
- **Priority:** N/A
- **Session deferred:** 2026-05-14
- **Sessions open:** 1
- **Status:** ABANDONED
- **Abandon reason:** Session 2026-05-14 (same day) — user reconsidered and chose **global swap pattern** instead of per-project routing. Quote: "tôi đề nghĩ chúng ta nên làm phase 14 trước luôn vì nó không tốn nhiều time ... chúng ta sẽ chuyển hoàn toàn qua nvidia/nemotron-3-nano, text-embedding-bge-m3". Per-project routing complexity not needed; both projects move together to the new model stack. The new Phase 14 scope is documented as an active spec (see `docs/specs/2026-05-14-phase-14-model-swap-spec.md`), not a deferred item.
- **Source:** Session 2026-05-14 — initial decision then reversed within same session.

---

## DEFERRED-002

- **What:** `mxbai-embed-large-v1` has 512-token context window. With `CHUNK_LINES=120` (~600-1000 tokens/chunk), code chunks routinely get truncated. LM Studio logs confirm: "Number of tokens in input string (634) exceeds model context length (512). Truncating to 512 tokens." Also: "tokenizer.ggml.add_eos_token should be set to 'true' in the GGUF header." This means Phase 12 measurement work (sprints 12.1c through 12.1h) was conducted on systematically truncated embeddings. Baselines in `docs/qc/baselines/*` reflect degraded vectors, not the embedding model's full capability.
- **Why deferred:** Resolution requires model swap to `bge-m3` (8192 ctx, same 1024-dim). Resolution path now active via Phase 14 (global swap pattern). Item kept OPEN until Phase 14 actually ships and bge-m3 is in production for both `free-context-hub` and `phase-13-coordination` projects.
- **Trigger condition:** Phase 14 ships (`.env` updated to `EMBEDDINGS_MODEL=text-embedding-bge-m3`, `reembedAll` script run against both projects, smoke test confirms search quality is intact). At that point Scribe sets Status to RESOLVED with sprint reference.
- **Estimated size:** M (re-embed in place; preserves all data)
- **Priority:** MED
- **Session deferred:** 2026-05-14
- **Sessions open:** 1
- **Status:** RESOLVED
- **Resolved at:** 2026-05-15
- **Resolved by:** Phase 14 model swap (commits TBD — pending session close). `.env` switched to `EMBEDDINGS_MODEL=text-embedding-bge-m3` (8192 ctx, same 1024 dim). `src/scripts/reembedAll.ts` ran against both projects: free-context-hub (2069 chunks + 638 lessons + 11 document_chunks all OK) and phase-13-coordination (3334 chunks + 2 lessons + 0 document_chunks all OK). Smoke tests pass for search_lessons / search_code_tiered / reflect / add_lesson distillation. The 512-token truncation that systematically degraded Phase 12 measurement work is now eliminated — bge-m3's 8192-token context window covers our 120-line chunks (~600-1000 tokens) with margin.
- **Source:** Session 2026-05-14 — user message with LM Studio log + mxbai-embed-large-v1 model name. Resolution active via Phase 14.

---
