import { Router } from 'express';
import { checkGuardrails, resolveProjectIdOrThrow, resolveProjectIds } from '../../core/index.js';
import { listGuardrailRules, simulateGuardrails } from '../../services/guardrails.js';

const router = Router();

/** GET /api/guardrails/rules — list active guardrail rules for a project or projects */
router.get('/rules', async (req, res, next) => {
  try {
    const rawIds = req.query.project_ids;
    let pid: string | string[];
    if (rawIds) {
      pid = Array.isArray(rawIds) ? rawIds.map(String) : String(rawIds).split(',').map(s => s.trim()).filter(Boolean);
    } else {
      pid = resolveProjectIdOrThrow(req.query.project_id as string);
    }
    const result = await listGuardrailRules(pid, {
      limit: req.query.limit ? Number(req.query.limit) : undefined,
      offset: req.query.offset ? Number(req.query.offset) : undefined,
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
    const results = await simulateGuardrails(projectId, actions.map(String));
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
