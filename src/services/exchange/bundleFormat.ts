/**
 * Phase 11 Sprint 11.1 — Bundle format v1
 *
 * A self-contained, streaming-friendly serialization primitive for
 * exchanging a project's knowledge between ContextHub instances.
 *
 * The bundle is a zip archive with this layout:
 *
 *     bundle.zip
 *     ├── manifest.json              schema version, project meta, entry index
 *     ├── lessons.jsonl              one lesson per line (optional)
 *     ├── guardrails.jsonl           (optional)
 *     ├── lesson_types.jsonl         (optional)
 *     ├── documents.jsonl            metadata only — binaries live below (optional)
 *     ├── chunks.jsonl               text + embedding vectors (optional)
 *     └── documents/
 *         └── <doc_id>.<ext>         raw bytes, byte-identical to original
 *
 * Why zip + JSONL:
 *  - No base64 bloat — binaries stay binary
 *  - Streamable on both ends (encoder accepts iterables, decoder yields async iterators)
 *  - Random-access central directory — dry-run preview can sample without full read
 *  - Self-validating: every entry has a SHA-256 in the manifest checked at read time
 *
 * This module knows nothing about Postgres, HTTP, or business rules — it
 * is the format primitive only. Sprints 11.2+ wire it into the export
 * route, the import route, conflict policies, and the GUI.
 */

import { createHash } from 'node:crypto';
import { Readable, Writable, Transform } from 'node:stream';
import readline from 'node:readline';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

import archiver from 'archiver';
import yauzl from 'yauzl';

// ─── Constants ─────────────────────────────────────────────────────────

export const SCHEMA_VERSION = 1 as const;
export const GENERATOR = 'free-context-hub';

/** Canonical entry paths inside the bundle. Keep in sync with both the
 *  encoder and decoder — typos here would silently produce unreadable
 *  bundles, since the decoder looks up entries by string match.
 *  Adding a new optional entry is backwards-compatible — older readers
 *  simply ignore unknown entries and yield empty for missing ones. */
export const ENTRY_NAMES = {
  manifest: 'manifest.json',
  lessons: 'lessons.jsonl',
  guardrails: 'guardrails.jsonl',
  lesson_types: 'lesson_types.jsonl',
  chunks: 'chunks.jsonl',
  documents: 'documents.jsonl',
  document_lessons: 'document_lessons.jsonl',
  documentsPrefix: 'documents/',
} as const;

/** Cap on extension length after sanitization. Anything longer is almost
 *  certainly a bug or attack and would produce absurd entry paths. */
const MAX_EXT_LEN = 16;

/** Resolved once at module load — see `getGeneratorVersion()`. */
let _generatorVersion: string | null = null;

/** Reads the package.json version. Cached after first call. */
async function getGeneratorVersion(): Promise<string> {
  if (_generatorVersion !== null) return _generatorVersion;
  try {
    const here = path.dirname(fileURLToPath(import.meta.url));
    // src/services/exchange → ../../../package.json
    const pkgPath = path.resolve(here, '..', '..', '..', 'package.json');
    const raw = await readFile(pkgPath, 'utf-8');
    _generatorVersion = (JSON.parse(raw) as { version?: string }).version ?? '0.0.0';
  } catch {
    _generatorVersion = '0.0.0';
  }
  return _generatorVersion;
}

// ─── Public types ──────────────────────────────────────────────────────

export interface BundleProject {
  project_id: string;
  name: string;
  description: string | null;
}

export interface ManifestEntry {
  /** Uncompressed byte count of the entry data (pre-zip). */
  bytes: number;
  /** Hex-encoded SHA-256 of the uncompressed entry data. */
  sha256: string;
  /** For .jsonl entries: number of lines (records). Undefined for binaries. */
  count?: number;
}

export interface Manifest {
  schema_version: typeof SCHEMA_VERSION;
  generator: typeof GENERATOR;
  generator_version: string;
  generated_at: string; // ISO 8601
  project: BundleProject;
  /** Map from zip entry path → integrity record. The source of truth. */
  entries: Record<string, ManifestEntry>;
}

/** A document being written to the bundle. `content` is streamed in as-is. */
export interface BundleDocument {
  doc_id: string;
  /** JSON-serializable metadata — written into documents.jsonl */
  metadata: Record<string, unknown>;
  /** Raw file bytes, or `null` for metadata-only docs (URL references with
   *  no stored content). When null, the encoder writes the metadata row
   *  with `entry: null` and no binary entry is appended. */
  content: Buffer | Readable | null;
  /** File extension without leading dot (e.g. "pdf", "png", "md"). Ignored
   *  when content is null. */
  ext: string;
}

export interface BundleData {
  project: BundleProject;
  // All entity arrays optional — encoder skips empty/missing.
  lessons?: AsyncIterable<unknown> | Iterable<unknown>;
  guardrails?: AsyncIterable<unknown> | Iterable<unknown>;
  lesson_types?: AsyncIterable<unknown> | Iterable<unknown>;
  documents?: AsyncIterable<BundleDocument> | Iterable<BundleDocument>;
  chunks?: AsyncIterable<unknown> | Iterable<unknown>;
  /** Phase 11.3: links between documents and lessons. Composite key
   *  (doc_id, lesson_id). Imported AFTER both documents and lessons. */
  document_lessons?: AsyncIterable<unknown> | Iterable<unknown>;
}

export interface EncodeResult {
  manifest: Manifest;
  /** Total uncompressed bytes across all entries (excluding manifest itself). */
  total_bytes: number;
}

/** Decoded view of a document entry. Content is opened lazily on demand. */
export interface BundleDocumentRead {
  doc_id: string;
  metadata: Record<string, unknown>;
  ext: string;
  bytes: number;
  /** True for URL-only docs that were exported without binary content. */
  hasContent: boolean;
  /** Returns a fresh Readable stream for the document's binary content.
   *  Throws if `hasContent` is false. */
  openContent(): Promise<Readable>;
}

export interface BundleReader {
  manifest: Manifest;
  lessons(): AsyncGenerator<unknown>;
  guardrails(): AsyncGenerator<unknown>;
  lesson_types(): AsyncGenerator<unknown>;
  documents(): AsyncGenerator<BundleDocumentRead>;
  chunks(): AsyncGenerator<unknown>;
  /** Phase 11.3: links between documents and lessons. Empty iterator
   *  for older bundles that predate this entry. */
  document_lessons(): AsyncGenerator<unknown>;
  close(): Promise<void>;
}

export type BundleErrorCode =
  | 'missing_manifest'
  | 'schema_version_mismatch'
  | 'checksum_mismatch'
  | 'malformed_jsonl'
  | 'missing_entry'
  | 'malformed_manifest'
  | 'io_error';

export class BundleError extends Error {
  constructor(public readonly code: BundleErrorCode, message: string) {
    super(`[${code}] ${message}`);
    this.name = 'BundleError';
  }
}

// ─── Helpers ───────────────────────────────────────────────────────────

/** Coerce an iterable or async-iterable to an async iterator. */
async function* toAsyncIterable<T>(
  src: AsyncIterable<T> | Iterable<T> | undefined,
): AsyncGenerator<T> {
  if (!src) return;
  // AsyncIterable check first — async generators implement both
  if ((src as AsyncIterable<T>)[Symbol.asyncIterator]) {
    for await (const item of src as AsyncIterable<T>) yield item;
  } else {
    for (const item of src as Iterable<T>) yield item;
  }
}

/** Strip path separators + ".." from a doc_id to produce a safe entry name.
 *  Throws on empty input — an empty doc_id would produce `documents/.<ext>`
 *  which is a malformed entry path. Callers must validate ids upstream. */
function safeDocId(id: string): string {
  if (!id || id.length === 0) {
    throw new BundleError('io_error', 'doc_id must be a non-empty string');
  }
  const out = id.replace(/[/\\]/g, '_').replace(/\.\./g, '_');
  if (out.length === 0) {
    throw new BundleError('io_error', `doc_id sanitized to empty: "${id}"`);
  }
  return out;
}

/** Normalize an extension: lowercase, strip leading dot, drop non-alnum,
 *  cap at MAX_EXT_LEN, fall back to "bin". A 500-char ext would otherwise
 *  produce an absurd entry path. */
function safeExt(ext: string): string {
  const e = ext.replace(/^\./, '').toLowerCase().replace(/[^a-z0-9]/g, '');
  if (!e) return 'bin';
  return e.length > MAX_EXT_LEN ? e.slice(0, MAX_EXT_LEN) : e;
}

// ─── Encoder ───────────────────────────────────────────────────────────

/**
 * Stream a BundleData into a zip on the given Writable. Resolves with the
 * manifest that was written and the total uncompressed byte count.
 *
 * Empty / absent entity collections are skipped — the manifest only lists
 * entries that actually exist in the zip.
 *
 * IMPORTANT: this function resolves when archiver finishes pushing bytes,
 * but the downstream `output` Writable may still be flushing to disk.
 * Callers writing to `fs.createWriteStream` MUST also `await once(output,
 * 'close')` before reading the file back.
 *
 * Caveats:
 *  - The `JSON.stringify` of each record will throw on `bigint`,
 *    circular references, or `undefined` values. Callers are responsible
 *    for normalizing rows (e.g. `pg-types` returning bigint) upstream.
 *  - Each entity iterable is consumed sequentially. Cross-iterable
 *    parallelism is NOT supported.
 */
export async function encodeBundle(
  data: BundleData,
  output: Writable,
): Promise<EncodeResult> {
  // ---- input validation ----
  if (!data || typeof data !== 'object') {
    throw new BundleError('io_error', 'encodeBundle: data is required');
  }
  if (!data.project || typeof data.project !== 'object') {
    throw new BundleError('io_error', 'encodeBundle: data.project is required');
  }
  if (typeof data.project.project_id !== 'string' || data.project.project_id.length === 0) {
    throw new BundleError('io_error', 'encodeBundle: project.project_id must be a non-empty string');
  }
  if (typeof data.project.name !== 'string' || data.project.name.length === 0) {
    throw new BundleError('io_error', 'encodeBundle: project.name must be a non-empty string');
  }

  const archive = archiver('zip', { zlib: { level: 6 } });
  archive.pipe(output);

  // Capture the first archiver error so we can surface it cleanly.
  let archiverError: Error | null = null;
  archive.on('error', (err) => {
    archiverError = err;
  });
  // 'warning' fires on non-fatal issues (e.g. ENOENT on a file). We
  // promote these to errors so the caller knows something went wrong.
  archive.on('warning', (err) => {
    archiverError = err;
  });

  const entries: Record<string, ManifestEntry> = {};
  let totalBytes = 0;

  // ---- jsonl entries ----
  await appendJsonlEntry(archive, entries, ENTRY_NAMES.lessons, data.lessons);
  await appendJsonlEntry(archive, entries, ENTRY_NAMES.guardrails, data.guardrails);
  await appendJsonlEntry(archive, entries, ENTRY_NAMES.lesson_types, data.lesson_types);
  await appendJsonlEntry(archive, entries, ENTRY_NAMES.chunks, data.chunks);
  await appendJsonlEntry(archive, entries, ENTRY_NAMES.document_lessons, data.document_lessons);

  // ---- documents: metadata jsonl + binaries ----
  if (data.documents) {
    // We need to write documents.jsonl AND documents/<id>.<ext> in lockstep.
    // archiver requires that .append() is called sequentially with stream
    // sources; we collect metadata into a buffer as we go and append the
    // jsonl once all binaries have been queued. This means metadata is
    // buffered in memory — acceptable since metadata rows are small.
    const metaLines: string[] = [];
    let metaBytes = 0;
    let metaCount = 0;
    const metaHash = createHash('sha256');

    for await (const doc of toAsyncIterable(data.documents)) {
      let entryPath: string | null = null;
      let bytes = 0;
      let sha256: string | null = null;
      let ext = safeExt(doc.ext);

      if (doc.content !== null) {
        const id = safeDocId(doc.doc_id);
        entryPath = `${ENTRY_NAMES.documentsPrefix}${id}.${ext}`;
        // safeDocId collapses path separators — two distinct ids could map
        // to the same entry path. Detect and refuse, since silent overwrite
        // would corrupt the bundle and the import would lose a document.
        if (entries[entryPath]) {
          throw new BundleError(
            'io_error',
            `document id collision after sanitization: "${doc.doc_id}" → "${entryPath}" (already used)`,
          );
        }

        // Hash + size the binary content as we stream it into archiver
        const measured = measureStream();
        const source: Readable = Buffer.isBuffer(doc.content)
          ? Readable.from([doc.content])
          : doc.content;
        // Tee into archiver via the measure transform
        source.pipe(measured.transform);
        archive.append(measured.transform, { name: entryPath });
        // Wait for the measure transform to flush before queueing the next entry
        // so byte counts are deterministic.
        await measured.done;
        bytes = measured.bytes;
        sha256 = measured.sha256;
        entries[entryPath] = { bytes, sha256 };
        totalBytes += bytes;
      }

      // Build the metadata line; record entry pointer so import can find the binary
      const line =
        JSON.stringify({
          doc_id: doc.doc_id,
          ext,
          entry: entryPath, // null for URL-only docs with no stored content
          bytes,
          sha256, // null for URL-only docs
          metadata: doc.metadata,
        }) + '\n';
      metaLines.push(line);
      metaHash.update(line);
      metaBytes += Buffer.byteLength(line);
      metaCount += 1;
    }

    if (metaCount > 0) {
      const metaBuf = Buffer.from(metaLines.join(''), 'utf-8');
      archive.append(metaBuf, { name: ENTRY_NAMES.documents });
      entries[ENTRY_NAMES.documents] = {
        bytes: metaBytes,
        sha256: metaHash.digest('hex'),
        count: metaCount,
      };
      totalBytes += metaBytes;
    }
  }

  // ---- manifest LAST so its `entries` map is complete ----
  const manifest: Manifest = {
    schema_version: SCHEMA_VERSION,
    generator: GENERATOR,
    generator_version: await getGeneratorVersion(),
    generated_at: new Date().toISOString(),
    project: data.project,
    entries,
  };
  archive.append(JSON.stringify(manifest, null, 2), { name: ENTRY_NAMES.manifest });

  await archive.finalize();
  if (archiverError) {
    throw new BundleError('io_error', `archiver: ${(archiverError as Error).message}`);
  }
  return { manifest, total_bytes: totalBytes };
}

/**
 * Append a JSONL entry by streaming records through a Buffer (for hash
 * + size accounting), then handing the buffer to archiver. Skips empty
 * collections — the manifest will not list them.
 */
async function appendJsonlEntry(
  archive: archiver.Archiver,
  entries: Record<string, ManifestEntry>,
  name: string,
  source: AsyncIterable<unknown> | Iterable<unknown> | undefined,
): Promise<void> {
  if (!source) return;
  const lines: string[] = [];
  const hash = createHash('sha256');
  let bytes = 0;
  let count = 0;
  for await (const item of toAsyncIterable(source)) {
    const line = JSON.stringify(item) + '\n';
    lines.push(line);
    hash.update(line);
    bytes += Buffer.byteLength(line);
    count += 1;
  }
  if (count === 0) return; // skip empty
  archive.append(Buffer.from(lines.join(''), 'utf-8'), { name });
  entries[name] = {
    bytes,
    sha256: hash.digest('hex'),
    count,
  };
}

/**
 * A pass-through Transform that records byte count + SHA-256 of the data
 * flowing through it. The `done` promise resolves when the source stream
 * finishes; after that, `bytes` and `sha256` are populated.
 */
function measureStream() {
  const hash = createHash('sha256');
  let bytes = 0;
  let digestHex: string | null = null;
  const transform = new Transform({
    transform(chunk: Buffer, _enc, cb) {
      hash.update(chunk);
      bytes += chunk.length;
      cb(null, chunk);
    },
    flush(cb) {
      // Finalize the hash exactly once when the source ends — getter can
      // be read multiple times safely.
      digestHex = hash.digest('hex');
      cb();
    },
  });
  const done = new Promise<void>((resolve, reject) => {
    // 'finish' = writable side ended (we've consumed all input).
    transform.on('finish', resolve);
    transform.on('error', reject);
  });
  return {
    transform,
    done,
    get bytes() {
      return bytes;
    },
    get sha256() {
      if (digestHex === null) {
        throw new Error('measureStream: sha256 read before stream finished');
      }
      return digestHex;
    },
  };
}

// ─── Decoder ───────────────────────────────────────────────────────────

/** Wraps a yauzl.Entry so we can pass it back to openReadStream without
 *  having to re-walk the central directory (which yauzl can't do). */
interface ZipEntry {
  fileName: string;
  uncompressedSize: number;
  raw: yauzl.Entry;
}

/**
 * Open a bundle from a path or Buffer. Reads + validates the manifest
 * eagerly; entry payloads stay on disk and stream out on demand via the
 * returned reader's iterators.
 *
 * Caveats:
 *  - yauzl is single-reader. Iterators returned by this reader MUST be
 *    consumed sequentially — running two `for await` loops in parallel
 *    against the same reader will collide on the underlying read stream.
 *  - Sprint 11.6b refactored JSONL decoding to true line-by-line streaming
 *    via readline + a hash-tap Transform; peak memory per entry is bounded
 *    by the largest single line (<1 MB typical), not the whole file.
 *    Checksum validation fires at EOF rather than pre-yield — consumers
 *    that need "reject bad bundle before doing any work" must drain the
 *    whole iterator first.
 *  - Calling `reader.close()` invalidates all outstanding iterators.
 */
export async function openBundle(input: string | Buffer): Promise<BundleReader> {
  const zip = await openZip(input);
  const entriesByName = await indexEntries(zip);

  const manifestEntry = entriesByName.get(ENTRY_NAMES.manifest);
  if (!manifestEntry) {
    zip.close();
    throw new BundleError('missing_manifest', 'bundle has no manifest.json');
  }
  const manifestRaw = await readEntireEntry(zip, manifestEntry);
  let manifest: Manifest;
  try {
    manifest = JSON.parse(manifestRaw.toString('utf-8')) as Manifest;
  } catch (err) {
    zip.close();
    throw new BundleError(
      'malformed_manifest',
      `manifest.json is not valid JSON: ${(err as Error).message}`,
    );
  }
  if (manifest.schema_version !== SCHEMA_VERSION) {
    zip.close();
    throw new BundleError(
      'schema_version_mismatch',
      `expected schema_version ${SCHEMA_VERSION}, got ${String(manifest.schema_version)}`,
    );
  }
  if (!manifest.entries || typeof manifest.entries !== 'object') {
    zip.close();
    throw new BundleError('malformed_manifest', 'manifest.entries is missing or invalid');
  }

  // Helper: create an async generator that yields parsed JSONL records
  // from a manifest entry, validating sha256 + line count on EOF.
  //
  // Streaming discipline (Sprint 11.6b): the entry's bytes flow through
  // a hash-tap Transform and into readline. Records are yielded line
  // by line so peak memory is bounded by the largest single record
  // rather than the entire jsonl file. For a 10k-lesson project this
  // drops from ~100 MB peak (buf + text copies) to <1 MB (one line at
  // a time).
  //
  // Semantic shift: checksum validation now fires AT EOF rather than
  // before the first yield. `importProject` wraps the iteration in a
  // pg transaction, so a checksum error surfacing at end-of-stream
  // still triggers a clean rollback. Existing tests drain the whole
  // iterator before asserting, so they continue to pass.
  async function* iterateJsonl<T>(name: string): AsyncGenerator<T> {
    const meta = manifest.entries[name];
    if (!meta) return; // entry absent → empty iterator
    const zipEntry = entriesByName.get(name);
    if (!zipEntry) {
      throw new BundleError(
        'missing_entry',
        `manifest references "${name}" but the zip entry is missing`,
      );
    }
    const rawStream = await openEntryStream(zip, zipEntry);
    const hash = createHash('sha256');
    const hashTap = new Transform({
      transform(chunk, _enc, cb) {
        hash.update(chunk);
        cb(null, chunk);
      },
    });
    // Manually wire — pipeline() here would wait for the whole stream
    // before our generator saw any data, defeating the streaming win.
    rawStream.pipe(hashTap);
    rawStream.on('error', (err) => hashTap.destroy(err));

    const rl = readline.createInterface({
      input: hashTap,
      crlfDelay: Infinity, // accept LF and CRLF line endings alike
    });

    let lineNo = 0;
    let count = 0;
    try {
      for await (const line of rl) {
        lineNo += 1;
        if (line.length === 0) continue; // tolerate blank lines (e.g. trailing newline)
        try {
          yield JSON.parse(line) as T;
          count += 1;
        } catch (err) {
          throw new BundleError(
            'malformed_jsonl',
            `${name}:${lineNo} — ${(err as Error).message}`,
          );
        }
      }
    } finally {
      // If the consumer breaks out early (thrown record handler, etc.)
      // make sure the underlying streams are torn down so yauzl doesn't
      // hold on to file descriptors.
      rl.close();
      if (!rawStream.destroyed) rawStream.destroy();
    }

    // Validate checksum at EOF — the hash tap saw every byte that
    // made it to readline, including blank lines.
    const actual = hash.digest('hex');
    if (actual !== meta.sha256) {
      throw new BundleError(
        'checksum_mismatch',
        `${name} sha256 mismatch (expected ${meta.sha256}, got ${actual})`,
      );
    }
    if (typeof meta.count === 'number' && count !== meta.count) {
      throw new BundleError(
        'malformed_jsonl',
        `${name} expected ${meta.count} records, parsed ${count}`,
      );
    }
  }

  async function* iterateDocuments(): AsyncGenerator<BundleDocumentRead> {
    const meta = manifest.entries[ENTRY_NAMES.documents];
    if (!meta) return;
    for await (const row of iterateJsonl<{
      doc_id: string;
      ext: string;
      entry: string | null;
      bytes: number;
      sha256: string | null;
      metadata: Record<string, unknown>;
    }>(ENTRY_NAMES.documents)) {
      // Metadata-only doc (URL reference, no stored content)
      if (row.entry === null) {
        const _row = row;
        yield {
          doc_id: _row.doc_id,
          metadata: _row.metadata,
          ext: _row.ext,
          bytes: 0,
          hasContent: false,
          async openContent(): Promise<Readable> {
            throw new BundleError(
              'missing_entry',
              `document "${_row.doc_id}" has no stored content (URL-only)`,
            );
          },
        };
        continue;
      }

      const binEntryMeta = manifest.entries[row.entry];
      if (!binEntryMeta) {
        throw new BundleError(
          'missing_entry',
          `documents.jsonl references "${row.entry}" but the manifest does not list it`,
        );
      }
      const binZipEntry = entriesByName.get(row.entry);
      if (!binZipEntry) {
        throw new BundleError(
          'missing_entry',
          `manifest lists "${row.entry}" but the zip entry is missing`,
        );
      }
      // Capture for the closure so each yield has its own state
      const _row = row;
      const _binZipEntry = binZipEntry;
      const _binMeta = binEntryMeta;
      yield {
        doc_id: _row.doc_id,
        metadata: _row.metadata,
        ext: _row.ext,
        bytes: _binMeta.bytes,
        hasContent: true,
        async openContent(): Promise<Readable> {
          // Re-open the entry stream and tee through a hash transform.
          // We MUST NOT use stream.pipeline here — it fully drains the
          // pipeline before resolving, which means small files fit in
          // the Transform's internal buffer but anything past the
          // highWaterMark (~16KB) gets stuck waiting for backpressure
          // relief from a consumer that hasn't started reading yet.
          //
          // Instead: chain raw → hashing transform via .pipe() and
          // return the tail. The consumer reads at its own pace, the
          // upstream paces correctly, and the transform's flush()
          // callback validates the checksum at EOF.
          const raw = await openEntryStream(zip, _binZipEntry);
          const hash = createHash('sha256');
          const expected = _binMeta.sha256;
          const entryName = _row.entry;
          const verifier = new Transform({
            transform(chunk: Buffer, _enc, cb) {
              hash.update(chunk);
              cb(null, chunk);
            },
            flush(cb) {
              const actual = hash.digest('hex');
              if (actual !== expected) {
                cb(
                  new BundleError(
                    'checksum_mismatch',
                    `${entryName} sha256 mismatch (expected ${expected}, got ${actual})`,
                  ),
                );
                return;
              }
              cb();
            },
          });
          // Bidirectional cleanup: errors and consumer-side close MUST
          // tear down the upstream yauzl read stream, otherwise dropping
          // the iterator early leaks file descriptors.
          raw.on('error', (err) => verifier.destroy(err));
          verifier.on('close', () => {
            if (!raw.destroyed) raw.destroy();
          });
          raw.pipe(verifier);
          return verifier;
        },
      };
    }
  }

  return {
    manifest,
    lessons: () => iterateJsonl<unknown>(ENTRY_NAMES.lessons),
    guardrails: () => iterateJsonl<unknown>(ENTRY_NAMES.guardrails),
    lesson_types: () => iterateJsonl<unknown>(ENTRY_NAMES.lesson_types),
    documents: () => iterateDocuments(),
    chunks: () => iterateJsonl<unknown>(ENTRY_NAMES.chunks),
    document_lessons: () => iterateJsonl<unknown>(ENTRY_NAMES.document_lessons),
    async close() {
      zip.close();
    },
  };
}

// ─── yauzl plumbing ────────────────────────────────────────────────────

function openZip(input: string | Buffer): Promise<yauzl.ZipFile> {
  return new Promise((resolve, reject) => {
    const cb = (err: Error | null, zip?: yauzl.ZipFile) => {
      if (err || !zip) {
        reject(new BundleError('io_error', `cannot open zip: ${err?.message ?? 'unknown'}`));
        return;
      }
      resolve(zip);
    };
    if (typeof input === 'string') {
      yauzl.open(input, { lazyEntries: true, autoClose: false }, cb);
    } else {
      yauzl.fromBuffer(input, { lazyEntries: true }, cb);
    }
  });
}

function indexEntries(zip: yauzl.ZipFile): Promise<Map<string, ZipEntry>> {
  return new Promise((resolve, reject) => {
    const map = new Map<string, ZipEntry>();
    zip.on('entry', (entry: yauzl.Entry) => {
      // Keep the raw Entry — we'll need it later for openReadStream.
      // yauzl can't re-walk the central directory, so indexing-pass
      // entries are our only handle to the actual file metadata.
      map.set(entry.fileName, {
        fileName: entry.fileName,
        uncompressedSize: entry.uncompressedSize,
        raw: entry,
      });
      zip.readEntry();
    });
    zip.on('end', () => resolve(map));
    zip.on('error', (err) => reject(new BundleError('io_error', err.message)));
    zip.readEntry();
  });
}

/** Open a read stream for an indexed entry. */
function openEntryStream(zip: yauzl.ZipFile, target: ZipEntry): Promise<Readable> {
  return new Promise((resolve, reject) => {
    zip.openReadStream(target.raw, (err, stream) => {
      if (err || !stream) {
        reject(new BundleError('io_error', `openReadStream: ${err?.message ?? 'no stream'}`));
        return;
      }
      resolve(stream);
    });
  });
}

async function readEntireEntry(zip: yauzl.ZipFile, target: ZipEntry): Promise<Buffer> {
  const stream = await openEntryStream(zip, target);
  const chunks: Buffer[] = [];
  for await (const chunk of stream) {
    chunks.push(chunk as Buffer);
  }
  return Buffer.concat(chunks);
}
