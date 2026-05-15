import { Router, type Request } from 'express';
import {
  listReviewRequests,
  getReviewRequest,
  approveReviewRequest,
  returnReviewRequest,
  resolveProjectIdOrThrow,
  getEnv,
} from '../../core/index.js';
import { requireRole } from '../middleware/requireRole.js';

/**
 * Phase 13 Sprint 13.3 — Review-request REST routes.
 * Mounted at /api/projects/:id/review-requests (parent uses mergeParams).
 *
 *   GET    /                   list (filter: status, submitted_by; pagination)
 *   GET    /:reqId             detail — joined with the full lesson (for review)
 *   POST   /:reqId/approve     resolve → approved + lesson → active   (admin)
 *   POST   /:reqId/return      resolve → returned + lesson → draft    (admin)
 *
 * Phase 13 bug-fix SS3 (BUG-13.3-1): approve/return require the `admin` role —
 * F2 is a human-review gate and agents hold writer keys, so writer must not be
 * able to self-approve. `resolved_by` is derived server-side from the
 * authenticated API key (its name), never read from the request body, so the
 * audit trail records a real, unforgeable reviewer identity.
 */
const router = Router({ mergeParams: true });

/** Reviewer identity for the audit trail — derived from the authenticated key. */
function reviewerIdentity(req: Request): string {
  const r = req as Request & { apiKeyName?: string };
  if (typeof r.apiKeyName === 'string' && r.apiKeyName.length > 0) return r.apiKeyName;
  // No DB-backed key: env-var admin token, or auth disabled (dev). Neither
  // carries a per-user identity — label the path honestly.
  return getEnv().MCP_AUTH_ENABLED ? 'env-admin' : 'dev-mode-admin';
}

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

router.post('/:reqId/approve', requireRole('admin'), async (req, res, next) => {
  try {
    const projectId = resolveProjectIdOrThrow(String((req.params as Record<string, string>).id ?? ''));
    const reqId = String(req.params.reqId);
    const resolutionNote = req.body?.resolution_note;
    const result = await approveReviewRequest({
      project_id: projectId, request_id: reqId, resolved_by: reviewerIdentity(req),
      resolution_note: typeof resolutionNote === 'string' ? resolutionNote : undefined,
    });
    if (result.status === 'not_found') { res.status(404).json(result); return; }
    if (result.status === 'already_resolved') { res.status(409).json(result); return; }
    res.json(result);
  } catch (e) { next(e); }
});

router.post('/:reqId/return', requireRole('admin'), async (req, res, next) => {
  try {
    const projectId = resolveProjectIdOrThrow(String((req.params as Record<string, string>).id ?? ''));
    const reqId = String(req.params.reqId);
    const resolutionNote = req.body?.resolution_note;
    if (typeof resolutionNote !== 'string' || resolutionNote.length === 0) {
      res.status(400).json({ error: 'resolution_note is required for return' });
      return;
    }
    const result = await returnReviewRequest({
      project_id: projectId, request_id: reqId, resolved_by: reviewerIdentity(req), resolution_note: resolutionNote,
    });
    if (result.status === 'not_found') { res.status(404).json(result); return; }
    if (result.status === 'already_resolved') { res.status(409).json(result); return; }
    res.json(result);
  } catch (e) { next(e); }
});

export const reviewRequestsRouter = router;
