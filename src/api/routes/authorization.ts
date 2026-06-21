/**
 * Actor Data Boundary S1 — /api/authz (governance REST, admin-gated). **safety-sensitive.**
 *
 *   - GET  /api/authz/decisions  → the NET-NEW decision-log read (services/authzDecisions.ts):
 *       paginated/filtered/windowed rows the agent half wrote to authz_decisions, PLUS aggregate
 *       stats for the Authorization page stat cards. This exposes who-tried-what, so it is admin@global
 *       gated and bounded (limit ≤ MAX_LIMIT).
 *   - POST /api/authz/explain    → read-only "why" (services/authorize.ts:explainAuthorization). The
 *       admin asks "would principal P be allowed to ACTION resource R?" — never logs, never mutates.
 *
 * Mount `/api/authz` AFTER bearerAuth (recorded for the integrator).
 */

import { Router } from 'express';
import {
  listAuthzDecisions,
  getAuthzDecisionStats,
  type AuthzAction,
  type AuthzOrigin,
} from '../../services/authzDecisions.js';
import { explainAuthorization, type Action, type ResourceRef } from '../../services/authorize.js';
import { callerPrincipalOf } from '../middleware/auth.js';
import { assertAuthorized } from '../../services/authorize.js';

const router = Router();

/**
 * GET /api/authz/decisions — windowed decision log + aggregate stats.
 * Query: principal_id, action, allow (=`true`/`false`), origin, since, until, limit, cursor.
 * Response: { decisions, next_cursor, stats }. Stats describe the SAME filter window (no pagination).
 */
router.get('/decisions', async (req, res, next) => {
  try {
    await assertAuthorized(callerPrincipalOf(req), 'admin', { kind: 'global' });
    const q = req.query;

    const filter = {
      principal_id: typeof q.principal_id === 'string' ? q.principal_id : undefined,
      action: typeof q.action === 'string' ? (q.action as AuthzAction) : undefined,
      // allow is a tri-state: only constrain when explicitly 'true' or 'false'.
      allow: q.allow === 'true' ? true : q.allow === 'false' ? false : undefined,
      origin: typeof q.origin === 'string' ? (q.origin as AuthzOrigin) : undefined,
      since: typeof q.since === 'string' ? q.since : undefined,
      until: typeof q.until === 'string' ? q.until : undefined,
    };
    const limit = typeof q.limit === 'string' ? Number(q.limit) : undefined;
    const cursor = typeof q.cursor === 'string' ? q.cursor : undefined;

    const page = await listAuthzDecisions({ ...filter, limit, cursor });
    const stats = await getAuthzDecisionStats(filter);
    res.json({ decisions: page.decisions, next_cursor: page.next_cursor, stats });
  } catch (e) { next(e); }
});

/**
 * POST /api/authz/explain — "would this principal be allowed?". Body:
 * { principal_id, action, resource: { kind, id? } }. Returns { decision, scope_chain } from
 * explainAuthorization (which nulls scope_chain on a deny so explain is not an existence oracle).
 */
router.post('/explain', async (req, res, next) => {
  try {
    await assertAuthorized(callerPrincipalOf(req), 'admin', { kind: 'global' });
    const { principal_id, action, resource } = req.body ?? {};
    if (typeof action !== 'string') {
      res.status(400).json({ error: 'action is required' });
      return;
    }
    if (!resource || typeof resource !== 'object' || typeof (resource as { kind?: unknown }).kind !== 'string') {
      res.status(400).json({ error: 'resource.kind is required' });
      return;
    }
    const ref: ResourceRef = {
      kind: (resource as ResourceRef).kind,
      id: typeof (resource as ResourceRef).id === 'string' ? (resource as ResourceRef).id : undefined,
    };
    const result = await explainAuthorization(
      typeof principal_id === 'string' ? principal_id : null,
      action as Action,
      ref,
    );
    res.json(result);
  } catch (e) { next(e); }
});

export { router as authorizationRouter };
