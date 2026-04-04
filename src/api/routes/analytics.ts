import { Router } from 'express';
import {
  getRetrievalStats, getLessonsByType, getRetrievalTimeseries,
  getMostRetrievedLessons, getDeadKnowledge, getAgentActivity,
} from '../../services/analytics.js';
import { resolveProjectIdOrThrow } from '../../core/index.js';

const router = Router();

/** GET /api/analytics/overview — top-level metrics */
router.get('/overview', async (req, res, next) => {
  try {
    const projectId = resolveProjectIdOrThrow(req.query.project_id as string | undefined);
    const days = req.query.days ? Number(req.query.days) : undefined;
    const result = await getRetrievalStats({ projectId, days });
    res.json(result);
  } catch (e) { next(e); }
});

/** GET /api/analytics/by-type — lesson count breakdown by type */
router.get('/by-type', async (req, res, next) => {
  try {
    const projectId = resolveProjectIdOrThrow(req.query.project_id as string | undefined);
    const result = await getLessonsByType({ projectId });
    res.json(result);
  } catch (e) { next(e); }
});

/** GET /api/analytics/top-lessons — most useful lessons */
router.get('/top-lessons', async (req, res, next) => {
  try {
    const projectId = resolveProjectIdOrThrow(req.query.project_id as string | undefined);
    const result = await getMostRetrievedLessons({ projectId, limit: req.query.limit ? Number(req.query.limit) : undefined });
    res.json(result);
  } catch (e) { next(e); }
});

/** GET /api/analytics/dead-knowledge — lessons with zero feedback */
router.get('/dead-knowledge', async (req, res, next) => {
  try {
    const projectId = resolveProjectIdOrThrow(req.query.project_id as string | undefined);
    const result = await getDeadKnowledge({ projectId, limit: req.query.limit ? Number(req.query.limit) : undefined });
    res.json(result);
  } catch (e) { next(e); }
});

/** GET /api/analytics/timeseries — daily retrieval counts for charts */
router.get('/timeseries', async (req, res, next) => {
  try {
    const projectId = resolveProjectIdOrThrow(req.query.project_id as string | undefined);
    const days = req.query.days ? Number(req.query.days) : undefined;
    const result = await getRetrievalTimeseries({ projectId, days });
    res.json(result);
  } catch (e) { next(e); }
});

/** GET /api/analytics/agents — agent activity with approval rates */
router.get('/agents', async (req, res, next) => {
  try {
    const projectId = resolveProjectIdOrThrow(req.query.project_id as string | undefined);
    const result = await getAgentActivity({ projectId });
    res.json(result);
  } catch (e) { next(e); }
});

export { router as analyticsRouter };
