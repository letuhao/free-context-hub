import { Router } from 'express';
import {
  claimArtifact,
  releaseArtifact,
  renewArtifact,
  listActiveClaims,
  checkArtifactAvailability,
  forceReleaseArtifact,
  resolveProjectIdOrThrow,
} from '../../core/index.js';
import { requireRole } from '../middleware/requireRole.js';
import { requireScope } from '../middleware/requireScope.js';

/**
 * Phase 13 Sprint 13.1 — Artifact leases REST routes.
 * Mounted at /api/projects/:id/artifact-leases with mergeParams: true so
 * the parent's :id param is accessible as req.params.id.
 *
 * Routes:
 *   GET    /                    list active claims (optional ?artifact_type=)
 *   POST   /                    claim artifact
 *   GET    /:leaseId            check availability (returns lease detail if exists)
 *   PATCH  /:leaseId            renew (extend TTL)
 *   DELETE /:leaseId            release (owner only)
 *   DELETE /:leaseId/force      force-release (admin role, project-scoped)
 */
const router = Router({ mergeParams: true });

router.get('/', async (req, res, next) => {
  try {
    const projectId = resolveProjectIdOrThrow(String((req.params as Record<string, string>).id ?? ''));
    const artifactType = req.query.artifact_type ? String(req.query.artifact_type) : undefined;
    const result = await listActiveClaims({ project_id: projectId, artifact_type: artifactType });
    res.json(result);
  } catch (e) { next(e); }
});

router.post('/', requireRole('writer'), async (req, res, next) => {
  try {
    const projectId = resolveProjectIdOrThrow(String((req.params as Record<string, string>).id ?? ''));
    const { agent_id, artifact_type, artifact_id, task_description, ttl_minutes } = req.body ?? {};
    if (!agent_id || !artifact_type || !artifact_id || !task_description) {
      res.status(400).json({ error: 'agent_id, artifact_type, artifact_id, task_description required' });
      return;
    }
    const result = await claimArtifact({
      project_id: projectId,
      agent_id: String(agent_id),
      artifact_type: String(artifact_type),
      artifact_id: String(artifact_id),
      task_description: String(task_description),
      ttl_minutes: typeof ttl_minutes === 'number' ? ttl_minutes : undefined,
    });
    res.status(result.status === 'claimed' ? 201 : 200).json(result);
  } catch (e) {
    const err = e as Error;
    if (err.message?.startsWith('artifact_id must be') || err.message?.startsWith('claim_artifact:')) {
      res.status(400).json({ error: err.message });
      return;
    }
    next(e);
  }
});

// v2-r1 fix (BLOCK 1): GET /:leaseId removed — bypassed service + wrong
// semantics on miss. For availability check (mirrors MCP `check_artifact_
// availability` tool, AC10), use POST /check with {artifact_type, artifact_id}.
router.post('/check', async (req, res, next) => {
  try {
    const projectId = resolveProjectIdOrThrow(String((req.params as Record<string, string>).id ?? ''));
    const { artifact_type, artifact_id } = req.body ?? {};
    if (!artifact_type || !artifact_id) {
      res.status(400).json({ error: 'artifact_type and artifact_id required' });
      return;
    }
    const result = await checkArtifactAvailability({
      project_id: projectId,
      artifact_type: String(artifact_type),
      artifact_id: String(artifact_id),
    });
    res.json(result);
  } catch (e) { next(e); }
});

router.patch('/:leaseId', requireRole('writer'), async (req, res, next) => {
  try {
    const projectId = resolveProjectIdOrThrow(String((req.params as Record<string, string>).id ?? ''));
    const leaseId = String(req.params.leaseId);
    const { agent_id, extend_by_minutes } = req.body ?? {};
    if (!agent_id || typeof extend_by_minutes !== 'number') {
      res.status(400).json({ error: 'agent_id and extend_by_minutes (number) required' });
      return;
    }
    const result = await renewArtifact({
      project_id: projectId,
      agent_id: String(agent_id),
      lease_id: leaseId,
      extend_by_minutes,
    });
    if (result.status === 'not_found') {
      res.status(404).json(result);
      return;
    }
    res.json(result);
  } catch (e) {
    const err = e as Error;
    if (err.message?.startsWith('extend_by_minutes')) {
      res.status(400).json({ error: err.message });
      return;
    }
    next(e);
  }
});

router.delete('/:leaseId/force', requireRole('admin'), requireScope('id'), async (req, res, next) => {
  try {
    const projectId = resolveProjectIdOrThrow(String((req.params as Record<string, string>).id ?? ''));
    const leaseId = String(req.params.leaseId);
    const result = await forceReleaseArtifact({ project_id: projectId, lease_id: leaseId });
    res.status(result.status === 'force_released' ? 200 : 404).json(result);
  } catch (e) { next(e); }
});

router.delete('/:leaseId', requireRole('writer'), async (req, res, next) => {
  try {
    const projectId = resolveProjectIdOrThrow(String((req.params as Record<string, string>).id ?? ''));
    const leaseId = String(req.params.leaseId);
    const agentId = req.body?.agent_id;
    if (!agentId) {
      res.status(400).json({ error: 'agent_id (in JSON body) required' });
      return;
    }
    const result = await releaseArtifact({
      project_id: projectId,
      agent_id: String(agentId),
      lease_id: leaseId,
    });
    if (result.status === 'not_found') {
      res.status(404).json(result);
      return;
    }
    if (result.status === 'not_owner') {
      res.status(403).json(result);
      return;
    }
    res.json(result);
  } catch (e) { next(e); }
});

export const artifactLeasesRouter = router;
