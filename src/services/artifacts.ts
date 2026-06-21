/**
 * Phase 15 Sprint 15.2 — versioned artifact writes.
 *
 * Design ref: docs/specs/2026-05-16-phase-15-sprint-15.2-design.md §3
 * Spec hash:  ea26ef6367e133ef
 *
 * `writeArtifact` / `baselineArtifact` are the stale-holder defense (design C.2,
 * CLARIFY R2). The claim-liveness AND fencing checks are fused into ONE atomic
 * statement — a guarded `UPDATE … WHERE … RETURNING`. On 0 rows, a re-SELECT
 * runs ONLY to classify the conflict reason — never to re-attempt the guard.
 *
 * §0.1 Transaction contract — every transactional fn here follows the verbatim
 * Phase 13 / 15.1-topics.ts pattern (catch → best-effort ROLLBACK → re-throw,
 * inside a finally that releases the client; explicit ROLLBACK before any early
 * return).
 *
 * §0.2 lock order `artifact → topics` — a `SELECT … FOR UPDATE` takes the
 * artifact row lock (and reads the true pre-transition state from the locked
 * row); the guarded `UPDATE` then runs on that same locked row; the `claims`
 * `EXISTS` subquery is a plain read (no row lock); the trailing `appendEvent`
 * takes the `topics` row lock.
 */

import type { PoolClient } from 'pg';
import { getDbPool } from '../db/client.js';
import { ContextHubError } from '../core/errors.js';
import { createModuleLogger } from '../utils/logger.js';
import { appendEvent } from './coordinationEvents.js';
import { assertAuthorized } from './authorize.js';

const logger = createModuleLogger('artifacts');

export type ConflictReason =
  | 'artifact_not_found'
  | 'bad_artifact_state'
  | 'fencing_token_stale'
  | 'claim_not_live'
  | 'claim_not_owned';

export type WriteResult =
  | { status: 'ok'; version: number; state: string }
  | { status: 'conflict'; reason: ConflictReason };

export type BaselineResult =
  | { status: 'ok'; version: number; state: 'baselined' }
  | { status: 'conflict'; reason: ConflictReason };

/**
 * Classify why a guarded UPDATE matched 0 rows (§3.1 / §3.2). A plain re-SELECT,
 * run ONLY to attribute the conflict — never to re-attempt the guard.
 *
 * `writableStates` is the per-operation set the guard's `state IN (...)` clause
 * checked: `['draft','working','baselined']` for writeArtifact, `['draft','working']`
 * for baselineArtifact.
 *
 * `actorId` is the caller — the guarded UPDATE's `EXISTS` subquery additionally
 * requires `c.actor_id = actorId` [HIGH-1], so a live claim NOT owned by the
 * caller is classified `claim_not_owned` (distinct from a missing/expired claim
 * → `claim_not_live`).
 */
async function classifyGuardConflict(
  client: PoolClient,
  artifactId: string,
  claimId: string,
  fencingToken: number,
  actorId: string,
  writableStates: readonly string[],
): Promise<ConflictReason> {
  const art = await client.query<{ state: string; accepted_fencing_token: string }>(
    `SELECT state, accepted_fencing_token FROM artifacts WHERE artifact_id = $1`,
    [artifactId],
  );
  if (art.rowCount === 0) return 'artifact_not_found';
  const { state, accepted_fencing_token } = art.rows[0];
  if (!writableStates.includes(state)) return 'bad_artifact_state';
  if (Number(accepted_fencing_token) > fencingToken) return 'fencing_token_stale';
  // state is writable and the token is not below accepted ⇒ the claim is the
  // failing condition (missing, expired, mismatched artifact, or — [HIGH-1] —
  // live but owned by a different actor).
  const claim = await client.query<{ actor_id: string }>(
    `SELECT actor_id FROM claims
      WHERE claim_id = $1 AND artifact_id = $2 AND expires_at > now()`,
    [claimId, artifactId],
  );
  if (claim.rowCount === 0) return 'claim_not_live';
  // [HIGH-1] a live claim that the caller does not own — the guarded UPDATE's
  // `c.actor_id = actorId` clause is what failed.
  if (claim.rows[0].actor_id !== actorId) return 'claim_not_owned';
  // All individual conditions hold on re-read — a benign concurrent race
  // (e.g. the claim expired then a fresh one arrived). Report claim_not_live:
  // the caller's specific claim/token combination did not pass the guard.
  return 'claim_not_live';
}

const WRITE_WRITABLE_STATES = ['draft', 'working', 'baselined'] as const;
const BASELINE_WRITABLE_STATES = ['draft', 'working'] as const;

/**
 * Write a new version of an artifact (§3.1). The claim-liveness AND fencing
 * checks are ONE atomic guarded `UPDATE`: writable state + presented token ≥
 * accepted token + a live claim on this artifact. On success the new version is
 * `working`, `accepted_fencing_token` advances to the presented token, an
 * `artifact_versions` row is appended, and `artifact.versioned` (+
 * `artifact.state_changed` when the state actually changed) is emitted.
 *
 * Why one statement: a fencing token guards against a superseding holder; the
 * live-claim `EXISTS` guards against your own claim having expired with no
 * successor. Splitting them reopens a TOCTOU.
 */
export async function writeArtifact(params: {
  artifact_id: string;
  /** F2f — acting principal; authorize() is the tenant/authz gate (artifact → task scope). */
  actingPrincipalId?: string | null;
  claim_id: string;
  fencing_token: number;
  content_ref: string;
  actor_id: string;
}): Promise<WriteResult> {
  const artifactId = (params.artifact_id ?? '').trim();
  await assertAuthorized(params.actingPrincipalId, 'write', { kind: 'artifact', id: artifactId });
  const claimId = (params.claim_id ?? '').trim();
  const actorId = (params.actor_id ?? '').trim();
  const contentRef = params.content_ref;
  const fencingToken = params.fencing_token;
  if (!artifactId || !claimId || !actorId) {
    throw new ContextHubError(
      'BAD_REQUEST',
      'artifact_id, claim_id, actor_id are all required',
    );
  }
  if (!Number.isFinite(fencingToken)) {
    throw new ContextHubError('BAD_REQUEST', 'fencing_token must be a finite number');
  }
  // [MED-6] content_ref IS the write payload — a write versions the artifact, so
  // an empty/missing ref must be a clean BAD_REQUEST, not a silent v++ to ''.
  if (typeof contentRef !== 'string' || contentRef.trim() === '') {
    throw new ContextHubError('BAD_REQUEST', 'content_ref must be a non-empty string');
  }

  const pool = getDbPool();
  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    // (artifact) [code-r1 F1] — lock the artifact row and read its pre-transition
    // state FROM the locked row (the true pre-image — no concurrent writer can
    // change a row this txn holds). Replaces a `WITH prev` CTE whose pre-state
    // read was not verifiable under READ COMMITTED EvalPlanQual.
    const pre = await client.query<{ state: string }>(
      `SELECT state FROM artifacts WHERE artifact_id = $1 FOR UPDATE`,
      [artifactId],
    );
    if (pre.rowCount === 0) {
      await client.query('ROLLBACK');
      return { status: 'conflict', reason: 'artifact_not_found' };
    }
    const prevState = pre.rows[0].state;

    // Guarded UPDATE on the locked row — writable-state + fencing + claim-liveness
    // + claim-ownership fused into ONE statement (splitting them reopens a TOCTOU).
    // [HIGH-1] `c.actor_id = $5` — only the claim's OWNER may write; the fencing
    // token alone cannot authorize a peer who copied a live token out of the log.
    // 0 rows → classify.
    const upd = await client.query<{ version: number; state: string }>(
      `UPDATE artifacts
          SET version = version + 1,
              state = 'working',
              content_ref = $3,
              accepted_fencing_token = $4
        WHERE artifact_id = $1
          AND state IN ('draft','working','baselined')
          AND accepted_fencing_token <= $4
          AND EXISTS (SELECT 1 FROM claims c
                       WHERE c.claim_id = $2
                         AND c.artifact_id = $1
                         AND c.actor_id = $5
                         AND c.expires_at > now())
       RETURNING version, state`,
      [artifactId, claimId, contentRef, fencingToken, actorId],
    );

    if (upd.rowCount === 0) {
      const reason = await classifyGuardConflict(
        client, artifactId, claimId, fencingToken, actorId, WRITE_WRITABLE_STATES,
      );
      await client.query('ROLLBACK');
      return { status: 'conflict', reason };
    }

    const { version: newVersion, state: newState } = upd.rows[0];

    await client.query(
      `INSERT INTO artifact_versions (artifact_id, version, state, content_ref, fencing_token, note, created_by)
       VALUES ($1, $2, 'working', $3, $4, 'write', $5)`,
      [artifactId, newVersion, contentRef, fencingToken, actorId],
    );

    const topicId = await topicIdForArtifact(client, artifactId);
    await appendEvent(client, {
      topic_id: topicId,
      actor_id: actorId,
      type: 'artifact.versioned',
      subject_type: 'artifact',
      subject_id: artifactId,
      payload: { version: newVersion, fencing_token: fencingToken },
    });
    if (prevState !== newState) {
      await appendEvent(client, {
        topic_id: topicId,
        actor_id: actorId,
        type: 'artifact.state_changed',
        subject_type: 'artifact',
        subject_id: artifactId,
        payload: { from: prevState, to: newState },
      });
    }
    await client.query('COMMIT');
    return { status: 'ok', version: newVersion, state: newState };
  } catch (err) {
    await client.query('ROLLBACK').catch(() => {});
    logger.error({ err: String(err) }, 'writeArtifact failed');
    throw err;
  } finally {
    client.release();
  }
}

/**
 * Mark an artifact checkpoint (§3.2): `draft|working → baselined`. Same guarded
 * shape as writeArtifact — writable state + fencing + claim-liveness in one
 * `UPDATE`. The new version carries the SAME `content_ref` as the prior version
 * (a baseline marks, it does not edit).
 */
export async function baselineArtifact(params: {
  artifact_id: string;
  /** F2f — acting principal; authorize() is the tenant/authz gate (artifact → task scope). */
  actingPrincipalId?: string | null;
  claim_id: string;
  fencing_token: number;
  actor_id: string;
}): Promise<BaselineResult> {
  const artifactId = (params.artifact_id ?? '').trim();
  await assertAuthorized(params.actingPrincipalId, 'write', { kind: 'artifact', id: artifactId });
  const claimId = (params.claim_id ?? '').trim();
  const actorId = (params.actor_id ?? '').trim();
  const fencingToken = params.fencing_token;
  if (!artifactId || !claimId || !actorId) {
    throw new ContextHubError(
      'BAD_REQUEST',
      'artifact_id, claim_id, actor_id are all required',
    );
  }
  if (!Number.isFinite(fencingToken)) {
    throw new ContextHubError('BAD_REQUEST', 'fencing_token must be a finite number');
  }

  const pool = getDbPool();
  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    // (artifact) [code-r1 F1] — lock the artifact row, read pre-transition state
    // + content_ref FROM the locked row (the true pre-image), then the guarded
    // UPDATE on that same row. (Replaces a `WITH prev` CTE — see writeArtifact.)
    const pre = await client.query<{ state: string; content_ref: string | null }>(
      `SELECT state, content_ref FROM artifacts WHERE artifact_id = $1 FOR UPDATE`,
      [artifactId],
    );
    if (pre.rowCount === 0) {
      await client.query('ROLLBACK');
      return { status: 'conflict', reason: 'artifact_not_found' };
    }
    const prevState = pre.rows[0].state;
    // content_ref is carried forward — a baseline marks, it does not edit.
    const contentRef = pre.rows[0].content_ref;

    // Guarded UPDATE on the locked row — writable-state + fencing + claim-liveness
    // + claim-ownership fused into ONE statement. [HIGH-1] `c.actor_id = $4` —
    // only the claim's OWNER may baseline. 0 rows → classify.
    const upd = await client.query<{ version: number }>(
      `UPDATE artifacts
          SET state = 'baselined',
              version = version + 1,
              accepted_fencing_token = $3
        WHERE artifact_id = $1
          AND state IN ('draft','working')
          AND accepted_fencing_token <= $3
          AND EXISTS (SELECT 1 FROM claims c
                       WHERE c.claim_id = $2
                         AND c.artifact_id = $1
                         AND c.actor_id = $4
                         AND c.expires_at > now())
       RETURNING version`,
      [artifactId, claimId, fencingToken, actorId],
    );

    if (upd.rowCount === 0) {
      const reason = await classifyGuardConflict(
        client, artifactId, claimId, fencingToken, actorId, BASELINE_WRITABLE_STATES,
      );
      await client.query('ROLLBACK');
      return { status: 'conflict', reason };
    }

    const newVersion = upd.rows[0].version;

    await client.query(
      `INSERT INTO artifact_versions (artifact_id, version, state, content_ref, fencing_token, note, created_by)
       VALUES ($1, $2, 'baselined', $3, NULL, 'baselined', $4)`,
      [artifactId, newVersion, contentRef, actorId],
    );

    const topicId = await topicIdForArtifact(client, artifactId);
    await appendEvent(client, {
      topic_id: topicId,
      actor_id: actorId,
      type: 'artifact.state_changed',
      subject_type: 'artifact',
      subject_id: artifactId,
      payload: { from: prevState, to: 'baselined' },
    });
    await client.query('COMMIT');
    return { status: 'ok', version: newVersion, state: 'baselined' };
  } catch (err) {
    await client.query('ROLLBACK').catch(() => {});
    logger.error({ err: String(err) }, 'baselineArtifact failed');
    throw err;
  } finally {
    client.release();
  }
}

/**
 * Internal — revert an artifact during sweep recovery (§3.3). Reverts to the
 * artifact's LAST `baselined` `artifact_versions` row (or to `draft` if none),
 * always as an APPEND (a new version row), never an in-place content edit.
 * Never un-baselines; never touches `accepted_fencing_token` (monotonic).
 *
 * The caller (the sweep) already holds the artifact row lock (§4.1 step 3) — so
 * this fn does no locking itself. MUST run inside the caller's transaction.
 */
export async function revertArtifact(
  client: PoolClient,
  artifactId: string,
  actorId: string,
): Promise<{ version: number; state: string; from_state: string }> {
  const cur = await client.query<{ state: string }>(
    `SELECT state FROM artifacts WHERE artifact_id = $1`,
    [artifactId],
  );
  if (cur.rowCount === 0) {
    // Unreachable by construction — the only caller (the sweep, §4.1 step 3) has
    // already locked this artifact row with SELECT … FOR UPDATE, and artifacts
    // are never deleted. The throw stands as a defensive invariant guard.
    throw new ContextHubError('NOT_FOUND', `artifact ${artifactId} not found`);
  }
  const fromState = cur.rows[0].state;

  const lastBaselined = await client.query<{ version: number; content_ref: string | null }>(
    `SELECT version, content_ref FROM artifact_versions
      WHERE artifact_id = $1 AND state = 'baselined'
      ORDER BY version DESC
      LIMIT 1`,
    [artifactId],
  );

  let note: string;
  let targetState: 'baselined' | 'draft';
  let targetContentRef: string | null;
  if ((lastBaselined.rowCount ?? 0) > 0) {
    targetState = 'baselined';
    targetContentRef = lastBaselined.rows[0].content_ref;
    note = `reverted to v${lastBaselined.rows[0].version}`;
  } else {
    targetState = 'draft';
    targetContentRef = null;
    note = 'reverted to draft';
  }

  // Append: bump version, set state + content_ref. accepted_fencing_token is
  // NOT touched (monotonic — invariant 5).
  const upd = await client.query<{ version: number }>(
    `UPDATE artifacts
        SET state = $2, content_ref = $3, version = version + 1
      WHERE artifact_id = $1
     RETURNING version`,
    [artifactId, targetState, targetContentRef],
  );
  const newVersion = upd.rows[0].version;

  await client.query(
    `INSERT INTO artifact_versions (artifact_id, version, state, content_ref, fencing_token, note, created_by)
     VALUES ($1, $2, $3, $4, NULL, $5, $6)`,
    [artifactId, newVersion, targetState, targetContentRef, note, actorId],
  );

  return { version: newVersion, state: targetState, from_state: fromState };
}

/** Internal — the topic_id an artifact belongs to (a plain read, no lock). */
async function topicIdForArtifact(client: PoolClient, artifactId: string): Promise<string> {
  const res = await client.query<{ topic_id: string }>(
    `SELECT topic_id FROM artifacts WHERE artifact_id = $1`,
    [artifactId],
  );
  if (res.rowCount === 0) {
    throw new ContextHubError('NOT_FOUND', `artifact ${artifactId} not found`);
  }
  return res.rows[0].topic_id;
}
