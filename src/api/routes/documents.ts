import { Router } from 'express';
import multer from 'multer';
import {
  createDocument,
  listDocuments,
  getDocument,
  deleteDocument,
  linkDocumentToLesson,
  unlinkDocumentFromLesson,
  listDocumentLessons,
} from '../../services/documents.js';
import { resolveProjectIdOrThrow } from '../../core/index.js';

const router = Router();
const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 10 * 1024 * 1024 } }); // 10MB

/** POST /api/documents/upload — multipart file upload */
router.post('/upload', upload.single('file'), async (req, res, next) => {
  try {
    const projectId = resolveProjectIdOrThrow(req.body.project_id);
    const file = req.file;
    if (!file) { res.status(400).json({ status: 'error', error: 'No file uploaded' }); return; }

    const name = file.originalname;
    const ext = name.split('.').pop()?.toLowerCase();

    // PDF files: store as binary indicator, not raw UTF-8 (binary would be garbled)
    const isPdf = ext === 'pdf' || file.mimetype === 'application/pdf';
    const content = isPdf ? `[PDF file: ${name}, ${file.size} bytes]` : file.buffer.toString('utf-8');
    const docType = ext === 'md' ? 'markdown' : isPdf ? 'pdf' : 'text';

    let tags: string[] | undefined;
    if (req.body.tags) {
      try { tags = JSON.parse(req.body.tags); } catch { tags = undefined; }
    }

    const result = await createDocument({
      projectId,
      name,
      docType,
      content,
      fileSizeBytes: file.size,
      description: req.body.description ?? undefined,
      tags,
    });
    res.status(201).json(result);
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

export { router as documentsRouter };
