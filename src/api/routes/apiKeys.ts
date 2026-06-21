import { Router } from 'express';
import {
  listApiKeys,
  createApiKey,
  revokeApiKey,
  reviewApiKeys,
  rotateApiKey,
  createEphemeralApiKey,
} from '../../services/apiKeys.js';
import { callerPrincipalOf } from '../middleware/auth.js';
import { assertAuthorized } from '../../services/authorize.js';

const router = Router();
const reviewRouter = Router();

// [Domain 8] API-key management = minting/listing/revoking IDENTITIES — the most privileged global
// operation. It was guarded only by the `requireRole('admin')` MOUNT in api/index.ts (no service authz at
// all). Replace that with an explicit admin@global gate on every route so removing the mount can't open the
// identity surface. auth-OFF → no-op (dev unchanged).

/** GET /api/api-keys — list all keys (no secrets returned) */
router.get('/', async (req, res, next) => {
  try {
    await assertAuthorized(callerPrincipalOf(req), 'admin', { kind: 'global' });
    const keys = await listApiKeys();
    res.json({ keys });
  } catch (e) { next(e); }
});

/** POST /api/api-keys — generate a new key (returns full key once) */
router.post('/', async (req, res, next) => {
  try {
    await assertAuthorized(callerPrincipalOf(req), 'admin', { kind: 'global' });
    const { name, role, project_scope, expires_at, principal_id } = req.body;
    if (!name || typeof name !== 'string') {
      res.status(400).json({ error: 'name is required' });
      return;
    }
    const result = await createApiKey({
      name: name.trim(),
      role,
      project_scope: typeof project_scope === 'string' ? project_scope : undefined,
      expires_at: typeof expires_at === 'string' ? expires_at : undefined,
      // S5 (§2.5 / F2) — bind the credential to a principal at mint time. The
      // createApiKey SERVICE already validates principal_id (apiKeys.ts:50:
      // exists / active / non-root); the ROUTE was dropping it. Pass it through
      // so the access-page principal binding is live-correct. undefined → NULL
      // (legacy/ownerless key), preserving back-compat.
      principal_id: typeof principal_id === 'string' ? principal_id : undefined,
      // Sprint 15.11 — the minting operator's identity (apiKeyName, auth-on) for the
      // per-operator key limit. 'env-token' when minted via the env-var fast-path;
      // undefined → NULL when auth-off.
      created_by: (req as { apiKeyName?: string }).apiKeyName ?? undefined,
    });
    res.status(201).json({ status: 'created', key: result.key, ...result.entry });
  } catch (e) { next(e); }
});

/**
 * POST /api/api-keys/ephemeral — mint a short-TTL, principal-bound credential
 * for CI / one-shot agents. Returns the full key once + its effective expiry.
 * `ttl_ms` defaults to 1h, capped at 24h (createEphemeralApiKey enforces).
 */
router.post('/ephemeral', async (req, res, next) => {
  try {
    await assertAuthorized(callerPrincipalOf(req), 'admin', { kind: 'global' });
    const { name, role, project_scope, principal_id, ttl_ms } = req.body;
    if (!name || typeof name !== 'string') {
      res.status(400).json({ error: 'name is required' });
      return;
    }
    const result = await createEphemeralApiKey({
      name: name.trim(),
      role,
      project_scope: typeof project_scope === 'string' ? project_scope : undefined,
      principal_id: typeof principal_id === 'string' ? principal_id : undefined,
      ttlMs: typeof ttl_ms === 'number' ? ttl_ms : undefined,
      created_by: (req as { apiKeyName?: string }).apiKeyName ?? undefined,
    });
    res.status(201).json({
      status: 'created',
      key: result.key,
      ...result.entry,
      // explicit effective expiry (also present on entry; pinned for the client)
      expires_at: result.expires_at,
    });
  } catch (e) { next(e); }
});

/**
 * POST /api/api-keys/:id/rotate — mint a successor bound to the same principal /
 * role / scope; the old key auto-expires after `overlap_ms` (default 7d, 0 =
 * revoke now). Returns the successor key once + the previous key id + the old
 * key's new expiry.
 */
router.post('/:id/rotate', async (req, res, next) => {
  try {
    await assertAuthorized(callerPrincipalOf(req), 'admin', { kind: 'global' });
    const { overlap_ms } = req.body ?? {};
    const result = await rotateApiKey(req.params.id, {
      overlapMs: typeof overlap_ms === 'number' ? overlap_ms : undefined,
    });
    res.status(201).json({
      status: 'rotated',
      key: result.key,
      previous_key_id: result.previous_key_id,
      old_expires_at: result.old_expires_at,
      ...result.entry,
    });
  } catch (e) { next(e); }
});

/** DELETE /api/api-keys/:id — revoke a key */
router.delete('/:id', async (req, res, next) => {
  try {
    await assertAuthorized(callerPrincipalOf(req), 'admin', { kind: 'global' });
    await revokeApiKey(req.params.id);
    res.json({ status: 'revoked', key_id: req.params.id });
  } catch (e) { next(e); }
});

/**
 * GET /api/access-review — log-based NHI access review. Lists every ACTIVE key
 * annotated with age / last-used / staleness flags, plus the stat-card counts
 * (total / unused-≥90d / never-expires / ownerless). admin@global gated.
 *
 * Mounted SEPARATELY at /api/access-review (recorded for the integrator, §2.1):
 *   app.use('/api/access-review', requireRole('admin'), accessReviewRouter);
 */
reviewRouter.get('/', async (req, res, next) => {
  try {
    await assertAuthorized(callerPrincipalOf(req), 'admin', { kind: 'global' });
    const result = await reviewApiKeys();
    res.json(result);
  } catch (e) { next(e); }
});

export { router as apiKeysRouter, reviewRouter as accessReviewRouter };
