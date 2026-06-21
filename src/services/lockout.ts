/**
 * Actor Data Boundary F-AUTH (Stream S3) — login lockout (OWASP ASVS V6).
 *
 * Two lock kinds, per the standards-gap design (§3) and OWASP ASVS V6:
 *   - SOFT lock: transient, increasing-delay backoff keyed on consecutive failures. Self-clears once
 *     `soft_locked_until` passes. This is the anti-automation throttle (ASVS: ≤100 failed attempts/hr).
 *   - HARD lock: sticky. Set once consecutive failures cross a hard threshold; cleared ONLY by an
 *     admin or a password reset — never by waiting.
 *
 * INVARIANT (the one the §6 adversary will probe): a password RESET must NEVER lock an account and
 * MUST clear any existing lock (ASVS 2.2.3). `clearLockout` is the reset path; it is the only writer
 * that drops hard_locked, and `recordFailure` is the only writer that sets it. They are disjoint.
 *
 * Config is env-driven (recorded for src/env.ts §2.9 — this slice does NOT edit env.ts). Until the
 * keys land in the schema we read them via process.env with safe NIST/OWASP-aligned defaults; the
 * integrator promotes them to the Zod schema at reconcile.
 */

import { getDbPool } from '../db/client.js';

/** Lockout tuning — resolved from process.env at call time (recorded for env.ts at §2.9). */
export interface LockoutPolicy {
  /** Failures before the soft (increasing-delay) lock begins. */
  softThreshold: number;
  /** Failures before the sticky hard lock trips. Must be > softThreshold. */
  hardThreshold: number;
  /** Base soft-lock delay in seconds; the window grows with each failure past softThreshold. */
  softBaseDelaySeconds: number;
  /** Cap on a single soft-lock window (seconds) so the ≤100/hr ceiling is never exceeded by design. */
  softMaxDelaySeconds: number;
  /** [A4] Hard-lock auto-expiry in seconds. 0 = permanent (admin/reset only). When > 0, a hard lock
   *  self-clears after this window — bounding the account-DoS vector. Default 30 min. */
  hardDurationSeconds: number;
}

function num(key: string, dflt: number): number {
  const raw = process.env[key];
  if (raw === undefined || raw.trim() === '') return dflt;
  const n = Number(raw);
  return Number.isFinite(n) && n >= 0 ? n : dflt;
}

/**
 * Resolve the active policy. Defaults are OWASP/NIST-aligned and chosen so the soft backoff alone
 * holds an attacker under 100 attempts/hour well before the hard lock:
 *   - soft at 3, +5s base doubling up to 300s; hard at 10.
 */
export function getLockoutPolicy(): LockoutPolicy {
  const softThreshold = Math.max(1, num('AUTH_LOCKOUT_SOFT_THRESHOLD', 3));
  const hardThreshold = Math.max(softThreshold + 1, num('AUTH_LOCKOUT_HARD_THRESHOLD', 10));
  return {
    softThreshold,
    hardThreshold,
    softBaseDelaySeconds: Math.max(1, num('AUTH_LOCKOUT_SOFT_BASE_DELAY_SECONDS', 5)),
    softMaxDelaySeconds: Math.max(1, num('AUTH_LOCKOUT_SOFT_MAX_DELAY_SECONDS', 300)),
    // [A4] 0 = permanent (admin/reset-only — the pre-A4 behaviour). Default 30 min auto-expiry.
    hardDurationSeconds: num('AUTH_LOCKOUT_HARD_DURATION_SECONDS', 1800),
  };
}

/**
 * PURE backoff core (no DB) — given a consecutive-failure count, compute the soft-lock delay in
 * seconds. Returns 0 below the soft threshold (no lock yet). Exponential growth (base × 2^over),
 * clamped to softMaxDelaySeconds. This is the function the unit tests assert directly.
 *
 * The clamp + exponential shape is what guarantees the ASVS ≤100-failures/hr ceiling: once the delay
 * saturates at the max, the throughput is bounded by 3600/softMaxDelaySeconds attempts/hr.
 */
export function softDelaySeconds(consecutiveFailures: number, policy: LockoutPolicy): number {
  if (consecutiveFailures < policy.softThreshold) return 0;
  const over = consecutiveFailures - policy.softThreshold;
  const raw = policy.softBaseDelaySeconds * Math.pow(2, over);
  return Math.min(raw, policy.softMaxDelaySeconds);
}

/** PURE — does this failure count trip the sticky hard lock? */
export function shouldHardLock(consecutiveFailures: number, policy: LockoutPolicy): boolean {
  return consecutiveFailures >= policy.hardThreshold;
}

export interface LockState {
  hardLocked: boolean;
  softLockedUntil: Date | null;
  failedCount: number;
  /** [A4] Hard-lock expiry. null = permanent (admin/reset-only); a past value = lapsed (auto-unlock). */
  hardLockedUntil: Date | null;
}

/**
 * PURE — is login currently blocked, and why? `now` is injected for deterministic tests.
 * Hard lock dominates; [A4] a hard lock whose `hardLockedUntil` has passed is LAPSED (treated as
 * unlocked, falling through to the soft check). A null `hardLockedUntil` is permanent (pre-A4 / the
 * duration=0 config). Otherwise a soft window in the future blocks.
 */
export function evaluateLock(state: LockState, now: Date = new Date()): { locked: boolean; reason: 'hard' | 'soft' | null; retryAfterSeconds: number } {
  if (state.hardLocked) {
    const lapsed = state.hardLockedUntil !== null && state.hardLockedUntil.getTime() <= now.getTime();
    if (!lapsed) {
      const retryAfterSeconds = state.hardLockedUntil ? Math.ceil((state.hardLockedUntil.getTime() - now.getTime()) / 1000) : 0;
      return { locked: true, reason: 'hard', retryAfterSeconds };
    }
    // lapsed hard lock → fall through (a later successful login fully clears it via recordSuccess).
  }
  if (state.softLockedUntil && state.softLockedUntil.getTime() > now.getTime()) {
    return { locked: true, reason: 'soft', retryAfterSeconds: Math.ceil((state.softLockedUntil.getTime() - now.getTime()) / 1000) };
  }
  return { locked: false, reason: null, retryAfterSeconds: 0 };
}

// ── DB-bound operations ───────────────────────────────────────────────────────────────────────────

/** Read the current lock state for a principal (null if no human credential row). */
export async function getLockState(principalId: string): Promise<LockState | null> {
  const res = await getDbPool().query<{ hard_locked: boolean; soft_locked_until: Date | null; failed_count: number; hard_locked_until: Date | null }>(
    `SELECT hard_locked, soft_locked_until, failed_count, hard_locked_until FROM human_credentials WHERE principal_id = $1`,
    [principalId],
  );
  const row = res.rows[0];
  if (!row) return null;
  return { hardLocked: row.hard_locked, softLockedUntil: row.soft_locked_until, failedCount: row.failed_count, hardLockedUntil: row.hard_locked_until };
}

/**
 * Record a failed login: increment failed_count, recompute the soft window, and trip the hard lock
 * if the threshold is crossed. Returns the resulting lock evaluation so the caller can shape the 429.
 */
export async function recordFailure(principalId: string): Promise<{ locked: boolean; reason: 'hard' | 'soft' | null; retryAfterSeconds: number }> {
  const policy = getLockoutPolicy();
  const pool = getDbPool();
  // Single atomic UPDATE...RETURNING so concurrent failed attempts can't lose an increment.
  const res = await pool.query<{ failed_count: number }>(
    `UPDATE human_credentials SET failed_count = failed_count + 1 WHERE principal_id = $1 RETURNING failed_count`,
    [principalId],
  );
  if (res.rowCount === 0) {
    // No credential row — treat as not-locked (the caller already returns a generic invalid-credential
    // response to avoid user enumeration). Nothing to record.
    return { locked: false, reason: null, retryAfterSeconds: 0 };
  }
  const failed = res.rows[0].failed_count;
  const delay = softDelaySeconds(failed, policy);
  const hard = shouldHardLock(failed, policy);
  const softUntil = delay > 0 ? new Date(Date.now() + delay * 1000) : null;
  // [A4] Stamp the hard-lock expiry when the lock ARMS — i.e. on the first transition into hard-lock
  // (NOT hard_locked) OR when a previously-armed window has already LAPSED (re-arm). During an ACTIVE
  // window we keep the existing expiry, so an attacker hammering mid-window can't extend it; but once
  // it lapses a fresh threshold-crossing re-arms a new window rather than degrading to soft-only
  // forever (review-impl #1). A NULL expiry is PERMANENT (duration=0 / pre-A4) and is never re-armed.
  const hardUntil = hard && policy.hardDurationSeconds > 0 ? new Date(Date.now() + policy.hardDurationSeconds * 1000) : null;
  await pool.query(
    `UPDATE human_credentials
        SET soft_locked_until = $2,
            hard_locked = (hard_locked OR $3),
            hard_locked_until = CASE
              WHEN $3 AND (NOT hard_locked OR (hard_locked_until IS NOT NULL AND hard_locked_until <= now()))
                THEN $4
              ELSE hard_locked_until
            END
      WHERE principal_id = $1`,
    [principalId, softUntil, hard, hardUntil],
  );
  if (hard) return { locked: true, reason: 'hard', retryAfterSeconds: hardUntil ? policy.hardDurationSeconds : 0 };
  if (softUntil) return { locked: true, reason: 'soft', retryAfterSeconds: delay };
  return { locked: false, reason: null, retryAfterSeconds: 0 };
}

/** Record a successful login: clear ALL lock state + stamp last_login_at. [A4] This now also clears the
 *  hard lock: with auto-expiry a LAPSED hard lock can reach a successful verify, and a correct password
 *  after the window means the legitimate user is back — so the lock is fully reset. (A still-active hard
 *  lock never reaches here: login is refused before verify, so this never clears a live lock.) */
export async function recordSuccess(principalId: string): Promise<void> {
  await getDbPool().query(
    `UPDATE human_credentials
        SET failed_count = 0, soft_locked_until = NULL, hard_locked = false, hard_locked_until = NULL, last_login_at = now()
      WHERE principal_id = $1`,
    [principalId],
  );
}

/**
 * Clear ALL lockout state — the reset path. THIS IS THE INVARIANT (ASVS 2.2.3): a password reset must
 * clear the lock and can NEVER set one. It drops failed_count, the soft window AND the hard lock.
 * Called only from the password-reset / admin-unlock flow.
 */
export async function clearLockout(principalId: string): Promise<void> {
  await getDbPool().query(
    `UPDATE human_credentials
        SET failed_count = 0, soft_locked_until = NULL, hard_locked = false, hard_locked_until = NULL
      WHERE principal_id = $1`,
    [principalId],
  );
}
