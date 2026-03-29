import { Router } from 'express';
import {
  addLesson,
  listLessons,
  searchLessons,
  updateLessonStatus,
  resolveProjectIdOrThrow,
} from '../../core/index.js';

const router = Router();

/** GET /api/lessons — list lessons with pagination, sorting, filters, text search */
router.get('/', async (req, res, next) => {
  try {
    const projectId = resolveProjectIdOrThrow(req.query.project_id as string | undefined);
    const limit = req.query.limit ? Math.min(Number(req.query.limit), 100) : 20;

    const result = await listLessons({
      projectId,
      limit,
      // Offset-based pagination (page numbers)
      offset: req.query.offset !== undefined ? Number(req.query.offset) : undefined,
      // Cursor-based pagination (legacy)
      after: req.query.after as string | undefined,
      // Sorting
      sort: req.query.sort as any,
      order: req.query.order as any,
      // Text search
      q: req.query.q as string | undefined,
      // Filters
      filters: {
        lesson_type: req.query.lesson_type as any,
        tags_any: req.query.tags_any ? (req.query.tags_any as string).split(',') : undefined,
        status: req.query.status as any,
      },
    });
    res.json(result);
  } catch (e) { next(e); }
});

/** POST /api/lessons — add a lesson */
router.post('/', async (req, res, next) => {
  try {
    const projectId = resolveProjectIdOrThrow(req.body.project_id);
    const result = await addLesson({ ...req.body, project_id: projectId });
    res.status(201).json(result);
  } catch (e) { next(e); }
});

/** POST /api/lessons/search — semantic search lessons */
router.post('/search', async (req, res, next) => {
  try {
    const projectId = resolveProjectIdOrThrow(req.body.project_id);
    const result = await searchLessons({
      projectId,
      query: req.body.query,
      filters: req.body.filters,
      limit: req.body.limit,
    });
    res.json(result);
  } catch (e) { next(e); }
});

/** PATCH /api/lessons/:id/status — update lesson lifecycle status */
router.patch('/:id/status', async (req, res, next) => {
  try {
    const projectId = resolveProjectIdOrThrow(req.body.project_id);
    const result = await updateLessonStatus({
      projectId,
      lessonId: req.params.id,
      status: req.body.status,
      supersededBy: req.body.superseded_by,
    });
    res.json(result);
  } catch (e) { next(e); }
});

export { router as lessonsRouter };
