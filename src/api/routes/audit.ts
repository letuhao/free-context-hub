import { Router } from 'express';
import { listAuditLog, getAuditStats } from '../../services/auditLog.js';
import { resolveProjectParams, resolveProjectIdOrIds } from '../middleware/resolveProjectParams.js';

const router = Router();

/** GET /api/audit — unified audit timeline */
router.get('/', async (req, res, next) => {
  try {
    const p = resolveProjectParams(req.query);
    const result = await listAuditLog({
      ...p,
      limit: req.query.limit ? Number(req.query.limit) : undefined,
      offset: req.query.offset ? Number(req.query.offset) : undefined,
      agent_id: req.query.agent_id as string | undefined,
      action_type: req.query.action_type as string | undefined,
      days: req.query.days ? Number(req.query.days) : undefined,
    });
    res.json(result);
  } catch (e) { next(e); }
});

/** GET /api/audit/stats — audit statistics */
router.get('/stats', async (req, res, next) => {
  try {
    const pid = resolveProjectIdOrIds(req.query);
    const stats = await getAuditStats(pid);
    res.json(stats);
  } catch (e) { next(e); }
});

export { router as auditRouter };
