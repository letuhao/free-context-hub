import { Router } from 'express';
import { listApiKeys, createApiKey, revokeApiKey } from '../../services/apiKeys.js';
import { callerPrincipalOf } from '../middleware/auth.js';
import { assertAuthorized } from '../../services/authorize.js';

const router = Router();

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
    const { name, role, project_scope, expires_at } = req.body;
    if (!name || typeof name !== 'string') {
      res.status(400).json({ error: 'name is required' });
      return;
    }
    const result = await createApiKey({
      name: name.trim(),
      role,
      project_scope: typeof project_scope === 'string' ? project_scope : undefined,
      expires_at: typeof expires_at === 'string' ? expires_at : undefined,
      // Sprint 15.11 — the minting operator's identity (apiKeyName, auth-on) for the
      // per-operator key limit. 'env-token' when minted via the env-var fast-path;
      // undefined → NULL when auth-off.
      created_by: (req as { apiKeyName?: string }).apiKeyName ?? undefined,
    });
    res.status(201).json({ status: 'created', key: result.key, ...result.entry });
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

export { router as apiKeysRouter };
