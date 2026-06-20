import { Router } from 'express';
import type { Request } from 'express';
import { requireProjectScope } from '../middleware/requireResourceScope.js';
import {
  registerWorkspaceRoot,
  listWorkspaceRoots,
  scanWorkspaceChanges,
  configureProjectSource,
  getProjectSource,
  prepareRepo,
  resolveProjectIdOrThrow,
} from '../../core/index.js';
import { callerPrincipalOf } from '../middleware/auth.js';

const router = Router();

/** POST /api/workspace/register — register a workspace root */
router.post('/register', requireProjectScope('body'), async (req, res, next) => {
  try {
    const projectId = resolveProjectIdOrThrow(req.body.project_id);
    const result = await registerWorkspaceRoot({ projectId, actingPrincipalId: callerPrincipalOf(req), rootPath: req.body.root_path });
    res.json(result);
  } catch (e) { next(e); }
});

/** GET /api/workspace/roots — list workspace roots */
router.get('/roots', requireProjectScope('query'), async (req, res, next) => {
  try {
    const projectId = resolveProjectIdOrThrow(req.query.project_id as string | undefined);
    const result = await listWorkspaceRoots(projectId, { actingPrincipalId: callerPrincipalOf(req) });
    res.json(result);
  } catch (e) { next(e); }
});

/** POST /api/workspace/scan — scan workspace for changes */
router.post('/scan', requireProjectScope('body'), async (req, res, next) => {
  try {
    const projectId = resolveProjectIdOrThrow(req.body.project_id);
    const result = await scanWorkspaceChanges({ projectId, actingPrincipalId: callerPrincipalOf(req), rootPath: req.body.root_path });
    res.json(result);
  } catch (e) { next(e); }
});

/** POST /api/sources/configure — configure project source */
router.post('/sources/configure', requireProjectScope('body'), async (req, res, next) => {
  try {
    const projectId = resolveProjectIdOrThrow(req.body.project_id);
    const result = await configureProjectSource({
      projectId,
      actingPrincipalId: callerPrincipalOf(req),
      sourceType: req.body.source_type,
      gitUrl: req.body.git_url,
      defaultRef: req.body.default_ref,
      repoRoot: req.body.repo_root,
    });
    res.json(result);
  } catch (e) { next(e); }
});

/** GET /api/sources — get project source config */
router.get('/sources', requireProjectScope('query'), async (req, res, next) => {
  try {
    const projectId = resolveProjectIdOrThrow(req.query.project_id as string | undefined);
    const result = await getProjectSource(projectId, (req.query.source_type as any) ?? 'local_workspace', { actingPrincipalId: callerPrincipalOf(req) });
    res.json(result);
  } catch (e) { next(e); }
});

/** POST /api/sources/prepare — prepare (clone) a remote repo */
router.post('/sources/prepare', requireProjectScope('body'), async (req, res, next) => {
  try {
    const projectId = resolveProjectIdOrThrow(req.body.project_id);
    const result = await prepareRepo({
      projectId,
      actingPrincipalId: callerPrincipalOf(req),
      gitUrl: req.body.git_url,
      cacheRoot: req.body.cache_root ?? '/data/repos',
      ref: req.body.ref,
      depth: req.body.depth,
    });
    res.json(result);
  } catch (e) { next(e); }
});

export { router as workspaceRouter };
