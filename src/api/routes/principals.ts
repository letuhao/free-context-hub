/**
 * Actor Data Boundary S1 — /api/principals (governance REST, admin-gated).
 *
 * The identity directory for the governance GUI's Identity page. Thin REST over the existing
 * principals service (services/principals.ts) + a join to the credentials (api_keys) and grants
 * that bind/empower each principal for the slide-over.
 *
 * Gate: every route requires admin@global via assertAuthorized (the same explicit gate apiKeys.ts
 * uses). Under auth-OFF assertAuthorized no-ops → dev posture unchanged. Mount: `/api/principals`
 * AFTER the bearerAuth blanket gate (recorded for the integrator in the warp brief).
 */

import { Router } from 'express';
import {
  listPrincipals,
  getPrincipal,
  createPrincipal,
  setPrincipalStatus,
  type PrincipalKind,
  type PrincipalStatus,
} from '../../services/principals.js';
import { listApiKeys } from '../../services/apiKeys.js';
import { listGrants } from '../../services/grants.js';
import { callerPrincipalOf } from '../middleware/auth.js';
import { assertAuthorized } from '../../services/authorize.js';
import { ContextHubError } from '../../core/errors.js';

const router = Router();

/** GET /api/principals — list every principal (newest first). */
router.get('/', async (req, res, next) => {
  try {
    await assertAuthorized(callerPrincipalOf(req), 'admin', { kind: 'global' });
    const principals = await listPrincipals();
    res.json({ principals });
  } catch (e) { next(e); }
});

/**
 * GET /api/principals/:id — one principal + its bound credentials (api_keys, no secrets) + the
 * grants it holds. Powers the Identity slide-over (bound credentials [G7] + grants + status).
 */
router.get('/:id', async (req, res, next) => {
  try {
    await assertAuthorized(callerPrincipalOf(req), 'admin', { kind: 'global' });
    const principal = await getPrincipal(req.params.id);
    if (!principal) {
      throw new ContextHubError('NOT_FOUND', 'Principal not found.');
    }
    // listApiKeys returns ALL keys (no secrets); filter to this principal's bound credentials.
    const allKeys = await listApiKeys();
    const credentials = allKeys.filter((k) => k.principal_id === principal.principal_id);
    const grants = await listGrants({ grantee_principal: principal.principal_id });
    res.json({ principal, credentials, grants });
  } catch (e) { next(e); }
});

/** POST /api/principals — create a non-root principal. Body: { kind, display_name, status? }. */
router.post('/', async (req, res, next) => {
  try {
    await assertAuthorized(callerPrincipalOf(req), 'admin', { kind: 'global' });
    const { kind, display_name, status } = req.body ?? {};
    if (!display_name || typeof display_name !== 'string') {
      res.status(400).json({ error: 'display_name is required' });
      return;
    }
    const principal = await createPrincipal({
      kind: kind as PrincipalKind,
      display_name,
      status: status as PrincipalStatus | undefined,
    });
    res.status(201).json({ status: 'created', principal });
  } catch (e) { next(e); }
});

/** PATCH /api/principals/:id/status — transition status (active|suspended|retired). */
router.patch('/:id/status', async (req, res, next) => {
  try {
    await assertAuthorized(callerPrincipalOf(req), 'admin', { kind: 'global' });
    const { status } = req.body ?? {};
    if (!status || typeof status !== 'string') {
      res.status(400).json({ error: 'status is required' });
      return;
    }
    const principal = await setPrincipalStatus(req.params.id, status as PrincipalStatus);
    res.json({ status: 'updated', principal });
  } catch (e) { next(e); }
});

export { router as principalsRouter };
