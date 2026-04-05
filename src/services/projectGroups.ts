import { getDbPool } from '../db/client.js';
import { ContextHubError } from '../core/errors.js';

const MAX_GROUP_MEMBERS = 50;

export type ProjectGroup = {
  group_id: string;
  name: string;
  description: string | null;
  created_at: Date;
  updated_at: Date;
};

export type ProjectGroupWithMembers = ProjectGroup & {
  member_count: number;
  members?: string[];
};

// ── CRUD ──

export async function createGroup(params: {
  group_id: string;
  name: string;
  description?: string;
}): Promise<ProjectGroup> {
  const pool = getDbPool();

  // Ensure the projects table has a row for this group_id so lessons can be stored there.
  await pool.query(
    `INSERT INTO projects (project_id, name) VALUES ($1, $2)
     ON CONFLICT (project_id) DO UPDATE SET name = EXCLUDED.name, updated_at = now()`,
    [params.group_id, params.name],
  );

  const res = await pool.query(
    `INSERT INTO project_groups (group_id, name, description)
     VALUES ($1, $2, $3)
     ON CONFLICT (group_id) DO UPDATE
       SET name = EXCLUDED.name, description = EXCLUDED.description, updated_at = now()
     RETURNING *`,
    [params.group_id, params.name, params.description ?? null],
  );
  return mapGroupRow(res.rows[0]);
}

export async function deleteGroup(groupId: string): Promise<{ deleted: boolean }> {
  const pool = getDbPool();
  // Members cascade-deleted via FK.
  const res = await pool.query(
    `DELETE FROM project_groups WHERE group_id = $1 RETURNING group_id`,
    [groupId],
  );
  return { deleted: (res.rowCount ?? 0) > 0 };
}

export async function listGroups(): Promise<ProjectGroupWithMembers[]> {
  const pool = getDbPool();
  const res = await pool.query(
    `SELECT g.*, COUNT(m.project_id)::int AS member_count
     FROM project_groups g
     LEFT JOIN project_group_members m ON m.group_id = g.group_id
     GROUP BY g.group_id
     ORDER BY g.created_at DESC`,
  );
  return (res.rows ?? []).map(mapGroupWithMembersRow);
}

export async function getGroup(groupId: string): Promise<ProjectGroupWithMembers | null> {
  const pool = getDbPool();
  const res = await pool.query(
    `SELECT g.*, COUNT(m.project_id)::int AS member_count
     FROM project_groups g
     LEFT JOIN project_group_members m ON m.group_id = g.group_id
     WHERE g.group_id = $1
     GROUP BY g.group_id`,
    [groupId],
  );
  if (!res.rows.length) return null;
  return mapGroupWithMembersRow(res.rows[0]);
}

// ── Members ──

export async function listGroupMembers(groupId: string): Promise<string[]> {
  const pool = getDbPool();
  const res = await pool.query(
    `SELECT project_id FROM project_group_members WHERE group_id = $1 ORDER BY added_at`,
    [groupId],
  );
  return (res.rows ?? []).map((r: any) => String(r.project_id));
}

export async function addProjectToGroup(groupId: string, projectId: string): Promise<{ added: boolean }> {
  const pool = getDbPool();

  // Guard: group must exist.
  const gExists = await pool.query(`SELECT group_id FROM project_groups WHERE group_id = $1`, [groupId]);
  if (!gExists.rowCount) throw new ContextHubError('NOT_FOUND', `Group '${groupId}' not found`);

  // Guard: max member count.
  const countRes = await pool.query(
    `SELECT COUNT(*)::int AS n FROM project_group_members WHERE group_id = $1`,
    [groupId],
  );
  if (Number(countRes.rows[0]?.n ?? 0) >= MAX_GROUP_MEMBERS) {
    throw new ContextHubError('BAD_REQUEST', `Group '${groupId}' has reached the maximum of ${MAX_GROUP_MEMBERS} members`);
  }

  // Ensure project exists in projects table (upsert to be safe).
  await pool.query(
    `INSERT INTO projects (project_id, name) VALUES ($1, $1) ON CONFLICT (project_id) DO NOTHING`,
    [projectId],
  );

  const res = await pool.query(
    `INSERT INTO project_group_members (group_id, project_id)
     VALUES ($1, $2)
     ON CONFLICT DO NOTHING
     RETURNING project_id`,
    [groupId, projectId],
  );
  return { added: (res.rowCount ?? 0) > 0 };
}

export async function removeProjectFromGroup(groupId: string, projectId: string): Promise<{ removed: boolean }> {
  const pool = getDbPool();
  const res = await pool.query(
    `DELETE FROM project_group_members WHERE group_id = $1 AND project_id = $2 RETURNING project_id`,
    [groupId, projectId],
  );
  return { removed: (res.rowCount ?? 0) > 0 };
}

export async function listGroupsForProject(projectId: string): Promise<ProjectGroup[]> {
  const pool = getDbPool();
  const res = await pool.query(
    `SELECT g.*
     FROM project_groups g
     JOIN project_group_members m ON m.group_id = g.group_id
     WHERE m.project_id = $1
     ORDER BY g.created_at`,
    [projectId],
  );
  return (res.rows ?? []).map(mapGroupRow);
}

// ── List all projects ──

export type ProjectWithGroups = {
  project_id: string;
  name: string | null;
  description: string | null;
  color: string | null;
  settings: Record<string, unknown>;
  groups: Array<{ group_id: string; name: string }>;
  lesson_count: number;
};

/**
 * List all projects with their group memberships and lesson counts.
 * Used by the GUI for the project dropdown and hierarchy view.
 */
export async function listAllProjects(): Promise<ProjectWithGroups[]> {
  const pool = getDbPool();

  const res = await pool.query(
    `SELECT
       p.project_id,
       p.name,
       p.description,
       p.color,
       p.settings,
       COALESCE(lc.cnt, 0)::int AS lesson_count,
       COALESCE(
         json_agg(json_build_object('group_id', g.group_id, 'name', g.name))
           FILTER (WHERE g.group_id IS NOT NULL),
         '[]'
       ) AS groups
     FROM projects p
     LEFT JOIN project_group_members m ON m.project_id = p.project_id
     LEFT JOIN project_groups g ON g.group_id = m.group_id
     LEFT JOIN LATERAL (
       SELECT count(*)::int AS cnt FROM lessons WHERE project_id = p.project_id
     ) lc ON true
     GROUP BY p.project_id, p.name, p.description, p.color, p.settings, lc.cnt
     ORDER BY p.project_id`,
  );

  return (res.rows ?? []).map((r: any) => ({
    project_id: String(r.project_id),
    name: r.name != null ? String(r.name) : null,
    description: r.description != null ? String(r.description) : null,
    color: r.color != null ? String(r.color) : null,
    settings: (r.settings ?? {}) as Record<string, unknown>,
    groups: (r.groups ?? []) as Array<{ group_id: string; name: string }>,
    lesson_count: Number(r.lesson_count ?? 0),
  }));
}

// ── Create / Update project ──

const VALID_COLORS = ['blue', 'emerald', 'purple', 'amber', 'red', 'pink', 'cyan'];
const MAX_NAME_LENGTH = 256;
const MAX_DESCRIPTION_LENGTH = 2000;

function validateColor(color: string | undefined): void {
  if (color !== undefined && !VALID_COLORS.includes(color)) {
    throw new ContextHubError('BAD_REQUEST', `Invalid color "${color}". Allowed: ${VALID_COLORS.join(', ')}`);
  }
}

export async function createProject(params: {
  project_id: string;
  name?: string;
  description?: string;
  color?: string;
  settings?: Record<string, unknown>;
}): Promise<{ project_id: string }> {
  const pool = getDbPool();

  // Validate project_id format: lowercase alphanumeric + hyphens, no leading/trailing hyphens
  if (!/^[a-z0-9]([a-z0-9-]*[a-z0-9])?$/.test(params.project_id)) {
    throw new ContextHubError('BAD_REQUEST', 'Invalid project_id. Use lowercase letters, numbers, and hyphens only (no leading/trailing hyphens).');
  }
  if (params.project_id.length > 128) {
    throw new ContextHubError('BAD_REQUEST', 'project_id must be 128 characters or fewer.');
  }
  if (params.name && params.name.length > MAX_NAME_LENGTH) {
    throw new ContextHubError('BAD_REQUEST', `Name must be ${MAX_NAME_LENGTH} characters or fewer.`);
  }
  if (params.description && params.description.length > MAX_DESCRIPTION_LENGTH) {
    throw new ContextHubError('BAD_REQUEST', `Description must be ${MAX_DESCRIPTION_LENGTH} characters or fewer.`);
  }
  validateColor(params.color);

  try {
    await pool.query(
      `INSERT INTO projects (project_id, name, description, color, settings)
       VALUES ($1, $2, $3, $4, $5)`,
      [
        params.project_id,
        params.name ?? params.project_id,
        params.description ?? null,
        params.color ?? null,
        JSON.stringify(params.settings ?? {}),
      ],
    );
  } catch (err: any) {
    if (err?.code === '23505') { // unique_violation
      throw new ContextHubError('BAD_REQUEST', `Project "${params.project_id}" already exists.`);
    }
    throw err;
  }

  return { project_id: params.project_id };
}

export async function updateProject(
  projectId: string,
  params: { name?: string; description?: string; color?: string; settings?: Record<string, unknown> },
): Promise<{ project_id: string }> {
  const pool = getDbPool();

  if (params.name !== undefined && params.name.length > MAX_NAME_LENGTH) {
    throw new ContextHubError('BAD_REQUEST', `Name must be ${MAX_NAME_LENGTH} characters or fewer.`);
  }
  if (params.description !== undefined && params.description.length > MAX_DESCRIPTION_LENGTH) {
    throw new ContextHubError('BAD_REQUEST', `Description must be ${MAX_DESCRIPTION_LENGTH} characters or fewer.`);
  }
  validateColor(params.color);

  const sets: string[] = [];
  const vals: unknown[] = [];
  let idx = 1;

  if (params.name !== undefined) { sets.push(`name = $${idx++}`); vals.push(params.name); }
  if (params.description !== undefined) { sets.push(`description = $${idx++}`); vals.push(params.description); }
  if (params.color !== undefined) { sets.push(`color = $${idx++}`); vals.push(params.color); }
  if (params.settings !== undefined) { sets.push(`settings = $${idx++}`); vals.push(JSON.stringify(params.settings)); }

  if (sets.length === 0) return { project_id: projectId };

  sets.push(`updated_at = now()`);
  vals.push(projectId);

  const result = await pool.query(
    `UPDATE projects SET ${sets.join(', ')} WHERE project_id = $${idx}`,
    vals,
  );

  if (result.rowCount === 0) {
    throw new ContextHubError('NOT_FOUND', `Project "${projectId}" not found.`);
  }

  return { project_id: projectId };
}

// ── Resolver ──

/**
 * Given a project_id, returns that project_id plus all group_ids it belongs to.
 * Used to expand search queries across shared group knowledge.
 */
export async function resolveProjectIds(projectId: string, includeGroups: boolean): Promise<string[]> {
  if (!includeGroups) return [projectId];
  const pool = getDbPool();
  const res = await pool.query(
    `SELECT group_id FROM project_group_members WHERE project_id = $1`,
    [projectId],
  );
  const groupIds = (res.rows ?? []).map((r: any) => String(r.group_id));
  // Deduplicate: project first, then its groups.
  return [projectId, ...groupIds];
}

// ── Row mappers ──

function mapGroupRow(r: any): ProjectGroup {
  return {
    group_id: String(r.group_id),
    name: String(r.name),
    description: r.description != null ? String(r.description) : null,
    created_at: r.created_at,
    updated_at: r.updated_at,
  };
}

function mapGroupWithMembersRow(r: any): ProjectGroupWithMembers {
  return {
    ...mapGroupRow(r),
    member_count: Number(r.member_count ?? 0),
  };
}
