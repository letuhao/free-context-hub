import * as dotenv from 'dotenv';
import fs from 'node:fs/promises';
import path from 'node:path';

import { ingestGitHistory } from '../services/gitIntelligence.js';
import { indexProject } from '../services/indexer.js';
import { searchCode } from '../services/retriever.js';
import { scanWorkspaceChanges } from '../services/workspaceTracker.js';

dotenv.config();

type BenchmarkProject = {
  project_id: string;
  root: string;
  source_mode?: 'remote_git' | 'local_workspace';
  dirty_workspace?: boolean;
  queries?: string[];
};

type BenchmarkConfig = {
  projects: BenchmarkProject[];
  output_dir?: string;
};

async function runProject(p: BenchmarkProject) {
  const started = Date.now();
  const indexCold = await indexProject({ projectId: p.project_id, root: p.root });
  const ingestCold = await ingestGitHistory({ projectId: p.project_id, root: p.root, maxCommits: 200 });
  const indexIdempotent = await indexProject({ projectId: p.project_id, root: p.root });
  const ingestIncremental = await ingestGitHistory({ projectId: p.project_id, root: p.root, since: '24 hours ago', maxCommits: 200 });

  const queries = p.queries?.length ? p.queries : ['queue worker', 'index project', 'git ingest'];
  const search = [];
  for (const q of queries) {
    const t0 = Date.now();
    const res = await searchCode({ projectId: p.project_id, query: q, limit: 5 });
    search.push({ query: q, duration_ms: Date.now() - t0, matches: res.matches.length });
  }

  let dirty: any = null;
  if (p.source_mode === 'local_workspace' || p.dirty_workspace) {
    dirty = await scanWorkspaceChanges({ projectId: p.project_id, rootPath: p.root, runDeltaIndex: true });
  }

  return {
    project_id: p.project_id,
    source_mode: p.source_mode ?? 'remote_git',
    scenarios: {
      cold: { index: indexCold, ingest: ingestCold },
      incremental: { ingest: ingestIncremental },
      idempotent: { index: indexIdempotent },
      dirty_workspace: dirty,
    },
    search,
    duration_ms: Date.now() - started,
  };
}

async function main() {
  const configPath = process.env.BENCH_CONFIG_PATH || '';
  if (!configPath) {
    throw new Error('BENCH_CONFIG_PATH is required');
  }
  const full = path.resolve(configPath);
  const raw = await fs.readFile(full, 'utf8');
  const cfg = JSON.parse(raw) as BenchmarkConfig;
  if (!cfg.projects?.length) throw new Error('Benchmark config must include projects[]');

  const started = Date.now();
  const items = [];
  for (const p of cfg.projects) {
    items.push(await runProject(p));
  }
  const out = {
    generated_at: new Date().toISOString(),
    total_duration_ms: Date.now() - started,
    items,
  };
  const outDir = path.resolve(cfg.output_dir || 'docs/benchmarks/artifacts');
  await fs.mkdir(outDir, { recursive: true });
  const file = path.join(outDir, `${new Date().toISOString().replace(/[:.]/g, '-')}-phase5-validation.json`);
  await fs.writeFile(file, JSON.stringify(out, null, 2), 'utf8');
  console.log(`[bench] wrote ${file}`);
}

main().catch(err => {
  console.error('[bench] failed', err instanceof Error ? err.message : err);
  process.exit(1);
});

