import { Router } from 'express';
import multer from 'multer';
import { createHash } from 'node:crypto';
import {
  createDocument,
  listDocuments,
  getDocument,
  deleteDocument,
  linkDocumentToLesson,
  unlinkDocumentFromLesson,
  listDocumentLessons,
} from '../../services/documents.js';
import { runExtraction, listDocumentChunks } from '../../services/extraction/pipeline.js';
import type { ExtractionMode, ChunkTemplate } from '../../services/extraction/types.js';
import { resolveProjectIdOrThrow } from '../../core/index.js';
import { getDbPool } from '../../db/client.js';

const router = Router();
const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 10 * 1024 * 1024 } }); // 10MB

/**
 * Sanitize a filename: strip path traversal sequences, null bytes, control
 * characters. Limit length to avoid abuse. (Issue #12)
 */
function sanitizeFilename(name: string): string {
  return name
    .replace(/[\x00-\x1f\x7f]/g, '') // control chars
    .replace(/\.\.+/g, '_')           // .. → _
    .replace(/[\\\/]/g, '_')           // path separators → _
    .replace(/^\.+/, '')               // leading dots
    .slice(0, 255)
    .trim() || 'unnamed';
}

/** POST /api/documents/upload — multipart file upload */
router.post('/upload', upload.single('file'), async (req, res, next) => {
  try {
    const projectId = resolveProjectIdOrThrow(req.body.project_id);
    const file = req.file;
    if (!file) { res.status(400).json({ status: 'error', error: 'No file uploaded' }); return; }

    // Sanitize filename (Issue #12)
    const name = sanitizeFilename(file.originalname);
    const ext = name.split('.').pop()?.toLowerCase();

    // Compute content hash for deduplication (Phase 10)
    const contentHash = createHash('sha256').update(file.buffer).digest('hex');

    // Pre-check for duplicate (best-effort UX — gives a clean response).
    // The unique index on (project_id, content_hash) is the actual guarantee.
    const pool = getDbPool();
    const dupRes = await pool.query(
      `SELECT doc_id, name, created_at FROM documents
       WHERE project_id = $1 AND content_hash = $2
       LIMIT 1`,
      [projectId, contentHash],
    );
    if (dupRes.rows.length > 0) {
      const existing = dupRes.rows[0];
      res.status(409).json({
        status: 'duplicate',
        error: 'Document already uploaded',
        existing_doc_id: existing.doc_id,
        existing_name: existing.name,
        existing_uploaded_at: existing.created_at,
      });
      return;
    }

    // Detect doc_type from extension
    const isPdf = ext === 'pdf' || file.mimetype === 'application/pdf';
    const isDocx = ext === 'docx';
    const isImage = file.mimetype.startsWith('image/');
    const docType = isPdf ? 'pdf'
      : isDocx ? 'docx'
      : isImage ? 'image'
      : ext === 'md' ? 'markdown'
      : ext === 'epub' ? 'epub'
      : ext === 'odt' ? 'odt'
      : ext === 'rtf' ? 'rtf'
      : ext === 'html' || ext === 'htm' ? 'html'
      : 'text';

    // For binary formats, store base64 in content so the extraction pipeline
    // can recover the bytes. Text formats stay as utf-8.
    const isBinary = isPdf || isDocx || isImage || ext === 'epub' || ext === 'odt' || ext === 'rtf';
    const content = isBinary
      ? `data:base64;${file.buffer.toString('base64')}`
      : file.buffer.toString('utf-8');

    let tags: string[] | undefined;
    if (req.body.tags) {
      try { tags = JSON.parse(req.body.tags); } catch { tags = undefined; }
    }

    // Atomic insert with content_hash (Issue #6 — race-safe via unique index).
    // If a concurrent upload of the same file slipped past the pre-check, the
    // unique index fires here and we return 409.
    try {
      const result = await createDocument({
        projectId,
        name,
        docType,
        content,
        contentHash,
        fileSizeBytes: file.size,
        description: req.body.description ?? undefined,
        tags,
      });
      res.status(201).json(result);
    } catch (insErr: any) {
      // Postgres unique violation = 23505
      if (insErr?.code === '23505' && insErr?.constraint === 'idx_documents_project_hash') {
        // Re-query to return existing doc info
        const existing = await pool.query(
          `SELECT doc_id, name, created_at FROM documents
           WHERE project_id = $1 AND content_hash = $2 LIMIT 1`,
          [projectId, contentHash],
        );
        const ex = existing.rows[0];
        res.status(409).json({
          status: 'duplicate',
          error: 'Document already uploaded',
          existing_doc_id: ex?.doc_id,
          existing_name: ex?.name,
          existing_uploaded_at: ex?.created_at,
        });
        return;
      }
      throw insErr;
    }
  } catch (e) { next(e); }
});

/** POST /api/documents — create a document (JSON body) */
router.post('/', async (req, res, next) => {
  try {
    const projectId = resolveProjectIdOrThrow(req.body.project_id);
    const result = await createDocument({
      projectId,
      name: req.body.name,
      docType: req.body.doc_type,
      url: req.body.url,
      content: req.body.content,
      fileSizeBytes: req.body.file_size_bytes,
      description: req.body.description,
      tags: req.body.tags,
    });
    res.status(201).json(result);
  } catch (e) { next(e); }
});

/** GET /api/documents — list documents for a project */
router.get('/', async (req, res, next) => {
  try {
    const projectId = resolveProjectIdOrThrow(req.query.project_id as string | undefined);
    const result = await listDocuments({
      projectId,
      docType: req.query.doc_type as string | undefined,
      linked: req.query.linked as 'linked' | 'unlinked' | undefined,
      lessonId: req.query.lesson_id as string | undefined,
      limit: req.query.limit ? Number(req.query.limit) : undefined,
      offset: req.query.offset ? Number(req.query.offset) : undefined,
    });
    res.json(result);
  } catch (e) { next(e); }
});

/** GET /api/documents/:id — get a document */
router.get('/:id', async (req, res, next) => {
  try {
    const projectId = resolveProjectIdOrThrow(req.query.project_id as string | undefined);
    const result = await getDocument({ docId: req.params.id, projectId });
    if (!result) {
      res.status(404).json({ status: 'error', error: 'document not found' });
      return;
    }
    res.json(result);
  } catch (e) { next(e); }
});

/** POST /api/documents/:id/generate-lessons — AI-extract lesson suggestions from doc content */
router.post('/:id/generate-lessons', async (req, res, next) => {
  try {
    const projectId = resolveProjectIdOrThrow(req.body.project_id);
    const doc = await getDocument({ docId: req.params.id, projectId });
    if (!doc) {
      res.status(404).json({ status: 'error', error: 'document not found' });
      return;
    }
    if (!doc.content?.trim()) {
      res.status(400).json({ status: 'error', error: 'document has no text content to analyze' });
      return;
    }
    const { generateLessonsFromDocument } = await import('../../services/documentLessonGenerator.js');
    const result = await generateLessonsFromDocument({
      docName: doc.name,
      docContent: doc.content,
      maxLessons: req.body.max_lessons,
    });
    if (result.status === 'error') {
      res.status(502).json(result);
      return;
    }
    res.json(result);
  } catch (e) { next(e); }
});

/** DELETE /api/documents/:id — delete a document */
router.delete('/:id', async (req, res, next) => {
  try {
    const projectId = resolveProjectIdOrThrow((req.query.project_id as string | undefined) ?? req.body?.project_id);
    const deleted = await deleteDocument({ docId: req.params.id, projectId });
    if (!deleted) {
      res.status(404).json({ status: 'error', error: 'document not found' });
      return;
    }
    res.json({ status: 'ok' });
  } catch (e) { next(e); }
});

/** POST /api/documents/:id/lessons/:lessonId — link document to lesson */
router.post('/:id/lessons/:lessonId', async (req, res, next) => {
  try {
    const result = await linkDocumentToLesson({
      docId: req.params.id,
      lessonId: req.params.lessonId,
    });
    if (result.status === 'error') {
      res.status(400).json(result);
      return;
    }
    res.status(201).json(result);
  } catch (e) { next(e); }
});

/** DELETE /api/documents/:id/lessons/:lessonId — unlink document from lesson */
router.delete('/:id/lessons/:lessonId', async (req, res, next) => {
  try {
    const deleted = await unlinkDocumentFromLesson({
      docId: req.params.id,
      lessonId: req.params.lessonId,
    });
    if (!deleted) {
      res.status(404).json({ status: 'error', error: 'link not found' });
      return;
    }
    res.json({ status: 'ok' });
  } catch (e) { next(e); }
});

/** GET /api/documents/:id/lessons — list lessons linked to a document */
router.get('/:id/lessons', async (req, res, next) => {
  try {
    const result = await listDocumentLessons({ docId: req.params.id });
    res.json(result);
  } catch (e) { next(e); }
});

/** POST /api/documents/:id/extract — Phase 10: run extraction pipeline */
router.post('/:id/extract', async (req, res, next) => {
  try {
    const projectId = resolveProjectIdOrThrow(req.body.project_id);
    const mode = (req.body.mode ?? 'fast') as ExtractionMode;
    const template = req.body.template as ChunkTemplate | undefined;

    if (!['fast', 'quality', 'vision'].includes(mode)) {
      res.status(400).json({ status: 'error', error: `Invalid mode: ${mode}` });
      return;
    }
    if (mode === 'vision') {
      res.status(501).json({
        status: 'error',
        error: 'Vision extraction is not yet implemented (Sprint 10.3)',
      });
      return;
    }

    const result = await runExtraction({
      docId: req.params.id,
      projectId,
      mode,
      template,
    });
    res.json({ status: 'ok', mode, ...result });
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    if (msg === 'Document not found') {
      res.status(404).json({ status: 'error', error: msg });
      return;
    }
    // Surface client-actionable extraction errors as 422 (Unprocessable Entity)
    // instead of generic 500. These are content/format problems, not server bugs.
    const isClientError =
      /magic bytes|legacy flow|produced no content|Chunking produced|does not support/i.test(msg);
    if (isClientError) {
      res.status(422).json({ status: 'error', error: msg });
      return;
    }
    next(e);
  }
});

/** GET /api/documents/:id/chunks — Phase 10: list extracted chunks */
router.get('/:id/chunks', async (req, res, next) => {
  try {
    const projectId = resolveProjectIdOrThrow(req.query.project_id as string | undefined);
    const result = await listDocumentChunks({
      docId: req.params.id,
      projectId,
    });
    res.json(result);
  } catch (e) { next(e); }
});

export { router as documentsRouter };
