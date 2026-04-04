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

/** GET /api/search/global — cross-entity search for Cmd+K palette */
router.get('/global', async (req, res, next) => {
  try {
    const projectId = resolveProjectIdOrThrow(req.query.project_id as string | undefined);
    const q = req.query.q as string;
    if (!q?.trim()) { res.json({ query: '', lessons: [], documents: [], guardrails: [], commits: [], total_count: 0 }); return; }
    const { globalSearch } = await import('../../services/globalSearch.js');
    const result = await globalSearch({
      projectId,
      query: q,
      limitPerGroup: req.query.limit ? Number(req.query.limit) : undefined,
    });
    res.json(result);
  } catch (e) { next(e); }
});

export { router as searchRouter };
