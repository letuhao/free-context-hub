import { Router } from 'express';
import {
  ingestGitHistory,
  listCommits,
  getCommit,
  suggestLessonsFromCommits,
  analyzeCommitImpact,
  resolveProjectIdOrThrow,
  resolveProjectRoot,
} from '../../core/index.js';

const router = Router();

/** POST /api/git/ingest — ingest git history for a project */
router.post('/ingest', async (req, res, next) => {
  try {
    const projectId = resolveProjectIdOrThrow(req.body.project_id);
    const root = await resolveProjectRoot(projectId, req.body.root);
    const result = await ingestGitHistory({
      projectId,
      root,
      maxCommits: req.body.max_commits,
      since: req.body.since,
    });
    res.json(result);
  } catch (e) { next(e); }
});

/** GET /api/git/commits — list commits for a project */
router.get('/commits', async (req, res, next) => {
  try {
    const projectId = resolveProjectIdOrThrow(req.query.project_id as string | undefined);
    const result = await listCommits({
      projectId,
      limit: req.query.limit ? Number(req.query.limit) : undefined,
    });
    res.json(result);
  } catch (e) { next(e); }
});

/** GET /api/git/commits/:sha — get a single commit */
router.get('/commits/:sha', async (req, res, next) => {
  try {
    const projectId = resolveProjectIdOrThrow(req.query.project_id as string | undefined);
    const result = await getCommit({ projectId, sha: req.params.sha });
    res.json(result);
  } catch (e) { next(e); }
});

/** POST /api/git/suggest-lessons — suggest lessons from recent commits */
router.post('/suggest-lessons', async (req, res, next) => {
  try {
    const projectId = resolveProjectIdOrThrow(req.body.project_id);
    const result = await suggestLessonsFromCommits({
      projectId,
      commitShas: req.body.commit_shas,
      limit: req.body.limit,
    });
    res.json(result);
  } catch (e) { next(e); }
});

/** POST /api/git/analyze-impact — analyze impact of a commit */
router.post('/analyze-impact', async (req, res, next) => {
  try {
    const projectId = resolveProjectIdOrThrow(req.body.project_id);
    const result = await analyzeCommitImpact({
      projectId,
      commitSha: req.body.sha,
    });
    res.json(result);
  } catch (e) { next(e); }
});

export { router as gitRouter };
