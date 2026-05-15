/**
 * Phase 13 Sprint 13.5 — Taxonomy profile service.
 *
 * Manages domain taxonomy profiles (custom lesson_type vocabularies per project).
 *
 * Master design: docs/phase-13-design.md §"Feature 3: Domain Taxonomy Extension"
 * Spec: docs/specs/2026-05-15-phase-13-sprint-13.5-spec.md (v2)
 */

import { getDbPool } from '../db/client.js';
import { ContextHubError } from '../core/errors.js';
import { BUILTIN_LESSON_TYPES } from '../constants/lessonTypes.js';
import { createModuleLogger } from '../utils/logger.js';

const logger = createModuleLogger('taxonomy');

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

interface ProfileRow {
  profile_id: string;
  slug: string;
  name: string;
  description: string | null;
  version: string;
  lesson_types: ProfileLessonType[];
  is_builtin: boolean;
  owner_project_id: string | null;
  created_at: Date;
  updated_at: Date;
}

function rowToProfile(r: ProfileRow): TaxonomyProfile {
  return {
    profile_id: r.profile_id,
    slug: r.slug,
    name: r.name,
    description: r.description,
    version: r.version,
    lesson_types: r.lesson_types,
    is_builtin: r.is_builtin,
    owner_project_id: r.owner_project_id,
    created_at: r.created_at.toISOString(),
    updated_at: r.updated_at.toISOString(),
  };
}

/**
 * List profiles with optional filters.
 *   owner_project_id?: 'NULL' (built-ins only) | string (custom for that project) | undefined (all)
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
  return r.rows.map(rowToProfile);
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
        JSON.stringify(params.lesson_types),
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
 * is_builtin is FORCED to true, owner_project_id to NULL.
 */
export async function upsertBuiltinProfile(params: {
  slug: string;
  name: string;
  description?: string;
  version?: string;
  lesson_types: ProfileLessonType[];
}): Promise<TaxonomyProfile> {
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
      JSON.stringify(params.lesson_types),
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
  return { status: 'activated', profile: rowToProfile(profile) };
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
 * Get all valid lesson types for a project: built-ins + active profile types (if any).
 * Used as the single source of truth for lesson_type validation in add_lesson +
 * REST POST /api/lessons + import path.
 */
export async function getValidLessonTypes(projectId: string): Promise<string[]> {
  const active = await getActiveProfile(projectId);
  const profileTypes = active ? active.lesson_types.map((t) => t.type) : [];
  return [...BUILTIN_LESSON_TYPES, ...profileTypes];
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
 * Get the human-readable label for a lesson_type. Falls back to the raw type
 * string if not in the active profile (covers built-ins + deactivated profile types).
 */
export async function getLessonTypeLabel(projectId: string, type: string): Promise<string> {
  const active = await getActiveProfile(projectId);
  if (active) {
    const found = active.lesson_types.find((t) => t.type === type);
    if (found) return found.label;
  }
  return type;
}
