/**
 * Phase 15 Sprint 15.2 — The Board: tasks + the claim lifecycle.
 *
 * Design ref: docs/specs/2026-05-16-phase-15-sprint-15.2-design.md §2
 * Spec hash:  ea26ef6367e133ef
 *
 * Tasks are posted onto a topic's board; each task carries exactly one output
 * artifact (created at post-time, §2.1 / D2). Actors claim a task to gain a
 * time-bounded, fencing-tokened lease on its artifact, then complete it.
 *
 * §0.1 Transaction & connection contract — every transactional function here
 * follows the verbatim Phase 13 / 15.1-topics.ts pattern: a `catch` that runs an
 * unconditional best-effort ROLLBACK and re-throws, inside a `finally` that
 * always releases the pooled client. An explicit ROLLBACK precedes every early
 * return so `finally` releases a clean client.
 *
 * §0.2 Canonical lock order `task → claim → artifact → topics` — every
 * transaction acquires row locks as a prefix-consistent subsequence (§10).
 * `appendEvent` does `UPDATE topics SET next_seq…` — it locks the `topics` row —
 * so every `appendEvent(...)` call is the final (`topics`) lock.
 */

import { randomUUID } from 'node:crypto';
import { getDbPool } from '../db/client.js';
import { ContextHubError } from '../core/errors.js';
import { createModuleLogger } from '../utils/logger.js';
import { appendEvent } from './coordinationEvents.js';

const logger = createModuleLogger('board');

const DEFAULT_TTL_MINUTES = 30;
const MAX_TTL_MINUTES = 240;
const SLOT_REGEX = /^[a-z0-9][a-z0-9-]*$/;
/** depends_on entries are task UUIDs (the column is UUID[]); validated up-front
 *  so a malformed id is a clean BAD_REQUEST, not a raw Postgres 22P02 → 500.
 *  [code-r1 F2] */
const UUID_REGEX =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const TOPOLOGIES = new Set(['parallel', 'sequential', 'rolling']);

export type TaskRecord = {
  task_id: string;
  topic_id: string;
  title: string;
  topology: string;
  depends_on: string[];
  raci: Record<string, unknown>;
  status: string;
  created_by: string;
  created_at: string;
  artifact_id: string;
};

export type TaskSummary = {
  task_id: string;
  topic_id: string;
  title: string;
  topology: string;
  depends_on: string[];
  raci: Record<string, unknown>;
  status: string;
  created_by: string;
  created_at: string;
  artifact_id: string;
  artifact_state: string;
};

export type ListBoardResult = { tasks: TaskSummary[] };

export type ClaimResult =
  | { status: 'claimed'; claim_id: string; fencing_token: number; expires_at: string; artifact_id: string }
  | { status: 'conflict'; reason?: 'task_completed'; incumbent_actor_id?: string; expires_at?: string }
  | { status: 'not_found' };

export type ReleaseResult = {
  status: 'released' | 'not_found' | 'claim_expired' | 'not_owner' | 'topic_closed';
};

export type CompleteResult = {
  status:
    | 'completed'
    | 'not_found'
    | 'already_completed'
    | 'no_live_claim'
    | 'not_owner'
    | 'bad_artifact_state'
    | 'topic_closed';
};

/** Clamp ttl_minutes to [1, MAX_TTL_MINUTES]; NaN / undefined → default. */
function clampTtl(ttlMinutes?: number): number {
  if (ttlMinutes === undefined || ttlMinutes === null) return DEFAULT_TTL_MINUTES;
  if (!Number.isFinite(ttlMinutes)) return DEFAULT_TTL_MINUTES;
  if (ttlMinutes < 1) return 1;
  if (ttlMinutes > MAX_TTL_MINUTES) return MAX_TTL_MINUTES;
  return Math.floor(ttlMinutes);
}

/**
 * Post a task onto a topic's board. Creates the `tasks` row + its one output
 * `artifacts` row (`draft`, v1) + the v1 `artifact_versions` row, and emits
 * `task.posted` + `artifact.created` — all in one transaction (§2.1 / D2).
 *
 * The `artifact_id` is DERIVED `<topic_id>:<task_id>:<slot>` (D1) — never
 * actor-supplied. A MISSING topic is caught by an explicit plain-SELECT
 * existence check (→ NOT_FOUND / 404) so it never surfaces as a raw 23503 FK
 * violation; a CLOSED (existing) topic passes the check, the INSERTs succeed,
 * and the first `appendEvent`'s seal throws BAD_REQUEST (→ 400). The check has
 * no check-to-INSERT TOCTOU because of §0.3 — a `topics` row is permanent.
 */
export async function postTask(params: {
  topic_id: string;
  title: string;
  topology: string;
  depends_on?: string[];
  raci?: Record<string, unknown>;
  slot: string;
  kind: string;
  created_by: string;
}): Promise<TaskRecord> {
  const topicId = (params.topic_id ?? '').trim();
  const title = (params.title ?? '').trim();
  const topology = params.topology;
  const slot = (params.slot ?? '').trim();
  const kind = (params.kind ?? '').trim();
  const createdBy = (params.created_by ?? '').trim();
  const dependsOn = params.depends_on ?? [];
  const raci = params.raci ?? {};

  if (!topicId || !title || !kind || !createdBy) {
    throw new ContextHubError(
      'BAD_REQUEST',
      'topic_id, title, kind, created_by are all required',
    );
  }
  if (!TOPOLOGIES.has(topology)) {
    throw new ContextHubError(
      'BAD_REQUEST',
      `topology must be one of: ${Array.from(TOPOLOGIES).join(', ')}`,
    );
  }
  if (!SLOT_REGEX.test(slot)) {
    throw new ContextHubError(
      'BAD_REQUEST',
      `slot must be a lowercase-kebab slug (^[a-z0-9][a-z0-9-]*$); got: ${slot}`,
    );
  }
  // [LOW-8] bound slot length — the artifact_id PK/URL segment is derived
  // `<topic_id>:<task_id>:<slot>`, so an unbounded slot is an unbounded PK.
  if (slot.length > 64) {
    throw new ContextHubError(
      'BAD_REQUEST',
      `slot must be at most 64 characters; got: ${slot.length}`,
    );
  }
  // [code-r1 F2] Validate depends_on elements up-front — the column is UUID[],
  // so a non-UUID string would raise a raw 22P02 inside the INSERT and surface
  // as an unclassified 500 (the same defect class [r2-fix F3] fixed for topics).
  for (const dep of dependsOn) {
    if (typeof dep !== 'string' || !UUID_REGEX.test(dep)) {
      throw new ContextHubError(
        'BAD_REQUEST',
        `depends_on entries must be task UUIDs; got: ${String(dep)}`,
      );
    }
  }

  const taskId = randomUUID();
  const artifactId = `${topicId}:${taskId}:${slot}`;

  const pool = getDbPool();
  const client = await pool.connect();
  try {
    // [r2-fix F3] explicit existence check FIRST — a MISSING topic must be a
    // clean 404, not the raw 23503 FK violation the tasks INSERT would raise.
    const topicRes = await client.query(`SELECT 1 FROM topics WHERE topic_id = $1`, [topicId]);
    if (topicRes.rowCount === 0) {
      throw new ContextHubError('NOT_FOUND', `topic ${topicId} not found`);
    }

    // [LOW-9] depends_on must reference EXISTING tasks in THE SAME topic — a
    // dangling or cross-topic edge would be inherited unvalidated by 15.3+
    // topology enforcement. A pre-BEGIN existence check (same TOCTOU-free
    // rationale as the topic check — tasks are never deleted).
    if (dependsOn.length > 0) {
      const depRes = await client.query<{ n: number }>(
        `SELECT count(*)::int AS n FROM tasks
          WHERE task_id = ANY($1::uuid[]) AND topic_id = $2`,
        [dependsOn, topicId],
      );
      if (depRes.rows[0].n !== dependsOn.length) {
        throw new ContextHubError(
          'BAD_REQUEST',
          'depends_on references unknown or cross-topic tasks',
        );
      }
    }

    await client.query('BEGIN');
    const ins = await client.query<{ created_at: Date }>(
      `INSERT INTO tasks (task_id, topic_id, title, topology, depends_on, raci, status, created_by)
       VALUES ($1, $2, $3, $4, $5, $6, 'posted', $7)
       RETURNING created_at`,
      [taskId, topicId, title, topology, dependsOn, JSON.stringify(raci), createdBy],
    );
    await client.query(
      `INSERT INTO artifacts (artifact_id, topic_id, task_id, slot, kind, state, version, accepted_fencing_token)
       VALUES ($1, $2, $3, $4, $5, 'draft', 1, 0)`,
      [artifactId, topicId, taskId, slot, kind],
    );
    await client.query(
      `INSERT INTO artifact_versions (artifact_id, version, state, content_ref, fencing_token, note, created_by)
       VALUES ($1, 1, 'draft', NULL, NULL, 'created', $2)`,
      [artifactId, createdBy],
    );
    await appendEvent(client, {
      topic_id: topicId,
      actor_id: createdBy,
      type: 'task.posted',
      subject_type: 'task',
      subject_id: taskId,
      payload: { title, topology, slot },
    });
    await appendEvent(client, {
      topic_id: topicId,
      actor_id: createdBy,
      type: 'artifact.created',
      subject_type: 'artifact',
      subject_id: artifactId,
      payload: { task_id: taskId, slot, kind },
    });
    await client.query('COMMIT');

    return {
      task_id: taskId,
      topic_id: topicId,
      title,
      topology,
      depends_on: dependsOn,
      raci,
      status: 'posted',
      created_by: createdBy,
      created_at: ins.rows[0].created_at.toISOString(),
      artifact_id: artifactId,
    };
  } catch (err) {
    await client.query('ROLLBACK').catch(() => {});
    logger.error({ err: String(err) }, 'postTask failed');
    throw err;
  } finally {
    client.release();
  }
}

/**
 * List a topic's board — every task + its output artifact's id/state. Default
 * lists all tasks; pass `status:'posted'` for the claimable set (§2.2).
 */
export async function listBoard(params: {
  topic_id: string;
  status?: string;
}): Promise<ListBoardResult> {
  const topicId = (params.topic_id ?? '').trim();
  if (!topicId) throw new ContextHubError('BAD_REQUEST', 'topic_id is required');

  const pool = getDbPool();
  // [LOW-7] topic-existence check — a nonexistent topic is NOT_FOUND (consistent
  // with getTopic / replayEvents), so a caller can tell "no tasks" from "no topic".
  const topicRes = await pool.query(`SELECT 1 FROM topics WHERE topic_id = $1`, [topicId]);
  if (topicRes.rowCount === 0) {
    throw new ContextHubError('NOT_FOUND', `topic ${topicId} not found`);
  }

  const args: unknown[] = [topicId];
  let statusFilter = '';
  if (params.status !== undefined && params.status !== '') {
    args.push(params.status);
    statusFilter = ` AND t.status = $${args.length}`;
  }
  const res = await pool.query<{
    task_id: string;
    topic_id: string;
    title: string;
    topology: string;
    depends_on: string[];
    raci: Record<string, unknown>;
    status: string;
    created_by: string;
    created_at: Date;
    artifact_id: string;
    artifact_state: string;
  }>(
    `SELECT t.task_id, t.topic_id, t.title, t.topology, t.depends_on, t.raci,
            t.status, t.created_by, t.created_at,
            a.artifact_id, a.state AS artifact_state
       FROM tasks t
       JOIN artifacts a ON a.task_id = t.task_id
      WHERE t.topic_id = $1${statusFilter}
      ORDER BY t.created_at`,
    args,
  );
  return {
    tasks: res.rows.map((r) => ({
      task_id: r.task_id,
      topic_id: r.topic_id,
      title: r.title,
      topology: r.topology,
      depends_on: r.depends_on,
      raci: r.raci,
      status: r.status,
      created_by: r.created_by,
      created_at: r.created_at.toISOString(),
      artifact_id: r.artifact_id,
      artifact_state: r.artifact_state,
    })),
  };
}

/**
 * Claim a task — gain a time-bounded, fencing-tokened lease on its artifact
 * (§2.3 / r1-fix F1). The Phase 13 claim structure (lazy-cleanup → check-live →
 * INSERT), serialized by the task-row `FOR UPDATE` lock.
 *
 * Lock order `task → claim → topics` (§0.2). No 23505 handler / retry loop: a
 * task has exactly one artifact whose id embeds the task_id, so the only path
 * that inserts a claim for that artifact is `claimTask` for that one task. Two
 * concurrent calls both block on `SELECT tasks … FOR UPDATE`; the loser, once it
 * holds the lock, DELETEs expired then finds the winner's committed claim and
 * returns `conflict` — it never reaches the INSERT. A `claims_active_uniq`
 * violation is structurally impossible here.
 */
export async function claimTask(params: {
  task_id: string;
  actor_id: string;
  ttl_minutes?: number;
}): Promise<ClaimResult> {
  const taskId = (params.task_id ?? '').trim();
  const actorId = (params.actor_id ?? '').trim();
  if (!taskId || !actorId) {
    throw new ContextHubError('BAD_REQUEST', 'task_id and actor_id are required');
  }
  const ttl = clampTtl(params.ttl_minutes);

  const pool = getDbPool();
  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    // (task) THE serializer — every claim on this task blocks here.
    const taskRes = await client.query<{ topic_id: string; status: string }>(
      `SELECT topic_id, status FROM tasks WHERE task_id = $1 FOR UPDATE`,
      [taskId],
    );
    if (taskRes.rowCount === 0) {
      await client.query('ROLLBACK');
      return { status: 'not_found' };
    }
    const { topic_id: topicId, status: taskStatus } = taskRes.rows[0];
    if (taskStatus === 'completed') {
      await client.query('ROLLBACK');
      return { status: 'conflict', reason: 'task_completed' };
    }

    // plain read — the artifact_id (NO lock; embeds task_id, one row per task).
    const artRes = await client.query<{ artifact_id: string }>(
      `SELECT artifact_id FROM artifacts WHERE task_id = $1`,
      [taskId],
    );
    const artifactId = artRes.rows[0].artifact_id;

    // (claim) lazy cleanup of this artifact's expired claims.
    await client.query(
      `DELETE FROM claims WHERE artifact_id = $1 AND expires_at <= now()`,
      [artifactId],
    );

    // live-claim check — the winner of a concurrent race is found here.
    const liveRes = await client.query<{ actor_id: string; expires_at: Date }>(
      `SELECT actor_id, expires_at FROM claims
        WHERE artifact_id = $1 AND expires_at > now()`,
      [artifactId],
    );
    if ((liveRes.rowCount ?? 0) > 0) {
      await client.query('ROLLBACK');
      const row = liveRes.rows[0];
      return {
        status: 'conflict',
        incumbent_actor_id: row.actor_id,
        expires_at: row.expires_at.toISOString(),
      };
    }

    const tokenRes = await client.query<{ token: string }>(
      `SELECT nextval('coordination_fencing_seq') AS token`,
    );
    const fencingToken = Number(tokenRes.rows[0].token);
    const claimId = randomUUID();
    const expiresAt = new Date(Date.now() + ttl * 60_000);

    // (claim) INSERT the lease.
    await client.query(
      `INSERT INTO claims (claim_id, topic_id, task_id, artifact_id, actor_id, fencing_token, expires_at)
       VALUES ($1, $2, $3, $4, $5, $6, $7)`,
      [claimId, topicId, taskId, artifactId, actorId, fencingToken, expiresAt],
    );
    await client.query(`UPDATE tasks SET status = 'claimed' WHERE task_id = $1`, [taskId]);

    // (topics) — appendEvent locks the topics row, acquired last.
    // [MED-4] The event log is append-only and fully replayable to every
    // participant — claim_id + fencing_token are a live mutable capability and
    // MUST NOT be embedded in it. Observers see WHO holds the claim; the
    // capability itself is returned only in the synchronous ClaimResult below
    // to the caller who legitimately needs it.
    await appendEvent(client, {
      topic_id: topicId,
      actor_id: actorId,
      type: 'claim.granted',
      subject_type: 'artifact',
      subject_id: artifactId,
      payload: { task_id: taskId, actor_id: actorId },
    });
    await appendEvent(client, {
      topic_id: topicId,
      actor_id: actorId,
      type: 'task.claimed',
      subject_type: 'task',
      subject_id: taskId,
      payload: { actor_id: actorId },
    });
    await client.query('COMMIT');

    return {
      status: 'claimed',
      claim_id: claimId,
      fencing_token: fencingToken,
      expires_at: expiresAt.toISOString(),
      artifact_id: artifactId,
    };
  } catch (err) {
    await client.query('ROLLBACK').catch(() => {});
    logger.error({ err: String(err) }, 'claimTask failed');
    throw err;
  } finally {
    client.release();
  }
}

/**
 * Release a task — a holder voluntarily gives up a LIVE claim (§2.4 / r1-fix F2).
 * Lock order `task → claim → topics` (§0.2).
 *
 * The `expires_at > now()` filter is mandatory — an EXPIRED claim is the sweep's
 * exclusive domain (only the sweep retires an expired claim + reverts the
 * artifact, §4). An expired claim ⇒ `claim_expired` (no-op). A voluntary release
 * of a live claim does NOT revert the artifact — the work is an intentional
 * hand-off, not abandonment.
 */
export async function releaseTask(params: {
  task_id: string;
  actor_id: string;
}): Promise<ReleaseResult> {
  const taskId = (params.task_id ?? '').trim();
  const actorId = (params.actor_id ?? '').trim();
  if (!taskId || !actorId) {
    throw new ContextHubError('BAD_REQUEST', 'task_id and actor_id are required');
  }

  const pool = getDbPool();
  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    // (task)
    const taskRes = await client.query<{ topic_id: string }>(
      `SELECT topic_id FROM tasks WHERE task_id = $1 FOR UPDATE`,
      [taskId],
    );
    if (taskRes.rowCount === 0) {
      await client.query('ROLLBACK');
      return { status: 'not_found' };
    }
    const topicId = taskRes.rows[0].topic_id;

    // [MED-2] closed-topic check — closeTopic does not touch claims, so a topic
    // can be `closed` with a live claim still on a task. A release on it must
    // return a clean `topic_closed` status, NOT let appendEvent's seal throw a
    // raw BAD_REQUEST. A plain SELECT (no FOR UPDATE) — does not change the
    // task → claim → artifact → topics lock order.
    const topicStatusRes = await client.query<{ status: string }>(
      `SELECT status FROM topics WHERE topic_id = $1`,
      [topicId],
    );
    if (topicStatusRes.rows[0]?.status === 'closed') {
      await client.query('ROLLBACK');
      return { status: 'topic_closed' };
    }

    // plain read — the artifact_id.
    const artRes = await client.query<{ artifact_id: string }>(
      `SELECT artifact_id FROM artifacts WHERE task_id = $1`,
      [taskId],
    );
    const artifactId = artRes.rows[0].artifact_id;

    // (claim) liveness filter [r1-fix F2] — locked at first touch.
    const claimRes = await client.query<{ claim_id: string; actor_id: string }>(
      `SELECT claim_id, actor_id FROM claims
        WHERE artifact_id = $1 AND expires_at > now() FOR UPDATE`,
      [artifactId],
    );
    if (claimRes.rowCount === 0) {
      await client.query('ROLLBACK');
      return { status: 'claim_expired' }; // the sweep owns it
    }
    if (claimRes.rows[0].actor_id !== actorId) {
      await client.query('ROLLBACK');
      return { status: 'not_owner' };
    }

    await client.query(`DELETE FROM claims WHERE claim_id = $1`, [claimRes.rows[0].claim_id]);
    await client.query(`UPDATE tasks SET status = 'posted' WHERE task_id = $1`, [taskId]);

    // (topics)
    await appendEvent(client, {
      topic_id: topicId,
      actor_id: actorId,
      type: 'task.released',
      subject_type: 'task',
      subject_id: taskId,
      payload: { actor_id: actorId },
    });
    await client.query('COMMIT');
    return { status: 'released' };
  } catch (err) {
    await client.query('ROLLBACK').catch(() => {});
    logger.error({ err: String(err) }, 'releaseTask failed');
    throw err;
  } finally {
    client.release();
  }
}

/**
 * Complete a task — task `completed`, artifact `for_review`, claim released
 * (§2.5 / D4 / r3-fix F2). Lock order `task → claim → artifact → topics` (§0.2).
 *
 * The claim SELECT carries `FOR UPDATE` — the claim row is write-locked at first
 * touch (not first at the DELETE), so §9 invariant 7 is genuinely lock-enforced
 * and the lock is acquired before the artifact UPDATE.
 */
export async function completeTask(params: {
  task_id: string;
  actor_id: string;
}): Promise<CompleteResult> {
  const taskId = (params.task_id ?? '').trim();
  const actorId = (params.actor_id ?? '').trim();
  if (!taskId || !actorId) {
    throw new ContextHubError('BAD_REQUEST', 'task_id and actor_id are required');
  }

  const pool = getDbPool();
  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    // (task)
    const taskRes = await client.query<{ topic_id: string; status: string }>(
      `SELECT topic_id, status FROM tasks WHERE task_id = $1 FOR UPDATE`,
      [taskId],
    );
    if (taskRes.rowCount === 0) {
      await client.query('ROLLBACK');
      return { status: 'not_found' };
    }
    const { topic_id: topicId, status: taskStatus } = taskRes.rows[0];
    if (taskStatus === 'completed') {
      await client.query('ROLLBACK');
      return { status: 'already_completed' };
    }

    // [MED-2] closed-topic check — see releaseTask. A complete on a closed
    // topic returns a clean `topic_closed` status rather than letting
    // appendEvent's seal throw. Plain SELECT — preserves the lock order.
    const topicStatusRes = await client.query<{ status: string }>(
      `SELECT status FROM topics WHERE topic_id = $1`,
      [topicId],
    );
    if (topicStatusRes.rows[0]?.status === 'closed') {
      await client.query('ROLLBACK');
      return { status: 'topic_closed' };
    }

    // plain read — the artifact_id.
    const artRes = await client.query<{ artifact_id: string }>(
      `SELECT artifact_id FROM artifacts WHERE task_id = $1`,
      [taskId],
    );
    const artifactId = artRes.rows[0].artifact_id;

    // (claim) [r3-fix F2] FOR UPDATE — claim row locked at first touch.
    const claimRes = await client.query<{ actor_id: string }>(
      `SELECT actor_id FROM claims
        WHERE artifact_id = $1 AND expires_at > now() FOR UPDATE`,
      [artifactId],
    );
    if (claimRes.rowCount === 0) {
      await client.query('ROLLBACK');
      return { status: 'no_live_claim' };
    }
    if (claimRes.rows[0].actor_id !== actorId) {
      await client.query('ROLLBACK');
      return { status: 'not_owner' };
    }

    // (artifact) [code-r1 F1] — lock the artifact row, then read its
    // pre-transition state FROM the locked row (a locked-row read is the true
    // pre-image — no concurrent writer can change a row this txn holds), then a
    // plain UPDATE on that same locked row. (Replaces a `WITH prev` CTE whose
    // pre-state read was not verifiable under READ COMMITTED EvalPlanQual.)
    const artLock = await client.query<{ state: string }>(
      `SELECT state FROM artifacts WHERE artifact_id = $1 FOR UPDATE`,
      [artifactId],
    );
    const prevArtifactState = artLock.rows[0].state;
    const artUpd = await client.query(
      `UPDATE artifacts SET state = 'for_review'
        WHERE artifact_id = $1
          AND state IN ('draft','working','baselined')`,
      [artifactId],
    );
    if (artUpd.rowCount === 0) {
      await client.query('ROLLBACK');
      return { status: 'bad_artifact_state' };
    }

    await client.query(`DELETE FROM claims WHERE artifact_id = $1`, [artifactId]);
    await client.query(`UPDATE tasks SET status = 'completed' WHERE task_id = $1`, [taskId]);

    // (topics)
    await appendEvent(client, {
      topic_id: topicId,
      actor_id: actorId,
      type: 'task.completed',
      subject_type: 'task',
      subject_id: taskId,
      payload: { actor_id: actorId },
    });
    await appendEvent(client, {
      topic_id: topicId,
      actor_id: actorId,
      type: 'artifact.state_changed',
      subject_type: 'artifact',
      subject_id: artifactId,
      payload: { from: prevArtifactState, to: 'for_review' },
    });
    await client.query('COMMIT');
    return { status: 'completed' };
  } catch (err) {
    await client.query('ROLLBACK').catch(() => {});
    logger.error({ err: String(err) }, 'completeTask failed');
    throw err;
  } finally {
    client.release();
  }
}
