import { Router } from 'express';
import { checkGuardrails, resolveProjectIdOrThrow } from '../../core/index.js';

const router = Router();

/** POST /api/guardrails/check — check if an action is allowed */
router.post('/check', async (req, res, next) => {
  try {
    const projectId = resolveProjectIdOrThrow(req.body.project_id);
    const result = await checkGuardrails(projectId, req.body.action_context);
    res.json(result);
  } catch (e) { next(e); }
});

export { router as guardrailsRouter };
