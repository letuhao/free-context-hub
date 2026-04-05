import { Router } from 'express';
import {
  listLessonTypes,
  createLessonType,
  updateLessonType,
  deleteLessonType,
} from '../../services/lessonTypes.js';

const router = Router();

/** GET /api/lesson-types — list all lesson types */
router.get('/', async (_req, res, next) => {
  try {
    const types = await listLessonTypes();
    res.json({ types });
  } catch (e) { next(e); }
});

/** POST /api/lesson-types — create a custom lesson type */
router.post('/', async (req, res, next) => {
  try {
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
    await deleteLessonType(req.params.key);
    res.json({ status: 'deleted', type_key: req.params.key });
  } catch (e) { next(e); }
});

export { router as lessonTypesRouter };
