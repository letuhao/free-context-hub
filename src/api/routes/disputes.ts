/**
 * Phase 15 Sprint 15.5 — Dispute resolution REST routes.
 *
 * Design ref: docs/specs/2026-05-18-phase-15-sprint-15.5-design.md §3
 * Spec hash:  a506ddd08a5c6dfc
 *
 * Routes (4):
 *   POST /api/disputes               → openDispute (writer)
 *   GET  /api/disputes/:id           → getDispute (reader)
 *   POST /api/disputes/:id/resolve   → resolveDispute (writer)
 *   GET  /api/topics/:id/disputes    → listDisputes (reader)
 *
 * Response envelope: success → { status:'ok', data }; ContextHubError →
 * { status:'error', error, code } via router-local error middleware.
 */

import { Router } from 'express';
import type { Request, Response, NextFunction } from 'express';
import {
  ContextHubError,
  openDispute,
  getDispute,
  resolveDispute,
  listDisputes,
} from '../../core/index.js';
import { requireRole } from '../middleware/requireRole.js';

const router = Router();

const CODE_TO_STATUS: Record<string, number> = {
  UNAUTHORIZED: 401,
  BAD_REQUEST: 400,
  NOT_FOUND: 404,
  ALREADY_RESOLVED: 409,
  RESOLUTION_PENDING: 409,
  TOPIC_NOT_ACTIVE: 409,
  INTERNAL: 500,
};

function asString(v: unknown): string {
  return typeof v === 'string' ? v : '';
}

// ── POST /api/disputes — open a dispute ──────────────────────────────────────
router.post('/disputes', requireRole('writer'), async (req: Request, res: Response, next: NextFunction) => {
  try {
    const body = req.body ?? {};
    const result = await openDispute({
      topic_id: asString(body.topic_id),
      subject_ref: asString(body.subject_ref),
      parties: Array.isArray(body.parties) ? body.parties as string[] : [],
      procedure: asString(body.procedure) as 'unilateral' | 'collective',
      submitted_by: asString(body.submitted_by),
      kind: typeof body.kind === 'string' ? body.kind : undefined,
      weight: typeof body.weight === 'number' ? body.weight : undefined,
    });
    res.status(200).json({ status: 'ok', data: result });
  } catch (e) { next(e); }
});

// ── GET /api/disputes/:id — get a single dispute + resolution request ─────────
router.get('/disputes/:id', requireRole('reader'), async (req: Request, res: Response, next: NextFunction) => {
  try {
    const result = await getDispute(String(req.params.id));
    res.json({ status: 'ok', data: result });
  } catch (e) { next(e); }
});

// ── POST /api/disputes/:id/resolve — resolve a dispute ───────────────────────
router.post('/disputes/:id/resolve', requireRole('writer'), async (req: Request, res: Response, next: NextFunction) => {
  try {
    const result = await resolveDispute(String(req.params.id));
    res.status(200).json({ status: 'ok', data: result });
  } catch (e) { next(e); }
});

// ── GET /api/topics/:id/disputes — list disputes for a topic ─────────────────
router.get('/topics/:id/disputes', requireRole('reader'), async (req: Request, res: Response, next: NextFunction) => {
  try {
    const topicId = String(req.params.id);
    const status = typeof req.query.status === 'string' ? req.query.status : undefined;
    const limit = typeof req.query.limit === 'string' ? parseInt(req.query.limit, 10) : undefined;
    const offset = typeof req.query.offset === 'string' ? parseInt(req.query.offset, 10) : undefined;

    const result = await listDisputes(topicId, { status, limit, offset });
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

export const disputesRouter = router;
