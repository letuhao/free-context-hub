import { Router } from 'express';
import {
  listReviewRequests,
  getReviewRequest,
  approveReviewRequest,
  returnReviewRequest,
  resolveProjectIdOrThrow,
} from '../../core/index.js';
import { requireRole } from '../middleware/requireRole.js';

/**
 * Phase 13 Sprint 13.3 — Review-request REST routes.
 * Mounted at /api/projects/:id/review-requests (parent uses mergeParams).
 *
 *   GET    /                   list (filter: status, submitted_by; pagination)
 *   GET    /:reqId             detail (joined with lesson)
 *   POST   /:reqId/approve     resolve → approved + lesson → active   (writer+)
 *   POST   /:reqId/return      resolve → returned + lesson → draft    (writer+)
 *
 * Approve/return require explicit `resolved_by` (reviewer identity) in body —
 * coarse role from apiKeyRole is insufficient per r1 F1 BLOCK.
 */
const router = Router({ mergeParams: true });

router.get('/', async (req, res, next) => {
  try {
    const projectId = resolveProjectIdOrThrow(String((req.params as Record<string, string>).id ?? ''));
    const status = (req.query.status === 'approved' || req.query.status === 'returned' || req.query.status === 'pending')
      ? req.query.status as 'pending' | 'approved' | 'returned'
      : undefined;
    const submitted_by = req.query.submitted_by ? String(req.query.submitted_by) : undefined;
    const limit = req.query.limit ? Math.min(parseInt(String(req.query.limit), 10), 100) : 20;
    const offset = req.query.offset ? parseInt(String(req.query.offset), 10) : 0;
    res.json(await listReviewRequests({ project_id: projectId, status, submitted_by, limit, offset }));
  } catch (e) { next(e); }
});

router.get('/:reqId', async (req, res, next) => {
  try {
    const projectId = resolveProjectIdOrThrow(String((req.params as Record<string, string>).id ?? ''));
    const reqId = String(req.params.reqId);
    const r = await getReviewRequest({ project_id: projectId, request_id: reqId });
    if (!r) { res.status(404).json({ error: 'not found' }); return; }
    res.json(r);
  } catch (e) { next(e); }
});

router.post('/:reqId/approve', requireRole('writer'), async (req, res, next) => {
  try {
    const projectId = resolveProjectIdOrThrow(String((req.params as Record<string, string>).id ?? ''));
    const reqId = String(req.params.reqId);
    const resolvedBy = req.body?.resolved_by;
    if (typeof resolvedBy !== 'string' || resolvedBy.length === 0) {
      res.status(400).json({ error: 'resolved_by (string, the human reviewer identity) is required' });
      return;
    }
    const resolutionNote = req.body?.resolution_note;
    const result = await approveReviewRequest({
      project_id: projectId, request_id: reqId, resolved_by: resolvedBy,
      resolution_note: typeof resolutionNote === 'string' ? resolutionNote : undefined,
    });
    if (result.status === 'not_found') { res.status(404).json(result); return; }
    if (result.status === 'already_resolved') { res.status(409).json(result); return; }
    res.json(result);
  } catch (e) { next(e); }
});

router.post('/:reqId/return', requireRole('writer'), async (req, res, next) => {
  try {
    const projectId = resolveProjectIdOrThrow(String((req.params as Record<string, string>).id ?? ''));
    const reqId = String(req.params.reqId);
    const resolvedBy = req.body?.resolved_by;
    if (typeof resolvedBy !== 'string' || resolvedBy.length === 0) {
      res.status(400).json({ error: 'resolved_by (string, the human reviewer identity) is required' });
      return;
    }
    const resolutionNote = req.body?.resolution_note;
    if (typeof resolutionNote !== 'string' || resolutionNote.length === 0) {
      res.status(400).json({ error: 'resolution_note is required for return' });
      return;
    }
    const result = await returnReviewRequest({
      project_id: projectId, request_id: reqId, resolved_by: resolvedBy, resolution_note: resolutionNote,
    });
    if (result.status === 'not_found') { res.status(404).json(result); return; }
    if (result.status === 'already_resolved') { res.status(409).json(result); return; }
    res.json(result);
  } catch (e) { next(e); }
});

export const reviewRequestsRouter = router;
