import { Router } from 'express';
import {
  addToLearningPath, removeFromLearningPath,
  getLearningPath, markCompleted, unmarkCompleted,
} from '../../services/learningPaths.js';
import { resolveProjectIdOrThrow } from '../../core/index.js';

const router = Router();

/** GET /api/learning-paths — get learning path with progress */
router.get('/', async (req, res, next) => {
  try {
    const projectId = resolveProjectIdOrThrow(req.query.project_id as string | undefined);
    const userId = req.query.user_id as string;
    if (!userId) { res.status(400).json({ status: 'error', error: 'user_id required' }); return; }
    const result = await getLearningPath({ projectId, userId });
    res.json(result);
  } catch (e) { next(e); }
});

/** POST /api/learning-paths — add lesson to path */
router.post('/', async (req, res, next) => {
  try {
    const projectId = resolveProjectIdOrThrow(req.body.project_id);
    const result = await addToLearningPath({
      projectId,
      section: req.body.section,
      lessonId: req.body.lesson_id,
      sortOrder: req.body.sort_order,
    });
    res.status(201).json(result);
  } catch (e) { next(e); }
});

/** DELETE /api/learning-paths/:pathId — remove from path */
router.delete('/:pathId', async (req, res, next) => {
  try {
    const deleted = await removeFromLearningPath({ pathId: req.params.pathId });
    if (!deleted) { res.status(404).json({ status: 'error', error: 'not found' }); return; }
    res.json({ status: 'ok' });
  } catch (e) { next(e); }
});

/** POST /api/learning-paths/:pathId/complete — mark as completed */
router.post('/:pathId/complete', async (req, res, next) => {
  try {
    const result = await markCompleted({ userId: req.body.user_id, pathId: req.params.pathId });
    res.json(result);
  } catch (e) { next(e); }
});

/** DELETE /api/learning-paths/:pathId/complete — unmark */
router.delete('/:pathId/complete', async (req, res, next) => {
  try {
    const deleted = await unmarkCompleted({
      userId: (req.query.user_id as string) ?? req.body?.user_id,
      pathId: req.params.pathId,
    });
    if (!deleted) { res.status(404).json({ status: 'error', error: 'not found' }); return; }
    res.json({ status: 'ok' });
  } catch (e) { next(e); }
});

export { router as learningPathsRouter };
