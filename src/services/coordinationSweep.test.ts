/**
 * Phase 15 Sprint 15.2 — coordinationSweep service unit tests.
 *
 * Design ref: docs/specs/2026-05-16-phase-15-sprint-15.2-design.md §8 (T13–T17).
 * Harness mirrored from src/services/artifactLeases.test.ts. Setup uses
 * postTask / claimTask / writeArtifact / baselineArtifact — runs after T2/T4.
 *
 * Covers:
 *   T13 an expired claim → task posted, claim.expired emitted, claim gone
 *   T14 sweep reverts a never-baselined artifact to draft
 *   T15 sweep reverts a baselined-then-edited artifact to its last baselined
 *       version — never un-baselines; accepted_fencing_token unchanged
 *   T16 an expired claim on a closed topic → claim dropped, artifact NOT
 *       reverted, no event
 *   T17 a batch with one un-recoverable claim + one good claim → the good one
 *       is still recovered (the bad one's failure does not abort the cycle)
 */

import assert from 'node:assert/strict';
import test, { before, after, beforeEach } from 'node:test';
import { sweepAbandonedClaims } from './coordinationSweep.js';
import { postTask, claimTask } from './board.js';
import { writeArtifact, baselineArtifact } from './artifacts.js';
import { charterTopic, joinTopic, closeTopic } from './topics.js';
import { replayEvents } from './coordinationEvents.js';
import { getDbPool } from '../db/client.js';

const TEST_PROJECT = '__test_coordination_sweep__';

async function cleanup() {
  const pool = getDbPool();
  const topicIds = await pool.query<{ topic_id: string }>(
    `SELECT topic_id FROM topics WHERE project_id = $1`,
    [TEST_PROJECT],
  );
  for (const { topic_id } of topicIds.rows) {
    await pool.query(`DELETE FROM claims WHERE topic_id = $1`, [topic_id]);
    await pool.query(
      `DELETE FROM artifact_versions WHERE artifact_id IN
         (SELECT artifact_id FROM artifacts WHERE topic_id = $1)`,
      [topic_id],
    );
    await pool.query(`DELETE FROM artifacts WHERE topic_id = $1`, [topic_id]);
    await pool.query(`DELETE FROM tasks WHERE topic_id = $1`, [topic_id]);
    await pool.query(`DELETE FROM coordination_events WHERE topic_id = $1`, [topic_id]);
  }
  await pool.query(`DELETE FROM topics WHERE project_id = $1`, [TEST_PROJECT]);
  await pool.query(`DELETE FROM actors WHERE project_id = $1`, [TEST_PROJECT]);
}

before(cleanup);
after(cleanup);
beforeEach(cleanup);

async function mkActiveTopic(): Promise<string> {
  const t = await charterTopic({
    project_id: TEST_PROJECT, name: 'Sweep Test',
    charter: 'recover abandoned claims', created_by: 'creator-1',
  });
  await joinTopic({
    topic_id: t.topic_id, actor_id: 'creator-1', actor_type: 'ai',
    display_name: 'Creator', level: 'coordination',
  });
  return t.topic_id;
}

async function postAndClaim(topicId: string, slot: string, actorId = 'worker-1') {
  const task = await postTask({
    topic_id: topicId, title: `task ${slot}`, topology: 'parallel',
    slot, kind: 'document', created_by: 'creator-1',
  });
  const claim = await claimTask({ task_id: task.task_id, actor_id: actorId });
  assert.equal(claim.status, 'claimed');
  if (claim.status !== 'claimed') throw new Error('setup: claim failed');
  return {
    task_id: task.task_id,
    artifact_id: task.artifact_id,
    claim_id: claim.claim_id,
    fencing_token: claim.fencing_token,
  };
}

/** Force-expire every claim on an artifact (simulate an abandoned claim). */
async function expireClaims(artifactId: string) {
  const pool = getDbPool();
  await pool.query(
    `UPDATE claims SET expires_at = now() - interval '10 minutes' WHERE artifact_id = $1`,
    [artifactId],
  );
}

// ── T13 ─────────────────────────────────────────────────────────────────────

test('T13: an expired claim → task posted, claim.expired emitted, claim gone', async () => {
  const topicId = await mkActiveTopic();
  const s = await postAndClaim(topicId, 'doc');
  // task is 'claimed'
  await expireClaims(s.artifact_id);

  const result = await sweepAbandonedClaims();
  assert.equal(result.recovered, 1);

  const pool = getDbPool();
  const t = await pool.query<{ status: string }>(
    `SELECT status FROM tasks WHERE task_id = $1`, [s.task_id],
  );
  assert.equal(t.rows[0].status, 'posted', 'task returns to the board');
  const claims = await pool.query<{ n: number }>(
    `SELECT COUNT(*)::int AS n FROM claims WHERE claim_id = $1`, [s.claim_id],
  );
  assert.equal(claims.rows[0].n, 0, 'expired claim row deleted');

  const ev = await replayEvents({ topic_id: topicId });
  const types = ev.events.map((e) => e.type);
  assert.ok(types.includes('claim.expired'), 'claim.expired emitted');
  assert.ok(types.includes('task.released'), 'task.released emitted');
});

test('T13: a sweep with no expired claims is a no-op', async () => {
  const topicId = await mkActiveTopic();
  await postAndClaim(topicId, 'fresh'); // a live claim — not expired
  const result = await sweepAbandonedClaims();
  assert.equal(result.recovered, 0);
});

// ── T14 ─────────────────────────────────────────────────────────────────────

test('T14: sweep reverts a never-baselined artifact to draft', async () => {
  const topicId = await mkActiveTopic();
  const s = await postAndClaim(topicId, 'nb');
  // write once → artifact is 'working' v2, never baselined
  const w = await writeArtifact({
    artifact_id: s.artifact_id, claim_id: s.claim_id, fencing_token: s.fencing_token,
    content_ref: 'ref://working-content', actor_id: 'worker-1',
  });
  assert.equal(w.status, 'ok');
  await expireClaims(s.artifact_id);

  const result = await sweepAbandonedClaims();
  assert.equal(result.recovered, 1);

  const pool = getDbPool();
  const art = await pool.query<{ state: string; content_ref: string | null }>(
    `SELECT state, content_ref FROM artifacts WHERE artifact_id = $1`, [s.artifact_id],
  );
  assert.equal(art.rows[0].state, 'draft', 'no baseline → reverted to draft');
  assert.equal(art.rows[0].content_ref, null, 'draft revert clears content_ref');
  const ver = await pool.query<{ note: string }>(
    `SELECT note FROM artifact_versions WHERE artifact_id = $1 ORDER BY version DESC LIMIT 1`,
    [s.artifact_id],
  );
  assert.equal(ver.rows[0].note, 'reverted to draft');
});

// ── T15 ─────────────────────────────────────────────────────────────────────

test('T15: sweep reverts a baselined-then-edited artifact to its last baselined version; accepted_fencing_token unchanged', async () => {
  const topicId = await mkActiveTopic();
  const s = await postAndClaim(topicId, 'be');
  // write → working v2
  await writeArtifact({
    artifact_id: s.artifact_id, claim_id: s.claim_id, fencing_token: s.fencing_token,
    content_ref: 'ref://pre-baseline', actor_id: 'worker-1',
  });
  // baseline → baselined v3 (content_ref carried forward = ref://pre-baseline)
  const b = await baselineArtifact({
    artifact_id: s.artifact_id, claim_id: s.claim_id, fencing_token: s.fencing_token,
    actor_id: 'worker-1',
  });
  assert.equal(b.status, 'ok');
  // edit again → working v4 with new content
  await writeArtifact({
    artifact_id: s.artifact_id, claim_id: s.claim_id, fencing_token: s.fencing_token,
    content_ref: 'ref://post-baseline-edit', actor_id: 'worker-1',
  });

  const pool = getDbPool();
  const before = await pool.query<{ accepted_fencing_token: string }>(
    `SELECT accepted_fencing_token FROM artifacts WHERE artifact_id = $1`, [s.artifact_id],
  );
  const tokenBefore = Number(before.rows[0].accepted_fencing_token);

  await expireClaims(s.artifact_id);
  const result = await sweepAbandonedClaims();
  assert.equal(result.recovered, 1);

  const art = await pool.query<{ state: string; content_ref: string | null; accepted_fencing_token: string }>(
    `SELECT state, content_ref, accepted_fencing_token FROM artifacts WHERE artifact_id = $1`,
    [s.artifact_id],
  );
  assert.equal(art.rows[0].state, 'baselined', 'reverted to baselined, never un-baselined');
  assert.equal(art.rows[0].content_ref, 'ref://pre-baseline', 'content reverted to the last baseline');
  assert.equal(
    Number(art.rows[0].accepted_fencing_token), tokenBefore,
    'accepted_fencing_token unchanged by the revert (monotonic)',
  );
  const ver = await pool.query<{ note: string }>(
    `SELECT note FROM artifact_versions WHERE artifact_id = $1 ORDER BY version DESC LIMIT 1`,
    [s.artifact_id],
  );
  assert.match(ver.rows[0].note, /^reverted to v\d+$/, 'revert note names the baselined version');
});

// ── T16 ─────────────────────────────────────────────────────────────────────

test('T16: an expired claim on a closed topic → claim dropped, artifact NOT reverted, no event', async () => {
  const topicId = await mkActiveTopic();
  const s = await postAndClaim(topicId, 'ct');
  // write → working v2
  await writeArtifact({
    artifact_id: s.artifact_id, claim_id: s.claim_id, fencing_token: s.fencing_token,
    content_ref: 'ref://working', actor_id: 'worker-1',
  });
  await expireClaims(s.artifact_id);
  await closeTopic({ topic_id: topicId, actor_id: 'creator-1' });

  const pool = getDbPool();
  const evBefore = await replayEvents({ topic_id: topicId });
  const evCountBefore = evBefore.events.length;
  const artBefore = await pool.query<{ state: string; version: number }>(
    `SELECT state, version FROM artifacts WHERE artifact_id = $1`, [s.artifact_id],
  );

  const result = await sweepAbandonedClaims();
  assert.equal(result.recovered, 1, 'closed-topic claim is counted as recovered (the claim is dropped)');

  const claims = await pool.query<{ n: number }>(
    `SELECT COUNT(*)::int AS n FROM claims WHERE claim_id = $1`, [s.claim_id],
  );
  assert.equal(claims.rows[0].n, 0, 'dangling claim dropped');

  const artAfter = await pool.query<{ state: string; version: number }>(
    `SELECT state, version FROM artifacts WHERE artifact_id = $1`, [s.artifact_id],
  );
  assert.equal(artAfter.rows[0].state, artBefore.rows[0].state, 'artifact state unchanged');
  assert.equal(artAfter.rows[0].version, artBefore.rows[0].version, 'artifact NOT reverted');

  const evAfter = await replayEvents({ topic_id: topicId });
  assert.equal(evAfter.events.length, evCountBefore, 'no event emitted on a closed topic');
});

// ── T17 ─────────────────────────────────────────────────────────────────────

test('T17: a batch with one un-recoverable claim + one good claim → the good one is still recovered', async () => {
  const topicId = await mkActiveTopic();
  // good claim
  const good = await postAndClaim(topicId, 'good', 'worker-good');
  // un-recoverable claim — we pre-insert an artifact_versions row at the version
  // revertArtifact will try to write (current version + 1), so its INSERT raises
  // a 23505 PK violation → the §0.1-loop catch logs and continues.
  const bad = await postAndClaim(topicId, 'bad', 'worker-bad');

  const pool = getDbPool();
  const curVer = await pool.query<{ version: number }>(
    `SELECT version FROM artifacts WHERE artifact_id = $1`, [bad.artifact_id],
  );
  const collidingVersion = curVer.rows[0].version + 1;
  await pool.query(
    `INSERT INTO artifact_versions (artifact_id, version, state, content_ref, fencing_token, note, created_by)
     VALUES ($1, $2, 'draft', NULL, NULL, 'planted-collision', 'test')`,
    [bad.artifact_id, collidingVersion],
  );

  await expireClaims(good.artifact_id);
  await expireClaims(bad.artifact_id);

  const result = await sweepAbandonedClaims();
  // the good claim is recovered; the bad one's failure does not abort the cycle.
  assert.equal(result.recovered, 1, 'exactly the good claim is recovered');

  // good task returned to the board
  const goodTask = await pool.query<{ status: string }>(
    `SELECT status FROM tasks WHERE task_id = $1`, [good.task_id],
  );
  assert.equal(goodTask.rows[0].status, 'posted', 'good task recovered despite the bad claim');
  const goodClaims = await pool.query<{ n: number }>(
    `SELECT COUNT(*)::int AS n FROM claims WHERE claim_id = $1`, [good.claim_id],
  );
  assert.equal(goodClaims.rows[0].n, 0, 'good claim row deleted');

  // bad claim — recovery rolled back; the claim row is still present.
  const badClaims = await pool.query<{ n: number }>(
    `SELECT COUNT(*)::int AS n FROM claims WHERE claim_id = $1`, [bad.claim_id],
  );
  assert.equal(badClaims.rows[0].n, 1, 'un-recoverable claim left intact for a retry');
});
