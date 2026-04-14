import { Router } from 'express';
import {
  getProjectSnapshotBody,
  indexProject,
  reflectOnTopic,
  deleteWorkspace,
  resolveProjectIdOrThrow,
  resolveProjectRoot,
  listAllProjects,
  createProject,
  updateProject,
  addProjectToGroup,
} from '../../core/index.js';
import multer from 'multer';
import { promises as fsPromises } from 'node:fs';
import { invalidateFeatureCache } from '../../services/featureToggles.js';
import { requireRole } from '../middleware/requireRole.js';
import { exportProject, ExportNotFoundError } from '../../services/exchange/exportProject.js';
import {
  importProject,
  ImportError,
  type ConflictPolicy,
} from '../../services/exchange/importProject.js';

// Bundles routinely exceed the 10MB default used for document uploads —
// 500 MB matches what we've observed in production-scale projects with
// vision-extracted PDFs. Disk storage avoids loading the whole file
// into memory; multer assigns a temp path that we delete in finally.
const importUpload = multer({
  storage: multer.diskStorage({}),
  limits: { fileSize: 500 * 1024 * 1024 },
});

const router = Router();

/** GET /api/projects — list all projects with group memberships and lesson counts */
router.get('/', async (req, res, next) => {
  try {
    const projects = await listAllProjects();
    res.json({ projects });
  } catch (e) { next(e); }
});

/** POST /api/projects — create a new project */
router.post('/', requireRole('writer'), async (req, res, next) => {
  try {
    const { project_id, name, description, color, settings, group_id } = req.body;
    if (!project_id || typeof project_id !== 'string') {
      res.status(400).json({ error: 'project_id is required' });
      return;
    }
    const trimmedName = typeof name === 'string' ? name.trim() : undefined;
    const trimmedDesc = typeof description === 'string' ? description.trim() : undefined;
    const result = await createProject({
      project_id: project_id.trim(),
      name: trimmedName || undefined,
      description: trimmedDesc || undefined,
      color,
      settings,
    });

    // Optionally add to a group
    let group_warning: string | undefined;
    if (group_id && typeof group_id === 'string') {
      try {
        await addProjectToGroup(group_id, project_id);
      } catch (err: any) {
        group_warning = `Project created but failed to add to group "${group_id}": ${err?.message ?? 'unknown error'}`;
      }
    }

    res.status(201).json({ status: 'created', ...result, ...(group_warning ? { warning: group_warning } : {}) });
  } catch (e) { next(e); }
});

/** PUT /api/projects/:id — update project metadata */
router.put('/:id', requireRole('writer'), async (req, res, next) => {
  try {
    const projectId = resolveProjectIdOrThrow(String(req.params.id));
    const { name, description, color, settings } = req.body;
    const trimmedName = typeof name === 'string' ? name.trim() : undefined;
    const trimmedDesc = typeof description === 'string' ? description.trim() : undefined;
    const result = await updateProject(projectId, {
      name: trimmedName,
      description: trimmedDesc,
      color,
      settings,
    });
    invalidateFeatureCache(projectId);
    res.json({ status: 'updated', ...result });
  } catch (e) { next(e); }
});

/** GET /api/projects/:id/summary — project summary snapshot */
router.get('/:id/summary', async (req, res, next) => {
  try {
    const projectId = resolveProjectIdOrThrow(String(req.params.id));
    const body = await getProjectSnapshotBody(projectId);
    if (body === null) {
      res.status(404).json({ error: 'No summary found for project', project_id: projectId });
      return;
    }
    res.json({ project_id: projectId, summary: body });
  } catch (e) { next(e); }
});

/** POST /api/projects/:id/index — trigger project indexing */
router.post('/:id/index', requireRole('writer'), async (req, res, next) => {
  try {
    const projectId = resolveProjectIdOrThrow(String(req.params.id));
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
router.post('/:id/reflect', requireRole('writer'), async (req, res, next) => {
  try {
    const projectId = resolveProjectIdOrThrow(String(req.params.id));
    const result = await reflectOnTopic({
      topic: req.body.topic,
      bullets: req.body.bullets ?? [],
    });
    res.json({ project_id: projectId, ...result });
  } catch (e) { next(e); }
});

/** GET /api/projects/:id/export — Phase 11.2: stream a full project bundle as a zip.
 *  Query params:
 *    - include_documents=false  → skip documents.jsonl + binary entries
 *    - include_chunks=false     → skip chunks.jsonl
 *  Both default to true ("bundle huge is normal").
 */
router.get('/:id/export', async (req, res, next) => {
  try {
    const projectId = resolveProjectIdOrThrow(String(req.params.id));
    const includeDocuments = req.query.include_documents !== 'false';
    const includeChunks = req.query.include_chunks !== 'false';

    const date = new Date().toISOString().slice(0, 10);
    res.setHeader('Content-Type', 'application/zip');
    res.setHeader(
      'Content-Disposition',
      `attachment; filename="contexthub-${projectId}-${date}.zip"`,
    );
    // Disable any default JSON-ifying middleware buffering by streaming
    // straight into the response. encodeBundle pipes archiver → res.
    await exportProject({ projectId, includeDocuments, includeChunks }, res);
    // archiver.finalize() ended the response; nothing more to send.
  } catch (e) {
    if (e instanceof ExportNotFoundError) {
      if (!res.headersSent) {
        res.status(404).json({ error: e.message });
        return;
      }
    }
    // If headers were already sent (mid-stream archiver/cursor error)
    // we can't return a clean error response — the partial zip will
    // fail to decode on the client and the manifest checksum
    // mismatch will surface the cause. Express's default error
    // handler logs but cannot send a response either.
    next(e);
  }
});

/** POST /api/projects/:id/import — Phase 11.3: import a bundle into a project.
 *
 *  multipart/form-data with `file` (the .zip bundle).
 *  Query params:
 *    - policy=skip|overwrite|fail (default: skip)
 *    - dry_run=true               (decode + count without writing)
 *    - conflicts_cap=N            (max conflicts in the response, default 50, max 1000)
 *
 *  Auto-creates the target project if it doesn't exist.
 */
router.post(
  '/:id/import',
  requireRole('writer'),
  importUpload.single('file'),
  async (req, res, next) => {
    if (!req.file) {
      res.status(400).json({ error: 'multipart field "file" is required' });
      return;
    }
    const tmpPath = req.file.path;
    try {
      const projectId = resolveProjectIdOrThrow(String(req.params.id));
      const policy = (req.query.policy as ConflictPolicy) ?? 'skip';
      if (!['skip', 'overwrite', 'fail'].includes(policy)) {
        res.status(400).json({ error: `invalid policy "${policy}"` });
        return;
      }
      const dryRun = req.query.dry_run === 'true';
      const conflictsCap = req.query.conflicts_cap
        ? parseInt(String(req.query.conflicts_cap), 10)
        : undefined;
      if (conflictsCap !== undefined && (Number.isNaN(conflictsCap) || conflictsCap < 1)) {
        res.status(400).json({ error: 'conflicts_cap must be a positive integer' });
        return;
      }

      const result = await importProject({
        targetProjectId: projectId,
        bundlePath: tmpPath,
        policy,
        dryRun,
        conflictsCap,
      });
      res.json(result);
    } catch (e) {
      if (e instanceof ImportError) {
        const status =
          e.code === 'malformed_bundle' || e.code === 'schema_version_mismatch' || e.code === 'invalid_row'
            ? 400
            : e.code === 'conflict_fail'
            ? 409
            : 500;
        res.status(status).json({ error: e.message, code: e.code });
        return;
      }
      next(e);
    } finally {
      // Always remove the temp upload — best-effort, multer's diskStorage
      // does not auto-clean and leaving stray bundles fills /tmp fast.
      fsPromises.unlink(tmpPath).catch(() => {
        /* ignore */
      });
    }
  },
);

/** DELETE /api/projects/:id — delete workspace data */
router.delete('/:id', requireRole('admin'), async (req, res, next) => {
  try {
    const projectId = resolveProjectIdOrThrow(String(req.params.id));
    const result = await deleteWorkspace(projectId);
    res.json(result);
  } catch (e) { next(e); }
});

export { router as projectsRouter };
