import { Router } from 'express';
import { checkGuardrails, resolveProjectIdOrThrow, resolveProjectIds } from '../../core/index.js';

const router = Router();

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

      for (const pid of allIds) {
        const r = await checkGuardrails(pid, req.body.action_context);
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

    const result = await checkGuardrails(projectId, req.body.action_context);
    res.json(result);
  } catch (e) { next(e); }
});

export { router as guardrailsRouter };
