import * as dotenv from 'dotenv';
import fs from 'node:fs/promises';
import path from 'node:path';

import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';
import { CallToolResultSchema } from '@modelcontextprotocol/sdk/types.js';

dotenv.config();

type GoldenQuery = {
  id: string;
  group: string;
  query: string;
  path_glob?: string;
  target_files: string[];
  must_keywords?: string[];
};

type GoldenSet = {
  version: string;
  project_id_suggested?: string;
  notes?: string[];
  queries: GoldenQuery[];
};

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

function normalizePath(p: string) {
  return p.replace(/\\/g, '/').replace(/^\.?\//, '');
}

function recallAtK(foundRanks: number[], k: number) {
  return foundRanks.some(r => r > 0 && r <= k) ? 1 : 0;
}

function mrr(foundRanks: number[]) {
  const best = Math.min(...foundRanks.filter(r => r > 0));
  if (!Number.isFinite(best)) return 0;
  return 1 / best;
}

function keywordHit(snippet: string, must: string[]) {
  const s = snippet.toLowerCase();
  return must.every(k => s.includes(k.toLowerCase()));
}

async function main() {
  const token = process.env.CONTEXT_HUB_WORKSPACE_TOKEN;
  const tokenArgs = token && token.trim().length ? { workspace_token: token } : {};

  const serverUrl = process.env.MCP_SERVER_URL ?? 'http://localhost:3000/mcp';
  const projectId = process.env.QC_PROJECT_ID ?? 'qc-free-context-hub';
  const queriesPath = process.env.QC_QUERIES_PATH ?? 'qc/queries.json';
  const outDir = path.resolve(process.env.QC_OUTPUT_DIR ?? 'docs/qc/artifacts');

  const raw = await fs.readFile(path.resolve(queriesPath), 'utf8');
  const golden = JSON.parse(raw) as GoldenSet;

  const client = new Client({ name: 'rag-qc-runner', version: '0.1.0' }, { capabilities: {} });
  const transport = new StreamableHTTPClientTransport(new URL(serverUrl), {});
  await client.connect(transport);

  const started = Date.now();
  const results: any[] = [];

  try {
    for (const q of golden.queries) {
      const t0 = Date.now();
      const group = String(q.group ?? '');
      const autoKgAssistGroups = new Set(['kg', 'queue', 'mcp-server']);
      const kgAssist = autoKgAssistGroups.has(group);
      const out = await callTool(client, 'search_code', {
        ...tokenArgs,
        project_id: projectId,
        query: q.query,
        filters: q.path_glob
          ? { path_glob: q.path_glob, kg_assist: kgAssist }
          : kgAssist
            ? { kg_assist: true }
            : undefined,
        limit: 10,
        output_format: 'json_only',
      });
      const matches = (out.matches ?? []) as Array<{ path: string; snippet: string }>;
      const rankedPaths = matches.map(m => normalizePath(String(m.path ?? '')));

      const target = q.target_files.map(normalizePath);
      const ranks = target
        .map(tf => rankedPaths.findIndex(p => p === tf))
        .map(i => (i >= 0 ? i + 1 : 0));

      const must = q.must_keywords ?? [];
      const hasKeywordEvidence = must.length
        ? matches.some(m => keywordHit(String(m.snippet ?? ''), must))
        : undefined;

      results.push({
        id: q.id,
        group: q.group,
        duration_ms: Date.now() - t0,
        target_files: q.target_files,
        found_ranks: ranks,
        recall_at_1: recallAtK(ranks, 1),
        recall_at_3: recallAtK(ranks, 3),
        recall_at_10: recallAtK(ranks, 10),
        mrr: mrr(ranks),
        must_keywords_ok: hasKeywordEvidence,
        top_paths: rankedPaths.slice(0, 10),
      });
    }
  } finally {
    await client.close().catch(() => {});
  }

  const byGroup: Record<string, any> = {};
  for (const r of results) {
    const g = String(r.group ?? 'unknown');
    byGroup[g] ??= { n: 0, recall_at_3: 0, mrr: 0, p95_ms: 0, durations: [] as number[] };
    byGroup[g].n += 1;
    byGroup[g].recall_at_3 += r.recall_at_3;
    byGroup[g].mrr += r.mrr;
    byGroup[g].durations.push(r.duration_ms);
  }
  for (const g of Object.keys(byGroup)) {
    const o = byGroup[g];
    o.recall_at_3 = o.n ? o.recall_at_3 / o.n : 0;
    o.mrr = o.n ? o.mrr / o.n : 0;
    o.durations.sort((a: number, b: number) => a - b);
    const idx = Math.max(0, Math.min(o.durations.length - 1, Math.ceil(o.durations.length * 0.95) - 1));
    o.p95_ms = o.durations[idx] ?? 0;
    delete o.durations;
  }

  await fs.mkdir(outDir, { recursive: true });
  const stamp = new Date().toISOString().replace(/[:.]/g, '-');
  const artifact = {
    generated_at: new Date().toISOString(),
    duration_ms: Date.now() - started,
    project_id: projectId,
    server_url: serverUrl,
    golden_version: golden.version,
    totals: {
      n: results.length,
      recall_at_3: results.reduce((a, r) => a + r.recall_at_3, 0) / Math.max(1, results.length),
      mrr: results.reduce((a, r) => a + r.mrr, 0) / Math.max(1, results.length),
    },
    by_group: byGroup,
    results,
  };

  const outJson = path.join(outDir, `${stamp}-qc-artifacts.json`);
  await fs.writeFile(outJson, JSON.stringify(artifact, null, 2), 'utf8');

  const worst = [...results].sort((a, b) => a.recall_at_3 - b.recall_at_3 || a.mrr - b.mrr).slice(0, 15);
  const mdLines: string[] = [];
  mdLines.push(`# RAG QC Report — ${new Date().toISOString()}`);
  mdLines.push('');
  mdLines.push(`- project_id: \`${projectId}\``);
  mdLines.push(`- queries: \`${results.length}\``);
  mdLines.push(`- recall@3: \`${artifact.totals.recall_at_3.toFixed(3)}\``);
  mdLines.push(`- MRR: \`${artifact.totals.mrr.toFixed(3)}\``);
  mdLines.push(`- artifacts: \`${normalizePath(path.relative(process.cwd(), outJson))}\``);
  mdLines.push('');
  mdLines.push('## By group');
  mdLines.push('');
  mdLines.push('| group | n | recall@3 | mrr | p95_ms |');
  mdLines.push('|---|---:|---:|---:|---:|');
  for (const [g, o] of Object.entries(byGroup).sort((a, b) => (b[1] as any).recall_at_3 - (a[1] as any).recall_at_3)) {
    mdLines.push(`| ${g} | ${(o as any).n} | ${(o as any).recall_at_3.toFixed(3)} | ${(o as any).mrr.toFixed(3)} | ${(o as any).p95_ms} |`);
  }
  mdLines.push('');
  mdLines.push('## Worst 15 queries (by recall@3 then MRR)');
  mdLines.push('');
  mdLines.push('| id | group | recall@3 | mrr | top_paths[0..2] | targets |');
  mdLines.push('|---|---|---:|---:|---|---|');
  for (const r of worst) {
    mdLines.push(`| ${r.id} | ${r.group} | ${r.recall_at_3} | ${r.mrr.toFixed(3)} | ${(r.top_paths ?? []).slice(0, 3).join('<br/>')} | ${(r.target_files ?? []).join('<br/>')} |`);
  }
  mdLines.push('');
  mdLines.push('## Notes');
  mdLines.push('- File-level ground truth: a query is considered “hit” if any target file appears in top-k paths.');
  mdLines.push('- For deeper snippet quality and grounding, use the manual rubric in `docs/qc/task-eval-kit.md`.');

  const outMd = path.join(path.resolve('docs/qc'), `${stamp}-qc-report.md`);
  await fs.mkdir(path.dirname(outMd), { recursive: true });
  await fs.writeFile(outMd, mdLines.join('\n'), 'utf8');

  console.log(`[qc] wrote ${outJson}`);
  console.log(`[qc] wrote ${outMd}`);
}

main().catch(err => {
  console.error('[qc] failed', err instanceof Error ? err.message : err);
  process.exit(1);
});

