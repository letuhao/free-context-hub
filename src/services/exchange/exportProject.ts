/**
 * Phase 11 Sprint 11.2 — Project export service
 *
 * Pulls a project's full state (lessons + guardrails + lesson_types +
 * documents + chunks) from Postgres and streams it through bundleFormat
 * into a zip on the given Writable. Built on cursor-based iteration so
 * even a 50k-lesson project peaks at <100MB RSS during export.
 *
 * Knows nothing about HTTP — just DB → bundle. The route in
 * src/api/routes/projects.ts wires this to a Response stream.
 */

import { getDbPool } from '../../db/client.js';
// pg-cursor is a CJS module; use default import.
import Cursor from 'pg-cursor';
import type { Writable } from 'node:stream';
import type { PoolClient } from 'pg';

import {
  encodeBundle,
  type BundleData,
  type BundleDocument,
  type EncodeResult,
} from './bundleFormat.js';

export interface ExportProjectOptions {
  projectId: string;
  /** Default true — full export per phase 11 design ("bundle huge is normal"). */
  includeDocuments?: boolean;
  /** Default true. */
  includeChunks?: boolean;
  /** Cursor batch size. 100 is a sensible default. */
  batchSize?: number;
}

export class ExportNotFoundError extends Error {
  constructor(public readonly projectId: string) {
    super(`project "${projectId}" not found`);
    this.name = 'ExportNotFoundError';
  }
}

/**
 * Stream a full project export as a zip into `output`. Resolves with
 * the EncodeResult once archiver finalizes; the caller is still
 * responsible for waiting on the downstream stream's `close` event if
 * they need to know when bytes have actually flushed (e.g. when
 * writing to disk via fs.createWriteStream).
 *
 * Notes:
 *  - Cursors are opened on a single dedicated PoolClient and consumed
 *    sequentially by encodeBundle (each entity in order). No two
 *    cursors are ever open at the same time on the same client.
 *  - `lesson_types` is a global table (no project_id) so this exports
 *    every type known to the instance. The import side may need to
 *    reconcile types that already exist on the destination instance.
 *  - If encodeBundle errors mid-stream (e.g. archiver fault), the
 *    generator's finally clause runs cursor.close() before the outer
 *    finally releases the client. No FD leaks.
 *  - There is NO timeout enforced here. A 50k-lesson + vision-PDFs
 *    project can hold the HTTP connection for several minutes. The
 *    client may abort first; that closes res, archiver propagates
 *    EPIPE, the generators tear down their cursors. For long exports
 *    Phase 11.4 will add async background job support.
 */
export async function exportProject(
  opts: ExportProjectOptions,
  output: Writable,
): Promise<EncodeResult> {
  const pool = getDbPool();
  const projectId = opts.projectId;
  const includeDocuments = opts.includeDocuments !== false;
  const includeChunks = opts.includeChunks !== false;
  const batchSize = opts.batchSize ?? 100;

  // ---- project lookup ----
  const projectRow = await pool.query<{
    project_id: string;
    name: string | null;
    description: string | null;
  }>(
    `SELECT project_id, name, description FROM projects WHERE project_id = $1`,
    [projectId],
  );
  // Check rows.length, not rowCount — pg types rowCount as number|null and
  // a null would silently fall through and crash on rows[0]!.
  if (projectRow.rows.length === 0) {
    throw new ExportNotFoundError(projectId);
  }
  const project = projectRow.rows[0]!;

  // We need a single dedicated client for cursors — pg.Pool().query() can't
  // hold cursors across calls. Acquire ONE client and reuse it for every
  // cursor stream. Released in the finally below.
  const client = await pool.connect();
  try {
    const data: BundleData = {
      project: {
        project_id: project.project_id,
        name: project.name ?? project.project_id,
        description: project.description,
      },
      lessons: cursorIterable(
        client,
        `SELECT lesson_id, project_id, lesson_type, title, content, tags,
                source_refs, embedding::text AS embedding, captured_by,
                created_at, updated_at
         FROM lessons
         WHERE project_id = $1
         ORDER BY created_at`,
        [projectId],
        batchSize,
        normalizeLessonRow,
      ),
      guardrails: cursorIterable(
        client,
        `SELECT rule_id, project_id, trigger, requirement, verification_method, created_at
         FROM guardrails
         WHERE project_id = $1
         ORDER BY created_at`,
        [projectId],
        batchSize,
      ),
      // lesson_types is global (no project_id column) — export all of them.
      lesson_types: cursorIterable(
        client,
        `SELECT type_key, display_name, description, color, template, is_builtin, created_at
         FROM lesson_types
         ORDER BY type_key`,
        [],
        batchSize,
      ),
    };

    if (includeChunks) {
      data.chunks = cursorIterable(
        client,
        `SELECT chunk_id, doc_id, project_id, chunk_index, content,
                page_number, heading, chunk_type,
                embedding::text AS embedding,
                created_at
         FROM document_chunks
         WHERE project_id = $1
         ORDER BY doc_id, chunk_index`,
        [projectId],
        batchSize,
        normalizeChunkRow,
      );
    }

    if (includeDocuments) {
      data.documents = documentIterable(client, projectId, batchSize);
    }

    return await encodeBundle(data, output);
  } finally {
    client.release();
  }
}

// ─── Cursor helpers ────────────────────────────────────────────────────

/**
 * Wrap a SQL cursor in an async iterable so encodeBundle can stream
 * results without buffering the whole result set. Each row is passed
 * through an optional `normalize` step before yielding (used to parse
 * pgvector strings into number arrays, etc.).
 */
async function* cursorIterable<T = unknown>(
  client: PoolClient,
  sql: string,
  params: unknown[],
  batchSize: number,
  normalize?: (row: any) => T,
): AsyncGenerator<T> {
  const cursor = client.query(new Cursor(sql, params));
  try {
    while (true) {
      const rows = await cursor.read(batchSize);
      if (rows.length === 0) break;
      for (const row of rows) {
        yield normalize ? normalize(row) : (row as T);
      }
    }
  } finally {
    await cursor.close().catch(() => {
      /* ignore — pool will recycle the client anyway */
    });
  }
}

/** Parse pgvector text format `"[0.1,0.2,...]"` into number[]. */
function parseVector(s: string | null): number[] | null {
  if (!s) return null;
  // pgvector serializes as e.g. "[0.1,0.2,0.3]"
  if (!s.startsWith('[') || !s.endsWith(']')) return null;
  const inner = s.slice(1, -1);
  if (inner.length === 0) return [];
  return inner.split(',').map(Number);
}

function normalizeLessonRow(row: any): unknown {
  return {
    ...row,
    embedding: parseVector(row.embedding),
  };
}

function normalizeChunkRow(row: any): unknown {
  return {
    ...row,
    embedding: parseVector(row.embedding),
  };
}

// ─── Documents iterable ────────────────────────────────────────────────

/**
 * Yield BundleDocument records for every document in the project.
 *
 * Memory strategy: the cursor SELECTs metadata only (no `content`) so a
 * single batch is bounded to ~batchSize × small-row regardless of how
 * large the actual document binaries are. For each row, we issue a
 * separate SELECT to fetch just that one document's content, yield the
 * BundleDocument, and let the caller (encodeBundle) consume the buffer
 * before we move to the next iteration. Peak memory is therefore one
 * document's content at a time, which is the minimum possible without
 * pg's large-object API.
 *
 * Earlier draft selected `content` inline in the cursor batch — with
 * a 10MB PDF base64-encoded to ~13MB and batchSize=100 that produced
 * a 1.3 GB peak memory spike. The N+1 query cost (one extra SELECT
 * per document) is sub-millisecond and dwarfed by base64 decoding +
 * archiver compression downstream.
 *
 * The `documents.content` column holds either a `data:base64;...` blob
 * (for binary docs uploaded via Phase 10) or raw utf-8 text (for
 * markdown / html / txt). URL-only docs have content=null and yield
 * with content null so the bundle records the metadata but no binary
 * entry.
 */
async function* documentIterable(
  client: PoolClient,
  projectId: string,
  batchSize: number,
): AsyncGenerator<BundleDocument> {
  const metaSql = `SELECT doc_id, name, doc_type, url, storage_path,
                          content_hash, file_size_bytes, description,
                          tags, extraction_status, extraction_mode, extracted_at,
                          created_at, updated_at
                   FROM documents
                   WHERE project_id = $1
                   ORDER BY created_at`;
  const cursor = client.query(new Cursor(metaSql, [projectId]));
  try {
    while (true) {
      const rows: any[] = await cursor.read(batchSize);
      if (rows.length === 0) break;
      for (const row of rows) {
        // Fetch this single document's content separately so we never
        // hold more than one binary in memory at a time. file_size_bytes
        // is unreliable for base64-encoded blobs, so we always issue
        // the query and let the row buffer release once yielded.
        const contentRes = await client.query<{ content: string | null }>(
          `SELECT content FROM documents WHERE doc_id = $1`,
          [row.doc_id],
        );
        const rawContent = contentRes.rows[0]?.content ?? null;
        yield documentRowToBundle(row, rawContent);
      }
    }
  } finally {
    await cursor.close().catch(() => {
      /* ignore */
    });
  }
}

/** Map a documents row + its fetched content to a BundleDocument. */
function documentRowToBundle(row: any, rawContent: string | null): BundleDocument {
  const docType = row.doc_type as string;
  const ext = extForDoc(row);
  const metadata = {
    name: row.name,
    doc_type: docType,
    url: row.url,
    storage_path: row.storage_path,
    content_hash: row.content_hash,
    file_size_bytes: row.file_size_bytes,
    description: row.description,
    tags: row.tags,
    extraction_status: row.extraction_status,
    extraction_mode: row.extraction_mode,
    extracted_at: row.extracted_at,
    created_at: row.created_at,
    updated_at: row.updated_at,
  };

  // URL-only docs: no content stored, emit metadata-only entry
  if (rawContent === null) {
    return { doc_id: row.doc_id, ext, metadata, content: null };
  }

  // Binary docs from Phase 10 upload: prefixed with "data:base64;"
  let buffer: Buffer;
  if (rawContent.startsWith('data:base64;')) {
    buffer = Buffer.from(rawContent.slice('data:base64;'.length), 'base64');
  } else {
    // Plain text doc (markdown, html, txt, etc.) — utf-8 encode
    buffer = Buffer.from(rawContent, 'utf-8');
  }
  return { doc_id: row.doc_id, ext, metadata, content: buffer };
}

/** Pick a sensible file extension for a documents row. */
function extForDoc(row: any): string {
  // Prefer the actual filename's extension if present, otherwise map
  // doc_type to a default. This keeps round-trip extensions stable.
  const name: string = row.name ?? '';
  const dot = name.lastIndexOf('.');
  if (dot > 0 && dot < name.length - 1) {
    return name.slice(dot + 1);
  }
  switch (row.doc_type) {
    case 'pdf':
      return 'pdf';
    case 'image':
      return 'png'; // best guess — actual format may vary
    case 'markdown':
      return 'md';
    case 'text':
      return 'txt';
    case 'url':
      return 'url';
    default:
      return 'bin';
  }
}
