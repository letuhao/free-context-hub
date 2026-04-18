/**
 * Phase 11 Sprint 11.6b — Streaming base64 encoder.
 *
 * Consumes a Readable byte stream and returns a single base64 string
 * WITHOUT holding the full raw input in memory simultaneously. For a
 * 100 MB input the peak drops from ~233 MB (raw Buffer + base64 string
 * coexisting during the one-shot toString('base64') call) to ~134 MB
 * (raw Buffer chunked + GC'd progressively; only the growing base64
 * string + current chunk alive at once).
 *
 * Why we can't stream further: the caller (importProject's
 * materializeDocContent) passes the result as a single text value to
 * pg-node's client.query({ values: [...] }), which materializes the
 * full string before sending. A true end-to-end streaming import
 * would require migrating documents.content from TEXT to BYTEA — a
 * Phase-10-level change, out of scope for this sprint.
 *
 * Correctness invariant — 3-byte alignment:
 *   `Buffer.toString('base64')` auto-pads with '=' to the next 4-char
 *   boundary. Calling it on a mid-stream, non-3-byte-aligned chunk
 *   would embed premature '=' characters, producing a corrupted
 *   result on decode. This encoder maintains a `tail` buffer of 0-2
 *   leftover bytes and only calls toString on 3-byte-aligned
 *   prefixes of combined(tail + chunk). The final tail (≤ 2 bytes)
 *   is encoded with proper EOF padding at the end.
 *
 * Hard ceiling — V8 string size limit:
 *   The returned string lives in V8's string heap, which caps at
 *   ~512 MB on 64-bit (`(1 << 29) - 24` bytes). Base64 inflates by
 *   4/3×, so the maximum raw input this encoder can successfully
 *   produce a string for is ~384 MB. Inputs above that throw
 *   "RangeError: Invalid string length" when the final string is
 *   flattened. This ceiling is independent of the refactor — the
 *   pre-refactor `buffer.toString('base64')` had the same limit.
 *   Fixing it cleanly requires migrating documents.content to BYTEA,
 *   deferred beyond Phase 11.
 *
 * Preconditions on `stream`:
 *   - MUST emit Buffer chunks. If the stream is set to an encoding
 *     (e.g. setEncoding('utf-8')) it emits strings, and `.length`
 *     then counts UTF-16 code units rather than bytes — the 3-byte
 *     alignment invariant silently breaks. All current callers
 *     (bundleFormat's openContent, which comes from yauzl's
 *     openReadStream) emit raw Buffers, so we don't runtime-check,
 *     but a new caller reusing this helper must uphold this.
 */

import type { Readable } from 'node:stream';

export async function encodeStreamToBase64(stream: Readable): Promise<string> {
  let base64 = '';
  let tail: Buffer = Buffer.alloc(0);

  for await (const rawChunk of stream) {
    const chunk = rawChunk as Buffer;
    // Prepend the leftover tail so we always encode on 3-byte boundaries.
    // When tail is empty we skip the Buffer.concat allocation for speed.
    const combined = tail.length === 0 ? chunk : Buffer.concat([tail, chunk]);
    const alignedLen = combined.length - (combined.length % 3);
    if (alignedLen > 0) {
      base64 += combined.subarray(0, alignedLen).toString('base64');
    }
    // Keep the unprocessed tail (0-2 bytes) for the next iteration.
    tail = alignedLen < combined.length ? combined.subarray(alignedLen) : Buffer.alloc(0);
    // `chunk` and `combined` are now unreferenced and GC-eligible; only
    // the growing `base64` string and the small `tail` remain alive.
  }

  // Final tail (0-2 bytes) — toString('base64') handles EOF padding.
  if (tail.length > 0) {
    base64 += tail.toString('base64');
  }

  return base64;
}
