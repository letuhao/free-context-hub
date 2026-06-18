/**
 * Phase 17.3 — NLI vs RAGAS faithfulness A/B on the global surface.
 *
 * Reuses a saved baseline archive's global-surface gen rows (generated_answer +
 * contexts_used + RAGAS faithfulness) so the A/B does NOT re-run synthesis. For each
 * row it scores the answer's claims against the contexts via the nli-judge sidecar
 * and tabulates NLI strict / lenient / contradiction-rate beside RAGAS faithfulness.
 *
 * Requires the nli-judge sidecar reachable at NLI_JUDGE_URL (default :3006).
 *
 * Usage:
 *   NLI_JUDGE_URL=http://localhost:3006 \
 *     npx tsx src/qc/nliGlobalAb.ts docs/qc/baselines/<archive>.json
 */

import fs from 'node:fs/promises';

import { nliScore } from './nliScore.js';

type Ctx = { title?: string; snippet_preview?: string };
type Row = {
  id: string;
  generation?: {
    generated_answer?: string;
    contexts_used?: Ctx[];
    scores?: { faithfulness?: number };
  };
};

function pad(s: string, n: number): string {
  return s.length >= n ? s.slice(0, n) : s + ' '.repeat(n - s.length);
}
function num(v: number | null | undefined, w = 7): string {
  return (v === null || v === undefined ? 'n/a' : v.toFixed(3)).padStart(w);
}

async function main() {
  const archivePath = process.argv[2];
  if (!archivePath) throw new Error('usage: nliGlobalAb.ts <archive.json>');
  const archive = JSON.parse(await fs.readFile(archivePath, 'utf-8'));
  const rows: Row[] = archive?.surfaces?.global?.per_query ?? [];
  if (rows.length === 0) throw new Error(`no global per_query rows in ${archivePath}`);

  console.log(`archive: ${archivePath}\n`);
  console.log(
    `${pad('id', 28)}${'ragas'.padStart(7)}${'nli_str'.padStart(7)}${'nli_len'.padStart(7)}${'nli_con'.padStart(7)}${'clm'.padStart(5)}`,
  );
  console.log('-'.repeat(58));

  const sum = { ragas: 0, str: 0, len: 0, con: 0, n: 0 };
  for (const r of rows) {
    const g = r.generation;
    const ans = g?.generated_answer ?? '';
    const ragas = g?.scores?.faithfulness;
    if (!ans.trim() || ragas === undefined) {
      console.log(`${pad(r.id, 28)}${'  (skipped: empty answer / no faithfulness)'}`);
      continue;
    }
    const contexts = (g?.contexts_used ?? []).map((c) => `${c.title ?? ''}: ${c.snippet_preview ?? ''}`);
    const res = await nliScore({ answer: ans, contexts });
    console.log(
      `${pad(r.id, 28)}${num(ragas)}${num(res.nli_faithfulness_strict)}${num(res.nli_faithfulness_lenient)}${num(res.nli_contradiction_rate)}${String(res.n_claims).padStart(5)}`,
    );
    if (res.nli_faithfulness_strict !== null) {
      sum.ragas += ragas;
      sum.str += res.nli_faithfulness_strict;
      sum.len += res.nli_faithfulness_lenient ?? 0;
      sum.con += res.nli_contradiction_rate ?? 0;
      sum.n += 1;
    }
  }
  const n = sum.n || 1;
  console.log('-'.repeat(58));
  console.log(
    `${pad(`MEAN (n=${sum.n})`, 28)}${num(sum.ragas / n)}${num(sum.str / n)}${num(sum.len / n)}${num(sum.con / n)}`,
  );
}

main().catch((e) => {
  console.error('[nli-ab] FATAL', e instanceof Error ? e.message : e);
  process.exit(1);
});
