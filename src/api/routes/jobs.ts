import { Router } from 'express';
import type { Request } from 'express';
import { requireProjectScope } from '../middleware/requireResourceScope.js';
import { enqueueJob, listJobs, runNextJob } from '../../core/index.js';
import type { CallerScope } from '../../core/index.js';
import { resolveProjectParams } from '../middleware/resolveProjectParams.js';

/** DEFERRED-029: read the caller's project scope attached by bearerAuth. */
function callerScopeOf(req: Request): CallerScope {
  return (req as { apiKeyScope?: CallerScope }).apiKeyScope;
}

const router = Router();

/** POST /api/jobs — enqueue a job */
router.post('/', requireProjectScope('body'), async (req, res, next) => {
  try {
    const result = await enqueueJob({ ...req.body, callerScope: callerScopeOf(req) });
    res.status(201).json(result);
  } catch (e) { next(e); }
});

/** GET /api/jobs — list jobs (supports project_ids[] for multi-project) */
router.get('/', requireProjectScope('query', { multi: true }), async (req, res, next) => {
  try {
    // Jobs list is special: project_id is optional (shows all if omitted).
    // Use resolveProjectParams only if project_id or project_ids is present.
    const hasProjectParam = req.query.project_id || req.query.project_ids;
    const p = hasProjectParam ? resolveProjectParams(req.query) : {};
    const result = await listJobs({
      ...p,
      callerScope: callerScopeOf(req),
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
    // DEFERRED-024 — a scoped api key drains only its own project's queue; auth-off /
    // global scope (apiKeyScope undefined/null) → all projects (no behavior change).
    const scope = (req as { apiKeyScope?: string | null }).apiKeyScope;
    const result = await runNextJob(req.body.queue_name, scope);
    res.json(result);
  } catch (e) { next(e); }
});

export { router as jobsRouter };
