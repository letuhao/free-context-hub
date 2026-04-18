/**
 * Sprint 11.6c-sec — pullFromRemote unit tests
 *
 * Targeted coverage for the StallTransform body-stall defense. The
 * e2e suite exercises the happy path but can't realistically wait for
 * the production 60s timer to fire. A unit test with a short timeout
 * and a Readable that never pushes proves the timer + _destroy path
 * actually fires + cleans up.
 */

import assert from 'node:assert/strict';
import test from 'node:test';
import { Readable, Writable } from 'node:stream';
import { pipeline } from 'node:stream/promises';

import { StallTransform, PullError } from './pullFromRemote.js';

/** A Writable that discards everything — we only care whether the
 *  pipeline itself completes or errors out. */
function noopSink(): Writable {
  return new Writable({
    write(_chunk, _enc, cb) { cb(); },
  });
}

test('StallTransform', async (t) => {
  // The load-bearing test: if no chunk arrives for `ms` milliseconds,
  // the pipeline must reject with a timeout PullError. This is the
  // slow-loris defense in action — a malicious remote that refuses to
  // ever send data gets cut off rather than tying up the worker.
  await t.test('rejects pipeline when no chunks arrive within ms', async () => {
    // Readable that never calls push() — simulates a connected-but-
    // silent upstream. Pipeline will wait for data indefinitely without
    // the StallTransform.
    const silent = new Readable({ read() { /* never pushes */ } });

    const stall = new StallTransform(80); // 80ms — fast enough for CI, long
                                          // enough to rule out scheduler noise
    const started = Date.now();

    await assert.rejects(
      () => pipeline(silent, stall, noopSink()),
      (err: unknown) =>
        err instanceof PullError &&
        err.code === 'timeout' &&
        err.httpStatus === 504 &&
        /stalled/i.test(err.message),
    );

    const elapsed = Date.now() - started;
    // Timer should fire near 80ms; allow generous 1000ms ceiling for
    // Windows scheduler jitter in CI. Floor the check at ~50ms to
    // confirm we actually waited (the defense didn't fire prematurely).
    assert.ok(elapsed >= 50, `stall fired too early: ${elapsed}ms`);
    assert.ok(elapsed < 1000, `stall took too long: ${elapsed}ms`);

    // Give Node one tick to reap the destroyed Readable. Without this
    // the test completes with a pending 'read' that triggers a warning.
    silent.destroy();
  });

  // Proves the timer ARMS from a chunk arrival — a stream that trickles
  // chunks faster than the timeout must succeed. Regression guard against
  // a bug where armTimer forgets to clearTimeout the previous timer.
  await t.test('does NOT fire when chunks arrive faster than the timeout', async () => {
    const chunks = [Buffer.from('a'), Buffer.from('b'), Buffer.from('c')];
    let i = 0;
    const trickle = new Readable({
      read() {
        // Drip-feed a chunk every 30ms — below the 80ms stall window.
        // The timer must reset each time; the pipeline must NOT time out.
        if (i < chunks.length) {
          setTimeout(() => this.push(chunks[i++]!), 30);
        } else {
          setTimeout(() => this.push(null), 30); // eof
        }
      },
    });

    const stall = new StallTransform(80);
    await pipeline(trickle, stall, noopSink()); // must resolve, not reject
  });

  // Proves _destroy clears the pending timer — otherwise setTimeout fires
  // against a destroyed stream and (while harmless) leaks node:timers work.
  // Indirect test: destroy manually + wait longer than the ms; the test
  // completing without an uncaught exception is the assertion.
  await t.test('_destroy clears the pending timer', async () => {
    const stall = new StallTransform(30);
    // Manually destroy before the timer fires. Without _destroy's
    // clearTimeout, a setTimeout would still fire ~30ms from now and
    // call this.destroy(new PullError(...)) on an already-destroyed
    // stream — which emits an 'error' event against no listener and
    // can crash the process under process.on('uncaughtException') in
    // strict test runners.
    stall.destroy();

    // Wait longer than the timer window to prove nothing fires.
    await new Promise((r) => setTimeout(r, 80));
    // Implicit assertion: if _destroy leaked, the test runner would
    // have seen an uncaught error by now.
  });
});
