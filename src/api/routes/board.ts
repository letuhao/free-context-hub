/**
 * Phase 15 Sprint 15.2 — The Board REST routes.
 *
 * Design ref: docs/specs/2026-05-16-phase-15-sprint-15.2-design.md §5
 *
 * One `boardRouter`, mounted `app.use('/api', boardRouter)` in src/api/index.ts
 * AFTER the `/api/topics` mount so `/topics/:id/...` board routes fall through
 * `topicsRouter` to here. Writes require the `writer` role.
 *
 * Response envelope: success → { status:'ok', data }; ContextHubError →
 * { status:'error', error, code } via the router-local error middleware (the
 * 15.1 topics.ts pattern).
 *
 * Result-`status` → HTTP: `ok`/`claimed`/`released`/`completed` → 200,
 * `task.posted` → 201; `conflict`/`claim_expired`/`no_live_claim`/
 * `already_completed`/`bad_artifact_state` → 409; `not_found` → 404;
 * `not_owner` → 403.
 */

import { Router } from 'express';
import type { Request, Response, NextFunction } from 'express';
import {
  postTask,
  listBoard,
  claimTask,
  releaseTask,
  completeTask,
  writeArtifact,
  baselineArtifact,
  ContextHubError,
} from '../../core/index.js';
import { requireRole } from '../middleware/requireRole.js';

const router = Router();

const CODE_TO_STATUS: Record<string, number> = {
  UNAUTHORIZED: 401,
  BAD_REQUEST: 400,
  NOT_FOUND: 404,
  INTERNAL: 500,
};

/**
 * Map a service result's `status` discriminant to an HTTP status code (§5).
 * The result object itself is always the response `data`.
 */
function statusToHttp(status: string): number {
  switch (status) {
    case 'not_found':
      return 404;
    case 'not_owner':
      return 403;
    case 'conflict':
    case 'claim_expired':
    case 'no_live_claim':
    case 'already_completed':
    case 'bad_artifact_state':
      return 409;
    default:
      // ok / claimed / released / completed
      return 200;
  }
}

/** Coerce a request-body value to a trimmed string (defends against non-strings). */
function asString(v: unknown): string {
  return typeof v === 'string' ? v : '';
}

// POST /api/topics/:id/tasks — post a task onto a topic's board
router.post('/topics/:id/tasks', requireRole('writer'), async (req, res, next) => {
  try {
    const body = req.body ?? {};
    const result = await postTask({
      topic_id: String(req.params.id),
      title: asString(body.title),
      topology: asString(body.topology),
      depends_on: Array.isArray(body.depends_on) ? body.depends_on : undefined,
      raci: body.raci && typeof body.raci === 'object' ? body.raci : undefined,
      slot: asString(body.slot),
      kind: asString(body.kind),
      created_by: asString(body.created_by),
    });
    res.status(201).json({ status: 'ok', data: result });
  } catch (e) { next(e); }
});

// GET /api/topics/:id/board — list a topic's board
router.get('/topics/:id/board', async (req, res, next) => {
  try {
    const statusQ = req.query.status;
    const status = typeof statusQ === 'string' && statusQ ? statusQ : undefined;
    const result = await listBoard({ topic_id: String(req.params.id), status });
    res.json({ status: 'ok', data: result });
  } catch (e) { next(e); }
});

// POST /api/tasks/:id/claim — claim a task
router.post('/tasks/:id/claim', requireRole('writer'), async (req, res, next) => {
  try {
    const body = req.body ?? {};
    const result = await claimTask({
      task_id: String(req.params.id),
      actor_id: asString(body.actor_id),
      ttl_minutes: typeof body.ttl_minutes === 'number' ? body.ttl_minutes : undefined,
    });
    res.status(statusToHttp(result.status)).json({ status: 'ok', data: result });
  } catch (e) { next(e); }
});

// POST /api/tasks/:id/release — voluntarily release a live claim
router.post('/tasks/:id/release', requireRole('writer'), async (req, res, next) => {
  try {
    const body = req.body ?? {};
    const result = await releaseTask({
      task_id: String(req.params.id),
      actor_id: asString(body.actor_id),
    });
    res.status(statusToHttp(result.status)).json({ status: 'ok', data: result });
  } catch (e) { next(e); }
});

// POST /api/tasks/:id/complete — complete a task
router.post('/tasks/:id/complete', requireRole('writer'), async (req, res, next) => {
  try {
    const body = req.body ?? {};
    const result = await completeTask({
      task_id: String(req.params.id),
      actor_id: asString(body.actor_id),
    });
    res.status(statusToHttp(result.status)).json({ status: 'ok', data: result });
  } catch (e) { next(e); }
});

// PUT /api/artifacts/:id — write a new artifact version
router.put('/artifacts/:id', requireRole('writer'), async (req, res, next) => {
  try {
    const body = req.body ?? {};
    const result = await writeArtifact({
      artifact_id: String(req.params.id),
      claim_id: asString(body.claim_id),
      fencing_token: typeof body.fencing_token === 'number' ? body.fencing_token : NaN,
      content_ref: asString(body.content_ref),
      actor_id: asString(body.actor_id),
    });
    res.status(statusToHttp(result.status)).json({ status: 'ok', data: result });
  } catch (e) { next(e); }
});

// POST /api/artifacts/:id/baseline — mark an artifact checkpoint
router.post('/artifacts/:id/baseline', requireRole('writer'), async (req, res, next) => {
  try {
    const body = req.body ?? {};
    const result = await baselineArtifact({
      artifact_id: String(req.params.id),
      claim_id: asString(body.claim_id),
      fencing_token: typeof body.fencing_token === 'number' ? body.fencing_token : NaN,
      actor_id: asString(body.actor_id),
    });
    res.status(statusToHttp(result.status)).json({ status: 'ok', data: result });
  } catch (e) { next(e); }
});

// Router-local error middleware — keeps the Phase 15 { status:'error', … }
// envelope without touching the global errorHandler.
router.use((err: unknown, _req: Request, res: Response, next: NextFunction) => {
  if (res.headersSent) { next(err); return; }
  if (err instanceof ContextHubError) {
    res.status(CODE_TO_STATUS[err.code] ?? 500).json({
      status: 'error',
      error: err.message,
      code: err.code,
    });
    return;
  }
  next(err);
});

export const boardRouter = router;
