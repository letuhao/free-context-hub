/**
 * Phase 11 Sprint 11.3 — Project import service
 *
 * Decodes a bundle.zip via bundleFormat.openBundle() and applies it
 * to a target project. Supports three conflict policies (skip /
 * overwrite / fail), a dry-run mode that walks the bundle without
 * writing anything, and a transactional apply that rolls back on
 * partial failure.
 *
 * Foreign-key safe order:
 *   1. lesson_types        (no FK)
 *   2. documents           (no FK)
 *   3. chunks              (FK to documents)
 *   4. lessons             (no FK)
 *   5. guardrails          (no FK)
 *   6. document_lessons    (FK to BOTH documents and lessons)
 *
 * project_id is rewritten on every row from the bundle's source
 * project to the URL-supplied target. UUIDs are preserved so a
 * re-import with policy=skip is a no-op.
 *
 * Knows nothing about HTTP — just bundle → DB. The route in
 * src/api/routes/projects.ts wires this to multer's uploaded file.
 *
 * Operational caveats:
 *  - The whole import pins a single PoolClient for its duration. A
 *    50k-lesson import takes minutes and could starve concurrent
 *    requests if the pool is small. Consider sizing accordingly.
 *  - `pool.connect()` has no timeout — if the pool is exhausted, the
 *    request will hang until a client is available.
 *  - FK violations on chunks (missing parent doc) or document_lessons
 *    (missing parent doc/lesson) abort the whole transaction with an
 *    opaque pg error. A polish sprint can pre-validate FK targets.
 *
 * Performance note: each row does a SELECT for conflict detection +
 * an INSERT/UPDATE — N+1 round trips per entity. For a 581-lesson
 * project that's ~1200 round trips per import. We chose this over
 * `INSERT ... ON CONFLICT DO ...` because the SELECT lets us count
 * created/updated/skipped accurately and emit per-conflict reports,
 * which ON CONFLICT can't. At ~1ms per query the cost is negligible
 * compared to base64 encoding + transaction overhead. If this ever
 * matters, a polish sprint can switch to ON CONFLICT + RETURNING and
 * derive the counts from xmin/xmax.
 */

import { getDbPool } from '../../db/client.js';
import type { PoolClient } from 'pg';

import {
  openBundle,
  BundleError,
  type BundleReader,
  type BundleDocumentRead,
} from './bundleFormat.js';
import { encodeStreamToBase64 } from './base64Stream.js';

export type ConflictPolicy = 'skip' | 'overwrite' | 'fail';

export interface ImportProjectOptions {
  /** Target project (from the URL). Auto-created if missing. */
  targetProjectId: string;
  /** Path to the uploaded bundle zip on disk. */
  bundlePath: string;
  /** What to do when a row's primary key already exists. Default 'skip'. */
  policy?: ConflictPolicy;
  /** Walk the bundle and report counts without writing. Default false. */
  dryRun?: boolean;
  /** Cap on the conflicts array in the result. Default 50, hard ceiling 1000. */
  conflictsCap?: number;
}

export interface EntityCounts {
  /** Total rows present in the bundle for this entity. */
  total: number;
  /** Rows that were (or would be) inserted because no row with that PK existed. */
  created: number;
  /** Existing rows that were (or would be) overwritten under policy=overwrite. */
  updated: number;
  /** Existing rows that were left alone under policy=skip. */
  skipped: number;
}

export interface ImportConflict {
  entity: 'lessons' | 'guardrails' | 'lesson_types' | 'documents' | 'chunks' | 'document_lessons';
  /** Primary key of the conflicting row. Composite PKs are joined with "::". */
  id: string;
  reason: string;
}

export interface ImportResult {
  source_project_id: string;       // from bundle manifest
  target_project_id: string;       // from URL
  schema_version: number;
  generated_at: string;            // bundle manifest's generated_at
  policy: ConflictPolicy;
  dry_run: boolean;
  /** True if the transaction committed; false on dry_run or rollback. */
  applied: boolean;
  counts: {
    lessons: EntityCounts;
    guardrails: EntityCounts;
    lesson_types: EntityCounts;
    documents: EntityCounts;
    chunks: EntityCounts;
    document_lessons: EntityCounts;
  };
  /** First N conflicts encountered. Bounded by `conflictsCap`. */
  conflicts: ImportConflict[];
  /** True if more conflicts were found than `conflictsCap` allowed. */
  conflicts_truncated: boolean;
}

export type ImportErrorCode =
  | 'malformed_bundle'
  | 'schema_version_mismatch'
  | 'conflict_fail'
  | 'invalid_row'
  | 'io_error';

export class ImportError extends Error {
  constructor(public readonly code: ImportErrorCode, message: string) {
    super(`[${code}] ${message}`);
    this.name = 'ImportError';
  }
}

const DEFAULT_CONFLICTS_CAP = 50;
const MAX_CONFLICTS_CAP = 1000;

const EMPTY_COUNTS = (): EntityCounts => ({ total: 0, created: 0, updated: 0, skipped: 0 });

/** Batch size for the Sprint 11.6c-perf N+1 reduction. Each entity's
 *  bulk SELECT queries up to this many IDs at once via `= ANY($1)`,
 *  shrinking round-trip count from ~2N to ~(N/BATCH + N). 200 balances
 *  per-batch latency against total query count — a pg `= ANY(uuid[])`
 *  of 200 ids is well within the query planner's sweet spot. */
const APPLY_BATCH_SIZE = 200;

/** Drive an async iterable through a fixed-size batched processor.
 *  The handler sees each batch as a complete array; it should do one
 *  bulk existence query against the DB and then apply rows one-by-one
 *  using the pre-fetched lookup. Streaming-friendly: only BATCH_SIZE
 *  rows are held in memory at once. */
async function processBatched<Row>(
  iter: AsyncIterable<Row>,
  batchSize: number,
  handleBatch: (rows: Row[]) => Promise<void>,
): Promise<void> {
  let batch: Row[] = [];
  for await (const row of iter) {
    batch.push(row);
    if (batch.length >= batchSize) {
      await handleBatch(batch);
      batch = [];
    }
  }
  if (batch.length > 0) {
    await handleBatch(batch);
  }
}

/** Guard against intra-batch duplicate IDs. A malformed bundle with
 *  duplicate PKs in a single entity would cause our pre-fetched
 *  existence map to go stale mid-batch (first INSERT succeeds, map
 *  still says "doesn't exist", second INSERT hits pg's unique
 *  constraint and rolls back with an opaque 500). Catch it up-front
 *  with a clean malformed_bundle error instead. */
function assertUniqueBatchIds(ids: string[], entity: string): void {
  const seen = new Set<string>();
  for (const id of ids) {
    if (seen.has(id)) {
      throw new ImportError(
        'malformed_bundle',
        `duplicate ${entity} id "${id}" within a single batch`,
      );
    }
    seen.add(id);
  }
}

export async function importProject(opts: ImportProjectOptions): Promise<ImportResult> {
  const policy = opts.policy ?? 'skip';
  const dryRun = opts.dryRun ?? false;
  const cap = Math.min(Math.max(1, opts.conflictsCap ?? DEFAULT_CONFLICTS_CAP), MAX_CONFLICTS_CAP);
  const targetProjectId = opts.targetProjectId;

  // ---- decode bundle ----
  let reader: BundleReader;
  try {
    reader = await openBundle(opts.bundlePath);
  } catch (err) {
    if (err instanceof BundleError) {
      const code: ImportErrorCode =
        err.code === 'schema_version_mismatch' ? 'schema_version_mismatch' : 'malformed_bundle';
      throw new ImportError(code, err.message);
    }
    throw new ImportError('io_error', `cannot open bundle: ${(err as Error).message}`);
  }

  const result: ImportResult = {
    source_project_id: reader.manifest.project.project_id,
    target_project_id: targetProjectId,
    schema_version: reader.manifest.schema_version,
    generated_at: reader.manifest.generated_at,
    policy,
    dry_run: dryRun,
    applied: false,
    counts: {
      lessons: EMPTY_COUNTS(),
      guardrails: EMPTY_COUNTS(),
      lesson_types: EMPTY_COUNTS(),
      documents: EMPTY_COUNTS(),
      chunks: EMPTY_COUNTS(),
      document_lessons: EMPTY_COUNTS(),
    },
    conflicts: [],
    conflicts_truncated: false,
  };

  /** Push a conflict to the result, respecting the cap. */
  const recordConflict = (c: ImportConflict) => {
    if (result.conflicts.length < cap) {
      result.conflicts.push(c);
    } else {
      result.conflicts_truncated = true;
    }
  };

  const pool = getDbPool();
  const client = await pool.connect();
  try {
    if (!dryRun) {
      await client.query('BEGIN');
    }

    // Auto-create the target project if missing — matches Phase 7's
    // /api/lessons/import behavior and lets users import into a fresh
    // workspace without a separate project create call.
    if (!dryRun) {
      await client.query(
        `INSERT INTO projects (project_id, name)
         VALUES ($1, $2)
         ON CONFLICT (project_id) DO NOTHING`,
        [targetProjectId, targetProjectId],
      );
    }

    // Sprint 11.6c-perf: each entity is consumed in batches of
    // APPLY_BATCH_SIZE rows. For every batch we do ONE bulk-existence
    // SELECT (rather than N per-row SELECTs) and apply rows individually
    // against the pre-fetched lookup map. FK-safe order preserved:
    // lesson_types -> documents -> chunks -> lessons -> guardrails ->
    // document_lessons.

    // ---- 1. lesson_types ----
    // lesson_types.type_key is TEXT — case-sensitive. Don't lowercase.
    await processBatched(reader.lesson_types() as AsyncIterable<any>, APPLY_BATCH_SIZE, async (rows) => {
      const keys = rows.map((r) => r.type_key as string);
      assertUniqueBatchIds(keys, 'lesson_types');
      const existingR = await client.query<{ type_key: string; is_builtin: boolean }>(
        `SELECT type_key, is_builtin FROM lesson_types WHERE type_key = ANY($1::text[])`,
        [keys],
      );
      const existing = new Map<string, boolean>(
        existingR.rows.map((r) => [r.type_key, r.is_builtin === true]),
      );
      for (const row of rows) {
        result.counts.lesson_types.total += 1;
        await applyLessonType(client, row, policy, dryRun, result.counts.lesson_types, recordConflict, existing);
      }
    });

    // ---- 2. documents ----
    // UUID entities canonicalize to lowercase on both sides of the map
    // to tolerate non-canonical IDs in hand-crafted bundles (pg's UUID
    // cast always returns lowercase, so the map key from RETURNING is
    // already lowercase; canonicalize the lookup-side input for symmetry).
    await processBatched(reader.documents(), APPLY_BATCH_SIZE, async (docs) => {
      const ids = docs.map((d) => d.doc_id.toLowerCase());
      assertUniqueBatchIds(ids, 'documents');
      const existingR = await client.query<{ doc_id: string; project_id: string }>(
        `SELECT doc_id, project_id FROM documents WHERE doc_id = ANY($1::uuid[])`,
        [ids],
      );
      const existing = new Map<string, string>(
        existingR.rows.map((r) => [r.doc_id.toLowerCase(), r.project_id]),
      );
      for (const doc of docs) {
        result.counts.documents.total += 1;
        await applyDocument(
          client, targetProjectId, doc, policy, dryRun,
          result.counts.documents, recordConflict, existing,
        );
      }
    });

    // ---- 3. chunks ----
    await processBatched(reader.chunks() as AsyncIterable<any>, APPLY_BATCH_SIZE, async (rows) => {
      const ids = rows.map((r) => (r.chunk_id as string).toLowerCase());
      assertUniqueBatchIds(ids, 'chunks');
      const existingR = await client.query<{ chunk_id: string; project_id: string }>(
        `SELECT chunk_id, project_id FROM document_chunks WHERE chunk_id = ANY($1::uuid[])`,
        [ids],
      );
      const existing = new Map<string, string>(
        existingR.rows.map((r) => [r.chunk_id.toLowerCase(), r.project_id]),
      );
      for (const row of rows) {
        result.counts.chunks.total += 1;
        await applyChunk(
          client, targetProjectId, row, policy, dryRun,
          result.counts.chunks, recordConflict, existing,
        );
      }
    });

    // ---- 4. lessons ----
    await processBatched(reader.lessons() as AsyncIterable<any>, APPLY_BATCH_SIZE, async (rows) => {
      const ids = rows.map((r) => (r.lesson_id as string).toLowerCase());
      assertUniqueBatchIds(ids, 'lessons');
      const existingR = await client.query<{ lesson_id: string; project_id: string }>(
        `SELECT lesson_id, project_id FROM lessons WHERE lesson_id = ANY($1::uuid[])`,
        [ids],
      );
      const existing = new Map<string, string>(
        existingR.rows.map((r) => [r.lesson_id.toLowerCase(), r.project_id]),
      );
      for (const row of rows) {
        result.counts.lessons.total += 1;
        await applyLesson(
          client, targetProjectId, row, policy, dryRun,
          result.counts.lessons, recordConflict, existing,
        );
      }
    });

    // ---- 5. guardrails ----
    await processBatched(reader.guardrails() as AsyncIterable<any>, APPLY_BATCH_SIZE, async (rows) => {
      const ids = rows.map((r) => (r.rule_id as string).toLowerCase());
      assertUniqueBatchIds(ids, 'guardrails');
      const existingR = await client.query<{ rule_id: string; project_id: string }>(
        `SELECT rule_id, project_id FROM guardrails WHERE rule_id = ANY($1::uuid[])`,
        [ids],
      );
      const existing = new Map<string, string>(
        existingR.rows.map((r) => [r.rule_id.toLowerCase(), r.project_id]),
      );
      for (const row of rows) {
        result.counts.guardrails.total += 1;
        await applyGuardrail(
          client, targetProjectId, row, policy, dryRun,
          result.counts.guardrails, recordConflict, existing,
        );
      }
    });

    // ---- 6. document_lessons (must come AFTER both docs and lessons) ----
    // Composite PK (doc_id, lesson_id) requires a parallel-array
    // unnest join so pg can zip the two arrays positionally and use
    // the composite PK index. Composite key string built from lowercased
    // components so the map matches across casing variations.
    await processBatched(reader.document_lessons() as AsyncIterable<any>, APPLY_BATCH_SIZE, async (rows) => {
      const docIds = rows.map((r) => (r.doc_id as string).toLowerCase());
      const lessonIds = rows.map((r) => (r.lesson_id as string).toLowerCase());
      const compositeIds = docIds.map((d, i) => `${d}::${lessonIds[i]}`);
      assertUniqueBatchIds(compositeIds, 'document_lessons');
      const existingR = await client.query<{ doc_id: string; lesson_id: string }>(
        `SELECT dl.doc_id, dl.lesson_id FROM document_lessons dl
         JOIN unnest($1::uuid[], $2::uuid[]) AS t(doc_id, lesson_id)
           ON dl.doc_id = t.doc_id AND dl.lesson_id = t.lesson_id`,
        [docIds, lessonIds],
      );
      const existing = new Map<string, true>(
        existingR.rows.map((r) => [`${r.doc_id.toLowerCase()}::${r.lesson_id.toLowerCase()}`, true as const]),
      );
      for (const row of rows) {
        result.counts.document_lessons.total += 1;
        await applyDocumentLesson(
          client, row, policy, dryRun,
          result.counts.document_lessons, recordConflict, existing,
        );
      }
    });

    if (!dryRun) {
      await client.query('COMMIT');
      result.applied = true;
    }
    return result;
  } catch (err) {
    if (!dryRun) {
      await client.query('ROLLBACK').catch(() => {
        /* ignore rollback errors; original error is what matters */
      });
    }
    if (err instanceof ImportError) throw err;
    throw new ImportError('io_error', (err as Error).message);
  } finally {
    await reader.close().catch(() => {
      /* ignore */
    });
    client.release();
  }
}

// ─── Per-entity apply helpers ──────────────────────────────────────────

/** Format a JS number[] as the pgvector literal "[1,2,3]". */
function vectorLiteral(arr: number[] | null | undefined): string | null {
  if (!arr || !Array.isArray(arr)) return null;
  return `[${arr.join(',')}]`;
}

async function applyLessonType(
  client: PoolClient,
  row: any,
  policy: ConflictPolicy,
  dryRun: boolean,
  counts: EntityCounts,
  recordConflict: (c: ImportConflict) => void,
  /** type_key -> is_builtin, pre-populated by the batch handler via ONE
   *  SELECT per batch. Replaces the per-row N+1 SELECT (Sprint 11.6c-perf). */
  existing: Map<string, boolean>,
): Promise<void> {
  const typeKey: string = row.type_key;
  const destBuiltin = existing.get(typeKey);
  if (destBuiltin !== undefined) {
    if (policy === 'skip') {
      counts.skipped += 1;
      recordConflict({ entity: 'lesson_types', id: typeKey, reason: 'type_key already exists, skipped' });
      return;
    }
    if (policy === 'fail') {
      throw new ImportError('conflict_fail', `lesson_type "${typeKey}" already exists`);
    }
    // overwrite — REFUSE to clobber built-in types. They're system records;
    // a malicious or buggy bundle could downgrade is_builtin or change
    // canonical names. Treat as skipped and record the refusal as a
    // conflict so the operator can see what happened.
    if (destBuiltin) {
      counts.skipped += 1;
      recordConflict({
        entity: 'lesson_types',
        id: typeKey,
        reason: 'destination is a built-in type, overwrite refused',
      });
      return;
    }
    if (!dryRun) {
      await client.query(
        `UPDATE lesson_types
            SET display_name = $2, description = $3, color = $4,
                template = $5, is_builtin = $6
          WHERE type_key = $1`,
        [typeKey, row.display_name, row.description, row.color, row.template, row.is_builtin],
      );
    }
    counts.updated += 1;
    return;
  }
  // create
  if (!dryRun) {
    await client.query(
      `INSERT INTO lesson_types (type_key, display_name, description, color, template, is_builtin, created_at)
       VALUES ($1, $2, $3, $4, $5, $6, COALESCE($7, now()))`,
      [
        typeKey,
        row.display_name,
        row.description,
        row.color,
        row.template,
        row.is_builtin,
        row.created_at,
      ],
    );
  }
  counts.created += 1;
}

async function applyDocument(
  client: PoolClient,
  targetProjectId: string,
  doc: BundleDocumentRead,
  policy: ConflictPolicy,
  dryRun: boolean,
  counts: EntityCounts,
  recordConflict: (c: ImportConflict) => void,
  /** doc_id -> owner project_id, pre-populated by the batch handler
   *  via ONE SELECT per batch (Sprint 11.6c-perf). */
  existing: Map<string, string>,
): Promise<void> {
  const docId: string = doc.doc_id;
  const meta = doc.metadata;
  // Canonicalize for map lookup — pg's UUID cast lowercases on the
  // map-building side, so the lookup key must lowercase too.
  const ownerProjectId = existing.get(docId.toLowerCase());
  if (ownerProjectId !== undefined) {
    // Cross-tenant guard (Sprint 11.3 review fix): without this, a
    // user with writer access to project B could craft a bundle that
    // overwrites rows owned by project A, silently transferring
    // ownership of A's documents to B. Refuse to touch any existing
    // row whose current project_id doesn't match the import target.
    if (ownerProjectId !== targetProjectId) {
      counts.skipped += 1;
      recordConflict({
        entity: 'documents',
        id: docId,
        reason: `doc_id owned by another project ("${ownerProjectId}"), refused`,
      });
      return;
    }
    if (policy === 'skip') {
      counts.skipped += 1;
      recordConflict({ entity: 'documents', id: docId, reason: 'doc_id already exists, skipped' });
      return;
    }
    if (policy === 'fail') {
      throw new ImportError('conflict_fail', `document "${docId}" already exists`);
    }
    // overwrite — preserve doc_id but rewrite project_id and reload content
    if (!dryRun) {
      const contentValue = await materializeDocContent(doc);
      await client.query(
        `UPDATE documents
            SET project_id = $2, name = $3, doc_type = $4, url = $5,
                storage_path = $6, content = $7, content_hash = $8,
                file_size_bytes = $9, description = $10, tags = $11,
                extraction_status = $12, extraction_mode = $13,
                extracted_at = $14, updated_at = now()
          WHERE doc_id = $1`,
        [
          docId,
          targetProjectId,
          meta.name,
          meta.doc_type,
          meta.url,
          meta.storage_path,
          contentValue,
          meta.content_hash,
          meta.file_size_bytes,
          meta.description,
          meta.tags ?? [],
          meta.extraction_status,
          meta.extraction_mode,
          meta.extracted_at,
        ],
      );
    }
    counts.updated += 1;
    return;
  }
  // create
  if (!dryRun) {
    const contentValue = await materializeDocContent(doc);
    await client.query(
      `INSERT INTO documents (
         doc_id, project_id, name, doc_type, url, storage_path, content,
         content_hash, file_size_bytes, description, tags,
         extraction_status, extraction_mode, extracted_at,
         created_at, updated_at
       ) VALUES (
         $1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14,
         COALESCE($15, now()), COALESCE($16, now())
       )`,
      [
        docId,
        targetProjectId,
        meta.name,
        meta.doc_type,
        meta.url,
        meta.storage_path,
        contentValue,
        meta.content_hash,
        meta.file_size_bytes,
        meta.description,
        meta.tags ?? [],
        meta.extraction_status,
        meta.extraction_mode,
        meta.extracted_at,
        meta.created_at,
        meta.updated_at,
      ],
    );
  }
  counts.created += 1;
}

/**
 * Read a document's binary content from the bundle and encode it for
 * storage in the documents.content column. Returns null for
 * metadata-only docs (URL-only references with no stored binary).
 *
 * We always use the `data:base64;<...>` prefix regardless of doc_type
 * because:
 *   1. It round-trips ANY byte sequence losslessly — text docs survive
 *      because base64 is a superset of utf-8 byte storage.
 *   2. It eliminates the export-vs-import asymmetry where each side
 *      had its own heuristic for "text-like" doc types.
 *   3. The Phase 10 read path (routes/documents.ts:507-510 and
 *      services/documents.ts) already handles both prefixed and raw
 *      column values, so storing everything as base64 is transparent
 *      to readers.
 *
 * Memory cost: Sprint 11.6b switched this path to encodeStreamToBase64,
 * which encodes in 3-byte-aligned chunks with a 0-2 byte tail carry
 * between iterations. Raw chunks are GC-eligible immediately after
 * encoding, so for a 100 MB PDF the raw-buffer peak drops from
 * ~100 MB to ~1 MB. The base64 string itself still materializes to
 * ~133 MB because pg-node needs the full text value at query time —
 * a true end-to-end streaming import would require migrating the
 * documents.content column to BYTEA.
 *
 * Hard ceiling: the base64 string is subject to V8's string heap max
 * (~512 MB on 64-bit). A document above ~384 MB raw produces a base64
 * string that exceeds that limit and throws RangeError when pg-node
 * serializes the query. The multer /import cap is 500 MB for the
 * bundle total, so a single-document bundle up to 384 MB works; a
 * bundle whose SINGLE largest document exceeds 384 MB fails. The
 * Phase-10-level fix (bytea column + streaming INSERT) is out of
 * scope; see base64Stream.ts for the detailed limit note.
 *
 * Test coverage note: the exchange e2e tests (phase11-import /
 * phase11-pull) do not seed document fixtures, so this function is
 * exercised only by the base64Stream unit tests + Phase 10 upload
 * tests in isolation. A doc-focused round-trip test would tighten
 * coverage; flagged for a future sprint.
 */
async function materializeDocContent(doc: BundleDocumentRead): Promise<string | null> {
  if (!doc.hasContent) return null;
  const stream = await doc.openContent();
  const base64 = await encodeStreamToBase64(stream);
  return `data:base64;${base64}`;
}

async function applyChunk(
  client: PoolClient,
  targetProjectId: string,
  row: any,
  policy: ConflictPolicy,
  dryRun: boolean,
  counts: EntityCounts,
  recordConflict: (c: ImportConflict) => void,
  /** chunk_id -> owner project_id, pre-populated by the batch handler
   *  via ONE SELECT per batch (Sprint 11.6c-perf). */
  existing: Map<string, string>,
): Promise<void> {
  const chunkId: string = row.chunk_id;
  const ownerProjectId = existing.get(chunkId.toLowerCase());
  if (ownerProjectId !== undefined) {
    // Cross-tenant guard — see applyDocument for the rationale.
    if (ownerProjectId !== targetProjectId) {
      counts.skipped += 1;
      recordConflict({
        entity: 'chunks',
        id: chunkId,
        reason: `chunk_id owned by another project ("${ownerProjectId}"), refused`,
      });
      return;
    }
    if (policy === 'skip') {
      counts.skipped += 1;
      recordConflict({ entity: 'chunks', id: chunkId, reason: 'chunk_id already exists, skipped' });
      return;
    }
    if (policy === 'fail') {
      throw new ImportError('conflict_fail', `chunk "${chunkId}" already exists`);
    }
    // overwrite
    if (!dryRun) {
      const embedding = vectorLiteral(row.embedding);
      await client.query(
        `UPDATE document_chunks
            SET project_id = $2, doc_id = $3, chunk_index = $4, content = $5,
                page_number = $6, heading = $7, chunk_type = $8,
                embedding = $9::vector
          WHERE chunk_id = $1`,
        [
          chunkId,
          targetProjectId,
          row.doc_id,
          row.chunk_index,
          row.content,
          row.page_number,
          row.heading,
          row.chunk_type,
          embedding,
        ],
      );
    }
    counts.updated += 1;
    return;
  }
  // create
  if (!dryRun) {
    const embedding = vectorLiteral(row.embedding);
    await client.query(
      `INSERT INTO document_chunks (
         chunk_id, doc_id, project_id, chunk_index, content,
         page_number, heading, chunk_type, embedding, created_at
       ) VALUES (
         $1, $2, $3, $4, $5, $6, $7, $8, $9::vector, COALESCE($10, now())
       )`,
      [
        chunkId,
        row.doc_id,
        targetProjectId,
        row.chunk_index,
        row.content,
        row.page_number,
        row.heading,
        row.chunk_type,
        embedding,
        row.created_at,
      ],
    );
  }
  counts.created += 1;
}

async function applyLesson(
  client: PoolClient,
  targetProjectId: string,
  row: any,
  policy: ConflictPolicy,
  dryRun: boolean,
  counts: EntityCounts,
  recordConflict: (c: ImportConflict) => void,
  /** lesson_id -> owner project_id, pre-populated by the batch handler
   *  via ONE SELECT per batch (Sprint 11.6c-perf). */
  existing: Map<string, string>,
): Promise<void> {
  const lessonId: string = row.lesson_id;
  const embedding = vectorLiteral(row.embedding);
  if (!embedding) {
    // lessons.embedding is NOT NULL — bundles produced by exportProject
    // always include one. Refusing here surfaces a corrupt/handcrafted
    // bundle clearly instead of failing on the INSERT constraint.
    throw new ImportError(
      'invalid_row',
      `lesson "${lessonId}" has null embedding (lessons.embedding is NOT NULL in the schema)`,
    );
  }

  const ownerProjectId = existing.get(lessonId.toLowerCase());
  if (ownerProjectId !== undefined) {
    // Cross-tenant guard — see applyDocument for the rationale.
    if (ownerProjectId !== targetProjectId) {
      counts.skipped += 1;
      recordConflict({
        entity: 'lessons',
        id: lessonId,
        reason: `lesson_id owned by another project ("${ownerProjectId}"), refused`,
      });
      return;
    }
    if (policy === 'skip') {
      counts.skipped += 1;
      recordConflict({ entity: 'lessons', id: lessonId, reason: 'lesson_id already exists, skipped' });
      return;
    }
    if (policy === 'fail') {
      throw new ImportError('conflict_fail', `lesson "${lessonId}" already exists`);
    }
    // overwrite
    if (!dryRun) {
      await client.query(
        `UPDATE lessons
            SET project_id = $2, lesson_type = $3, title = $4, content = $5,
                tags = $6, source_refs = $7, embedding = $8::vector,
                captured_by = $9, updated_at = now()
          WHERE lesson_id = $1`,
        [
          lessonId,
          targetProjectId,
          row.lesson_type,
          row.title,
          row.content,
          row.tags ?? [],
          row.source_refs ?? [],
          embedding,
          row.captured_by,
        ],
      );
    }
    counts.updated += 1;
    return;
  }
  // create
  if (!dryRun) {
    await client.query(
      `INSERT INTO lessons (
         lesson_id, project_id, lesson_type, title, content, tags, source_refs,
         embedding, captured_by, created_at, updated_at
       ) VALUES (
         $1, $2, $3, $4, $5, $6, $7, $8::vector, $9,
         COALESCE($10, now()), COALESCE($11, now())
       )`,
      [
        lessonId,
        targetProjectId,
        row.lesson_type,
        row.title,
        row.content,
        row.tags ?? [],
        row.source_refs ?? [],
        embedding,
        row.captured_by,
        row.created_at,
        row.updated_at,
      ],
    );
  }
  counts.created += 1;
}

async function applyGuardrail(
  client: PoolClient,
  targetProjectId: string,
  row: any,
  policy: ConflictPolicy,
  dryRun: boolean,
  counts: EntityCounts,
  recordConflict: (c: ImportConflict) => void,
  /** rule_id -> owner project_id, pre-populated by the batch handler
   *  via ONE SELECT per batch (Sprint 11.6c-perf). */
  existing: Map<string, string>,
): Promise<void> {
  const ruleId: string = row.rule_id;
  const ownerProjectId = existing.get(ruleId.toLowerCase());
  if (ownerProjectId !== undefined) {
    // Cross-tenant guard — see applyDocument for the rationale.
    if (ownerProjectId !== targetProjectId) {
      counts.skipped += 1;
      recordConflict({
        entity: 'guardrails',
        id: ruleId,
        reason: `rule_id owned by another project ("${ownerProjectId}"), refused`,
      });
      return;
    }
    if (policy === 'skip') {
      counts.skipped += 1;
      recordConflict({ entity: 'guardrails', id: ruleId, reason: 'rule_id already exists, skipped' });
      return;
    }
    if (policy === 'fail') {
      throw new ImportError('conflict_fail', `guardrail "${ruleId}" already exists`);
    }
    if (!dryRun) {
      await client.query(
        `UPDATE guardrails
            SET project_id = $2, trigger = $3, requirement = $4, verification_method = $5
          WHERE rule_id = $1`,
        [ruleId, targetProjectId, row.trigger, row.requirement, row.verification_method],
      );
    }
    counts.updated += 1;
    return;
  }
  if (!dryRun) {
    await client.query(
      `INSERT INTO guardrails (rule_id, project_id, trigger, requirement, verification_method, created_at)
       VALUES ($1, $2, $3, $4, $5, COALESCE($6, now()))`,
      [ruleId, targetProjectId, row.trigger, row.requirement, row.verification_method, row.created_at],
    );
  }
  counts.created += 1;
}

async function applyDocumentLesson(
  client: PoolClient,
  row: any,
  policy: ConflictPolicy,
  dryRun: boolean,
  counts: EntityCounts,
  recordConflict: (c: ImportConflict) => void,
  /** composite key "${doc_id}::${lesson_id}" -> true, pre-populated by
   *  the batch handler via ONE unnest-zip SELECT per batch (Sprint
   *  11.6c-perf). The link table has no project_id column, so membership
   *  is boolean — we only need to know if the link exists. */
  existing: Map<string, true>,
): Promise<void> {
  const docId: string = row.doc_id;
  const lessonId: string = row.lesson_id;
  const compositeId = `${docId}::${lessonId}`;
  // Map keys are lowercased; use the same form for lookup.
  const lookupKey = `${docId.toLowerCase()}::${lessonId.toLowerCase()}`;
  if (existing.has(lookupKey)) {
    if (policy === 'skip') {
      counts.skipped += 1;
      recordConflict({
        entity: 'document_lessons',
        id: compositeId,
        reason: 'link already exists, skipped',
      });
      return;
    }
    if (policy === 'fail') {
      throw new ImportError('conflict_fail', `document_lesson link "${compositeId}" already exists`);
    }
    // overwrite — the PK exhausts the row content except for `linked_at`.
    // Update it so the count is honest (we ARE writing something) and
    // the destination reflects the bundle's record of when the link was
    // formed, which is what an "overwrite" intent implies.
    if (!dryRun) {
      await client.query(
        `UPDATE document_lessons
            SET linked_at = COALESCE($3, linked_at)
          WHERE doc_id = $1 AND lesson_id = $2`,
        [docId, lessonId, row.linked_at],
      );
    }
    counts.updated += 1;
    return;
  }
  if (!dryRun) {
    await client.query(
      `INSERT INTO document_lessons (doc_id, lesson_id, linked_at)
       VALUES ($1, $2, COALESCE($3, now()))`,
      [docId, lessonId, row.linked_at],
    );
  }
  counts.created += 1;
}
