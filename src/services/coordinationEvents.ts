/**
 * Phase 15 Sprint 15.1 — Coordination event log.
 *
 * Design ref: docs/specs/2026-05-16-phase-15-sprint-15.1-design.md §3
 *
 * The event log is the append-only spine of the coordination protocol — every
 * state change emits a row here. `appendEvent` MUST run inside the caller's
 * transaction (it takes a PoolClient) so the state change and its event commit
 * atomically; `replayEvents` is a standalone cursor read.
 */

import type { Pool, PoolClient } from 'pg';
import { getDbPool } from '../db/client.js';
import { ContextHubError } from '../core/errors.js';
import { EVENT_TYPE_SET, SUBJECT_TYPE_SET } from './coordinationConstants.js';

const DEFAULT_REPLAY_LIMIT = 1000;

export type CoordinationEventInput = {
  topic_id: string;
  actor_id: string;
  type: string;          // validated against EVENT_TYPE_SET
  subject_type: string;  // validated against SUBJECT_TYPE_SET
  subject_id: string;
  payload?: Record<string, unknown>;
};

export type CoordinationEvent = {
  topic_id: string;
  seq: number;
  event_id: string;
  ts: string;
  actor_id: string;
  type: string;
  subject_type: string;
  subject_id: string;
  payload: Record<string, unknown>;
};

export type ReplayResult = {
  topic_id: string;
  events: CoordinationEvent[];
  next_cursor: number;
  /**
   * [MED-5] true when the page was capped at `limit` — more events may exist
   * past `next_cursor`. A client treating `next_cursor` as "caught up" must
   * keep replaying while `has_more` is true. false ⇒ this page is the tail.
   */
  has_more: boolean;
};

export type AppendResult = { seq: number; event_id: string; ts: string };

/**
 * Append an event to a topic's log. MUST be called inside an open transaction
 * (it takes a PoolClient, never a Pool) so the caller's state change and this
 * event commit together.
 *
 * Allocates `seq` and enforces the seal in one statement: the UPDATE carries
 * `WHERE status <> 'closed'`, so an append to a closed (or missing) topic is
 * rejected. On a 0-row match a follow-up SELECT distinguishes the two — a
 * missing topic → NOT_FOUND, a closed one → BAD_REQUEST ([LOW-12]). That UPDATE
 * also takes the topics-row lock — the per-topic append serializer — held to the
 * end of the caller's transaction, which makes per-topic `seq` monotonic and
 * (with the same-txn increment) gap-free.
 */
export async function appendEvent(
  client: PoolClient,
  evt: CoordinationEventInput,
): Promise<AppendResult> {
  if (!EVENT_TYPE_SET.has(evt.type)) {
    throw new ContextHubError('BAD_REQUEST', `unknown event type: ${evt.type}`);
  }
  if (!SUBJECT_TYPE_SET.has(evt.subject_type)) {
    throw new ContextHubError('BAD_REQUEST', `unknown subject_type: ${evt.subject_type}`);
  }

  // Step 1: allocate seq + enforce the seal (status <> 'closed') in one statement.
  // BIGINT comes back from pg as a string — Number() is safe (seq << 2^53).
  const seqRes = await client.query<{ next_seq: string }>(
    `UPDATE topics SET next_seq = next_seq + 1
     WHERE topic_id = $1 AND status <> 'closed'
     RETURNING next_seq`,
    [evt.topic_id],
  );
  if (seqRes.rowCount === 0) {
    // [LOW-12] the seal matched 0 rows — distinguish a CLOSED topic from a
    // MISSING one. callers relying on the task-row FK assume the topic exists;
    // a missing topic is a NOT_FOUND, a closed one is a BAD_REQUEST.
    const topicRes = await client.query<{ status: string }>(
      `SELECT status FROM topics WHERE topic_id = $1`,
      [evt.topic_id],
    );
    if (topicRes.rowCount === 0) {
      throw new ContextHubError('NOT_FOUND', `topic ${evt.topic_id} does not exist`);
    }
    throw new ContextHubError('BAD_REQUEST', `topic ${evt.topic_id} is closed`);
  }
  const seq = Number(seqRes.rows[0].next_seq);

  // Step 2: insert the event.
  const insRes = await client.query<{ event_id: string; ts: Date }>(
    `INSERT INTO coordination_events
       (topic_id, seq, actor_id, type, subject_type, subject_id, payload)
     VALUES ($1, $2, $3, $4, $5, $6, $7)
     RETURNING event_id, ts`,
    [
      evt.topic_id, seq, evt.actor_id, evt.type, evt.subject_type, evt.subject_id,
      JSON.stringify(evt.payload ?? {}),
    ],
  );
  const row = insRes.rows[0];
  return { seq, event_id: row.event_id, ts: row.ts.toISOString() };
}

/**
 * Replay a topic's event log from a cursor. Standalone read; pass a PoolClient
 * as `executor` to join an open transaction (`joinTopic` does this for a
 * coherent induction-pack snapshot — design §4.2).
 *
 * The cursor is a high-water mark: returns events with `seq > since_seq`,
 * ordered by `seq` — it never waits for a missing seq.
 *
 * Sprint 15.12 (DEFERRED-010) — `tail: true` returns the most-recent N events
 * (the TAIL of the log) instead of the oldest N from the cursor. Used by
 * joinTopic's fresh-join induction pack so a joiner on a >N-event topic gets
 * recent context (incl. their own topic.actor_joined) rather than the oldest
 * prefix. `your_cursor`/`next_cursor` = max seq (primed to HEAD); `has_more`
 * = older events exist before the window.
 */
export async function replayEvents(
  params: { topic_id: string; since_seq?: number; limit?: number; tail?: boolean },
  executor: Pool | PoolClient = getDbPool(),
): Promise<ReplayResult> {
  const sinceSeq = params.since_seq ?? 0;
  const limit = params.limit ?? DEFAULT_REPLAY_LIMIT;

  const topicRes = await executor.query(
    `SELECT 1 FROM topics WHERE topic_id = $1`,
    [params.topic_id],
  );
  if (topicRes.rowCount === 0) {
    throw new ContextHubError('NOT_FOUND', `topic ${params.topic_id} not found`);
  }

  const cols = `seq, event_id, ts, actor_id, type, subject_type, subject_id, payload`;
  type Row = {
    seq: string; event_id: string; ts: Date; actor_id: string;
    type: string; subject_type: string; subject_id: string;
    payload: Record<string, unknown>;
  };

  let rows: Row[];
  if (params.tail) {
    // TAIL mode — most-recent N events, fetched DESC then re-sorted ASC.
    const evRes = await executor.query<Row>(
      `SELECT ${cols} FROM coordination_events
       WHERE topic_id = $1
       ORDER BY seq DESC
       LIMIT $2`,
      [params.topic_id, limit],
    );
    rows = evRes.rows.reverse(); // DESC → ASC
  } else {
    const evRes = await executor.query<Row>(
      `SELECT ${cols} FROM coordination_events
       WHERE topic_id = $1 AND seq > $2
       ORDER BY seq ASC
       LIMIT $3`,
      [params.topic_id, sinceSeq, limit],
    );
    rows = evRes.rows;
  }

  const events: CoordinationEvent[] = rows.map((r) => ({
    topic_id: params.topic_id,
    seq: Number(r.seq),
    event_id: r.event_id,
    ts: r.ts.toISOString(),
    actor_id: r.actor_id,
    type: r.type,
    subject_type: r.subject_type,
    subject_id: r.subject_id,
    payload: r.payload,
  }));

  if (params.tail) {
    // next_cursor = max seq (primed to HEAD). has_more: older events exist before
    // the window only when we filled the page; otherwise the window covers all.
    // rev 2 (F3) — EXISTS(seq < min), no full COUNT.
    const next_cursor = events.length > 0 ? events[events.length - 1].seq : sinceSeq;
    let has_more = false;
    if (events.length === limit) {
      const minSeq = events[0].seq;
      const moreRes = await executor.query(
        `SELECT 1 FROM coordination_events WHERE topic_id = $1 AND seq < $2 LIMIT 1`,
        [params.topic_id, minSeq],
      );
      has_more = (moreRes.rowCount ?? 0) > 0;
    }
    return { topic_id: params.topic_id, events, next_cursor, has_more };
  }

  const next_cursor = events.length > 0 ? events[events.length - 1].seq : sinceSeq;
  // [MED-5] a full page (exactly `limit` rows) signals possible truncation —
  // the SQL `LIMIT $3` used `limit`, so this is the correct effective cap.
  const has_more = events.length === limit;
  return { topic_id: params.topic_id, events, next_cursor, has_more };
}
