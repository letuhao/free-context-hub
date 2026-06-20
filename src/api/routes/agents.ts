import { Router } from 'express';
import { getAgentTrust, updateAgentTrust, listAgents } from '../../services/agentTrust.js';
import { resolveProjectIdOrThrow } from '../../core/index.js';
import { callerPrincipalOf } from '../middleware/auth.js';

const router = Router();

/** GET /api/agents — list all agents with trust levels + stats */
router.get('/', async (req, res, next) => {
  try {
    const projectId = resolveProjectIdOrThrow(req.query.project_id as string | undefined);
    const result = await listAgents({ projectId, actingPrincipalId: callerPrincipalOf(req) });
    res.json(result);
  } catch (e) { next(e); }
});

/** GET /api/agents/:id — get trust level for a specific agent */
router.get('/:id', async (req, res, next) => {
  try {
    const projectId = resolveProjectIdOrThrow(req.query.project_id as string | undefined);
    const result = await getAgentTrust({ agentId: req.params.id, projectId, actingPrincipalId: callerPrincipalOf(req) });
    res.json(result);
  } catch (e) { next(e); }
});

/** PATCH /api/agents/:id — update trust level and/or auto_approve */
router.patch('/:id', async (req, res, next) => {
  try {
    const projectId = resolveProjectIdOrThrow(req.body.project_id);
    const result = await updateAgentTrust({
      agentId: req.params.id,
      projectId,
      actingPrincipalId: callerPrincipalOf(req),
      trustLevel: req.body.trust_level,
      autoApprove: req.body.auto_approve,
    });
    res.json(result);
  } catch (e) { next(e); }
});

export { router as agentsRouter };
