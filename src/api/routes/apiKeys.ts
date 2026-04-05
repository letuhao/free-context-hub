import { Router } from 'express';
import { listApiKeys, createApiKey, revokeApiKey } from '../../services/apiKeys.js';

const router = Router();

/** GET /api/api-keys — list all keys (no secrets returned) */
router.get('/', async (_req, res, next) => {
  try {
    const keys = await listApiKeys();
    res.json({ keys });
  } catch (e) { next(e); }
});

/** POST /api/api-keys — generate a new key (returns full key once) */
router.post('/', async (req, res, next) => {
  try {
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
    });
    res.status(201).json({ status: 'created', key: result.key, ...result.entry });
  } catch (e) { next(e); }
});

/** DELETE /api/api-keys/:id — revoke a key */
router.delete('/:id', async (req, res, next) => {
  try {
    await revokeApiKey(req.params.id);
    res.json({ status: 'revoked', key_id: req.params.id });
  } catch (e) { next(e); }
});

export { router as apiKeysRouter };
