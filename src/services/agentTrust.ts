import { getDbPool } from '../db/client.js';

export type TrustLevel = 'new' | 'standard' | 'trusted';

export interface AgentTrustEntry {
  agent_id: string;
  project_id: string;
  trust_level: TrustLevel;
  auto_approve: boolean;
  created_at: string;
  updated_at: string;
  // computed from lessons table
  lessons_created?: number;
  approval_rate?: number;
}

/** Get or create agent trust entry (defaults to 'new'). */
export async function getAgentTrust(params: {
  agentId: string;
  projectId: string;
}): Promise<AgentTrustEntry> {
  const pool = getDbPool();
  const result = await pool.query(
    `INSERT INTO agent_trust_levels (agent_id, project_id)
     VALUES ($1, $2)
     ON CONFLICT (agent_id, project_id) DO NOTHING
     RETURNING *`,
    [params.agentId, params.projectId],
  );
  if (result.rowCount) return result.rows[0];

  const existing = await pool.query(
    `SELECT * FROM agent_trust_levels WHERE agent_id = $1 AND project_id = $2`,
    [params.agentId, params.projectId],
  );
  return existing.rows[0];
}

/** Update agent trust level and/or auto_approve. */
export async function updateAgentTrust(params: {
  agentId: string;
  projectId: string;
  trustLevel?: TrustLevel;
  autoApprove?: boolean;
}): Promise<AgentTrustEntry | null> {
  const pool = getDbPool();

  // Ensure entry exists.
  await pool.query(
    `INSERT INTO agent_trust_levels (agent_id, project_id) VALUES ($1, $2) ON CONFLICT DO NOTHING`,
    [params.agentId, params.projectId],
  );

  const sets: string[] = ['updated_at = now()'];
  const args: any[] = [params.agentId, params.projectId];
  let idx = 3;

  if (params.trustLevel) {
    sets.push(`trust_level = $${idx++}`);
    args.push(params.trustLevel);
  }
  if (params.autoApprove !== undefined) {
    sets.push(`auto_approve = $${idx++}`);
    args.push(params.autoApprove);
  }

  const result = await pool.query(
    `UPDATE agent_trust_levels SET ${sets.join(', ')} WHERE agent_id = $1 AND project_id = $2 RETURNING *`,
    args,
  );
  return result.rows[0] ?? null;
}

/** List all agents for a project with their trust levels + lesson stats. */
export async function listAgents(params: {
  projectId: string;
}): Promise<{ agents: AgentTrustEntry[] }> {
  const pool = getDbPool();

  // Get all known agents from both trust table and lessons.
  const result = await pool.query(
    `SELECT
       COALESCE(t.agent_id, l.captured_by) AS agent_id,
       $1 AS project_id,
       COALESCE(t.trust_level, 'new') AS trust_level,
       COALESCE(t.auto_approve, false) AS auto_approve,
       COALESCE(t.created_at, now()) AS created_at,
       COALESCE(t.updated_at, now()) AS updated_at,
       COALESCE(l.total, 0)::int AS lessons_created,
       CASE WHEN COALESCE(l.total, 0) > 0
         THEN ROUND((COALESCE(l.active, 0)::numeric / l.total) * 100)::int
         ELSE 0
       END AS approval_rate
     FROM agent_trust_levels t
     FULL OUTER JOIN (
       SELECT captured_by,
              COUNT(*) AS total,
              SUM(CASE WHEN status = 'active' THEN 1 ELSE 0 END) AS active
       FROM lessons WHERE project_id = $1 AND captured_by IS NOT NULL
       GROUP BY captured_by
     ) l ON l.captured_by = t.agent_id AND t.project_id = $1
     WHERE COALESCE(t.project_id, $1) = $1
       AND COALESCE(t.agent_id, l.captured_by) IS NOT NULL
     ORDER BY COALESCE(l.total, 0) DESC`,
    [params.projectId],
  );

  return { agents: result.rows };
}
