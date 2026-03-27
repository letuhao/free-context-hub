/** Shared golden-set types and scoring used by ragQcRunner (QC harness) and qcEval (production eval). */

export type GoldenQuery = {
  id: string;
  group: string;
  query: string;
  path_glob?: string;
  target_files: string[];
  must_keywords?: string[];
};

export type GoldenSet = {
  version: string;
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
