/**
 * Phase 13 Sprint 13.2 — Background sweep scheduler for artifact_leases.
 *
 * Design ref:  docs/specs/2026-05-15-phase-13-sprint-13.2-design.md §5a (v4)
 * Spec hash:   d691fbb5c0b9f92c
 *
 * In-process setTimeout-chained scheduler. Each cycle:
 *   1. Acquire a Postgres advisory lock (leader election for multi-replica)
 *   2. If lock acquired: enqueue a `leases.sweep` job (worker runs the DELETE)
 *   3. If not acquired: another replica is the leader this cycle; skip
 *   4. Release lock, chain next cycle
 *
 * The lock is NOT held during the actual sweep — only across the enqueue.
 * Worker processes the queued job independently.
 *
 * Registry: docs/operations/advisory-locks.md
 */

import crypto from 'node:crypto';
import { getDbPool as defaultGetDbPool } from '../db/client.js';
import { enqueueJob as defaultEnqueueJob } from './jobQueue.js';
import { createModuleLogger } from '../utils/logger.js';

const logger = createModuleLogger('sweep-scheduler');

// Test-injectable dependencies. Production uses the defaults; tests call
// `__setSweepDependenciesForTest()` to swap mocks. The hooks are NOT a public
// API and should only be used by sweepScheduler.test.ts.
let _getDbPool: typeof defaultGetDbPool = defaultGetDbPool;
let _enqueueJob: typeof defaultEnqueueJob = defaultEnqueueJob;

export function __setSweepDependenciesForTest(deps: {
  getDbPool?: typeof defaultGetDbPool;
  enqueueJob?: typeof defaultEnqueueJob;
}): void {
  if (deps.getDbPool) _getDbPool = deps.getDbPool;
  if (deps.enqueueJob) _enqueueJob = deps.enqueueJob;
}

export function __resetSweepDependenciesForTest(): void {
  _getDbPool = defaultGetDbPool;
  _enqueueJob = defaultEnqueueJob;
}

export const SWEEP_INTERVAL_MS = 15 * 60 * 1000; // 15 minutes

/**
 * Advisory-lock key derived deterministically from a stable string literal.
 * First 8 bytes of SHA256 interpreted as signed int64.
 *
 * Registry entry: docs/operations/advisory-locks.md → `phase-13.leases-sweep`
 */
export const LEASES_SWEEP_ADVISORY_KEY: bigint = (() => {
  const digest = crypto.createHash('sha256').update('phase-13.leases-sweep').digest();
  // First 8 bytes → unsigned bigint, then coerce to signed int64 range
  const u64 = digest.readBigUInt64BE(0);
  const SIGN_BIT = 1n << 63n;
  return u64 >= SIGN_BIT ? u64 - (1n << 64n) : u64;
})();

export interface SweepHandle {
  /** Stop the scheduler. Used by tests; production lets SIGINT/exit clear timers. */
  stop(): void;
}

export interface StartSweepOptions {
  intervalMs?: number; // Override for tests
  graceMinutes?: number; // Payload override (default 60)
}

/**
 * Start the periodic sweep scheduler.
 *
 * Multi-replica safety: each cycle attempts to acquire a Postgres advisory
 * lock; only the lock-holder enqueues a leases.sweep job.
 */
export function startSweepScheduler(opts: StartSweepOptions = {}): SweepHandle {
  const interval = opts.intervalMs ?? SWEEP_INTERVAL_MS;
  const grace = opts.graceMinutes ?? 60;
  let stopped = false;
  let timer: NodeJS.Timeout | null = null;

  const cycle = async (): Promise<void> => {
    if (stopped) return;
    // post-audit R4 fix: outer try/finally guarantees the cycle re-schedules
    // itself even on synchronous throws from _getDbPool() (env regression,
    // pool init failure). Inner work is in its own try/catch for log/release.
    let gotLock = false;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    let client: any = null;
    try {
      try {
        const pool = _getDbPool();
        client = await pool.connect().catch(() => null);
        if (!client) {
          logger.error({ event: 'leases_sweep_pool_unavailable' }, 'db pool unavailable; will retry next interval');
          return;
        }
        const r = await client.query(
          `SELECT pg_try_advisory_lock($1::bigint) AS acquired`,
          [LEASES_SWEEP_ADVISORY_KEY.toString()],
        );
        gotLock = r.rows[0]?.acquired === true;
        if (!gotLock) {
          logger.info({ event: 'leases_sweep_skip_not_leader' }, 'another replica scheduled sweep this cycle');
          return;
        }
        const enq = await _enqueueJob({
          job_type: 'leases.sweep',
          payload: { grace_minutes: grace },
          correlation_id: `sweep-${Date.now()}`,
        });
        logger.info(
          { event: 'leases_sweep_enqueued', job_id: enq.job_id, backend: enq.backend },
          'leases.sweep scheduled',
        );
      } catch (err) {
        logger.error(
          { event: 'leases_sweep_cycle_failed', err: err instanceof Error ? err.message : String(err) },
          'leases.sweep cycle failed; will retry next interval',
        );
      } finally {
        if (gotLock && client) {
          await client
            .query(`SELECT pg_advisory_unlock($1::bigint)`, [LEASES_SWEEP_ADVISORY_KEY.toString()])
            .catch(() => {
              /* swallow — Postgres releases on disconnect anyway */
            });
        }
        if (client) client.release();
      }
    } finally {
      // Outermost finally: ALWAYS reschedule (unless stopped). Guards against
      // any escape from the inner try/catch/finally including synchronous throws.
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
      advisory_key: LEASES_SWEEP_ADVISORY_KEY.toString(),
      grace_minutes: grace,
    },
    'leases.sweep scheduler started',
  );

  return {
    stop() {
      stopped = true;
      if (timer) clearTimeout(timer);
    },
  };
}
