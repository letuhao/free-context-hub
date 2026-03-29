import { Router } from 'express';
import {
  listGeneratedDocuments,
  getGeneratedDocument,
  promoteGeneratedDocument,
  resolveProjectIdOrThrow,
} from '../../core/index.js';

const router = Router();

/** GET /api/generated-docs — list generated documents (FAQ, RAPTOR, QC, etc.) */
router.get('/', async (req, res, next) => {
  try {
    const projectId = resolveProjectIdOrThrow(req.query.project_id as string | undefined);
    const result = await listGeneratedDocuments({
      projectId,
      docType: req.query.doc_type as any,
      limit: req.query.limit ? Number(req.query.limit) : undefined,
      includeContent: req.query.include_content === 'true',
    });
    res.json(result);
  } catch (e) { next(e); }
});

/** GET /api/generated-docs/:id — get a single document */
router.get('/:id', async (req, res, next) => {
  try {
    const projectId = resolveProjectIdOrThrow(req.query.project_id as string | undefined);
    const result = await getGeneratedDocument({ projectId, docId: req.params.id });
    if (!result) {
      res.status(404).json({ error: 'Document not found' });
      return;
    }
    res.json(result);
  } catch (e) { next(e); }
});

/** POST /api/generated-docs/:id/promote — promote a document */
router.post('/:id/promote', async (req, res, next) => {
  try {
    const projectId = resolveProjectIdOrThrow(req.body.project_id);
    const result = await promoteGeneratedDocument({ projectId, docId: req.params.id });
    res.json(result);
  } catch (e) { next(e); }
});

export { router as generatedDocsRouter };
