/**
 * Score a stress-query set on the LESSONS surface against the CURRENTLY-CONFIGURED
 * MCP server. Run it once with the server in no-rerank mode and once with
 * cross-encoder mode, then compare — this is the headroom-band A/B.
 *
 * The reranker is selected by the SERVER (RERANK_TYPE); this scorer only issues
 * search_lessons and measures where each query's labeled target lands.
 *
 * Run:
 *   RUN_LABEL=no-rerank    npx tsx src/qc/scoreStressSet.ts qc/lessons-stress-candidates.json
 *   RUN_LABEL=crossencoder npx tsx src/qc/scoreStressSet.ts qc/lessons-stress-candidates.json
 */
import * as dotenv from 'dotenv';
import { readFile } from 'node:fs/promises';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';
import { callLessons } from './surfaces.js';

dotenv.config();

const MCP_URL = process.env.MCP_SERVER_URL?.trim() || 'http://localhost:3000/mcp';
const PID = process.env.QC_PROJECT_ID?.trim() || 'free-context-hub';
const LABEL = process.env.RUN_LABEL ?? '(unlabeled)';
const K = 20;

type Q = { id: string; query: string; target_lesson_ids: string[] };

function rankOf(items: Array<{ id: string }>, targetId: string): number {
  const idx = items.findIndex(it => (it.id || '').toLowerCase() === targetId.toLowerCase());
  return idx < 0 ? -1 : idx + 1;
}

async function main() {
  const file = process.argv[2] ?? 'qc/lessons-stress-candidates.json';
  const set = JSON.parse(await readFile(file, 'utf8')) as { queries: Q[] };
  const queries = set.queries.filter(q => Array.isArray(q.target_lesson_ids) && q.target_lesson_ids.length);
  console.log(`[score:${LABEL}] ${queries.length} queries from ${file}`);

  const client = new Client({ name: 'stress-scorer', version: '1.0.0' }, { capabilities: {} });
  await client.connect(new StreamableHTTPClientTransport(new URL(MCP_URL), {}));

  let r1 = 0, r3 = 0, r5 = 0, r10 = 0, mrrSum = 0, ndcgSum = 0, found = 0;
  const ranks: number[] = [];
  for (const q of queries) {
    const res = await callLessons(client, PID, q.query, K);
    // best (lowest) rank across the labeled targets
    let best = -1;
    for (const tid of q.target_lesson_ids) {
      const rk = rankOf(res.items, tid);
      if (rk > 0 && (best < 0 || rk < best)) best = rk;
    }
    ranks.push(best);
    if (best > 0) {
      found++;
      if (best <= 1) r1++;
      if (best <= 3) r3++;
      if (best <= 5) r5++;
      if (best <= 10) r10++;
      mrrSum += 1 / best;
      if (best <= 10) ndcgSum += 1 / Math.log2(best + 1); // single grade-1 target → IDCG=1
    }
  }
  await client.close();

  const n = queries.length;
  const pct = (x: number) => (x / n).toFixed(4);
  console.log(`\n[score:${LABEL}] n=${n}  found_in_pool=${found}`);
  console.log(`  recall@1=${pct(r1)}  recall@3=${pct(r3)}  recall@5=${pct(r5)}  recall@10=${pct(r10)}`);
  console.log(`  MRR=${(mrrSum / n).toFixed(4)}  nDCG@10=${(ndcgSum / n).toFixed(4)}`);
  console.log(`  rank histogram: ${JSON.stringify(histogram(ranks))}`);
}

function histogram(ranks: number[]): Record<string, number> {
  const h: Record<string, number> = { '1': 0, '2-3': 0, '4-5': 0, '6-10': 0, '11-20': 0, absent: 0 };
  for (const r of ranks) {
    if (r === -1) h.absent++;
    else if (r === 1) h['1']++;
    else if (r <= 3) h['2-3']++;
    else if (r <= 5) h['4-5']++;
    else if (r <= 10) h['6-10']++;
    else h['11-20']++;
  }
  return h;
}

main().catch(e => { console.error(e); process.exit(1); });
