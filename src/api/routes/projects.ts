import { Router } from 'express';
import {
  getProjectSnapshotBody,
  indexProject,
  reflectOnTopic,
  deleteWorkspace,
  resolveProjectIdOrThrow,
  resolveProjectRoot,
  listAllProjects,
} from '../../core/index.js';

const router = Router();

/** GET /api/projects — list all projects with group memberships and lesson counts */
router.get('/', async (req, res, next) => {
  try {
    const projects = await listAllProjects();
    res.json({ projects });
  } catch (e) { next(e); }
});

/** GET /api/projects/:id/summary — project summary snapshot */
router.get('/:id/summary', async (req, res, next) => {
  try {
    const projectId = resolveProjectIdOrThrow(req.params.id);
    const body = await getProjectSnapshotBody(projectId);
    if (body === null) {
      res.status(404).json({ error: 'No summary found for project', project_id: projectId });
      return;
    }
    res.json({ project_id: projectId, summary: body });
  } catch (e) { next(e); }
});

/** POST /api/projects/:id/index — trigger project indexing */
router.post('/:id/index', async (req, res, next) => {
  try {
    const projectId = resolveProjectIdOrThrow(req.params.id);
    const root = await resolveProjectRoot(projectId, req.body.root);
    const result = await indexProject({
      projectId,
      root,
      linesPerChunk: req.body.lines_per_chunk,
      embeddingBatchSize: req.body.embedding_batch_size,
    });
    res.json(result);
  } catch (e) { next(e); }
});

/** POST /api/projects/:id/reflect — reflect on a topic */
router.post('/:id/reflect', async (req, res, next) => {
  try {
    const projectId = resolveProjectIdOrThrow(req.params.id);
    const result = await reflectOnTopic({
      topic: req.body.topic,
      bullets: req.body.bullets ?? [],
    });
    res.json({ project_id: projectId, ...result });
  } catch (e) { next(e); }
});

/** DELETE /api/projects/:id — delete workspace data */
router.delete('/:id', async (req, res, next) => {
  try {
    const projectId = resolveProjectIdOrThrow(req.params.id);
    const result = await deleteWorkspace(projectId);
    res.json(result);
  } catch (e) { next(e); }
});

export { router as projectsRouter };
