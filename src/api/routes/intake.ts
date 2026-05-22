/**
 * Phase 15 Sprint 15.5 — Intake mailbox REST routes.
 *
 * Design ref: docs/specs/2026-05-18-phase-15-sprint-15.5-design.md §3
 * Spec hash:  a506ddd08a5c6dfc
 *
 * Routes (5):
 *   POST /api/intake                     → submitIntake (writer)
 *   GET  /api/intake/:id                 → getIntake (reader)
 *   POST /api/intake/:id/triage          → triageIntake (writer)
 *   POST /api/intake/:id/dismiss         → dismissIntake (writer)
 *   GET  /api/projects/:id/intake        → listIntake (reader)
 *
 * Response envelope: success → { status:'ok', data }; ContextHubError →
 * { status:'error', error, code } via router-local error middleware.
 */

import { Router } from 'express';
import type { Request, Response, NextFunction } from 'express';
import {
  ContextHubError,
  submitIntake,
  triageIntake,
  dismissIntake,
  getIntake,
  listIntake,
} from '../../core/index.js';
import { requireRole } from '../middleware/requireRole.js';
import { requireResourceScope, requireBodyProjectScope } from '../middleware/requireResourceScope.js';
import { requireScope } from '../middleware/requireScope.js';

const router = Router();

const CODE_TO_STATUS: Record<string, number> = {
  UNAUTHORIZED: 401,
  BAD_REQUEST: 400,
  NOT_FOUND: 404,
  INTAKE_ALREADY_TRIAGED: 409,
  INTAKE_ALREADY_DISMISSED: 409,
  TOPIC_NOT_ACTIVE: 409,
  INTERNAL: 500,
};

function asString(v: unknown): string {
  return typeof v === 'string' ? v : '';
}

// ── POST /api/intake — submit an intake item ─────────────────────────────────
router.post('/intake', requireRole('writer'), requireBodyProjectScope(), async (req: Request, res: Response, next: NextFunction) => {
  try {
    const body = req.body ?? {};
    const result = await submitIntake({
      project_id: asString(body.project_id),
      topic_id: typeof body.topic_id === 'string' ? body.topic_id : undefined,
      kind: asString(body.kind),
      body: asString(body.body),
      submitted_by: asString(body.submitted_by),
    });
    res.status(200).json({ status: 'ok', data: result });
  } catch (e) { next(e); }
});

// ── GET /api/intake/:id — get a single intake item ──────────────────────────
router.get('/intake/:id', requireRole('reader'), requireResourceScope('intake'), async (req: Request, res: Response, next: NextFunction) => {
  try {
    const result = await getIntake(String(req.params.id));
    res.json({ status: 'ok', data: result });
  } catch (e) { next(e); }
});

// ── POST /api/intake/:id/triage — triage an intake item ──────────────────────
router.post('/intake/:id/triage', requireRole('writer'), requireResourceScope('intake'), async (req: Request, res: Response, next: NextFunction) => {
  try {
    const body = req.body ?? {};
    const routeKind = asString(body.route_kind);
    const actorId = asString(body.actor_id);
    const topicId = asString(body.topic_id);

    let route;
    if (routeKind === 'dispute') {
      route = {
        route_kind: 'dispute' as const,
        actor_id: actorId,
        topic_id: topicId,
        subject_ref: asString(body.subject_ref),
        parties: Array.isArray(body.parties)
          ? body.parties.filter((p: unknown): p is string => typeof p === 'string')
          : [],
        procedure: asString(body.procedure) as 'unilateral' | 'collective',
        submitted_by: asString(body.submitted_by),
        kind: typeof body.kind === 'string' ? body.kind : undefined,
        weight: typeof body.weight === 'number' ? body.weight : undefined,
      };
    } else if (routeKind === 'task' || routeKind === 'request' || routeKind === 'motion') {
      route = {
        route_kind: routeKind as 'task' | 'request' | 'motion',
        actor_id: actorId,
        topic_id: topicId,
        routed_to: asString(body.routed_to),
      };
    } else {
      throw new ContextHubError('BAD_REQUEST', `route_kind must be one of: task, request, motion, dispute; got: ${routeKind}`);
    }

    const result = await triageIntake(String(req.params.id), route);
    res.status(200).json({ status: 'ok', data: result });
  } catch (e) { next(e); }
});

// ── POST /api/intake/:id/dismiss — dismiss an intake item ────────────────────
router.post('/intake/:id/dismiss', requireRole('writer'), requireResourceScope('intake'), async (req: Request, res: Response, next: NextFunction) => {
  try {
    const result = await dismissIntake(String(req.params.id));
    res.status(200).json({ status: 'ok', data: result });
  } catch (e) { next(e); }
});

// ── GET /api/projects/:id/intake — list intake items for a project ────────────
router.get('/projects/:id/intake', requireRole('reader'), requireScope('id'), async (req: Request, res: Response, next: NextFunction) => {
  try {
    const projectId = String(req.params.id);
    const kind = typeof req.query.kind === 'string' ? req.query.kind : undefined;
    const status = typeof req.query.status === 'string' ? req.query.status : undefined;
    const limit = typeof req.query.limit === 'string' ? parseInt(req.query.limit, 10) : undefined;
    const offset = typeof req.query.offset === 'string' ? parseInt(req.query.offset, 10) : undefined;

    const result = await listIntake(projectId, { kind, status, limit, offset });
    res.json({ status: 'ok', data: result });
  } catch (e) { next(e); }
});

// Router-local error middleware
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

export const intakeRouter = router;
