import path from 'node:path';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';

import { getDbPool } from '../db/client.js';
import { indexProject } from './indexer.js';

const execFileAsync = promisify(execFile);

async function runGit(root: string, args: string[]): Promise<string> {
  const { stdout } = await execFileAsync('git', ['-C', root, ...args], { maxBuffer: 12 * 1024 * 1024 });
  return stdout ?? '';
}

export async function registerWorkspaceRoot(params: {
  projectId: string;
  rootPath: string;
  active?: boolean;
}): Promise<{ status: 'ok'; workspace_id: string; project_id: string; root_path: string }> {
  const pool = getDbPool();
  const root = path.resolve(params.rootPath);
  await pool.query(
    `INSERT INTO projects(project_id, name)
     VALUES ($1,$2)
     ON CONFLICT (project_id) DO NOTHING`,
    [params.projectId, params.projectId],
  );
  const q = await pool.query(
    `INSERT INTO project_workspaces(project_id, root_path, is_active, updated_at)
     VALUES ($1,$2,$3, now())
     ON CONFLICT (project_id, root_path)
     DO UPDATE SET is_active=EXCLUDED.is_active, updated_at=now()
     RETURNING workspace_id, project_id, root_path`,
    [params.projectId, root, params.active ?? true],
  );
  return {
    status: 'ok',
    workspace_id: String(q.rows?.[0]?.workspace_id ?? ''),
    project_id: String(q.rows?.[0]?.project_id ?? params.projectId),
    root_path: String(q.rows?.[0]?.root_path ?? root),
  };
}

export async function listWorkspaceRoots(projectId: string): Promise<{
  items: Array<{ workspace_id: string; root_path: string; is_active: boolean; updated_at: any }>;
}> {
  const pool = getDbPool();
  const q = await pool.query(
    `SELECT workspace_id, root_path, is_active, updated_at
     FROM project_workspaces
     WHERE project_id=$1
     ORDER BY updated_at DESC`,
    [projectId],
  );
  return { items: (q.rows ?? []) as any };
}

export async function scanWorkspaceChanges(params: {
  projectId: string;
  rootPath: string;
  runDeltaIndex?: boolean;
}): Promise<{
  status: 'ok' | 'error';
  root_path: string;
  modified_files: string[];
  untracked_files: string[];
  staged_files: string[];
  delta_id?: string;
  index_result?: { status: 'ok' | 'error'; files_indexed: number; duration_ms: number; errors: Array<{ path: string; message: string }> };
  error?: string;
}> {
  const pool = getDbPool();
  const root = path.resolve(params.rootPath);
  try {
    const raw = await runGit(root, ['status', '--porcelain']);
    const modified = new Set<string>();
    const untracked = new Set<string>();
    const staged = new Set<string>();
    for (const line of raw.split(/\r?\n/g)) {
      const trimmed = line.trimEnd();
      if (!trimmed) continue;
      const x = trimmed[0] ?? ' ';
      const y = trimmed[1] ?? ' ';
      const file = trimmed.slice(3).trim().replace(/\\/g, '/');
      if (!file) continue;
      if (x !== ' ' && x !== '?') staged.add(file);
      if (y !== ' ') modified.add(file);
      if (x === '?' && y === '?') untracked.add(file);
    }

    const reg = await registerWorkspaceRoot({ projectId: params.projectId, rootPath: root, active: true });
    const ins = await pool.query(
      `INSERT INTO workspace_deltas(project_id, workspace_id, root_path, modified_files, untracked_files, staged_files, scanned_at)
       VALUES ($1,$2,$3,$4::text[],$5::text[],$6::text[], now())
       RETURNING delta_id`,
      [params.projectId, reg.workspace_id, root, Array.from(modified), Array.from(untracked), Array.from(staged)],
    );

    let indexResult:
      | { status: 'ok' | 'error'; files_indexed: number; duration_ms: number; errors: Array<{ path: string; message: string }> }
      | undefined;
    if (params.runDeltaIndex) {
      indexResult = await indexProject({ projectId: params.projectId, root });
    }

    return {
      status: 'ok',
      root_path: root,
      modified_files: Array.from(modified),
      untracked_files: Array.from(untracked),
      staged_files: Array.from(staged),
      delta_id: String(ins.rows?.[0]?.delta_id ?? ''),
      index_result: indexResult,
    };
  } catch (err) {
    return {
      status: 'error',
      root_path: root,
      modified_files: [],
      untracked_files: [],
      staged_files: [],
      error: err instanceof Error ? err.message : String(err),
    };
  }
}

