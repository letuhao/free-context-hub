import { getDbPool } from '../db/client.js';
import { ContextHubError } from '../core/errors.js';
import { assertAuthorized, authorize } from './authorize.js';

const MAX_GROUP_MEMBERS = 50;

export type ProjectGroup = {
  group_id: string;
  name: string;
  description: string | null;
  created_at: Date;
  updated_at: Date;
};

export type ProjectGroupWithMembers = ProjectGroup & {
  // [DEFERRED-049] member_count is group TOPOLOGY — nullable so listGroups can REDACT it (null) for a
  // caller without a covering read@group grant while still listing the group name for the dropdown.
  member_count: number | null;
  members?: string[];
};

/**
 * [DEFERRED-049] The lessons-read UNION. Reading lesson rows stored under `id` (a data partition that may
 * be a project, a group, or — for legacy rows — both) is allowed if the caller can read it in EITHER
 * namespace. This is deliberate and scoped to the lessons-search surface ONLY (group TOPOLOGY ops stay
 * strict `group`). Preserves legacy project-read access AND enables group-shared reads. Auth-off →
 * authorize short-circuits ALLOW on the first check, so it returns true with no extra query.
 *
 * [adv REVIEW-CODE #1] The `read@group` arm is consulted ONLY when `id` is ACTUALLY a group. resolveResourceScope
 * trusts a group id WITHOUT an existence check (so createGroup can pre-authorize a not-yet-created group), so a
 * `read@group:<plain-project-id>` grant would otherwise resolve and leak that project's lessons — collapsing the
 * very namespaces B2 separates. Requiring a real `project_groups` row closes that.
 */
export async function canReadLessonsPartition(actingPrincipalId: string | null | undefined, id: string): Promise<boolean> {
  if ((await authorize(actingPrincipalId, 'read', { kind: 'project', id })).allow) return true;
  const isGroup = ((await getDbPool().query(`SELECT 1 FROM project_groups WHERE group_id = $1`, [id])).rowCount ?? 0) > 0;
  if (!isGroup) return false;
  return (await authorize(actingPrincipalId, 'read', { kind: 'group', id })).allow;
}

// ── CRUD ──

export async function createGroup(params: {
  group_id: string;
  /** F2f: acting principal; authorize() enforces write on the group (a projects-table row). */
  actingPrincipalId?: string | null;
  name: string;
  description?: string;
}): Promise<ProjectGroup> {
  // [DEFERRED-049 B2] A group authorizes in its OWN namespace (`group`), NOT `project` — so a project
  // grant on a same-named id no longer covers group creation. resolveResourceScope trusts a group id
  // with no existence check, so authorizing a not-yet-existent group works (as before).
  await assertAuthorized(params.actingPrincipalId, 'write', { kind: 'group', id: params.group_id });
  const pool = getDbPool();

  // [DEFERRED-049 B1] Collision-reject: do NOT silently `ON CONFLICT DO UPDATE` over an existing NON-group
  // project row (that would rename/take over a real project). If the id already names a projects row that
  // is not already a group, refuse. If it IS already a group, the upsert is a legitimate idempotent
  // rename. (TOCTOU between this check and the INSERT is accepted — group creation is a single-writer
  // admin path; the worst case is a benign rename the unique constraints still bound.)
  const collide = await pool.query<{ is_project: boolean; is_group: boolean }>(
    `SELECT EXISTS(SELECT 1 FROM projects WHERE project_id = $1) AS is_project,
            EXISTS(SELECT 1 FROM project_groups WHERE group_id = $1) AS is_group`,
    [params.group_id],
  );
  if (collide.rows[0]?.is_project && !collide.rows[0]?.is_group) {
    throw new ContextHubError(
      'BAD_REQUEST',
      `id "${params.group_id}" already names a project; choose a different group id.`,
    );
  }

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

export async function deleteGroup(
  groupId: string,
  opts?: { actingPrincipalId?: string | null },
): Promise<{ deleted: boolean }> {
  // Destructive whole-resource delete → admin on the group (mirrors deleteWorkspace=admin). [DEFERRED-046]
  // [DEFERRED-049 B2] strict `group` namespace.
  await assertAuthorized(opts?.actingPrincipalId, 'admin', { kind: 'group', id: groupId });
  const pool = getDbPool();
  // Members cascade-deleted via FK.
  const res = await pool.query(
    `DELETE FROM project_groups WHERE group_id = $1 RETURNING group_id`,
    [groupId],
  );
  return { deleted: (res.rowCount ?? 0) > 0 };
}

/**
 * [DEFERRED-049] The group NAME catalog stays shared-pool (the GUI dropdown needs every name), but
 * `member_count` is group TOPOLOGY: it is REDACTED to `null` for any group the caller lacks a covering
 * `read@group` grant on. So a scoped caller still sees the dropdown but learns nothing about group
 * composition they aren't entitled to. auth-off → authorize short-circuits ALLOW → all counts visible
 * (unchanged). The per-group reads `getGroup`/`listGroupMembers` remain strictly gated on read@group.
 */
export async function listGroups(actingPrincipalId?: string | null): Promise<ProjectGroupWithMembers[]> {
  const pool = getDbPool();
  const res = await pool.query(
    `SELECT g.*, COUNT(m.project_id)::int AS member_count
     FROM project_groups g
     LEFT JOIN project_group_members m ON m.group_id = g.group_id
     GROUP BY g.group_id
     ORDER BY g.created_at DESC`,
  );
  const rows = (res.rows ?? []).map(mapGroupWithMembersRow);
  // Redact member_count where the caller has no read@group (strict group namespace — member_count is
  // topology, not lessons data, so the lessons-read UNION does NOT apply here).
  for (const row of rows) {
    if (!(await authorize(actingPrincipalId, 'read', { kind: 'group', id: row.group_id })).allow) {
      row.member_count = null;
    }
  }
  return rows;
}

export async function getGroup(
  groupId: string,
  opts?: { actingPrincipalId?: string | null },
): Promise<ProjectGroupWithMembers | null> {
  // [DEFERRED-046/adv] group composition (member_count, membership) is the cross-project knowledge-flow
  // topology — read it only with read on the group. [DEFERRED-049 B2] strict `group` namespace.
  await assertAuthorized(opts?.actingPrincipalId, 'read', { kind: 'group', id: groupId });
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

export async function listGroupMembers(
  groupId: string,
  opts?: { actingPrincipalId?: string | null },
): Promise<string[]> {
  // [DEFERRED-046/adv] member project_ids are sensitive group topology — gate on read@group.
  // [DEFERRED-049 B2] strict `group` namespace.
  await assertAuthorized(opts?.actingPrincipalId, 'read', { kind: 'group', id: groupId });
  const pool = getDbPool();
  const res = await pool.query(
    `SELECT project_id FROM project_group_members WHERE group_id = $1 ORDER BY added_at`,
    [groupId],
  );
  return (res.rows ?? []).map((r: any) => String(r.project_id));
}

export async function addProjectToGroup(
  groupId: string,
  projectId: string,
  /** F2f: acting principal; authorize() enforces write on the project. */
  opts?: { actingPrincipalId?: string | null },
): Promise<{ added: boolean }> {
  // [DEFERRED-046] Splicing a project into a group widens cross-project knowledge flow (group ids fold
  // into search scope via resolveProjectIds), so require write on BOTH the member project AND the group
  // (strict-reject — first deny throws). Authorizing the group BEFORE the existence check below also
  // closes the old "Group X not found" existence oracle to anyone holding write on some other project.
  // [DEFERRED-049 B2] the member is a `project`; the group is the strict `group` namespace.
  await assertAuthorized(opts?.actingPrincipalId, 'write', { kind: 'project', id: projectId });
  await assertAuthorized(opts?.actingPrincipalId, 'write', { kind: 'group', id: groupId });
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

export async function removeProjectFromGroup(
  groupId: string,
  projectId: string,
  /** F2f: acting principal; authorize() enforces write on the project. */
  opts?: { actingPrincipalId?: string | null },
): Promise<{ removed: boolean }> {
  // [DEFERRED-046] write on BOTH the member project AND the group (strict-reject).
  // [DEFERRED-049 B2] the member is a `project`; the group is the strict `group` namespace.
  await assertAuthorized(opts?.actingPrincipalId, 'write', { kind: 'project', id: projectId });
  await assertAuthorized(opts?.actingPrincipalId, 'write', { kind: 'group', id: groupId });
  const pool = getDbPool();
  const res = await pool.query(
    `DELETE FROM project_group_members WHERE group_id = $1 AND project_id = $2 RETURNING project_id`,
    [groupId, projectId],
  );
  return { removed: (res.rowCount ?? 0) > 0 };
}

export async function listGroupsForProject(
  projectId: string,
  /** F2f: acting principal; authorize() enforces read on the project. */
  opts?: { actingPrincipalId?: string | null },
): Promise<ProjectGroup[]> {
  await assertAuthorized(opts?.actingPrincipalId, 'read', { kind: 'project', id: projectId });
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
export async function listAllProjects(actingPrincipalId?: string | null): Promise<ProjectWithGroups[]> {
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

  const rows = (res.rows ?? []).map((r: any) => ({
    project_id: String(r.project_id),
    name: r.name != null ? String(r.name) : null,
    description: r.description != null ? String(r.description) : null,
    color: r.color != null ? String(r.color) : null,
    settings: (r.settings ?? {}) as Record<string, unknown>,
    groups: (r.groups ?? []) as Array<{ group_id: string; name: string }>,
    lesson_count: Number(r.lesson_count ?? 0),
  }));

  // [Domain 8 / adversary] This "all projects" list returns per-project data (name/description/settings/
  // lesson_count), so FILTER to the projects the caller can read — otherwise it enumerates every tenant.
  // Per-row (not assertReadAll, which throws): an "all projects" view should show only what you may see,
  // not 403. auth-OFF → authorize short-circuits ALLOW → all kept (GUI "All Projects" unchanged in dev).
  const visible: ProjectWithGroups[] = [];
  for (const row of rows) {
    if ((await authorize(actingPrincipalId, 'read', { kind: 'project', id: row.project_id })).allow) {
      visible.push(row);
    }
  }
  return visible;
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
  /** F2f: acting principal; authorize() enforces write on the project id. A principal with a covering
   *  grant (its own project, or a global grant) may create; resolveResourceScope trusts `project` kind
   *  without an existence check, so authorizing a not-yet-existent project works. */
  actingPrincipalId?: string | null;
  name?: string;
  description?: string;
  color?: string;
  settings?: Record<string, unknown>;
}): Promise<{ project_id: string }> {
  await assertAuthorized(params.actingPrincipalId, 'write', { kind: 'project', id: params.project_id });
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
  params: {
    /** F2f: acting principal; authorize() enforces write on the project. */
    actingPrincipalId?: string | null;
    name?: string;
    description?: string;
    color?: string;
    settings?: Record<string, unknown>;
  },
): Promise<{ project_id: string }> {
  await assertAuthorized(params.actingPrincipalId, 'write', { kind: 'project', id: projectId });
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
 * Given a project_id, returns that project_id plus all group_ids it belongs to — used to expand search
 * queries across shared group knowledge.
 *
 * [DEFERRED-049 A2] Self-defending: the resolver now authorizes so its RESULT is safe to feed straight
 * into a `= ANY($1)` query (closing the structural risk that the defense lived only in N callers).
 *  - It throws if the caller cannot read the ENTRY project (their own project — a real error, surfaced
 *    by every existing consumer as its `projectIds[0]` / first loop iteration). An unplumbed
 *    `actingPrincipalId === undefined` under auth-ON → NO_PRINCIPAL deny → throw, i.e. a missing-plumbing
 *    bug fails LOUD (fail-closed), never a silent broaden. [adv REVIEW-DESIGN #3]
 *  - It KEEPS only the groups the caller may read at the lessons boundary (read@project OR read@group),
 *    silently dropping foreign/unreadable groups (best-effort enrichment, matching the consumers' current
 *    graceful-skip). auth-off → authorize short-circuits ALLOW → returns [project, ...allGroups] (unchanged).
 */
export async function resolveProjectIds(
  projectId: string,
  includeGroups: boolean,
  actingPrincipalId?: string | null,
): Promise<string[]> {
  // [review-impl #4] The self-defense applies to the EXPANSION path only. With includeGroups=false this is
  // a pure pass-through (`[projectId]`, no authz) — the caller authorizes the single id downstream exactly
  // as before; the "safe to feed = ANY()" guarantee covers the includeGroups=true result.
  if (!includeGroups) return [projectId];
  // First-line authz on the entry project itself (throws on deny). Under auth-off this short-circuits.
  await assertAuthorized(actingPrincipalId, 'read', { kind: 'project', id: projectId });
  const pool = getDbPool();
  const res = await pool.query(
    `SELECT group_id FROM project_group_members WHERE project_id = $1`,
    [projectId],
  );
  const groupIds = (res.rows ?? []).map((r: any) => String(r.group_id));
  const readable: string[] = [];
  for (const gid of groupIds) {
    if (await canReadLessonsPartition(actingPrincipalId, gid)) readable.push(gid);
  }
  // Deduplicate: project first, then its readable groups.
  return [projectId, ...readable];
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
