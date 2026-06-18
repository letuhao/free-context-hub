/**
 * DEFERRED-034 — in-process integration probe for chunks rerank.
 *
 * Calls the NEW searchChunks directly (no MCP container rebuild needed) twice
 * per query — rerank OFF vs rerank ON — and reports:
 *   - whether the top-`limit` order changed (proves the reranker fired),
 *   - the rerank explanation line,
 *   - the raw chunk_id ordering for eyeballing.
 *
 * This is the LOW-NOISE half of verification (no LLM judge). The cp/cr quality
 * A/B (noisy) is separate. Run from the HOST with localhost service URLs:
 *
 *   set -a; source .env; set +a
 *   EMBEDDINGS_BASE_URL=http://localhost:1234 \
 *   RERANK_BASE_URL=http://localhost:28417 \
 *     npx tsx src/qc/chunksRerankAbProbe.ts
 */

import { promises as fs } from 'node:fs';

import { searchChunks, type ChunkMatch } from '../services/documentChunks.js';
import { getDbPool } from '../db/client.js';
import { buildJudgeContexts } from './judgeContexts.js';
import { scoreOnce, type JudgeRequest } from './judge.js';
import type { GoldenSet, GoldenQuery } from './goldenTypes.js';

const CHUNKS_FILE = 'qc/chunks-queries.json';
const K = Number(process.env.NF_K ?? 5);
// Set JUDGE_AB=1 to also run the noisy cp/cr quality A/B (rerank off vs on)
// over NF_REPEATS passes against the ragas-judge sidecar.
const JUDGE_AB = process.env.JUDGE_AB === '1';
const JUDGE_URL = process.env.RAGAS_JUDGE_URL?.trim() || 'http://localhost:3005';
const REPEATS = Number(process.env.NF_REPEATS ?? 3);

function mean(xs: number[]): number {
  return xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : NaN;
}
function fmt(x: number): string {
  return Number.isFinite(x) ? x.toFixed(3) : '  -  ';
}

/** buildJudgeContexts expects {key, snippet}; ChunkMatch has chunk_id + content_snippet. */
function toJudgeContexts(matches: ChunkMatch[]) {
  return buildJudgeContexts(
    matches.map((m) => ({ key: m.chunk_id, snippet: m.content_snippet })),
    K,
  );
}

async function scoreCpCr(q: GoldenQuery, matches: ChunkMatch[]): Promise<{ cp: number | null; cr: number | null }> {
  const contexts = toJudgeContexts(matches);
  if (contexts.length === 0 || q.ideal_answer === undefined) return { cp: null, cr: null };
  const req: JudgeRequest = {
    request_id: `rerank-ab/${q.id}`,
    question: q.query,
    answer: '(answer omitted — cp/cr are answer-independent)',
    contexts,
    ground_truth: q.ideal_answer,
    answer_category: (q.answer_category as JudgeRequest['answer_category']) ?? 'standard',
    metrics: ['context_precision', 'context_recall'],
    options: { include_reasons: false },
  };
  try {
    const res = await scoreOnce(req, { baseUrl: JUDGE_URL, timeoutMs: 180_000 });
    return { cp: res.scores.context_precision ?? null, cr: res.scores.context_recall ?? null };
  } catch {
    return { cp: null, cr: null };
  }
}

async function main() {
  const set = JSON.parse(await fs.readFile(CHUNKS_FILE, 'utf8')) as GoldenSet;
  const pid = set.project_id_suggested ?? 'free-context-hub';
  console.log(`[rerank-ab] project=${pid} K=${K} queries=${set.queries.length}`);
  console.log(`[rerank-ab] RERANK_TYPE=${process.env.RERANK_TYPE} base=${process.env.RERANK_BASE_URL}`);

  let changedCount = 0;
  let firedCount = 0;

  for (const q of set.queries) {
    const off = await searchChunks({ projectId: pid, query: q.query, limit: K, rerank: false });
    const on = await searchChunks({ projectId: pid, query: q.query, limit: K, rerank: true });
    const offIds = off.matches.map((m) => m.chunk_id);
    const onIds = on.matches.map((m) => m.chunk_id);
    const changed = JSON.stringify(offIds) !== JSON.stringify(onIds);
    if (changed) changedCount++;
    const rerankExpl = on.explanations.find((e) => e.startsWith('rerank'));
    if (rerankExpl && rerankExpl.startsWith('reranked')) firedCount++;

    const short = (ids: string[]) => ids.map((s) => s.slice(0, 6)).join(',');
    console.log(
      `${q.id.slice(0, 32).padEnd(33)} changed=${changed ? 'Y' : 'n'}  off=[${short(offIds)}]  on=[${short(onIds)}]`,
    );
    console.log(`    ${rerankExpl ?? '(no rerank explanation!)'}`);
  }

  console.log(
    `\n[rerank-ab] rerank fired on ${firedCount}/${set.queries.length} queries; top-${K} order changed on ${changedCount}/${set.queries.length}`,
  );

  if (JUDGE_AB) {
    console.log(`\n[rerank-ab] cp/cr quality A/B — ${REPEATS} passes/arm via judge ${JUDGE_URL}`);
    console.log(`[rerank-ab] NOTE: cp judge-noise band is ~0.146 (see v12 closeout) — read deltas against it.`);
    // Pre-fetch the off/on top-K once per query (retrieval is deterministic);
    // re-score only the (noisy) judge N times.
    const arms: Record<'off' | 'on', { cp: number[]; cr: number[] }> = {
      off: { cp: [], cr: [] },
      on: { cp: [], cr: [] },
    };
    const eligible = set.queries.filter((q) => q.ideal_answer !== undefined);
    for (let rep = 0; rep < REPEATS; rep++) {
      let cpOff = 0, crOff = 0, cpOn = 0, crOn = 0, nOff = 0, nOn = 0;
      for (const q of eligible) {
        const off = await searchChunks({ projectId: pid, query: q.query, limit: K, rerank: false });
        const on = await searchChunks({ projectId: pid, query: q.query, limit: K, rerank: true });
        const so = await scoreCpCr(q, off.matches);
        const sn = await scoreCpCr(q, on.matches);
        if (so.cp != null) { cpOff += so.cp; nOff++; }
        if (so.cr != null) crOff += so.cr;
        if (sn.cp != null) { cpOn += sn.cp; nOn++; }
        if (sn.cr != null) crOn += sn.cr;
      }
      arms.off.cp.push(cpOff / nOff); arms.off.cr.push(crOff / nOff);
      arms.on.cp.push(cpOn / nOn); arms.on.cr.push(crOn / nOn);
      console.log(`  pass ${rep + 1}: cp off=${fmt(cpOff / nOff)} on=${fmt(cpOn / nOn)} | cr off=${fmt(crOff / nOff)} on=${fmt(crOn / nOn)}`);
    }
    const mOffCp = mean(arms.off.cp), mOnCp = mean(arms.on.cp);
    const mOffCr = mean(arms.off.cr), mOnCr = mean(arms.on.cr);
    console.log(`\n[rerank-ab] cp: off=${fmt(mOffCp)} on=${fmt(mOnCp)} Δ=${fmt(mOnCp - mOffCp)} (vs noise band 0.146)`);
    console.log(`[rerank-ab] cr: off=${fmt(mOffCr)} on=${fmt(mOnCr)} Δ=${fmt(mOnCr - mOffCr)}`);
  }

  await getDbPool().end();
}

main().catch((e) => {
  console.error('[rerank-ab] FATAL', e);
  process.exit(1);
});
