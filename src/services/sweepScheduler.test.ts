/**
 * Phase 13 Sprint 13.2 — sweepScheduler unit tests
 *
 * Verifies:
 *   - LEASES_SWEEP_ADVISORY_KEY is reproducible from SHA256 derivation
 *   - Lock acquired → enqueue happens once per cycle
 *   - Lock not acquired → no enqueue
 *   - pool.connect failure → no enqueue, no crash
 *   - Lock release on successful enqueue
 *
 * Strategy: production code reads dependencies via internal `_getDbPool` /
 * `_enqueueJob` hooks; tests swap them via `__setSweepDependenciesForTest()`.
 */

import assert from 'node:assert/strict';
import test, { beforeEach, afterEach } from 'node:test';
import crypto from 'node:crypto';

import {
  LEASES_SWEEP_ADVISORY_KEY,
  startSweepScheduler,
  __setSweepDependenciesForTest,
  __resetSweepDependenciesForTest,
} from './sweepScheduler.js';

interface MockClient {
  query: (sql: string, params?: unknown[]) => Promise<{ rows: Array<Record<string, unknown>>; rowCount?: number }>;
  release: () => void;
}

interface PoolBehavior {
  acquireResult?: 'true' | 'false' | 'connect-fail';
  unlockObserver?: { invoked: boolean };
}

let enqueueSpy: { called: number; lastArgs: unknown | null; firstCallResolve?: () => void; firstCalled?: Promise<void> };

beforeEach(() => {
  let resolveFirst: () => void = () => {};
  const firstCalled = new Promise<void>((r) => { resolveFirst = r; });
  enqueueSpy = { called: 0, lastArgs: null, firstCallResolve: resolveFirst, firstCalled };
});

afterEach(() => {
  __resetSweepDependenciesForTest();
});

function installMocks(behavior: PoolBehavior): void {
  const mockClient: MockClient = {
    query: async (sql: string) => {
      if (/pg_try_advisory_lock/.test(sql)) {
        return { rows: [{ acquired: behavior.acquireResult === 'true' }] };
      }
      if (/pg_advisory_unlock/.test(sql)) {
        if (behavior.unlockObserver) behavior.unlockObserver.invoked = true;
        return { rows: [] };
      }
      return { rows: [] };
    },
    release: () => { /* noop */ },
  };
  __setSweepDependenciesForTest({
    getDbPool: (() => ({
      connect: async () => {
        if (behavior.acquireResult === 'connect-fail') throw new Error('mock-connect-fail');
        return mockClient;
      },
    })) as unknown as Parameters<typeof __setSweepDependenciesForTest>[0]['getDbPool'],
    enqueueJob: (async (args: unknown) => {
      enqueueSpy.called++;
      enqueueSpy.lastArgs = args;
      if (enqueueSpy.called === 1 && enqueueSpy.firstCallResolve) enqueueSpy.firstCallResolve();
      return { status: 'queued' as const, job_id: 'mock-job-id', backend: 'postgres' as const };
    }) as unknown as Parameters<typeof __setSweepDependenciesForTest>[0]['enqueueJob'],
  });
}

async function waitMs(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

test('LEASES_SWEEP_ADVISORY_KEY matches SHA256 derivation of "phase-13.leases-sweep"', () => {
  const digest = crypto.createHash('sha256').update('phase-13.leases-sweep').digest();
  const u64 = digest.readBigUInt64BE(0);
  const SIGN_BIT = 1n << 63n;
  const expected = u64 >= SIGN_BIT ? u64 - (1n << 64n) : u64;
  assert.equal(LEASES_SWEEP_ADVISORY_KEY, expected, 'advisory key must be reproducible from SHA256');
});

test('startSweepScheduler enqueues exactly once per cycle when lock acquired', async () => {
  // r2 F3 fix (deterministic): use a long interval so the SECOND cycle cannot
  // fire within the test window; await the firstCalled Promise so the test
  // doesn't race with the cycle's promise chain on slow CI runners; then stop
  // the scheduler and assert exactly 1 enqueue.
  installMocks({ acquireResult: 'true' });
  const firstCalled = enqueueSpy.firstCalled!;
  const handle = startSweepScheduler({ intervalMs: 50, graceMinutes: 42 });
  // Wait for the first enqueue notification (deterministic — does not depend
  // on wall-clock measurement of when cycle() actually completes).
  await Promise.race([
    firstCalled,
    new Promise<void>((_, rej) => setTimeout(() => rej(new Error('first enqueue not observed within 2s')), 2000)),
  ]);
  handle.stop();
  // Briefly yield so any in-flight cycle finishes BEFORE we check the count.
  await waitMs(10);
  assert.equal(enqueueSpy.called, 1, 'exactly one enqueue per cycle (no double-fire); stop() prevents subsequent cycles');
  const args = enqueueSpy.lastArgs as { job_type: string; payload: { grace_minutes: number } } | null;
  assert.ok(args, 'enqueue should have been called with args');
  assert.equal(args!.job_type, 'leases.sweep');
  assert.equal(args!.payload.grace_minutes, 42);
});

test('startSweepScheduler skips enqueue when lock not acquired', async () => {
  installMocks({ acquireResult: 'false' });
  const handle = startSweepScheduler({ intervalMs: 30, graceMinutes: 60 });
  await waitMs(80);
  handle.stop();
  assert.equal(enqueueSpy.called, 0, 'enqueue must not fire when another replica is leader');
});

test('startSweepScheduler tolerates pool.connect failure (no crash, no enqueue)', async () => {
  installMocks({ acquireResult: 'connect-fail' });
  const handle = startSweepScheduler({ intervalMs: 30 });
  await waitMs(80);
  handle.stop();
  assert.equal(enqueueSpy.called, 0, 'enqueue must not fire when pool.connect rejects');
});

test('startSweepScheduler releases advisory lock after successful enqueue', async () => {
  const unlockObserver = { invoked: false };
  installMocks({ acquireResult: 'true', unlockObserver });
  const handle = startSweepScheduler({ intervalMs: 30 });
  await waitMs(80);
  handle.stop();
  assert.equal(unlockObserver.invoked, true, 'unlock query must be issued after enqueue');
});
