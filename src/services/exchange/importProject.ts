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

    // ---- 1. lesson_types ----
    for await (const row of reader.lesson_types() as AsyncIterable<any>) {
      result.counts.lesson_types.total += 1;
      await applyLessonType(client, row, policy, dryRun, result.counts.lesson_types, recordConflict);
    }

    // ---- 2. documents ----
    for await (const doc of reader.documents()) {
      result.counts.documents.total += 1;
      await applyDocument(
        client,
        targetProjectId,
        doc,
        policy,
        dryRun,
        result.counts.documents,
        recordConflict,
      );
    }

    // ---- 3. chunks ----
    for await (const row of reader.chunks() as AsyncIterable<any>) {
      result.counts.chunks.total += 1;
      await applyChunk(
        client,
        targetProjectId,
        row,
        policy,
        dryRun,
        result.counts.chunks,
        recordConflict,
      );
    }

    // ---- 4. lessons ----
    for await (const row of reader.lessons() as AsyncIterable<any>) {
      result.counts.lessons.total += 1;
      await applyLesson(
        client,
        targetProjectId,
        row,
        policy,
        dryRun,
        result.counts.lessons,
        recordConflict,
      );
    }

    // ---- 5. guardrails ----
    for await (const row of reader.guardrails() as AsyncIterable<any>) {
      result.counts.guardrails.total += 1;
      await applyGuardrail(
        client,
        targetProjectId,
        row,
        policy,
        dryRun,
        result.counts.guardrails,
        recordConflict,
      );
    }

    // ---- 6. document_lessons (must come AFTER both docs and lessons) ----
    for await (const row of reader.document_lessons() as AsyncIterable<any>) {
      result.counts.document_lessons.total += 1;
      await applyDocumentLesson(
        client,
        row,
        policy,
        dryRun,
        result.counts.document_lessons,
        recordConflict,
      );
    }

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
): Promise<void> {
  const typeKey: string = row.type_key;
  const exists = await client.query<{ is_builtin: boolean }>(
    `SELECT is_builtin FROM lesson_types WHERE type_key = $1`,
    [typeKey],
  );
  if (exists.rows.length > 0) {
    const destBuiltin = exists.rows[0]!.is_builtin === true;
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
): Promise<void> {
  const docId: string = doc.doc_id;
  const meta = doc.metadata;
  const exists = await client.query(
    `SELECT project_id FROM documents WHERE doc_id = $1`,
    [docId],
  );
  if (exists.rows.length > 0) {
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
 * Memory cost: this buffers the entire binary into RAM before encoding.
 * For a 100MB PDF that's a 100MB Buffer (then 133MB base64 string).
 * Phase 11.6 polish can stream the encoding if it bites; for v1 it's
 * bounded by the 500MB multer route limit.
 */
async function materializeDocContent(doc: BundleDocumentRead): Promise<string | null> {
  if (!doc.hasContent) return null;
  const stream = await doc.openContent();
  const chunks: Buffer[] = [];
  for await (const c of stream) chunks.push(c as Buffer);
  const buffer = Buffer.concat(chunks);
  return `data:base64;${buffer.toString('base64')}`;
}

async function applyChunk(
  client: PoolClient,
  targetProjectId: string,
  row: any,
  policy: ConflictPolicy,
  dryRun: boolean,
  counts: EntityCounts,
  recordConflict: (c: ImportConflict) => void,
): Promise<void> {
  const chunkId: string = row.chunk_id;
  const exists = await client.query(`SELECT 1 FROM document_chunks WHERE chunk_id = $1`, [chunkId]);
  if (exists.rows.length > 0) {
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

  const exists = await client.query(`SELECT 1 FROM lessons WHERE lesson_id = $1`, [lessonId]);
  if (exists.rows.length > 0) {
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
): Promise<void> {
  const ruleId: string = row.rule_id;
  const exists = await client.query(`SELECT 1 FROM guardrails WHERE rule_id = $1`, [ruleId]);
  if (exists.rows.length > 0) {
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
): Promise<void> {
  const docId: string = row.doc_id;
  const lessonId: string = row.lesson_id;
  const compositeId = `${docId}::${lessonId}`;
  const exists = await client.query(
    `SELECT 1 FROM document_lessons WHERE doc_id = $1 AND lesson_id = $2`,
    [docId, lessonId],
  );
  if (exists.rows.length > 0) {
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
    // overwrite is a no-op here — the only mutable column is linked_at
    // and there's no real semantic value in updating it. Treat as updated.
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
