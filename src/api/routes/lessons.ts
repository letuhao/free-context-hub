import { Router } from 'express';
import {
  addLesson,
  batchUpdateLessonStatus,
  listLessons,
  listLessonVersions,
  searchLessons,
  searchLessonsMulti,
  updateLesson,
  updateLessonStatus,
  resolveProjectIdOrThrow,
  resolveProjectIds,
} from '../../core/index.js';
import { requireRole } from '../middleware/requireRole.js';

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
router.post('/', requireRole('writer'), async (req, res, next) => {
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

/** POST /api/lessons/:id/improve — AI-suggested improvements for lesson content */
router.post('/:id/improve', requireRole('writer'), async (req, res, next) => {
  try {
    const projectId = resolveProjectIdOrThrow(req.body.project_id);
    const { getDbPool } = await import('../../db/client.js');
    const pool = getDbPool();
    const existing = await pool.query(
      `SELECT title, content FROM lessons WHERE project_id=$1 AND lesson_id=$2`,
      [projectId, req.params.id],
    );
    if (!existing.rowCount) {
      res.status(404).json({ status: 'error', error: 'lesson not found for project' });
      return;
    }
    const lesson = existing.rows[0];
    const { improveLessonContent } = await import('../../services/lessonImprover.js');
    const result = await improveLessonContent({
      title: lesson.title,
      content: lesson.content,
      instruction: req.body.instruction,
      selectedText: req.body.selected_text,
    });
    if (result.status === 'error') {
      res.status(502).json(result);
      return;
    }
    res.json(result);
  } catch (e) { next(e); }
});

/** POST /api/lessons/:id/suggest-tags — AI-suggest tags based on lesson content */
router.post('/:id/suggest-tags', requireRole('writer'), async (req, res, next) => {
  try {
    const projectId = resolveProjectIdOrThrow(req.body.project_id);
    const { getDbPool } = await import('../../db/client.js');
    const pool = getDbPool();
    const existing = await pool.query(
      `SELECT title, content, tags FROM lessons WHERE project_id=$1 AND lesson_id=$2`,
      [projectId, req.params.id],
    );
    if (existing.rows.length === 0) {
      res.status(404).json({ status: 'error', error: 'lesson not found' });
      return;
    }
    const lesson = existing.rows[0];
    const currentTags: string[] = lesson.tags ?? [];
    const currentTagsLower = new Set(currentTags.map((t: string) => t.toLowerCase()));

    // Simple keyword extraction — extract meaningful words from title+content not already in tags
    const text = `${lesson.title} ${lesson.content}`.toLowerCase();
    const stopWords = new Set(['the', 'a', 'an', 'is', 'are', 'was', 'were', 'be', 'been', 'have', 'has', 'had',
      'do', 'does', 'did', 'will', 'would', 'could', 'should', 'may', 'might', 'can', 'shall',
      'for', 'and', 'but', 'or', 'nor', 'not', 'so', 'yet', 'both', 'either', 'neither',
      'in', 'on', 'at', 'to', 'from', 'by', 'with', 'of', 'as', 'if', 'when', 'than', 'that', 'this',
      'it', 'its', 'we', 'our', 'you', 'your', 'they', 'their', 'he', 'she', 'him', 'her',
      'all', 'each', 'every', 'some', 'any', 'no', 'more', 'most', 'other', 'such',
      'use', 'using', 'used', 'also', 'just', 'about', 'into', 'over', 'after', 'before']);
    const words = text.match(/[a-z][a-z0-9_-]{2,}/g) ?? [];
    const freq: Record<string, number> = {};
    for (const w of words) {
      if (!stopWords.has(w) && !currentTagsLower.has(w)) freq[w] = (freq[w] ?? 0) + 1;
    }
    const suggestions = Object.entries(freq)
      .sort((a, b) => b[1] - a[1])
      .slice(0, 5)
      .map(([tag]) => tag);

    res.json({ status: 'ok', suggestions, current_tags: currentTags });
  } catch (e) { next(e); }
});

/** GET /api/lessons/:id/versions — list version history for a lesson */
router.get('/:id/versions', async (req, res, next) => {
  try {
    const projectId = resolveProjectIdOrThrow(req.query.project_id as string | undefined);
    const result = await listLessonVersions({
      projectId,
      lessonId: req.params.id,
    });
    if (result.status === 'error') {
      res.status(404).json(result);
      return;
    }
    res.json(result);
  } catch (e) { next(e); }
});

/** PUT /api/lessons/:id — update lesson title, content, tags, source_refs */
router.put('/:id', requireRole('writer'), async (req, res, next) => {
  try {
    const projectId = resolveProjectIdOrThrow(req.body.project_id);
    const result = await updateLesson({
      projectId,
      lessonId: String(req.params.id),
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

/** POST /api/lessons/batch-status — bulk approve/reject/archive up to 50 lessons */
router.post('/batch-status', requireRole('writer'), async (req, res, next) => {
  try {
    const projectId = resolveProjectIdOrThrow(req.body.project_id);
    const result = await batchUpdateLessonStatus({
      projectId,
      lessonIds: req.body.lesson_ids ?? [],
      status: req.body.status,
    });
    if (result.status === 'error') {
      res.status(400).json(result);
      return;
    }
    res.json(result);
  } catch (e) { next(e); }
});

/** PATCH /api/lessons/:id/status — update lesson lifecycle status */
router.patch('/:id/status', requireRole('writer'), async (req, res, next) => {
  try {
    const projectId = resolveProjectIdOrThrow(req.body.project_id);
    const result = await updateLessonStatus({
      projectId,
      lessonId: String(req.params.id),
      status: req.body.status,
      supersededBy: req.body.superseded_by,
    });
    res.json(result);
  } catch (e) { next(e); }
});

/** GET /api/lessons/export — export lessons as JSON */
router.get('/export', async (req, res, next) => {
  try {
    const projectId = resolveProjectIdOrThrow(req.query.project_id as string | undefined);
    const { exportLessons } = await import('../../services/lessonImportExport.js');
    const result = await exportLessons({
      projectId,
      format: (req.query.format as 'json' | 'csv') ?? 'json',
      status: req.query.status as string | undefined,
    });
    if (req.query.download === 'true') {
      const filename = `lessons-${projectId}-${new Date().toISOString().slice(0, 10)}.json`;
      res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
      res.setHeader('Content-Type', 'application/json');
    }
    res.json(result);
  } catch (e) { next(e); }
});

/** POST /api/lessons/import — import lessons from JSON array */
router.post('/import', requireRole('writer'), async (req, res, next) => {
  try {
    const projectId = resolveProjectIdOrThrow(req.body.project_id);
    const { importLessons } = await import('../../services/lessonImportExport.js');
    const result = await importLessons({
      projectId,
      lessons: req.body.lessons ?? [],
      skipDuplicates: req.body.skip_duplicates,
    });
    res.json(result);
  } catch (e) { next(e); }
});

export { router as lessonsRouter };
