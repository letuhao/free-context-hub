import { Router } from 'express';
import {
  getRetrievalStats, getLessonsByType, getRetrievalTimeseries,
  getMostRetrievedLessons, getDeadKnowledge, getAgentActivity,
} from '../../services/analytics.js';
import { resolveProjectIdOrThrow } from '../../core/index.js';

const router = Router();

/** Parse project_ids[] from query string (comma-separated or repeated). Falls back to project_id. */
function resolveProjectParams(query: any): { projectId?: string; projectIds?: string[] } {
  const raw = query.project_ids;
  if (raw) {
    const ids = Array.isArray(raw) ? raw.map(String) : String(raw).split(',').map((s: string) => s.trim()).filter(Boolean);
    if (ids.length > 0) return { projectIds: ids };
  }
  return { projectId: resolveProjectIdOrThrow(query.project_id as string | undefined) };
}

/** GET /api/analytics/overview — top-level metrics */
router.get('/overview', async (req, res, next) => {
  try {
    const p = resolveProjectParams(req.query);
    const days = req.query.days ? Number(req.query.days) : undefined;
    const result = await getRetrievalStats({ ...p, days });
    res.json(result);
  } catch (e) { next(e); }
});

/** GET /api/analytics/by-type — lesson count breakdown by type */
router.get('/by-type', async (req, res, next) => {
  try {
    const p = resolveProjectParams(req.query);
    const result = await getLessonsByType(p);
    res.json(result);
  } catch (e) { next(e); }
});

/** GET /api/analytics/top-lessons — most useful lessons */
router.get('/top-lessons', async (req, res, next) => {
  try {
    const p = resolveProjectParams(req.query);
    const result = await getMostRetrievedLessons({ ...p, limit: req.query.limit ? Number(req.query.limit) : undefined });
    res.json(result);
  } catch (e) { next(e); }
});

/** GET /api/analytics/dead-knowledge — lessons with zero feedback */
router.get('/dead-knowledge', async (req, res, next) => {
  try {
    const p = resolveProjectParams(req.query);
    const result = await getDeadKnowledge({ ...p, limit: req.query.limit ? Number(req.query.limit) : undefined });
    res.json(result);
  } catch (e) { next(e); }
});

/** GET /api/analytics/timeseries — daily retrieval counts for charts */
router.get('/timeseries', async (req, res, next) => {
  try {
    const p = resolveProjectParams(req.query);
    const days = req.query.days ? Number(req.query.days) : undefined;
    const result = await getRetrievalTimeseries({ ...p, days });
    res.json(result);
  } catch (e) { next(e); }
});

/** GET /api/analytics/agents — agent activity with approval rates */
router.get('/agents', async (req, res, next) => {
  try {
    const p = resolveProjectParams(req.query);
    const result = await getAgentActivity(p);
    res.json(result);
  } catch (e) { next(e); }
});

export { router as analyticsRouter };
