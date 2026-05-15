/**
 * Phase 13 Sprint 13.5 — Taxonomy profile service.
 * Phase 13 bug-fix SS2 — unified with the Phase 8 `lesson_types` registry.
 *
 * Architecture (Option 1): `lesson_types` is the single type-definition registry;
 * `taxonomy_profiles` rows store an array of `type_key` references into it.
 *   - registry rows with scope='global' are always-valid (5 builtins + custom types)
 *   - registry rows with scope='profile' are valid only via an active profile
 * Profile-returning functions HYDRATE the type_key refs back to {type,label,
 * description,color} objects so the REST + MCP output contracts are unchanged.
 *
 * Master design: docs/phase-13-design.md §"Feature 3: Domain Taxonomy Extension"
 * SS2 design:    docs/specs/2026-05-15-ss2-type-system-unification.md
 */

import { getDbPool } from '../db/client.js';
import { ContextHubError } from '../core/errors.js';
import { BUILTIN_LESSON_TYPES } from '../constants/lessonTypes.js';

export interface ProfileLessonType {
  type: string;
  label: string;
  description?: string;
  color?: string;
}

export interface TaxonomyProfile {
  profile_id: string;
  slug: string;
  name: string;
  description: string | null;
  version: string;
  lesson_types: ProfileLessonType[];
  is_builtin: boolean;
  owner_project_id: string | null;
  created_at: string;
  updated_at: string;
}

/** Raw DB row — `lesson_types` is a JSONB string-array of type_key references. */
interface ProfileRow {
  profile_id: string;
  slug: string;
  name: string;
  description: string | null;
  version: string;
  lesson_types: string[];
  is_builtin: boolean;
  owner_project_id: string | null;
  created_at: Date;
  updated_at: Date;
}

/**
 * Hydrate type_key references into full {type,label,description,color} objects
 * from the `lesson_types` registry, preserving the profile's declared order.
 * type_keys absent from the registry are dropped (defensive — should not happen).
 */
async function hydrateTypes(typeKeys: string[]): Promise<ProfileLessonType[]> {
  if (typeKeys.length === 0) return [];
  const pool = getDbPool();
  const r = await pool.query<{ type_key: string; display_name: string; description: string | null; color: string }>(
    `SELECT type_key, display_name, description, color FROM lesson_types WHERE type_key = ANY($1)`,
    [typeKeys],
  );
  const byKey = new Map(r.rows.map((row) => [row.type_key, row]));
  return typeKeys.flatMap((k) => {
    const row = byKey.get(k);
    if (!row) return [];
    return [{
      type: row.type_key,
      label: row.display_name,
      description: row.description ?? undefined,
      color: row.color ?? undefined,
    }];
  });
}

async function rowToProfile(r: ProfileRow): Promise<TaxonomyProfile> {
  return {
    profile_id: r.profile_id,
    slug: r.slug,
    name: r.name,
    description: r.description,
    version: r.version,
    lesson_types: await hydrateTypes(Array.isArray(r.lesson_types) ? r.lesson_types : []),
    is_builtin: r.is_builtin,
    owner_project_id: r.owner_project_id,
    created_at: r.created_at.toISOString(),
    updated_at: r.updated_at.toISOString(),
  };
}

/**
 * Register a profile's lesson types in the canonical `lesson_types` registry
 * (scope='profile') and return the ordered list of type_keys.
 *   - builtinProfile=false (custom): ON CONFLICT DO NOTHING — never touch an
 *     existing registry row (a global type, or a type another profile owns).
 *   - builtinProfile=true (bootstrap): ON CONFLICT DO UPDATE, but only when the
 *     existing row is already scope='profile' — so re-seeding a built-in profile
 *     refreshes its type metadata without ever clobbering a global type.
 * Non-transactional: a failed profile INSERT downstream leaves only inert
 * registry rows (a scope='profile' type no profile references — never valid).
 */
async function registerProfileTypes(types: ProfileLessonType[], builtinProfile: boolean): Promise<string[]> {
  const pool = getDbPool();
  const keys: string[] = [];
  for (const t of types) {
    if (builtinProfile) {
      await pool.query(
        `INSERT INTO lesson_types (type_key, display_name, description, color, is_builtin, scope)
         VALUES ($1, $2, $3, $4, true, 'profile')
         ON CONFLICT (type_key) DO UPDATE SET
           display_name = EXCLUDED.display_name,
           description  = EXCLUDED.description,
           color        = EXCLUDED.color
         WHERE lesson_types.scope = 'profile'`,
        [t.type, t.label, t.description ?? null, t.color ?? 'zinc'],
      );
    } else {
      await pool.query(
        `INSERT INTO lesson_types (type_key, display_name, description, color, is_builtin, scope)
         VALUES ($1, $2, $3, $4, false, 'profile')
         ON CONFLICT (type_key) DO NOTHING`,
        [t.type, t.label, t.description ?? null, t.color ?? 'zinc'],
      );
    }
    keys.push(t.type);
  }
  return keys;
}

/**
 * List profiles with optional filters.
 *   owner_project_id?: null (built-ins only) | string (custom for that project) | undefined (all)
 *   is_builtin?: boolean filter
 */
export async function listTaxonomyProfiles(params: {
  owner_project_id?: string | null;
  is_builtin?: boolean;
}): Promise<TaxonomyProfile[]> {
  const pool = getDbPool();
  const where: string[] = [];
  const args: unknown[] = [];

  if (params.owner_project_id === null) {
    where.push(`owner_project_id IS NULL`);
  } else if (typeof params.owner_project_id === 'string') {
    where.push(`owner_project_id = $${args.length + 1}`);
    args.push(params.owner_project_id);
  }

  if (typeof params.is_builtin === 'boolean') {
    where.push(`is_builtin = $${args.length + 1}`);
    args.push(params.is_builtin);
  }

  const whereClause = where.length > 0 ? `WHERE ${where.join(' AND ')}` : '';
  const r = await pool.query<ProfileRow>(
    `SELECT profile_id, slug, name, description, version, lesson_types,
            is_builtin, owner_project_id, created_at, updated_at
     FROM taxonomy_profiles
     ${whereClause}
     ORDER BY is_builtin DESC, slug ASC`,
    args,
  );
  return Promise.all(r.rows.map(rowToProfile));
}

export async function getTaxonomyProfileBySlug(
  slug: string,
  ownerProjectId: string | null,
): Promise<TaxonomyProfile | null> {
  const pool = getDbPool();
  const r = await pool.query<ProfileRow>(
    ownerProjectId === null
      ? `SELECT * FROM taxonomy_profiles WHERE slug = $1 AND owner_project_id IS NULL`
      : `SELECT * FROM taxonomy_profiles WHERE slug = $1 AND owner_project_id = $2`,
    ownerProjectId === null ? [slug] : [slug, ownerProjectId],
  );
  return r.rows.length === 0 ? null : rowToProfile(r.rows[0]);
}

export async function getTaxonomyProfileById(profileId: string): Promise<TaxonomyProfile | null> {
  const pool = getDbPool();
  const r = await pool.query<ProfileRow>(
    `SELECT * FROM taxonomy_profiles WHERE profile_id = $1`,
    [profileId],
  );
  return r.rows.length === 0 ? null : rowToProfile(r.rows[0]);
}

/**
 * Create a custom taxonomy profile. is_builtin is FORCED to false.
 * Shadowing of built-in type names is rejected (per master design L539-540).
 * The profile's types are registered in the `lesson_types` registry (scope='profile')
 * and the profile row stores type_key references.
 */
export async function createTaxonomyProfile(params: {
  slug: string;
  name: string;
  description?: string;
  version?: string;
  lesson_types: ProfileLessonType[];
  owner_project_id: string;  // required for custom profiles
}): Promise<TaxonomyProfile> {
  if (!params.slug || !params.name || !params.lesson_types || params.lesson_types.length === 0) {
    throw new ContextHubError('BAD_REQUEST', 'slug, name, and at least one lesson_type are required');
  }
  if (!params.owner_project_id) {
    throw new ContextHubError('BAD_REQUEST', 'owner_project_id is required for custom profiles');
  }

  // Validate types
  const shadowed: string[] = [];
  const seen = new Set<string>();
  for (const lt of params.lesson_types) {
    if (!lt.type || !lt.label) {
      throw new ContextHubError('BAD_REQUEST', `lesson_types entries must have non-empty 'type' and 'label'`);
    }
    if ((BUILTIN_LESSON_TYPES as readonly string[]).includes(lt.type)) {
      shadowed.push(lt.type);
    }
    if (seen.has(lt.type)) {
      throw new ContextHubError('BAD_REQUEST', `lesson_types contains duplicate type '${lt.type}'`);
    }
    seen.add(lt.type);
  }
  if (shadowed.length > 0) {
    throw new ContextHubError(
      'BAD_REQUEST',
      `Profile lesson_types cannot shadow built-in types: ${shadowed.join(', ')}`,
    );
  }

  const keys = await registerProfileTypes(params.lesson_types, false);

  const pool = getDbPool();
  try {
    const r = await pool.query<ProfileRow>(
      `INSERT INTO taxonomy_profiles
         (slug, name, description, version, lesson_types, is_builtin, owner_project_id)
       VALUES ($1, $2, $3, $4, $5::jsonb, false, $6)
       RETURNING *`,
      [
        params.slug,
        params.name,
        params.description ?? null,
        params.version ?? '1.0',
        JSON.stringify(keys),
        params.owner_project_id,
      ],
    );
    return rowToProfile(r.rows[0]);
  } catch (err: unknown) {
    if ((err as { code?: string }).code === '23505') {
      throw new ContextHubError(
        'BAD_REQUEST',
        `Profile with slug '${params.slug}' already exists for owner '${params.owner_project_id}'`,
      );
    }
    throw err;
  }
}

/**
 * Bootstrap: upsert a built-in profile from JSON (called from server startup).
 * is_builtin is FORCED to true, owner_project_id to NULL. The profile's types are
 * (re-)registered in the `lesson_types` registry so editing the bundled JSON and
 * restarting refreshes the registry.
 */
export async function upsertBuiltinProfile(params: {
  slug: string;
  name: string;
  description?: string;
  version?: string;
  lesson_types: ProfileLessonType[];
}): Promise<TaxonomyProfile> {
  const keys = await registerProfileTypes(params.lesson_types, true);

  const pool = getDbPool();
  const r = await pool.query<ProfileRow>(
    `INSERT INTO taxonomy_profiles
       (slug, name, description, version, lesson_types, is_builtin, owner_project_id)
     VALUES ($1, $2, $3, $4, $5::jsonb, true, NULL)
     ON CONFLICT (slug, owner_project_id) DO UPDATE SET
       name = EXCLUDED.name,
       description = EXCLUDED.description,
       version = EXCLUDED.version,
       lesson_types = EXCLUDED.lesson_types,
       updated_at = now()
     RETURNING *`,
    [
      params.slug,
      params.name,
      params.description ?? null,
      params.version ?? '1.0',
      JSON.stringify(keys),
    ],
  );
  return rowToProfile(r.rows[0]);
}

/**
 * Get the active taxonomy profile for a project (or null if none active).
 */
export async function getActiveProfile(projectId: string): Promise<TaxonomyProfile | null> {
  const pool = getDbPool();
  const r = await pool.query<ProfileRow>(
    `SELECT tp.* FROM taxonomy_profiles tp
     JOIN project_taxonomy_profiles ptp ON ptp.profile_id = tp.profile_id
     WHERE ptp.project_id = $1`,
    [projectId],
  );
  return r.rows.length === 0 ? null : rowToProfile(r.rows[0]);
}

/**
 * Activate a profile by slug for a project.
 * Profile must be either: built-in (owner_project_id IS NULL) OR owned by this project.
 */
export async function activateProfile(params: {
  project_id: string;
  slug: string;
  activated_by?: string;
}): Promise<{ status: 'activated'; profile: TaxonomyProfile } | { status: 'profile_not_found' }> {
  const pool = getDbPool();
  // Look up profile: either built-in (NULL owner) or owned by this project.
  const pr = await pool.query<ProfileRow>(
    `SELECT * FROM taxonomy_profiles
     WHERE slug = $1 AND (owner_project_id IS NULL OR owner_project_id = $2)
     ORDER BY owner_project_id NULLS LAST
     LIMIT 1`,
    [params.slug, params.project_id],
  );
  if (pr.rows.length === 0) return { status: 'profile_not_found' };
  const profile = pr.rows[0];

  await pool.query(
    `INSERT INTO project_taxonomy_profiles (project_id, profile_id, activated_at, activated_by)
     VALUES ($1, $2, now(), $3)
     ON CONFLICT (project_id) DO UPDATE SET
       profile_id = EXCLUDED.profile_id,
       activated_at = EXCLUDED.activated_at,
       activated_by = EXCLUDED.activated_by`,
    [params.project_id, profile.profile_id, params.activated_by ?? null],
  );
  return { status: 'activated', profile: await rowToProfile(profile) };
}

/**
 * Deactivate the active profile for a project. Idempotent.
 */
export async function deactivateProfile(projectId: string): Promise<{ status: 'deactivated' | 'no_active_profile' }> {
  const pool = getDbPool();
  const r = await pool.query(
    `DELETE FROM project_taxonomy_profiles WHERE project_id = $1`,
    [projectId],
  );
  return { status: (r.rowCount ?? 0) > 0 ? 'deactivated' : 'no_active_profile' };
}

/**
 * Get all valid lesson types for a project: every scope='global' registry type
 * (the 5 builtins + Phase 8 custom types) + the active profile's types (if any).
 * Single source of truth for lesson_type validation in add_lesson + REST
 * POST /api/lessons + the import path.
 */
export async function getValidLessonTypes(projectId: string): Promise<string[]> {
  const pool = getDbPool();
  const globals = await pool.query<{ type_key: string }>(
    `SELECT type_key FROM lesson_types WHERE scope = 'global'`,
  );
  // BUILTIN_LESSON_TYPES is a defensive floor in case the registry seed is incomplete.
  const valid = new Set<string>([...BUILTIN_LESSON_TYPES, ...globals.rows.map((r) => r.type_key)]);
  const active = await getActiveProfile(projectId);
  if (active) for (const t of active.lesson_types) valid.add(t.type);
  return [...valid];
}

/**
 * Validate a lesson_type for a project. Throws ContextHubError('BAD_REQUEST') if invalid.
 */
export async function validateLessonType(projectId: string, lessonType: string): Promise<void> {
  const valid = await getValidLessonTypes(projectId);
  if (!valid.includes(lessonType)) {
    throw new ContextHubError(
      'BAD_REQUEST',
      `Invalid lesson_type '${lessonType}' for project '${projectId}'. Valid types: ${valid.join(', ')}`,
    );
  }
}

/**
 * Get the human-readable label for a lesson_type from the `lesson_types` registry.
 * Falls back to the raw type string when the type is not registered.
 */
export async function getLessonTypeLabel(_projectId: string, type: string): Promise<string> {
  const pool = getDbPool();
  const r = await pool.query<{ display_name: string }>(
    `SELECT display_name FROM lesson_types WHERE type_key = $1`,
    [type],
  );
  return r.rows.length > 0 ? r.rows[0].display_name : type;
}
