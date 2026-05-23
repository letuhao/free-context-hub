/**
 * Phase 15 Sprint 15.4 — Collective Decision REST routes.
 *
 * Design ref: docs/specs/2026-05-18-phase-15-sprint-15.4-design.md §6
 * Spec hash:  a12f419578588e6d
 *
 * One `motionsRouter`, mounted `app.use('/api', motionsRouter)` in src/api/index.ts
 * AFTER the requests mount (same pattern as requestsRouter).
 *
 * Routes (11):
 *   POST /api/decision-bodies                  → createBody (writer)
 *   POST /api/decision-bodies/:id/members      → addBodyMember (writer)
 *   GET  /api/decision-bodies/:id              → getBody (reader)
 *   GET  /api/decision-bodies                  → listBodies (reader)
 *   POST /api/topics/:id/motions               → proposeMotion (writer)
 *   GET  /api/topics/:id/motions               → listMotions (reader)
 *   GET  /api/motions/:id                      → getMotion (reader)
 *   POST /api/motions/:id/second               → secondMotion (writer)
 *   POST /api/motions/:id/votes                → castVote (writer)
 *   POST /api/motions/:id/veto                 → vetoMotion (writer)
 *   POST /api/motions/:id/tally                → tallyMotion (writer)
 *
 * GET routes require the `reader` role from the start (AC11 — the 15.3.1 F4
 * lesson applied forward, not retrofitted). Writes require `writer`.
 *
 * Response envelope: success → { status:'ok', data }; ContextHubError →
 * { status:'error', error, code } via router-local error middleware.
 *
 * Result-`status` → HTTP (§6):
 *   created / proposed → 201
 *   ok / seconded / vote_recorded / carried / failed / lapsed / vetoed → 200
 *   conflict / already_voted / not_balloting / balloting_open /
 *     balloting_closed / topic_closed → 409
 *   body_not_found / not_member / not_participant → 422
 *   not_veto_holder / self_second_forbidden → 403
 *   not_found → 404
 *   validation throw → 400
 */

import { Router } from 'express';
import type { Request, Response, NextFunction } from 'express';
import {
  ContextHubError,
  createBody,
  addBodyMember,
  getBody,
  listBodies,
  proposeMotion,
  listMotions,
  getMotion,
  secondMotion,
  castVote,
  vetoMotion,
  tallyMotion,
  grantProxy,
  revokeProxy,
  listProxies,
} from '../../core/index.js';
import type { CallerScope } from '../../core/index.js';
import { requireRole } from '../middleware/requireRole.js';
import { requireResourceScope, requireBodyProjectScope } from '../middleware/requireResourceScope.js';

/** DEFERRED-029: read the caller's project scope attached by bearerAuth. */
function callerScopeOf(req: Request): CallerScope {
  return (req as { apiKeyScope?: CallerScope }).apiKeyScope;
}

const router = Router();

const CODE_TO_STATUS: Record<string, number> = {
  UNAUTHORIZED: 401,
  BAD_REQUEST: 400,
  NOT_FOUND: 404,
  INTERNAL: 500,
};

/** Map a service result's `status` discriminant to an HTTP status code (§6). */
function statusToHttp(status: string): number {
  switch (status) {
    case 'created':
    case 'proposed':
      return 201;
    case 'ok':
    case 'seconded':
    case 'vote_recorded':
    case 'carried':
    case 'failed':
    case 'lapsed':
    case 'vetoed':
      return 200;
    case 'conflict':
    case 'already_voted':
    case 'not_balloting':
    case 'balloting_open':
    case 'balloting_closed':
    case 'topic_closed':
      return 409;
    case 'body_not_found':
    case 'not_member':
    case 'not_participant':
    case 'principal_not_member':
      return 422;
    case 'not_veto_holder':
    case 'self_second_forbidden':
    case 'not_authorized':
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

// ── POST /api/decision-bodies — create a decision body ───────────────────────
// Sprint 15.11 (DEFERRED-017) — raised to admin: body config is a project-admin
// operation (like doa_matrix); a writer should not be able to mint a body it
// rubber-stamps its own requests with.
router.post('/decision-bodies', requireRole('admin'), requireBodyProjectScope(), async (req, res, next) => {
  try {
    const body = req.body ?? {};
    const result = await createBody({
      project_id: typeof body.project_id === 'string' ? body.project_id : undefined,
      callerScope: callerScopeOf(req),
      name: asString(body.name),
      quorum: asNumber(body.quorum),
      threshold: asNumber(body.threshold),
      veto_holders: Array.isArray(body.veto_holders) ? body.veto_holders : undefined,
      created_by: asString(body.created_by),
    });
    // createBody returns the record directly (no status discriminant) → 201.
    res.status(201).json({ status: 'ok', data: result });
  } catch (e) { next(e); }
});

// ── POST /api/decision-bodies/:id/members — add (or re-weight) a member ───────
// Sprint 15.11 (DEFERRED-017) — raised to admin (body membership is project-config).
router.post('/decision-bodies/:id/members', requireRole('admin'), requireResourceScope('body'), async (req, res, next) => {
  try {
    const body = req.body ?? {};
    const result = await addBodyMember({
      body_id: String(req.params.id),
      callerScope: callerScopeOf(req),
      actor_id: asString(body.actor_id),
      vote_weight: asNumber(body.vote_weight),
    });
    res.status(statusToHttp(result.status)).json({ status: 'ok', data: result });
  } catch (e) { next(e); }
});

// ── Sprint 15.11 (DEFERRED-017 Q3) — proxy grants ────────────────────────────
// POST /api/decision-bodies/:id/proxies — principal delegates their vote.
// requireRole('writer') outer gate; the principal-binding (granted_by===principal)
// is the real authz (service-enforced).
router.post('/decision-bodies/:id/proxies', requireRole('writer'), requireResourceScope('body'), async (req, res, next) => {
  try {
    const body = req.body ?? {};
    const result = await grantProxy({
      body_id: String(req.params.id),
      callerScope: callerScopeOf(req),
      principal: asString(body.principal),
      proxy: asString(body.proxy),
      granted_by: asString(body.granted_by),
    });
    res.status(statusToHttp(result.status)).json({ status: 'ok', data: result });
  } catch (e) { next(e); }
});

// DELETE /api/decision-bodies/:id/proxies — revoke a proxy grant.
router.delete('/decision-bodies/:id/proxies', requireRole('writer'), requireResourceScope('body'), async (req, res, next) => {
  try {
    const body = req.body ?? {};
    const result = await revokeProxy({
      body_id: String(req.params.id),
      callerScope: callerScopeOf(req),
      principal: asString(body.principal),
      proxy: asString(body.proxy),
    });
    res.status(statusToHttp(result.status)).json({ status: 'ok', data: result });
  } catch (e) { next(e); }
});

// GET /api/decision-bodies/:id/proxies — list proxy grants for a body.
router.get('/decision-bodies/:id/proxies', requireRole('reader'), requireResourceScope('body'), async (req, res, next) => {
  try {
    const result = await listProxies({ body_id: String(req.params.id), callerScope: callerScopeOf(req) });
    res.json({ status: 'ok', data: result });
  } catch (e) { next(e); }
});

// ── GET /api/decision-bodies/:id — a single body + its members ───────────────
router.get('/decision-bodies/:id', requireRole('reader'), requireResourceScope('body'), async (req, res, next) => {
  try {
    const found = await getBody({ body_id: String(req.params.id), callerScope: callerScopeOf(req) });
    if (found === null) {
      res.status(404).json({ status: 'error', error: 'decision body not found', code: 'NOT_FOUND' });
      return;
    }
    res.json({ status: 'ok', data: found });
  } catch (e) { next(e); }
});

// ── GET /api/decision-bodies — list bodies for a project ─────────────────────
router.get('/decision-bodies', requireRole('reader'), async (req, res, next) => {
  try {
    const projectQ = req.query.project_id;
    const result = await listBodies({
      project_id: typeof projectQ === 'string' && projectQ ? projectQ : undefined,
      callerScope: callerScopeOf(req),
    });
    res.json({ status: 'ok', data: result });
  } catch (e) { next(e); }
});

// ── POST /api/topics/:id/motions — propose a motion ──────────────────────────
router.post('/topics/:id/motions', requireRole('writer'), requireResourceScope('topic'), async (req, res, next) => {
  try {
    const body = req.body ?? {};
    const deadlineMinutes = body.deadline_minutes;
    const result = await proposeMotion({
      topic_id: String(req.params.id),
      callerScope: callerScopeOf(req),
      body_id: asString(body.body_id),
      subject_ref: asString(body.subject_ref),
      proposed_by: asString(body.proposed_by),
      deadline_minutes: typeof deadlineMinutes === 'number' ? deadlineMinutes : undefined,
      execution_task: body.execution_task, // Sprint 15.7 — optional chain blob
    });
    res.status(statusToHttp(result.status)).json({ status: 'ok', data: result });
  } catch (e) { next(e); }
});

// ── GET /api/topics/:id/motions — list a topic's motions ─────────────────────
router.get('/topics/:id/motions', requireRole('reader'), requireResourceScope('topic'), async (req, res, next) => {
  try {
    const statusQ = req.query.status;
    const result = await listMotions({
      topic_id: String(req.params.id),
      callerScope: callerScopeOf(req),
      status: typeof statusQ === 'string' && statusQ ? statusQ : undefined,
    });
    res.json({ status: 'ok', data: result });
  } catch (e) { next(e); }
});

// ── GET /api/motions/:id — a single motion + its votes ───────────────────────
router.get('/motions/:id', requireRole('reader'), requireResourceScope('motion'), async (req, res, next) => {
  try {
    const found = await getMotion({ motion_id: String(req.params.id), callerScope: callerScopeOf(req) });
    if (found === null) {
      res.status(404).json({ status: 'error', error: 'motion not found', code: 'NOT_FOUND' });
      return;
    }
    res.json({ status: 'ok', data: found });
  } catch (e) { next(e); }
});

// ── POST /api/motions/:id/second — second a motion ───────────────────────────
router.post('/motions/:id/second', requireRole('writer'), requireResourceScope('motion'), async (req, res, next) => {
  try {
    const body = req.body ?? {};
    const result = await secondMotion({
      motion_id: String(req.params.id),
      callerScope: callerScopeOf(req),
      actor_id: asString(body.actor_id),
    });
    res.status(statusToHttp(result.status)).json({ status: 'ok', data: result });
  } catch (e) { next(e); }
});

// ── POST /api/motions/:id/votes — cast a ballot ──────────────────────────────
router.post('/motions/:id/votes', requireRole('writer'), requireResourceScope('motion'), async (req, res, next) => {
  try {
    const body = req.body ?? {};
    const result = await castVote({
      motion_id: String(req.params.id),
      callerScope: callerScopeOf(req),
      actor_id: asString(body.actor_id),
      choice: asString(body.choice) as 'for' | 'against' | 'abstain',
      proxy_for: typeof body.proxy_for === 'string' ? body.proxy_for : undefined,
    });
    res.status(statusToHttp(result.status)).json({ status: 'ok', data: result });
  } catch (e) { next(e); }
});

// ── POST /api/motions/:id/veto — veto a motion ───────────────────────────────
router.post('/motions/:id/veto', requireRole('writer'), requireResourceScope('motion'), async (req, res, next) => {
  try {
    const body = req.body ?? {};
    const result = await vetoMotion({
      motion_id: String(req.params.id),
      callerScope: callerScopeOf(req),
      actor_id: asString(body.actor_id),
    });
    res.status(statusToHttp(result.status)).json({ status: 'ok', data: result });
  } catch (e) { next(e); }
});

// ── POST /api/motions/:id/tally — tally a motion ─────────────────────────────
router.post('/motions/:id/tally', requireRole('writer'), requireResourceScope('motion'), async (req, res, next) => {
  try {
    const result = await tallyMotion({ motion_id: String(req.params.id), callerScope: callerScopeOf(req) });
    res.status(statusToHttp(result.status)).json({ status: 'ok', data: result });
  } catch (e) { next(e); }
});

// Router-local error middleware — keeps the Phase 15 { status:'error', … }
// envelope without touching the global errorHandler (mirrors requestsRouter).
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

export const motionsRouter = router;
