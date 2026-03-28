/**
 * Reranker model benchmark — tests lesson search quality with different rerankers.
 * Tests against 180 lessons with 33 queries.
 *
 * NOTE: This script tests the reranker by directly calling it, NOT via MCP server.
 * It performs: semantic retrieval (via MCP) → then reranks locally with each model.
 * This avoids Docker rebuilds per model.
 *
 * Usage: npx tsx src/qc/rerankBenchmark.ts
 */
import * as dotenv from 'dotenv';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';
import { CallToolResultSchema } from '@modelcontextprotocol/sdk/types.js';
import * as z from 'zod/v4';

dotenv.config();

const MCP_URL = process.env.MCP_SERVER_URL?.trim() || 'http://localhost:3000/mcp';
const LLM_URL = process.env.RERANK_BASE_URL?.trim() || process.env.DISTILLATION_BASE_URL?.trim() || process.env.EMBEDDINGS_BASE_URL?.trim() || 'http://localhost:1234';
const LLM_KEY = process.env.RERANK_API_KEY ?? process.env.DISTILLATION_API_KEY ?? process.env.EMBEDDINGS_API_KEY ?? '';
const PID = 'free-context-hub';

const RerankOrderSchema = z.object({ order: z.array(z.number().int().nonnegative()) });

async function callMcp(client: Client, name: string, args: Record<string, unknown>) {
  const r = await client.request(
    { method: 'tools/call', params: { name, arguments: args } },
    CallToolResultSchema, { timeout: 60000 },
  );
  const txt = (r.content as any)[0]?.text || '';
  try { const s = txt.indexOf('{'); return JSON.parse(txt.slice(s, txt.lastIndexOf('}') + 1)); }
  catch { return txt; }
}

type Match = { lesson_id: string; title: string; content_snippet: string; score: number };

/** Call reranker model directly via LM Studio chat API. */
async function rerankWithModel(model: string, query: string, candidates: Match[], maxTokens = 500): Promise<number[]> {
  const base = LLM_URL.replace(/\/$/, '');
  const url = `${base}/v1/chat/completions`;
  const headers: Record<string, string> = { 'Content-Type': 'application/json' };
  if (LLM_KEY) headers.Authorization = `Bearer ${LLM_KEY}`;

  const system = 'You are a ranking model. Re-rank candidates by how directly they answer the query. Output ONLY valid JSON: {"order":[...]} where order is an array of candidate indices (0-based), best match first. No extra keys, no markdown.';
  const user = `QUERY:\n${query}\n\nCANDIDATES:\n` +
    candidates.map((c, i) => `#${i} TITLE: ${c.title}\nSNIPPET: ${c.content_snippet}`).join('\n\n') +
    '\n\nReturn JSON.';

  const ac = new AbortController();
  const t = setTimeout(() => ac.abort(), 30000);

  try {
    const res = await fetch(url, {
      method: 'POST', headers, signal: ac.signal,
      body: JSON.stringify({ model, messages: [{ role: 'system', content: system }, { role: 'user', content: user }], temperature: 0.0, max_tokens: maxTokens }),
    });
    if (!res.ok) return candidates.map((_, i) => i);

    const json = (await res.json()) as any;
    const content = json?.choices?.[0]?.message?.content ?? '';
    const raw = content.trim();
    const first = raw.indexOf('{');
    const last = raw.lastIndexOf('}');
    if (first < 0 || last <= first) return candidates.map((_, i) => i);

    const parsed = JSON.parse(raw.slice(first, last + 1));
    const validated = RerankOrderSchema.safeParse(parsed);
    if (!validated.success) return candidates.map((_, i) => i);

    const n = candidates.length;
    const seen = new Set<number>();
    const cleaned: number[] = [];
    for (const idx of validated.data.order) {
      if (idx >= 0 && idx < n && !seen.has(idx)) { seen.add(idx); cleaned.push(idx); }
    }
    for (let i = 0; i < n; i++) if (!seen.has(i)) cleaned.push(i);
    return cleaned;
  } catch {
    return candidates.map((_, i) => i);
  } finally { clearTimeout(t); }
}

type Q = { q: string; expect: string | null };
const QUERIES: Q[] = [
  { q: 'how does search work in this project', expect: 'tiered search' },
  { q: 'what types of data chunks exist', expect: '12-kind' },
  { q: 'authentication approach', expect: null },
  { q: 'docker deployment issues', expect: 'Docker build cache' },
  { q: 'caching problems after code changes', expect: 'Redis cache' },
  { q: 'database migration gotchas', expect: 'CREATE INDEX CONCURRENTLY' },
  { q: 'what is the main purpose of this project', expect: 'Persistent memory' },
  { q: 'how are guardrails enforced', expect: 'lifecycle status' },
  { q: 'what embedding model should I use', expect: 'qwen3-embedding-0.6b' },
  { q: 'how does lesson search scoring work', expect: 'Hybrid search' },
  { q: 'what search profiles are available', expect: 'Three search profiles' },
  { q: 'my search returns old results after I changed scoring', expect: 'Redis' },
  { q: 'why does the server crash on startup with new SQL file', expect: 'CONCURRENTLY' },
  { q: 'I added a migration file but docker does not see it', expect: 'Docker build cache' },
  { q: 'how does the system find test files for a function', expect: 'convention' },
  { q: 'why is search returning wrong file types after classifier change', expect: 're-index' },
  { q: 'which models were benchmarked for embeddings', expect: 'qwen3-embedding' },
  { q: 'why not use a code-specific embedding model', expect: 'Code embedding models are wrong' },
  { q: 'how does FTS query building work', expect: 'AND mode' },
  { q: 'what languages does test file discovery support', expect: 'convention' },
  { q: 'how does ripgrep handle missing binary in Docker', expect: 'circuit breaker' },
  { q: 'should short tokens like db and env be searchable', expect: 'Short identifiers' },
  { q: 'what happens to guardrails when a lesson is archived', expect: 'lifecycle status' },
  { q: 'are tiered search and semantic search the same thing', expect: 'complementary' },
  { q: 'what is the password policy', expect: 'password' },
  { q: 'how does pagination work in the API', expect: 'cursor' },
  { q: 'what CI/CD system do we use', expect: 'GitHub Actions' },
  { q: 'how to prevent duplicate form submissions', expect: 'idempotency' },
  { q: 'what frontend framework do we use', expect: 'React' },
  { q: 'how to set up kubernetes deployment', expect: null },
  { q: 'how to configure OAuth2 authentication', expect: null },
  { q: 'what is our machine learning pipeline', expect: null },
  { q: 'how does blockchain integration work', expect: null },
];

async function main() {
  const client = new Client({ name: 'rerank-bench', version: '1.0.0' }, { capabilities: {} });
  await client.connect(new StreamableHTTPClientTransport(new URL(MCP_URL), {}));

  // Step 1: Pre-fetch all retrieval results (without server-side reranking — use raw scores).
  // We disable server reranking by fetching with limit=20 so we get a wide pool.
  console.log('Pre-fetching retrieval candidates for all queries...\n');
  const preResults: Array<{ q: Q; matches: Match[] }> = [];

  for (const q of QUERIES) {
    const r = await callMcp(client, 'search_lessons', {
      project_id: PID, query: q.q, limit: 20, output_format: 'json_only',
    }) as any;
    preResults.push({ q, matches: r?.matches || [] });
  }
  await client.close();

  // Step 2: Test each reranker model.
  const MODELS = [
    '(no-rerank)',
    'qwen.qwen3-reranker-4b',
    'qwen3-reranker-0.6b',
    'qwen3-reranker-8b',
    'zerank-2',
    'jina-reranker-v3',
    'gte-reranker-modernbert-base',
    'llama-nemotron-rerank-1b-v2',
  ];

  const results: Array<{ model: string; pass: number; total: number; avg: number; negAvg: number; gap: number; latency: number }> = [];

  for (const model of MODELS) {
    const isNoRerank = model === '(no-rerank)';
    console.log(`\n${'='.repeat(60)}`);
    console.log(`  Reranker: ${model}`);
    console.log('='.repeat(60));

    let pass = 0;
    const posScores: number[] = [];
    const negScores: number[] = [];
    let totalLatency = 0;

    for (const { q, matches } of preResults) {
      let reranked = matches;

      if (!isNoRerank && matches.length >= 2) {
        const start = Date.now();
        const top = matches.slice(0, 15);
        const order = await rerankWithModel(model, q.q, top, 500);
        totalLatency += Date.now() - start;
        const rerankedTop = order.map(i => top[i]).filter(Boolean);
        reranked = [...rerankedTop, ...matches.slice(15)];
      }

      const topMatch = reranked[0];
      const score = topMatch?.score ?? 0;

      if (q.expect === null) {
        negScores.push(score);
      } else {
        posScores.push(score);
      }

      let hit: boolean;
      if (q.expect === null) {
        hit = !topMatch || topMatch.score < 0.5;
      } else {
        hit = reranked.slice(0, 3).some((m: any) =>
          ((m.title || '') + ' ' + (m.content_snippet || '')).toLowerCase().includes(q.expect!.toLowerCase())
        );
      }

      const icon = hit ? '\x1b[32mPASS\x1b[0m' : '\x1b[31mFAIL\x1b[0m';
      console.log(`  ${icon} ${q.q.slice(0, 55)}`);
      if (!hit && q.expect) console.log(`        expected: ${q.expect}, got: ${topMatch?.title?.slice(0, 50) || '(none)'}`);
      if (hit) pass++;
    }

    const avgPos = posScores.length ? posScores.reduce((a, b) => a + b, 0) / posScores.length : 0;
    const avgNeg = negScores.length ? negScores.reduce((a, b) => a + b, 0) / negScores.length : 0;
    const avgLatency = isNoRerank ? 0 : totalLatency / QUERIES.filter(q => q.expect !== null).length;

    console.log(`\n  Result: ${pass}/${QUERIES.length} | pos_avg=${avgPos.toFixed(3)} neg_avg=${avgNeg.toFixed(3)} gap=${(avgPos - avgNeg).toFixed(3)} | latency=${avgLatency.toFixed(0)}ms/query`);

    results.push({ model, pass, total: QUERIES.length, avg: avgPos, negAvg: avgNeg, gap: avgPos - avgNeg, latency: avgLatency });
  }

  // Summary table
  console.log('\n' + '='.repeat(80));
  console.log('  RERANKER BENCHMARK SUMMARY (180 lessons, 33 queries)');
  console.log('='.repeat(80));
  console.log('  Model                          | Pass  | Pos Avg | Neg Avg | Gap   | Latency');
  console.log('  ' + '-'.repeat(76));
  for (const r of results.sort((a, b) => b.pass - a.pass || b.gap - a.gap)) {
    console.log(`  ${r.model.padEnd(32)} | ${String(r.pass).padStart(2)}/${r.total} | ${r.avg.toFixed(3)}   | ${r.negAvg.toFixed(3)}   | ${r.gap.toFixed(3)} | ${r.latency.toFixed(0)}ms`);
  }
  console.log('='.repeat(80));
}

main().catch(e => { console.error(e); process.exit(1); });
