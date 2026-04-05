import { getDbPool } from '../db/client.js';

export interface AuditEntry {
  id: string;
  project_id: string;
  action_type: string;       // guardrail.check | guardrail.blocked | lesson.created | lesson.updated
  agent_id: string | null;   // captured_by for lessons, null for guardrails (no agent tracking yet)
  summary: string;
  details: Record<string, unknown> | null;
  pass: boolean | null;
  created_at: string;
}

export interface AuditStats {
  total_actions: number;
  guardrail_checks: number;
  blocked_count: number;
  lesson_creates: number;
  lesson_updates: number;
  active_agents: number;
  approval_rate: number;
}

/**
 * Unified audit timeline combining guardrail_audit_logs + lesson activity.
 * Returns most recent actions first.
 */
export async function listAuditLog(params: {
  projectId: string;
  limit?: number;
  offset?: number;
  agent_id?: string;
  action_type?: string;     // filter: "guardrail" | "lesson" | all
  days?: number;            // limit to last N days
}): Promise<{ items: AuditEntry[]; total_count: number }> {
  const pool = getDbPool();
  const limit = Math.min(params.limit ?? 20, 100);
  const offset = params.offset ?? 0;

  const whereArgs: string[] = [];
  const vals: unknown[] = [];
  let idx = 1;

  // Project filter
  whereArgs.push(`project_id = $${idx++}`);
  vals.push(params.projectId);

  // Time filter
  if (params.days && params.days > 0) {
    whereArgs.push(`created_at >= now() - interval '${Math.floor(params.days)} days'`);
  }

  // Agent filter (only applies to lesson entries)
  const agentFilter = params.agent_id ? `AND agent_id = $${idx++}` : '';
  if (params.agent_id) vals.push(params.agent_id);

  const whereClause = whereArgs.length > 0 ? `WHERE ${whereArgs.join(' AND ')}` : '';

  // Build the UNION query
  const guardrailQuery = `
    SELECT
      audit_id::text AS id,
      project_id,
      CASE WHEN pass THEN 'guardrail.check' ELSE 'guardrail.blocked' END AS action_type,
      NULL AS agent_id,
      CASE
        WHEN pass AND decision_reason = 'no_rules_configured' THEN 'No guardrail rules configured'
        WHEN pass AND decision_reason = 'no_trigger_matched' THEN 'Guardrail check passed (no match)'
        WHEN pass THEN 'Guardrail check passed'
        ELSE 'Guardrail blocked: ' || COALESCE(prompt, 'action blocked')
      END AS summary,
      action_context AS details,
      pass,
      created_at
    FROM guardrail_audit_logs
    ${whereClause}
  `;

  const lessonQuery = `
    SELECT
      lesson_id::text AS id,
      project_id,
      'lesson.created' AS action_type,
      captured_by AS agent_id,
      'Created lesson: ' || title AS summary,
      jsonb_build_object('lesson_type', lesson_type, 'tags', tags) AS details,
      NULL::boolean AS pass,
      created_at
    FROM lessons
    ${whereClause}
    ${agentFilter}
  `;

  // Action type filter
  let unionQuery: string;
  if (params.action_type === 'guardrail') {
    unionQuery = guardrailQuery;
  } else if (params.action_type === 'lesson') {
    unionQuery = lessonQuery;
  } else {
    unionQuery = `(${guardrailQuery}) UNION ALL (${lessonQuery})`;
  }

  // Count
  const countRes = await pool.query(`SELECT count(*)::int AS cnt FROM (${unionQuery}) sub`, vals);
  const totalCount = countRes.rows?.[0]?.cnt ?? 0;

  // Paginated results
  const dataRes = await pool.query(
    `SELECT * FROM (${unionQuery}) sub ORDER BY created_at DESC LIMIT ${limit} OFFSET ${offset}`,
    vals,
  );

  return {
    items: (dataRes.rows ?? []).map((r: any) => ({
      id: r.id,
      project_id: r.project_id,
      action_type: r.action_type,
      agent_id: r.agent_id ?? null,
      summary: r.summary,
      details: r.details ?? null,
      pass: r.pass,
      created_at: r.created_at,
    })),
    total_count: totalCount,
  };
}

/** Get audit stats for a project. */
export async function getAuditStats(projectId: string): Promise<AuditStats> {
  const pool = getDbPool();

  const [guardrailRes, blockedRes, lessonRes, agentRes] = await Promise.all([
    pool.query(`SELECT count(*)::int AS cnt FROM guardrail_audit_logs WHERE project_id = $1`, [projectId]),
    pool.query(`SELECT count(*)::int AS cnt FROM guardrail_audit_logs WHERE project_id = $1 AND pass = false`, [projectId]),
    pool.query(`SELECT count(*)::int AS cnt FROM lessons WHERE project_id = $1`, [projectId]),
    pool.query(`SELECT count(DISTINCT captured_by)::int AS cnt FROM lessons WHERE project_id = $1 AND captured_by IS NOT NULL`, [projectId]),
  ]);

  const guardrailChecks = guardrailRes.rows?.[0]?.cnt ?? 0;
  const blocked = blockedRes.rows?.[0]?.cnt ?? 0;
  const lessonCount = lessonRes.rows?.[0]?.cnt ?? 0;
  const activeAgents = agentRes.rows?.[0]?.cnt ?? 0;
  const totalActions = guardrailChecks + lessonCount;
  const approvalRate = totalActions > 0 ? Math.round(((totalActions - blocked) / totalActions) * 100) : 100;

  return {
    total_actions: totalActions,
    guardrail_checks: guardrailChecks,
    blocked_count: blocked,
    lesson_creates: lessonCount,
    lesson_updates: 0, // would need version tracking to count
    active_agents: activeAgents,
    approval_rate: approvalRate,
  };
}
