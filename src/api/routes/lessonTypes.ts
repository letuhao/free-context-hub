import { Router } from 'express';
import {
  listLessonTypes,
  createLessonType,
  updateLessonType,
  deleteLessonType,
} from '../../services/lessonTypes.js';
import { callerPrincipalOf } from '../middleware/auth.js';
import { assertAuthorized } from '../../services/authorize.js';

const router = Router();

// [Domain 8] Lesson types are GLOBAL config (labels/templates), previously behind requireRole('admin') at
// the mount with no service authz. Replace with: mutations = admin@global (global config change); the LIST
// stays an open catalog — type labels are non-sensitive and the GUI needs them broadly for every writer
// (mirrors the listGroups open-catalog decision, DEFERRED-049). This LOOSENS list from the old admin mount;
// flagged at POST-REVIEW. auth-OFF → no-op.

/** GET /api/lesson-types — list all lesson types (open global catalog) */
router.get('/', async (_req, res, next) => {
  try {
    const types = await listLessonTypes();
    res.json({ types });
  } catch (e) { next(e); }
});

/** POST /api/lesson-types — create a custom lesson type */
router.post('/', async (req, res, next) => {
  try {
    await assertAuthorized(callerPrincipalOf(req), 'admin', { kind: 'global' });
    const { type_key, display_name, description, color, template } = req.body;
    if (!type_key || typeof type_key !== 'string') {
      res.status(400).json({ error: 'type_key is required' });
      return;
    }
    if (!display_name || typeof display_name !== 'string') {
      res.status(400).json({ error: 'display_name is required' });
      return;
    }
    const result = await createLessonType({
      type_key: type_key.trim(),
      display_name: display_name.trim(),
      description: typeof description === 'string' ? description.trim() : undefined,
      color,
      template: typeof template === 'string' ? template : undefined,
    });
    res.status(201).json({ status: 'created', ...result });
  } catch (e) { next(e); }
});

/** PUT /api/lesson-types/:key — update a lesson type */
router.put('/:key', async (req, res, next) => {
  try {
    await assertAuthorized(callerPrincipalOf(req), 'admin', { kind: 'global' });
    const { display_name, description, color, template } = req.body;
    const result = await updateLessonType(req.params.key, {
      display_name: typeof display_name === 'string' ? display_name.trim() : undefined,
      description: typeof description === 'string' ? description.trim() : undefined,
      color,
      template: typeof template === 'string' ? template : undefined,
    });
    res.json({ status: 'updated', ...result });
  } catch (e) { next(e); }
});

/** DELETE /api/lesson-types/:key — delete a custom lesson type */
router.delete('/:key', async (req, res, next) => {
  try {
    await assertAuthorized(callerPrincipalOf(req), 'admin', { kind: 'global' });
    await deleteLessonType(req.params.key);
    res.json({ status: 'deleted', type_key: req.params.key });
  } catch (e) { next(e); }
});

export { router as lessonTypesRouter };
