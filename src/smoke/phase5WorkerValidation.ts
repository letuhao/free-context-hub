import * as dotenv from 'dotenv';
import fs from 'node:fs/promises';
import path from 'node:path';

import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';
import { CallToolResultSchema } from '@modelcontextprotocol/sdk/types.js';

dotenv.config();

function extractJson(result: any) {
  const content = result?.content ?? [];
  const firstText = content.find((c: any) => c?.type === 'text')?.text;
  if (typeof firstText !== 'string') throw new Error('Tool result missing text payload');
  const raw = firstText.trim();
  try {
    return JSON.parse(raw);
  } catch {
    const s = raw.indexOf('{');
    const e = raw.lastIndexOf('}');
    if (s >= 0 && e >= s) return JSON.parse(raw.slice(s, e + 1));
    throw new Error(`Cannot parse json from tool output: ${raw.slice(0, 200)}`);
  }
}

async function callTool(client: Client, name: string, args: Record<string, unknown>) {
  const out = await client.request(
    {
      method: 'tools/call',
      params: { name, arguments: args },
    },
    CallToolResultSchema,
  );
  return extractJson(out);
}

async function sleep(ms: number) {
  await new Promise(resolve => setTimeout(resolve, ms));
}

async function main() {
  const token = process.env.CONTEXT_HUB_WORKSPACE_TOKEN;
  const tokenArgs = token && token.trim().length ? { workspace_token: token } : {};
  const serverUrl = process.env.MCP_SERVER_URL ?? 'http://localhost:3000/mcp';
  const projectId = process.env.VALIDATE_PROJECT_ID ?? 'bench-free-context-hub';
  const gitUrl = process.env.VALIDATE_GIT_URL ?? 'https://github.com/letuhao/free-context-hub';
  const ref = process.env.VALIDATE_GIT_REF ?? 'main';
  const sourceStorageMode = process.env.SOURCE_STORAGE_MODE ?? 'hybrid';
  const outputDir = path.resolve(process.env.VALIDATE_OUTPUT_DIR ?? 'docs/benchmarks/artifacts');
  const workspaceRoot = process.env.VALIDATE_WORKSPACE_ROOT;
  const started = Date.now();

  const client = new Client({ name: 'phase5-worker-validation', version: '0.1.0' }, { capabilities: {} });
  const transport = new StreamableHTTPClientTransport(new URL(serverUrl), {});
  await client.connect(transport);

  const timeline: Array<{ step: string; at: string; data: any }> = [];
  const mark = (step: string, data: any) => timeline.push({ step, at: new Date().toISOString(), data });

  try {
    const sourceCfg = await callTool(client, 'configure_project_source', {
      ...tokenArgs,
      project_id: projectId,
      source_type: 'remote_git',
      git_url: gitUrl,
      default_ref: ref,
      output_format: 'json_only',
    });
    mark('configure_project_source', sourceCfg);

    const prepared = await callTool(client, 'prepare_repo', {
      ...tokenArgs,
      project_id: projectId,
      git_url: gitUrl,
      ref,
      source_storage_mode: sourceStorageMode,
      output_format: 'json_only',
    });
    mark('prepare_repo', prepared);

    const enq = await callTool(client, 'enqueue_job', {
      ...tokenArgs,
      project_id: projectId,
      job_type: 'repo.sync',
      payload: { git_url: gitUrl, ref, source_storage_mode: sourceStorageMode },
      output_format: 'json_only',
    });
    mark('enqueue_job.repo_sync', enq);

    const pollDeadline = Date.now() + 120_000;
    let lastJobs: any = { items: [] };
    while (Date.now() < pollDeadline) {
      lastJobs = await callTool(client, 'list_jobs', {
        ...tokenArgs,
        project_id: projectId,
        limit: 50,
        output_format: 'json_only',
      });
      const items = (lastJobs.items ?? []) as Array<any>;
      const hasRepoSyncOk = items.some(i => i.job_type === 'repo.sync' && i.status === 'succeeded');
      const hasIngestOk = items.some(i => i.job_type === 'git.ingest' && i.status === 'succeeded');
      const hasIndexOk = items.some(i => i.job_type === 'index.run' && i.status === 'succeeded');
      if (hasRepoSyncOk && hasIngestOk && hasIndexOk) break;
      await sleep(2000);
    }
    mark('list_jobs.poll', lastJobs);

    const commits = await callTool(client, 'list_commits', {
      ...tokenArgs,
      project_id: projectId,
      limit: 5,
      output_format: 'json_only',
    });
    mark('list_commits', { count: commits.items?.length ?? 0 });
    const firstSha = String(commits.items?.[0]?.sha ?? '');
    const oneCommit = firstSha
      ? await callTool(client, 'get_commit', {
          ...tokenArgs,
          project_id: projectId,
          sha: firstSha,
          output_format: 'json_only',
        })
      : { commit: null, files: [] };
    mark('get_commit', { sha: firstSha, files: oneCommit.files?.length ?? 0 });

    const queries = ['queue worker', 'prepare_repo', 'ingest_git_history', 'workspace scan', 'project_sources'];
    const search: any[] = [];
    for (const q of queries) {
      const t0 = Date.now();
      const out = await callTool(client, 'search_code', {
        ...tokenArgs,
        project_id: projectId,
        query: q,
        limit: 5,
        output_format: 'json_only',
      });
      search.push({ query: q, duration_ms: Date.now() - t0, matches: out.matches?.length ?? 0 });
    }
    mark('search_code.batch', search);

    const suggestions = await callTool(client, 'suggest_lessons_from_commits', {
      ...tokenArgs,
      project_id: projectId,
      commit_shas: firstSha ? [firstSha] : undefined,
      limit: 1,
      output_format: 'json_only',
    });
    mark('suggest_lessons_from_commits', { proposals: suggestions.proposals?.length ?? 0 });

    const lesson = await callTool(client, 'add_lesson', {
      ...tokenArgs,
      lesson_payload: {
        project_id: projectId,
        lesson_type: 'general_note',
        title: 'Validation lesson link',
        content: 'Temporary lesson for phase5 worker validation.',
        tags: ['validation', 'phase5-worker'],
        source_refs: firstSha ? [`git:${firstSha}`] : [],
      },
      output_format: 'json_only',
    });
    mark('add_lesson', lesson);

    const linked = firstSha
      ? await callTool(client, 'link_commit_to_lesson', {
          ...tokenArgs,
          project_id: projectId,
          commit_sha: firstSha,
          lesson_id: lesson.lesson_id,
          output_format: 'json_only',
        })
      : { status: 'skipped' };
    mark('link_commit_to_lesson', linked);

    const impact = firstSha
      ? await callTool(client, 'analyze_commit_impact', {
          ...tokenArgs,
          project_id: projectId,
          commit_sha: firstSha,
          limit: 50,
          output_format: 'json_only',
        })
      : { affected_files: [], affected_symbols: [], related_lessons: [] };
    mark('analyze_commit_impact', {
      files: impact.affected_files?.length ?? 0,
      symbols: impact.affected_symbols?.length ?? 0,
      lessons: impact.related_lessons?.length ?? 0,
    });

    let workspace = null;
    if (workspaceRoot) {
      const reg = await callTool(client, 'register_workspace_root', {
        ...tokenArgs,
        project_id: projectId,
        root_path: workspaceRoot,
        active: true,
        output_format: 'json_only',
      });
      const scan = await callTool(client, 'scan_workspace', {
        ...tokenArgs,
        project_id: projectId,
        root_path: workspaceRoot,
        run_delta_index: true,
        output_format: 'json_only',
      });
      workspace = { reg, scan };
      mark('workspace_mode', {
        workspace_id: reg.workspace_id,
        modified: scan.modified_files?.length ?? 0,
        untracked: scan.untracked_files?.length ?? 0,
        staged: scan.staged_files?.length ?? 0,
      });
    }

    const report = {
      generated_at: new Date().toISOString(),
      project_id: projectId,
      git_url: gitUrl,
      ref,
      source_storage_mode: sourceStorageMode,
      duration_ms: Date.now() - started,
      gates: {
        prepare_repo_ok: prepared.status === 'ok',
        s3_sync_ok: Boolean(prepared.s3_sync?.uploaded ?? false),
        queue_chain_ok: (lastJobs.items ?? []).some((i: any) => i.job_type === 'repo.sync' && i.status === 'succeeded')
          && (lastJobs.items ?? []).some((i: any) => i.job_type === 'git.ingest' && i.status === 'succeeded')
          && (lastJobs.items ?? []).some((i: any) => i.job_type === 'index.run' && i.status === 'succeeded'),
        commits_available: (commits.items?.length ?? 0) > 0,
        search_has_hits: search.filter(s => s.matches > 0).length >= 3,
      },
      metrics: {
        commits_count: commits.items?.length ?? 0,
        first_commit_files: oneCommit.files?.length ?? 0,
        search,
      },
      workspace,
      timeline,
    };

    await fs.mkdir(outputDir, { recursive: true });
    const stamp = new Date().toISOString().replace(/[:.]/g, '-');
    const outJson = path.join(outputDir, `${stamp}-phase5-worker-validation.json`);
    await fs.writeFile(outJson, JSON.stringify(report, null, 2), 'utf8');
    console.log(`[phase5-validate] report written: ${outJson}`);
  } finally {
    await client.close().catch(() => {});
  }
}

main().catch(err => {
  console.error('[phase5-validate] failed', err instanceof Error ? err.message : err);
  process.exit(1);
});

