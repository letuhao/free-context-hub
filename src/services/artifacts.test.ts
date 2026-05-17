/**
 * Phase 15 Sprint 15.2 — artifacts service unit tests.
 *
 * Design ref: docs/specs/2026-05-16-phase-15-sprint-15.2-design.md §8 (T8–T12).
 * Harness mirrored from src/services/artifactLeases.test.ts. Setup uses
 * postTask / claimTask (board.ts) — runs after T2.
 *
 * Covers:
 *   T8  writeArtifact w/ a live claim + valid token → version++, an
 *       artifact_versions row, draft→working
 *   T9  write w/ fencing_token < accepted_fencing_token → conflict
 *   T10 write w/ an expired claim_id → conflict
 *   T11 write to a for_review artifact → conflict
 *   T12 baselineArtifact working→baselined
 */

import assert from 'node:assert/strict';
import test, { before, after, beforeEach } from 'node:test';
import { writeArtifact, baselineArtifact } from './artifacts.js';
import { postTask, claimTask, completeTask } from './board.js';
import { charterTopic, joinTopic } from './topics.js';
import { getDbPool } from '../db/client.js';

const TEST_PROJECT = '__test_artifacts__';

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
    project_id: TEST_PROJECT, name: 'Artifacts Test',
    charter: 'write artifacts', created_by: 'creator-1',
  });
  await joinTopic({
    topic_id: t.topic_id, actor_id: 'creator-1', actor_type: 'ai',
    display_name: 'Creator', level: 'coordination',
  });
  return t.topic_id;
}

/**
 * Post a task, claim it — returns the artifact_id + the live claim's
 * claim_id/fencing_token. The common setup for an artifact-write test.
 */
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

async function expireClaims(artifactId: string) {
  const pool = getDbPool();
  await pool.query(
    `UPDATE claims SET expires_at = now() - interval '1 minute' WHERE artifact_id = $1`,
    [artifactId],
  );
}

// ── T8 ──────────────────────────────────────────────────────────────────────

test('T8: writeArtifact w/ a live claim + valid token → version++, artifact_versions row, draft→working', async () => {
  const topicId = await mkActiveTopic();
  const s = await postAndClaim(topicId, 'doc');

  const r = await writeArtifact({
    artifact_id: s.artifact_id, claim_id: s.claim_id, fencing_token: s.fencing_token,
    content_ref: 'ref://v2', actor_id: 'worker-1',
  });
  assert.equal(r.status, 'ok');
  if (r.status !== 'ok') return;
  assert.equal(r.state, 'working');
  assert.equal(r.version, 2, 'version bumped from 1 (post-time) to 2');

  const pool = getDbPool();
  const art = await pool.query<{ state: string; version: number; content_ref: string; accepted_fencing_token: string }>(
    `SELECT state, version, content_ref, accepted_fencing_token FROM artifacts WHERE artifact_id = $1`,
    [s.artifact_id],
  );
  assert.equal(art.rows[0].state, 'working');
  assert.equal(art.rows[0].version, 2);
  assert.equal(art.rows[0].content_ref, 'ref://v2');
  assert.equal(Number(art.rows[0].accepted_fencing_token), s.fencing_token, 'accepted token advanced');

  const ver = await pool.query<{ version: number; note: string; fencing_token: string | null }>(
    `SELECT version, note, fencing_token FROM artifact_versions WHERE artifact_id = $1 ORDER BY version`,
    [s.artifact_id],
  );
  assert.equal(ver.rows.length, 2, 'a v2 artifact_versions row was appended');
  assert.equal(ver.rows[1].version, 2);
  assert.equal(ver.rows[1].note, 'write');
  assert.equal(Number(ver.rows[1].fencing_token), s.fencing_token);
});

test('T8: a second writeArtifact with the same token succeeds (token >= accepted)', async () => {
  const topicId = await mkActiveTopic();
  const s = await postAndClaim(topicId, 'doc2');
  const r1 = await writeArtifact({
    artifact_id: s.artifact_id, claim_id: s.claim_id, fencing_token: s.fencing_token,
    content_ref: 'ref://a', actor_id: 'worker-1',
  });
  assert.equal(r1.status, 'ok');
  const r2 = await writeArtifact({
    artifact_id: s.artifact_id, claim_id: s.claim_id, fencing_token: s.fencing_token,
    content_ref: 'ref://b', actor_id: 'worker-1',
  });
  assert.equal(r2.status, 'ok');
  if (r2.status === 'ok') assert.equal(r2.version, 3);
});

// ── T9 ──────────────────────────────────────────────────────────────────────

test('T9: write w/ fencing_token < accepted_fencing_token → conflict (fencing_token_stale)', async () => {
  const topicId = await mkActiveTopic();
  const s = await postAndClaim(topicId, 'doc3');
  // first write bumps accepted_fencing_token to s.fencing_token
  const ok = await writeArtifact({
    artifact_id: s.artifact_id, claim_id: s.claim_id, fencing_token: s.fencing_token,
    content_ref: 'ref://v2', actor_id: 'worker-1',
  });
  assert.equal(ok.status, 'ok');
  // a stale write presenting a strictly lower token is rejected
  const stale = await writeArtifact({
    artifact_id: s.artifact_id, claim_id: s.claim_id, fencing_token: s.fencing_token - 1,
    content_ref: 'ref://stale', actor_id: 'worker-1',
  });
  assert.equal(stale.status, 'conflict');
  if (stale.status === 'conflict') {
    assert.equal(stale.reason, 'fencing_token_stale');
  }
  // the stale write left no v3
  const pool = getDbPool();
  const ver = await pool.query<{ n: number }>(
    `SELECT COUNT(*)::int AS n FROM artifact_versions WHERE artifact_id = $1`,
    [s.artifact_id],
  );
  assert.equal(ver.rows[0].n, 2, 'stale write appended no version row');
});

// ── T10 ─────────────────────────────────────────────────────────────────────

test('T10: write w/ an expired claim_id → conflict (claim_not_live)', async () => {
  const topicId = await mkActiveTopic();
  const s = await postAndClaim(topicId, 'doc4');
  await expireClaims(s.artifact_id);
  const r = await writeArtifact({
    artifact_id: s.artifact_id, claim_id: s.claim_id, fencing_token: s.fencing_token,
    content_ref: 'ref://late', actor_id: 'worker-1',
  });
  assert.equal(r.status, 'conflict');
  if (r.status === 'conflict') {
    assert.equal(r.reason, 'claim_not_live');
  }
});

test('T10: write w/ an unknown artifact_id → conflict (artifact_not_found)', async () => {
  const topicId = await mkActiveTopic();
  const s = await postAndClaim(topicId, 'doc4b');
  const r = await writeArtifact({
    artifact_id: `${topicId}:00000000-0000-0000-0000-000000000000:ghost`,
    claim_id: s.claim_id, fencing_token: s.fencing_token,
    content_ref: 'ref://x', actor_id: 'worker-1',
  });
  assert.equal(r.status, 'conflict');
  if (r.status === 'conflict') {
    assert.equal(r.reason, 'artifact_not_found');
  }
});

// ── T11 ─────────────────────────────────────────────────────────────────────

test('T11: write to a for_review artifact → conflict (bad_artifact_state)', async () => {
  const topicId = await mkActiveTopic();
  const s = await postAndClaim(topicId, 'doc5');
  // complete the task → artifact moves to for_review, claim released
  const done = await completeTask({ task_id: s.task_id, actor_id: 'worker-1' });
  assert.equal(done.status, 'completed');
  // a write to the now-for_review artifact is rejected
  const r = await writeArtifact({
    artifact_id: s.artifact_id, claim_id: s.claim_id, fencing_token: s.fencing_token,
    content_ref: 'ref://post-review', actor_id: 'worker-1',
  });
  assert.equal(r.status, 'conflict');
  if (r.status === 'conflict') {
    // for_review is not a writable state — state classification wins.
    assert.equal(r.reason, 'bad_artifact_state');
  }
});

// ── T12 ─────────────────────────────────────────────────────────────────────

test('T12: baselineArtifact working→baselined', async () => {
  const topicId = await mkActiveTopic();
  const s = await postAndClaim(topicId, 'doc6');
  // write once → working
  const w = await writeArtifact({
    artifact_id: s.artifact_id, claim_id: s.claim_id, fencing_token: s.fencing_token,
    content_ref: 'ref://draft-content', actor_id: 'worker-1',
  });
  assert.equal(w.status, 'ok');

  const b = await baselineArtifact({
    artifact_id: s.artifact_id, claim_id: s.claim_id, fencing_token: s.fencing_token,
    actor_id: 'worker-1',
  });
  assert.equal(b.status, 'ok');
  if (b.status !== 'ok') return;
  assert.equal(b.state, 'baselined');

  const pool = getDbPool();
  const art = await pool.query<{ state: string; version: number; content_ref: string }>(
    `SELECT state, version, content_ref FROM artifacts WHERE artifact_id = $1`,
    [s.artifact_id],
  );
  assert.equal(art.rows[0].state, 'baselined');
  // baseline carries the prior version's content_ref forward (a baseline marks)
  assert.equal(art.rows[0].content_ref, 'ref://draft-content');
  const ver = await pool.query<{ note: string; state: string }>(
    `SELECT note, state FROM artifact_versions WHERE artifact_id = $1 ORDER BY version DESC LIMIT 1`,
    [s.artifact_id],
  );
  assert.equal(ver.rows[0].note, 'baselined');
  assert.equal(ver.rows[0].state, 'baselined');
});

test('T12: baselineArtifact directly from draft → baselined', async () => {
  const topicId = await mkActiveTopic();
  const s = await postAndClaim(topicId, 'doc7');
  // artifact is still draft (v1, no write) — baseline is allowed from draft
  const b = await baselineArtifact({
    artifact_id: s.artifact_id, claim_id: s.claim_id, fencing_token: s.fencing_token,
    actor_id: 'worker-1',
  });
  assert.equal(b.status, 'ok');
  if (b.status === 'ok') assert.equal(b.state, 'baselined');
});

test('T12: writeArtifact from a baselined artifact → working (baselined is writable)', async () => {
  const topicId = await mkActiveTopic();
  const s = await postAndClaim(topicId, 'doc8');
  await baselineArtifact({
    artifact_id: s.artifact_id, claim_id: s.claim_id, fencing_token: s.fencing_token,
    actor_id: 'worker-1',
  });
  // baselined → working is permitted (design §11)
  const w = await writeArtifact({
    artifact_id: s.artifact_id, claim_id: s.claim_id, fencing_token: s.fencing_token,
    content_ref: 'ref://past-baseline', actor_id: 'worker-1',
  });
  assert.equal(w.status, 'ok');
  if (w.status === 'ok') assert.equal(w.state, 'working');
});

// ── HIGH-1: claim ownership — a non-holder cannot hijack a live claim ─────────
//
// The regression guard for the [HIGH] finding: claim_id + fencing_token are
// broadcast in the event log, so a peer can copy a still-live pair. The guarded
// UPDATE must additionally require c.actor_id = the caller — a non-owner gets
// conflict/claim_not_owned, NOT a successful overwrite.

test('HIGH-1: writeArtifact by a non-holder presenting a live claim → conflict (claim_not_owned)', async () => {
  const topicId = await mkActiveTopic();
  // worker-1 holds the live claim.
  const s = await postAndClaim(topicId, 'owned', 'worker-1');

  // an imposter copies the live claim_id + fencing_token (as if from the log)
  // and tries to write under its OWN actor_id — must be rejected.
  const r = await writeArtifact({
    artifact_id: s.artifact_id, claim_id: s.claim_id, fencing_token: s.fencing_token,
    content_ref: 'ref://hijack', actor_id: 'imposter',
  });
  assert.equal(r.status, 'conflict');
  if (r.status === 'conflict') {
    assert.equal(r.reason, 'claim_not_owned', 'a live claim owned by another actor');
  }

  // the artifact was NOT overwritten — still draft v1, no version row appended.
  const pool = getDbPool();
  const art = await pool.query<{ state: string; version: number; content_ref: string | null }>(
    `SELECT state, version, content_ref FROM artifacts WHERE artifact_id = $1`,
    [s.artifact_id],
  );
  assert.equal(art.rows[0].state, 'draft', 'state unchanged by the rejected write');
  assert.equal(art.rows[0].version, 1, 'version not advanced');
  assert.equal(art.rows[0].content_ref, null, 'content_ref not overwritten');
  const ver = await pool.query<{ n: number }>(
    `SELECT COUNT(*)::int AS n FROM artifact_versions WHERE artifact_id = $1`,
    [s.artifact_id],
  );
  assert.equal(ver.rows[0].n, 1, 'no hijack version row appended');

  // the legitimate holder can still write.
  const ok = await writeArtifact({
    artifact_id: s.artifact_id, claim_id: s.claim_id, fencing_token: s.fencing_token,
    content_ref: 'ref://legit', actor_id: 'worker-1',
  });
  assert.equal(ok.status, 'ok', 'the real holder is unaffected');
});

test('HIGH-1: baselineArtifact by a non-holder presenting a live claim → conflict (claim_not_owned)', async () => {
  const topicId = await mkActiveTopic();
  const s = await postAndClaim(topicId, 'owned2', 'worker-1');

  const r = await baselineArtifact({
    artifact_id: s.artifact_id, claim_id: s.claim_id, fencing_token: s.fencing_token,
    actor_id: 'imposter',
  });
  assert.equal(r.status, 'conflict');
  if (r.status === 'conflict') {
    assert.equal(r.reason, 'claim_not_owned', 'a live claim owned by another actor');
  }

  // the artifact was NOT baselined — still draft v1.
  const pool = getDbPool();
  const art = await pool.query<{ state: string; version: number }>(
    `SELECT state, version FROM artifacts WHERE artifact_id = $1`,
    [s.artifact_id],
  );
  assert.equal(art.rows[0].state, 'draft', 'state unchanged by the rejected baseline');
  assert.equal(art.rows[0].version, 1, 'version not advanced');

  // the legitimate holder can still baseline.
  const ok = await baselineArtifact({
    artifact_id: s.artifact_id, claim_id: s.claim_id, fencing_token: s.fencing_token,
    actor_id: 'worker-1',
  });
  assert.equal(ok.status, 'ok', 'the real holder is unaffected');
});

// ── MED-6: writeArtifact rejects an empty content_ref ────────────────────────

test('MED-6: writeArtifact with an empty content_ref → BAD_REQUEST', async () => {
  const topicId = await mkActiveTopic();
  const s = await postAndClaim(topicId, 'empty');
  await assert.rejects(
    writeArtifact({
      artifact_id: s.artifact_id, claim_id: s.claim_id, fencing_token: s.fencing_token,
      content_ref: '', actor_id: 'worker-1',
    }),
    /content_ref must be a non-empty string/,
  );
});
