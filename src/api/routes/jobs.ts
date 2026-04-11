import { Router } from 'express';
import { enqueueJob, listJobs, runNextJob } from '../../core/index.js';
import { resolveProjectParams } from '../middleware/resolveProjectParams.js';

const router = Router();

/** POST /api/jobs — enqueue a job */
router.post('/', async (req, res, next) => {
  try {
    const result = await enqueueJob(req.body);
    res.status(201).json(result);
  } catch (e) { next(e); }
});

/** GET /api/jobs — list jobs (supports project_ids[] for multi-project) */
router.get('/', async (req, res, next) => {
  try {
    // Jobs list is special: project_id is optional (shows all if omitted).
    // Use resolveProjectParams only if project_id or project_ids is present.
    const hasProjectParam = req.query.project_id || req.query.project_ids;
    const p = hasProjectParam ? resolveProjectParams(req.query) : {};
    const result = await listJobs({
      ...p,
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
