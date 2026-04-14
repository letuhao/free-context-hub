/**
 * Sprint 11.1 — bundleFormat unit tests
 *
 * Covers:
 *   - happy path round-trip (lessons + guardrails + lesson_types + chunks + documents)
 *   - empty bundle (project only, no entities)
 *   - schema_version mismatch detection
 *   - missing manifest detection
 *   - jsonl checksum mismatch detection
 *   - malformed jsonl line detection
 *   - documents binary content round-trip + per-doc sha256 verification
 */

import assert from 'node:assert/strict';
import test from 'node:test';
import { mkdtempSync, rmSync, createWriteStream, readFileSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { Readable } from 'node:stream';
import { once } from 'node:events';

import archiver from 'archiver';

import {
  encodeBundle,
  openBundle,
  BundleError,
  SCHEMA_VERSION,
  type BundleData,
} from './bundleFormat.js';

/** Encode a bundle to an in-memory Buffer for round-trip tests. */
async function encodeToBuffer(data: BundleData): Promise<Buffer> {
  const chunks: Buffer[] = [];
  const sink = new (await import('node:stream')).PassThrough();
  sink.on('data', (c: Buffer) => chunks.push(c));
  const done = once(sink, 'end');
  await encodeBundle(data, sink);
  // archiver.finalize completes when all data has been written; PassThrough
  // emits 'end' after that. Wait for the drain.
  sink.end();
  await done;
  return Buffer.concat(chunks);
}

const sampleProject = {
  project_id: 'free-context-hub',
  name: 'Free ContextHub',
  description: 'Test fixture',
};

test('bundleFormat', async (t) => {
  await t.test('happy path round-trip — all entity kinds', async () => {
    const lessons = [
      { lesson_id: 'l1', title: 'first', content: 'hello' },
      { lesson_id: 'l2', title: 'second', content: 'world' },
    ];
    const guardrails = [{ rule_id: 'g1', name: 'no-deploy-friday', enabled: true }];
    const lesson_types = [{ key: 'rfc', label: 'RFC', color: '#ff0000' }];
    const chunks = [
      { chunk_id: 'c1', doc_id: 'd1', content: 'page 1 text', embedding: [0.1, 0.2, 0.3] },
    ];
    const docContent = Buffer.from('%PDF-fake-pdf-bytes', 'utf-8');
    const documents = [
      {
        doc_id: 'd1',
        ext: 'pdf',
        metadata: { name: 'paper.pdf', file_size_bytes: docContent.length },
        content: docContent,
      },
    ];

    const buf = await encodeToBuffer({
      project: sampleProject,
      lessons,
      guardrails,
      lesson_types,
      chunks,
      documents,
    });
    assert.ok(buf.length > 0, 'bundle should be non-empty');

    const reader = await openBundle(buf);
    try {
      assert.equal(reader.manifest.schema_version, SCHEMA_VERSION);
      assert.equal(reader.manifest.project.project_id, 'free-context-hub');
      assert.ok(reader.manifest.entries['lessons.jsonl']);
      assert.equal(reader.manifest.entries['lessons.jsonl'].count, 2);
      assert.ok(reader.manifest.entries['documents.jsonl']);
      assert.ok(reader.manifest.entries['documents/d1.pdf']);

      const readLessons: unknown[] = [];
      for await (const l of reader.lessons()) readLessons.push(l);
      assert.deepEqual(readLessons, lessons);

      const readGuardrails: unknown[] = [];
      for await (const g of reader.guardrails()) readGuardrails.push(g);
      assert.deepEqual(readGuardrails, guardrails);

      const readChunks: unknown[] = [];
      for await (const c of reader.chunks()) readChunks.push(c);
      assert.deepEqual(readChunks, chunks);

      const readDocs: { doc_id: string; bytes: number; content: Buffer }[] = [];
      for await (const d of reader.documents()) {
        const stream = await d.openContent();
        const partials: Buffer[] = [];
        for await (const piece of stream) partials.push(piece as Buffer);
        readDocs.push({ doc_id: d.doc_id, bytes: d.bytes, content: Buffer.concat(partials) });
      }
      assert.equal(readDocs.length, 1);
      assert.equal(readDocs[0]!.doc_id, 'd1');
      assert.equal(readDocs[0]!.content.toString('utf-8'), '%PDF-fake-pdf-bytes');
      assert.equal(readDocs[0]!.bytes, docContent.length);
    } finally {
      await reader.close();
    }
  });

  await t.test('empty bundle — project only, no entities', async () => {
    const buf = await encodeToBuffer({ project: sampleProject });
    const reader = await openBundle(buf);
    try {
      assert.equal(reader.manifest.schema_version, SCHEMA_VERSION);
      // No data entries — only the manifest itself
      assert.equal(Object.keys(reader.manifest.entries).length, 0);
      const lessons: unknown[] = [];
      for await (const l of reader.lessons()) lessons.push(l);
      assert.deepEqual(lessons, []);
    } finally {
      await reader.close();
    }
  });

  await t.test('rejects bundle with no manifest.json', async () => {
    // Build a zip by hand with no manifest
    const tmp = mkdtempSync(path.join(os.tmpdir(), 'bundle-test-'));
    const zipPath = path.join(tmp, 'no-manifest.zip');
    try {
      const out = createWriteStream(zipPath);
      const archive = archiver('zip');
      archive.pipe(out);
      archive.append('hello', { name: 'random.txt' });
      await archive.finalize();
      await once(out, 'close');

      await assert.rejects(
        openBundle(zipPath),
        (err: unknown) =>
          err instanceof BundleError && err.code === 'missing_manifest',
      );
    } finally {
      rmSync(tmp, { recursive: true, force: true });
    }
  });

  await t.test('rejects schema_version mismatch', async () => {
    const tmp = mkdtempSync(path.join(os.tmpdir(), 'bundle-test-'));
    const zipPath = path.join(tmp, 'wrong-version.zip');
    try {
      const out = createWriteStream(zipPath);
      const archive = archiver('zip');
      archive.pipe(out);
      const fakeManifest = {
        schema_version: 999,
        generator: 'free-context-hub',
        generator_version: '0.0.0',
        generated_at: new Date().toISOString(),
        project: sampleProject,
        entries: {},
      };
      archive.append(JSON.stringify(fakeManifest), { name: 'manifest.json' });
      await archive.finalize();
      await once(out, 'close');

      await assert.rejects(
        openBundle(zipPath),
        (err: unknown) =>
          err instanceof BundleError && err.code === 'schema_version_mismatch',
      );
    } finally {
      rmSync(tmp, { recursive: true, force: true });
    }
  });

  await t.test('rejects jsonl checksum mismatch', async () => {
    // First produce a real bundle, then corrupt it by tampering with the
    // lessons.jsonl entry while leaving the manifest alone.
    const buf = await encodeToBuffer({
      project: sampleProject,
      lessons: [{ lesson_id: 'l1', title: 'orig' }],
    });

    // The simplest reliable corruption: rebuild a zip where lessons.jsonl
    // has different content but copy the manifest verbatim from the real
    // bundle (so its sha256 still references the original content).
    const tmp = mkdtempSync(path.join(os.tmpdir(), 'bundle-test-'));
    const realPath = path.join(tmp, 'real.zip');
    const corruptPath = path.join(tmp, 'corrupt.zip');
    try {
      writeFileSync(realPath, buf);
      const realReader = await openBundle(realPath);
      const realManifest = realReader.manifest;
      await realReader.close();

      const out = createWriteStream(corruptPath);
      const archive = archiver('zip');
      archive.pipe(out);
      // Tampered content — different bytes than what the manifest hashes
      archive.append(JSON.stringify({ lesson_id: 'l1', title: 'TAMPERED' }) + '\n', {
        name: 'lessons.jsonl',
      });
      archive.append(JSON.stringify(realManifest, null, 2), { name: 'manifest.json' });
      await archive.finalize();
      await once(out, 'close');

      const reader = await openBundle(corruptPath);
      try {
        await assert.rejects(
          (async () => {
            for await (const _ of reader.lessons()) {
              /* drain — should throw on EOF */
            }
          })(),
          (err: unknown) => err instanceof BundleError && err.code === 'checksum_mismatch',
        );
      } finally {
        await reader.close();
      }
    } finally {
      rmSync(tmp, { recursive: true, force: true });
    }
  });

  await t.test('rejects malformed jsonl line', async () => {
    const tmp = mkdtempSync(path.join(os.tmpdir(), 'bundle-test-'));
    const zipPath = path.join(tmp, 'malformed.zip');
    try {
      // Hand-craft a bundle whose lessons.jsonl has invalid JSON, with a
      // matching sha256 in the manifest so we trip on the parse step
      // rather than the checksum step.
      const badContent = '{"valid":"line"}\nthis is not json\n';
      const sha256 = (await import('node:crypto'))
        .createHash('sha256')
        .update(badContent)
        .digest('hex');
      const manifest = {
        schema_version: SCHEMA_VERSION,
        generator: 'free-context-hub',
        generator_version: '0.0.0',
        generated_at: new Date().toISOString(),
        project: sampleProject,
        entries: {
          'lessons.jsonl': {
            bytes: Buffer.byteLength(badContent),
            sha256,
            count: 2,
          },
        },
      };
      const out = createWriteStream(zipPath);
      const archive = archiver('zip');
      archive.pipe(out);
      archive.append(badContent, { name: 'lessons.jsonl' });
      archive.append(JSON.stringify(manifest), { name: 'manifest.json' });
      await archive.finalize();
      await once(out, 'close');

      const reader = await openBundle(zipPath);
      try {
        await assert.rejects(
          (async () => {
            for await (const _ of reader.lessons()) {
              /* drain */
            }
          })(),
          (err: unknown) => err instanceof BundleError && err.code === 'malformed_jsonl',
        );
      } finally {
        await reader.close();
      }
    } finally {
      rmSync(tmp, { recursive: true, force: true });
    }
  });

  await t.test('large document round-trips correctly (above stream highWaterMark)', async () => {
    // Regression: openContent() initially used pipeline() which fully
    // drained small docs before returning. Anything past the default
    // 16KB Transform highWaterMark would deadlock on backpressure.
    // 1MB is well above any plausible buffer size — exercises the real
    // streaming path.
    const big = Buffer.alloc(1_000_000);
    for (let i = 0; i < big.length; i++) big[i] = i & 0xff;

    const buf = await encodeToBuffer({
      project: sampleProject,
      documents: [
        { doc_id: 'big1', ext: 'bin', metadata: { size: big.length }, content: big },
      ],
    });

    const reader = await openBundle(buf);
    try {
      const docs: Buffer[] = [];
      for await (const d of reader.documents()) {
        const stream = await d.openContent();
        const parts: Buffer[] = [];
        for await (const p of stream) parts.push(p as Buffer);
        docs.push(Buffer.concat(parts));
      }
      assert.equal(docs.length, 1);
      assert.equal(docs[0]!.length, big.length);
      assert.ok(docs[0]!.equals(big), 'large document content must be byte-identical');
    } finally {
      await reader.close();
    }
  });

  await t.test('rejects document id collision after sanitization', async () => {
    // "a/b" and "a_b" both safeDocId to "a_b" — encoder must refuse.
    await assert.rejects(
      encodeToBuffer({
        project: sampleProject,
        documents: [
          { doc_id: 'a/b', ext: 'pdf', metadata: {}, content: Buffer.from('one') },
          { doc_id: 'a_b', ext: 'pdf', metadata: {}, content: Buffer.from('two') },
        ],
      }),
      (err: unknown) => err instanceof BundleError && err.code === 'io_error',
    );
  });

  await t.test('round-trips a bundle to disk', async () => {
    const tmp = mkdtempSync(path.join(os.tmpdir(), 'bundle-test-'));
    const zipPath = path.join(tmp, 'disk.zip');
    try {
      const out = createWriteStream(zipPath);
      const result = await encodeBundle(
        {
          project: sampleProject,
          lessons: [{ lesson_id: 'l1', title: 'on disk' }],
          documents: [
            {
              doc_id: 'd1',
              ext: 'png',
              metadata: { name: 'pic.png' },
              content: Buffer.from([0x89, 0x50, 0x4e, 0x47]), // PNG magic
            },
          ],
        },
        out,
      );
      await once(out, 'close');

      assert.ok(result.manifest.entries['lessons.jsonl']);
      assert.ok(result.manifest.entries['documents.jsonl']);
      assert.ok(result.manifest.entries['documents/d1.png']);
      assert.equal(result.manifest.entries['documents/d1.png']!.bytes, 4);

      const reader = await openBundle(zipPath);
      try {
        const docs: Buffer[] = [];
        for await (const d of reader.documents()) {
          const stream = await d.openContent();
          const parts: Buffer[] = [];
          for await (const p of stream) parts.push(p as Buffer);
          docs.push(Buffer.concat(parts));
        }
        assert.equal(docs.length, 1);
        assert.deepEqual(Array.from(docs[0]!), [0x89, 0x50, 0x4e, 0x47]);
      } finally {
        await reader.close();
      }
    } finally {
      rmSync(tmp, { recursive: true, force: true });
    }
  });
});
