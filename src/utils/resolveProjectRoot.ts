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
): Promise<string> {
  // If explicitly provided, use it.
  if (explicitRoot && explicitRoot.trim()) return explicitRoot.trim();

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
  try {
    const res = await pool.query(
      `SELECT repo_root, source_type FROM project_sources
       WHERE project_id = $1 AND repo_root IS NOT NULL AND repo_root != ''
       ORDER BY CASE source_type WHEN 'remote_git' THEN 0 ELSE 1 END
       LIMIT 1`,
      [projectId],
    );
    if (res.rows?.[0]?.repo_root) {
      const root = String(res.rows[0].repo_root);
      if (isValidServerPath(root)) {
        logger.info({ projectId, root, sourceType: res.rows[0].source_type, from: 'project_sources' }, 'auto-resolved root');
        return root;
      }
      logger.warn({ projectId, root, from: 'project_sources' }, 'skipped invalid root path (Windows path in Docker?)');
    }
  } catch { /* table may not exist */ }

  // Try project_workspaces (set by register_workspace_root).
  try {
    const res = await pool.query(
      `SELECT root_path FROM project_workspaces WHERE project_id = $1 AND active = true LIMIT 1`,
      [projectId],
    );
    if (res.rows?.[0]?.root_path) {
      const root = String(res.rows[0].root_path);
      if (isValidServerPath(root)) {
        logger.info({ projectId, root, from: 'project_workspaces' }, 'auto-resolved root');
        return root;
      }
      logger.warn({ projectId, root, from: 'project_workspaces' }, 'skipped invalid root path');
    }
  } catch { /* table may not exist */ }

  // Try chunks (set by index_project).
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

  throw new Error(
    `Could not auto-resolve root for project "${projectId}". ` +
    'Run one of these first: configure_project_source, prepare_repo, register_workspace_root, or index_project. ' +
    'Or pass root explicitly.',
  );
}
