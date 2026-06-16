import { getDbPool } from '../db/client.js';
import { assertCallerScope } from '../core/security/callerScope.js';
import { assertDocumentScope, assertLessonScope } from '../core/security/scopeResolvers.js';
import type { CallerScope } from '../core/security/callerScope.js';

export interface Document {
  doc_id: string;
  project_id: string;
  name: string;
  doc_type: 'pdf' | 'markdown' | 'url' | 'text' | 'docx' | 'image' | 'epub' | 'odt' | 'rtf' | 'html';
  url: string | null;
  storage_path: string | null;
  content: string | null;
  file_size_bytes: number | null;
  description: string | null;
  tags: string[];
  created_at: string;
  updated_at: string;
  linked_lesson_count?: number;
}

/** Create a document (content-based or URL-based). */
export async function createDocument(params: {
  projectId: string;
  /** DEFERRED-029: caller's scope; enforced against projectId. */
  callerScope?: CallerScope;
  name: string;
  docType: 'pdf' | 'markdown' | 'url' | 'text' | 'docx' | 'image' | 'epub' | 'odt' | 'rtf' | 'html';
  url?: string;
  content?: string;
  contentHash?: string;
  fileSizeBytes?: number;
  description?: string;
  tags?: string[];
}): Promise<Document> {
  assertCallerScope(params.callerScope, params.projectId);
  const pool = getDbPool();
  const result = await pool.query(
    `INSERT INTO documents (project_id, name, doc_type, url, content, content_hash, file_size_bytes, description, tags)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9) RETURNING *`,
    [params.projectId, params.name, params.docType, params.url ?? null,
     params.content ?? null, params.contentHash ?? null, params.fileSizeBytes ?? null,
     params.description ?? null, params.tags ?? []],
  );
  return result.rows[0];
}

/** List documents for a project with optional filters. */
export async function listDocuments(params: {
  projectId: string;
  /** DEFERRED-029: caller's scope; enforced against projectId. */
  callerScope?: CallerScope;
  docType?: string;
  linked?: 'linked' | 'unlinked';
  lessonId?: string;
  limit?: number;
  offset?: number;
}): Promise<{ items: Document[]; total_count: number }> {
  assertCallerScope(params.callerScope, params.projectId);
  const pool = getDbPool();
  const limit = Math.min(params.limit ?? 50, 100);
  const offset = Math.max(params.offset ?? 0, 0);

  let where = 'WHERE d.project_id = $1';
  const args: any[] = [params.projectId];
  let argIdx = 2;

  if (params.docType) {
    where += ` AND d.doc_type = $${argIdx++}`;
    args.push(params.docType);
  }

  if (params.lessonId) {
    where += ` AND d.doc_id IN (SELECT doc_id FROM document_lessons WHERE lesson_id = $${argIdx++})`;
    args.push(params.lessonId);
  }

  const countRes = await pool.query(
    `SELECT COUNT(*) AS cnt FROM documents d ${where}`, args,
  );
  const total_count = parseInt(countRes.rows[0]?.cnt ?? '0', 10);

  // Phase 10.5 perf fix: exclude the `content` column from the list query.
  // Binary docs (image/pdf/docx) store their base64 content here — a single
  // 10MB image times 12 rows = 120MB per page load. Callers that need the
  // raw content use GET /api/documents/:id instead.
  let query = `
    SELECT d.doc_id, d.project_id, d.name, d.doc_type, d.url, d.storage_path,
           d.description, d.file_size_bytes, d.content_hash, d.tags,
           d.extraction_status, d.extraction_mode, d.extracted_at,
           d.created_at, d.updated_at,
           COALESCE(lc.cnt, 0)::int AS linked_lesson_count
    FROM documents d
    LEFT JOIN (SELECT doc_id, COUNT(*) AS cnt FROM document_lessons GROUP BY doc_id) lc ON lc.doc_id = d.doc_id
    ${where}`;

  if (params.linked === 'linked') {
    query += ` AND COALESCE(lc.cnt, 0) > 0`;
  } else if (params.linked === 'unlinked') {
    query += ` AND COALESCE(lc.cnt, 0) = 0`;
  }

  query += ` ORDER BY d.updated_at DESC LIMIT $${argIdx} OFFSET $${argIdx + 1}`;
  args.push(limit, offset);

  const result = await pool.query(query, args);
  return { items: result.rows, total_count };
}

/** Get a single document with linked lesson count. */
export async function getDocument(params: {
  docId: string;
  projectId: string;
  /** DEFERRED-029: caller's scope; enforced against projectId. */
  callerScope?: CallerScope;
}): Promise<Document | null> {
  assertCallerScope(params.callerScope, params.projectId);
  const pool = getDbPool();
  const result = await pool.query(
    `SELECT d.*, COALESCE(lc.cnt, 0)::int AS linked_lesson_count
     FROM documents d
     LEFT JOIN (SELECT doc_id, COUNT(*) AS cnt FROM document_lessons GROUP BY doc_id) lc ON lc.doc_id = d.doc_id
     WHERE d.doc_id = $1 AND d.project_id = $2`,
    [params.docId, params.projectId],
  );
  return result.rows[0] ?? null;
}

/** Delete a document (CASCADE removes links). */
export async function deleteDocument(params: {
  docId: string;
  projectId: string;
  /** DEFERRED-029: caller's scope; enforced against projectId. */
  callerScope?: CallerScope;
}): Promise<boolean> {
  assertCallerScope(params.callerScope, params.projectId);
  const pool = getDbPool();
  const result = await pool.query(
    `DELETE FROM documents WHERE doc_id = $1 AND project_id = $2`,
    [params.docId, params.projectId],
  );
  return (result.rowCount ?? 0) > 0;
}

/** Link a document to a lesson. */
export async function linkDocumentToLesson(params: {
  docId: string;
  lessonId: string;
  /** DEFERRED-029: caller's scope; enforced via BOTH the document's AND
   *  the lesson's derived project_id. PR F SEC-4 (Adversary #2 HIGH): the
   *  document_lessons table has no project_id column — the link is a
   *  cross-tenant edge if either endpoint isn't scope-checked. Scope-check
   *  both endpoints to prevent a scoped-A attacker from linking their own
   *  document to a cross-tenant lesson (which would also leak that lesson
   *  via listDocumentLessons). */
  callerScope?: CallerScope;
}): Promise<{ status: 'ok' | 'error'; error?: string }> {
  const pool = getDbPool();
  await assertDocumentScope(pool, params.callerScope, params.docId);
  await assertLessonScope(pool, params.callerScope, params.lessonId);
  try {
    await pool.query(
      `INSERT INTO document_lessons (doc_id, lesson_id) VALUES ($1, $2) ON CONFLICT DO NOTHING`,
      [params.docId, params.lessonId],
    );
    return { status: 'ok' };
  } catch (err) {
    return { status: 'error', error: err instanceof Error ? err.message : String(err) };
  }
}

/** Unlink a document from a lesson. */
export async function unlinkDocumentFromLesson(params: {
  docId: string;
  lessonId: string;
  /** DEFERRED-029: caller's scope; enforced via BOTH the document's AND
   *  the lesson's derived project_id. PR F SEC-4 (Adversary #2 HIGH): even
   *  for delete the secondary id is a probe oracle — without checking it,
   *  a scoped-A caller could test which lesson_ids in proj-B exist by
   *  observing rowCount differences. */
  callerScope?: CallerScope;
}): Promise<boolean> {
  const pool = getDbPool();
  await assertDocumentScope(pool, params.callerScope, params.docId);
  await assertLessonScope(pool, params.callerScope, params.lessonId);
  const result = await pool.query(
    `DELETE FROM document_lessons WHERE doc_id = $1 AND lesson_id = $2`,
    [params.docId, params.lessonId],
  );
  return (result.rowCount ?? 0) > 0;
}

/** List lessons linked to a document. */
export async function listDocumentLessons(params: {
  docId: string;
  /** DEFERRED-029: caller's scope; enforced via the document's derived project_id. */
  callerScope?: CallerScope;
}): Promise<{ lessons: any[] }> {
  const pool = getDbPool();
  await assertDocumentScope(pool, params.callerScope, params.docId);
  const result = await pool.query(
    `SELECT l.lesson_id, l.title, l.lesson_type, l.status, l.tags, dl.linked_at
     FROM document_lessons dl
     JOIN lessons l ON l.lesson_id = dl.lesson_id
     WHERE dl.doc_id = $1
     ORDER BY dl.linked_at DESC`,
    [params.docId],
  );
  return { lessons: result.rows };
}
