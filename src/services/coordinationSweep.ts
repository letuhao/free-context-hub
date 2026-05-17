/**
 * Phase 15 Sprint 15.2 — abandoned-claim recovery sweep.
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

const logger = createModuleLogger('coordination-sweep');

export const SWEEP_INTERVAL_MS = 5 * 60_000; // 5 minutes

const DEFAULT_GRACE_MINUTES = 0;
const MAX_GRACE_MINUTES = 1440;

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

// ── §4.2 in-process scheduler ────────────────────────────────────────────────

// Test-injectable dependencies. Production uses the defaults; tests call
// `__setSweepDependenciesForTest()` to swap mocks. NOT a public API.
let _getDbPool: typeof defaultGetDbPool = defaultGetDbPool;
let _sweepAbandonedClaims: typeof sweepAbandonedClaims = sweepAbandonedClaims;

function getDbPool(): ReturnType<typeof defaultGetDbPool> {
  return _getDbPool();
}

export function __setSweepDependenciesForTest(deps: {
  getDbPool?: typeof defaultGetDbPool;
  sweepAbandonedClaims?: typeof sweepAbandonedClaims;
}): void {
  if (deps.getDbPool) _getDbPool = deps.getDbPool;
  if (deps.sweepAbandonedClaims) _sweepAbandonedClaims = deps.sweepAbandonedClaims;
}

export function __resetSweepDependenciesForTest(): void {
  _getDbPool = defaultGetDbPool;
  _sweepAbandonedClaims = sweepAbandonedClaims;
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
