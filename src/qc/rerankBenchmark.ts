/**
 * Reranker model benchmark — measures lesson-search RELEVANCE quality across
 * different rerankers via recall@k + MRR against the Phase-12 golden set.
 *
 * DEFERRED-030 (2026-06-16) rewrite. Prior version measured pass/fail substring
 * `expect` labels against the Phase-12 lesson set; current catalog differs and
 * the labels are stale. This version:
 *
 *   1. Loads the labeled golden set from `qc/lessons-queries.json` (48 queries,
 *      66 unique `target_lesson_ids`, all verified active in the current
 *      catalog 2026-06-16). A "hit" is `match.lesson_id ∈ target_lesson_ids`,
 *      i.e. true ground-truth label match, not a fuzzy substring.
 *   2. Fetches the candidate pool with `rerank: false` so client-side rerankers
 *      compare on the SAME raw retrieval pool. Without this, every row would
 *      already be cross-encoder-reranked server-side (RERANK_TYPE=api,
 *      shipped 2026-06-16) and the local rerank pass would just nudge an
 *      already-optimal order — degenerating the A/B.
 *   3. Computes proper IR metrics: recall@1 / @3 / @5 / @10 and MRR, per model.
 *      Adversarial-miss queries (empty `target_lesson_ids`) are scored against
 *      a SCORE FLOOR ("hit" iff top-1 score < ADVERSARIAL_SCORE_FLOOR).
 *
 * NOTE: This script tests the reranker by directly calling it, NOT via the
 * server's RERANK_TYPE config. It performs: semantic retrieval (via MCP,
 * `rerank: false`) → then reranks locally with each model. This avoids Docker
 * rebuilds per model.
 *
 * Usage: npx tsx src/qc/rerankBenchmark.ts
 *        # optional: RERANK_BENCH_MODELS='(no-rerank),(cross-encoder)bge-reranker-v2-m3'
 *        # optional: RERANK_BENCH_OUTPUT=docs/benchmarks/<file>.json
 */
import * as fs from 'fs';
import * as path from 'path';
import * as dotenv from 'dotenv';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';
import { CallToolResultSchema } from '@modelcontextprotocol/sdk/types.js';
import * as z from 'zod/v4';
import { cohereRerank } from '../services/rerankClient.js';

dotenv.config();

const MCP_URL = process.env.MCP_SERVER_URL?.trim() || 'http://localhost:3000/mcp';
const LLM_URL = process.env.RERANK_BASE_URL?.trim() || process.env.DISTILLATION_BASE_URL?.trim() || process.env.EMBEDDINGS_BASE_URL?.trim() || 'http://localhost:1234';
const LLM_KEY = process.env.RERANK_API_KEY ?? process.env.DISTILLATION_API_KEY ?? process.env.EMBEDDINGS_API_KEY ?? '';
const CE_URL = process.env.RERANK_SERVICE_URL?.trim() || 'http://localhost:28417';
const CE_KEY = process.env.RERANK_SERVICE_TOKEN ?? '';
const CE_MODEL = process.env.RERANK_SERVICE_MODEL?.trim() || 'bge-reranker-v2-m3';
const CE_SENTINEL = '(cross-encoder)bge-reranker-v2-m3';
const PID = process.env.RERANK_BENCH_PROJECT_ID?.trim() || 'free-context-hub';
const GOLDEN_PATH = process.env.RERANK_BENCH_GOLDEN_PATH?.trim() || 'qc/lessons-queries.json';
const ADVERSARIAL_SCORE_FLOOR = Number(process.env.RERANK_BENCH_ADVERSARIAL_FLOOR ?? '0.5');
const POOL_LIMIT = Math.max(20, Number(process.env.RERANK_BENCH_POOL_LIMIT ?? '20'));
const RERANK_DEPTH = Math.max(5, Number(process.env.RERANK_BENCH_RERANK_DEPTH ?? '15'));

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

type GoldenQuery = {
  id: string;
  group: string;
  query: string;
  /** Empty array = adversarial-miss (no correct answer; verify abstention). */
  target_lesson_ids: string[];
};

/** Call a generative reranker (LM Studio chat) directly. */
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
      body: JSON.stringify({
        model,
        messages: [{ role: 'system', content: system }, { role: 'user', content: user }],
        temperature: 0.0,
        max_tokens: maxTokens,
        reasoning_effort: 'none',
        chat_template_kwargs: { enable_thinking: false },
      }),
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

/** Cross-encoder rerank via the shared Cohere boundary (local-rerank-service / cloud). */
async function rerankWithCrossEncoder(query: string, candidates: Match[]): Promise<number[]> {
  const documents = candidates.map(c => `${c.title}. ${c.content_snippet}`);
  try {
    const ranked = await cohereRerank({
      query, documents, baseUrl: CE_URL, apiKey: CE_KEY || undefined, model: CE_MODEL, timeoutMs: 10000,
    });
    const order = ranked.map(r => r.index);
    const seen = new Set(order);
    for (let i = 0; i < candidates.length; i++) if (!seen.has(i)) order.push(i);
    return order;
  } catch {
    return candidates.map((_, i) => i);
  }
}

// ----------------------- Metrics -----------------------

/** Per-query metrics record. */
type QueryMetrics = {
  query_id: string;
  group: string;
  is_adversarial: boolean;
  /** 1-based rank of the first target hit in the reranked list, or null if no
   *  target found in the pool.  For adversarial queries this is the rank of
   *  the top-1 result regardless of identity (used only for the score floor). */
  first_hit_rank: number | null;
  /** Score of the top-1 reranked result (raw `score` from search_lessons —
   *  not the reranker's relevance score, since we don't expose that here). */
  top1_score: number;
  /** For adversarial queries: did we PASS the score floor? i.e. top1_score <
   *  ADVERSARIAL_SCORE_FLOOR (= correctly abstained on the no-answer query). */
  adversarial_pass: boolean;
};

function computeQueryMetrics(q: GoldenQuery, reranked: Match[]): QueryMetrics {
  const isAdv = q.target_lesson_ids.length === 0;
  const top1 = reranked[0]?.score ?? 0;
  if (isAdv) {
    return {
      query_id: q.id,
      group: q.group,
      is_adversarial: true,
      first_hit_rank: reranked.length ? 1 : null,
      top1_score: top1,
      adversarial_pass: top1 < ADVERSARIAL_SCORE_FLOOR || reranked.length === 0,
    };
  }
  const targets = new Set(q.target_lesson_ids.map(id => id.toLowerCase()));
  let firstHit: number | null = null;
  for (let i = 0; i < reranked.length; i++) {
    if (targets.has(reranked[i]!.lesson_id.toLowerCase())) {
      firstHit = i + 1; // 1-based
      break;
    }
  }
  return {
    query_id: q.id,
    group: q.group,
    is_adversarial: false,
    first_hit_rank: firstHit,
    top1_score: top1,
    adversarial_pass: false,
  };
}

type ModelAggregate = {
  model: string;
  total_queries: number;
  scored_queries: number;          // non-adversarial
  adversarial_queries: number;
  /** Recall@K for non-adversarial queries only. */
  recall_at_1: number;
  recall_at_3: number;
  recall_at_5: number;
  recall_at_10: number;
  /** Mean Reciprocal Rank for non-adversarial queries (unranked target → 0). */
  mrr: number;
  /** Fraction of adversarial queries where top-1 score < floor (correct abstain). */
  adversarial_pass_rate: number;
  /** Mean latency ms per reranked query (excludes no-rerank baseline). */
  mean_latency_ms: number;
};

function aggregate(model: string, perQ: QueryMetrics[], totalLatencyMs: number, isNoRerank: boolean): ModelAggregate {
  const adv = perQ.filter(m => m.is_adversarial);
  const scored = perQ.filter(m => !m.is_adversarial);
  const hitAt = (k: number) => scored.filter(m => m.first_hit_rank !== null && m.first_hit_rank <= k).length / Math.max(1, scored.length);
  const mrr = scored.reduce((sum, m) => sum + (m.first_hit_rank ? 1 / m.first_hit_rank : 0), 0) / Math.max(1, scored.length);
  const advPass = adv.filter(m => m.adversarial_pass).length / Math.max(1, adv.length);
  const meanLatency = isNoRerank ? 0 : totalLatencyMs / Math.max(1, perQ.length);
  return {
    model,
    total_queries: perQ.length,
    scored_queries: scored.length,
    adversarial_queries: adv.length,
    recall_at_1: hitAt(1),
    recall_at_3: hitAt(3),
    recall_at_5: hitAt(5),
    recall_at_10: hitAt(10),
    mrr,
    adversarial_pass_rate: advPass,
    mean_latency_ms: meanLatency,
  };
}

// ----------------------- Main -----------------------

async function main() {
  // Step 0: load golden set.
  const goldenAbs = path.isAbsolute(GOLDEN_PATH) ? GOLDEN_PATH : path.join(process.cwd(), GOLDEN_PATH);
  const raw = JSON.parse(fs.readFileSync(goldenAbs, 'utf8'));
  const queries = (raw.queries ?? []) as GoldenQuery[];
  console.log(`Loaded ${queries.length} golden queries from ${path.relative(process.cwd(), goldenAbs)}`);
  console.log(`  pool_limit=${POOL_LIMIT}  rerank_depth=${RERANK_DEPTH}  adversarial_floor=${ADVERSARIAL_SCORE_FLOOR}`);

  const client = new Client({ name: 'rerank-bench', version: '2.0.0' }, { capabilities: {} });
  await client.connect(new StreamableHTTPClientTransport(new URL(MCP_URL), {}));

  // Step 1: Pre-fetch the raw retrieval pool with rerank=false (DEFERRED-030).
  console.log('\nPre-fetching raw retrieval pool (rerank=false) for all queries...');
  const preResults: Array<{ q: GoldenQuery; matches: Match[] }> = [];

  for (const q of queries) {
    const r = await callMcp(client, 'search_lessons', {
      project_id: PID,
      query: q.query,
      limit: POOL_LIMIT,
      rerank: false,
      output_format: 'json_only',
    }) as any;
    preResults.push({ q, matches: r?.matches || [] });
  }
  await client.close();

  // Step 2: Test each reranker.
  const DEFAULT_MODELS = [
    '(no-rerank)',
    CE_SENTINEL,
    'qwen.qwen3-reranker-4b',
    'qwen3-reranker-0.6b',
    'qwen3-reranker-8b',
    'zerank-2',
    'jina-reranker-v3',
    'gte-reranker-modernbert-base',
    'llama-nemotron-rerank-1b-v2',
  ];
  const MODELS = process.env.RERANK_BENCH_MODELS
    ? process.env.RERANK_BENCH_MODELS.split(',').map(s => s.trim()).filter(Boolean)
    : DEFAULT_MODELS;

  const aggregates: ModelAggregate[] = [];

  for (const model of MODELS) {
    const isNoRerank = model === '(no-rerank)';
    console.log(`\n${'='.repeat(60)}\n  Reranker: ${model}\n${'='.repeat(60)}`);

    const perQ: QueryMetrics[] = [];
    let totalLatency = 0;

    for (const { q, matches } of preResults) {
      let reranked = matches;
      if (!isNoRerank && matches.length >= 2) {
        const start = Date.now();
        const top = matches.slice(0, RERANK_DEPTH);
        const order = model === CE_SENTINEL
          ? await rerankWithCrossEncoder(q.query, top)
          : await rerankWithModel(model, q.query, top, 500);
        totalLatency += Date.now() - start;
        const rerankedTop = order.map(i => top[i]).filter(Boolean) as Match[];
        reranked = [...rerankedTop, ...matches.slice(RERANK_DEPTH)];
      }

      const m = computeQueryMetrics(q, reranked);
      perQ.push(m);

      const hitIcon = m.is_adversarial
        ? (m.adversarial_pass ? '\x1b[32mPASS\x1b[0m' : '\x1b[31mFAIL\x1b[0m')
        : (m.first_hit_rank === null ? '\x1b[31mmiss\x1b[0m' : (m.first_hit_rank <= 3 ? `\x1b[32m@${m.first_hit_rank}\x1b[0m` : `\x1b[33m@${m.first_hit_rank}\x1b[0m`));
      console.log(`  ${hitIcon}\t${q.id.padEnd(40)} ${q.group}`);
    }

    const agg = aggregate(model, perQ, totalLatency, isNoRerank);
    aggregates.push(agg);
    console.log(`\n  Result: R@1=${agg.recall_at_1.toFixed(3)} R@3=${agg.recall_at_3.toFixed(3)} R@5=${agg.recall_at_5.toFixed(3)} R@10=${agg.recall_at_10.toFixed(3)} | MRR=${agg.mrr.toFixed(3)} | adv_pass=${agg.adversarial_pass_rate.toFixed(3)} | latency=${agg.mean_latency_ms.toFixed(0)}ms`);
  }

  // Summary table.
  console.log('\n' + '='.repeat(120));
  console.log(`  RERANKER QUALITY SUMMARY (${queries.length} golden queries, ${PID}, pool=${POOL_LIMIT})`);
  console.log('='.repeat(120));
  console.log('  Model                                | R@1   | R@3   | R@5   | R@10  | MRR   | adv   | latency');
  console.log('  ' + '-'.repeat(116));
  const sorted = [...aggregates].sort((a, b) => b.recall_at_3 - a.recall_at_3 || b.mrr - a.mrr);
  for (const r of sorted) {
    console.log(
      `  ${r.model.padEnd(36)} | ${r.recall_at_1.toFixed(3)} | ${r.recall_at_3.toFixed(3)} | ${r.recall_at_5.toFixed(3)} | ${r.recall_at_10.toFixed(3)} | ${r.mrr.toFixed(3)} | ${r.adversarial_pass_rate.toFixed(3)} | ${r.mean_latency_ms.toFixed(0)}ms`,
    );
  }
  console.log('='.repeat(120));

  // Optional JSON output.
  const outPath = process.env.RERANK_BENCH_OUTPUT?.trim();
  if (outPath) {
    const abs = path.isAbsolute(outPath) ? outPath : path.join(process.cwd(), outPath);
    fs.mkdirSync(path.dirname(abs), { recursive: true });
    const snapshot = {
      version: '2026-06-16-deferred-030',
      generated_at: new Date().toISOString(),
      project_id: PID,
      golden_set: path.relative(process.cwd(), goldenAbs).replace(/\\/g, '/'),
      total_queries: queries.length,
      pool_limit: POOL_LIMIT,
      rerank_depth: RERANK_DEPTH,
      adversarial_score_floor: ADVERSARIAL_SCORE_FLOOR,
      aggregates: sorted,
    };
    fs.writeFileSync(abs, JSON.stringify(snapshot, null, 2));
    console.log(`\nWrote snapshot → ${path.relative(process.cwd(), abs)}`);
  }
}

main().catch(e => { console.error(e); process.exit(1); });
