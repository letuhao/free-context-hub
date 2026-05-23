/**
 * Phase 15 Sprint 15.4 — Decision bodies + weighted membership.
 *
 * Design ref: docs/specs/2026-05-18-phase-15-sprint-15.4-design.md §2
 * Spec hash:  a12f419578588e6d
 *
 * A `decision_body` is a project-scoped electorate governed by a voting rule
 * (quorum + threshold + veto holders). It is configuration — NOT tied to a topic,
 * so there is no event log to append to (D2 — mirrors `doa_matrix`, 15.3's config
 * table). `body_members` carries each member's vote weight (B.6 — vote weight is
 * orthogonal to chain-of-command level).
 *
 * §0.1 — `createBody` and `addBodyMember` are single-statement (one INSERT /
 * INSERT … ON CONFLICT) — atomic without an explicit transaction. `getBody` /
 * `listBodies` are plain reads.
 *
 * §0.5 — authorization is coordinator-trusted: `createBody` / `addBodyMember` are
 * intentionally NOT gated on WHO may create a body or grant a vote weight; the
 * route layer's `requireRole` is the only gate. The authorization residual is a
 * deferred item (HARD trigger).
 */

import { getDbPool } from '../db/client.js';
import { ContextHubError } from '../core/errors.js';
import { resolveProjectIdOrThrow } from '../core/auth.js';
import { assertCallerScope, assertCallerScopeMulti, assertBodyScope, type CallerScope } from '../core/index.js';

// ── Types ─────────────────────────────────────────────────────────────────────

export type BodyMember = {
  actor_id: string;
  vote_weight: number;
  added_at: string;
};

export type BodyRecord = {
  body_id: string;
  project_id: string;
  name: string;
  quorum: number;
  threshold: number;
  veto_holders: string[];
  created_by: string;
  created_at: string;
  members: BodyMember[];
};

export type AddMemberResult =
  | { status: 'ok'; body_id: string; actor_id: string; vote_weight: number }
  | { status: 'body_not_found' };

export type ListBodiesResult = { bodies: BodyRecord[] };

const MAX_FIELD_LEN = 256;

// ── §2.1 createBody ───────────────────────────────────────────────────────────

/**
 * Create a decision body. Validates input, resolves the project id, and inserts
 * one row (no transaction, no event — D2). Returns the body record (with an
 * empty members array — a fresh body has no members yet).
 */
export async function createBody(params: {
  project_id?: string;
  /** DEFERRED-029: caller's scope; enforced against resolved project_id. */
  callerScope?: CallerScope;
  name: string;
  quorum: number;
  threshold: number;
  veto_holders?: string[];
  created_by: string;
}): Promise<BodyRecord> {
  const resolvedProjectId = resolveProjectIdOrThrow(params.project_id);
  assertCallerScope(params.callerScope, resolvedProjectId);
  const name = (params.name ?? '').trim();
  const createdBy = (params.created_by ?? '').trim();
  const quorum = params.quorum;
  const threshold = params.threshold;
  const vetoHolders = params.veto_holders ?? [];

  if (!name || !createdBy) {
    throw new ContextHubError('BAD_REQUEST', 'name and created_by are required');
  }
  // 15.3.1 F7 — cap the free-text field length
  if (name.length > MAX_FIELD_LEN) {
    throw new ContextHubError('BAD_REQUEST', `name must be at most ${MAX_FIELD_LEN} characters`);
  }
  if (!Number.isFinite(quorum) || quorum < 0) {
    throw new ContextHubError('BAD_REQUEST', 'quorum must be a finite number >= 0');
  }
  if (!Number.isFinite(threshold) || threshold <= 0 || threshold > 1) {
    throw new ContextHubError('BAD_REQUEST', 'threshold must be a finite number in (0, 1]');
  }
  if (!Array.isArray(vetoHolders) || vetoHolders.some((v) => typeof v !== 'string' || v.trim().length === 0)) {
    throw new ContextHubError('BAD_REQUEST', 'veto_holders must be an array of non-empty strings');
  }
  // Sprint 15.11 (DEFERRED-017 / 15.4 REVIEW-CODE LOW-3) — bound veto_holders array
  // length + element length (input hygiene on the body-creation surface).
  if (vetoHolders.length > 64) {
    throw new ContextHubError('BAD_REQUEST', 'veto_holders must contain at most 64 entries');
  }
  if (vetoHolders.some((v) => v.length > MAX_FIELD_LEN)) {
    throw new ContextHubError('BAD_REQUEST', `each veto_holder must be at most ${MAX_FIELD_LEN} characters`);
  }
  // review-impl MED-1 — trim each veto-holder id before storage so it matches a
  // trimmed actor_id at vetoMotion time. Every other actor field in the sprint
  // (created_by, body_members.actor_id, proposed_by, castVote/vetoMotion actor_id)
  // is trimmed-and-stored; veto_holders must be too.
  const cleanVetoHolders = vetoHolders.map((v) => v.trim());

  const projectId = resolveProjectIdOrThrow(params.project_id);
  const pool = getDbPool();

  const res = await pool.query<{
    body_id: string;
    project_id: string;
    name: string;
    quorum: string;
    threshold: string;
    veto_holders: string[];
    created_by: string;
    created_at: Date;
  }>(
    `INSERT INTO decision_bodies (project_id, name, quorum, threshold, veto_holders, created_by)
     VALUES ($1, $2, $3, $4, $5, $6)
     RETURNING body_id, project_id, name, quorum, threshold, veto_holders, created_by, created_at`,
    [projectId, name, quorum, threshold, cleanVetoHolders, createdBy],
  );

  const r = res.rows[0];
  return {
    body_id: r.body_id,
    project_id: r.project_id,
    name: r.name,
    quorum: Number(r.quorum),
    threshold: Number(r.threshold),
    veto_holders: r.veto_holders,
    created_by: r.created_by,
    created_at: r.created_at.toISOString(),
    members: [],
  };
}

// ── §2.2 addBodyMember ────────────────────────────────────────────────────────

/**
 * Add (or re-weight) a member of a decision body. Idempotent: re-adding a member
 * SETS their `vote_weight` (a weight edit is safe — D7 snapshots weight at cast,
 * so it only affects future ballots). One INSERT … ON CONFLICT — no transaction.
 */
export async function addBodyMember(params: {
  body_id: string;
  /** DEFERRED-029: caller's scope; enforced via the body's derived project_id. */
  callerScope?: CallerScope;
  actor_id: string;
  vote_weight: number;
}): Promise<AddMemberResult> {
  await assertBodyScope(getDbPool(), params.callerScope, params.body_id);
  const bodyId = (params.body_id ?? '').trim();
  const actorId = (params.actor_id ?? '').trim();
  const voteWeight = params.vote_weight;

  if (!bodyId || !actorId) {
    throw new ContextHubError('BAD_REQUEST', 'body_id and actor_id are required');
  }
  if (!Number.isFinite(voteWeight) || voteWeight <= 0) {
    throw new ContextHubError('BAD_REQUEST', 'vote_weight must be a finite number > 0');
  }

  const pool = getDbPool();

  const bodyRes = await pool.query<{ one: number }>(
    `SELECT 1 AS one FROM decision_bodies WHERE body_id=$1`,
    [bodyId],
  );
  if (bodyRes.rowCount === 0) {
    return { status: 'body_not_found' };
  }

  await pool.query(
    `INSERT INTO body_members (body_id, actor_id, vote_weight)
     VALUES ($1, $2, $3)
     ON CONFLICT (body_id, actor_id) DO UPDATE SET vote_weight = EXCLUDED.vote_weight`,
    [bodyId, actorId, voteWeight],
  );

  return { status: 'ok', body_id: bodyId, actor_id: actorId, vote_weight: voteWeight };
}

// ── §2.3 getBody / listBodies ─────────────────────────────────────────────────

/** Map a DB body row (+ aggregated members) to a BodyRecord. */
function mapBodyRow(r: {
  body_id: string;
  project_id: string;
  name: string;
  quorum: string;
  threshold: string;
  veto_holders: string[];
  created_by: string;
  created_at: Date;
  members: Array<{ actor_id: string; vote_weight: string | number; added_at: string }>;
}): BodyRecord {
  return {
    body_id: r.body_id,
    project_id: r.project_id,
    name: r.name,
    quorum: Number(r.quorum),
    threshold: Number(r.threshold),
    veto_holders: r.veto_holders,
    created_by: r.created_by,
    created_at: r.created_at.toISOString(),
    members: r.members.map((m) => ({
      actor_id: m.actor_id,
      vote_weight: Number(m.vote_weight),
      added_at: m.added_at,
    })),
  };
}

/**
 * Get a single decision body + its members in ONE query (the 15.1
 * `fetchTopicWithRoster` snapshot pattern). Returns null when no row matches.
 */
export async function getBody(params: { body_id: string; callerScope?: CallerScope }): Promise<BodyRecord | null> {
  await assertBodyScope(getDbPool(), params.callerScope, params.body_id);
  const pool = getDbPool();
  const res = await pool.query(
    `SELECT b.body_id, b.project_id, b.name, b.quorum, b.threshold, b.veto_holders,
            b.created_by, b.created_at,
            COALESCE(
              json_agg(json_build_object(
                'actor_id', m.actor_id, 'vote_weight', m.vote_weight, 'added_at', m.added_at
              ) ORDER BY m.added_at) FILTER (WHERE m.actor_id IS NOT NULL),
              '[]'
            ) AS members
       FROM decision_bodies b
       LEFT JOIN body_members m ON m.body_id = b.body_id
      WHERE b.body_id = $1
      GROUP BY b.body_id`,
    [params.body_id],
  );
  if (res.rowCount === 0) return null;
  return mapBodyRow(res.rows[0]);
}

/**
 * List all decision bodies for a project, each with its members.
 */
export async function listBodies(params: { project_id?: string; callerScope?: CallerScope }): Promise<ListBodiesResult> {
  const projectId = resolveProjectIdOrThrow(params.project_id);
  assertCallerScope(params.callerScope, projectId);
  const pool = getDbPool();
  const res = await pool.query(
    `SELECT b.body_id, b.project_id, b.name, b.quorum, b.threshold, b.veto_holders,
            b.created_by, b.created_at,
            COALESCE(
              json_agg(json_build_object(
                'actor_id', m.actor_id, 'vote_weight', m.vote_weight, 'added_at', m.added_at
              ) ORDER BY m.added_at) FILTER (WHERE m.actor_id IS NOT NULL),
              '[]'
            ) AS members
       FROM decision_bodies b
       LEFT JOIN body_members m ON m.body_id = b.body_id
      WHERE b.project_id = $1
      GROUP BY b.body_id
      ORDER BY b.created_at DESC`,
    [projectId],
  );
  return { bodies: res.rows.map(mapBodyRow) };
}
