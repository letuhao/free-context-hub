/**
 * Phase 16 Sprint 16.1 — standalone golden-set validator.
 *
 * Scans `qc/*-queries.json` (and `qc/edge-cases.gen.json` if present),
 * runs DESIGN §2.2 invariants on each row (validateGoldenQuery + validateShipReadiness),
 * checks Sprint 16.1 AC5 (edge-case category distribution matches DESIGN §2.3),
 * and emits a per-file / per-row report. Exits 1 on any error.
 *
 * Usage:
 *   npm run qc:validate-golden                              # WIP mode (default)
 *   npm run qc:validate-golden -- --strict                  # final-check mode (Sprint 16.1 E1)
 *   npx tsx src/qc/validateGoldenSet.ts qc/queries.json     # specific files
 *   npx tsx src/qc/validateGoldenSet.ts --no-ship           # skip R7 ship-readiness
 *
 * Modes:
 *   default (WIP):  invariants + ship-readiness HARD-FAIL; distribution mismatches WARN-only
 *   --strict:       everything HARD-FAIL — use this at Sprint 16.1 E1 final check
 *   --no-ship:      skip R7 (useful during in-progress drafting before review)
 *   --no-dist:      skip distribution checks entirely
 *
 * Exit codes:
 *   0 — all hard checks pass
 *   1 — invariant violations OR ship-readiness failures (OR distribution mismatches in --strict)
 *   2 — file IO / parse error
 */

import fs from 'node:fs';
import path from 'node:path';
import {
  validateGoldenQuery,
  validateShipReadiness,
  type GoldenQuery,
  type GoldenSet,
  type AnswerCategory,
  type Surface,
  type ValidationError,
} from './goldenTypes.js';

// ─── Per-surface expected edge-case distribution (DESIGN §2.3 rebalanced) ───
type CategoryCount = Record<AnswerCategory, number>;

const EXPECTED_EDGE_CASE_DISTRIBUTION: Record<Surface, CategoryCount> = {
  lessons: {
    standard: 0,
    multi_hop: 2,
    no_answer: 1,
    contradictory: 2,
    paraphrase: 2,
    distractor: 1,
  },
  code: {
    standard: 0,
    multi_hop: 1,
    no_answer: 2,
    contradictory: 2,
    paraphrase: 2,
    distractor: 3,
  },
  chunks: {
    standard: 0,
    multi_hop: 1,
    no_answer: 1,
    contradictory: 0,
    paraphrase: 0,
    distractor: 1,
  },
  global: {
    standard: 0,
    multi_hop: 1,
    no_answer: 1,
    contradictory: 1,
    paraphrase: 1,
    distractor: 0,
  },
};

const DEFAULT_FILES: { path: string; surface: Surface }[] = [
  { path: 'qc/queries.json', surface: 'code' },
  { path: 'qc/lessons-queries.json', surface: 'lessons' },
  { path: 'qc/chunks-queries.json', surface: 'chunks' },
  // DEFERRED-034: the default chunks golden (ai-engineering, matched to the corpus).
  { path: 'qc/chunks-queries.aieng.json', surface: 'chunks' },
  { path: 'qc/global-queries.json', surface: 'global' },
];

type FileReport = {
  path: string;
  surface: Surface | null;
  rows_total: number;
  rows_with_ideal_answer: number;
  rows_reviewed: number;
  category_counts: Partial<CategoryCount>;
  invariant_errors: ValidationError[];
  ship_readiness_errors: ValidationError[];
  distribution_errors: string[];
};

function loadFile(filePath: string): GoldenSet {
  const raw = fs.readFileSync(filePath, 'utf-8');
  try {
    return JSON.parse(raw) as GoldenSet;
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    throw new Error(`Failed to parse ${filePath}: ${msg}`);
  }
}

function detectSurface(set: GoldenSet, fallback: Surface | null): Surface | null {
  if (set.surface) return set.surface;
  return fallback;
}

function validateFile(
  filePath: string,
  fallbackSurface: Surface | null,
  checkShip: boolean,
): FileReport {
  const set = loadFile(filePath);
  const surface = detectSurface(set, fallbackSurface);
  const queries = set.queries ?? [];

  const invariant_errors: ValidationError[] = [];
  const ship_readiness_errors: ValidationError[] = [];
  const distribution_errors: string[] = [];
  const category_counts: Partial<CategoryCount> = {};

  let rows_with_ideal_answer = 0;
  let rows_reviewed = 0;

  for (const q of queries) {
    if (!q || typeof q !== 'object' || !q.id) {
      invariant_errors.push({
        query_id: '<unknown>',
        field: '<row>',
        rule: 'PARSE',
        message: `malformed row in ${filePath}`,
      });
      continue;
    }
    invariant_errors.push(...validateGoldenQuery(q));
    if (checkShip) ship_readiness_errors.push(...validateShipReadiness(q));

    if (q.ideal_answer !== undefined) rows_with_ideal_answer++;
    if (q.reviewed_by) rows_reviewed++;
    if (q.answer_category) {
      category_counts[q.answer_category] = (category_counts[q.answer_category] ?? 0) + 1;
    }
  }

  // Edge-case distribution check — count ONLY drafted_by='human' rows.
  //
  // Why: bootstrap rows (drafted_by='llm') may use no_answer category for the
  // pre-existing 'adversarial-miss' group queries. Those rows are NOT the edge
  // cases enumerated in DESIGN §2.3; they pre-date Phase 16. The distribution
  // spec applies only to the hand-curated edge cases.
  const edge_category_counts: Partial<CategoryCount> = {};
  for (const q of queries) {
    if (q.drafted_by === 'human' && q.answer_category) {
      edge_category_counts[q.answer_category] = (edge_category_counts[q.answer_category] ?? 0) + 1;
    }
  }

  if (surface) {
    const expected = EXPECTED_EDGE_CASE_DISTRIBUTION[surface];
    for (const cat of Object.keys(expected) as AnswerCategory[]) {
      if (cat === 'standard') continue;
      const exp = expected[cat];
      const got = edge_category_counts[cat] ?? 0;
      if (exp > 0 && got !== exp) {
        distribution_errors.push(
          `${surface}: expected ${exp} '${cat}' edge cases (drafted_by='human'), got ${got}`,
        );
      } else if (exp === 0 && got > 0) {
        distribution_errors.push(
          `${surface}: expected 0 '${cat}' edge cases (drafted_by='human'), got ${got}`,
        );
      }
    }
  }

  return {
    path: filePath,
    surface,
    rows_total: queries.length,
    rows_with_ideal_answer,
    rows_reviewed,
    category_counts,
    invariant_errors,
    ship_readiness_errors,
    distribution_errors,
  };
}

function formatReport(
  reports: FileReport[],
  opts: { checkShip: boolean; checkDist: boolean; strict: boolean },
) {
  let totalRows = 0;
  let totalGen = 0;
  let totalReviewed = 0;
  let totalInvariantErrors = 0;
  let totalShipErrors = 0;
  let totalDistErrors = 0;

  const lines: string[] = [];
  lines.push('');
  lines.push('═══════════════════════════════════════════════════════════════');
  lines.push('  GOLDEN SET VALIDATOR — Phase 16 §2.2 invariants');
  lines.push('═══════════════════════════════════════════════════════════════');

  for (const r of reports) {
    totalRows += r.rows_total;
    totalGen += r.rows_with_ideal_answer;
    totalReviewed += r.rows_reviewed;
    totalInvariantErrors += r.invariant_errors.length;
    totalShipErrors += r.ship_readiness_errors.length;
    totalDistErrors += r.distribution_errors.length;

    lines.push('');
    lines.push(`▼ ${r.path}  (surface: ${r.surface ?? '?'})`);
    lines.push(
      `   rows: ${r.rows_total} | with ideal_answer: ${r.rows_with_ideal_answer} | reviewed: ${r.rows_reviewed}`,
    );

    if (Object.keys(r.category_counts).length) {
      const cats = Object.entries(r.category_counts)
        .map(([k, v]) => `${k}:${v}`)
        .join(', ');
      lines.push(`   categories: ${cats}`);
    }

    for (const e of r.invariant_errors) {
      lines.push(`   ✗ INVARIANT ${e.rule} on row '${e.query_id}' (${e.field}): ${e.message}`);
    }
    if (opts.checkShip) {
      for (const e of r.ship_readiness_errors) {
        lines.push(`   ⚠ SHIP-NOT-READY ${e.rule} on '${e.query_id}': ${e.message}`);
      }
    }
    if (opts.checkDist) {
      for (const d of r.distribution_errors) {
        lines.push(`   ⚠ DISTRIBUTION ${d}`);
      }
    }
    if (
      r.invariant_errors.length === 0 &&
      (!opts.checkShip || r.ship_readiness_errors.length === 0) &&
      (!opts.checkDist || r.distribution_errors.length === 0)
    ) {
      lines.push(`   ✓ all checks pass`);
    }
  }

  lines.push('');
  lines.push('───────────────────────────────────────────────────────────────');
  lines.push(`  Totals: ${totalRows} rows, ${totalGen} with ideal_answer, ${totalReviewed} reviewed`);
  lines.push(`  Invariant violations: ${totalInvariantErrors}`);
  if (opts.checkShip) {
    lines.push(`  Ship-readiness failures: ${totalShipErrors}`);
  }
  if (opts.checkDist) {
    lines.push(`  Distribution mismatches: ${totalDistErrors}`);
  }
  lines.push('═══════════════════════════════════════════════════════════════');

  const failed =
    totalInvariantErrors > 0 ||
    (opts.checkShip && totalShipErrors > 0) ||
    (opts.strict && opts.checkDist && totalDistErrors > 0);

  const distFailed = opts.checkDist && totalDistErrors > 0;

  return { text: lines.join('\n'), failed, distFailed };
}

function main() {
  const argv = process.argv.slice(2);
  const checkShip = !argv.includes('--no-ship');
  const checkDist = !argv.includes('--no-dist');
  const strict = argv.includes('--strict');
  const explicitFiles = argv.filter((a) => !a.startsWith('--'));

  const files =
    explicitFiles.length > 0
      ? explicitFiles.map((p) => {
          const m = DEFAULT_FILES.find((d) => path.resolve(d.path) === path.resolve(p));
          return { path: p, surface: m?.surface ?? null };
        })
      : DEFAULT_FILES;

  const reports: FileReport[] = [];
  try {
    for (const f of files) {
      if (!fs.existsSync(f.path)) {
        console.error(`  ! file not found: ${f.path}`);
        continue;
      }
      reports.push(validateFile(f.path, f.surface, checkShip));
    }
  } catch (err) {
    console.error(`FATAL: ${err instanceof Error ? err.message : String(err)}`);
    process.exit(2);
  }

  const { text, failed, distFailed } = formatReport(reports, { checkShip, checkDist, strict });
  console.log(text);
  if (!strict && distFailed && !failed) {
    console.log('  (distribution mismatches are WARN-only in WIP mode; re-run with --strict for final check)');
  }
  process.exit(failed ? 1 : 0);
}

main();
