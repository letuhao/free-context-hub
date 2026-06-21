/**
 * Actor Data Boundary S1 — /api/grants (governance REST, admin-gated).
 *
 * The delegation edges for the governance GUI's Delegation page (the tree is built client-side from
 * the `granted_by` edges this returns). Thin REST over the existing grants service:
 *   - GET /            → listGrants (with optional filters)
 *   - POST /           → grantCapability (the delegation-invariant policy path, NOT raw createGrant)
 *   - DELETE /:id      → revokeGrantAuthorized (granter / admin / delegate over scope)
 *
 * Gate: admin@global at the route. The SERVICE layer additionally enforces the delegation invariant
 * (grantCapability: you need both `delegate` and the capability at a covering scope) and the
 * revoke policy — so even an admin can't fabricate a grant beyond their own authority via this route
 * (grantCapability also refuses entirely under auth-off; see grantCapability.ts). Mount `/api/grants`
 * AFTER bearerAuth (recorded for the integrator).
 */

import { Router } from 'express';
import { listGrants, type ScopeType, type Capability } from '../../services/grants.js';
import { grantCapability, revokeGrantAuthorized } from '../../services/grantCapability.js';
import { callerPrincipalOf } from '../middleware/auth.js';
import { assertAuthorized } from '../../services/authorize.js';

const router = Router();

/**
 * GET /api/grants — list grants. Optional query filters: grantee_principal, scope_type, scope_id,
 * granted_by, include_revoked (=`true` to include revoked edges).
 */
router.get('/', async (req, res, next) => {
  try {
    await assertAuthorized(callerPrincipalOf(req), 'admin', { kind: 'global' });
    const q = req.query;
    const grants = await listGrants({
      grantee_principal: typeof q.grantee_principal === 'string' ? q.grantee_principal : undefined,
      scope_type: typeof q.scope_type === 'string' ? (q.scope_type as ScopeType) : undefined,
      scope_id: typeof q.scope_id === 'string' ? q.scope_id : undefined,
      granted_by: typeof q.granted_by === 'string' ? q.granted_by : undefined,
      include_revoked: q.include_revoked === 'true',
    });
    res.json({ grants });
  } catch (e) { next(e); }
});

/**
 * POST /api/grants — delegate a capability. Body: { grantee_principal, scope_type, scope_id?,
 * capability }. granted_by is the AUTHENTICATED caller (never asserted in the body). Goes through
 * grantCapability so the delegation invariant is enforced — you can never grant more than you hold.
 */
router.post('/', async (req, res, next) => {
  try {
    await assertAuthorized(callerPrincipalOf(req), 'admin', { kind: 'global' });
    const { grantee_principal, scope_type, scope_id, capability } = req.body ?? {};
    if (!grantee_principal || typeof grantee_principal !== 'string') {
      res.status(400).json({ error: 'grantee_principal is required' });
      return;
    }
    const grant = await grantCapability({
      callerPrincipalId: callerPrincipalOf(req),
      grantee_principal,
      scope_type: scope_type as ScopeType,
      scope_id: typeof scope_id === 'string' ? scope_id : undefined,
      capability: capability as Capability,
    });
    res.status(201).json({ status: 'created', grant });
  } catch (e) { next(e); }
});

/** DELETE /api/grants/:id — revoke a grant (granter / admin / delegate over its scope). Idempotent. */
router.delete('/:id', async (req, res, next) => {
  try {
    await assertAuthorized(callerPrincipalOf(req), 'admin', { kind: 'global' });
    const result = await revokeGrantAuthorized({
      callerPrincipalId: callerPrincipalOf(req),
      grant_id: req.params.id,
    });
    res.json({ status: result.status, grant_id: req.params.id });
  } catch (e) { next(e); }
});

export { router as grantsRouter };
