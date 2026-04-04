import { Router } from 'express';
import {
  addLesson,
  listLessons,
  searchLessons,
  searchLessonsMulti,
  updateLesson,
  updateLessonStatus,
  resolveProjectIdOrThrow,
  resolveProjectIds,
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

/** POST /api/lessons/search — semantic search lessons (single or multi-project) */
router.post('/search', async (req, res, next) => {
  try {
    const { project_id, project_ids, group_id, include_groups, query, filters, limit } = req.body;

    // Priority: project_ids > group_id > project_id + include_groups > project_id alone
    let resolvedIds: string[] | null = null;

    if (Array.isArray(project_ids) && project_ids.length > 0) {
      resolvedIds = project_ids;
    } else if (group_id) {
      resolvedIds = [String(group_id)];
    } else {
      const projectId = resolveProjectIdOrThrow(project_id);
      if (include_groups) {
        resolvedIds = await resolveProjectIds(projectId, true);
      } else {
        const result = await searchLessons({ projectId, query, filters, limit });
        res.json(result);
        return;
      }
    }

    const result = await searchLessonsMulti({ projectIds: resolvedIds, query, filters, limit });
    res.json(result);
  } catch (e) { next(e); }
});

/** PUT /api/lessons/:id — update lesson title, content, tags, source_refs */
router.put('/:id', async (req, res, next) => {
  try {
    const projectId = resolveProjectIdOrThrow(req.body.project_id);
    const result = await updateLesson({
      projectId,
      lessonId: req.params.id,
      title: req.body.title,
      content: req.body.content,
      tags: req.body.tags,
      source_refs: req.body.source_refs,
      changedBy: req.body.changed_by,
      changeSummary: req.body.change_summary,
    });
    if (result.status === 'error') {
      res.status(404).json(result);
      return;
    }
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
