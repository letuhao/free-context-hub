/**
 * Phase 15 Sprint 15.1 — coordinationEvents unit tests.
 *
 * Design ref: docs/specs/2026-05-16-phase-15-sprint-15.1-design.md §8 (T1–T5).
 * Harness mirrored from src/services/artifactLeases.test.ts — real test DB via
 * DATABASE_URL; each test makes a throwaway topic; cleanup deletes by project.
 *
 * Covers:
 *   - appendEvent allocates seq 1,2,3… monotonically
 *   - appendEvent rejects an unknown type / subject_type
 *   - appendEvent on a closed (or missing) topic throws — the seal
 *   - concurrent appendEvent → distinct increasing seqs, no error
 *   - replayEvents cursor semantics + PoolClient executor + NOT_FOUND
 */

import assert from 'node:assert/strict';
import test, { before, after, beforeEach } from 'node:test';
import { appendEvent, replayEvents } from './coordinationEvents.js';
import type { CoordinationEventInput, AppendResult } from './coordinationEvents.js';
import { getDbPool } from '../db/client.js';

const TEST_PROJECT = '__test_coordination_events__';

async function cleanup() {
  const pool = getDbPool();
  await pool.query(
    `DELETE FROM coordination_events WHERE topic_id IN
       (SELECT topic_id FROM topics WHERE project_id = $1)`,
    [TEST_PROJECT],
  );
  await pool.query(`DELETE FROM topics WHERE project_id = $1`, [TEST_PROJECT]);
  await pool.query(`DELETE FROM actors WHERE project_id = $1`, [TEST_PROJECT]);
}

async function makeTopic(topicId: string, status = 'active'): Promise<void> {
  const pool = getDbPool();
  await pool.query(
    `INSERT INTO topics (topic_id, project_id, name, charter, status, next_seq, created_by)
     VALUES ($1, $2, 'test topic', 'test charter', $3, 0, 'test-creator')`,
    [topicId, TEST_PROJECT, status],
  );
}

/** Run appendEvent inside its own transaction — the real call contract. */
async function appendInTxn(evtInput: CoordinationEventInput): Promise<AppendResult> {
  const pool = getDbPool();
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const r = await appendEvent(client, evtInput);
    await client.query('COMMIT');
    return r;
  } catch (e) {
    await client.query('ROLLBACK').catch(() => {});
    throw e;
  } finally {
    client.release();
  }
}

function evt(topicId: string, over: Partial<CoordinationEventInput> = {}): CoordinationEventInput {
  return {
    topic_id: topicId,
    actor_id: 'actor-1',
    type: 'topic.actor_joined',
    subject_type: 'topic',
    subject_id: topicId,
    payload: {},
    ...over,
  };
}

before(cleanup);
after(cleanup);
beforeEach(cleanup);

test('appendEvent allocates seq 1,2,3 monotonically', async () => {
  await makeTopic('ce-seq');
  const r1 = await appendInTxn(evt('ce-seq'));
  const r2 = await appendInTxn(evt('ce-seq'));
  const r3 = await appendInTxn(evt('ce-seq'));
  assert.equal(r1.seq, 1);
  assert.equal(r2.seq, 2);
  assert.equal(r3.seq, 3);
  assert.ok(r1.event_id && r2.event_id && r3.event_id, 'each event has an event_id');
});

test('appendEvent rejects an unknown event type', async () => {
  await makeTopic('ce-badtype');
  await assert.rejects(
    appendInTxn(evt('ce-badtype', { type: 'bogus.event' })),
    /unknown event type/,
  );
});

test('appendEvent rejects an unknown subject_type', async () => {
  await makeTopic('ce-badsubj');
  await assert.rejects(
    appendInTxn(evt('ce-badsubj', { subject_type: 'bogus' })),
    /unknown subject_type/,
  );
});

test('appendEvent on a closed topic throws (the seal)', async () => {
  await makeTopic('ce-closed', 'closed');
  await assert.rejects(
    appendInTxn(evt('ce-closed')),
    /closed or does not exist/,
  );
});

test('appendEvent on a missing topic throws', async () => {
  await assert.rejects(
    appendInTxn(evt('ce-nonexistent')),
    /closed or does not exist/,
  );
});

test('concurrent appendEvent: seqs are exactly 1..N, distinct, no error', async () => {
  await makeTopic('ce-race');
  const N = 5;
  const results = await Promise.all(
    Array.from({ length: N }, (_, i) =>
      appendInTxn(evt('ce-race', { actor_id: `actor-${i}` })),
    ),
  );
  const seqs = results.map((r) => r.seq).sort((a, b) => a - b);
  assert.deepEqual(seqs, [1, 2, 3, 4, 5]);
  assert.equal(new Set(seqs).size, N, 'all seqs distinct');
});

test('replayEvents returns events seq > cursor, ascending', async () => {
  await makeTopic('ce-replay');
  await appendInTxn(evt('ce-replay'));
  await appendInTxn(evt('ce-replay'));
  await appendInTxn(evt('ce-replay'));

  const all = await replayEvents({ topic_id: 'ce-replay' });
  assert.equal(all.events.length, 3);
  assert.deepEqual(all.events.map((e) => e.seq), [1, 2, 3]);
  assert.equal(all.next_cursor, 3);

  const fromCursor = await replayEvents({ topic_id: 'ce-replay', since_seq: 2 });
  assert.equal(fromCursor.events.length, 1);
  assert.equal(fromCursor.events[0].seq, 3);
  assert.equal(fromCursor.next_cursor, 3);
});

test('replayEvents past the end returns empty, next_cursor = input cursor', async () => {
  await makeTopic('ce-empty');
  await appendInTxn(evt('ce-empty'));
  const r = await replayEvents({ topic_id: 'ce-empty', since_seq: 99 });
  assert.equal(r.events.length, 0);
  assert.equal(r.next_cursor, 99);
});

test('replayEvents throws NOT_FOUND for an unknown topic', async () => {
  await assert.rejects(
    replayEvents({ topic_id: 'ce-does-not-exist' }),
    /not found/,
  );
});

test('replayEvents accepts a PoolClient executor (joins an open transaction)', async () => {
  await makeTopic('ce-client');
  await appendInTxn(evt('ce-client'));
  const pool = getDbPool();
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const r = await replayEvents({ topic_id: 'ce-client' }, client);
    await client.query('COMMIT');
    assert.equal(r.events.length, 1);
    assert.equal(r.events[0].seq, 1);
  } finally {
    client.release();
  }
});

test('replayEvents honors the limit; the cursor continues the read correctly', async () => {
  await makeTopic('ce-paginate');
  await appendInTxn(evt('ce-paginate'));
  await appendInTxn(evt('ce-paginate'));
  await appendInTxn(evt('ce-paginate'));
  // limit 2 → first page is the oldest 2; next_cursor is that page's high-water mark
  const page1 = await replayEvents({ topic_id: 'ce-paginate', limit: 2 });
  assert.deepEqual(page1.events.map((e) => e.seq), [1, 2]);
  assert.equal(page1.next_cursor, 2);
  // continuing from next_cursor returns the remainder — no gap, no overlap
  const page2 = await replayEvents({ topic_id: 'ce-paginate', since_seq: page1.next_cursor, limit: 2 });
  assert.deepEqual(page2.events.map((e) => e.seq), [3]);
  assert.equal(page2.next_cursor, 3);
});
