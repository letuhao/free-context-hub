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

export type GuardrailRule = {
  rule_id: string;
  trigger: string;
  requirement: string;
  verification_method: string;
  title: string;
  status: string;
};

export async function listGuardrailRules(projectIdOrIds: string | string[], opts?: { limit?: number; offset?: number }): Promise<{ rules: GuardrailRule[]; total_count: number }> {
  const pool = getDbPool();
  const limit = Math.min(opts?.limit ?? 50, 200);
  const offset = Math.max(opts?.offset ?? 0, 0);
  const isArray = Array.isArray(projectIdOrIds);
  const pClause = isArray ? 'g.project_id = ANY($1::text[])' : 'g.project_id = $1';
  const param = isArray ? projectIdOrIds : projectIdOrIds;
  const whereClause = `WHERE ${pClause} AND COALESCE(l.status, 'active') IN ('active', 'draft')`;
  const countRes = await pool.query(
    `SELECT COUNT(*) AS cnt FROM guardrails g JOIN lessons l ON l.lesson_id = g.rule_id AND l.project_id = g.project_id ${whereClause}`,
    [param],
  );
  const total_count = parseInt(countRes.rows[0]?.cnt ?? '0', 10);
  const { rows } = await pool.query(
    `SELECT g.rule_id, g.project_id, g.trigger, g.requirement, g.verification_method,
            l.title, COALESCE(l.status, 'active') AS status
     FROM guardrails g
     JOIN lessons l ON l.lesson_id = g.rule_id AND l.project_id = g.project_id
     ${whereClause}
     ORDER BY g.created_at DESC
     LIMIT $2 OFFSET $3`,
    [param, limit, offset],
  );
  return { rules: rows as GuardrailRule[], total_count };
}

export type SimulateResult = {
  action: string;
  pass: boolean;
  matched_rules: Array<{ rule_id: string; requirement: string; verification_method: string }>;
};

export async function simulateGuardrails(
  projectId: string,
  actions: string[],
): Promise<SimulateResult[]> {
  const { rules } = await listGuardrailRules(projectId, { limit: 200 });
  return actions.map((action) => {
    const matched = rules.filter((r) => matchTrigger(r.trigger, action));
    return {
      action,
      pass: matched.length === 0,
      matched_rules: matched.map((r) => ({
        rule_id: r.rule_id,
        requirement: r.requirement,
        verification_method: r.verification_method,
      })),
    };
  });
}

export async function checkGuardrails(projectId: string, actionContext: ActionContext): Promise<GuardrailCheckResult> {
  const pool = getDbPool();

  // Only check guardrails whose parent lesson is active (not superseded/archived).
  const rules = await pool.query(
    `SELECT g.rule_id, g.trigger, g.requirement, g.verification_method
     FROM guardrails g
     JOIN lessons l ON l.lesson_id = g.rule_id AND l.project_id = g.project_id
     WHERE g.project_id = $1
       AND COALESCE(l.status, 'active') IN ('active', 'draft');`,
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

    return { pass: true, rules_checked: checked.length };
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

