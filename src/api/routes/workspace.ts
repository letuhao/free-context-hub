import { Router } from 'express';
import {
  registerWorkspaceRoot,
  listWorkspaceRoots,
  scanWorkspaceChanges,
  configureProjectSource,
  getProjectSource,
  prepareRepo,
  resolveProjectIdOrThrow,
} from '../../core/index.js';

const router = Router();

/** POST /api/workspace/register — register a workspace root */
router.post('/register', async (req, res, next) => {
  try {
    const projectId = resolveProjectIdOrThrow(req.body.project_id);
    const result = await registerWorkspaceRoot({ projectId, rootPath: req.body.root_path });
    res.json(result);
  } catch (e) { next(e); }
});

/** GET /api/workspace/roots — list workspace roots */
router.get('/roots', async (req, res, next) => {
  try {
    const projectId = resolveProjectIdOrThrow(req.query.project_id as string | undefined);
    const result = await listWorkspaceRoots(projectId);
    res.json(result);
  } catch (e) { next(e); }
});

/** POST /api/workspace/scan — scan workspace for changes */
router.post('/scan', async (req, res, next) => {
  try {
    const projectId = resolveProjectIdOrThrow(req.body.project_id);
    const result = await scanWorkspaceChanges({ projectId, rootPath: req.body.root_path });
    res.json(result);
  } catch (e) { next(e); }
});

/** POST /api/sources/configure — configure project source */
router.post('/sources/configure', async (req, res, next) => {
  try {
    const projectId = resolveProjectIdOrThrow(req.body.project_id);
    const result = await configureProjectSource({
      projectId,
      sourceType: req.body.source_type,
      gitUrl: req.body.git_url,
      defaultRef: req.body.default_ref,
      repoRoot: req.body.repo_root,
    });
    res.json(result);
  } catch (e) { next(e); }
});

/** GET /api/sources — get project source config */
router.get('/sources', async (req, res, next) => {
  try {
    const projectId = resolveProjectIdOrThrow(req.query.project_id as string | undefined);
    const result = await getProjectSource(projectId, (req.query.source_type as any) ?? 'local_workspace');
    res.json(result);
  } catch (e) { next(e); }
});

/** POST /api/sources/prepare — prepare (clone) a remote repo */
router.post('/sources/prepare', async (req, res, next) => {
  try {
    const projectId = resolveProjectIdOrThrow(req.body.project_id);
    const result = await prepareRepo({
      projectId,
      gitUrl: req.body.git_url,
      cacheRoot: req.body.cache_root ?? '/data/repos',
      ref: req.body.ref,
      depth: req.body.depth,
    });
    res.json(result);
  } catch (e) { next(e); }
});

export { router as workspaceRouter };
