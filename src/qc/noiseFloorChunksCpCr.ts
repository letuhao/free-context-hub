/**
 * v12 closeout — judge noise-floor probe for chunks context_precision /
 * context_recall.
 *
 * WHY THIS EXISTS
 * ---------------
 * The v11 hybrid baseline reported a chunks "regression": cp −0.076, cr −0.077
 * vs pure-v8, attributed to "switching the chunks synthesizer template from v8
 * to v6". That attribution is causally impossible:
 *
 *   1. The sidecar computes context_precision / context_recall from
 *      (question, ground_truth, retrieved_contexts) ONLY — the synthesized
 *      `answer` is never passed (services/ragas-judge/main.py:585-614).
 *   2. The synthesizer template only changes the `answer`.
 *   3. Retrieval is template-independent and deterministic (DEFERRED-033) — the
 *      v6/v8/v11 runs retrieved byte-identical chunks contexts on all 13 rows.
 *
 * So any cp/cr difference between those runs is judge LLM non-determinism, not
 * a template effect. This probe MEASURES that noise floor directly: it fixes
 * the template AND the retrieved contexts (one retrieval per row), then re-runs
 * the cp/cr judge calls N times. The spread it reports is the run-to-run band
 * that the claimed 0.076 "regression" must clear to be real.
 *
 * The dummy answer is deliberate: cp/cr ignore the answer, so its content is
 * irrelevant to what we measure (the sidecar only requires it to be non-empty).
 *
 * USAGE
 * -----
 *   NF_REPEATS=8 RAGAS_JUDGE_URL=http://localhost:3005 \
 *     npx tsx src/qc/noiseFloorChunksCpCr.ts --out docs/qc/baselines/<file>.json
 *
 * Requires the SAME controlled stack as a baseline run (LM Studio + ragas-judge
 * sidecar pinned to the Tradition B judge, gemma). See CLAUDE.md
 * "Baseline-stack invariant".
 */

import { promises as fs } from 'node:fs';
import { Client as McpClient } from '@modelcontextprotocol/sdk/client/index.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';

import { callChunks } from './surfaces.js';
import { buildJudgeContexts } from './judgeContexts.js';
import { scoreOnce, type JudgeRequest } from './judge.js';
import type { GoldenSet } from './goldenTypes.js';

const MCP_URL = process.env.MCP_SERVER_URL?.trim() || 'http://localhost:3000/mcp';
const JUDGE_URL = process.env.RAGAS_JUDGE_URL?.trim() || 'http://localhost:3005';
const CHUNKS_FILE = 'qc/chunks-queries.json';
const K = Number(process.env.NF_K ?? 5);
const REPEATS = Number(process.env.NF_REPEATS ?? 8);

function argOut(): string | null {
  const i = process.argv.indexOf('--out');
  return i >= 0 ? process.argv[i + 1] ?? null : null;
}

function mean(xs: number[]): number {
  return xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : NaN;
}
function std(xs: number[]): number {
  if (xs.length < 2) return 0;
  const m = mean(xs);
  return Math.sqrt(xs.reduce((a, b) => a + (b - m) ** 2, 0) / (xs.length - 1));
}
function fmt(x: number): string {
  return Number.isFinite(x) ? x.toFixed(3) : '  -  ';
}

type RowResult = {
  id: string;
  answer_category: string;
  context_count: number;
  cp: (number | null)[];
  cr: (number | null)[];
};

async function main() {
  const ts = () => new Date().toISOString().slice(11, 19);
  console.log(`[${ts()}] [noise-floor] MCP=${MCP_URL}  JUDGE=${JUDGE_URL}  K=${K}  REPEATS=${REPEATS}`);

  // Health check + capture judge config for provenance.
  const health = (await fetch(`${JUDGE_URL.replace(/\/$/, '')}/health`).then((r) => r.json())) as {
    judge_model: string;
    judge_temperature: number;
    judge_seed: number;
    prompts_hash: string;
  };
  console.log(
    `[${ts()}] [noise-floor] judge=${health.judge_model} temp=${health.judge_temperature} seed=${health.judge_seed} prompts_hash=${health.prompts_hash}`,
  );

  const setRaw = await fs.readFile(CHUNKS_FILE, 'utf8');
  const set = JSON.parse(setRaw) as GoldenSet;
  const pid = set.project_id_suggested ?? 'free-context-hub';

  const client = new McpClient({ name: 'noise-floor-probe', version: '1.0.0' }, { capabilities: {} });
  await client.connect(new StreamableHTTPClientTransport(new URL(MCP_URL), {}));

  // Only rows with a ground truth — cp/cr require it.
  const rows = set.queries.filter((q) => q.ideal_answer !== undefined);
  console.log(
    `[${ts()}] [noise-floor] ${rows.length}/${set.queries.length} chunks rows have ground_truth (cp/cr eligible)`,
  );

  const results: RowResult[] = [];

  for (const q of rows) {
    // Retrieve ONCE — deterministic, template-independent. Fix the contexts.
    const ret = await callChunks(client, pid, q.query, K);
    const contexts = buildJudgeContexts(ret.items, K);

    const rr: RowResult = {
      id: q.id,
      answer_category: q.answer_category ?? 'standard',
      context_count: contexts.length,
      cp: [],
      cr: [],
    };

    if (contexts.length === 0) {
      // Empty retrieval — cp/cr undefined (sidecar 422s). Record nulls.
      for (let i = 0; i < REPEATS; i++) {
        rr.cp.push(null);
        rr.cr.push(null);
      }
      console.log(`[${ts()}]   ${q.id} ... EMPTY retrieval, skipped`);
      results.push(rr);
      continue;
    }

    process.stdout.write(`[${ts()}]   ${q.id} (ctx=${contexts.length}) `);
    for (let i = 0; i < REPEATS; i++) {
      const req: JudgeRequest = {
        request_id: `noise/${q.id}/${i}`,
        question: q.query,
        // Dummy answer: cp/cr never read it; sidecar only requires non-empty.
        answer: '(answer omitted — cp/cr are answer-independent)',
        contexts,
        ground_truth: q.ideal_answer,
        answer_category: (q.answer_category as JudgeRequest['answer_category']) ?? 'standard',
        metrics: ['context_precision', 'context_recall'],
        options: { include_reasons: false },
      };
      try {
        const res = await scoreOnce(req, { baseUrl: JUDGE_URL, timeoutMs: 180_000 });
        const cp = res.scores.context_precision;
        const cr = res.scores.context_recall;
        rr.cp.push(cp ?? null);
        rr.cr.push(cr ?? null);
        process.stdout.write(`${fmt(cp ?? NaN)}/${fmt(cr ?? NaN)} `);
      } catch (err) {
        rr.cp.push(null);
        rr.cr.push(null);
        process.stdout.write('ERR ');
      }
    }
    process.stdout.write('\n');
    results.push(rr);
  }

  await client.close();

  // ---------- Aggregate ----------
  // Per-row spread.
  const perRow = results.map((r) => {
    const cps = r.cp.filter((x): x is number => x !== null);
    const crs = r.cr.filter((x): x is number => x !== null);
    return {
      id: r.id,
      answer_category: r.answer_category,
      context_count: r.context_count,
      cp_mean: mean(cps),
      cp_std: std(cps),
      cp_range: cps.length ? Math.max(...cps) - Math.min(...cps) : NaN,
      cr_mean: mean(crs),
      cr_std: std(crs),
      cr_range: crs.length ? Math.max(...crs) - Math.min(...crs) : NaN,
      n: cps.length,
    };
  });

  // Surface-mean per repeat = how the headline number jitters run-to-run.
  const surfaceCpPerRepeat: number[] = [];
  const surfaceCrPerRepeat: number[] = [];
  for (let i = 0; i < REPEATS; i++) {
    const cps = results.map((r) => r.cp[i]).filter((x): x is number => x !== null && x !== undefined);
    const crs = results.map((r) => r.cr[i]).filter((x): x is number => x !== null && x !== undefined);
    if (cps.length) surfaceCpPerRepeat.push(mean(cps));
    if (crs.length) surfaceCrPerRepeat.push(mean(crs));
  }

  const summary = {
    cp: {
      surface_mean_per_repeat: surfaceCpPerRepeat,
      surface_mean_of_means: mean(surfaceCpPerRepeat),
      surface_mean_std: std(surfaceCpPerRepeat),
      surface_mean_range: surfaceCpPerRepeat.length
        ? Math.max(...surfaceCpPerRepeat) - Math.min(...surfaceCpPerRepeat)
        : NaN,
      mean_per_row_std: mean(perRow.map((r) => r.cp_std).filter(Number.isFinite)),
      max_per_row_range: Math.max(...perRow.map((r) => r.cp_range).filter(Number.isFinite)),
    },
    cr: {
      surface_mean_per_repeat: surfaceCrPerRepeat,
      surface_mean_of_means: mean(surfaceCrPerRepeat),
      surface_mean_std: std(surfaceCrPerRepeat),
      surface_mean_range: surfaceCrPerRepeat.length
        ? Math.max(...surfaceCrPerRepeat) - Math.min(...surfaceCrPerRepeat)
        : NaN,
      mean_per_row_std: mean(perRow.map((r) => r.cr_std).filter(Number.isFinite)),
      max_per_row_range: Math.max(...perRow.map((r) => r.cr_range).filter(Number.isFinite)),
    },
  };

  // ---------- Print ----------
  console.log('\n=== Per-row spread across', REPEATS, 'repeats (same template, same contexts) ===');
  console.log('id'.padEnd(34), 'cat'.padEnd(11), 'cp_mean cp_std cp_rng | cr_mean cr_std cr_rng');
  for (const r of perRow) {
    console.log(
      r.id.slice(0, 33).padEnd(34),
      r.answer_category.padEnd(11),
      fmt(r.cp_mean),
      ' ',
      fmt(r.cp_std),
      ' ',
      fmt(r.cp_range),
      ' | ',
      fmt(r.cr_mean),
      ' ',
      fmt(r.cr_std),
      ' ',
      fmt(r.cr_range),
    );
  }

  console.log('\n=== Surface-mean jitter (the headline-number noise band) ===');
  console.log(
    `context_precision: mean=${fmt(summary.cp.surface_mean_of_means)} std=${fmt(summary.cp.surface_mean_std)} range=${fmt(summary.cp.surface_mean_range)}  (per-repeat: ${surfaceCpPerRepeat.map(fmt).join(', ')})`,
  );
  console.log(
    `context_recall:    mean=${fmt(summary.cr.surface_mean_of_means)} std=${fmt(summary.cr.surface_mean_std)} range=${fmt(summary.cr.surface_mean_range)}  (per-repeat: ${surfaceCrPerRepeat.map(fmt).join(', ')})`,
  );

  console.log('\n=== Claimed v11 "regression" vs measured noise band ===');
  console.log('  cp: v6=0.563 v8=0.660 v11=0.584 | claimed v11-v8=-0.076 | v6-v11=+0.021 (SAME template!)');
  console.log('  cr: v6=0.397 v8=0.449 v11=0.372 | claimed v11-v8=-0.077 | v6-v11=-0.026 (SAME template!)');
  console.log(
    `  measured surface-mean range: cp=${fmt(summary.cp.surface_mean_range)} cr=${fmt(summary.cr.surface_mean_range)}`,
  );

  const out = argOut();
  if (out) {
    const artifact = {
      probe: 'noise-floor-chunks-cp-cr',
      generated_for: 'v12 closeout / DEFERRED-031',
      mcp_url: MCP_URL,
      judge: {
        url: JUDGE_URL,
        model: health.judge_model,
        temperature: health.judge_temperature,
        seed: health.judge_seed,
        prompts_hash: health.prompts_hash,
      },
      project_id: pid,
      k: K,
      repeats: REPEATS,
      reference_baselines: {
        note: 'Tradition B, n=13 chunks rows. cp/cr are answer-independent; v6 and v11 use the byte-identical chunks template (hash a01005e0d102b2c1).',
        cp: { v6: 0.563, v8: 0.66, v11: 0.584 },
        cr: { v6: 0.397, v8: 0.449, v11: 0.372 },
      },
      summary,
      per_row: perRow,
      raw: results,
    };
    await fs.writeFile(out, JSON.stringify(artifact, null, 2));
    console.log(`\n[${ts()}] [noise-floor] wrote ${out}`);
  }
}

main().catch((e) => {
  console.error('[noise-floor] FATAL', e);
  process.exit(1);
});
