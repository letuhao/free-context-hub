import { Router } from 'express';
import {
  getRetrievalStats, getLessonsByType, getRetrievalTimeseries,
  getMostRetrievedLessons, getDeadKnowledge, getAgentActivity,
} from '../../services/analytics.js';
import { resolveProjectParams } from '../middleware/resolveProjectParams.js';

const router = Router();

/** GET /api/analytics/overview — top-level metrics + type breakdown + top lessons */
router.get('/overview', async (req, res, next) => {
  try {
    const p = resolveProjectParams(req.query);
    const days = req.query.days ? Number(req.query.days) : undefined;
    const [stats, byType, topLessons] = await Promise.all([
      getRetrievalStats({ ...p, days }),
      getLessonsByType(p),
      getMostRetrievedLessons({ ...p, limit: 5 }),
    ]);
    const type_breakdown: Record<string, number> = {};
    for (const entry of byType.breakdown) {
      type_breakdown[entry.lesson_type] = entry.count;
    }
    const top_lessons = topLessons.items.map((l: any) => ({
      ...l,
      retrieval_count: l.upvotes ?? 0,
    }));
    res.json({ ...stats, type_breakdown, top_lessons });
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
