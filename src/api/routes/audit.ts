import { Router } from 'express';
import { listAuditLog, getAuditStats } from '../../services/auditLog.js';
import { resolveProjectIdOrThrow } from '../../core/index.js';

const router = Router();

/** Parse project_ids from query. Falls back to project_id. */
function resolveProjectParams(query: any): { projectId?: string; projectIds?: string[] } {
  const raw = query.project_ids;
  if (raw) {
    const ids = Array.isArray(raw) ? raw.map(String) : String(raw).split(',').map((s: string) => s.trim()).filter(Boolean);
    if (ids.length > 0) return { projectIds: ids };
  }
  return { projectId: resolveProjectIdOrThrow(query.project_id as string | undefined) };
}

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
    const p = resolveProjectParams(req.query);
    const stats = await getAuditStats(p.projectIds ?? p.projectId ?? '');
    res.json(stats);
  } catch (e) { next(e); }
});

export { router as auditRouter };
