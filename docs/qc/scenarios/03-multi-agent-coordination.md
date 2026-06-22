# Multi-Agent Coordination — Production Scenarios

Scenarios that exercise the **Coordination**, **Governance & Decisions**, and
**Access Control** primitives when 2+ actors (AI agents and humans) share one
project. They are written to drive E2E/integration tests later, so each names the
real MCP tools and REST endpoints, the precondition state, the ordered steps, and
the observable pass/fail outcome — with explicit attention to who is **allowed** vs
**blocked** and why.

**Grounding (real primitives only):**
- `docs/features/06-coordination.md` — topics, board, claims, fencing tokens,
  artifact leasing.
- `docs/features/07-governance-decisions.md` — requests/DoA, motions/voting,
  intake, disputes, review queue.
- `docs/features/08-access-control-identity.md` — principals, grants, scope.
- `docs/phase-15-design.md` — fencing + claim-liveness contract (C.2), abandoned-claim
  and stalled-step sweep recovery (C.4), motion/tally/veto atomicity (B.6/C.2),
  drain-on-close (C.2/C.4), derived artifact identity (B.5).

**Key invariants under test (from the design):**
- Artifact identity is **derived** `(topic, task, slot)` — actors cannot diverge on it.
- A `PUT`/`write_artifact` must present **a live claim AND a fencing token ≥
  `accepted_fencing_token`** — *both*, atomically. Token alone is insufficient (it
  guards against a superseding holder, not against your own claim having expired).
- `cast_vote`, `tally_motion`, `veto_motion` are **mutually exclusive** on the
  motion row — first to flip `status` out of `balloting` wins; losers see 0 rows.
- Quorum/threshold sum `votes.weight` over **principal** rows (one per member);
  `proxy_for` records who *cast* but does not double-count.
- `close_topic` freezes the board and **drains** in-flight items to terminal; the
  drain set only shrinks (provably terminating).
- Every state change emits a `coordination_events` row; nothing is destructively
  deleted; a `closed` topic's log is sealed.

**Priority key:** P0 = core contract / data-integrity / security (must pass before
ship). P1 = important flows + most race/edge cases. P2 = recovery, ergonomics,
secondary edges.

---

### SCN-COORD-01 — Charter, join, and replay-based re-prime
- **Priority:** P0
- **Area:** Coordination
- **Actors:** Agent A (coordination), Agent B (execution, ephemeral)
- **Surfaces:** MCP `charter_topic`, `join_topic`, `post_task`, `replay_topic_events`, `get_topic`; REST `POST /api/topics`, `POST /api/topics/:id/join`, `GET /api/topics/:id/events?since=:seq`
- **Preconditions:** Project `free-context-hub` exists; A and B authenticated as distinct principals in the same tenant scope.
- **Steps:**
  1. Agent A: `charter_topic(name, charter)` → topic T.
  2. Agent A: `join_topic(T)` at coordination level; `post_task(T, …)` for two tasks.
  3. Agent B: `join_topic(T)` → receives induction pack (charter, roster, board, open requests, event log cursor).
  4. Agent B disbands; a fresh Agent B' `join_topic(T)` then `replay_topic_events(T, since=0)`.
- **Expected:**
  - Join auto-registers B in `actors` for the project (first join).
  - Induction pack lists both posted tasks and current roster; B re-primes with no file scan.
  - Replay returns events in `seq` order (`topic.chartered`, `topic.actor_joined`×, `task.posted`×) and tolerates seq gaps (an aborted txn burns a seq — replay treats cursor as high-water mark, never waits for a missing seq).
- **Watch for (bug/UX risks):** replay blocking on a missing seq; induction pack leaking tasks/events from another topic or tenant; actor row not created on first join; cursor off-by-one (re-delivering or skipping the boundary event).

---

### SCN-COORD-02 — Derived artifact identity cannot diverge
- **Priority:** P0
- **Area:** Coordination
- **Actors:** Agent A (execution), Agent B (execution)
- **Surfaces:** MCP `post_task`, `list_board`, `claim_task`, `write_artifact`
- **Preconditions:** Topic T active; one task posted with a declared output slot.
- **Steps:**
  1. Agent A: `post_task(T, title, slot="finding")` → task creates output artifact with derived id `<T>/<task>/finding`.
  2. Agent A and Agent B each `list_board(T)` and read the artifact id off the task.
  3. Both intend to write "the finding" — neither invents the id string.
- **Expected:**
  - Both see the identical derived `artifact_id`; there is exactly one artifact for the slot.
  - This is the structural fix for Run 1's #1 gap — two actors meaning the same artifact converge on identity instead of each creating a private free-text id.
- **Watch for (bug/UX risks):** any path that still accepts a caller-supplied `artifact_id` (free-text regression); slot collision producing two artifacts; id scheme not URL-safe / exceeding length bounds.

---

### SCN-COORD-03 — Two agents claim the same task (claim arbitration)
- **Priority:** P0
- **Area:** Coordination
- **Actors:** Agent A (execution), Agent B (execution)
- **Surfaces:** MCP `claim_task`, `list_board`; REST `POST /api/topics/:id/tasks/:taskId/claim`
- **Preconditions:** Topic T active; one unclaimed task on the board.
- **Steps:**
  1. Agent A and Agent B both call `claim_task(task)` as close to simultaneously as the harness allows.
- **Expected:**
  - Exactly **one** caller gets `{ status: "claimed", claim_id, fencing_token, expires_at }`.
  - The other gets `{ status: "conflict", conflict: { holder: <winner identity> } }` — never a 500, never a second lease.
  - Winner's `fencing_token` is from the global monotonic sequence; a `task.claimed` event is appended; a `claim.conflict` event records the loser.
  - The one-active-lease-per-artifact invariant holds (single row in `claims_active_uniq`).
- **Watch for (bug/UX risks):** double-claim (both succeed) under race; 23505 surfacing as a 500 instead of being caught and re-classified; loser receiving no holder identity; conflict not distinguishing "still-active" vs "expired-but-uncleaned" race.

---

### SCN-COORD-04 — Stale fencing token write is rejected
- **Priority:** P0
- **Area:** Coordination
- **Actors:** Agent A (first claimant), Agent B (later claimant)
- **Surfaces:** MCP `claim_task`, `write_artifact`, `release_task`
- **Preconditions:** Topic T active; task with output slot; Agent A holds the claim (token = N).
- **Steps:**
  1. Agent A: `claim_task` → token N. A stalls (does not write yet).
  2. A's claim is released/expired; Agent B: `claim_task` → token M (M > N, global monotonic).
  3. Agent A wakes and `write_artifact(artifact, claim_id=A, fencing_token=N, content)`.
  4. Agent B: `write_artifact(artifact, claim_id=B, fencing_token=M, content)`.
- **Expected:**
  - A's late write is **rejected** `{ status: "conflict" }` — its token N < current `accepted_fencing_token` (B already advanced it) OR its claim is no longer live.
  - B's write succeeds; `accepted_fencing_token` set to M; `artifact.versioned` emitted.
  - The classic lost-update is prevented (Lamport/Kleppmann fencing semantics).
- **Watch for (bug/UX risks):** **fencing bypass** — accepting a lower token; checking token but not in the same atomic statement; allowing the write because the *content* differs; `accepted_fencing_token` accidentally reset by a sweep (must stay monotonic).

---

### SCN-COORD-05 — Live claim required even when fencing token is highest (slow-claimant-after-sweep)
- **Priority:** P0
- **Area:** Coordination
- **Actors:** Agent A (claimant whose claim expired), background sweep
- **Surfaces:** MCP `claim_task`, `write_artifact`; sweep job (`leases.sweep`/abandoned-claim)
- **Preconditions:** Topic T active; Agent A holds claim with token N; **no successor claimant yet**.
- **Steps:**
  1. Agent A: `claim_task` → token N; A stalls past `expires_at`.
  2. Sweep runs: emits `claim.expired`, returns task `→ posted`, reverts artifact to last baseline/draft. **No one re-claims yet**, so `accepted_fencing_token` is unchanged (still ≤ N).
  3. Agent A wakes and `write_artifact(claim_id=A, fencing_token=N)` — its token is still the highest the artifact has seen.
- **Expected:**
  - The write is **rejected** because the **live-claim** check fails (A's `claim_id` no longer references a row with `now() < expires_at`), even though the fencing-token comparison alone would pass.
  - This is the exact window the design calls out: token guards against a *superseding* holder, not against *your own claim having expired with no successor*.
- **Watch for (bug/UX risks):** the most subtle fencing bypass — token-only check letting a swept-out claimant write; live-claim and token checks not evaluated atomically in one statement.

---

### SCN-COORD-06 — Abandoned-claim sweep returns task and reverts artifact to last baseline
- **Priority:** P1
- **Area:** Coordination
- **Actors:** Agent A (disbands mid-task), Agent B (picks up after)
- **Surfaces:** MCP `claim_task`, `write_artifact`, `baseline_artifact`, `list_board`, `replay_topic_events`
- **Preconditions:** Topic T active; task with output slot; rolling/sequential downstream consumer may exist.
- **Steps:**
  1. Agent A: `claim_task`; `write_artifact` (draft→working); `baseline_artifact` (v1 baselined); `write_artifact` again (working, unbaselined edits on top of v1).
  2. Agent A disbands without completing; claim passes `expires_at`.
  3. Sweep runs.
  4. Agent B: `list_board(T)` and `claim_task` the same task.
- **Expected:**
  - Sweep emits `claim.expired` + `task.released`; task returns to `posted`.
  - Artifact is reset to its **last baselined version** (v1) — the post-baseline working edits are discarded, content_ref repointed to v1's payload; the revert **appends an `artifact_versions` row** ("reverted to v1"), never an in-place edit.
  - Sweep **never un-baselines** — a downstream rolling consumer that already pulled v1 is preserved.
  - `accepted_fencing_token` left unchanged (monotonic).
  - Agent B claims cleanly with a strictly higher token.
- **Watch for (bug/UX risks):** sweep destroying the baseline; revert done in place (history gap); task wedged in `claimed` forever; sweep encountering a `for_review` artifact (it never should — claim is released at `for_review`).

---

### SCN-COORD-07 — Artifact leasing collision (claim_artifact / check_artifact_availability)
- **Priority:** P0
- **Area:** Coordination
- **Actors:** Agent A, Agent B (both want the same artifact outside the board)
- **Surfaces:** MCP `claim_artifact`, `check_artifact_availability`, `list_active_claims`, `release_artifact`; REST `/api/projects/:id/artifact-leases`
- **Preconditions:** An artifact (e.g. a lesson/document) not currently leased.
- **Steps:**
  1. Agent A: `claim_artifact(artifact_type, artifact_id)` → lease granted with TTL.
  2. Agent B: `check_artifact_availability(same tuple)` → reports leased-by-A.
  3. Agent B: `claim_artifact(same tuple)` anyway.
  4. Agent A: `release_artifact`; Agent B retries `claim_artifact`.
- **Expected:**
  - Step 1 → granted; step 3 → `conflict` with A as incumbent (one-active-lease-per-artifact).
  - `list_active_claims(project)` shows exactly A's lease while held.
  - After A releases, B's retry succeeds.
- **Watch for (bug/UX risks):** TOCTOU between `check` and `claim` (check is advisory only — never gate a write on it); two leases on the identical tuple; `list_active_claims` leaking leases from another project/tenant.

---

### SCN-COORD-08 — Renew lease vs cap; expired lease is sweepable
- **Priority:** P2
- **Area:** Coordination
- **Actors:** Agent A (long-running), Agent B (waiting)
- **Surfaces:** MCP `claim_artifact`, `renew_artifact`, `check_artifact_availability`, `list_active_claims`
- **Preconditions:** Renewal cap configured; Agent A holds a lease.
- **Steps:**
  1. Agent A: `renew_artifact` repeatedly before TTL to extend.
  2. Continue renewing past the renewal cap.
  3. Let the lease lapse without renewal; Agent B `check_artifact_availability` then `claim_artifact`.
- **Expected:**
  - Renewals before the cap succeed and push `expires_at` out (capped — design says renewals are "capped").
  - A renewal beyond the cap is refused (or clamped) — A cannot hold indefinitely.
  - After lapse, the lease is swept/treated as inactive and B can claim.
- **Watch for (bug/UX risks):** unbounded renewal (starvation of B); renewing a lease the caller doesn't hold; renew succeeding on an already-expired lease (should require re-claim).

---

### SCN-COORD-09 — Rolling handoff: downstream consumes only a baselined upstream
- **Priority:** P1
- **Area:** Coordination
- **Actors:** Agent A (upstream producer), Agent B (downstream consumer)
- **Surfaces:** MCP `post_task`, `claim_task`, `write_artifact`, `baseline_artifact`, `list_board`
- **Preconditions:** Topic T active; task B `depends_on` task A; topology = rolling.
- **Steps:**
  1. Agent A: claim task A, `write_artifact` (draft/working) — not yet baselined.
  2. Agent B: claim task B, attempt to consume A's output while it is still `draft`/`working`.
  3. Agent A: `baseline_artifact` (v1 baselined).
  4. Agent B: consume the baselined increment.
- **Expected:**
  - Step 2 must NOT expose unbaselined upstream content as a valid handoff input (rolling = consume on `baselined`, not on `draft`).
  - After step 3, B consumes v1; an `artifact.state_changed` (→ baselined) event marks the handoff boundary.
- **Watch for (bug/UX risks):** downstream reading uncommitted draft; baseline state not enforced at the handoff; sequential ordering guarantee lost when overlapping.

---

### SCN-COORD-10 — Multi-level approval through a DoA route (escalate-to-authority)
- **Priority:** P0
- **Area:** Governance & Decisions
- **Actors:** Agent A (submitter, execution), Human C (coordination approver), Human D (authority approver)
- **Surfaces:** MCP `submit_request`, `decide_request_step`, `get_request`, `list_requests`; REST `POST /api/topics/:id/requests`, `POST /api/requests/:id/steps/:n/decide`
- **Preconditions:** Topic T active; DoA matrix defines a route where the decision weight climbs Coordination → Authority; C staffs coordination, D staffs authority.
- **Steps:**
  1. Agent A: `submit_request(subject=artifact, procedure=…, route)` → request with ordered `request_steps`; each step records `target_office` + `doa_snapshot` frozen at submission.
  2. Human C: `decide_request_step(req, step=0, endorse)` → endorse-and-forward.
  3. Human D: `decide_request_step(req, step=1, endorse)` → final endorsement.
- **Expected:**
  - Request resolves `approved` only after the last required step endorses.
  - `request.step_decided` per step; `request.resolved` at the end; a chaining handler posts a new board task ("execute the approved outcome").
  - `decided_by` is the officeholder resolved **at decision time**, while route *rules* (`target_office`, `doa_snapshot`) stay frozen from submission.
- **Watch for (bug/UX risks):** step decidable out of order; a non-officeholder deciding a step (scope leak); resolution chaining firing while topic is closing (should defer); request auto-approving with steps still pending.

---

### SCN-COORD-11 — Approver returns a request for revision, then re-submit
- **Priority:** P1
- **Area:** Governance & Decisions
- **Actors:** Agent A (submitter), Human C (approver)
- **Surfaces:** MCP `submit_request`, `decide_request_step`, `get_request`
- **Preconditions:** Topic T active; single-step route to C.
- **Steps:**
  1. Agent A: `submit_request`.
  2. Human C: `decide_request_step(return)` → sends back for revision.
  3. Agent A: revise the artifact and `submit_request` again.
  4. Human C: `decide_request_step(endorse)`.
- **Expected:**
  - `return` sets the step `returned` and the request `returned` — it does **not** chain a new task.
  - Re-submission is a fresh request (new route snapshot); endorsement now resolves it.
- **Watch for (bug/UX risks):** returned request still chaining a task; revision allowed without a new submission; old (returned) request resurfacing as actionable.

---

### SCN-COORD-12 — Reject kills the request (no chaining)
- **Priority:** P1
- **Area:** Governance & Decisions
- **Actors:** Agent A (submitter), Human D (authority)
- **Surfaces:** MCP `submit_request`, `decide_request_step`, `get_request`
- **Preconditions:** Topic T active; route reaches authority D.
- **Steps:**
  1. Agent A: `submit_request`.
  2. Human D: `decide_request_step(reject)`.
- **Expected:**
  - Request → `rejected`, terminal; **no** "execute the outcome" task is chained.
  - `request.resolved` event records the rejection.
- **Watch for (bug/UX risks):** reject still posting an execution task; reject confused with return (return is revisable, reject is terminal).

---

### SCN-COORD-13 — Stalled approval step escalates (unstaffed office)
- **Priority:** P1
- **Area:** Governance & Decisions
- **Actors:** Agent A (submitter), (no officeholder staffing the target office), sweep
- **Surfaces:** MCP `submit_request`, `get_request`; stalled-step sweep
- **Preconditions:** Topic T active; route step targets an office currently **unstaffed**; step has a `deadline`.
- **Steps:**
  1. Agent A: `submit_request` with a route whose next office is unstaffed.
  2. The step's `deadline` passes with no decision.
  3. Sweep runs (possibly multiple ticks).
- **Expected:**
  - The pending step → `escalated`, emits `request.step_escalated`, re-targets **up one level** with a **fresh deadline** (one tier per sweep interval, not collapsing to dispute in one tick).
  - If already at the Authority tier, the step is **converted to a dispute** instead of escalating further.
  - The request never wedges on a vanished officeholder.
- **Watch for (bug/UX risks):** escalation skipping levels; re-targeted step inheriting the old (already-passed) deadline → instant collapse; escalation past authority looping instead of becoming a dispute; escalating a step that was already decided.

---

### SCN-COORD-14 — Motion carried by weighted vote with quorum
- **Priority:** P0
- **Area:** Governance & Decisions
- **Actors:** Agent A (proposer), Members B, C, D of a decision body (weighted)
- **Surfaces:** MCP `create_decision_body`, `add_body_member`, `propose_motion`, `second_motion`, `cast_vote`, `tally_motion`, `get_motion`; REST `/api/decision-bodies`, `/api/topics/:id/motions`
- **Preconditions:** Decision body with members B(weight 3), C(weight 2), D(weight 1); quorum = 4; threshold > 50% of participating weight.
- **Steps:**
  1. Agent A: `propose_motion(body, subject)`; member B `second_motion` → `seconded` → `balloting`.
  2. B `cast_vote(for)`, C `cast_vote(for)`, D `cast_vote(against)`.
  3. After deadline (or explicit) `tally_motion`.
- **Expected:**
  - Participating weight = 6 ≥ quorum 4 → valid.
  - For = 5, Against = 1 → carried.
  - Votes snapshot weight at cast time; `motion.tallied` event records the outcome; a carried motion chains a board task to execute the outcome.
- **Watch for (bug/UX risks):** **quorum miscount** (counting abstentions toward threshold base, or non-members voting); weight read from current body row instead of snapshot; tally counting a vote cast after the deadline.

---

### SCN-COORD-15 — Vote vs tally race (mutual exclusion on the motion row)
- **Priority:** P0
- **Area:** Governance & Decisions
- **Actors:** Member B (late voter), Chair A (tallying)
- **Surfaces:** MCP `cast_vote`, `tally_motion`, `get_motion`
- **Preconditions:** Motion in `balloting`, deadline imminent.
- **Steps:**
  1. Member B: `cast_vote(for)` fired at the same instant as
  2. Chair A: `tally_motion`.
- **Expected:**
  - The two are **mutually exclusive**: `tally_motion` first does an atomic `UPDATE … SET status WHERE status='balloting'`; whoever flips status wins.
  - If tally wins, the late `cast_vote` is **rejected** (motion no longer `balloting` / past deadline) and is **not** counted.
  - If the vote commits first, tally counts it. No vote is ever counted after the ballot closes.
- **Watch for (bug/UX risks):** **quorum/tally miscount** from a vote landing after status flip; non-atomic status update letting both proceed; deadline checked outside the vote-insert transaction.

---

### SCN-COORD-16 — Veto overrides an otherwise-carried motion (veto/tally atomicity)
- **Priority:** P0
- **Area:** Governance & Decisions
- **Actors:** Members B/C/D (vote for), Veto-holder E (golden share)
- **Surfaces:** MCP `propose_motion`, `second_motion`, `cast_vote`, `veto_motion`, `tally_motion`, `get_motion`
- **Preconditions:** Body lists E in `veto_holders`; motion would carry on the numbers.
- **Steps:**
  1. Motion proposed, seconded → `balloting`; B/C/D `cast_vote(for)` (supermajority).
  2. Veto-holder E: `veto_motion` while status is `balloting`.
  3. Someone calls `tally_motion`.
- **Expected:**
  - `veto_motion` performs an atomic `UPDATE … WHERE status='balloting'` → status `vetoed` (terminal), overriding the carried tally.
  - The subsequent `tally_motion` sees 0 rows affected and aborts (mutual exclusion) — a vetoed motion is not re-tallied to `carried`.
  - `motion.vetoed` emitted; **no** execution task is chained.
  - A non-veto-holder calling `veto_motion` is **blocked**.
- **Watch for (bug/UX risks):** veto modeled as a heavy `against` vote (defeated by supermajority — wrong); veto after the ballot closed succeeding; non-holder vetoing (scope leak); both veto and tally committing (double terminal state).

---

### SCN-COORD-17 — Proxy voting counts once, not twice
- **Priority:** P1
- **Area:** Governance & Decisions
- **Actors:** Member B (absent, grants proxy), Member C (proxy-holder), Member D
- **Surfaces:** MCP `grant_proxy`, `revoke_proxy`, `list_proxies`, `cast_vote`, `tally_motion`
- **Preconditions:** Body members B(2), C(2), D(1); B grants proxy to C for the motion's class.
- **Steps:**
  1. Member B: `grant_proxy(to=C)`.
  2. Member C: `cast_vote(for)` as self; `cast_vote(for, proxy_for=B)` on B's behalf.
  3. Member D: `cast_vote(against)`.
  4. `tally_motion`.
- **Expected:**
  - Two distinct `votes` rows for C-as-self and C-for-B (table is **principal-keyed**: `(motion_id, actor_id)` → B's row and C's row are separate).
  - Quorum/threshold sum weight over **principal** rows once each; `proxy_for` records who cast but does not double-count B's weight.
  - For = B(2)+C(2) = 4, Against = D(1) → carried.
- **Watch for (bug/UX risks):** B's weight counted twice (once as proxy, once if B also somehow votes); proxy voting B's ballot AND B later voting directly (must be one row per principal — second insert conflicts); revoked proxy still able to cast; proxy used outside its granted class.

---

### SCN-COORD-18 — Revoked proxy cannot cast; double-vote rejected
- **Priority:** P1
- **Area:** Governance & Decisions
- **Actors:** Member B (grants then revokes), Member C (would-be proxy)
- **Surfaces:** MCP `grant_proxy`, `revoke_proxy`, `list_proxies`, `cast_vote`
- **Preconditions:** Motion in `balloting`; B granted then revoked proxy to C.
- **Steps:**
  1. B `grant_proxy(to=C)`, then B `revoke_proxy(C)`.
  2. C attempts `cast_vote(for, proxy_for=B)`.
  3. Separately, B `cast_vote(for)` then attempts a second `cast_vote(against)`.
- **Expected:**
  - Step 2 is **blocked** — proxy no longer active.
  - The second self-vote in step 3 is rejected (principal-keyed unique row — one ballot per member, no re-vote/override unless the design allows update; default = reject).
- **Watch for (bug/UX risks):** revoked proxy still honored; member silently overwriting their own vote; `list_proxies` showing a revoked proxy as active.

---

### SCN-COORD-19 — Intake violation-report triages into a dispute
- **Priority:** P1
- **Area:** Governance & Decisions
- **Actors:** Agent A (reporter), Human C (triager)
- **Surfaces:** MCP `submit_intake`, `triage_intake`, `dismiss_intake`, `get_intake`, `list_intake`, `open_dispute`; REST `/api/intake`
- **Preconditions:** Project with an intake mailbox; topic T active.
- **Steps:**
  1. Agent A: `submit_intake(kind="violation_report", body)` → `received`.
  2. Human C: `list_intake`, `get_intake`, then `triage_intake(route="dispute", topic=T)`.
  3. Separately submit a `suggestion` intake and `dismiss_intake` it.
- **Expected:**
  - Triaged item → `triaged`, `routed_to` references the new dispute; `intake.triaged` + `dispute.opened` events.
  - A dispute is created in topic T with the reporter as a party.
  - The dismissed suggestion → `dismissed`, no downstream object.
- **Watch for (bug/UX risks):** intake routable to a topic in another tenant/project (scope leak); triage creating the wrong primitive; dismissing a `received` item that was already triaged (state confusion); intake without a topic_id never being assignable.

---

### SCN-COORD-20 — Open dispute over a contested artifact → resolve via arbiter
- **Priority:** P1
- **Area:** Governance & Decisions
- **Actors:** Agent A, Agent B (disagree on an artifact), Human D (arbiter)
- **Surfaces:** MCP `open_dispute`, `resolve_dispute`, `get_dispute`, `list_disputes`; REST `/api/topics/:id/disputes`
- **Preconditions:** Topic T active; an artifact two actors contest (e.g. lost-update or unavoidable claim collision).
- **Steps:**
  1. Agent A: `open_dispute(topic=T, subject=artifact, parties=[A,B])` → creates a resolution request routed to arbiter D.
  2. The underlying task moves to `disputed`.
  3. Human D: `resolve_dispute(decision)`.
- **Expected:**
  - Dispute `open → under_resolution → resolved`; `dispute.opened` + `dispute.resolved` events.
  - Resolution is a Request-Approval item under the hood (arbiter = unilateral procedure); the task is unblocked / re-posted per the decision.
- **Watch for (bug/UX risks):** dispute resolvable by a non-arbiter/non-party (scope leak); resolving a dispute that's already resolved; task left stuck in `disputed` after resolution; dispute opened on an artifact in a different topic.

---

### SCN-COORD-21 — Close topic drains in-flight items (provably terminating)
- **Priority:** P0
- **Area:** Coordination
- **Actors:** Human (closer, authority), Agents A/B with in-flight work
- **Surfaces:** MCP `close_topic`, `replay_topic_events`, `get_topic`; REST `POST /api/topics/:id/close`
- **Preconditions:** Topic T active with: an open claim, a pending multi-step request, a `balloting` motion, an open dispute.
- **Steps:**
  1. Human: `close_topic(T)` → `active → closing`.
  2. Attempt to `post_task`/`submit_request`/`propose_motion` on T after closing.
  3. Drive each in-flight item to terminal (or closer force-lapses).
  4. Observe transition to `closed`.
- **Expected:**
  - `closing` **freezes the board** — step 2 calls are rejected (no new task/request/motion).
  - The chaining handler is suppressed: a resolved request / carried motion emits `task.deferred` instead of posting a new task (records the would-be task in the sealed trail).
  - Every in-flight item runs to terminal or is force-lapsed with an event; the drain set only shrinks → `closing → closed` terminates.
  - On `closed` the event log is **sealed** — no further appends.
- **Watch for (bug/UX risks):** new work accepted during `closing` (drain set grows → non-termination); chaining still posting tasks during drain; appending to a sealed log after close; force-lapse leaving an item non-terminal.

---

### SCN-COORD-22 — Tenant-scope isolation across all coordination surfaces
- **Priority:** P0
- **Area:** Access Control
- **Actors:** Agent X (tenant 1), Agent Y (tenant 2)
- **Surfaces:** MCP `whoami`, `get_topic`, `list_board`, `claim_task`, `replay_topic_events`, `list_active_claims`, `list_requests`, `list_motions`, `list_intake`, `list_disputes`; REST equivalents under `/api/topics/...`, `/api/projects/:id/...`
- **Preconditions:** Topic T1 in tenant 1; Agent Y authenticated only in tenant 2 (DEFERRED-029 callerScope threaded end-to-end). `MCP_AUTH_ENABLED=true`.
- **Steps:**
  1. Agent Y: `whoami` → confirms tenant-2 scope.
  2. Agent Y attempts each read/write against T1 (get topic, list board, claim a T1 task, replay T1 events, list T1 requests/motions/intake/disputes/claims).
- **Expected:**
  - Every cross-tenant call is **denied or returns empty** — Y never sees T1's tasks, events, requests, motions, votes, claims, intake, or disputes.
  - No coordination object leaks identity, payload, or even existence across the tenant boundary.
- **Watch for (bug/UX risks):** **scope leak** through any list/replay/get that forgot the callerScope filter; a write (claim/vote/decide) succeeding cross-tenant; `replay_topic_events` returning another tenant's log; error messages disclosing existence of out-of-scope objects.

---

### SCN-COORD-23 — Authority-tier action blocked for an execution-tier agent (self-approval guard)
- **Priority:** P0
- **Area:** Access Control
- **Actors:** Agent A (execution tier, also the submitter), Human D (authority)
- **Surfaces:** MCP `submit_request`, `decide_request_step`, `tally_motion`, `veto_motion`, `grant_level`, `explain_authorization`
- **Preconditions:** Topic T active; A joined at execution level; the route's final step targets the Authority office (human staffing policy).
- **Steps:**
  1. Agent A: `submit_request` for its own artifact.
  2. Agent A attempts `decide_request_step` on the Authority step (self-approve).
  3. Run `explain_authorization` for A on that action.
  4. Human D performs the authority decision instead.
- **Expected:**
  - Step 2 is **blocked** — A is not staffed at the Authority office; an execution agent cannot self-approve its own request (must not regress the Phase-13 bug where agents could self-approve).
  - `explain_authorization` clearly reports the missing capability/level.
  - Only D (authority) can endorse the final step; `grant_level` is required to change A's tier and is itself an authority action.
- **Watch for (bug/UX risks):** **self-approval bypass**; deciding a step at a level the actor doesn't hold; `grant_level` self-elevation; `explain_authorization` reporting allow when the action is actually denied.

---

### SCN-COORD-24 — Capability grant / revoke gates a coordination write; ephemeral key scope
- **Priority:** P1
- **Area:** Access Control
- **Actors:** Admin (granter), Agent B (CI agent on an ephemeral key)
- **Surfaces:** MCP `grant_capability`, `revoke_grant`, `list_grants`, `explain_authorization`, `mint_ephemeral_key`, `claim_task`, `write_artifact`
- **Preconditions:** Agent B has no coordination-write grant initially.
- **Steps:**
  1. Agent B (no grant): `claim_task` → denied; `explain_authorization` shows missing grant.
  2. Admin: `mint_ephemeral_key(principal=B, ttl)` and `grant_capability(B, claim/write, scope=topic/project)`.
  3. Agent B (with grant, on ephemeral key): `claim_task` + `write_artifact` → succeed.
  4. Admin: `revoke_grant(B)`; B retries a write.
- **Expected:**
  - Writes succeed only within the granted scope and while the grant is live and the ephemeral key unexpired.
  - After revoke (or key expiry), the next write is **denied**.
  - `list_grants` reflects grant then absence; grant scope confines B to the intended topic/project.
- **Watch for (bug/UX risks):** grant at one scope leaking authority to another (scope creep); ephemeral key outliving its TTL; revoke not taking effect until restart; a stale cached authorization decision.

---

### SCN-COORD-25 — submit_for_review queue: AI lesson enters pending-review, human approves/returns
- **Priority:** P2
- **Area:** Governance & Decisions
- **Actors:** Agent A (produces a lesson), Human C (reviewer)
- **Surfaces:** MCP `submit_for_review`, `list_review_requests`, `update_lesson_status`, `add_lesson`; REST `/api/projects/:id/review-requests`; GUI `/review`
- **Preconditions:** Project with review queue; an AI-generated lesson.
- **Steps:**
  1. Agent A: `add_lesson` (or `submit_for_review`) → lesson enters `pending-review`.
  2. Human C: `list_review_requests` → sees the item.
  3. Human C approves one and returns another (`update_lesson_status`).
- **Expected:**
  - Pending-review item is visible in the queue and the GUI `/review` inbox.
  - Approve → lesson active; return → back to the author with reason; both are durable, audited transitions.
  - The human gate is preserved (binding authority stays with the human reviewer).
- **Watch for (bug/UX risks):** AI self-approving its own pending-review lesson (must be blocked); approved/returned state not reflected in the queue; queue leaking another project's review requests.

---

### SCN-COORD-26 — Concurrent writers + reviewers stress (end-to-end coordination soak)
- **Priority:** P2
- **Area:** Coordination
- **Actors:** Agents A/B/C (execution), Human D (authority), one decision body
- **Surfaces:** MCP `charter_topic`, `join_topic`, `post_task`×N, `claim_task`, `write_artifact`, `baseline_artifact`, `submit_request`, `decide_request_step`, `propose_motion`/`cast_vote`/`tally_motion`, `replay_topic_events`, `close_topic`
- **Preconditions:** Topic T active; several tasks posted; a decision body configured.
- **Steps:**
  1. A/B/C concurrently `claim_task` across N tasks (some contend on the same task).
  2. Winners `write_artifact` + `baseline_artifact`; one stalls and is swept.
  3. A submits a request that routes to D; D endorses; a motion is run in parallel.
  4. `replay_topic_events(T, since=0)` and reconcile the full trail; then `close_topic`.
- **Expected:**
  - No double-claims, no lost updates, no orphaned `claimed` tasks; swept task is re-claimable.
  - The replayed event log is a complete, ordered, gap-tolerant account of every state change (claims, conflicts, expiries, versions, request/motion lifecycle).
  - Close drains cleanly to `closed` with a sealed log.
- **Watch for (bug/UX risks):** event-log gaps that aren't burned-seq (real missing events); `seq` allocation contention producing duplicate/zero seq; sweep racing a live write; counts in the final log not reconciling with observed actions.

---

## Coverage matrix (primitive → scenarios)

| Primitive / contract | Scenarios |
|---|---|
| charter/join/replay + induction | 01, 26 |
| derived artifact identity | 02, 26 |
| claim_task arbitration (double-claim race) | 03, 26 |
| fencing token (stale write rejected) | 04, 26 |
| live-claim AND token (slow-claimant-after-sweep) | 05 |
| abandoned-claim sweep + baseline revert | 06, 26 |
| artifact leasing collision / check / list | 07 |
| renew vs cap, lease lapse | 08 |
| rolling baselined handoff | 09, 26 |
| multi-level DoA route (endorse/return/reject) | 10, 11, 12 |
| stalled-step escalation sweep | 13 |
| motion carried, quorum/threshold/weight snapshot | 14, 26 |
| vote/tally race (atomic status flip) | 15 |
| veto override + veto/tally atomicity | 16 |
| proxy voting (count once) + revoke | 17, 18 |
| intake submit/triage/dismiss | 19 |
| dispute open/resolve | 20 |
| close-topic drain (terminating) | 21, 26 |
| tenant-scope isolation | 22 |
| level/self-approval guard | 23 |
| capability grant/revoke + ephemeral key | 24 |
| review queue (submit_for_review) | 25 |
