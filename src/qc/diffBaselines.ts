/**
 * Phase 12 Sprint 12.0 — baseline diff generator.
 *
 * Reads two archived baseline JSON files and emits a Markdown delta table
 * per surface. This is the "nail" side of the scorecard: every downstream
 * Phase-12 sprint posts its own before/after diff as the evidence of change.
 *
 * Usage:
 *   npx tsx src/qc/diffBaselines.ts <from.json> <to.json> [--out diff.md]
 *
 * Pure functions (emoji, fmt, pctChange, breachedRegression, diffSurface,
 * renderDiff) are exported so they can be unit-tested without touching disk.
 */

import fs from 'node:fs/promises';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

export type Metrics = {
  recall_at_5: number; recall_at_10: number;
  mrr: number;
  ndcg_at_5: number; ndcg_at_10: number;
  duplication_rate_at_10: number;
  /** Sprint 12.0.1: near-semantic dup-rate (title+snippet[:100] key).
   *  Catches pathologies the exact-id v0 metric misses. */
  duplication_rate_nearsemantic_at_10: number;
  coverage_pct: number;
  latency_p50_ms: number | null;
  latency_p95_ms: number | null;
  latency_mean_ms: number | null;
};

export type SurfaceAggregate = {
  query_count: number;
  errors: number;
  project_id?: string;
  metrics: Metrics;
};

export /** Sprint 12.0.2 /review-impl MED-1: when both archives carry a
 *  noise_floor (both were produced by `runBaseline --control`), the diff
 *  generator uses max(fromNF[k], toNF[k]) as the per-metric signal/noise
 *  threshold. Deltas within the threshold render with a ⚪ emoji and a
 *  "(within noise floor)" annotation rather than 🔴/🟢. */
type NoiseFloorValue = number | null | undefined;
type SurfaceNoiseFloor = Partial<Record<keyof Metrics, NoiseFloorValue>>;

type Archive = {
  schema_version: string;
  tag: string;
  git_commit: string;
  surfaces: Record<string, SurfaceAggregate>;
  noise_floor?: Partial<Record<string, SurfaceNoiseFloor>>;
};

/** Metric direction: +1 = higher is better, -1 = lower is better. */
export const DIRECTION: Record<keyof Metrics, 1 | -1> = {
  recall_at_5: 1,
  recall_at_10: 1,
  mrr: 1,
  ndcg_at_5: 1,
  ndcg_at_10: 1,
  coverage_pct: 1,
  duplication_rate_at_10: -1,
  duplication_rate_nearsemantic_at_10: -1,
  latency_p50_ms: -1,
  latency_p95_ms: -1,
  latency_mean_ms: -1,
};

/** Regression thresholds: breach → flag in the "Regressions" section.
 *  Negative `absDropOrRise` compares on absolute delta; positive compares on
 *  relative pct change (so e.g. +20% p95 rise). */
export const REGRESSION_RULES: Partial<Record<keyof Metrics, { absDropOrRise: number; description: string }>> = {
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

/** Pick an emoji from a (signed delta, metric direction, |pct|) tuple.
 *  <1% absolute change → unchanged. Otherwise green if improved, red if worse. */
export function emoji(deltaSigned: number, direction: 1 | -1, pctAbs: number): string {
  if (pctAbs < 1) return '⚪';
  const improved = (deltaSigned > 0 && direction === 1) || (deltaSigned < 0 && direction === -1);
  return improved ? '🟢' : '🔴';
}

/** Normalize a possibly-missing metric read to null. Older archives may be
 *  missing fields added by later sprints; treat those as "no data" rather
 *  than NaN'ing through the renderer. */
export function asNullable(v: number | null | undefined): number | null {
  return v === undefined ? null : v;
}

/** Format a metric value; null / undefined render as `—`, integers render
 *  without decimals. */
export function fmt(value: number | null | undefined): string {
  const v = asNullable(value);
  if (v === null) return '—';
  return Number.isInteger(v) ? String(v) : v.toFixed(4);
}

/** Percent change from `from` → `to`. Returns null when `from = 0` and
 *  `to ≠ 0` (undefined / ∞) so the renderer can show that honestly.
 *  Also returns null if either side is null or undefined. */
export function pctChange(
  from: number | null | undefined,
  to: number | null | undefined,
): number | null {
  const f = asNullable(from);
  const t = asNullable(to);
  if (f === null || t === null) return null;
  if (f === 0) return t === 0 ? 0 : null;
  return ((t - f) / Math.abs(f)) * 100;
}

/** Decide whether a metric's (delta, pctChange) breaches its regression rule.
 *  Pure — returns true/false, no side effects. */
export function breachedRegression(
  key: keyof Metrics,
  before: number | null | undefined,
  after: number | null | undefined,
): boolean {
  const rule = REGRESSION_RULES[key];
  if (!rule) return false;
  const b = asNullable(before);
  const a = asNullable(after);
  if (b === null || a === null) return false;
  const delta = a - b;
  if (rule.absDropOrRise < 0) {
    // Absolute-drop rule (e.g. nDCG@10 dropped ≥0.05 → rule.absDropOrRise = -0.05).
    return delta <= rule.absDropOrRise;
  }
  // Positive rule: relative rise (e.g. +20% p95).
  const pct = pctChange(b, a);
  if (pct === null) return false;
  return pct / 100 >= rule.absDropOrRise;
}

/** Sprint 12.0.2 MED-1 helper: the effective noise threshold for a
 *  metric is max of both archives' floors for that metric (if present).
 *  Returns null when there's no floor data or either side is null. */
export function effectiveNoiseFloor(
  key: keyof Metrics,
  fromNF: SurfaceNoiseFloor | undefined,
  toNF: SurfaceNoiseFloor | undefined,
): number | null {
  const fv = asNullable(fromNF?.[key]);
  const tv = asNullable(toNF?.[key]);
  if (fv === null && tv === null) return null;
  if (fv === null) return tv;
  if (tv === null) return fv;
  return Math.max(fv, tv);
}

export function diffSurface(
  name: string,
  fromA: SurfaceAggregate | undefined,
  toA: SurfaceAggregate | undefined,
  /** Sprint 12.0.2 MED-1: when both archives carry noise_floor, pass
   *  the corresponding surface slice so within-floor deltas can be
   *  badged ⚪ instead of 🔴/🟢. */
  fromNF?: SurfaceNoiseFloor,
  toNF?: SurfaceNoiseFloor,
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

  const hasNoiseFloor = Boolean(fromNF || toNF);
  lines.push(
    hasNoiseFloor
      ? '| Metric | Before | After | Δ | % | noise floor | |'
      : '| Metric | Before | After | Δ | % | |',
  );
  lines.push(
    hasNoiseFloor ? '|---|---:|---:|---:|---:|---:|---|' : '|---|---:|---:|---:|---:|---|',
  );

  const metricKeys = Object.keys(DIRECTION) as (keyof Metrics)[];
  for (const key of metricKeys) {
    const before = asNullable(fromA.metrics[key]);
    const after = asNullable(toA.metrics[key]);
    const delta = before === null || after === null ? null : after - before;
    const pct = pctChange(before, after);
    const dir = DIRECTION[key];
    const deltaFmt = delta === null ? '—' : `${delta > 0 ? '+' : ''}${fmt(delta)}`;
    const pctFmt =
      pct === null
        ? before === 0 && after !== null && after !== 0
          ? '∞'
          : 'n/a'
        : `${pct > 0 ? '+' : ''}${pct.toFixed(1)}%`;
    // When pct is null because `from = 0` and `to ≠ 0` (infinite relative
    // change), we still have sign information from delta itself — treat
    // it as a big change for emoji purposes rather than silently ⚪.
    const pctForEmoji = pct === null ? 100 : Math.abs(pct);

    // Sprint 12.0.2 MED-1: within-noise-floor deltas → ⚪, annotated.
    const nf = effectiveNoiseFloor(key, fromNF, toNF);
    const withinFloor = delta !== null && nf !== null && Math.abs(delta) <= nf;
    const e = delta === null
      ? '⚪'
      : withinFloor
        ? '⚪'
        : emoji(delta, dir, pctForEmoji);

    if (hasNoiseFloor) {
      const nfFmt = nf === null ? '—' : fmt(nf);
      const annotation = withinFloor ? ' (within floor)' : '';
      lines.push(
        `| ${key} | ${fmt(before)} | ${fmt(after)} | ${deltaFmt} | ${pctFmt} | ${nfFmt} | ${e}${annotation} |`,
      );
    } else {
      lines.push(`| ${key} | ${fmt(before)} | ${fmt(after)} | ${deltaFmt} | ${pctFmt} | ${e} |`);
    }

    // MED-1: don't flag a regression if the breach is smaller than the
    // noise floor — that's measurement-jitter, not signal.
    if (breachedRegression(key, before, after) && !withinFloor) {
      const rule = REGRESSION_RULES[key]!;
      regressions.push(`**${name}/${key}**: ${rule.description} (before=${fmt(before)}, after=${fmt(after)})`);
    }
  }

  lines.push('');
  lines.push(`- query_count: ${fromA.query_count} → ${toA.query_count}`);
  lines.push(`- errors: ${fromA.errors} → ${toA.errors}`);
  if (fromA.project_id || toA.project_id) {
    lines.push(`- project_id: ${fromA.project_id ?? '(unknown)'} → ${toA.project_id ?? '(unknown)'}`);
  }
  lines.push('');
  return { md: lines.join('\n'), regressions };
}

export function renderDiff(fromA: Archive, toA: Archive): string {
  const lines: string[] = [];
  lines.push(`# Baseline diff — ${fromA.tag} → ${toA.tag}`);
  lines.push('');
  lines.push(`- from: \`${fromA.tag}\` (commit \`${fromA.git_commit}\`)`);
  lines.push(`- to: \`${toA.tag}\` (commit \`${toA.git_commit}\`)`);
  lines.push('');

  if (fromA.schema_version !== toA.schema_version) {
    lines.push(
      `> ⚠️ **Schema-version mismatch** — from=\`${fromA.schema_version}\` to=\`${toA.schema_version}\`. Delta values may misalign if fields were renamed/removed; inspect archives directly before trusting numbers below.`,
    );
    lines.push('');
  }

  const surfaceNames = new Set<string>([
    ...Object.keys(fromA.surfaces ?? {}),
    ...Object.keys(toA.surfaces ?? {}),
  ]);

  const allRegressions: string[] = [];
  for (const name of surfaceNames) {
    // Sprint 12.0.2 MED-1: pass per-surface noise_floor slices when either
    // archive carries them. Type assertion: SurfaceNoiseFloor is a subset
    // of the archive's noise_floor keyed by surface name.
    const fromNF = fromA.noise_floor?.[name] as SurfaceNoiseFloor | undefined;
    const toNF = toA.noise_floor?.[name] as SurfaceNoiseFloor | undefined;
    const { md, regressions } = diffSurface(name, fromA.surfaces?.[name], toA.surfaces?.[name], fromNF, toNF);
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
  return lines.join('\n');
}

async function main() {
  const { from, to, out } = parseArgs(process.argv.slice(2));
  const [fromA, toA] = await Promise.all([loadArchive(from), loadArchive(to)]);

  if (fromA.schema_version !== toA.schema_version) {
    console.warn(`[diff] schema_version mismatch: ${fromA.schema_version} vs ${toA.schema_version}`);
  }

  const output = renderDiff(fromA, toA);
  if (out) {
    await fs.mkdir(path.dirname(out), { recursive: true });
    await fs.writeFile(out, output, 'utf8');
    console.log(`[diff] wrote ${out}`);
  } else {
    process.stdout.write(output);
  }
}

// Allow `import` of pure helpers without triggering CLI. On Windows,
// `pathToFileURL` produces the correct `file:///D:/...` form to match
// `import.meta.url` (plain string-concat breaks on backslashes).
const entry = process.argv[1];
if (entry && import.meta.url === pathToFileURL(entry).href) {
  main().catch((e) => {
    console.error('[diff] FATAL', e);
    process.exit(1);
  });
}
