/**
 * Phase 15 Sprint 15.1 — Topic lifecycle service.
 *
 * Design ref: docs/specs/2026-05-16-phase-15-sprint-15.1-design.md §4
 *
 * charter / join / get / close a Topic — the chartered initiative that scopes a
 * coordination space. Every lifecycle write emits a coordination event in the
 * same transaction (appendEvent).
 *
 * §4.0 Transaction & connection-management contract — every transactional
 * function here follows the verbatim Phase 13 artifactLeases.ts pattern: a
 * `catch` that runs an unconditional best-effort ROLLBACK and re-throws, inside
 * a `finally` that always releases the pooled client. The `catch` is the real
 * rollback guard — no unanticipated error (deadlock, 23505 race, timeout, a
 * txn-2 throw in joinTopic) can return a pooled client with an open/aborted
 * transaction.
 */

import { randomUUID } from 'node:crypto';
import type { Pool, PoolClient } from 'pg';
import { getDbPool } from '../db/client.js';
import { ContextHubError } from '../core/errors.js';
import { createModuleLogger } from '../utils/logger.js';
import { appendEvent, replayEvents } from './coordinationEvents.js';
import type { CoordinationEvent } from './coordinationEvents.js';
import { ACTOR_TYPES, ACTOR_TYPE_SET, LEVELS, LEVEL_SET } from './coordinationConstants.js';

const logger = createModuleLogger('topics');

export type TopicRecord = {
  topic_id: string;
  project_id: string;
  name: string;
  charter: string;
  status: string;
  created_by: string;
  created_at: string;
};

export type Participant = {
  actor_id: string;
  type: string;
  display_name: string;
  level: string;
  joined_at: string;
};

export type TopicWithRoster = { topic: TopicRecord; roster: Participant[] };

export type InductionPack = {
  topic: TopicRecord;
  roster: Participant[];
  events: CoordinationEvent[];
  your_cursor: number;
};

export type CloseResult = {
  topic_id: string;
  status: 'closed';
  already_closed: boolean;
};

/**
 * Internal — topic record + participant roster in ONE query (one snapshot).
 * `executor` is the pool (getTopic) or a txn client (joinTopic's REPEATABLE READ
 * snapshot txn). Returns null when no topic row matches.
 */
async function fetchTopicWithRoster(
  executor: Pool | PoolClient,
  topicId: string,
): Promise<TopicWithRoster | null> {
  const res = await executor.query<{
    topic_id: string;
    project_id: string;
    name: string;
    charter: string;
    status: string;
    created_by: string;
    created_at: Date;
    roster: Participant[];
  }>(
    `SELECT t.topic_id, t.project_id, t.name, t.charter, t.status, t.created_by, t.created_at,
       COALESCE(json_agg(json_build_object(
           'actor_id', tp.actor_id, 'level', tp.level, 'joined_at', tp.joined_at,
           'type', a.type, 'display_name', a.display_name
         ) ORDER BY tp.joined_at) FILTER (WHERE tp.actor_id IS NOT NULL), '[]'::json) AS roster
     FROM topics t
     LEFT JOIN topic_participants tp ON tp.topic_id = t.topic_id
     LEFT JOIN actors a ON a.project_id = t.project_id AND a.actor_id = tp.actor_id
     WHERE t.topic_id = $1
     GROUP BY t.topic_id`,
    [topicId],
  );
  if (res.rowCount === 0) return null;
  const row = res.rows[0];
  return {
    topic: {
      topic_id: row.topic_id,
      project_id: row.project_id,
      name: row.name,
      charter: row.charter,
      status: row.status,
      created_by: row.created_by,
      created_at: row.created_at.toISOString(),
    },
    roster: row.roster,
  };
}

/**
 * Charter a new topic. Creates the `topics` row in `chartered` status and emits
 * `topic.chartered` as seq 1 — both in one transaction. (Does NOT auto-join the
 * creator — design D5; the creator separately calls joinTopic.)
 */
export async function charterTopic(params: {
  project_id: string;
  name: string;
  charter: string;
  created_by: string;
}): Promise<TopicRecord> {
  const projectId = (params.project_id ?? '').trim();
  const name = (params.name ?? '').trim();
  const charter = (params.charter ?? '').trim();
  const createdBy = (params.created_by ?? '').trim();
  if (!projectId || !name || !charter || !createdBy) {
    throw new ContextHubError(
      'BAD_REQUEST',
      'project_id, name, charter, created_by are all required',
    );
  }

  const topicId = randomUUID();
  const pool = getDbPool();
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const ins = await client.query<{ created_at: Date }>(
      `INSERT INTO topics (topic_id, project_id, name, charter, status, next_seq, created_by)
       VALUES ($1, $2, $3, $4, 'chartered', 0, $5)
       RETURNING created_at`,
      [topicId, projectId, name, charter, createdBy],
    );
    await appendEvent(client, {
      topic_id: topicId,
      actor_id: createdBy,
      type: 'topic.chartered',
      subject_type: 'topic',
      subject_id: topicId,
      payload: { name, project_id: projectId },
    });
    await client.query('COMMIT');
    return {
      topic_id: topicId,
      project_id: projectId,
      name,
      charter,
      status: 'chartered',
      created_by: createdBy,
      created_at: ins.rows[0].created_at.toISOString(),
    };
  } catch (err) {
    await client.query('ROLLBACK').catch(() => {});
    logger.error({ err: String(err) }, 'charterTopic failed');
    throw err;
  } finally {
    client.release();
  }
}

/**
 * Join a topic. Auto-registers the (project-scoped) actor, inserts a participant
 * row at the declared level, flips `chartered → active` on the first join, emits
 * `topic.actor_joined`, and returns an induction pack.
 *
 * Two transactions on one pooled client: txn 1 = the join writes (releases the
 * topics-row lock at COMMIT); txn 2 = a REPEATABLE READ READ ONLY snapshot that
 * builds the coherent induction pack holding no write lock. Both sit inside the
 * one §4.0 try/catch/finally.
 */
export async function joinTopic(params: {
  topic_id: string;
  actor_id: string;
  actor_type: string;
  display_name: string;
  level: string;
  since_seq?: number;
}): Promise<InductionPack> {
  const topicId = (params.topic_id ?? '').trim();
  const actorId = (params.actor_id ?? '').trim();
  const displayName = (params.display_name ?? '').trim();
  const actorType = params.actor_type;
  const level = params.level;
  if (!topicId || !actorId || !displayName) {
    throw new ContextHubError('BAD_REQUEST', 'topic_id, actor_id, display_name are all required');
  }
  if (!ACTOR_TYPE_SET.has(actorType)) {
    throw new ContextHubError('BAD_REQUEST', `actor_type must be one of: ${ACTOR_TYPES.join(', ')}`);
  }
  if (!LEVEL_SET.has(level)) {
    throw new ContextHubError('BAD_REQUEST', `level must be one of: ${LEVELS.join(', ')}`);
  }
  const sinceSeq = params.since_seq ?? 0;

  const pool = getDbPool();
  const client = await pool.connect();
  try {
    // ── txn 1: the join writes ──
    await client.query('BEGIN');
    const topicRes = await client.query<{ project_id: string; status: string }>(
      `SELECT project_id, status FROM topics WHERE topic_id = $1 FOR UPDATE`,
      [topicId],
    );
    if (topicRes.rowCount === 0) {
      throw new ContextHubError('NOT_FOUND', `topic ${topicId} not found`);
    }
    const projectId = topicRes.rows[0].project_id;
    if (topicRes.rows[0].status === 'closed') {
      throw new ContextHubError('BAD_REQUEST', `topic ${topicId} is closed`);
    }

    // upsert the project-scoped actor; RETURNING type is atomic (no TOCTOU)
    const actorRes = await client.query<{ type: string }>(
      `INSERT INTO actors (project_id, actor_id, type, display_name)
       VALUES ($1, $2, $3, $4)
       ON CONFLICT (project_id, actor_id) DO UPDATE SET display_name = EXCLUDED.display_name
       RETURNING type`,
      [projectId, actorId, actorType, displayName],
    );
    if (actorRes.rows[0].type !== actorType) {
      throw new ContextHubError(
        'BAD_REQUEST',
        `actor ${actorId} is already registered as '${actorRes.rows[0].type}', not '${actorType}'`,
      );
    }

    // idempotent participant insert — re-join adds no row and emits no event
    const partRes = await client.query(
      `INSERT INTO topic_participants (topic_id, actor_id, level)
       VALUES ($1, $2, $3)
       ON CONFLICT (topic_id, actor_id) DO NOTHING
       RETURNING actor_id`,
      [topicId, actorId, level],
    );
    if ((partRes.rowCount ?? 0) > 0) {
      await client.query(
        `UPDATE topics SET status = 'active' WHERE topic_id = $1 AND status = 'chartered'`,
        [topicId],
      );
      await appendEvent(client, {
        topic_id: topicId,
        actor_id: actorId,
        type: 'topic.actor_joined',
        subject_type: 'topic',
        subject_id: topicId,
        payload: { level, actor_type: actorType },
      });
    }
    await client.query('COMMIT');

    // ── txn 2: coherent induction-pack read — snapshot isolation, no write lock ──
    await client.query('BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY');
    const tr = await fetchTopicWithRoster(client, topicId);
    const ev = await replayEvents({ topic_id: topicId, since_seq: sinceSeq }, client);
    await client.query('COMMIT');
    if (!tr) {
      // Unreachable: the topic existed under FOR UPDATE in txn 1 and is never deleted.
      throw new ContextHubError('NOT_FOUND', `topic ${topicId} not found`);
    }
    return {
      topic: tr.topic,
      roster: tr.roster,
      events: ev.events,
      your_cursor: ev.next_cursor,
    };
  } catch (err) {
    await client.query('ROLLBACK').catch(() => {});
    logger.error({ err: String(err) }, 'joinTopic failed');
    throw err;
  } finally {
    client.release();
  }
}

/** Get a topic's record + full participant roster (one-query snapshot). */
export async function getTopic(params: { topic_id: string }): Promise<TopicWithRoster> {
  const topicId = (params.topic_id ?? '').trim();
  if (!topicId) throw new ContextHubError('BAD_REQUEST', 'topic_id is required');
  const tr = await fetchTopicWithRoster(getDbPool(), topicId);
  if (!tr) throw new ContextHubError('NOT_FOUND', `topic ${topicId} not found`);
  return tr;
}

/**
 * Close a topic. Atomic `chartered|active → closed`: emits `topic.closed` as the
 * final event, then flips the status (the topics-row lock held through both
 * makes `topic.closed` provably the last event). Idempotent — closing an
 * already-closed topic returns `already_closed:true` and emits no event.
 */
export async function closeTopic(params: {
  topic_id: string;
  actor_id: string;
}): Promise<CloseResult> {
  const topicId = (params.topic_id ?? '').trim();
  const actorId = (params.actor_id ?? '').trim();
  if (!topicId || !actorId) {
    throw new ContextHubError('BAD_REQUEST', 'topic_id and actor_id are required');
  }

  const pool = getDbPool();
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const res = await client.query<{ status: string }>(
      `SELECT status FROM topics WHERE topic_id = $1 FOR UPDATE`,
      [topicId],
    );
    if (res.rowCount === 0) {
      throw new ContextHubError('NOT_FOUND', `topic ${topicId} not found`);
    }
    if (res.rows[0].status === 'closed') {
      // idempotent — ROLLBACK before the early return so finally releases a clean client
      await client.query('ROLLBACK');
      return { topic_id: topicId, status: 'closed', already_closed: true };
    }
    await appendEvent(client, {
      topic_id: topicId,
      actor_id: actorId,
      type: 'topic.closed',
      subject_type: 'topic',
      subject_id: topicId,
      payload: {},
    });
    await client.query(`UPDATE topics SET status = 'closed' WHERE topic_id = $1`, [topicId]);
    await client.query('COMMIT');
    return { topic_id: topicId, status: 'closed', already_closed: false };
  } catch (err) {
    await client.query('ROLLBACK').catch(() => {});
    logger.error({ err: String(err) }, 'closeTopic failed');
    throw err;
  } finally {
    client.release();
  }
}
