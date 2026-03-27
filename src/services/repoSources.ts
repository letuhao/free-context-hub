import fs from 'node:fs/promises';
import path from 'node:path';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';

import { getDbPool } from '../db/client.js';
import { materializeRepoFromS3, syncSourceArtifactToS3 } from './sourceArtifacts.js';

const execFileAsync = promisify(execFile);

export type SourceType = 'remote_git' | 'local_workspace';

async function runGit(cwd: string, args: string[]): Promise<string> {
  const { stdout } = await execFileAsync('git', ['-C', cwd, ...args], { maxBuffer: 12 * 1024 * 1024 });
  return stdout ?? '';
}

export async function configureProjectSource(params: {
  projectId: string;
  sourceType: SourceType;
  gitUrl?: string;
  defaultRef?: string;
  repoRoot?: string;
  enabled?: boolean;
}): Promise<{ status: 'ok'; project_id: string; source_type: SourceType }> {
  const pool = getDbPool();
  await pool.query(
    `INSERT INTO projects(project_id, name)
     VALUES ($1,$2)
     ON CONFLICT (project_id) DO NOTHING`,
    [params.projectId, params.projectId],
  );
  await pool.query(
    `INSERT INTO project_sources(project_id, source_type, git_url, default_ref, repo_root, enabled, updated_at)
     VALUES ($1,$2,$3,$4,$5,$6, now())
     ON CONFLICT (project_id, source_type)
     DO UPDATE SET
       git_url=EXCLUDED.git_url,
       default_ref=EXCLUDED.default_ref,
       repo_root=EXCLUDED.repo_root,
       enabled=EXCLUDED.enabled,
       updated_at=now()`,
    [
      params.projectId,
      params.sourceType,
      params.gitUrl ?? null,
      params.defaultRef ?? 'main',
      params.repoRoot ? path.resolve(params.repoRoot) : null,
      params.enabled ?? true,
    ],
  );
  return { status: 'ok', project_id: params.projectId, source_type: params.sourceType };
}

export async function prepareRepo(params: {
  projectId: string;
  gitUrl: string;
  cacheRoot: string;
  ref?: string;
  depth?: number;
  sourceStorageMode?: 'local' | 's3' | 'hybrid';
}): Promise<{
  status: 'ok' | 'error';
  project_id: string;
  repo_root: string;
  resolved_ref?: string;
  last_sync_commit?: string;
  source_storage_mode?: 'local' | 's3' | 'hybrid';
  s3_sync?: {
    uploaded: boolean;
    artifact_key?: string;
    metadata_key?: string;
    warning?: string;
  };
  error?: string;
}> {
  const ref = (params.ref ?? 'main').trim() || 'main';
  const sourceStorageMode = params.sourceStorageMode ?? 'local';
  const safeProject = params.projectId.replace(/[^\w.-]+/g, '_');
  const repoRoot = path.resolve(params.cacheRoot, safeProject);
  try {
    await fs.mkdir(params.cacheRoot, { recursive: true });
    const gitDir = path.join(repoRoot, '.git');
    let isExisting = false;
    try {
      await fs.stat(gitDir);
      isExisting = true;
    } catch {
      isExisting = false;
    }

    if (!isExisting) {
      const restored = await materializeRepoFromS3({
        projectId: params.projectId,
        ref,
        repoRoot,
        mode: sourceStorageMode,
      });
      if (!restored.restored) {
        const parent = path.dirname(repoRoot);
        await fs.mkdir(parent, { recursive: true });
        const cloneArgs = ['clone'];
        if (params.depth && params.depth > 0) cloneArgs.push(`--depth=${Math.trunc(params.depth)}`);
        cloneArgs.push(params.gitUrl, repoRoot);
        await execFileAsync('git', cloneArgs, { maxBuffer: 12 * 1024 * 1024 });
      }
    } else {
      await runGit(repoRoot, ['remote', 'set-url', 'origin', params.gitUrl]);
      await runGit(repoRoot, ['fetch', '--all', '--tags']);
    }

    await runGit(repoRoot, ['checkout', ref]);
    await runGit(repoRoot, ['pull', '--ff-only', 'origin', ref]).catch(() => {});
    const commit = (await runGit(repoRoot, ['rev-parse', 'HEAD'])).trim();
    const s3Sync = await syncSourceArtifactToS3({
      projectId: params.projectId,
      ref,
      commitSha: commit,
      repoRoot,
      mode: sourceStorageMode,
    });

    await configureProjectSource({
      projectId: params.projectId,
      sourceType: 'remote_git',
      gitUrl: params.gitUrl,
      defaultRef: ref,
      repoRoot,
      enabled: true,
    });

    return {
      status: 'ok',
      project_id: params.projectId,
      repo_root: repoRoot,
      resolved_ref: ref,
      last_sync_commit: commit || undefined,
      source_storage_mode: sourceStorageMode,
      s3_sync: s3Sync,
    };
  } catch (err) {
    return {
      status: 'error',
      project_id: params.projectId,
      repo_root: repoRoot,
      source_storage_mode: sourceStorageMode,
      error: err instanceof Error ? err.message : String(err),
    };
  }
}

export async function getProjectSource(projectId: string, sourceType: SourceType): Promise<{
  project_id: string;
  source_type: SourceType;
  git_url: string | null;
  default_ref: string;
  repo_root: string | null;
  enabled: boolean;
} | null> {
  const pool = getDbPool();
  const res = await pool.query(
    `SELECT project_id, source_type, git_url, default_ref, repo_root, enabled
     FROM project_sources
     WHERE project_id=$1 AND source_type=$2
     LIMIT 1`,
    [projectId, sourceType],
  );
  return (res.rows?.[0] as any) ?? null;
}

