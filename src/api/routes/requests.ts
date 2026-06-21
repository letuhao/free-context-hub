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
 *   GET  /api/topics/:id/requests    → listRequests (reader)
 *   GET  /api/requests/:id           → getRequest (reader)
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
import { callerPrincipalOf } from '../middleware/auth.js';

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
    case 'repeat_endorser':
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

/**
 * F1 (Sprint 15.3.1) — resolve the acting coordination identity.
 *
 * A DB-keyed caller (`req.apiKeyName` set by bearerAuth) acts as its own key: a body
 * value naming a different actor is rejected. The env-token admin and the auth-disabled
 * dev posture carry no `apiKeyName` — there the body value stands (DESIGN §0.5).
 *
 * Precondition: F1's DB-key guarantee assumes the caller already passed the
 * `requireRole('writer')` gate on the two POST routes — `bearerAuth` attaches
 * `apiKeyName` for every valid key including `reader` keys; the writer gate (unchanged
 * by 15.3.1) is what keeps a `reader` key out of submit/decide.
 */
function resolveActorIdentity(
  req: Request,
  bodyValue: string,
): { ok: true; actor: string } | { ok: false } {
  const authedName = (req as Request & { apiKeyName?: string }).apiKeyName;
  if (typeof authedName === 'string' && authedName.length > 0) {
    if (bodyValue && bodyValue !== authedName) return { ok: false };
    return { ok: true, actor: authedName };
  }
  return { ok: true, actor: bodyValue };
}

// POST /api/topics/:id/requests — submit a new approval request
router.post('/topics/:id/requests', async (req, res, next) => {
  try {
    const body = req.body ?? {};
    // F1 — bind submitted_by to the authenticated key (Sprint 15.3.1)
    const id = resolveActorIdentity(req, asString(body.submitted_by));
    if (!id.ok) {
      res.status(403).json({
        status: 'error',
        error: 'submitted_by does not match the authenticated key',
        code: 'IDENTITY_MISMATCH',
      });
      return;
    }
    const result = await submitRequest({
      topic_id: String(req.params.id),
      actingPrincipalId: callerPrincipalOf(req),
      subject_type: 'artifact',       // fixed in 15.3 (D7)
      subject_id: asString(body.subject_id),
      kind: asString(body.kind),
      weight: asNumber(body.weight),
      procedure: asString(body.procedure) || 'unilateral',
      submitted_by: id.actor,
      execution_task: body.execution_task, // Sprint 15.7 — optional chain blob
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
      actingPrincipalId: callerPrincipalOf(req),
      status: statusFilter,
    });
    res.json({ status: 'ok', data: result });
  } catch (e) { next(e); }
});

// GET /api/requests/:id — get a single request + its steps
router.get('/requests/:id', async (req, res, next) => {
  try {
    const req2 = await getRequest({ request_id: String(req.params.id), actingPrincipalId: callerPrincipalOf(req) });
    if (req2 === null) {
      res.status(404).json({ status: 'error', error: 'request not found', code: 'NOT_FOUND' });
      return;
    }
    res.json({ status: 'ok', data: req2 });
  } catch (e) { next(e); }
});

// POST /api/requests/:id/steps/:n/decide — decide a step
router.post('/requests/:id/steps/:n/decide', async (req, res, next) => {
  try {
    const body = req.body ?? {};
    // Sprint 15.6 §3.3 — /^\d+$/ rejects fractional/negative strings before parseInt
    const rawN = String(req.params.n);
    if (!/^\d+$/.test(rawN)) {
      res.status(400).json({ status: 'error', error: 'step index must be a non-negative integer', code: 'BAD_REQUEST' });
      return;
    }
    const stepIndex = parseInt(rawN, 10);
    // F1 — bind actor_id to the authenticated key (Sprint 15.3.1)
    const id = resolveActorIdentity(req, asString(body.actor_id));
    if (!id.ok) {
      res.status(403).json({
        status: 'error',
        error: 'actor_id does not match the authenticated key',
        code: 'IDENTITY_MISMATCH',
      });
      return;
    }
    const result = await decideStep({
      request_id: String(req.params.id),
      actingPrincipalId: callerPrincipalOf(req),
      step_index: stepIndex,
      actor_id: id.actor,
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
