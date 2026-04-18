/** Shared golden-set types and scoring used by ragQcRunner (QC harness) and qcEval (production eval).
 *
 * Phase 12 Sprint 12.0: extended with set-level `surface` + surface-specific
 * target_* fields so one schema covers code/lessons/chunks/global benchmarks.
 * Existing code-surface consumers keep working via optional `target_files`. */

export type Surface = 'code' | 'lessons' | 'chunks' | 'global';

/** Graded-relevance labels for nDCG. 0=irrelevant, 1=partial, 2=exact target. */
export type GradedHit = 0 | 1 | 2;

export type GoldenQuery = {
  id: string;
  group: string;
  query: string;
  path_glob?: string;
  must_keywords?: string[];

  target_files?: string[];
  target_lesson_ids?: string[];
  target_chunk_ids?: string[];
  target_any?: Array<{ type: 'file' | 'lesson' | 'chunk'; id: string }>;

  graded?: Array<{ id: string; grade: GradedHit }>;
};

export type GoldenSet = {
  version: string;
  surface?: Surface;
  project_id_suggested?: string;
  notes?: string[];
  queries: GoldenQuery[];
};

export function normalizePath(p: string) {
  return p.replace(/\\/g, '/').replace(/^\.?\//, '');
}

export function recallAtK(foundRanks: number[], k: number) {
  return foundRanks.some(r => r > 0 && r <= k) ? 1 : 0;
}

export function mrr(foundRanks: number[]) {
  const positives = foundRanks.filter(r => r > 0);
  if (!positives.length) return 0;
  const best = Math.min(...positives);
  return 1 / best;
}

export function keywordHit(snippet: string, must: string[]) {
  const s = snippet.toLowerCase();
  return must.every(k => s.includes(k.toLowerCase()));
}
