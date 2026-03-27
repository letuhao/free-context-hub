import { analyzeCommitImpact, ingestGitHistory } from './gitIntelligence.js';
import { claimNextQueuedJob, claimQueuedJobById, completeJob, enqueueJob, failJob, type JobType } from './jobQueue.js';
import { indexProject } from './indexer.js';
import { prepareRepo } from './repoSources.js';
import { scanWorkspaceChanges } from './workspaceTracker.js';
import { getEnv } from '../env.js';

async function executeByType(
  jobType: JobType,
  projectId: string | null,
  payload: Record<string, unknown>,
  correlationId: string | null,
): Promise<Record<string, unknown>> {
  const chainCorrelation = correlationId ?? undefined;
  switch (jobType) {
    case 'repo.sync': {
      if (!projectId) throw new Error('project_id is required for repo.sync');
      const env = getEnv();
      const gitUrl = String(payload.git_url ?? '');
      const cacheRoot = String(payload.cache_root ?? './.repo-cache');
      if (!gitUrl) throw new Error('payload.git_url is required');
      const res = await prepareRepo({
        projectId,
        gitUrl,
        cacheRoot,
        ref: payload.ref ? String(payload.ref) : undefined,
        depth: payload.depth ? Number(payload.depth) : undefined,
        sourceStorageMode: (payload.source_storage_mode ? String(payload.source_storage_mode) : env.SOURCE_STORAGE_MODE) as any,
      });
      if (res.status !== 'ok') throw new Error(res.error ?? 'repo.sync failed');
      await enqueueJob({
        project_id: projectId,
        job_type: 'git.ingest',
        payload: { root: res.repo_root, since: payload.since ?? null, max_commits: payload.max_commits ?? null },
        correlation_id: chainCorrelation,
      });
      await enqueueJob({
        project_id: projectId,
        job_type: 'index.run',
        payload: { root: res.repo_root },
        correlation_id: chainCorrelation,
      });
      return res as unknown as Record<string, unknown>;
    }
    case 'git.ingest': {
      if (!projectId) throw new Error('project_id is required for git.ingest');
      const root = String(payload.root ?? '');
      if (!root) throw new Error('payload.root is required');
      return (await ingestGitHistory({
        projectId,
        root,
        since: payload.since ? String(payload.since) : undefined,
        maxCommits: payload.max_commits ? Number(payload.max_commits) : undefined,
      })) as unknown as Record<string, unknown>;
    }
    case 'index.run': {
      if (!projectId) throw new Error('project_id is required for index.run');
      const root = String(payload.root ?? '');
      if (!root) throw new Error('payload.root is required');
      return (await indexProject({ projectId, root })) as unknown as Record<string, unknown>;
    }
    case 'workspace.scan': {
      if (!projectId) throw new Error('project_id is required for workspace.scan');
      const root = String(payload.root ?? '');
      if (!root) throw new Error('payload.root is required');
      const scan = await scanWorkspaceChanges({ projectId, rootPath: root, runDeltaIndex: false });
      await enqueueJob({
        project_id: projectId,
        job_type: 'workspace.delta_index',
        payload: { root },
        correlation_id: chainCorrelation,
      });
      await enqueueJob({
        project_id: projectId,
        job_type: 'knowledge.refresh',
        payload: { root },
        correlation_id: chainCorrelation,
      });
      return scan as unknown as Record<string, unknown>;
    }
    case 'workspace.delta_index': {
      if (!projectId) throw new Error('project_id is required for workspace.delta_index');
      const root = String(payload.root ?? '');
      if (!root) throw new Error('payload.root is required');
      return (await indexProject({ projectId, root })) as unknown as Record<string, unknown>;
    }
    case 'knowledge.refresh': {
      if (!projectId) throw new Error('project_id is required for knowledge.refresh');
      const commitSha = payload.commit_sha ? String(payload.commit_sha) : '';
      if (!commitSha) return { status: 'ok', skipped: true, reason: 'commit_sha not provided' };
      return (await analyzeCommitImpact({ projectId, commitSha, limit: payload.limit ? Number(payload.limit) : undefined })) as unknown as Record<string, unknown>;
    }
    case 'quality.eval':
      return { status: 'ok', skipped: true, reason: 'quality.eval is handled by benchmark harness' };
    default:
      throw new Error(`Unsupported job type: ${String(jobType)}`);
  }
}

export async function runNextJob(queueName = 'default'): Promise<{
  status: 'idle' | 'ok' | 'error';
  job_id?: string;
  job_type?: JobType;
  result?: Record<string, unknown>;
  error?: string;
}> {
  const job = await claimNextQueuedJob(queueName);
  if (!job) return { status: 'idle' };
  try {
    const started = Date.now();
    console.log(`[worker] job start id=${job.job_id} type=${job.job_type} project=${job.project_id ?? 'null'} corr=${job.correlation_id ?? 'null'}`);
    const result = await executeByType(job.job_type, job.project_id, job.payload, job.correlation_id);
    await completeJob(job.job_id);
    console.log(`[worker] job done  id=${job.job_id} type=${job.job_type} ms=${Date.now() - started}`);
    return { status: 'ok', job_id: job.job_id, job_type: job.job_type, result };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    await failJob(job.job_id, job.attempts, job.max_attempts, message);
    console.error(`[worker] job error id=${job.job_id} type=${job.job_type} msg=${message}`);
    return { status: 'error', job_id: job.job_id, job_type: job.job_type, error: message };
  }
}

export async function runJobById(jobId: string): Promise<{
  status: 'idle' | 'ok' | 'error';
  job_id?: string;
  job_type?: JobType;
  result?: Record<string, unknown>;
  error?: string;
}> {
  const job = await claimQueuedJobById(jobId);
  if (!job) return { status: 'idle' };
  try {
    const started = Date.now();
    console.log(`[worker] job start id=${job.job_id} type=${job.job_type} project=${job.project_id ?? 'null'} corr=${job.correlation_id ?? 'null'}`);
    const result = await executeByType(job.job_type, job.project_id, job.payload, job.correlation_id);
    await completeJob(job.job_id);
    console.log(`[worker] job done  id=${job.job_id} type=${job.job_type} ms=${Date.now() - started}`);
    return { status: 'ok', job_id: job.job_id, job_type: job.job_type, result };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    await failJob(job.job_id, job.attempts, job.max_attempts, message);
    console.error(`[worker] job error id=${job.job_id} type=${job.job_type} msg=${message}`);
    return { status: 'error', job_id: job.job_id, job_type: job.job_type, error: message };
  }
}

