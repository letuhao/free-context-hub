import fs from 'node:fs/promises';
import path from 'node:path';

import type { Env } from '../env.js';
import { getGeneratedDocument, upsertGeneratedDocument } from './generatedDocs.js';
import { searchCode } from './retriever.js';
import type { GoldenSet } from '../qc/goldenTypes.js';
import { keywordHit, mrr, normalizePath, recallAtK } from '../qc/goldenTypes.js';

export type ProductionEvalRow = {
  id: string;
  group: string;
  duration_ms: number;
  target_files: string[];
  found_ranks: number[];
  recall_at_3: number;
  mrr: number;
  must_keywords_ok?: boolean;
  top_paths: string[];
};

export type ProductionEvalArtifact = {
  generated_at: string;
  duration_ms: number;
  project_id: string;
  golden_version: string;
  mode: 'production_eval';
  queries_path: string;
  hybrid_mode: 'off' | 'lexical';
  kg_assist_default: boolean;
  totals: {
    n: number;
    recall_at_3: number;
    mrr: number;
    p95_ms: number;
  };
  by_group: Record<
    string,
    {
      n: number;
      recall_at_3: number;
      mrr: number;
      p95_ms: number;
    }
  >;
  fail_clusters: string[];
  results: ProductionEvalRow[];
};

function aggregateByGroup(results: ProductionEvalRow[]): ProductionEvalArtifact['by_group'] {
  const acc: Record<string, { n: number; recall_at_3: number; mrr: number; durations: number[] }> = {};
  for (const r of results) {
    const g = String(r.group ?? 'unknown');
    acc[g] ??= { n: 0, recall_at_3: 0, mrr: 0, durations: [] };
    const o = acc[g];
    o.n += 1;
    o.recall_at_3 += r.recall_at_3;
    o.mrr += r.mrr;
    o.durations.push(r.duration_ms);
  }
  const byGroup: ProductionEvalArtifact['by_group'] = {};
  for (const [g, o] of Object.entries(acc)) {
    const durations = o.durations.sort((a, b) => a - b);
    const idx = Math.max(0, Math.min(durations.length - 1, Math.ceil(durations.length * 0.95) - 1));
    byGroup[g] = {
      n: o.n,
      recall_at_3: o.n ? o.recall_at_3 / o.n : 0,
      mrr: o.n ? o.mrr / o.n : 0,
      p95_ms: durations[idx] ?? 0,
    };
  }
  return byGroup;
}

export async function runProductionGoldenEval(params: {
  projectId: string;
  queriesPath: string;
  hybridMode: 'off' | 'lexical';
  kgAssistByDefault: boolean;
}): Promise<ProductionEvalArtifact> {
  const raw = await fs.readFile(path.resolve(params.queriesPath), 'utf8');
  const golden = JSON.parse(raw) as GoldenSet;
  const started = Date.now();
  const results: ProductionEvalRow[] = [];

  for (const q of golden.queries) {
    const t0 = Date.now();
    const kgAssist = params.kgAssistByDefault || ['kg', 'queue', 'mcp-server'].includes(String(q.group ?? '').trim().toLowerCase());
    const out = await searchCode({
      projectId: params.projectId,
      query: q.query,
      pathGlob: q.path_glob,
      hybridMode: params.hybridMode,
      kgAssist,
      limit: 10,
      lexicalBoost: true,
      rerankMode: 'off',
      qcNoCap: false,
    });
    const matches = (out.matches ?? []).map(m => ({
      path: normalizePath(String(m.path ?? '')),
      snippet: String(m.snippet ?? ''),
    }));
    const rankedPaths = matches.map(m => m.path);
    const target = (q.target_files ?? []).map(normalizePath);
    const ranks = target.map(tf => rankedPaths.findIndex(p => p === tf)).map(i => (i >= 0 ? i + 1 : 0));
    const must = q.must_keywords ?? [];
    const hasKeywordEvidence = must.length
      ? matches.some(m => keywordHit(String(m.snippet ?? ''), must))
      : undefined;

    results.push({
      id: q.id,
      group: q.group,
      duration_ms: Date.now() - t0,
      target_files: q.target_files ?? [],
      found_ranks: ranks,
      recall_at_3: recallAtK(ranks, 3),
      mrr: mrr(ranks),
      must_keywords_ok: hasKeywordEvidence,
      top_paths: rankedPaths.slice(0, 10),
    });
  }

  const byGroup = aggregateByGroup(results);
  const durations = results.map(r => r.duration_ms).sort((a, b) => a - b);
  const p95Idx = Math.max(0, Math.min(durations.length - 1, Math.ceil(durations.length * 0.95) - 1));
  const totalP95 = durations[p95Idx] ?? 0;

  return {
    generated_at: new Date().toISOString(),
    duration_ms: Date.now() - started,
    project_id: params.projectId,
    golden_version: golden.version,
    mode: 'production_eval',
    queries_path: path.resolve(params.queriesPath),
    hybrid_mode: params.hybridMode,
    kg_assist_default: params.kgAssistByDefault,
    totals: {
      n: results.length,
      recall_at_3: results.reduce((a, r) => a + r.recall_at_3, 0) / Math.max(1, results.length),
      mrr: results.reduce((a, r) => a + r.mrr, 0) / Math.max(1, results.length),
      p95_ms: totalP95,
    },
    by_group: byGroup,
    fail_clusters: [],
    results,
  };
}

export type Phase6GateResult = {
  pass: boolean;
  reason: string;
  details: Record<string, unknown>;
};

export function evaluatePhase6Gates(params: {
  candidate: ProductionEvalArtifact;
  baseline: ProductionEvalArtifact | null;
  env: Env;
}): Phase6GateResult {
  const { candidate, baseline, env } = params;
  const details: Record<string, unknown> = {
    candidate_totals: candidate.totals,
    baseline_totals: baseline?.totals ?? null,
  };

  if (env.QUALITY_EVAL_MIN_RECALL_AT3 > 0 && candidate.totals.recall_at_3 < env.QUALITY_EVAL_MIN_RECALL_AT3) {
    return {
      pass: false,
      reason: `recall@3 ${candidate.totals.recall_at_3.toFixed(3)} < QUALITY_EVAL_MIN_RECALL_AT3 (${env.QUALITY_EVAL_MIN_RECALL_AT3})`,
      details,
    };
  }

  if (env.QUALITY_EVAL_MAX_P95_MS > 0 && candidate.totals.p95_ms > env.QUALITY_EVAL_MAX_P95_MS) {
    return {
      pass: false,
      reason: `p95_ms ${candidate.totals.p95_ms} > QUALITY_EVAL_MAX_P95_MS (${env.QUALITY_EVAL_MAX_P95_MS})`,
      details,
    };
  }

  if (baseline) {
    const delta = candidate.totals.recall_at_3 - baseline.totals.recall_at_3;
    details.recall_delta = delta;
    if (env.QUALITY_EVAL_MIN_RECALL_DELTA > 0 && delta < env.QUALITY_EVAL_MIN_RECALL_DELTA) {
      return {
        pass: false,
        reason: `recall@3 delta ${delta.toFixed(3)} < QUALITY_EVAL_MIN_RECALL_DELTA (${env.QUALITY_EVAL_MIN_RECALL_DELTA})`,
        details,
      };
    }
  }

  const regressGroups = env.QUALITY_EVAL_NO_REGRESS_GROUPS.split(',')
    .map(s => s.trim())
    .filter(Boolean);
  if (baseline && regressGroups.length) {
    const failures: string[] = [];
    for (const g of regressGroups) {
      const c = candidate.by_group[g];
      const b = baseline.by_group[g];
      if (!c || !b) continue;
      if (c.recall_at_3 + 1e-9 < b.recall_at_3) {
        failures.push(`${g}: ${c.recall_at_3.toFixed(3)} < ${b.recall_at_3.toFixed(3)}`);
      }
    }
    if (failures.length) {
      details.group_regressions = failures;
      return {
        pass: false,
        reason: `group regression on QUALITY_EVAL_NO_REGRESS_GROUPS: ${failures.join('; ')}`,
        details,
      };
    }
  }

  return { pass: true, reason: 'gates_ok', details };
}

export function computeFailClusters(artifact: ProductionEvalArtifact, minRecall: number): string[] {
  const out: string[] = [];
  for (const [g, o] of Object.entries(artifact.by_group)) {
    if (o.recall_at_3 < minRecall) out.push(g);
  }
  return out;
}

function parseBaselineContent(content: string): ProductionEvalArtifact | null {
  try {
    const j = JSON.parse(content) as ProductionEvalArtifact;
    if (j?.mode === 'production_eval' && j?.totals) return j;
  } catch {
    /* ignore */
  }
  return null;
}

export async function runQualityEvalAndPersist(params: {
  projectId: string;
  env: Env;
  queriesPath: string;
  hybridMode: 'off' | 'lexical';
  sourceJobId?: string;
  correlationId?: string;
  setBaseline?: boolean;
  baselineDocKey?: string;
  docKeySuffix?: string;
}): Promise<{
  artifact: ProductionEvalArtifact;
  gate: Phase6GateResult;
  baseline: ProductionEvalArtifact | null;
  doc_key: string;
}> {
  const baselineKey = params.baselineDocKey ?? params.env.QUALITY_EVAL_BASELINE_DOC_KEY;
  let baseline: ProductionEvalArtifact | null = null;
  const baselineRow = await getGeneratedDocument({
    projectId: params.projectId,
    docType: 'benchmark_artifact',
    docKey: baselineKey,
  });
  if (baselineRow?.content) {
    baseline = parseBaselineContent(baselineRow.content);
  }

  const artifact = await runProductionGoldenEval({
    projectId: params.projectId,
    queriesPath: params.queriesPath,
    hybridMode: params.hybridMode,
    kgAssistByDefault: params.env.QUALITY_EVAL_KG_ASSIST,
  });
  const minRecall = Math.max(0, params.env.QUALITY_EVAL_MIN_RECALL_AT3);
  artifact.fail_clusters = computeFailClusters(artifact, minRecall);

  const stamp = params.docKeySuffix ?? new Date().toISOString().replace(/[:.]/g, '-');
  const docKey = `quality_eval/${stamp}`;
  const gate = evaluatePhase6Gates({ candidate: artifact, baseline, env: params.env });

  await upsertGeneratedDocument({
    projectId: params.projectId,
    docType: 'benchmark_artifact',
    docKey,
    title: `Quality eval ${stamp}`,
    content: JSON.stringify(artifact, null, 2),
    metadata: {
      phase6: true,
      gate_pass: gate.pass,
      gate_reason: gate.reason,
      baseline_doc_key: baselineKey,
      correlation_id: params.correlationId ?? null,
    },
    sourceJobId: params.sourceJobId,
    correlationId: params.correlationId,
  });

  if (params.setBaseline) {
    await upsertGeneratedDocument({
      projectId: params.projectId,
      docType: 'benchmark_artifact',
      docKey: baselineKey,
      title: 'Quality eval baseline',
      content: JSON.stringify(artifact, null, 2),
      metadata: {
        phase6: true,
        role: 'baseline',
        promoted_from_doc_key: docKey,
        correlation_id: params.correlationId ?? null,
      },
      sourceJobId: params.sourceJobId,
      correlationId: params.correlationId,
    });
  }

  return { artifact, gate, baseline, doc_key: docKey };
}
