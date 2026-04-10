/**
 * Shared helper: parse project_ids[] or project_id from Express query/body.
 * Used by all routes that support multi-project queries.
 *
 * Precedence: project_ids[] (comma-separated or repeated) → project_id (single).
 * Throws if neither is provided and DEFAULT_PROJECT_ID is not set.
 */

import { resolveProjectIdOrThrow } from '../../core/index.js';

export type ProjectParams = { projectId: string; projectIds?: undefined } | { projectId?: undefined; projectIds: string[] };

/**
 * Parse project_ids from query params. Falls back to project_id.
 * Returns either { projectId } for single or { projectIds } for multi.
 */
export function resolveProjectParams(query: Record<string, any>): ProjectParams {
  const raw = query.project_ids;
  if (raw) {
    const ids = Array.isArray(raw)
      ? raw.map(String).filter(Boolean)
      : String(raw).split(',').map((s: string) => s.trim()).filter(Boolean);
    if (ids.length > 0) return { projectIds: ids };
  }
  return { projectId: resolveProjectIdOrThrow(query.project_id as string | undefined) };
}

/**
 * Resolve to a single value suitable for services that accept `string | string[]`.
 * Returns the projectIds array if present, otherwise the single projectId.
 */
export function resolveProjectIdOrIds(query: Record<string, any>): string | string[] {
  const p = resolveProjectParams(query);
  return p.projectIds ?? p.projectId;
}
