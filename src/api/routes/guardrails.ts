import { Router } from 'express';
import type { Request } from 'express';
import { checkGuardrails, resolveProjectIdOrThrow, resolveProjectIds } from '../../core/index.js';
import type { CallerScope } from '../../core/index.js';
import { listGuardrailRules, simulateGuardrails } from '../../services/guardrails.js';
import { resolveProjectIdOrIds } from '../middleware/resolveProjectParams.js';

/** DEFERRED-029: read the caller's project scope attached by bearerAuth. */
function callerScopeOf(req: Request): CallerScope {
  return (req as { apiKeyScope?: CallerScope }).apiKeyScope;
}

const router = Router();

/** GET /api/guardrails/rules — list active guardrail rules for a project or projects */
router.get('/rules', async (req, res, next) => {
  try {
    const pid = resolveProjectIdOrIds(req.query);
    const result = await listGuardrailRules(pid, {
      limit: req.query.limit ? Number(req.query.limit) : undefined,
      offset: req.query.offset ? Number(req.query.offset) : undefined,
      callerScope: callerScopeOf(req),
    });
    res.json(result);
  } catch (e) { next(e); }
});

/** POST /api/guardrails/simulate — bulk "What Would Block?" check (no audit log) */
router.post('/simulate', async (req, res, next) => {
  try {
    const projectId = resolveProjectIdOrThrow(req.body.project_id);
    const actions = req.body.actions;
    if (!Array.isArray(actions) || actions.length === 0) {
      res.status(400).json({ error: 'actions must be a non-empty array of strings' });
      return;
    }
    if (actions.length > 50) {
      res.status(400).json({ error: 'maximum 50 actions per request' });
      return;
    }
    const results = await simulateGuardrails(projectId, actions.map(String), { callerScope: callerScopeOf(req) });
    res.json({ results });
  } catch (e) { next(e); }
});

/** POST /api/guardrails/check — check if an action is allowed (supports include_groups) */
router.post('/check', async (req, res, next) => {
  try {
    const projectId = resolveProjectIdOrThrow(req.body.project_id);

    if (req.body.include_groups) {
      const allIds = await resolveProjectIds(projectId, true);
      let totalChecked = 0;
      const allMatched: Array<{ rule_id: string; verification_method: string; requirement: string }> = [];
      let anyFailed = false;
      let firstPrompt: string | undefined;

      // PR F Adversary #4 LOW-1: resolveProjectIds returns [projectId, ...group_ids].
      // Per-pid assertCallerScope would reject scoped callers on group_ids
      // (they're not the caller's project_id). Graceful-skip on NOT_FOUND from
      // the scope helper preserves the security contract (caller can only see
      // their own data + group-shared data they have explicit authority for)
      // while not breaking the include_groups feature for scoped callers.
      // The root `projectId` was already scope-asserted indirectly by the route's
      // requireProjectScope middleware + the service's assertCallerScope.
      const callerScope = callerScopeOf(req);
      for (const pid of allIds) {
        let r;
        try {
          r = await checkGuardrails(pid, req.body.action_context, { callerScope });
        } catch (e: any) {
          // Cross-tenant group member → service threw NOT_FOUND. Skip silently
          // for scoped callers (same data they could not see via per-project
          // checkGuardrails call). Admin/auth-off (callerScope=null/undefined)
          // never throw here, so this branch only fires for scoped callers.
          if (e?.code === 'NOT_FOUND' && typeof callerScope === 'string') continue;
          throw e;
        }
        totalChecked += r.rules_checked;
        if (!r.pass) {
          anyFailed = true;
          if (!firstPrompt && r.prompt) firstPrompt = r.prompt;
          if (r.matched_rules) allMatched.push(...r.matched_rules);
        }
      }

      res.json({
        pass: !anyFailed,
        rules_checked: totalChecked,
        needs_confirmation: anyFailed ? true : undefined,
        prompt: firstPrompt,
        matched_rules: allMatched.length > 0 ? allMatched : undefined,
      });
      return;
    }

    const result = await checkGuardrails(projectId, req.body.action_context, { callerScope: callerScopeOf(req) });
    res.json(result);
  } catch (e) { next(e); }
});

export { router as guardrailsRouter };
