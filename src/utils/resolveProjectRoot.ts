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
  try {
    const res = await pool.query(
      `SELECT repo_root FROM project_sources WHERE project_id = $1 AND repo_root IS NOT NULL LIMIT 1`,
      [projectId],
    );
    if (res.rows?.[0]?.repo_root) {
      const root = String(res.rows[0].repo_root);
      logger.info({ projectId, root, from: 'project_sources' }, 'auto-resolved root');
      return root;
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
      logger.info({ projectId, root, from: 'project_workspaces' }, 'auto-resolved root');
      return root;
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
      logger.info({ projectId, root, from: 'chunks' }, 'auto-resolved root');
      return root;
    }
  } catch { /* ignore */ }

  throw new Error(
    `Could not auto-resolve root for project "${projectId}". ` +
    'Run one of these first: configure_project_source, prepare_repo, register_workspace_root, or index_project. ' +
    'Or pass root explicitly.',
  );
}
