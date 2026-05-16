# Phase 15: Multi-Actor Coordination Protocol — Design Document

**Status:** Design — **rev 4** (2026-05-16) — design phase complete
**Extends:** Phase 13 — Multi-Agent Coordination Protocol (`docs/phase-13-design.md`)
**Motivating evidence:** Phase 13 post-hoc review (`docs/audit/phase-13-review.md`); Run 1 multi-agent contention test (2026-05-15).
**Rev 2:** incorporates a cold-start adversarial design review (9 findings — the 3 HIGH blockers resolved) and a 2026 agent-market comparison. Changed passages marked *[rev2]*.
**Rev 3:** incorporates a second cold-start re-review — resolves 7 *fix-interaction* findings (2 HIGH, 3 MED, 2 LOW) that the rev-2 fixes introduced. Changed passages marked *[rev3]*.
**Rev 4:** *[rev4]* incorporates a third (final) cold-start re-review — resolves 3 blockers (2 HIGH, 1 MED) and writes 4 one-line decisions. rev 4 adds **no new mechanism** — only clarifications — and is the terminal design revision. Changed passages marked *[rev4]*.
**Design principle:** *Inherit established human work-management practice; introduce no novel coordination mechanism.* Every concept below names the human-organizational practice it instantiates — the same stance the Dead Light Framework takes ("adopts industry-standard formulas; does not invent").

---

## Part A — Problem & Principles

### A.1 Why Phase 15

Phase 13 shipped three coordination features: F1 artifact leasing, F2 review-requests, F3 taxonomy profiles. A live test with parallel sub-agents (Run 1, 2026-05-15) established two things.

**What works.** F1's arbitration is correct. A controlled reproduction — two actors claiming the *identical* `(artifact_type, artifact_id)` tuple — returned `claimed` for the first and `conflict` (with the incumbent's identity) for the second. The one-active-lease-per-artifact invariant holds; no 500s.

**What is thin.** The coordination *layer* around that correct primitive is incomplete:

| Gap | Evidence |
|---|---|
| **Identity is free-text.** Two actors meaning the same artifact but formatting `artifact_id` differently each receive a lease — coordination silently does nothing. | Run 1: 3 agents told to share artifacts diverged on the id string and never actually contended. TEST 2 reproduced it directly. |
| **No notification.** Actors must poll; nothing tells an actor a lease freed or a review resolved. | Run 1 friction log (all 3 agents). |
| **No history.** A released lease is `DELETE`d — a completed coordination session leaves no trail. | Run 1: post-run `artifact_leases` query returned 0 rows. |
| **One approver only.** F2 models a single sign-off; real governance also decides by multi-level routing and by collective vote. | Design review of the model. |
| **Inconsistent surface.** `claim`/`check`/`list` return three response shapes; `check` invites a TOCTOU race. | Run 1 friction log. |

Phase 13's model is a **blackboard** — shared state plus polling. It is correct but incomplete.

### A.2 The reframe — communication across time

Actors here run at **incommensurable timescales**: an AI agent lives seconds then disbands; a human responds in hours or days; a project runs for weeks. "Real-time messaging" is the wrong frame — there is no point messaging an actor that has disbanded or is asleep.

The right frame is a **durable, append-only, replayable event log**. The blackboard gives shared *state*; the event log adds the missing dimension of *time*. An ephemeral agent does not "subscribe" — at the start of each task it **replays** the log from a cursor to catch up. A human's GUI subscribes for live push. The same log serves both.

> **Phase 13:** blackboard (shared state + poll). **Phase 15:** blackboard **+ event log** (shared state + a replayable, subscribable event stream).

### A.3 Design principle — inherit, do not invent

Concurrent multi-actor coordination is a solved problem: every company and every government runs on it. Phase 15 **instantiates established practice** and introduces no new coordination mechanism. Each concept names its source:

| Phase 15 concept | Inherited from |
|---|---|
| Actor = position at a level | Org hierarchy / chain of command; office ≠ officeholder (Weber) |
| Two primitives: Request–Approval / Board | Approval workflow + escalation ↔ delegation + work-order dispatch / Kanban pull |
| Per-task roles | RACI (Responsible / Accountable / Consulted / Informed) |
| Authority by level | Delegation-of-Authority (DoA) matrix |
| Multi-level approval | Sequential approval chains / approval routing / escalation matrix |
| Topologies: parallel / sequential / rolling | Swimlanes / stage-gate (Cooper) / rolling-wave planning (PMBOK) |
| Topic | Project charter / chartered initiative (PMBOK) |
| Artifact + identity | Records management / document control (ISO 9001 §7.5, ISO 15489) |
| Collective decision | Corporate governance + parliamentary procedure (Robert's Rules) |
| Quorum / threshold / supermajority / veto | Corporate bylaws; ordinary vs special resolution; golden share |
| Proxy voting | Shareholder proxy |
| Event log | Records register / minute book / audit trail |
| Intake mailbox | Compliance hotline / grievance procedure / suggestion box |
| Dispute resolution | Escalation-to-common-superior / arbitration / tribunal |
| Joining a topic | Onboarding / induction |

**The principle holds technically too.** *[rev2]* A comparison against the 2026 agent-infrastructure market confirms the core choices independently: the append-only **event log + replay** is the *durable-execution* pattern (Temporal and peers — state that survives across hours/days); the per-topic event stream is mainstream *event-driven agent* architecture; **Request–Approval** is the standard *human-in-the-loop* checkpoint (pause → approve → audit → resume). Phase 15 inherits from established human practice *and* lands where agent infrastructure is converging.

### A.4 Position in the 2026 agent stack — *[rev2]*

By 2026 a two-layer protocol stack is the architectural default: **MCP** (Anthropic; now Linux-Foundation-governed) for *vertical* tool/context access, and **A2A** (Agent-to-Agent; Google → Linux Foundation) for *horizontal* agent-to-agent coordination — peer agents discovering each other and exchanging messages and tasks. **ContextHub already is an MCP server** — it sits correctly on the vertical layer.

Phase 15 is a *horizontal* coordination layer, and it deliberately does **not** adopt A2A's peer-messaging model. The reason is the timescale argument of A.2: A2A assumes addressable peer agents that can send and receive messages; Phase 15's actors are **ephemeral** (an agent that submitted a request has disbanded long before the response exists) and **human** (asleep for hours). Peer messaging cannot deliver to an actor that no longer exists. Phase 15's substrate is therefore a **shared, append-only, replayable log** — coordination *across time*, not *between live peers*.

This is a conscious divergence, not an omission. A2A and Phase 15 are complementary: an external A2A agent should be able to *join a Topic* and participate through the Board / event-log surface. An **A2A interop bridge** is scoped as an open question (Part E) so ContextHub stays interoperable with the converging ecosystem rather than becoming an island.

---

## Part B — Conceptual Model

### B.1 Actor — a position in a hierarchy

There is **one** kind of participant: the **actor**.

```
actor = (identity, type ∈ {human, ai}, position @ level, memberships[(body, vote_weight)])
```

- **Level** places the actor in a chain of command. Three tiers suffice as a default:

  | Tier | Does | Default staffing (DLF) |
  |---|---|---|
  | **Authority** | binding sign-off, closes gates, seals | human |
  | **Coordination** | defines & delegates work, aggregates results | human / ai |
  | **Execution** | claims & produces artifacts | ai / human |

- **`type` (human/ai) is a staffing attribute** — like "employee vs contractor". It changes no coordination mechanism.
- The DLF rule "binding authority remains with humans" becomes a **staffing policy** — "the Authority tier is staffed by humans" — not a hard-coded special case. The mechanism is uniform by level; *who* sits at each level is configuration. The same architecture serves an all-human team, an all-AI team, or a mix.

**Actor identity is project-scoped.** *[rev2]* An actor is `(project_id, actor_id)`, consistent with every other entity; an actor row is auto-registered on its first `join` to any Topic in the project. (Phase 13 took `agent_id` as caller-supplied free text — decision D1; Phase 15 keeps it caller-supplied but anchors it per project.) Cross-instance import (Phase 11) must namespace or remap colliding `actor_id`s — see Part E.

**The Coordination tier is the supervisor attach point.** *[rev2]* An actor at the Coordination tier *posts and delegates* work to the Execution tier. The model therefore *permits* centralized, supervisor-style coordination — the dominant 2026 production pattern — without *mandating* it: Execution actors still self-select from the Board. Centralized and decentralized coordination are the same mechanism at different staffing densities.

**Handover — acting in a role.** *[rev2]* Authority attaches to the *office/level*, not to the actor instance. When an actor disbands or is absent, work does not stall: an abandoned task's claim expires and the task returns to the Board (C.4) for any actor staffed to that office to pick up; an in-flight request's route freezes its *rules* but resolves its *officeholder* at decision time, and a stalled step escalates (B.7, C.4). "Acting in a role" is not a separate mechanism — it is exactly these recovery behaviours.

### B.2 The two communication primitives

| | **A. Request–Approval** | **B. Board (notify + claim)** |
|---|---|---|
| Intent | send → **wait for a binding response** | post / announce → **no wait** |
| Responder | a designated office or body | none — whoever claims, does |
| Lifecycle | open → resolved (gates progress) | post → claimed → done |
| Metaphor | escalation / sign-off | a bounty board — pin a wanted-note, a hunter takes it and leaves |
| Phase 13 today | F2 review-requests | F1 leasing (the *claim* half only) |

Only these two. Every interaction is one of them. (RACI maps cleanly: **A**ccountable → primitive A; **I**nformed → primitive B / notify; **R**esponsible → claim; **C**onsulted → a non-binding variant of A.)

### B.3 Three task topologies

Topology is the *inter-task* wiring; the primitive is *per-task* handling.

| Topology | Ordering | Coordination need | Primitive | Wired by |
|---|---|---|---|---|
| **Parallel** | none | don't double-claim a task | B (claim) | — (independent) |
| **Sequential** | strict | handoff at the boundary | A (gate) | output(A) = input(B) |
| **Rolling** | ordered + overlapping | streaming partial handoff | B-events + A at gates | input(B) = *baselined* increment of output(A) |

**Default topology — rolling.** *[rev2]* 2026 production data on multi-agent systems shows strictly *sequential* multi-agent execution degrades task performance heavily (reported 39–70%). Where ordering permits any overlap, prefer **rolling** over strict **sequential**: it keeps the ordering guarantee (baselined handoff) without idling downstream actors.

### B.4 Topic — the coordination space

A **Topic** is a chartered initiative — a bounded unit of collaborative work with a goal (e.g. "Phase 0 Reckoning of project LoreWeave"). It sits under a `project`; one project hosts many topics over its life.

A Topic contains five things:
- **Board** — posted tasks available to claim (primitive B's surface).
- **Approval queue** — open request-approvals (primitive A's surface).
- **Event log** — the append-only event stream for this topic.
- **Participants** — actors who have joined, with level and roles.
- **Artifacts** — the input/output documents.

Joining a Topic is **onboarding**: the actor receives an *induction pack* — charter, participant roster, current board, open request-approvals relevant to it, and the event log from a cursor. This is how an ephemeral agent re-primes: it does not scan scattered files; it joins the topic and the topic states everything.

### B.5 Artifact — the document-controlled currency

Every task is `input artifact(s) → [work] → output artifact(s)` — the DLF "paperwork principle". The artifact is the universal unit: of **claim** (you claim the output artifact you will write), of **handoff** (output of A = input of B), and of **review** (a request-approval approves *an artifact*).

**Identity is derived, not free-text.** An artifact's identity is `(topic, task, slot)` — a declared slot on a task within a topic — under a controlled scheme (document control). Actors cannot diverge on the name because they do not invent it. *This closes Run 1's #1 gap structurally.*

Artifacts are **versioned and state-tracked**: `draft → working → baselined → for_review → final` (plus `superseded`). The `baselined` state answers the rolling-topology question — downstream consumes an upstream artifact once it is *baselined*, not while it is `draft`.

**A claim covers the writing states only.** *[rev4]* A claim is held across `draft → working → baselined` and is **released when the artifact is submitted for review** (`for_review`) or marked `final` — at that point the writer has handed the artifact off. A `for_review` artifact therefore carries **no live claim**: the reviewer owns the next move, not a writer. (This is why the abandoned-claim sweep, C.4, never encounters a `for_review` artifact.)

### B.6 Collective decision — voting bodies

The Request-Approval primitive's "approver" generalizes from one office to a **decision body** governed by a voting rule. A single sign-off is the degenerate body of one — it is the same mechanism.

- **Decision body** — actors entitled to vote on a class of decisions (board, committee, shareholders' meeting; DLF: the Ascension Council).
- **Vote weight** — attached to `(actor, body)`, **orthogonal to level**. Level is hierarchy authority; vote weight is ballot power in a body. A 60%-shareholder outvotes a 5%-shareholder CEO.

| Parameter | Inherited from |
|---|---|
| Electorate | members of the decision body |
| Vote weight | one-share-one-vote / dual-class / weighted voting |
| Quorum | corporate/parliamentary quorum rules — minimum participating weight for a valid vote |
| Threshold | ordinary `>50%` · special `⅔–¾` (supermajority) · unanimity |
| Veto | golden share / permanent-member veto / DLF project-owner |
| Tie-break | chair's casting vote |
| Abstention | counts toward quorum, not toward the threshold base |
| Deadline / non-quorum | adjournment — lapses or is rescheduled if quorum is not met |

Motion lifecycle: `proposed → seconded → balloting → tally → carried | failed | lapsed | vetoed`. An ephemeral agent casts its vote — a durable event — and may then disband; an agent that will not be present to deliberate may **proxy** its vote (shareholder proxy voting). *[rev4]* Quorum and threshold sum `votes.weight` over the **principal** rows (one per member — C.1); `proxy_for` records who *cast* a ballot but does not affect the count.

**Veto is a first-class act, not a heavy vote.** *[rev2]* A golden-share / permanent-member veto is a *unilateral override of an otherwise-carried motion* — not a ballot choice. A member listed in the body's `veto_holders` may exercise a veto while the motion is `balloting` — the active decision window, the same window in which votes are cast *[rev4]*; a veto sends the motion to the terminal status **`vetoed`**, overriding a `carried` tally. (Modelling veto as a merely weighted `against` vote would be defeated by a supermajority — which is not what a veto is.) The motion lifecycle is therefore `... → carried | failed | lapsed | vetoed`. *[rev3]* `veto` and `tally` are mutually exclusive on the motion row — both first close the ballot atomically via `WHERE status='balloting'` (C.2).

### B.7 Multi-level approval routing

A Request-Approval may carry a **route** — an ordered sequence of approval steps — instead of a single approver. The route is derived from the **Delegation-of-Authority matrix**: the decision's weight determines how far it climbs. Two route shapes, one mechanism:
- **escalate-to-authority** — the request climbs until it reaches a level whose DoA authority covers it (small decisions stop low; large ones climb high);
- **counter-sign** — every level on the path must endorse.

At each step an approver may **endorse-and-forward**, **return** (send back for revision), or **reject** (kill it). A step's decision procedure may itself be unilateral or collective (B.6).

**The route's *rules* are snapshotted at submission; the *officeholder* is resolved at decision time.** *[rev3]* When a request is submitted, each step records the **target office/level** it climbs to and the **DoA-matrix version** then in force (`request_steps.target_office`, `doa_snapshot`) — both frozen. A later staffing change or hierarchy reconfiguration does **not** re-target an in-flight request; the *rules* it climbs are fixed at submission (records-management discipline). But the *officeholder* who decides a step is resolved when that step becomes active — to whoever currently staffs the target office (office ≠ officeholder). If the office is unstaffed, the step does not wedge: each step carries a `deadline`, and a timed-out step is **escalated** by a sweep — to the next office up, or to a dispute (C.4). *Snapshot the rules, not the people's availability.*

### B.8 Intake & dispute resolution

**Intake mailbox** — an inbound channel for items that belong to no current task: **violation reports** (compliance hotline; generalizes DLF Notify Triggers N-1..N-5 to *any* actor) and **suggestions / feedback** (suggestion box). An intake item is **triaged** and becomes a board task, a request-approval, a motion, or a dispute.

**Dispute resolution** — when coordination genuinely fails (a lost update, an unavoidable claim collision) or actors disagree, a **dispute** is opened. A dispute is a Request-Approval item — "resolve dispute X" — routed to an **arbiter** (unilateral procedure) or a **tribunal** (collective procedure). This is what DLF "debates" and the "Council review" branch perform.

Neither adds a primitive; both are entry/routing patterns over the existing two.

---

## Part C — Concrete Architecture

### C.1 Entities & schema

Indicative DDL (Postgres). Final column lists are settled per migration. The **event log is the spine**; everything else is state that also emits events.

```sql
-- The event log — append-only. The replay cursor is (topic_id, seq).
CREATE TABLE coordination_events (
  topic_id     TEXT        NOT NULL,
  seq          BIGINT      NOT NULL,          -- monotonic per topic; allocated transactionally.
                                              -- [rev2] NOT gap-free: an aborted txn burns a seq number.
                                              -- Replay treats the cursor as a high-water mark and
                                              -- never waits for a missing seq.
  event_id     UUID        NOT NULL DEFAULT gen_random_uuid(),
  ts           TIMESTAMPTZ NOT NULL DEFAULT now(),
  actor_id     TEXT        NOT NULL,
  type         TEXT        NOT NULL,          -- see C.3
  subject_type TEXT        NOT NULL,          -- task|artifact|request|motion|dispute|intake|topic
  subject_id   TEXT        NOT NULL,
  payload      JSONB       NOT NULL DEFAULT '{}',
  PRIMARY KEY (topic_id, seq)
);                                            -- replay: WHERE topic_id=$1 AND seq>$cursor ORDER BY seq

CREATE TABLE topics (
  topic_id   TEXT PRIMARY KEY,
  project_id TEXT NOT NULL,
  name       TEXT NOT NULL,
  charter    TEXT NOT NULL,                   -- scope, goal, authority
  status     TEXT NOT NULL DEFAULT 'chartered'
               CHECK (status IN ('chartered','active','closing','closed')),
  created_by TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- [rev2] Actor identity is project-scoped. Auto-registered on first join.
CREATE TABLE actors (
  project_id   TEXT NOT NULL,
  actor_id     TEXT NOT NULL,
  type         TEXT NOT NULL CHECK (type IN ('human','ai')),
  display_name TEXT NOT NULL,
  PRIMARY KEY (project_id, actor_id)
);

CREATE TABLE topic_participants (
  topic_id TEXT NOT NULL, actor_id TEXT NOT NULL,
  level    TEXT NOT NULL CHECK (level IN ('authority','coordination','execution')),
  joined_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (topic_id, actor_id)
);

CREATE TABLE tasks (
  task_id    UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  topic_id   TEXT NOT NULL,
  title      TEXT NOT NULL,
  topology   TEXT NOT NULL CHECK (topology IN ('parallel','sequential','rolling')),
  depends_on UUID[],                          -- predecessor task(s) — sequential/rolling
  raci       JSONB NOT NULL,                  -- {responsible,accountable,consulted,informed}
  status     TEXT NOT NULL DEFAULT 'posted'
               CHECK (status IN ('posted','claimed','in_progress','completed','disputed'))
);

CREATE TABLE artifacts (
  artifact_id            TEXT PRIMARY KEY,     -- DERIVED <topic>/<task>/<slot> — never free-text
  topic_id               TEXT NOT NULL, task_id UUID, slot TEXT NOT NULL,
  kind                   TEXT NOT NULL,        -- F3 taxonomy type (reckoning-finding, ...)
  state                  TEXT NOT NULL DEFAULT 'draft'
                           CHECK (state IN ('draft','working','baselined','for_review','final','superseded')),
  version                INT  NOT NULL DEFAULT 1,
  accepted_fencing_token BIGINT NOT NULL DEFAULT 0,  -- [rev2] highest fencing token a write has presented;
                                                     -- a write presenting a LOWER token is rejected (C.2)
  content_ref            TEXT                  -- → lesson_id / document_id (the payload)
);                                             -- artifact_versions: append-only history (incl. sweep reverts)

CREATE TABLE claims (                          -- evolves Phase 13 artifact_leases
  claim_id      UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  topic_id      TEXT NOT NULL, task_id UUID NOT NULL, artifact_id TEXT NOT NULL,
  actor_id      TEXT NOT NULL,
  fencing_token BIGINT NOT NULL,               -- from a global monotonic sequence (C.2)
  expires_at    TIMESTAMPTZ NOT NULL
);
-- [rev2] PLAIN unique index — NOT partial. `WHERE expires_at > now()` is INVALID in a Postgres
-- index predicate (now() is STABLE, not IMMUTABLE); migration 0048 documents this exact failure.
-- "Uniqueness only among ACTIVE claims" is preserved by the service-layer atomic claim transaction:
--   1. DELETE expired claims for this artifact (now() is fine in a WHERE clause)
--   2. INSERT the new claim — this unique index catches a concurrent active claim
--   3. on 23505, re-SELECT to classify "still-active conflict" vs "expired-but-uncleaned race"
CREATE UNIQUE INDEX claims_active_uniq ON claims (artifact_id);

CREATE TABLE requests (                       -- evolves review_requests — the Request-Approval primitive
  request_id   UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  topic_id     TEXT NOT NULL,
  subject_type TEXT NOT NULL, subject_id TEXT NOT NULL,
  procedure    TEXT NOT NULL CHECK (procedure IN ('unilateral','collective')),
  status       TEXT NOT NULL DEFAULT 'open'
                 CHECK (status IN ('open','approved','returned','rejected')),
  submitted_by TEXT NOT NULL
);
CREATE TABLE request_steps (                  -- the multi-level route (B.7)
  request_id    UUID NOT NULL, step_index INT NOT NULL,
  target_office TEXT NOT NULL,                -- [rev3] office/level this step climbs to — FROZEN at submission
  doa_snapshot  TEXT NOT NULL,                -- [rev3] DoA-matrix version in force at submission — FROZEN
  deadline      TIMESTAMPTZ NOT NULL,         -- [rev3] step times out → escalation sweep (C.4)
  procedure     TEXT NOT NULL,
  status        TEXT NOT NULL DEFAULT 'pending'   -- [rev3] +escalated
                  CHECK (status IN ('pending','endorsed','returned','rejected','escalated')),
  decided_by TEXT, decided_at TIMESTAMPTZ,    -- decided_by = the officeholder resolved at decision time
  PRIMARY KEY (request_id, step_index)
);

CREATE TABLE decision_bodies (
  body_id TEXT PRIMARY KEY, project_id TEXT NOT NULL, name TEXT NOT NULL,
  quorum NUMERIC NOT NULL, threshold NUMERIC NOT NULL, veto_holders TEXT[]
);
CREATE TABLE body_members (
  body_id TEXT NOT NULL, actor_id TEXT NOT NULL, vote_weight NUMERIC NOT NULL,
  PRIMARY KEY (body_id, actor_id)
);
CREATE TABLE motions (
  motion_id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  body_id TEXT NOT NULL, topic_id TEXT NOT NULL, subject_ref TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'proposed'      -- [rev2] +vetoed
           CHECK (status IN ('proposed','seconded','balloting','carried','failed','lapsed','vetoed')),
  proposed_by TEXT NOT NULL, deadline TIMESTAMPTZ NOT NULL
);
CREATE TABLE votes (
  motion_id UUID NOT NULL,
  actor_id  TEXT NOT NULL,                    -- [rev3] ALWAYS the principal — one row per member
  choice TEXT NOT NULL CHECK (choice IN ('for','against','abstain')),
  weight NUMERIC NOT NULL,
  proxy_for TEXT,                             -- [rev3] non-null = this ballot was cast by proxy-holder <proxy_for>
  PRIMARY KEY (motion_id, actor_id)           -- principal-keyed: a holder casting own + a proxy = 2 distinct rows
);

CREATE TABLE intake_items (
  intake_id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id TEXT NOT NULL, topic_id TEXT,    -- topic_id null until triaged
  kind TEXT NOT NULL CHECK (kind IN ('violation_report','suggestion','request')),
  body TEXT NOT NULL, submitted_by TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'received' CHECK (status IN ('received','triaged','dismissed')),
  routed_to TEXT                              -- ref of the task/request/motion/dispute it became
);
CREATE TABLE disputes (
  dispute_id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  topic_id TEXT NOT NULL, subject_ref TEXT NOT NULL, parties TEXT[] NOT NULL,
  status TEXT NOT NULL DEFAULT 'open' CHECK (status IN ('open','under_resolution','resolved')),
  resolution_request_id UUID                  -- → requests(request_id) routed to arbiter/tribunal
);
```

### C.2 API surface (REST `:3001` + mirrored MCP tools, 1:1 as in Phase 13)

```
Topic     POST /topics                       charter a topic
          POST /topics/:id/join              join → returns the induction pack
          GET  /topics/:id                   topic state
          POST /topics/:id/close             close (see close contract below)
Board     POST /topics/:id/tasks             post a task to the board
          GET  /topics/:id/board             list claimable tasks
          POST /tasks/:id/claim              claim → { claim_id, fencing_token, expires_at }
          POST /tasks/:id/release            release
          POST /tasks/:id/complete           submit output artifact
Artifact  PUT  /artifacts/:id                write/version (presents claim_id + fencing_token)
          POST /artifacts/:id/baseline       mark a draft baselined (rolling handoff)
Request   POST /requests                     submit a request-approval (procedure, route)
          POST /requests/:id/steps/:n/decide endorse | return | reject
Voting    POST /motions                      propose a motion
          POST /motions/:id/second           second it
          POST /motions/:id/votes            cast a vote { choice, proxy_for? }
          POST /motions/:id/veto             exercise a veto (veto_holders only)
          POST /motions/:id/tally            tally (or automatic at deadline)
Intake    POST /intake                       submit { kind, body }
          POST /intake/:id/triage            route → task | request | motion | dispute
Dispute   POST /disputes                     open → creates a resolution request
Events    GET  /topics/:id/events?since=:seq cursor replay (agents — cheap catch-up)
          GET  /topics/:id/stream            SSE live push (human GUI)
```

`check` from Phase 13 is **removed** — it invited a TOCTOU race; `claim` is the only authoritative call. All responses use **one envelope**: `{ status, data?, conflict?, error? }`.

**Key contracts — *[rev2; rev3; rev4]*:**
- **`fencing_token`** is allocated from a single **global monotonic sequence** — any later claim's token is strictly greater than any earlier one's.
- **`PUT /artifacts/:id`** must present the holder's `claim_id` **and** `fencing_token`. The write is **rejected** (`status: 'conflict'`) unless, **atomically in one statement**, *both* hold: (a) `claim_id` references a **live** claim — the row exists and `now() < expires_at`; and (b) the presented token is **≥** `artifacts.accepted_fencing_token`. On success, `accepted_fencing_token` is set to the presented token. *[rev3]* The token alone is insufficient: a fencing token guards against a *superseding* holder (one with a higher token has written), **not** against *your own claim having expired with no successor yet* — the slow-claimant-after-sweep window. The live-claim check closes that window.
- **`POST /motions/:id/votes`** is rejected unless, *in the same transaction as the vote insert*, the motion is `balloting` **and** `now() < deadline`. *[rev3]* **`POST /motions/:id/tally`** and **`POST /motions/:id/veto`** each *first* perform an atomic `UPDATE motions SET status=… WHERE status='balloting'` — the loser of any race sees 0 rows affected and aborts. A vote, a tally, and a veto are therefore mutually exclusive on the motion row: the ballot is closed before it is counted *or* vetoed (Robert's Rules).
- **`POST /topics/:id/close`** *[rev4]* moves the topic `active → closing` with **no item-state precondition** — it simply *freezes the Board* (no new task, request, or motion may be posted) and suppresses the chaining handler (C.4). `closing` is the **drain state**: every in-flight item — claim, request (and its route steps), motion, dispute — runs to a terminal state, or is **force-lapsed** by the closer with an event. Items *spawned during* `closing` by recovery (a stalled-step escalation, a dispute conversion) join the drain set and are themselves force-lapsable. The drain set only ever shrinks — no new work can enter — so `closing → closed` is provably terminating; on `closed` the event log is **sealed** (no further appends).

### C.3 Event catalog

`topic.chartered` · `topic.actor_joined` · `topic.closed` · `task.posted` · `task.claimed` · `task.released` · `task.completed` · `task.deferred` *[rev3]* · `artifact.created` · `artifact.versioned` · `artifact.state_changed` · `claim.granted` · `claim.conflict` · `claim.expired` · `request.submitted` · `request.step_decided` · `request.step_escalated` *[rev3]* · `request.resolved` · `motion.proposed` · `motion.seconded` · `vote.cast` · `motion.tallied` · `motion.vetoed` *[rev2]* · `intake.received` · `intake.triaged` · `dispute.opened` · `dispute.resolved`

### C.4 Lifecycle state machines

```
Topic      chartered → active → closing → closed     (closing = drain state; closed seals the log)
Task       posted → claimed → in_progress → completed
           (→ released → posted;  → disputed;  → posted on claim expiry — see recovery below)
Artifact   draft → working → baselined → for_review → final
           (→ superseded;  → last baseline / draft on claim expiry — see recovery below)
Request    open → [per step: pending → endorsed|returned|rejected|escalated] → approved|returned|rejected
Motion     proposed → seconded → balloting → carried|failed|lapsed|vetoed
Dispute    open → under_resolution → resolved
Intake     received → triaged|dismissed
```

**Chaining:** a resolved Request or a carried Motion emits an event whose handler **posts a new board task** ("execute the approved/carried outcome") — *[rev3]* **unless the topic is `closing` or `closed`**, in which case the handler does **not** post; it emits `task.deferred` (recording the would-be task in the sealed trail) so a draining topic is never re-filled. The two primitives interlock — an approval result becomes claimable work — but never against a topic that is terminating. *[rev4]* Closing a topic therefore *by design* abandons chained work not yet claimed: the `task.deferred` event is the durable record of an approved-but-unexecuted outcome, which a human or a successor topic acts on from the sealed log. A closer who needs the chain executed drains it before closing.

**Abandoned-claim recovery — *[rev2; rev3; rev4]*.** An ephemeral actor may disband mid-task. A background sweep job (reusing the Phase 13 `leases.sweep` pattern) detects a `claims` row past `expires_at` with no completion: it emits `claim.expired`, returns the task `claimed|in_progress → posted` (claimable again), and emits `task.released`. The output artifact is recovered for **every claim-holdable state** — `draft`, `working`, or `baselined` (*[rev4]* a claim is released at `for_review`, B.5, so the sweep never encounters a `for_review` artifact): it is reset to its **last `baselined` version** (`content_ref` repointed to that version's payload), or to `draft` with `content_ref` cleared if it was never baselined. *[rev4]* The revert **appends an `artifact_versions` row** ("reverted to vN") — a content change is never made in place, so the document-control history stays complete. The sweep **never un-baselines** — a `baselined` artifact a downstream rolling consumer may already have pulled is preserved at its last baseline. `accepted_fencing_token` is **left unchanged** — it is monotonic; a later claimant's token is still strictly higher, and resetting it would break the fencing guarantee.

**Stalled-step recovery — *[rev3; rev4]*.** The same sweep covers request routing: a `request_steps` row still `pending` past its `deadline` (target office unstaffed, or the officeholder unresponsive) is set `→ escalated`, emits `request.step_escalated`, and is re-targeted up one level — *[rev4]* the re-targeted step receives a **fresh `deadline`** (`now()` + the step interval), so an unstaffed chain escalates one tier per interval with a real response window, not collapsing to a dispute in a single sweep tick — or, if already at the Authority tier, converted to a dispute. A multi-level request therefore never wedges on a vanished officeholder — the mirror of abandoned-claim recovery for the Request-Approval primitive. No work is silently wedged in either primitive; the partial event trail remains in the log.

---

## Part D — Mapping to Phase 13

| Phase 13 | Phase 15 | Change |
|---|---|---|
| F1 `artifact_leases` | `claims` (on the Board) | + canonical *derived* artifact identity (no free-text), + `fencing_token` (global monotonic seq, checked at the artifact alongside claim-liveness — C.2), + emits events; the posted-task **Board** is new on top. *[rev2]* Adopts the **shipped** Phase-13 uniqueness pattern — plain unique index + service-layer atomic claim transaction — **not** the design-doc's invalid `WHERE now()` partial index. |
| F1 `claim/release/renew/check` tools | Board API | `check` removed (TOCTOU); claim authoritative; one response envelope |
| F2 `review_requests` | `requests` + `request_steps` (Request-Approval primitive) | + multi-level route (rules snapshotted at submission, officeholder resolved at decision time, stalled steps escalate), + collective procedure, + emits events, + resolution chains to a new board task |
| F2 `pending-review` lesson status | unchanged | reused as-is — still the human gate |
| F3 `taxonomy_profiles` / lesson types | artifact **kinds** | reused — artifacts are typed; DLF reckoning types map to artifact kinds |
| F3 `codex-guardrail` + guardrail engine | the **policy layer** | reused — actions are checked against it; the voting mechanism is how policy is amended |
| `lessons`, `documents` | artifact `content_ref` payloads | unchanged — an artifact references a lesson/document as its content |
| — | `topics`, `coordination_events`, `decision_bodies`/`motions`/`votes`, `intake_items`, `disputes`, the actor/level model | **NEW** |

Migration is **additive**: F1/F2 tables gain columns and are not dropped; existing rows are preserved.

**DLF invariants preserved:** files-as-truth (artifacts are document-controlled; the event log *is* files-as-truth in log form); ephemeral task-scoped agents (no persistent agent process is assumed — agents replay on join; abandoned work and stalled steps are recovered, C.4); human binding authority (now a staffing policy on the Authority tier — must not regress the Phase-13 bugs where agents could self-approve); optimistic, not hard-serialized (claims + fencing + claim-liveness); agent-self-directed (the Board *posts* work; agents *choose* — not assignment, so still not an orchestrator).

---

## Part E — Roadmap, Non-goals, Acceptance, Open questions

### Sprint sketch (migrations 0053+)

| Sprint | Deliverable |
|---|---|
| 15.1 | Substrate — `coordination_events`, `topics`, actor/level model, join + induction pack, events replay + SSE |
| 15.2 | Board — `tasks`, derived-identity `artifacts` + versioning/states, `claims` (shipped-pattern index + fencing-token + claim-liveness check at the artifact), abandoned-claim sweep |
| 15.3 | Request-Approval — `requests` + `request_steps` multi-level routing; route *rules* snapshotted at submission; step deadline + escalation sweep |
| 15.4 | Collective decision — `decision_bodies`, `motions`, `votes`, quorum/threshold/proxy, veto as a first-class act (atomic with tally) |
| 15.5 | Intake mailbox + dispute resolution |
| 15.6 | GUI — Topic view, Board, live event stream (SSE), approval & voting UI |
| 15.7 | E2E — the multi-agent coordination test, re-run properly (the test that motivated this phase) |

### Non-goals
- Not a task orchestrator — the Board posts work; actors self-select. No assignment.
- Not hard serialization — claims stay optimistic; `fencing_token` + claim-liveness make a stale holder *detectable* (rejected at the artifact), not pre-emptively *blocked*.
- Not a message bus — the event log has no directed delivery; it is an append-only shared log (files-as-truth in log form). A2A peer-messaging interop is a bridge, not the core (A.4).
- Not a policy engine — standing rules remain the F3 guardrail/Codex layer; Phase 15 plugs into it.

### Acceptance criteria (Phase 15 complete when)
- An ephemeral agent re-primes purely by `join` + cursor replay — no file scan.
- Two actors meaning the same artifact **cannot** diverge on identity (derived from `topic/task/slot`).
- A stale claim-holder's `PUT` is rejected — the artifact checks **both** the fencing token and that the presenting claim is still live (covers the slow-claimant-after-sweep window).
- An abandoned claim (claimant disbanded) is detected by sweep; its task returns to the Board and its artifact reverts to its last baseline (or `draft`) — no task is permanently wedged, no baseline is destroyed.
- A request step whose target office is unstaffed past its `deadline` is escalated by sweep (with a fresh deadline) — a multi-level request never wedges on a vanished officeholder.
- Every state change emits a `coordination_events` row; nothing is destructively deleted; a `closed` topic has a complete, sealed trail; `closing → closed` is provably terminating (the drain set only shrinks).
- A request-approval can route through ≥2 levels (rules snapshotted at submission); a decision body can carry a motion under a weighted-vote rule with quorum, and a `veto_holders` member can override a carried motion (veto atomic with tally).
- An intake `violation_report` and a `dispute` each triage into the existing primitives.
- The GUI shows a live topic via SSE with no polling.
- Run 1's contention scenario, re-run, produces real arbitration with a full event trail.

### Open questions (instantiation-level — to settle in the sprints)
1. Exact derived `artifact_id` scheme and its URL-safety / length bounds.
2. `coordination_events.seq` allocation under concurrency (per-topic counter row vs advisory lock). *(seq's gap-tolerance is specified — C.1.)*
3. Level-hierarchy configuration — per-project table vs server config; may a topic override it? *(If a topic may override, the request-route rules-snapshot — B.7 — already isolates in-flight requests from the change.)*
4. Migration of existing Phase 13 `artifact_leases` / `review_requests` rows into the new shape.
5. SSE for agents — replay-cursor only, or also a bounded live stream when an agent stays alive across sub-tasks?
6. **A2A interop bridge** *[rev2]* — how an external A2A agent joins a Topic and participates; what A2A-compatible surface (agent card, task object) the Board / event-log exposes.
7. *[rev3]* Default values for the two new timeouts — the initial `request_steps.deadline` and the sweep interval. *[rev4]* (An escalated step's *fresh* deadline is decided — C.4; only the initial-deadline default, and whether it is per-step or inherited from the request, remain open.)

*(Rev-1 open-question on `fencing_token` is resolved: a global monotonic sequence, checked at the artifact alongside claim-liveness — C.1, C.2.)*

---

*This is a design document, **rev 4 — the terminal design revision**. It passed three cold-start adversarial review rounds: rev 1→2 (9 findings) + a 2026 agent-market comparison; rev 2→3 (7 fix-interaction findings); rev 3→4 (3 blockers + 4 one-line decisions). rev 4 resolves all blockers and adds **no new mechanism** — only clarifications — so the review→fix loop terminates here. The Phase 13 review + Run 1 are the evidence base; `docs/phase-13-design.md` is the immediate predecessor. The design is BUILD-ready; Sprint 15.1 is the entry point.*
