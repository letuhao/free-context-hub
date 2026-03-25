import { getDbPool } from '../db/client.js';

export type ActionContext = {
  action: string;
  workspace?: string;
  [k: string]: unknown;
};

export type GuardrailCheckResult = {
  pass: boolean;
  rules_checked: number;
  needs_confirmation?: boolean;
  prompt?: string;
  matched_rules?: Array<{ rule_id: string; verification_method: string; requirement: string }>;
};

function matchTrigger(trigger: string, action: string) {
  const trimmed = trigger.trim();

  // Regex trigger form: /pattern/
  if (trimmed.startsWith('/') && trimmed.lastIndexOf('/') > 0) {
    const lastSlash = trimmed.lastIndexOf('/');
    const pattern = trimmed.slice(1, lastSlash);
    try {
      const re = new RegExp(pattern);
      return re.test(action);
    } catch {
      // If regex is invalid, treat it as non-match.
      return false;
    }
  }

  return trimmed === action;
}

export async function checkGuardrails(projectId: string, actionContext: ActionContext): Promise<GuardrailCheckResult> {
  const pool = getDbPool();

  const rules = await pool.query(
    `SELECT rule_id, trigger, requirement, verification_method
     FROM guardrails
     WHERE project_id=$1;`,
    [projectId],
  );

  const checked = rules.rows ?? [];
  if (checked.length === 0) {
    await pool.query(
      `INSERT INTO guardrail_audit_logs(
        project_id, rule_id, action_context, pass, needs_confirmation, prompt, decision_reason
      ) VALUES ($1,$2,$3::jsonb,$4,$5,$6,$7);`,
      [projectId, null, JSON.stringify(actionContext), true, false, null, 'no_rules_configured'],
    );
    return { pass: true, rules_checked: 0 };
  }

  const action = actionContext.action ?? '';
  const matched: typeof checked = checked.filter((r: any) => matchTrigger(String(r.trigger), String(action)));

  if (matched.length === 0) {
    await pool.query(
      `INSERT INTO guardrail_audit_logs(
        project_id, rule_id, action_context, pass, needs_confirmation, prompt, decision_reason
      ) VALUES ($1,$2,$3::jsonb,$4,$5,$6,$7);`,
      [projectId, null, JSON.stringify(actionContext), true, false, null, 'no_trigger_matched'],
    );

    return { pass: true, rules_checked: 0 };
  }

  // MVP: any matched guardrail requires confirmation based on its verification method.
  const needsConfirmation = true;
  const first = matched[0];

  let prompt = `Guardrail triggered: ${String(first.requirement)}. Proceed anyway?`;
  if (String(first.verification_method) === 'user_confirmation') {
    prompt = `Guardrail triggered: ${String(first.requirement)}. Please confirm to proceed anyway.`;
  }

  await pool.query(
    `INSERT INTO guardrail_audit_logs(
      project_id, rule_id, action_context, pass, needs_confirmation, prompt, decision_reason
    ) VALUES ($1,$2,$3::jsonb,$4,$5,$6,$7);`,
    [
      projectId,
      String(first.rule_id),
      JSON.stringify(actionContext),
      false,
      needsConfirmation,
      prompt,
      'matched_trigger_requires_confirmation',
    ],
  );

  return {
    pass: false,
    rules_checked: matched.length,
    needs_confirmation: needsConfirmation,
    prompt,
    matched_rules: matched.map((r: any) => ({
      rule_id: String(r.rule_id),
      verification_method: String(r.verification_method),
      requirement: String(r.requirement),
    })),
  };
}

