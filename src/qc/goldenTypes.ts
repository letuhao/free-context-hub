/** Shared golden-set types and scoring used by ragQcRunner (QC harness) and qcEval (production eval).
 *
 * Phase 12 Sprint 12.0: extended with set-level `surface` + surface-specific
 * target_* fields so one schema covers code/lessons/chunks/global benchmarks.
 * Existing code-surface consumers keep working via optional `target_files`.
 *
 * Phase 16 Sprint 16.1: extended with gen-eval fields (`ideal_answer`,
 * `must_contain_facts`, `forbidden_facts`, `answer_style`, `answer_category`,
 * `drafted_by`, `drafted_at`, `reviewed_by`, `reviewer_notes`). All new fields
 * are optional — when `ideal_answer` is absent the row is retrieval-only and
 * gen-eval is skipped. See docs/specs/2026-05-23-phase-16-rag-production-design.md §2.
 */

export type Surface = 'code' | 'lessons' | 'chunks' | 'global';

/** Graded-relevance labels for nDCG. 0=irrelevant, 1=partial, 2=exact target. */
export type GradedHit = 0 | 1 | 2;

/** Phase 16 §2: taxonomy for gen-eval rows. Standard = the ~138 bootstrap rows
 *  drafted from existing retrieval queries. The other five are hand-authored
 *  edge cases that stress specific synthesizer failure modes.
 *
 *  no_answer rows MUST have `ideal_answer` starting with the `[NO_ANSWER]` prefix
 *  — they signal that the question has no answer in the corpus and the
 *  synthesizer is expected to express inability rather than fabricate. The
 *  judge sidecar routes these to a custom `refusal_correctness` metric (see
 *  DESIGN §4.6). */
export type AnswerCategory =
  | 'standard'
  | 'multi_hop'
  | 'no_answer'
  | 'contradictory'
  | 'paraphrase'
  | 'distractor';

/** Drafter provenance. `llm` = produced by the Sonnet-subagent bootstrap pass;
 *  `human` = hand-authored (all edge cases). All rows must have a `reviewed_by`
 *  set before they ship — see validateGoldenQuery() invariants. */
export type DraftedBy = 'llm' | 'human';

/** Style hint passed to the synthesizer prompt at runtime. Default = 'concise'. */
export type AnswerStyle = 'concise' | 'detailed' | 'list' | 'code';

/** Prefix that `ideal_answer` MUST start with for `no_answer` rows. The judge
 *  sidecar uses this to route to `refusal_correctness`. */
export const NO_ANSWER_PREFIX = '[NO_ANSWER]';

export type GoldenQuery = {
  id: string;
  group: string;
  query: string;
  /** Legacy from Phase-6 queries.json; consumed by ragQcRunner/tieredBaseline,
   *  not by the Phase-12 runBaseline.ts. Kept for back-compat. */
  path_glob?: string;
  /** Consumed by Phase-12 runner: when a hit matches a target, the graded
   *  relevance is 2 only if ALL must_keywords appear (case-insensitive) in
   *  the returned snippet; otherwise graded=1 (weak hit). Also consumed by
   *  the legacy ragQcRunner. */
  must_keywords?: string[];

  target_files?: string[];
  target_lesson_ids?: string[];
  target_chunk_ids?: string[];
  /** Heterogeneous targets for global surface. The `type` union matches the
   *  retriever's emitted types (globalSearch returns lessons/documents/chunks/
   *  guardrails/commits), not the upstream storage taxonomy. `file` is not
   *  emitted by global search — use `document` for document rows. */
  target_any?: Array<{
    type: 'lesson' | 'document' | 'chunk' | 'guardrail' | 'commit';
    id: string;
  }>;

  /** Reserved for future per-item graded relevance (0/1/2 per target id).
   *  Phase-12 runner currently computes grades from hit + must_keywords;
   *  a future runner may consume this directly for ground-truth nDCG. */
  graded?: Array<{ id: string; grade: GradedHit }>;

  // ─── Phase 16 §2: gen-eval extension fields (all optional) ───
  // When `ideal_answer` is absent, the row is retrieval-only and the gen
  // pipeline is skipped. When present, all invariants in validateGoldenQuery()
  // apply.

  /** Canonical reference answer. For `no_answer` category, MUST start with
   *  `[NO_ANSWER]` prefix followed by a human-written explanation of why no
   *  answer exists. */
  ideal_answer?: string;

  /** Atomic factual claims that any correct answer MUST cover. Used by ragas
   *  `context_recall` metric and (informally) by reviewers to spot-check
   *  draft quality. Empty array allowed only for `no_answer` rows. */
  must_contain_facts?: string[];

  /** Anti-facts: claims an answer MUST NOT assert. Used by future custom
   *  fabrication-detection metric (Phase 17 candidate); not consumed in
   *  Sprint 16.3 first pass. */
  forbidden_facts?: string[];

  /** Synthesizer prompt hint. Defaults to 'concise' when unset. */
  answer_style?: AnswerStyle;

  /** Edge-case category. Required when `ideal_answer` is set. */
  answer_category?: AnswerCategory;

  /** Provenance — 'llm' for bootstrap rows, 'human' for edge cases. */
  drafted_by?: DraftedBy;

  /** ISO-8601 timestamp of draft creation. */
  drafted_at?: string;

  /** User/email of the human who reviewed and signed off on the row. MUST be
   *  set before the row ships to git per AC3 in Sprint 16.1 plan. */
  reviewed_by?: string;

  /** Free-form reviewer notes — disagreements with draft, paraphrase choices,
   *  reasoning for edge cases, etc. Useful for cross-reviewer calibration. */
  reviewer_notes?: string;
};

export type GoldenSet = {
  version: string;
  surface?: Surface;
  project_id_suggested?: string;
  notes?: string[];
  queries: GoldenQuery[];
};

// ─── Phase 16 §2.2: schema validator ───

export type ValidationError = {
  query_id: string;
  field: string;
  rule: string;
  message: string;
};

/** Enforces DESIGN §2.2 invariants on a single GoldenQuery. Returns array of
 *  errors; empty array = valid.
 *
 *  Rules enforced:
 *  R1: if `ideal_answer` is set, `answer_category` MUST be set
 *  R2: if `ideal_answer` is set and category != 'no_answer', `must_contain_facts`
 *      MUST have ≥1 entry
 *  R3: `no_answer` rows MUST have `ideal_answer` starting with `[NO_ANSWER]`
 *  R4: `no_answer` rows MUST have empty (or absent) `must_contain_facts`
 *  R5: if `ideal_answer` is set, `drafted_by` MUST be set
 *  R6: `forbidden_facts` only meaningful when `ideal_answer` is set (warning, not block)
 *  R7: if `drafted_by` is 'llm', a separate ship-readiness check (run pre-commit) ensures `reviewed_by` is populated; the runtime predicate WARNs but does not block here, so the standalone validator script can distinguish in-progress vs ship-ready rows.
 */
export function validateGoldenQuery(q: GoldenQuery): ValidationError[] {
  const errors: ValidationError[] = [];

  // R1
  if (q.ideal_answer !== undefined && !q.answer_category) {
    errors.push({
      query_id: q.id,
      field: 'answer_category',
      rule: 'R1',
      message: 'ideal_answer is set but answer_category is missing',
    });
  }

  // R2
  if (
    q.ideal_answer !== undefined &&
    q.answer_category &&
    q.answer_category !== 'no_answer' &&
    (!q.must_contain_facts || q.must_contain_facts.length === 0)
  ) {
    errors.push({
      query_id: q.id,
      field: 'must_contain_facts',
      rule: 'R2',
      message: `category '${q.answer_category}' requires ≥1 must_contain_facts entry`,
    });
  }

  // R3
  if (
    q.answer_category === 'no_answer' &&
    q.ideal_answer !== undefined &&
    !q.ideal_answer.startsWith(NO_ANSWER_PREFIX)
  ) {
    errors.push({
      query_id: q.id,
      field: 'ideal_answer',
      rule: 'R3',
      message: `no_answer rows MUST have ideal_answer starting with '${NO_ANSWER_PREFIX}'`,
    });
  }

  // R4
  if (
    q.answer_category === 'no_answer' &&
    q.must_contain_facts &&
    q.must_contain_facts.length > 0
  ) {
    errors.push({
      query_id: q.id,
      field: 'must_contain_facts',
      rule: 'R4',
      message: 'no_answer rows MUST have empty must_contain_facts (refusal has no facts to cover)',
    });
  }

  // R5
  if (q.ideal_answer !== undefined && !q.drafted_by) {
    errors.push({
      query_id: q.id,
      field: 'drafted_by',
      rule: 'R5',
      message: 'ideal_answer is set but drafted_by is missing',
    });
  }

  return errors;
}

/** Ship-readiness check — applied by the standalone validator at commit time.
 *  Returns errors for any row that has `drafted_by='llm'` but no `reviewed_by`.
 *  Separate from validateGoldenQuery() so in-progress rows during a drafting
 *  session don't block tsc/tests; only the pre-commit / final validator gates
 *  on ship-readiness. */
export function validateShipReadiness(q: GoldenQuery): ValidationError[] {
  if (q.ideal_answer === undefined) return [];
  if (q.drafted_by === 'llm' && !q.reviewed_by) {
    return [
      {
        query_id: q.id,
        field: 'reviewed_by',
        rule: 'R7',
        message: 'llm-drafted row must have reviewed_by set before commit',
      },
    ];
  }
  return [];
}

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
