import { Router } from 'express';
import { enqueueJob, listJobs } from '../../core/index.js';

const router = Router();

/** POST /api/jobs — enqueue a job */
router.post('/', async (req, res, next) => {
  try {
    const result = await enqueueJob(req.body);
    res.status(201).json(result);
  } catch (e) { next(e); }
});

/** GET /api/jobs — list jobs */
router.get('/', async (req, res, next) => {
  try {
    const result = await listJobs({
      projectId: req.query.project_id as string | undefined,
      status: req.query.status as any,
      limit: req.query.limit ? Number(req.query.limit) : undefined,
    });
    res.json(result);
  } catch (e) { next(e); }
});

export { router as jobsRouter };
