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
import { runExtraction, listDocumentChunks, updateChunk, deleteChunk } from '../../services/extraction/pipeline.js';
import { searchChunks } from '../../services/documentChunks.js';
import type { ChunkTypeFilter } from '../../services/documentChunks.js';
import { getPdfPageCount } from '../../services/extraction/pdfRender.js';
import { estimateVisionCost } from '../../services/extraction/vision.js';
import { enqueueJob, cancelJob } from '../../services/jobQueue.js';
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
    // Whitelist supported image mimetypes — vision models typically support
    // png/jpeg/webp; SVG/HEIC/AVIF can break or produce garbage.
    const SUPPORTED_IMAGE_MIMES = new Set(['image/png', 'image/jpeg', 'image/jpg', 'image/webp']);
    const isImage = SUPPORTED_IMAGE_MIMES.has(file.mimetype);
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

/** POST /api/documents/:id/extract — Phase 10: run extraction pipeline.
 *  - fast/quality: synchronous, returns chunks immediately
 *  - vision: enqueues an async job, returns { status: 'queued', job_id }
 */
router.post('/:id/extract', async (req, res, next) => {
  try {
    const projectId = resolveProjectIdOrThrow(req.body.project_id);
    const mode = (req.body.mode ?? 'fast') as ExtractionMode;
    const template = req.body.template as ChunkTemplate | undefined;

    if (!['fast', 'quality', 'vision'].includes(mode)) {
      res.status(400).json({ status: 'error', error: `Invalid mode: ${mode}` });
      return;
    }

    // Validate prompt_template server-side — don't trust the client's TypeScript
    const promptTemplate = req.body.prompt_template ?? 'default';
    if (!['default', 'mermaid'].includes(promptTemplate)) {
      res.status(400).json({ status: 'error', error: `Invalid prompt_template: ${promptTemplate}` });
      return;
    }

    // Vision mode is async — enqueue a job and return job_id
    if (mode === 'vision') {
      // Verify the document exists and check its doc_type before enqueueing.
      // Vision currently only supports pdf and image; for everything else,
      // pandoc-to-PDF would fail in our alpine image (no PDF engine).
      const pool = getDbPool();
      const docRes = await pool.query(
        `SELECT doc_type FROM documents WHERE doc_id = $1 AND project_id = $2`,
        [req.params.id, projectId],
      );
      if (docRes.rowCount === 0) {
        res.status(404).json({ status: 'error', error: 'Document not found' });
        return;
      }
      const docType = docRes.rows[0].doc_type;
      const VISION_SUPPORTED = ['pdf', 'image'];
      if (!VISION_SUPPORTED.includes(docType)) {
        res.status(422).json({
          status: 'error',
          error: `Vision mode currently supports only ${VISION_SUPPORTED.join(', ')}. ` +
            `For ${docType}, use Quality Text mode instead.`,
        });
        return;
      }

      // Mark document as processing
      await pool.query(
        `UPDATE documents SET extraction_status = 'processing' WHERE doc_id = $1`,
        [req.params.id],
      );

      const job = await enqueueJob({
        project_id: projectId,
        job_type: 'document.extract.vision' as any,
        payload: {
          doc_id: req.params.id,
          template: template ?? 'auto',
          prompt_template: promptTemplate,
        },
        max_attempts: 1, // vision is expensive — don't retry by default
      });
      res.status(202).json({
        status: 'queued',
        mode: 'vision',
        job_id: job.job_id,
        backend: job.backend,
      });
      return;
    }

    // Sync path for fast/quality
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

/** POST /api/documents/:id/extract/estimate — Phase 10: cost/time estimate before extraction */
router.post('/:id/extract/estimate', async (req, res, next) => {
  try {
    const projectId = resolveProjectIdOrThrow(req.body.project_id);
    const mode = (req.body.mode ?? 'vision') as ExtractionMode;

    const pool = getDbPool();
    const docRes = await pool.query(
      `SELECT doc_id, doc_type, content, file_size_bytes FROM documents
       WHERE doc_id = $1 AND project_id = $2`,
      [req.params.id, projectId],
    );
    if (docRes.rowCount === 0) {
      res.status(404).json({ status: 'error', error: 'Document not found' });
      return;
    }
    const doc = docRes.rows[0];

    // For non-vision modes, return zero cost
    if (mode !== 'vision') {
      res.json({
        mode,
        page_count: null,
        estimated_usd: 0,
        per_page: 0,
        provider: 'local',
        estimated_seconds: 5,
      });
      return;
    }

    // Vision: count pages and apply pricing model
    let pageCount = 1;
    if (doc.doc_type === 'pdf') {
      try {
        const rawContent: string = doc.content ?? '';
        const buffer = rawContent.startsWith('data:base64;')
          ? Buffer.from(rawContent.slice('data:base64;'.length), 'base64')
          : Buffer.from(rawContent, 'utf-8');
        pageCount = await getPdfPageCount(buffer);
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        res.status(422).json({ status: 'error', error: `Could not count PDF pages: ${msg}` });
        return;
      }
    } else if (doc.doc_type === 'image') {
      pageCount = 1;
    } else {
      // DOCX/EPUB/etc — page count unknown without converting
      pageCount = 1;
    }

    const cost = estimateVisionCost(pageCount);
    // Rough wall-clock estimate: ~10s/page for local models, ~3s/page for cloud
    const secondsPerPage = cost.estimated_usd === null ? 10 : 3;

    res.json({
      mode,
      page_count: pageCount,
      estimated_usd: cost.estimated_usd,
      per_page: cost.per_page,
      provider: cost.provider,
      estimated_seconds: pageCount * secondsPerPage,
    });
  } catch (e) { next(e); }
});

/** GET /api/documents/:id/extraction-status — Phase 10: poll for vision job status */
router.get('/:id/extraction-status', async (req, res, next) => {
  try {
    const projectId = resolveProjectIdOrThrow(req.query.project_id as string | undefined);
    const pool = getDbPool();

    // Fetch document status
    const docRes = await pool.query(
      `SELECT doc_id, extraction_status, extraction_mode, extracted_at FROM documents
       WHERE doc_id = $1 AND project_id = $2`,
      [req.params.id, projectId],
    );
    if (docRes.rowCount === 0) {
      res.status(404).json({ status: 'error', error: 'Document not found' });
      return;
    }
    const doc = docRes.rows[0];

    // Fetch latest extraction job for this document
    const jobRes = await pool.query(
      `SELECT job_id, status, error_message, started_at, finished_at, attempts, max_attempts,
              progress_pct, progress_message
       FROM async_jobs
       WHERE project_id = $1
         AND payload->>'doc_id' = $2
         AND job_type = 'document.extract.vision'
       ORDER BY queued_at DESC
       LIMIT 1`,
      [projectId, req.params.id],
    );
    const job = jobRes.rows[0] ?? null;

    // Count chunks if extraction is complete
    let chunkCount: number | null = null;
    if (doc.extraction_status === 'complete') {
      const chunkRes = await pool.query(
        `SELECT COUNT(*) AS cnt FROM document_chunks WHERE doc_id = $1`,
        [req.params.id],
      );
      chunkCount = parseInt(chunkRes.rows[0]?.cnt ?? '0', 10);
    }

    res.json({
      doc_id: doc.doc_id,
      extraction_status: doc.extraction_status,
      extraction_mode: doc.extraction_mode,
      extracted_at: doc.extracted_at,
      chunk_count: chunkCount,
      job: job
        ? {
            job_id: job.job_id,
            status: job.status,
            error_message: job.error_message,
            started_at: job.started_at,
            finished_at: job.finished_at,
            attempts: job.attempts,
            max_attempts: job.max_attempts,
            progress_pct: job.progress_pct,
            progress_message: job.progress_message,
          }
        : null,
    });
  } catch (e) { next(e); }
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

/** PUT /api/documents/:id/chunks/:chunkId — Phase 10.4: edit a single chunk's content. */
router.put('/:id/chunks/:chunkId', async (req, res, next) => {
  try {
    const projectId = resolveProjectIdOrThrow(req.body.project_id);
    const content = String(req.body.content ?? '').trim();
    if (!content) {
      res.status(400).json({ status: 'error', error: 'content is required' });
      return;
    }
    const expectedUpdatedAt: string | undefined = req.body.expected_updated_at;

    const result = await updateChunk({
      docId: req.params.id,
      chunkId: req.params.chunkId,
      projectId,
      content,
      expectedUpdatedAt,
    });

    if (result.status === 'not_found') {
      res.status(404).json({ status: 'error', error: 'chunk not found' });
      return;
    }
    if (result.status === 'conflict') {
      res.status(409).json({
        status: 'conflict',
        error: 'Chunk was modified by another request. Reload and try again.',
        current: result.current,
      });
      return;
    }
    res.json({ status: 'ok', chunk: result.chunk });
  } catch (e) { next(e); }
});

/** DELETE /api/documents/:id/chunks/:chunkId — Phase 10.4: remove a chunk (skip). */
router.delete('/:id/chunks/:chunkId', async (req, res, next) => {
  try {
    const projectId = resolveProjectIdOrThrow(
      (req.query.project_id as string | undefined) ?? req.body?.project_id,
    );
    const deleted = await deleteChunk({
      docId: req.params.id,
      chunkId: req.params.chunkId,
      projectId,
    });
    if (!deleted) {
      res.status(404).json({ status: 'error', error: 'chunk not found' });
      return;
    }
    res.json({ status: 'ok' });
  } catch (e) { next(e); }
});

/** POST /api/documents/:id/jobs/:jobId/cancel — Phase 10.4: cancel a running extraction job.
 *
 * Scoped to project_id so a leaked job_id from another tenant cannot be
 * cancelled across projects. The document status reset is additionally
 * scoped to (doc_id, project_id) to prevent touching another tenant's row.
 */
router.post('/:id/jobs/:jobId/cancel', async (req, res, next) => {
  try {
    const projectId = resolveProjectIdOrThrow(req.body.project_id);
    const cancelled = await cancelJob(req.params.jobId, projectId);
    if (!cancelled) {
      res.status(409).json({
        status: 'error',
        error: 'Job is not in a cancellable state (already finished, never started, or not owned by this project)',
      });
      return;
    }
    // Reset the document's extraction_status from 'processing' so the GUI can re-extract.
    // The WHERE clause on extraction_status='processing' guards against a race
    // where the worker already marked it 'complete' between cancelJob and this UPDATE.
    const pool = getDbPool();
    await pool.query(
      `UPDATE documents
       SET extraction_status = 'failed'
       WHERE doc_id = $1 AND project_id = $2 AND extraction_status = 'processing'`,
      [req.params.id, projectId],
    );
    res.json({ status: 'ok' });
  } catch (e) { next(e); }
});

/** POST /api/documents/bulk-extract — Phase 10.6: enqueue vision extraction
 * for every PDF/image document in a project. Returns the list of queued
 * job IDs so the GUI can poll progress. Non-supported doc types are skipped.
 */
router.post('/bulk-extract', async (req, res, next) => {
  try {
    const projectId = resolveProjectIdOrThrow(req.body.project_id);
    // Currently vision-only — the worker job queue only handles the vision
    // pipeline. Bulk fast/quality would need to run inline and block the
    // request for potentially minutes; better to require individual extract.
    const promptTemplate = req.body.prompt_template ?? 'default';
    if (!['default', 'mermaid'].includes(promptTemplate)) {
      res.status(400).json({ status: 'error', error: `Invalid prompt_template: ${promptTemplate}` });
      return;
    }

    const pool = getDbPool();
    const docsRes = await pool.query(
      `SELECT doc_id, doc_type FROM documents
       WHERE project_id = $1 AND doc_type = ANY($2::text[])
       ORDER BY updated_at DESC`,
      [projectId, ['pdf', 'image']],
    );

    const queued: { doc_id: string; job_id?: string; status: string; error?: string }[] = [];
    for (const row of docsRes.rows) {
      try {
        await pool.query(
          `UPDATE documents SET extraction_status = 'processing' WHERE doc_id = $1`,
          [row.doc_id],
        );
        const job = await enqueueJob({
          project_id: projectId,
          job_type: 'document.extract.vision' as any,
          payload: {
            doc_id: row.doc_id,
            template: 'auto',
            prompt_template: promptTemplate,
          },
          max_attempts: 1,
        });
        queued.push({ doc_id: row.doc_id, job_id: job.job_id, status: 'queued' });
      } catch (err) {
        queued.push({
          doc_id: row.doc_id,
          status: 'error',
          error: err instanceof Error ? err.message : String(err),
        });
      }
    }

    res.status(202).json({
      status: 'ok',
      mode: 'vision',
      prompt_template: promptTemplate,
      total: queued.length,
      queued: queued.filter((q) => q.status === 'queued').length,
      errors: queued.filter((q) => q.status === 'error').length,
      jobs: queued,
    });
  } catch (e) { next(e); }
});

/** GET /api/documents/:id/thumbnail — Phase 10.5: serve the raw bytes of an
 * image document so the list view can <img src=…> without embedding the full
 * base64 content in the JSON response. Returns 404 if doc is not an image.
 */
router.get('/:id/thumbnail', async (req, res, next) => {
  try {
    const projectId = resolveProjectIdOrThrow(req.query.project_id as string | undefined);
    const pool = getDbPool();
    const r = await pool.query(
      `SELECT doc_type, content, name FROM documents WHERE doc_id = $1 AND project_id = $2`,
      [req.params.id, projectId],
    );
    if (r.rowCount === 0) { res.status(404).end(); return; }
    const doc = r.rows[0];
    if (doc.doc_type !== 'image') { res.status(404).end(); return; }
    if (typeof doc.content !== 'string' || !doc.content.startsWith('data:base64;')) {
      res.status(404).end();
      return;
    }
    const b64 = doc.content.slice('data:base64;'.length);
    const buf = Buffer.from(b64, 'base64');
    const ext = String(doc.name || '').split('.').pop()?.toLowerCase();
    const mime =
      ext === 'jpg' || ext === 'jpeg' ? 'image/jpeg' :
      ext === 'webp' ? 'image/webp' :
      'image/png';
    res.setHeader('Content-Type', mime);
    res.setHeader('Cache-Control', 'private, max-age=300'); // 5 min
    res.setHeader('Content-Length', String(buf.length));
    res.end(buf);
  } catch (e) { next(e); }
});

/** POST /api/documents/chunks/search — Phase 10.5: hybrid semantic+FTS chunk search
 *
 * Body: { project_id, query, limit?, chunk_types?[], doc_ids?[], min_score? }
 * Returns: { matches: ChunkMatch[], explanations: string[] }
 *
 * This is THE endpoint that makes document_chunks first-class in retrieval.
 * Callers: GUI chunk-search panel, global search, chat tool, MCP tool.
 */
const VALID_CHUNK_TYPES: readonly ChunkTypeFilter[] = ['text', 'table', 'code', 'diagram_description', 'mermaid'] as const;

router.post('/chunks/search', async (req, res, next) => {
  try {
    const projectId = resolveProjectIdOrThrow(req.body.project_id);
    const query = typeof req.body.query === 'string' ? req.body.query.trim() : '';
    if (!query) {
      res.status(400).json({ status: 'error', error: 'query is required' });
      return;
    }

    // Validate chunk_types — reject unknown values rather than silently drop
    let chunkTypes: ChunkTypeFilter[] | undefined;
    if (Array.isArray(req.body.chunk_types) && req.body.chunk_types.length > 0) {
      const bad = req.body.chunk_types.find(
        (t: unknown) => typeof t !== 'string' || !VALID_CHUNK_TYPES.includes(t as ChunkTypeFilter),
      );
      if (bad !== undefined) {
        res.status(400).json({ status: 'error', error: `Invalid chunk_type: ${String(bad)}` });
        return;
      }
      chunkTypes = req.body.chunk_types as ChunkTypeFilter[];
    }

    const docIds = Array.isArray(req.body.doc_ids)
      ? (req.body.doc_ids as unknown[]).filter((x): x is string => typeof x === 'string')
      : undefined;

    const limit = Number.isFinite(req.body.limit) ? Number(req.body.limit) : 10;
    const minScore = Number.isFinite(req.body.min_score) ? Number(req.body.min_score) : 0;

    const result = await searchChunks({
      projectId,
      query,
      limit,
      chunkTypes,
      docIds,
      minScore,
    });

    res.json({ status: 'ok', ...result });
  } catch (e) { next(e); }
});

export { router as documentsRouter };
