/**
 * Auto-resolve project root path from DB when not provided.
 * Lets external agents just pass project_id without knowing Docker container paths.
 *
 * Resolution order:
 *   1. Explicit root (if provided)
 *   2. project_sources.repo_root (set by configure_project_source / prepare_repo)
 *   3. project_workspaces.root_path (set by register_workspace_root)
 *   4. chunks.root (set by index_project)
 *   5. Error with helpful message
 */
import { getDbPool } from '../db/client.js';
import { getEnv } from '../env.js';
import { hasGlobalGrant } from '../services/authorize.js';
import { ContextHubError } from '../core/errors.js';
import { createModuleLogger } from './logger.js';

const logger = createModuleLogger('resolve-root');

/** Check if a path looks valid for the server (not a Windows path inside Docker). */
function isValidServerPath(p: string): boolean {
  // Reject Windows paths accidentally stored (e.g., /app/D:/Downloads/...)
  if (/\/[A-Z]:[\\/]/.test(p)) return false;
  // Reject empty or whitespace-only
  if (!p.trim()) return false;
  return true;
}

export async function resolveProjectRoot(
  projectId: string | null | undefined,
  explicitRoot?: string | null,
  // [DEFERRED-048] WHO authorized this explicit root: the calling principal for a synchronous request
  // (MCP tool / REST route), or the enqueue-time stamp (`payload.root_authorized_by`) for a job.
  authorizerPrincipalId?: string | null,
): Promise<string> {
  // If explicitly provided, use it.
  if (explicitRoot && explicitRoot.trim()) {
    // [DEFERRED-048] An explicit root makes the worker index an ARBITRARY filesystem path under the
    // bound project — a cross-tenant, GLOBAL capability. This is the SINGLE chokepoint that honors an
    // explicit root, reached by every caller (the index_project / git.ingest / workspace MCP tools, the
    // REST index/ingest routes, AND the job executor). Under enforcement, honor the explicit root only
    // if the authorizer still holds global write; else fail closed + LOUD (a silent fallback to the
    // configured project root would index a different tree than intended). Inert while auth is OFF
    // (hasGlobalGrant short-circuits true), so dev/root posture is unchanged.
    if (getEnv().MCP_AUTH_ENABLED && !(await hasGlobalGrant(authorizerPrincipalId, 'write'))) {
      throw new ContextHubError(
        'FORBIDDEN',
        'an explicit root path is a global capability — not authorized for this principal (omit root to use the project-configured root)',
      );
    }
    return explicitRoot.trim();
  }

  if (!projectId) {
    throw new Error(
      'root path is required. Either pass root explicitly, or set project_id to auto-resolve from project configuration.',
    );
  }

  const pool = getDbPool();

  // Try project_sources (set by configure_project_source / prepare_repo).
  // Prefer remote_git over local_workspace — remote_git paths are set by prepare_repo
  // and point to the Docker-internal repo cache. local_workspace paths may be invalid
  // Windows paths from external agents.
  // [DEFERRED-048 full closure] Under enforcement, a STORED root is honored only if the principal who
  // authorized it (the stamp set by the gated setters) still holds global write. A null stamp (auth-off /
  // pre-flip / legacy row) is NOT honored — the operator must (re)configure the source/workspace as a
  // global principal, which re-stamps. Inert while auth is OFF (hasGlobalGrant short-circuits true).
  const authEnforced = getEnv().MCP_AUTH_ENABLED;
  const storedRootAuthorized = async (authBy: unknown): Promise<boolean> =>
    !authEnforced || (await hasGlobalGrant(typeof authBy === 'string' ? authBy : null, 'write'));

  try {
    const res = await pool.query(
      // [DEFERRED-048 REVIEW-CODE p3 #2] filter enabled=true (symmetry with project_workspaces.is_active)
      // — a DISABLED source must not be honored, and the remote_git-first LIMIT 1 must not return a
      // disabled remote row that masks an active local one.
      `SELECT repo_root, repo_root_authorized_by, source_type FROM project_sources
       WHERE project_id = $1 AND repo_root IS NOT NULL AND repo_root != '' AND enabled = true
       ORDER BY CASE source_type WHEN 'remote_git' THEN 0 ELSE 1 END
       LIMIT 1`,
      [projectId],
    );
    if (res.rows?.[0]?.repo_root) {
      const root = String(res.rows[0].repo_root);
      if (isValidServerPath(root)) {
        if (await storedRootAuthorized(res.rows[0].repo_root_authorized_by)) {
          logger.info({ projectId, root, sourceType: res.rows[0].source_type, from: 'project_sources' }, 'auto-resolved root');
          return root;
        }
        logger.warn({ projectId, from: 'project_sources' }, '[DEFERRED-048] stored repo_root has no current global authorizer — not honored under enforcement; re-run configure_project_source as a global principal');
      } else {
        logger.warn({ projectId, root, from: 'project_sources' }, 'skipped invalid root path (Windows path in Docker?)');
      }
    }
  } catch { /* table may not exist */ }

  // Try project_workspaces (set by register_workspace_root). NB: the active filter is `is_active`
  // (the real column; an earlier `active` typo silently disabled this branch).
  try {
    const res = await pool.query(
      `SELECT root_path, root_path_authorized_by FROM project_workspaces WHERE project_id = $1 AND is_active = true LIMIT 1`,
      [projectId],
    );
    if (res.rows?.[0]?.root_path) {
      const root = String(res.rows[0].root_path);
      if (isValidServerPath(root)) {
        if (await storedRootAuthorized(res.rows[0].root_path_authorized_by)) {
          logger.info({ projectId, root, from: 'project_workspaces' }, 'auto-resolved root');
          return root;
        }
        logger.warn({ projectId, from: 'project_workspaces' }, '[DEFERRED-048] stored root_path has no current global authorizer — not honored under enforcement; re-run register_workspace_root as a global principal');
      } else {
        logger.warn({ projectId, root, from: 'project_workspaces' }, 'skipped invalid root path');
      }
    }
  } catch { /* table may not exist */ }

  // Try chunks (set by index_project) — a DERIVED path with NO authorizer provenance. Under enforcement
  // we cannot attest it was a global-authorized root, so it is NOT honored (a poisoned historical chunk
  // root would otherwise be re-indexed). Auth-off: honored as today.
  if (!authEnforced) {
    try {
      const res = await pool.query(
        `SELECT DISTINCT root FROM chunks WHERE project_id = $1 LIMIT 1`,
        [projectId],
      );
      if (res.rows?.[0]?.root) {
        const root = String(res.rows[0].root);
        if (isValidServerPath(root)) {
          logger.info({ projectId, root, from: 'chunks' }, 'auto-resolved root');
          return root;
        }
        logger.warn({ projectId, root, from: 'chunks' }, 'skipped invalid root path');
      }
    } catch { /* ignore */ }
  }

  throw new Error(
    `Could not auto-resolve root for project "${projectId}". ` +
    'Run one of these first: configure_project_source, prepare_repo, register_workspace_root, or index_project. ' +
    'Or pass root explicitly.',
  );
}
