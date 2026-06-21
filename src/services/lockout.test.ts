/**
 * Actor Data Boundary F-AUTH (Stream S3) — lockout PURE-logic tests (no DB).
 *
 * Covers the OWASP ASVS V6 invariants that can be asserted without a database:
 *   - soft increasing-delay backoff: 0 below threshold, exponential growth, clamped at max
 *   - hard-lock threshold trip
 *   - evaluateLock: hard dominates; soft window blocks until it passes; reset state unlocks
 *   - the ≤100-failures/hr ceiling holds by construction once the soft delay saturates
 */

import assert from 'node:assert/strict';
import test from 'node:test';
import {
  softDelaySeconds,
  shouldHardLock,
  evaluateLock,
  type LockoutPolicy,
} from './lockout.js';

const POLICY: LockoutPolicy = {
  softThreshold: 3,
  hardThreshold: 10,
  softBaseDelaySeconds: 5,
  softMaxDelaySeconds: 300,
  hardDurationSeconds: 1800,
};

test('softDelaySeconds: no delay below the soft threshold', () => {
  assert.equal(softDelaySeconds(0, POLICY), 0);
  assert.equal(softDelaySeconds(1, POLICY), 0);
  assert.equal(softDelaySeconds(2, POLICY), 0);
});

test('softDelaySeconds: exponential growth from the threshold', () => {
  assert.equal(softDelaySeconds(3, POLICY), 5);   // base × 2^0
  assert.equal(softDelaySeconds(4, POLICY), 10);  // base × 2^1
  assert.equal(softDelaySeconds(5, POLICY), 20);  // base × 2^2
  assert.equal(softDelaySeconds(6, POLICY), 40);
});

test('softDelaySeconds: clamped at softMaxDelaySeconds (ASVS ≤100/hr ceiling holds)', () => {
  // Once saturated, throughput is bounded by 3600/max attempts/hr.
  assert.equal(softDelaySeconds(100, POLICY), 300);
  assert.equal(softDelaySeconds(50, POLICY), 300);
  assert.ok(3600 / POLICY.softMaxDelaySeconds <= 100, 'saturated soft delay keeps attempts under 100/hr');
});

test('shouldHardLock: trips only at/above the hard threshold', () => {
  assert.equal(shouldHardLock(9, POLICY), false);
  assert.equal(shouldHardLock(10, POLICY), true);
  assert.equal(shouldHardLock(11, POLICY), true);
});

test('evaluateLock: a PERMANENT hard lock (hardLockedUntil null) dominates regardless of soft window', () => {
  const ev = evaluateLock({ hardLocked: true, softLockedUntil: null, failedCount: 99, hardLockedUntil: null });
  assert.equal(ev.locked, true);
  assert.equal(ev.reason, 'hard');
});

test('evaluateLock: future soft window blocks with retry-after; past window unlocks', () => {
  const now = new Date('2026-06-21T12:00:00Z');
  const future = new Date('2026-06-21T12:00:30Z');
  const past = new Date('2026-06-21T11:59:00Z');
  const blocked = evaluateLock({ hardLocked: false, softLockedUntil: future, failedCount: 4, hardLockedUntil: null }, now);
  assert.equal(blocked.locked, true);
  assert.equal(blocked.reason, 'soft');
  assert.equal(blocked.retryAfterSeconds, 30);
  const open = evaluateLock({ hardLocked: false, softLockedUntil: past, failedCount: 4, hardLockedUntil: null }, now);
  assert.equal(open.locked, false);
});

test('evaluateLock: a fully-cleared state (the reset outcome) is unlocked', () => {
  // This mirrors what clearLockout writes: hard=false, soft=null, count=0 → never locked.
  const ev = evaluateLock({ hardLocked: false, softLockedUntil: null, failedCount: 0, hardLockedUntil: null });
  assert.equal(ev.locked, false);
  assert.equal(ev.reason, null);
});

// ── [A4] auto-expiring hard lock ────────────────────────────────────────────────────────────────

test('evaluateLock [A4]: a hard lock with a FUTURE expiry is locked (with retry-after)', () => {
  const now = new Date('2026-06-21T12:00:00Z');
  const until = new Date('2026-06-21T12:30:00Z'); // +30 min
  const ev = evaluateLock({ hardLocked: true, softLockedUntil: null, failedCount: 12, hardLockedUntil: until }, now);
  assert.equal(ev.locked, true);
  assert.equal(ev.reason, 'hard');
  assert.equal(ev.retryAfterSeconds, 1800);
});

test('evaluateLock [A4]: a hard lock whose expiry has PASSED is lapsed → unlocked (DoS bounded)', () => {
  const now = new Date('2026-06-21T12:00:00Z');
  const until = new Date('2026-06-21T11:30:00Z'); // 30 min ago
  const ev = evaluateLock({ hardLocked: true, softLockedUntil: null, failedCount: 12, hardLockedUntil: until }, now);
  assert.equal(ev.locked, false, 'a lapsed hard lock self-clears at evaluate time');
  assert.equal(ev.reason, null);
});

test('evaluateLock [A4]: a lapsed hard lock still yields to an ACTIVE soft window', () => {
  const now = new Date('2026-06-21T12:00:00Z');
  const lapsedHard = new Date('2026-06-21T11:30:00Z');
  const activeSoft = new Date('2026-06-21T12:00:20Z');
  const ev = evaluateLock({ hardLocked: true, softLockedUntil: activeSoft, failedCount: 12, hardLockedUntil: lapsedHard }, now);
  assert.equal(ev.locked, true);
  assert.equal(ev.reason, 'soft', 'hard lapsed → fall through to the still-active soft window');
});
