# Phase 15 Sprint 15.1 — QC: Acceptance-Criteria Coverage Matrix

**Phase:** QC (8/12) · **Date:** 2026-05-16 · **Task:** phase-15-sprint-15.1-substrate
**Design:** `docs/specs/2026-05-16-phase-15-sprint-15.1-design.md` (rev 5, spec_hash `fb2378e35e2d810e`)
**CLARIFY (the 13 ACs):** `docs/specs/2026-05-16-phase-15-sprint-15.1-clarify.md`

Each of the 13 CLARIFY acceptance criteria, with its evidence. Test names are the actual
`node:test` test names (run via `npm test` — 329/329 pass). Smoke = VERIFY live smoke
against the deployed Docker stack.

| AC | Criterion | Status | Evidence |
|----|-----------|--------|----------|
| **AC1** | Migration 0053 applies cleanly + idempotent; 4 tables; `coordination_events` PK `(topic_id,seq)` | ✅ COVERED | `npm run migrate` applied `0053` (VERIFY); runner skips already-applied migrations + all DDL is `CREATE … IF NOT EXISTS` (idempotent); `migrations/0053_coordination_substrate.sql` defines the 4 tables + `PRIMARY KEY (topic_id, seq)`. |
| **AC2** | `charter_topic` / `POST /topics` → `chartered` topic, emits `topic.chartered` seq=1 in one txn | ✅ COVERED | `topics.test.ts`: *"charterTopic creates a chartered topic and emits topic.chartered at seq 1"*; smoke step 1. Same-txn: `topics.ts` `charterTopic` (INSERT + `appendEvent` in one `BEGIN…COMMIT`). |
| **AC3** | `join_topic` / `POST /:id/join` auto-registers actor, inserts participant, emits `topic.actor_joined`, flips `chartered→active`, returns induction pack | ✅ COVERED | `topics.test.ts`: *"joinTopic registers actor + participant, emits topic.actor_joined, flips to active"*; smoke step 2 (pack with `topic`/`roster`/`events`/`your_cursor`). |
| **AC4** | Re-join idempotent (no dup row/event); conflicting `actor_type` rejected | ✅ COVERED | `topics.test.ts`: *"joinTopic re-join is idempotent; the since_seq>0 re-prime pack is coherent"* + *"…conflicting actor_type throws BAD_REQUEST"*. |
| **AC5** | `get_topic` / `GET /:id` → topic + roster | ✅ COVERED | `topics.test.ts`: *"getTopic returns the topic + full roster; NOT_FOUND for an unknown topic"*; smoke step 3. |
| **AC6** | `close_topic` / `POST /:id/close`: `chartered\|active→closed`, `topic.closed` final; sealed afterward | ✅ COVERED | `topics.test.ts`: *"closeTopic emits topic.closed last, seals the log, and is idempotent"*; `coordinationEvents.test.ts`: *"appendEvent on a closed topic throws (the seal)"*; smoke step 5. |
| **AC7** | `replay_topic_events` / `GET /:id/events?since` → `seq>cursor` ordered; cursor high-water | ✅ COVERED | `coordinationEvents.test.ts`: *"replayEvents returns events seq > cursor, ascending"*, *"…past the end returns empty, next_cursor = input cursor"*, *"…honors the limit; the cursor continues the read correctly"*; smoke step 4. |
| **AC8** | `seq` monotonic per topic, transactionally allocated; concurrent appends → distinct increasing, no 500 | ✅ COVERED | `coordinationEvents.test.ts`: *"appendEvent allocates seq 1,2,3 monotonically"* + *"concurrent appendEvent: seqs are exactly 1..N, distinct, no error"* (`Promise.all` of 5). |
| **AC9** | `GET /:id/stream` (SSE) pushes events; cleans up on client disconnect | ✅ COVERED | `src/api/routes/topics.test.ts` (new, design rev 5): *"SSE stream of a closed topic delivers the backlog and ends with stream_end"*, *"…unknown topic returns 404"*, *"…runs cleanup exactly once on client disconnect"*; smoke steps 6–7. |
| **AC10** | Actor identity project-scoped: same `actor_id` in 2 projects → 2 distinct `actors` rows | ✅ COVERED | `topics.test.ts`: *"actor identity is project-scoped: same actor_id in two projects = two actors rows"*. |
| **AC11** | REST mirrors the 5 MCP tools 1:1; one envelope `{status,data?,error?}`; SSE GUI-only | ✅ COVERED | 5 MCP tools verified in `tools/list` + a clean `charter_topic` `tools/call` (MCP smoke); 6 REST endpoints (5 mirrored + SSE) verified live (REST smoke) — all return `{status:'ok',data}` / router-local `{status:'error',…}`; SSE has no MCP tool (design §6). |
| **AC12** | `tsc --noEmit` clean; new unit tests pass; existing suite green | ✅ COVERED | `npx tsc -p tsconfig.json --noEmit` exit 0; `npm test` **329/329** (308 prior + 21 new: coordinationEvents 11, topics 7, topics-routes/SSE 3). |
| **AC13** | Live smoke: charter→join→get→replay→close; event log shows the 3 events in seq order | ✅ COVERED | VERIFY live smoke against the deployed stack — `GET /:id/events` returned `[(1,'topic.chartered'),(2,'topic.actor_joined')]`, post-close SSE backlog showed seq 1/2/3 = chartered/actor_joined/closed. |

## Summary

- **13 / 13 ACs COVERED.** 0 not-covered, 0 partial.
- **Spec drift:** the design moved rev 4 → rev 5 (`892ef920d6628657` → `fb2378e35e2d810e`),
  an *explained* change — REVIEW-CODE WARN-1 (the §4.2/§9.8 induction-pack coherence
  invariant was overstated past the replay cap; corrected to honest cursor-pagination
  wording). Logged in `AUDIT_LOG.jsonl` (`fixes_applied`, review-code phase). No
  unexplained drift.
- **Findings:** design review r1–r3 — 9 findings (4 BLOCK, 5 WARN) all resolved across
  rev 2→4. code review r1 — 3 WARN, **0 BLOCK**: WARN-1 + WARN-3 fixed; WARN-2 + WARN-1's
  pagination residual deferred (DEFERRED-009, DEFERRED-010). **No unresolved BLOCK.**
- **Deferred:** DEFERRED-009 (cross-project topic scope) and DEFERRED-010 (real
  induction-pack pagination) — both OPEN, both with trigger conditions that are **not** met
  in this sprint (15.1 ships no auth and no >1000-event topics).
- **Build/connection-management note:** the only post-REVIEW-CODE production-code change is
  the `_activeStreamCountForTest` counter hook in `routes/topics.ts` — test-only
  instrumentation (a counter inc/dec), behaviourally inert; the deployed SSE behaviour is
  unchanged from the VERIFY live smoke.

QC verdict: **all ACs covered, no unresolved BLOCK, drift explained** — ready for the
POST-REVIEW Scope Guard final gate.
