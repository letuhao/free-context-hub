import { Router } from 'express';
import { tieredSearch, resolveProjectIdOrThrow } from '../../core/index.js';

const router = Router();

/** POST /api/search/code-tiered — tiered code search */
router.post('/code-tiered', async (req, res, next) => {
  try {
    const projectId = resolveProjectIdOrThrow(req.body.project_id);
    const result = await tieredSearch({
      projectId,
      query: req.body.query,
      kind: req.body.kind,
      maxFiles: req.body.max_files,
      semanticThreshold: req.body.semantic_threshold,
    });
    res.json(result);
  } catch (e) { next(e); }
});

export { router as searchRouter };
