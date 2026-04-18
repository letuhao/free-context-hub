/**
 * Phase 12 Sprint 12.0 — baseline diff generator.
 *
 * Reads two archived baseline JSON files and emits a Markdown delta table
 * per surface. This is the "nail" side of the scorecard: every downstream
 * Phase-12 sprint posts its own before/after diff as the evidence of change.
 *
 * Usage:
 *   npx tsx src/qc/diffBaselines.ts <from.json> <to.json> [--out diff.md]
 */

import fs from 'node:fs/promises';
import path from 'node:path';

type Metrics = {
  recall_at_5: number; recall_at_10: number;
  mrr: number;
  ndcg_at_5: number; ndcg_at_10: number;
  duplication_rate_at_10: number;
  coverage_pct: number;
  latency_p50_ms: number; latency_p95_ms: number; latency_mean_ms: number;
};

type SurfaceAggregate = {
  query_count: number;
  errors: number;
  metrics: Metrics;
};

type Archive = {
  schema_version: string;
  tag: string;
  git_commit: string;
  surfaces: Record<string, SurfaceAggregate>;
};

/** Metric direction: +1 = higher is better, -1 = lower is better. */
const DIRECTION: Record<keyof Metrics, 1 | -1> = {
  recall_at_5: 1,
  recall_at_10: 1,
  mrr: 1,
  ndcg_at_5: 1,
  ndcg_at_10: 1,
  coverage_pct: 1,
  duplication_rate_at_10: -1,
  latency_p50_ms: -1,
  latency_p95_ms: -1,
  latency_mean_ms: -1,
};

/** Regression thresholds: breach → flag in the "Regressions" section. */
const REGRESSION_RULES: Partial<Record<keyof Metrics, { absDropOrRise: number; description: string }>> = {
  ndcg_at_10:   { absDropOrRise: -0.05, description: 'nDCG@10 dropped more than 0.05' },
  recall_at_10: { absDropOrRise: -0.05, description: 'recall@10 dropped more than 0.05' },
  latency_p95_ms: { absDropOrRise: 0.20, description: 'latency p95 rose more than 20%' },
};

function parseArgs(argv: string[]): { from: string; to: string; out?: string } {
  const positional: string[] = [];
  let out: string | undefined;
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i]!;
    if (a === '--out') {
      out = argv[i + 1];
      i++;
    } else if (!a.startsWith('--')) {
      positional.push(a);
    }
  }
  if (positional.length < 2) {
    console.error('Usage: diffBaselines <from.json> <to.json> [--out diff.md]');
    process.exit(2);
  }
  return { from: positional[0]!, to: positional[1]!, out };
}

async function loadArchive(p: string): Promise<Archive> {
  const raw = await fs.readFile(p, 'utf8');
  return JSON.parse(raw) as Archive;
}

function emoji(deltaSigned: number, direction: 1 | -1, pctAbs: number): string {
  if (pctAbs < 1) return '⚪';
  const improved = (deltaSigned > 0 && direction === 1) || (deltaSigned < 0 && direction === -1);
  return improved ? '🟢' : '🔴';
}

function fmt(value: number): string {
  return Number.isInteger(value) ? String(value) : value.toFixed(4);
}

function pctChange(from: number, to: number): number {
  if (from === 0) return to === 0 ? 0 : 100;
  return ((to - from) / Math.abs(from)) * 100;
}

function diffSurface(
  name: string,
  fromA: SurfaceAggregate | undefined,
  toA: SurfaceAggregate | undefined,
): { md: string; regressions: string[] } {
  const lines: string[] = [];
  const regressions: string[] = [];
  lines.push(`## ${name}`);
  lines.push('');
  if (!fromA && !toA) {
    lines.push('_(surface missing from both archives)_');
    return { md: lines.join('\n'), regressions };
  }
  if (!fromA) {
    lines.push('_(surface new in `to`; baseline not present in `from`)_');
    return { md: lines.join('\n'), regressions };
  }
  if (!toA) {
    lines.push('_(surface removed in `to`)_');
    return { md: lines.join('\n'), regressions };
  }

  lines.push('| Metric | Before | After | Δ | % | |');
  lines.push('|---|---:|---:|---:|---:|---|');

  const metricKeys = Object.keys(DIRECTION) as (keyof Metrics)[];
  for (const key of metricKeys) {
    const before = fromA.metrics[key];
    const after = toA.metrics[key];
    const delta = after - before;
    const pct = pctChange(before, after);
    const dir = DIRECTION[key];
    const e = emoji(delta, dir, Math.abs(pct));
    const sign = delta > 0 ? '+' : '';
    const pctSign = pct > 0 ? '+' : '';
    lines.push(`| ${key} | ${fmt(before)} | ${fmt(after)} | ${sign}${fmt(delta)} | ${pctSign}${pct.toFixed(1)}% | ${e} |`);

    const rule = REGRESSION_RULES[key];
    if (rule) {
      const breach =
        (rule.absDropOrRise < 0 && delta <= rule.absDropOrRise) ||
        (rule.absDropOrRise > 0 && pct / 100 >= rule.absDropOrRise);
      if (breach) {
        regressions.push(`**${name}/${key}**: ${rule.description} (before=${fmt(before)}, after=${fmt(after)})`);
      }
    }
  }

  lines.push('');
  lines.push(`- query_count: ${fromA.query_count} → ${toA.query_count}`);
  lines.push(`- errors: ${fromA.errors} → ${toA.errors}`);
  lines.push('');
  return { md: lines.join('\n'), regressions };
}

async function main() {
  const { from, to, out } = parseArgs(process.argv.slice(2));
  const [fromA, toA] = await Promise.all([loadArchive(from), loadArchive(to)]);

  if (fromA.schema_version !== toA.schema_version) {
    console.warn(`[diff] schema_version mismatch: ${fromA.schema_version} vs ${toA.schema_version}`);
  }

  const lines: string[] = [];
  lines.push(`# Baseline diff — ${fromA.tag} → ${toA.tag}`);
  lines.push('');
  lines.push(`- from: \`${fromA.tag}\` (commit \`${fromA.git_commit}\`)`);
  lines.push(`- to: \`${toA.tag}\` (commit \`${toA.git_commit}\`)`);
  lines.push('');

  const surfaceNames = new Set<string>([
    ...Object.keys(fromA.surfaces ?? {}),
    ...Object.keys(toA.surfaces ?? {}),
  ]);

  const allRegressions: string[] = [];
  for (const name of surfaceNames) {
    const { md, regressions } = diffSurface(name, fromA.surfaces?.[name], toA.surfaces?.[name]);
    lines.push(md);
    allRegressions.push(...regressions);
  }

  lines.push('## Regressions flagged');
  lines.push('');
  if (allRegressions.length === 0) {
    lines.push('_(none)_');
  } else {
    for (const r of allRegressions) lines.push(`- ${r}`);
  }
  lines.push('');

  const output = lines.join('\n');
  if (out) {
    await fs.mkdir(path.dirname(out), { recursive: true });
    await fs.writeFile(out, output, 'utf8');
    console.log(`[diff] wrote ${out}`);
  } else {
    process.stdout.write(output);
  }
}

main().catch((e) => {
  console.error('[diff] FATAL', e);
  process.exit(1);
});
