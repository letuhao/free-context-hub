/**
 * Phase 15 Sprint 15.3 — Request-Approval REST routes.
 *
 * Design ref: docs/specs/2026-05-17-phase-15-sprint-15.3-design.md §5
 * Spec hash:  6f79057f9e42e4fc
 *
 * One `requestsRouter`, mounted `app.use('/api', requestsRouter)` in
 * src/api/index.ts AFTER the board mount (same pattern as boardRouter).
 *
 * Routes:
 *   POST /api/topics/:id/requests    → submitRequest (writer)
 *   GET  /api/topics/:id/requests    → listRequests
 *   GET  /api/requests/:id           → getRequest
 *   POST /api/requests/:id/steps/:n/decide → decideStep (writer)
 *
 * Response envelope: success → { status:'ok', data }; ContextHubError →
 * { status:'error', error, code } via router-local error middleware.
 *
 * Result-`status` → HTTP (§5):
 *   submitted → 201
 *   step_endorsed / approved / returned / rejected / ok → 200
 *   conflict / already_resolved / not_current_step / topic_closed → 409
 *   no_route / not_participant → 422
 *   not_authorized / self_decision_forbidden → 403
 *   not_found → 404
 *   validation throw → 400
 */

import { Router } from 'express';
import type { Request, Response, NextFunction } from 'express';
import {
  ContextHubError,
  submitRequest,
  listRequests,
  getRequest,
  decideStep,
} from '../../core/index.js';
import { requireRole } from '../middleware/requireRole.js';

const router = Router();

const CODE_TO_STATUS: Record<string, number> = {
  UNAUTHORIZED: 401,
  BAD_REQUEST: 400,
  NOT_FOUND: 404,
  INTERNAL: 500,
};

/** Map a service result's `status` discriminant to an HTTP status code (§5). */
function statusToHttp(status: string): number {
  switch (status) {
    case 'submitted':
      return 201;
    case 'step_endorsed':
    case 'approved':
    case 'returned':
    case 'rejected':
    case 'ok':
      return 200;
    case 'conflict':
    case 'already_resolved':
    case 'not_current_step':
    case 'topic_closed':
      return 409;
    case 'no_route':
    case 'not_participant':
      return 422;
    case 'not_authorized':
    case 'self_decision_forbidden':
      return 403;
    case 'not_found':
      return 404;
    default:
      return 200;
  }
}

function asString(v: unknown): string {
  return typeof v === 'string' ? v : '';
}

function asNumber(v: unknown): number {
  return typeof v === 'number' ? v : NaN;
}

// POST /api/topics/:id/requests — submit a new approval request
router.post('/topics/:id/requests', requireRole('writer'), async (req, res, next) => {
  try {
    const body = req.body ?? {};
    const result = await submitRequest({
      topic_id: String(req.params.id),
      subject_type: 'artifact',       // fixed in 15.3 (D7)
      subject_id: asString(body.subject_id),
      kind: asString(body.kind),
      weight: asNumber(body.weight),
      procedure: asString(body.procedure) || 'unilateral',
      submitted_by: asString(body.submitted_by),
    });
    res.status(statusToHttp(result.status)).json({ status: 'ok', data: result });
  } catch (e) { next(e); }
});

// GET /api/topics/:id/requests — list requests for a topic
router.get('/topics/:id/requests', async (req, res, next) => {
  try {
    const statusQ = req.query.status;
    const statusFilter = typeof statusQ === 'string' && statusQ ? statusQ : undefined;
    const result = await listRequests({
      topic_id: String(req.params.id),
      status: statusFilter,
    });
    res.json({ status: 'ok', data: result });
  } catch (e) { next(e); }
});

// GET /api/requests/:id — get a single request + its steps
router.get('/requests/:id', async (req, res, next) => {
  try {
    const req2 = await getRequest({ request_id: String(req.params.id) });
    if (req2 === null) {
      res.status(404).json({ status: 'error', error: 'request not found', code: 'NOT_FOUND' });
      return;
    }
    res.json({ status: 'ok', data: req2 });
  } catch (e) { next(e); }
});

// POST /api/requests/:id/steps/:n/decide — decide a step
router.post('/requests/:id/steps/:n/decide', requireRole('writer'), async (req, res, next) => {
  try {
    const body = req.body ?? {};
    const stepIndex = parseInt(String(req.params.n), 10);
    if (isNaN(stepIndex)) {
      res.status(400).json({ status: 'error', error: 'step index must be a number', code: 'BAD_REQUEST' });
      return;
    }
    const result = await decideStep({
      request_id: String(req.params.id),
      step_index: stepIndex,
      actor_id: asString(body.actor_id),
      decision: asString(body.decision),
    });
    res.status(statusToHttp(result.status)).json({ status: 'ok', data: result });
  } catch (e) { next(e); }
});

// Router-local error middleware — keeps the Phase 15 { status:'error', … }
// envelope without touching the global errorHandler (mirrors boardRouter).
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

export const requestsRouter = router;
