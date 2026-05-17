/**
 * Phase 15 Sprint 15.2 + 15.3 — abandoned-claim recovery sweep + stalled-step
 * escalation sweep.
 *
 * Sprint 15.3 adds `sweepStalledSteps` (§4) and generalizes
 * `startClaimsSweepScheduler` (§4.2) to call both sweeps in sequence inside the
 * one advisory-lock hold.
 *
 * Design ref: docs/specs/2026-05-16-phase-15-sprint-15.2-design.md §4
 * Spec hash:  ea26ef6367e133ef
 *
 * A claim carries a real TTL. When it expires without release/complete, the
 * sweep retires it: drops the claim row, returns the task to the board, and
 * reverts the artifact to its last baseline (open topics). The sweep is the
 * ONLY consumer of an expired claim — `releaseTask`/`completeTask` act on live
 * claims only (design §9 invariant 8).
 *
 * Each expired claim is recovered in its OWN transaction under the §0.1-loop
 * contract — a `catch` that rolls back, logs, and `continue`s the loop (NEVER
 * re-throws), inside a `finally` that releases the client. One bad claim never
 * aborts the cycle (§9 invariant 7).
 *
 * Lock order `task → claim → artifact → topics` (§0.2 / §10) — identical to
 * completeTask, so no ABBA cycle. The topic status is read under
 * `SELECT … FOR UPDATE`, serializing `closeTopic`.
 */

import crypto from 'node:crypto';
import type { PoolClient } from 'pg';
import { getDbPool as defaultGetDbPool } from '../db/client.js';
import { createModuleLogger } from '../utils/logger.js';
import { appendEvent } from './coordinationEvents.js';
import { revertArtifact } from './artifacts.js';
import { LEVELS_ASC, LEVEL_RANK, STEP_DEADLINE_MINUTES } from './doaMatrix.js';
import { computeMotionTally } from './motions.js';

const logger = createModuleLogger('coordination-sweep');

export const SWEEP_INTERVAL_MS = 5 * 60_000; // 5 minutes

const DEFAULT_GRACE_MINUTES = 0;
const MAX_GRACE_MINUTES = 1440;

export type StalledStepsSweepResult = { escalated: number; swept_at: string };

export type ExpiredMotionsSweepResult = { resolved: number; swept_at: string };

export type SweepResult = { recovered: number; swept_at: string };

/** Clamp grace_minutes to [0, MAX_GRACE_MINUTES]; NaN / undefined → default. */
function clampGrace(graceMinutes?: number): number {
  if (graceMinutes === undefined || graceMinutes === null) return DEFAULT_GRACE_MINUTES;
  if (!Number.isFinite(graceMinutes)) return DEFAULT_GRACE_MINUTES;
  if (graceMinutes < 0) return 0;
  if (graceMinutes > MAX_GRACE_MINUTES) return MAX_GRACE_MINUTES;
  return Math.floor(graceMinutes);
}

/**
 * Recover all abandoned (expired) claims (§4.1). Each is processed in its own
 * §0.1-loop transaction — one failure logs and `continue`s, never aborts the
 * cycle. Returns the count of claims recovered.
 *
 * `grace_minutes` (default 0) — claims carry a real TTL, so 0 is the normal
 * value; configurable for a debugging grace window.
 */
export async function sweepAbandonedClaims(params?: {
  grace_minutes?: number;
}): Promise<SweepResult> {
  const grace = clampGrace(params?.grace_minutes);
  const pool = getDbPool();

  // Scan — snapshot the expired-claim set. Each claim is re-checked under a lock
  // inside its own transaction (it may have been released/completed since).
  const expired = await pool.query<{
    claim_id: string;
    topic_id: string;
    task_id: string;
    artifact_id: string;
    actor_id: string;
  }>(
    `SELECT claim_id, topic_id, task_id, artifact_id, actor_id
       FROM claims
      WHERE expires_at < now() - make_interval(mins => $1)`,
    [grace],
  );

  let recovered = 0;
  for (const claim of expired.rows) {
    const client = await pool.connect();
    try {
      await client.query('BEGIN');

      // ── canonical lock order task → claim → artifact → topics (§0.2 / §10) ──

      // (1) task row
      const taskRes = await client.query(
        `SELECT 1 FROM tasks WHERE task_id = $1 FOR UPDATE`,
        [claim.task_id],
      );
      if (taskRes.rowCount === 0) {
        // The task vanished (should not happen — tasks are never deleted). Drop
        // the orphan claim defensively and move on. [code-r1 F3] `recovered`
        // counts every claim the sweep retires (committed removal) — increment
        // here too, consistent with the closed-topic branch below.
        await client.query(`DELETE FROM claims WHERE claim_id = $1`, [claim.claim_id]);
        await client.query('COMMIT');
        recovered++;
        continue;
      }

      // (2) claim row — still present?
      const claimRes = await client.query(
        `SELECT 1 FROM claims WHERE claim_id = $1 FOR UPDATE`,
        [claim.claim_id],
      );
      if (claimRes.rowCount === 0) {
        // released / completed since the scan — nothing to recover.
        await client.query('ROLLBACK');
        continue;
      }

      // (3) artifact row [r3-fix F1] — locked before revertArtifact.
      await client.query(
        `SELECT 1 FROM artifacts WHERE artifact_id = $1 FOR UPDATE`,
        [claim.artifact_id],
      );

      // (4) topics row — closeTopic is serialized against this lock.
      const topicRes = await client.query<{ status: string }>(
        `SELECT status FROM topics WHERE topic_id = $1 FOR UPDATE`,
        [claim.topic_id],
      );

      if (topicRes.rows[0]?.status === 'closed') {
        // [r2-fix F2 / item 2-B] closed-topic branch — drop the dangling claim
        // and mark the task `abandoned`. No revert, no events: a closed topic is
        // a sealed self-consistent record (its tasks cannot be re-claimed —
        // claimTask's appendEvent is rejected by the seal), so a revert would
        // desync the artifact from the sealed log (CLARIFY AC11). The task
        // cannot return to the board, so `abandoned` is its terminal state —
        // distinct from `posted` (the open-topic recovery target below). The
        // status UPDATE is a plain write on the already-locked task row.
        await client.query(`DELETE FROM claims WHERE claim_id = $1`, [claim.claim_id]);
        await client.query(
          `UPDATE tasks SET status = 'abandoned'
            WHERE task_id = $1 AND status IN ('claimed','in_progress')`,
          [claim.task_id],
        );
        await client.query('COMMIT');
        recovered++;
        continue;
      }

      // ── open topic — full recovery (closeTopic cannot race in: we hold the
      // topics-row lock) ──
      await client.query(`DELETE FROM claims WHERE claim_id = $1`, [claim.claim_id]);
      await client.query(
        `UPDATE tasks SET status = 'posted'
          WHERE task_id = $1 AND status IN ('claimed','in_progress')`,
        [claim.task_id],
      );
      // §3.3 — the artifact row is already locked at step (3).
      const revert = await revertArtifact(client, claim.artifact_id, 'system:sweep');

      await appendEvent(client, {
        topic_id: claim.topic_id,
        actor_id: 'system:sweep',
        type: 'claim.expired',
        subject_type: 'artifact',
        subject_id: claim.artifact_id,
        payload: { claim_id: claim.claim_id, actor_id: claim.actor_id },
      });
      await appendEvent(client, {
        topic_id: claim.topic_id,
        actor_id: 'system:sweep',
        type: 'task.released',
        subject_type: 'task',
        subject_id: claim.task_id,
        payload: { reason: 'claim_expired' },
      });
      await appendEvent(client, {
        topic_id: claim.topic_id,
        actor_id: 'system:sweep',
        type: 'artifact.versioned',
        subject_type: 'artifact',
        subject_id: claim.artifact_id,
        payload: { version: revert.version, note: 'sweep revert' },
      });
      // [code-r1 F3] Emit artifact.state_changed ONLY when the revert actually
      // changed state — a claimed-but-never-written artifact reverts draft→draft,
      // a no-op transition that must not pollute the event log. (artifact.versioned
      // above is unconditional — the revert always appends a real new version.)
      if (revert.from_state !== revert.state) {
        await appendEvent(client, {
          topic_id: claim.topic_id,
          actor_id: 'system:sweep',
          type: 'artifact.state_changed',
          subject_type: 'artifact',
          subject_id: claim.artifact_id,
          payload: { from: revert.from_state, to: revert.state },
        });
      }
      await client.query('COMMIT');
      recovered++;
    } catch (err) {
      // §0.1-loop variant — log and CONTINUE; never re-throw. One bad claim
      // must not abort the cycle.
      await client.query('ROLLBACK').catch(() => {});
      logger.error({ err: String(err), claim_id: claim.claim_id }, 'sweep claim recovery failed');
      /* continue */
    } finally {
      client.release();
    }
  }

  const result: SweepResult = { recovered, swept_at: new Date().toISOString() };
  logger.info(result, 'claims.sweep complete');
  return result;
}

// ── §4.1 sweepStalledSteps ───────────────────────────────────────────────────

/**
 * Escalate all active stalled request steps (§4.1).
 *
 * "Active stalled" = a `pending` step whose deadline has passed, and whose
 * request's `current_step` is this step (the `current_step` join ensures only
 * the active step is swept, never a waiting non-current step).
 *
 * Each stalled step is processed in its own §0.1-loop transaction
 * (catch → log → `continue`). Lock order: `request → request_step → topics`.
 *
 * Branch logic (D9):
 *   - target_office < authority: climb one level in place (status stays 'pending',
 *     deadline reset to now+60min), emit request.step_escalated.
 *   - target_office = authority: mark step 'escalated', mark request
 *     'escalation_exhausted', emit request.step_escalated + request.resolved.
 *
 * Closed-topic branch: skip (no mutation, no events) — a stalled step is not a
 * lease; nothing leaks on close (§9 inv. 7 + §11.6).
 */
export async function sweepStalledSteps(params?: {
  grace_minutes?: number;
}): Promise<StalledStepsSweepResult> {
  const grace = clampGrace(params?.grace_minutes);
  const pool = getDbPool();

  // Scan: find all active stalled steps.
  const stalled = await pool.query<{
    request_id: string;
    step_index: number;
    target_office: string;
    topic_id: string;
  }>(
    `SELECT s.request_id, s.step_index, s.target_office, r.topic_id
       FROM request_steps s
       JOIN requests r ON r.request_id = s.request_id AND r.current_step = s.step_index
      WHERE s.status = 'pending' AND r.status = 'open'
        AND s.deadline < now() - make_interval(mins => $1)`,
    [grace],
  );

  let escalated = 0;

  for (const step of stalled.rows) {
    const client = await pool.connect();
    try {
      await client.query('BEGIN');

      // ── (request) row lock ─────────────────────────────────────────────────
      const reqRes = await client.query<{ status: string; current_step: number }>(
        `SELECT status, current_step FROM requests WHERE request_id=$1 FOR UPDATE`,
        [step.request_id],
      );
      if (reqRes.rowCount === 0 || reqRes.rows[0].status !== 'open' || reqRes.rows[0].current_step !== step.step_index) {
        // Decided since the scan — skip.
        await client.query('ROLLBACK');
        continue;
      }

      // ── (request_step) row lock ────────────────────────────────────────────
      const stepRes = await client.query<{ target_office: string; status: string; deadline: Date }>(
        `SELECT target_office, status, deadline FROM request_steps
           WHERE request_id=$1 AND step_index=$2 FOR UPDATE`,
        [step.request_id, step.step_index],
      );
      if (
        stepRes.rowCount === 0 ||
        stepRes.rows[0].status !== 'pending' ||
        stepRes.rows[0].deadline >= new Date()
      ) {
        // No longer stalled — skip.
        await client.query('ROLLBACK');
        continue;
      }
      const currentOffice = stepRes.rows[0].target_office;

      // ── (topics) row lock — serializes with closeTopic ────────────────────
      const topicRes = await client.query<{ status: string }>(
        `SELECT status FROM topics WHERE topic_id=$1 FOR UPDATE`,
        [step.topic_id],
      );
      if (topicRes.rows[0]?.status === 'closed') {
        // Closed topic: skip — no mutation, no events (§9 inv. 7 + §11.6).
        await client.query('ROLLBACK');
        continue;
      }

      if (currentOffice !== 'authority') {
        // Climb one level in place
        const currentRank = LEVEL_RANK[currentOffice] ?? 0;
        const nextOffice = LEVELS_ASC[currentRank + 1] ?? 'authority';

        await client.query(
          `UPDATE request_steps SET target_office=$1, deadline = now() + interval '${STEP_DEADLINE_MINUTES} minutes'
             WHERE request_id=$2 AND step_index=$3`,
          [nextOffice, step.request_id, step.step_index],
        );

        await appendEvent(client, {
          topic_id: step.topic_id,
          actor_id: 'system:sweep',
          type: 'request.step_escalated',
          subject_type: 'request',
          subject_id: step.request_id,
          payload: {
            step_index: step.step_index,
            from_office: currentOffice,
            to_office: nextOffice,
          },
        });
      } else {
        // Already at authority — terminal
        await client.query(
          `UPDATE request_steps SET status='escalated', decided_by='system:sweep', decided_at=now()
             WHERE request_id=$1 AND step_index=$2`,
          [step.request_id, step.step_index],
        );
        await client.query(
          `UPDATE requests SET status='escalation_exhausted' WHERE request_id=$1`,
          [step.request_id],
        );
        await appendEvent(client, {
          topic_id: step.topic_id,
          actor_id: 'system:sweep',
          type: 'request.step_escalated',
          subject_type: 'request',
          subject_id: step.request_id,
          payload: { step_index: step.step_index, exhausted: true },
        });
        await appendEvent(client, {
          topic_id: step.topic_id,
          actor_id: 'system:sweep',
          type: 'request.resolved',
          subject_type: 'request',
          subject_id: step.request_id,
          payload: { outcome: 'escalation_exhausted' },
        });
      }

      await client.query('COMMIT');
      escalated++;
    } catch (err) {
      // §0.1-loop variant — log and CONTINUE; never re-throw.
      await client.query('ROLLBACK').catch(() => {});
      logger.error(
        { err: String(err), request_id: step.request_id, step_index: step.step_index },
        'sweep stalled-step escalation failed',
      );
      /* continue */
    } finally {
      client.release();
    }
  }

  const result: StalledStepsSweepResult = { escalated, swept_at: new Date().toISOString() };
  logger.info(result, 'steps.sweep complete');
  return result;
}

// ── §5 sweepExpiredMotions (Phase 15 Sprint 15.4) ────────────────────────────

/**
 * Resolve all expired motions (§5). A third swept entity alongside
 * `sweepAbandonedClaims` + `sweepStalledSteps`.
 *
 * "Expired" = a `proposed` or `balloting` motion whose deadline has passed.
 * Each motion is processed in its own §0.1-loop transaction (catch → log →
 * `continue` — never re-throws). Lock order: `motion → topics`.
 *
 * Branch logic (D9):
 *   - status='proposed' (never seconded): UPDATE to 'lapsed', emit
 *     motion.tallied{outcome:'lapsed', reason:'not_seconded'}.
 *   - status='balloting': run the §4 tally, UPDATE to the outcome, emit
 *     motion.tallied{outcome, auto:true, ...tally}.
 *
 * Closed-topic branch: skip (no mutation, no event) — a motion on a closed topic
 * is frozen mid-flight in the sealed log (DEFERRED-012's `closing`-drain will
 * force-lapse it). The topics row is locked FOR UPDATE — closeTopic is serialized.
 *
 * Convergence — an expired motion is moved to a terminal status in one tick;
 * terminal statuses are excluded by the scan predicate, so it cannot re-enter.
 */
export async function sweepExpiredMotions(params?: {
  grace_minutes?: number;
}): Promise<ExpiredMotionsSweepResult> {
  const grace = clampGrace(params?.grace_minutes);
  const pool = getDbPool();

  // Scan — snapshot the expired-motion set. Each motion is re-checked under a
  // lock inside its own transaction (it may have been vetoed/tallied since).
  const expired = await pool.query<{ motion_id: string; topic_id: string }>(
    `SELECT motion_id, topic_id FROM motions
      WHERE status IN ('proposed','balloting')
        AND deadline < now() - make_interval(mins => $1)`,
    [grace],
  );

  let resolved = 0;

  for (const row of expired.rows) {
    const client = await pool.connect();
    try {
      await client.query('BEGIN');

      // ── (motion) row lock ──────────────────────────────────────────────────
      const motionRes = await client.query<{
        body_id: string; status: string; expired: boolean;
      }>(
        `SELECT body_id, status, (deadline < now()) AS expired
           FROM motions WHERE motion_id=$1 FOR UPDATE`,
        [row.motion_id],
      );
      if (
        motionRes.rowCount === 0 ||
        !['proposed', 'balloting'].includes(motionRes.rows[0].status) ||
        !motionRes.rows[0].expired
      ) {
        // Vetoed / tallied / no longer expired since the scan — skip.
        await client.query('ROLLBACK');
        continue;
      }
      const motion = motionRes.rows[0];

      // ── (topics) row lock — serializes closeTopic ─────────────────────────
      const topicRes = await client.query<{ status: string }>(
        `SELECT status FROM topics WHERE topic_id=$1 FOR UPDATE`,
        [row.topic_id],
      );
      if (topicRes.rows[0]?.status === 'closed') {
        // Closed topic: skip — frozen mid-flight (DEFERRED-012). No mutation,
        // no event.
        await client.query('ROLLBACK');
        continue;
      }

      if (motion.status === 'proposed') {
        // Never seconded — lapse it (D9).
        await client.query(
          `UPDATE motions SET status='lapsed', tally=NULL WHERE motion_id=$1`,
          [row.motion_id],
        );
        await appendEvent(client, {
          topic_id: row.topic_id,
          actor_id: 'system:sweep',
          type: 'motion.tallied',
          subject_type: 'motion',
          subject_id: row.motion_id,
          payload: { outcome: 'lapsed', reason: 'not_seconded' },
        });
      } else {
        // 'balloting' — run the §4 tally.
        const bodyRes = await client.query<{ quorum: string; threshold: string }>(
          `SELECT quorum, threshold FROM decision_bodies WHERE body_id=$1`,
          [motion.body_id],
        );
        const quorum = Number(bodyRes.rows[0].quorum);
        const threshold = Number(bodyRes.rows[0].threshold);
        const { outcome, tally } = await computeMotionTally(client, row.motion_id, quorum, threshold);
        await client.query(
          `UPDATE motions SET status=$1, tally=$2 WHERE motion_id=$3`,
          [outcome, JSON.stringify(tally), row.motion_id],
        );
        await appendEvent(client, {
          topic_id: row.topic_id,
          actor_id: 'system:sweep',
          type: 'motion.tallied',
          subject_type: 'motion',
          subject_id: row.motion_id,
          payload: { outcome, auto: true, ...tally },
        });
      }

      await client.query('COMMIT');
      resolved++;
    } catch (err) {
      // §0.1-loop variant — log and CONTINUE; never re-throw.
      await client.query('ROLLBACK').catch(() => {});
      logger.error(
        { err: String(err), motion_id: row.motion_id },
        'sweep expired-motion resolution failed',
      );
      /* continue */
    } finally {
      client.release();
    }
  }

  const result: ExpiredMotionsSweepResult = { resolved, swept_at: new Date().toISOString() };
  logger.info(result, 'motions.sweep complete');
  return result;
}

// ── §4.2 in-process scheduler ────────────────────────────────────────────────

// Test-injectable dependencies. Production uses the defaults; tests call
// `__setSweepDependenciesForTest()` to swap mocks. NOT a public API.
let _getDbPool: typeof defaultGetDbPool = defaultGetDbPool;
let _sweepAbandonedClaims: typeof sweepAbandonedClaims = sweepAbandonedClaims;
let _sweepStalledSteps: typeof sweepStalledSteps = sweepStalledSteps;
let _sweepExpiredMotions: typeof sweepExpiredMotions = sweepExpiredMotions;

function getDbPool(): ReturnType<typeof defaultGetDbPool> {
  return _getDbPool();
}

export function __setSweepDependenciesForTest(deps: {
  getDbPool?: typeof defaultGetDbPool;
  sweepAbandonedClaims?: typeof sweepAbandonedClaims;
  sweepStalledSteps?: typeof sweepStalledSteps;
  sweepExpiredMotions?: typeof sweepExpiredMotions;
}): void {
  if (deps.getDbPool) _getDbPool = deps.getDbPool;
  if (deps.sweepAbandonedClaims) _sweepAbandonedClaims = deps.sweepAbandonedClaims;
  if (deps.sweepStalledSteps) _sweepStalledSteps = deps.sweepStalledSteps;
  if (deps.sweepExpiredMotions) _sweepExpiredMotions = deps.sweepExpiredMotions;
}

export function __resetSweepDependenciesForTest(): void {
  _getDbPool = defaultGetDbPool;
  _sweepAbandonedClaims = sweepAbandonedClaims;
  _sweepStalledSteps = sweepStalledSteps;
  _sweepExpiredMotions = sweepExpiredMotions;
}

/**
 * Advisory-lock key derived deterministically from a stable string literal.
 * First 8 bytes of SHA256 interpreted as signed int64.
 *
 * Registry entry: docs/operations/advisory-locks.md → `phase-15.claims-sweep`
 */
export const CLAIMS_SWEEP_ADVISORY_KEY: bigint = (() => {
  const digest = crypto.createHash('sha256').update('phase-15.claims-sweep').digest();
  const u64 = digest.readBigUInt64BE(0);
  const SIGN_BIT = 1n << 63n;
  return u64 >= SIGN_BIT ? u64 - (1n << 64n) : u64;
})();

export interface ClaimsSweepHandle {
  /** Stop the scheduler. Used by tests; production lets SIGINT/exit clear timers. */
  stop(): void;
}

export interface StartClaimsSweepOptions {
  intervalMs?: number;     // override for tests
  graceMinutes?: number;   // grace-window override (default 0)
}

/**
 * Start the periodic abandoned-claim sweep scheduler (§4.2). The
 * `sweepScheduler.ts` scheduling structure — a `setTimeout`-chained cycle, a
 * Postgres advisory lock around the work, an outer try/finally that always
 * re-schedules, a `stop()` handle. The cycle calls `sweepAbandonedClaims()`
 * DIRECTLY (per-claim transactional recovery — no `enqueueJob`).
 *
 * On the advisory lock — like `sweepScheduler.ts`, this is NOT leader election:
 * the lock is held only around one cycle's work. Two replicas would each run a
 * sweep, but per-claim recovery re-checks the claim under a row lock and acts
 * only if it is still present — so a duplicate run recovers nothing extra.
 */
export function startClaimsSweepScheduler(opts: StartClaimsSweepOptions = {}): ClaimsSweepHandle {
  const interval = opts.intervalMs ?? SWEEP_INTERVAL_MS;
  const grace = opts.graceMinutes;
  let stopped = false;
  let timer: NodeJS.Timeout | null = null;

  const cycle = async (): Promise<void> => {
    if (stopped) return;
    let gotLock = false;
    let client: PoolClient | null = null;
    try {
      try {
        const pool = getDbPool();
        client = await pool.connect().catch(() => null);
        if (!client) {
          logger.error({ event: 'claims_sweep_pool_unavailable' }, 'db pool unavailable; will retry next interval');
          return;
        }
        const r = await client.query<{ acquired: boolean }>(
          `SELECT pg_try_advisory_lock($1::bigint) AS acquired`,
          [CLAIMS_SWEEP_ADVISORY_KEY.toString()],
        );
        gotLock = r.rows[0]?.acquired === true;
        if (!gotLock) {
          logger.info({ event: 'claims_sweep_lock_not_acquired' }, 'advisory lock not acquired this cycle; sweep skipped');
          return;
        }
        const swept = await _sweepAbandonedClaims(
          grace !== undefined ? { grace_minutes: grace } : undefined,
        );
        logger.info({ event: 'claims_sweep_done', recovered: swept.recovered }, 'claims.sweep cycle complete');
        // §4.2 — also run stalled-step escalation in the same advisory-lock hold
        const stepsSwept = await _sweepStalledSteps();
        logger.info({ event: 'steps_sweep_done', escalated: stepsSwept.escalated }, 'steps.sweep cycle complete');
        // §5.1 — also run expired-motion resolution (the third sweep) in the
        // same advisory-lock hold.
        const motionsSwept = await _sweepExpiredMotions();
        logger.info({ event: 'motions_sweep_done', resolved: motionsSwept.resolved }, 'motions.sweep cycle complete');
      } catch (err) {
        logger.error(
          { event: 'claims_sweep_cycle_failed', err: err instanceof Error ? err.message : String(err) },
          'claims.sweep cycle failed; will retry next interval',
        );
      } finally {
        if (gotLock && client) {
          await client
            .query(`SELECT pg_advisory_unlock($1::bigint)`, [CLAIMS_SWEEP_ADVISORY_KEY.toString()])
            .catch(() => {
              /* swallow — Postgres releases on disconnect anyway */
            });
        }
        if (client) client.release();
      }
    } finally {
      // Outermost finally: ALWAYS reschedule (unless stopped).
      if (!stopped) {
        timer = setTimeout(() => {
          void cycle();
        }, interval);
      }
    }
  };

  timer = setTimeout(() => {
    void cycle();
  }, interval);

  logger.info(
    {
      interval_minutes: interval / 60_000,
      advisory_key: CLAIMS_SWEEP_ADVISORY_KEY.toString(),
    },
    'claims.sweep scheduler started',
  );

  return {
    stop() {
      stopped = true;
      if (timer) clearTimeout(timer);
    },
  };
}
