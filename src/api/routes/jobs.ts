import { Router } from 'express';
import { enqueueJob, listJobs, runNextJob } from '../../core/index.js';

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
      offset: req.query.offset ? Number(req.query.offset) : undefined,
    });
    res.json(result);
  } catch (e) { next(e); }
});

/** POST /api/jobs/run-next — run one queued job immediately */
router.post('/run-next', async (req, res, next) => {
  try {
    const result = await runNextJob(req.body.queue_name);
    res.json(result);
  } catch (e) { next(e); }
});

export { router as jobsRouter };
