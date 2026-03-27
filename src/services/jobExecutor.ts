import { analyzeCommitImpact, ingestGitHistory } from './gitIntelligence.js';
import { claimNextQueuedJob, claimQueuedJobById, completeJob, enqueueJob, failJob, type JobType } from './jobQueue.js';
import { indexProject } from './indexer.js';
import { buildFaq } from './faqBuilder.js';
import { buildRaptorSummaries } from './raptorBuilder.js';
import { prepareRepo } from './repoSources.js';
import { scanWorkspaceChanges } from './workspaceTracker.js';
import { getEnv } from '../env.js';
import { createModuleLogger } from '../utils/logger.js';

const logger = createModuleLogger('jobExecutor');

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
    case 'faq.build': {
      if (!projectId) throw new Error('project_id is required for faq.build');
      const root = String(payload.root ?? '');
      if (!root) throw new Error('payload.root is required');
      const res = await buildFaq({
        projectId,
        root,
        modules: Array.isArray(payload.modules) ? (payload.modules as any[]).map(s => String(s)) : undefined,
        maxItems: payload.max_items ? Number(payload.max_items) : undefined,
        outputTarget: payload.output_target ? (String(payload.output_target) as any) : undefined,
      });
      await enqueueJob({
        project_id: projectId,
        job_type: 'index.run',
        payload: { root },
        correlation_id: chainCorrelation,
      });
      return res as unknown as Record<string, unknown>;
    }
    case 'raptor.build': {
      if (!projectId) throw new Error('project_id is required for raptor.build');
      const root = String(payload.root ?? '');
      if (!root) throw new Error('payload.root is required');
      const res = await buildRaptorSummaries({
        projectId,
        root,
        pathGlob: payload.path_glob ? String(payload.path_glob) : undefined,
        maxLevels: payload.max_levels ? Number(payload.max_levels) : undefined,
      });
      await enqueueJob({
        project_id: projectId,
        job_type: 'index.run',
        payload: { root },
        correlation_id: chainCorrelation,
      });
      return res as unknown as Record<string, unknown>;
    }
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
    logger.info(
      { job_id: job.job_id, job_type: job.job_type, project_id: job.project_id, correlation_id: job.correlation_id },
      'job started',
    );
    const result = await executeByType(job.job_type, job.project_id, job.payload, job.correlation_id);
    await completeJob(job.job_id);
    logger.info({ job_id: job.job_id, job_type: job.job_type, duration_ms: Date.now() - started }, 'job finished');
    return { status: 'ok', job_id: job.job_id, job_type: job.job_type, result };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    await failJob(job.job_id, job.attempts, job.max_attempts, message);
    logger.error({ job_id: job.job_id, job_type: job.job_type, error: message }, 'job failed');
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
    logger.info(
      { job_id: job.job_id, job_type: job.job_type, project_id: job.project_id, correlation_id: job.correlation_id },
      'job started by id',
    );
    const result = await executeByType(job.job_type, job.project_id, job.payload, job.correlation_id);
    await completeJob(job.job_id);
    logger.info({ job_id: job.job_id, job_type: job.job_type, duration_ms: Date.now() - started }, 'job finished by id');
    return { status: 'ok', job_id: job.job_id, job_type: job.job_type, result };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    await failJob(job.job_id, job.attempts, job.max_attempts, message);
    logger.error({ job_id: job.job_id, job_type: job.job_type, error: message }, 'job failed by id');
    return { status: 'error', job_id: job.job_id, job_type: job.job_type, error: message };
  }
}

