/**
 * Test 5.2: Run golden queries through search_code_tiered and measure recall@3 / MRR.
 * Usage: npx tsx src/qc/tieredBaseline.ts
 */
import * as dotenv from 'dotenv';
import fs from 'node:fs';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';
import { CallToolResultSchema } from '@modelcontextprotocol/sdk/types.js';
import { normalizePath, recallAtK, mrr } from './goldenTypes.js';
import type { GoldenSet } from './goldenTypes.js';

dotenv.config();

const MCP_URL = process.env.MCP_SERVER_URL?.trim() || 'http://localhost:3000/mcp';
const PID = process.env.QC_PROJECT_ID?.trim() || 'qc-free-context-hub';

async function call(client: Client, name: string, args: Record<string, unknown>) {
  const r = await client.request(
    { method: 'tools/call', params: { name, arguments: args } },
    CallToolResultSchema,
    { timeout: 60000 },
  );
  const txt = (r.content as any)[0]?.text || '';
  try {
    const s = txt.indexOf('{');
    return JSON.parse(txt.slice(s, txt.lastIndexOf('}') + 1));
  } catch {
    return txt;
  }
}

async function main() {
  const golden: GoldenSet = JSON.parse(fs.readFileSync('qc/queries.json', 'utf8'));
  const client = new Client({ name: 'tiered-baseline', version: '1.0.0' }, { capabilities: {} });
  await client.connect(new StreamableHTTPClientTransport(new URL(MCP_URL), {}));

  console.log('=== Tiered Search Baseline (search_code_tiered, kind=source) ===');
  console.log(`Project: ${PID}, Queries: ${golden.queries.length}\n`);

  const groupStats: Record<string, { n: number; recall: number; mrr: number }> = {};
  let totalRecall = 0;
  let totalMRR = 0;

  for (const q of golden.queries) {
    const r = await call(client, 'search_code_tiered', {
      project_id: PID,
      query: q.query,
      kind: 'source',
      max_files: 10,
      output_format: 'json_only',
    });

    const resultPaths = ((r as any)?.files || []).map((f: any) => normalizePath(f.path));
    const targetPaths = q.target_files.map(normalizePath);

    // Compute ranks: for each target, find its position in results.
    const foundRanks = targetPaths.map(t => {
      const idx = resultPaths.findIndex((p: string) => p.includes(t) || t.includes(p));
      return idx >= 0 ? idx + 1 : 0;
    });

    const r3 = recallAtK(foundRanks, 3);
    const m = mrr(foundRanks);

    totalRecall += r3;
    totalMRR += m;

    if (!groupStats[q.group]) groupStats[q.group] = { n: 0, recall: 0, mrr: 0 };
    groupStats[q.group].n++;
    groupStats[q.group].recall += r3;
    groupStats[q.group].mrr += m;

    const icon = r3 > 0 ? '\x1b[32mHIT\x1b[0m' : '\x1b[31mMIS\x1b[0m';
    console.log(`  ${icon} [r@3=${r3} mrr=${m.toFixed(3)}] ${q.id}`);
  }

  const n = golden.queries.length;
  const avgRecall = totalRecall / n;
  const avgMRR = totalMRR / n;

  console.log(`\n${'='.repeat(60)}`);
  console.log(`  recall@3: ${avgRecall.toFixed(3)}`);
  console.log(`  MRR:      ${avgMRR.toFixed(3)}`);
  console.log('='.repeat(60));

  console.log('\nBy group:');
  console.log('  Group           |  n | recall@3 |  MRR');
  console.log('  ' + '-'.repeat(45));
  for (const [g, s] of Object.entries(groupStats).sort((a, b) => (b[1].recall / b[1].n) - (a[1].recall / a[1].n))) {
    const rg = (s.recall / s.n).toFixed(3);
    const mg = (s.mrr / s.n).toFixed(3);
    console.log(`  ${g.padEnd(16)} | ${String(s.n).padStart(2)} | ${rg}    | ${mg}`);
  }

  await client.close();
}

main().catch(e => { console.error(e); process.exit(1); });
