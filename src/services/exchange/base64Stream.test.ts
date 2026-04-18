/**
 * Sprint 11.6b — base64Stream unit tests
 *
 * The 3-byte alignment invariant is the subtle correctness property:
 * encoding any prefix of the stream on a non-3-byte boundary embeds
 * '=' padding that corrupts the result on decode. These tests verify
 * byte-identical round-trip through base64 decode for every awkward
 * boundary case: empty, 1-byte, 2-byte, 3-byte, 4-byte, 5-byte,
 * chunks-exactly-3-aligned, chunks-crossing-3-boundary, single-byte
 * chunks (worst case for tail buffering), and a 1 MB random buffer.
 */

import assert from 'node:assert/strict';
import test from 'node:test';
import { Readable } from 'node:stream';
import { randomBytes } from 'node:crypto';

import { encodeStreamToBase64 } from './base64Stream.js';

/** Build a Readable that yields exactly these Buffer chunks. Lets us
 *  simulate specific chunk-boundary scenarios that would be hard to
 *  elicit from a real pipe. */
function chunksToStream(chunks: Buffer[]): Readable {
  let i = 0;
  return new Readable({
    read() {
      if (i < chunks.length) this.push(chunks[i++]);
      else this.push(null);
    },
  });
}

/** Collapse the encoded string back into raw bytes for round-trip verification. */
function decodeBase64(b64: string): Buffer {
  return Buffer.from(b64, 'base64');
}

test('encodeStreamToBase64', async (t) => {
  await t.test('empty stream → empty base64', async () => {
    const s = chunksToStream([]);
    const out = await encodeStreamToBase64(s);
    assert.equal(out, '');
    assert.equal(decodeBase64(out).length, 0);
  });

  await t.test('single byte (length 1) has "==" EOF padding', async () => {
    const raw = Buffer.from([0x41]); // 'A'
    const s = chunksToStream([raw]);
    const out = await encodeStreamToBase64(s);
    assert.equal(out, raw.toString('base64')); // 'QQ=='
    assert.deepEqual(decodeBase64(out), raw);
  });

  await t.test('two bytes (length 2) has "=" EOF padding', async () => {
    const raw = Buffer.from([0x41, 0x42]); // 'AB'
    const s = chunksToStream([raw]);
    const out = await encodeStreamToBase64(s);
    assert.equal(out, raw.toString('base64')); // 'QUI='
    assert.deepEqual(decodeBase64(out), raw);
  });

  await t.test('three bytes (length 3) has no padding', async () => {
    const raw = Buffer.from([0x41, 0x42, 0x43]); // 'ABC'
    const s = chunksToStream([raw]);
    const out = await encodeStreamToBase64(s);
    assert.equal(out, raw.toString('base64')); // 'QUJD'
    assert.deepEqual(decodeBase64(out), raw);
  });

  await t.test('four bytes (length 4) has "==" EOF padding', async () => {
    const raw = Buffer.from([0x41, 0x42, 0x43, 0x44]);
    const s = chunksToStream([raw]);
    const out = await encodeStreamToBase64(s);
    assert.equal(out, raw.toString('base64'));
    assert.deepEqual(decodeBase64(out), raw);
  });

  await t.test('five bytes (length 5) has "=" EOF padding', async () => {
    const raw = Buffer.from([0x41, 0x42, 0x43, 0x44, 0x45]);
    const s = chunksToStream([raw]);
    const out = await encodeStreamToBase64(s);
    assert.equal(out, raw.toString('base64'));
    assert.deepEqual(decodeBase64(out), raw);
  });

  await t.test('chunks exactly 3-byte aligned → no tail buffering', async () => {
    const raw = Buffer.from([
      0x01, 0x02, 0x03,  // chunk 1 — 3 bytes
      0x04, 0x05, 0x06,  // chunk 2 — 3 bytes
      0x07, 0x08, 0x09,  // chunk 3 — 3 bytes
    ]);
    const s = chunksToStream([
      Buffer.from([0x01, 0x02, 0x03]),
      Buffer.from([0x04, 0x05, 0x06]),
      Buffer.from([0x07, 0x08, 0x09]),
    ]);
    const out = await encodeStreamToBase64(s);
    assert.equal(out, raw.toString('base64'));
    assert.deepEqual(decodeBase64(out), raw);
  });

  await t.test('chunks crossing 3-byte boundaries — alignment must be preserved', async () => {
    // 7 raw bytes split as 2 + 2 + 3 — every chunk boundary lands on
    // a non-3-aligned offset, so the encoder MUST buffer tails. A
    // naive implementation that toString('base64')'s each chunk would
    // embed '==' padding mid-stream and this round-trip would fail.
    const raw = Buffer.from([0xAA, 0xBB, 0xCC, 0xDD, 0xEE, 0xFF, 0x11]);
    const s = chunksToStream([
      Buffer.from([0xAA, 0xBB]),
      Buffer.from([0xCC, 0xDD]),
      Buffer.from([0xEE, 0xFF, 0x11]),
    ]);
    const out = await encodeStreamToBase64(s);
    assert.equal(out, raw.toString('base64'));
    assert.deepEqual(decodeBase64(out), raw);
  });

  await t.test('single-byte chunks (worst case for tail buffer)', async () => {
    // Stress-test the tail discipline: every chunk is 1 byte, so the
    // tail grows from 1→2→(encode 3→back to 0)→1→2→...
    const raw = Buffer.from([0x10, 0x20, 0x30, 0x40, 0x50, 0x60, 0x70, 0x80, 0x90, 0xA0]);
    const chunks = Array.from(raw).map((b) => Buffer.from([b]));
    const s = chunksToStream(chunks);
    const out = await encodeStreamToBase64(s);
    assert.equal(out, raw.toString('base64'));
    assert.deepEqual(decodeBase64(out), raw);
  });

  await t.test('1 MB random buffer — byte-identical round-trip', async () => {
    const raw = randomBytes(1024 * 1024);
    // Split into irregular chunks to exercise the alignment path
    const chunks: Buffer[] = [];
    let offset = 0;
    const sizes = [100, 7, 3, 1, 2, 65_536, 1024, 8, 16, 32]; // arbitrary
    while (offset < raw.length) {
      const size = sizes[chunks.length % sizes.length]!;
      chunks.push(raw.subarray(offset, Math.min(offset + size, raw.length)));
      offset += size;
    }
    const s = chunksToStream(chunks);
    const out = await encodeStreamToBase64(s);
    assert.equal(out, raw.toString('base64'));
    assert.deepEqual(decodeBase64(out), raw);
  });

  await t.test('rejects on upstream stream error', async () => {
    const s = new Readable({
      read() {
        this.destroy(new Error('boom'));
      },
    });
    await assert.rejects(
      () => encodeStreamToBase64(s),
      (err: unknown) => err instanceof Error && err.message.includes('boom'),
    );
  });
});
