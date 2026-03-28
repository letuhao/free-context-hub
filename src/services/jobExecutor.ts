import path from 'node:path';

import { analyzeCommitImpact, ingestGitHistory } from './gitIntelligence.js';
import { claimNextQueuedJob, claimQueuedJobById, completeJob, enqueueJob, failJob, type JobType } from './jobQueue.js';
import { indexProject } from './indexer.js';
import { buildFaq } from './faqBuilder.js';
import { buildRaptorSummaries } from './raptorBuilder.js';
import { upsertGeneratedDocument } from './generatedDocs.js';
import { buildProjectMemoryArtifact } from './builderMemory.js';
import {
  buildLargeRepoProjectMemory,
  estimateRepoLinesByHeuristic,
  shouldUseLargeRepoBuilderMemory,
} from './builderMemoryLarge.js';
import { runQualityEvalAndPersist } from './qcEval.js';
import { prepareRepo } from './repoSources.js';
import { scanWorkspaceChanges } from './workspaceTracker.js';
import { getEnv } from '../env.js';
import { createModuleLogger } from '../utils/logger.js';
import { resolveProjectRoot } from '../utils/resolveProjectRoot.js';

const logger = createModuleLogger('jobExecutor');

/** Resolve root from payload or auto-resolve from project config. */
async function resolveRoot(projectId: string | null, payload: Record<string, unknown>): Promise<string> {
  return resolveProjectRoot(projectId, payload.root ? String(payload.root) : undefined);
}

async function executeByType(
  jobType: JobType,
  projectId: string | null,
  payload: Record<string, unknown>,
  correlationId: string | null,
  sourceJobId?: string,
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
      const root = await resolveRoot(projectId, payload);
      return (await ingestGitHistory({
        projectId,
        root,
        since: payload.since ? String(payload.since) : undefined,
        maxCommits: payload.max_commits ? Number(payload.max_commits) : undefined,
      })) as unknown as Record<string, unknown>;
    }
    case 'index.run': {
      if (!projectId) throw new Error('project_id is required for index.run');
      const root = await resolveRoot(projectId, payload);
      return (await indexProject({ projectId, root })) as unknown as Record<string, unknown>;
    }
    case 'workspace.scan': {
      if (!projectId) throw new Error('project_id is required for workspace.scan');
      const root = await resolveRoot(projectId, payload);
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
      const root = await resolveRoot(projectId, payload);
      return (await indexProject({ projectId, root })) as unknown as Record<string, unknown>;
    }
    case 'knowledge.refresh': {
      if (!projectId) throw new Error('project_id is required for knowledge.refresh');
      const commitSha = payload.commit_sha ? String(payload.commit_sha) : '';
      if (!commitSha) return { status: 'ok', skipped: true, reason: 'commit_sha not provided' };
      return (await analyzeCommitImpact({ projectId, commitSha, limit: payload.limit ? Number(payload.limit) : undefined })) as unknown as Record<string, unknown>;
    }
    case 'quality.eval': {
      if (!projectId) throw new Error('project_id is required for quality.eval');
      const env = getEnv();
      logger.info(
        {
          event: 'phase6_boundary',
          phase: 'quality.eval',
          project_id: projectId,
          correlation_id: chainCorrelation ?? null,
          source_job_id: sourceJobId ?? null,
          payload: {
            queries_path: String(payload.queries_path ?? env.QUALITY_EVAL_QUERIES_PATH),
            set_baseline: payload.set_baseline === true,
            hybrid_mode: payload.hybrid_mode,
          },
        },
        'phase6 quality.eval start',
      );
      const queriesPath = String(payload.queries_path ?? env.QUALITY_EVAL_QUERIES_PATH);
      const hybridMode: 'off' | 'lexical' =
        payload.hybrid_mode === 'lexical' ? 'lexical' : env.RETRIEVAL_HYBRID_ENABLED ? 'lexical' : 'off';
      const setBaseline = payload.set_baseline === true;
      const baselineDocKey = payload.baseline_doc_key ? String(payload.baseline_doc_key) : undefined;
      const { artifact, gate, baseline, doc_key } = await runQualityEvalAndPersist({
        projectId,
        env,
        queriesPath: path.resolve(queriesPath),
        hybridMode,
        sourceJobId,
        correlationId: chainCorrelation,
        setBaseline,
        baselineDocKey,
      });
      logger.info(
        {
          job_type: 'quality.eval',
          correlation_id: chainCorrelation,
          gate_result: gate.pass,
          gate_reason: gate.reason,
        },
        'phase6 quality eval',
      );
      return {
        status: 'ok',
        doc_key,
        gate_pass: gate.pass,
        gate_reason: gate.reason,
        gate_details: gate.details,
        totals: artifact.totals,
        fail_clusters: artifact.fail_clusters,
        baseline_present: Boolean(baseline),
      };
    }
    case 'knowledge.loop.shallow': {
      if (!projectId) throw new Error('project_id is required for knowledge.loop.shallow');
      const env = getEnv();
      logger.info(
        {
          event: 'phase6_boundary',
          phase: 'shallow',
          project_id: projectId,
          correlation_id: chainCorrelation ?? null,
          source_job_id: sourceJobId ?? null,
          payload: {
            root: String(payload.root ?? ''),
            run_faq: payload.run_faq !== false,
            run_raptor: payload.run_raptor !== false,
          },
        },
        'phase6 shallow start',
      );
      if (!env.KNOWLEDGE_LOOP_ENABLED) {
        logger.info({ correlation_id: chainCorrelation }, 'phase6 shallow skipped');
        return { status: 'ok', skipped: true, reason: 'KNOWLEDGE_LOOP_ENABLED=false' };
      }
      const root = await resolveRoot(projectId, payload);
      const runFaq = payload.run_faq !== false;
      const runRaptor = payload.run_raptor !== false;
      const parts: Record<string, unknown> = {};
      if (runFaq) {
        parts.faq = await buildFaq({
          projectId,
          root,
          sourceJobId,
          correlationId: chainCorrelation,
        });
      }
      if (runRaptor) {
        parts.raptor = await buildRaptorSummaries({
          projectId,
          root,
          pathGlob: payload.path_glob ? String(payload.path_glob) : undefined,
          maxLevels: payload.max_levels ? Number(payload.max_levels) : undefined,
          sourceJobId,
          correlationId: chainCorrelation,
        });
      }
      const idx = await indexProject({ projectId, root });
      const stamp = new Date().toISOString().replace(/[:.]/g, '-');
      const shallowKey = `phase6/shallow/${stamp}`;
      await upsertGeneratedDocument({
        projectId,
        docType: 'benchmark_artifact',
        docKey: shallowKey,
        title: `Phase6 shallow ${stamp}`,
        content: JSON.stringify({ parts, index: idx }, null, 2),
        metadata: {
          phase6: true,
          kind: 'shallow_loop',
          run_faq: runFaq,
          run_raptor: runRaptor,
          correlation_id: chainCorrelation ?? null,
          status: 'draft',
        },
        sourceJobId,
        correlationId: chainCorrelation,
      });
      logger.info({ correlation_id: chainCorrelation, shallow_doc_key: shallowKey }, 'phase6 shallow complete');
      return { status: 'ok', index: idx, shallow_doc_key: shallowKey };
    }
    case 'knowledge.loop.deep': {
      if (!projectId) throw new Error('project_id is required for knowledge.loop.deep');
      const env = getEnv();
      logger.info(
        {
          event: 'phase6_boundary',
          phase: 'deep',
          project_id: projectId,
          correlation_id: chainCorrelation ?? null,
          source_job_id: sourceJobId ?? null,
          payload: {
            root: String(payload.root ?? ''),
            max_rounds: Math.min(Math.max(Number(payload.max_rounds ?? 3), 1), 5),
            run_shallow: payload.run_shallow !== false,
            run_faq: payload.run_faq !== false,
            run_raptor: payload.run_raptor !== false,
            builder_memory: payload.builder_memory !== false,
            large_repo: payload.large_repo === true,
          },
        },
        'phase6 deep start',
      );
      if (!env.KNOWLEDGE_LOOP_ENABLED) {
        logger.info({ correlation_id: chainCorrelation }, 'phase6 deep skipped');
        return { status: 'ok', skipped: true, reason: 'KNOWLEDGE_LOOP_ENABLED=false' };
      }
      const root = await resolveRoot(projectId, payload);
      const maxRounds = Math.min(Math.max(Number(payload.max_rounds ?? 3), 1), 5);
      const queriesPath = String(payload.queries_path ?? env.QUALITY_EVAL_QUERIES_PATH);
      const hybridMode: 'off' | 'lexical' =
        payload.hybrid_mode === 'lexical' ? 'lexical' : env.RETRIEVAL_HYBRID_ENABLED ? 'lexical' : 'off';
      const parentRunId = payload.parent_run_id ? String(payload.parent_run_id) : 'run';
      let lastGate: { pass: boolean; reason: string } | null = null;
      let acceptedRound = 0;

      for (let round = 1; round <= maxRounds; round++) {
        if (payload.run_shallow !== false && round === 1) {
          if (payload.run_faq !== false) {
            await buildFaq({ projectId, root, sourceJobId, correlationId: chainCorrelation });
          }
          if (payload.run_raptor !== false) {
            await buildRaptorSummaries({
              projectId,
              root,
              pathGlob: payload.path_glob ? String(payload.path_glob) : undefined,
              maxLevels: payload.max_levels ? Number(payload.max_levels) : undefined,
              sourceJobId,
              correlationId: chainCorrelation,
            });
          }
        }
        if (round === 1 && payload.builder_memory !== false && env.BUILDER_MEMORY_ENABLED) {
          let estLoc = -1;
          try {
            estLoc = await estimateRepoLinesByHeuristic(root);
          } catch {
            /* ignore */
          }
          const useLarge = await shouldUseLargeRepoBuilderMemory({
            root,
            largeRepoPayload: payload.large_repo === true,
          });
          logger.info(
            {
              event: 'phase6_builder_memory_path',
              project_id: projectId,
              use_large_repo_pipeline: useLarge,
              estimated_loc_heuristic: estLoc,
              large_repo_threshold: env.BUILDER_MEMORY_LARGE_REPO_LOC_THRESHOLD,
              large_repo_payload: payload.large_repo === true,
            },
            'phase6 builder_memory: single-pass vs hierarchical (LOC heuristic is rough)',
          );
          const bm = useLarge
            ? await buildLargeRepoProjectMemory({
                projectId,
                root,
                correlationId: chainCorrelation,
                sourceJobId,
                strategy: payload.memory_strategy === 'language' ? 'language' : 'directory',
                maxShards:
                  payload.memory_max_shards !== undefined ? Number(payload.memory_max_shards) : undefined,
                runId: payload.memory_run_id ? String(payload.memory_run_id) : undefined,
                resumeFromShardIndex:
                  payload.memory_resume_from_shard_index !== undefined
                    ? Number(payload.memory_resume_from_shard_index)
                    : undefined,
              })
            : await buildProjectMemoryArtifact({
                projectId,
                root,
                correlationId: chainCorrelation,
                sourceJobId,
              });
          logger.info(
            {
              event: 'phase6_builder_memory',
              project_id: projectId,
              round,
              mode: useLarge ? 'large_repo' : 'single_pass',
              status: bm.status,
              doc_key:
                bm && 'global_doc_key' in bm && bm.global_doc_key
                  ? bm.global_doc_key
                  : 'doc_key' in bm
                    ? bm.doc_key ?? null
                    : null,
              reason: bm.reason ?? null,
            },
            'phase6 deep builder memory step',
          );
        }
        await indexProject({ projectId, root });
        const evalResult = await runQualityEvalAndPersist({
          projectId,
          env,
          queriesPath: path.resolve(queriesPath),
          hybridMode,
          sourceJobId,
          correlationId: chainCorrelation,
          setBaseline: false,
          docKeySuffix: `deep-${parentRunId}-r${round}-${Date.now()}`,
        });
        lastGate = { pass: evalResult.gate.pass, reason: evalResult.gate.reason };
        logger.info(
          {
            job_type: 'knowledge.loop.deep',
            correlation_id: chainCorrelation,
            round,
            max_rounds: maxRounds,
            gate_result: evalResult.gate.pass,
            gate_reason: evalResult.gate.reason,
            parent_run_id: parentRunId,
          },
          'phase6 deep round',
        );
        if (evalResult.gate.pass) {
          acceptedRound = round;
          break;
        }
      }

      const summaryStamp = new Date().toISOString().replace(/[:.]/g, '-');
      const summaryKey = `phase6/deep/summary/${summaryStamp}`;
      await upsertGeneratedDocument({
        projectId,
        docType: 'benchmark_artifact',
        docKey: summaryKey,
        title: `Phase6 deep summary ${summaryStamp}`,
        content: JSON.stringify(
          {
            max_rounds: maxRounds,
            accepted_round: acceptedRound,
            last_gate: lastGate,
            parent_run_id: parentRunId,
          },
          null,
          2,
        ),
        metadata: {
          phase6: true,
          kind: 'deep_loop_summary',
          correlation_id: chainCorrelation ?? null,
          status: 'draft',
        },
        sourceJobId,
        correlationId: chainCorrelation,
      });

      return {
        status: 'ok',
        max_rounds: maxRounds,
        accepted_round: acceptedRound,
        gate_pass: lastGate?.pass ?? false,
        gate_reason: lastGate?.reason,
        summary_doc_key: summaryKey,
        parent_run_id: parentRunId,
      };
    }
    case 'faq.build': {
      if (!projectId) throw new Error('project_id is required for faq.build');
      const root = await resolveRoot(projectId, payload);
      const res = await buildFaq({
        projectId,
        root,
        modules: Array.isArray(payload.modules) ? (payload.modules as any[]).map(s => String(s)) : undefined,
        maxItems: payload.max_items ? Number(payload.max_items) : undefined,
        outputTarget: payload.output_target ? (String(payload.output_target) as any) : undefined,
        sourceJobId,
        correlationId: chainCorrelation,
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
      const root = await resolveRoot(projectId, payload);
      const res = await buildRaptorSummaries({
        projectId,
        root,
        pathGlob: payload.path_glob ? String(payload.path_glob) : undefined,
        maxLevels: payload.max_levels ? Number(payload.max_levels) : undefined,
        sourceJobId,
        correlationId: chainCorrelation,
      });
      await enqueueJob({
        project_id: projectId,
        job_type: 'index.run',
        payload: { root },
        correlation_id: chainCorrelation,
      });
      return res as unknown as Record<string, unknown>;
    }
    case 'knowledge.memory.build': {
      if (!projectId) throw new Error('project_id is required for knowledge.memory.build');
      const root = await resolveRoot(projectId, payload);
      const res = await buildLargeRepoProjectMemory({
        projectId,
        root,
        correlationId: chainCorrelation,
        sourceJobId,
        runId: payload.run_id ? String(payload.run_id) : undefined,
        strategy: payload.strategy === 'language' ? 'language' : 'directory',
        maxShards: payload.max_shards !== undefined ? Number(payload.max_shards) : undefined,
        resumeFromShardIndex:
          payload.resume_from_shard_index !== undefined ? Number(payload.resume_from_shard_index) : undefined,
      });
      if (res.status === 'ok') {
        await enqueueJob({
          project_id: projectId,
          job_type: 'index.run',
          payload: { root },
          correlation_id: chainCorrelation,
        });
      }
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
    const phase6Types = new Set<JobType>([
      'quality.eval',
      'knowledge.loop.shallow',
      'knowledge.loop.deep',
      'knowledge.memory.build',
    ]);
    logger.info(
      {
        event: 'job_execute_begin',
        job_id: job.job_id,
        job_type: job.job_type,
        project_id: job.project_id,
        correlation_id: job.correlation_id,
        phase6: phase6Types.has(job.job_type),
      },
      'job started',
    );
    const result = await executeByType(job.job_type, job.project_id, job.payload, job.correlation_id, job.job_id);
    await completeJob(job.job_id);
    logger.info(
      {
        job_id: job.job_id,
        job_type: job.job_type,
        duration_ms: Date.now() - started,
        correlation_id: job.correlation_id,
        gate_result: typeof result.gate_pass === 'boolean' ? result.gate_pass : undefined,
        accepted_round: typeof result.accepted_round === 'number' ? result.accepted_round : undefined,
      },
      'job finished',
    );
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
    const phase6Types = new Set<JobType>([
      'quality.eval',
      'knowledge.loop.shallow',
      'knowledge.loop.deep',
      'knowledge.memory.build',
    ]);
    logger.info(
      {
        event: 'job_execute_begin',
        job_id: job.job_id,
        job_type: job.job_type,
        project_id: job.project_id,
        correlation_id: job.correlation_id,
        phase6: phase6Types.has(job.job_type),
      },
      'job started by id',
    );
    const result = await executeByType(job.job_type, job.project_id, job.payload, job.correlation_id, job.job_id);
    await completeJob(job.job_id);
    logger.info(
      {
        job_id: job.job_id,
        job_type: job.job_type,
        duration_ms: Date.now() - started,
        correlation_id: job.correlation_id,
        gate_result: typeof result.gate_pass === 'boolean' ? result.gate_pass : undefined,
        accepted_round: typeof result.accepted_round === 'number' ? result.accepted_round : undefined,
      },
      'job finished by id',
    );
    return { status: 'ok', job_id: job.job_id, job_type: job.job_type, result };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    await failJob(job.job_id, job.attempts, job.max_attempts, message);
    logger.error({ job_id: job.job_id, job_type: job.job_type, error: message }, 'job failed by id');
    return { status: 'error', job_id: job.job_id, job_type: job.job_type, error: message };
  }
}

