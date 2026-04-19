---
title: RAG Friction Classes
phase: 12
created: 2026-04-18
updated: 2026-04-18
---

# RAG Friction Classes — Catalog

A typology of retrieval pathologies observed in free-context-hub, surfaced by
the Phase-12 baseline scorecard (Sprint 12.0). Each class has:

- **Definition** — what the pathology is.
- **Why it happens** — the usual root cause.
- **Diagnostic signal** — which metric in the baseline scorecard exposes it.
- **Example** — a concrete instance grounded in real data.

The runner (`src/qc/runBaseline.ts`) classifies per-query results into at most
one class using simple heuristics. A query with no detected friction is
reported as `clean` (if it found its target) or `—` (adversarial-miss — the
query intentionally has no target).

## Sprint 12.1–12.2 intent
Every class below is a hypothesis about what's worth fixing. The baseline's
job is to quantify each class; downstream sprints pick the biggest lever and
post a diff showing it moved.

---

### duplicate-domination

**Definition.** The top-k result set is dominated by near-identical items
(same title, or nearly identical snippets). The retriever returns "the same
answer 6 times" instead of 6 distinct answers.

**Why it happens.** Lessons / documents / chunks get imported multiple times
(test fixtures, import-test projects, repeated seeding). Each duplicate is a
genuine DB row with its own ID and its own embedding that scores similarly,
so the ranker has no reason to collapse them.

**Diagnostic signal.** `duplication_rate_at_10 >= 0.3`. A value of 1.0 means
all 10 items share a key; 0.5 means half the items are dup-participants.

**Example (2026-04-18 lesson-search on `free-context-hub`):** query for
"RAG retrieval quality tiered search reranker" returned **10 near-duplicate
"Global search test retry pattern" rows out of top 15**, plus 4
auto-generated "Valid: impexp-…" fixtures. 602 lessons in the project.
Sprint 12.1 is scoped specifically to address this via storage-side
consolidation (dedup + near-duplicate merge + prune-on-decay).

---

### no-relevant-hit

**Definition.** Top-k contains no target from the query's golden set. A hit
exists in the DB; the retriever ranked it outside k.

**Why it happens.** Three common sub-causes —
(a) the target's embedding diverged from the query's (semantic blur),
(b) exact-term matches ranked below semantic near-matches (no hybrid retrieval),
(c) content is genuinely absent (but our golden set assumed it was present).

**Diagnostic signal.** `found_ranks === []` for a non-adversarial query;
aggregated as `coverage_pct < 1.0` where 1.0 is the ceiling for should-hit queries.

**Example.** Pending — first baseline run will populate.

---

### rank-order-inversion

**Definition.** A relevant hit exists in the top-k but is buried deep (rank
4 or later), while irrelevant items occupy ranks 1–3. Not a "not found"
problem; a "found but mis-ranked" problem.

**Why it happens.** Similarity-score ordering is not the same as relevance
ordering. Identical-keyword items score highest but may be noisier than
semantically-similar-but-lexically-different items.

**Diagnostic signal.** `found_ranks[0] > 3` with `duplication_rate < 0.3`
(the latter excludes the case where dup-domination is the real cause). MRR
will be much lower than recall@10.

**Example.** Pending — first baseline run will populate.

---

### retrieval-error

**Definition.** The surface adapter returned an error (HTTP 5xx, timeout,
malformed response) rather than items.

**Why it happens.** Stack instability under load — embeddings service under
pressure (the Phase-10 flake), MCP tool timeout, HTTP 500 from a handler.

**Diagnostic signal.** `per_query[i].error` set, `items = []`.
Aggregated as `errors > 0` in the surface summary.

**Example (Phase 11 known issue, carried into 12).** `POST /api/lessons`
occasionally 500s under full-suite load when the embeddings service is
saturated. Propagates up as retrieval-error in the lessons surface.

---

### empty-result-set

**Definition.** Top-k is empty. The retriever succeeded (no error) but
returned 0 items. Typically infrastructure-shaped, not ranker-shaped.

**Why it happens.** The surface is not populated in the project. At Sprint
12.0 baseline this is the code-search case in `free-context-hub`: the
`chunks` table is empty, so every query trivially returns an empty result.

**Diagnostic signal.** `top_k_keys.length === 0` and `error === undefined`.

**Example (2026-04-18).** All 67 queries against the `code` surface return
empty result sets because no project has indexed code chunks. Baseline
coverage for code will be 0.0. Phase-12 prereq: run `index_project` against
`free-context-hub` before code metrics can be meaningful. This is itself a
finding — the existence of the friction is the first nail.

---

### stale-fixture-noise

**Definition.** Auto-generated test fixtures pollute real-content retrieval.
Rows titled "Valid: impexp-…", "gui-create-…", "Improve test: improve-…"
appear in user-facing search results, displacing real content.

**Why it happens.** E2E and integration tests seed rows into the live
`free-context-hub` project rather than an isolated test project. Tests
don't clean up after themselves.

**Diagnostic signal.** Manual inspection of `top_k_titles` against a known
fixture-name regex (`^(Valid|Improve test|gui-create|Agent context
bootstrap e2e|Import [AB]):`). Quantitatively expressed as a sub-class of
`duplicate-domination` when fixtures are also duplicated.

**Example (2026-04-18).** 4 of 15 top lesson-search results were fixture
rows. Fix is part of Sprint 12.1 consolidation: add fixture-pattern
filtering to retrieval or move tests to isolated project_ids.

---

### wrong-domain-leakage

**Definition.** Cross-surface (global) search returns fixture/test data as
a top result when the user is asking about real content.

**Why it happens.** Global search uses ILIKE without relevance ranking
beyond updated_at DESC; recently-touched fixtures outrank older real content.

**Diagnostic signal.** For global surface: manual review of top-3 titles vs
known fixture-name regex. Not a flagged friction class by the runner
(requires human judgement); surfaced in the "Friction observed" section of
the scorecard.

**Example.** Pending — first baseline run will reveal.

---

### digit-collapse-false-positive

**Definition.** The `normalizeForHash` function in
`src/qc/metrics.ts` replaces every digit run with a single `'n'`
character before hashing. This is deliberate — it lets timestamp-variant
fixture clusters like `"Valid: impexp-1775368159562-extra"` and
`"Valid: impexp-1775368419347-extra"` collapse to one key. But it also
collapses genuinely distinct content: `"Phase 10"` and `"Phase 11"` both
normalize to `"phase n"`, as do `"v1.2.3"` and `"v2.0.0"`
(`"vn.n.n"`).

**Why we accept it (for now).** The v1 key is
`normalize(title) || normalize(snippet[:100])` — the `||` delimiter
requires BOTH components to match. So a "Phase 10" / "Phase 11" pair
only collapses under v1 if their snippets also normalize-equal. For the
free-context-hub dataset at 2026-04-18, verified empirically: all
observed v1-collapsed clusters have near-identical snippets (they are
true duplicates). The false-positive risk is latent, not active.

**Diagnostic signal.** Two top-k items whose titles differ by a version
number or a count, paired with nearly-identical snippets, may collapse
into one v1 dup-cluster even when a reader would call them distinct.
Surfaces as unexpectedly-high `duplication_rate_nearsemantic_at_10`
on a dataset where the eyeballed top-k looks mostly distinct.

**Future fix path.** If false-positives bite, iterate to a less-aggressive
normalizer — e.g. preserve single-digit version strings, only collapse
4+ digit runs (which reliably correspond to timestamps). Costs more code
but reduces the risk.

---

### snippet-redundancy *(deferred)*

**Definition.** Distinct DB rows with different IDs but identical content
snippets. Most extreme form of duplicate-domination; dup-rate at `key = id`
is 0, but dup-rate at `key = snippet_hash` is high.

**Status.** Deferred to Phase 12.1 implementation. The v0 duplication-rate
metric matches on normalized ID only. A v1 metric with `key = hash(title) |
hash(snippet[:100])` may be added when near-duplicate detection is
implemented in consolidation.

**Why this matters now.** The 2026-04-18 first baseline run reports `dup@10
= 0` across every surface despite ≥5 "Max retry attempts must be 3"
guardrails and ≥6 "Global search test retry pattern" decisions existing in
the `free-context-hub` project. The v0 dup-rate metric is **silent on the
exact pathology the sprint was launched to observe.** Sprint 12.1 must fix
this before claiming any "consolidation" improvement.

---

### measurement-jitter

**Definition.** Quality metrics drift non-trivially between baseline runs
separated by more than a few minutes, despite no changes in retrieval code
or data. The `diffBaselines.ts` regression checker then flags noise as
regression.

**Why it happens.** Embedding services (and the MCP server's pooled
resources) jitter under load. Back-to-back baseline runs (seconds apart)
return byte-identical quality metrics — verified in Sprint 12.0's
determinism check. Runs separated by hours can diverge on a small number
of queries: Sprint 12.0 → Sprint 12.0.1 (≈2h apart) showed lessons
`recall@10` drift from 1.0 → 0.94 even though no lesson-ranking code
changed in between.

**Diagnostic signal.** A reported regression (`nDCG@10 drop ≥0.05`, etc.)
on a metric whose backing code paths have not changed between the two
archives. Cross-check by looking at `git log` for the two archives' commit
hashes — if nothing relevant changed, the "regression" is likely jitter.

**Mitigation (operator protocol).** To prove a real improvement in a
Phase-12 sprint:
1. Run the new-state baseline.
2. **Also run a back-to-back control baseline** at the same time under
   the same stack load (same `--samples` count).
3. Diff control vs control first to establish the per-run noise floor
   (should be ≈ 0 across quality metrics).
4. Then diff control vs new-state. A delta larger than the control-vs-
   control floor is signal; anything smaller is jitter.

**Fix landed (Sprint 12.0.2).** `runBaseline --control` runs the golden
set twice back-to-back, computes `|run2 − run1|` per metric per surface,
embeds the result in `archive.noise_floor`. `diffBaselines.ts` reads
this field (Sprint 12.0.2 /review-impl MED-1) and badges within-floor
deltas as ⚪ `(within floor)` rather than 🔴/🟢, and skips regression
flagging when a breach is within the floor. The per-run timings are
also preserved (`archive.control_elapsed_ms` / `new_elapsed_ms`) so a
reader can distinguish time-of-one-run from time-of-two-stitched.

**Known caveat (Sprint 12.0.2 /review-impl LOW-1).** `--control` runs
back-to-back on a stack that's already warm from the control run —
caches, connection pools, JIT-ed embedding code are all hot by the time
the new-state run begins. The measured noise floor therefore reflects
**warm-cache jitter**, which is the common condition for sprint-author
measurement. Cold-start variance (first-of-the-day run against a just-
restarted stack) is NOT captured. If you need that data, run two cold
baselines with a full stack restart between them — or extend
`--control` to take a `--control-warmup-runs N` option in future.

**Small-goldenset tail sensitivity (Sprint 12.1b /review-impl LOW-5).**
With N queries × `--samples 1`, the latency p95 aggregate is computed
over N samples. For small goldensets (chunks has 10 queries), p95 is
the 10th-rank value — essentially the MAX of 10 samples. A single tail
outlier in either of the two --control runs swings p95 by a lot.
Observed in Sprint 12.1b A/B on chunks: p95 noise floor = 98ms while
absolute p95 ≈ 50ms (~2× ratio). Mitigation: use `--samples 3` or
higher for surfaces with fewer than ~20 queries; the aggregate then
uses 3N samples, p95 at a more robust rank. For the lessons surface
(20 queries, samples 1), the ratio was ~5% — much tighter.

---

### index-hygiene

**Definition.** The `chunks` table contains files that shouldn't be
treated as retrieval targets: build outputs, framework cache, agent
workspace metadata, compiled `.js` duplicates of source `.ts`.

**Why it happens.** `index_project` defaults exclude `.git` and
`node_modules` (see `src/services/indexer.ts:55`) but don't exclude
`dist/`, `.next/`, `.claude/worktrees/`, or similar project-level build
outputs. An unconfigured run ingests them all.

**Diagnostic signal.**
```sql
SELECT file_path, COUNT(*)
FROM chunks
WHERE project_id = $1
GROUP BY file_path
ORDER BY COUNT(*) DESC
LIMIT 20;
```
Look for entries under `dist/`, `gui/.next/`, `.claude/`, or compiled
output equivalents.

**Example (Sprint 12.0.1 initial indexing of free-context-hub).** Of 3925
chunks, ~2800 were junk: 1105 `dist/*`, 1699 `gui/.next/*`, 2027
`.claude/*` (worktrees + session files). Purged via direct SQL DELETE,
leaving ~959 `src/` + 432 `docs/` + the rest of the legitimate corpus.

**Future fix path.** Configure project-level ignore patterns via
`prepare_repo` or a `.contexthubignore` convention. Until then, operators
must purge post-indexing — idempotent but manual.

---

### e2e-cleanup-accumulates-archived-rows

**Definition.** E2E test cleanup (`test/e2e/shared/cleanup.ts`) archives
test lessons rather than deleting them. Archived rows don't pollute
retrieval (the default status filter excludes them), but they accumulate
in the DB over many test runs. Not a correctness issue — a bloat /
hygiene one.

**Why it happens.** The `/api/lessons/:id` endpoint has no DELETE verb
as of 2026-04-18 (archive-via-status is the only affordance). Test code
has to fall back to the same mechanism real users do.

**Diagnostic signal.** `SELECT status, COUNT(*) FROM lessons WHERE
project_id = 'e2e-test-project' GROUP BY status` shows a growing
`archived` count over test-run history.

**Example (Sprint 12.0.2).** The new `dedup-wiring-collapses-near-
duplicate-cluster` e2e test seeds 5 lessons per run. After 100 runs,
~500 archived rows live under `e2e-test-project`. Harmless but
untidy. Noted as a future-work item for either (a) a hard-delete
endpoint, or (b) a test-setup convention where each test uses a fresh
throwaway project_id that can be DELETE'd whole.

---

### popularity-feedback-loop

**Definition.** An access-frequency salience signal (weight applied to
retrieval ranking based on how often a lesson has been surfaced) creates
a self-amplifying bias: lessons that appear in many queries' top-k
accumulate salience that boosts them in future searches, even when the
new query's actual target is a specific narrow-topic lesson. The "rich
get richer" — popular lessons become more popular; narrow targets get
pushed down.

**Why it happens.** Rank-weighted `consideration-search` signals are too
easy to earn. A lesson with broad keyword overlap appears at rank 2-8 for
many queries, each contributing `weight = 1/rank`. Over even a single
day of benchmark runs, it accumulates enough weighted-score to outrank
narrow query-specific targets that only appear in one query at rank 1.

**Diagnostic signal.** MRR and nDCG drop on a goldenset where each query
targets a distinct lesson, while popular adjacent lessons stay in top-k.
`recall@10` unchanged (targets still found) but positions shift.
Distinguishable from noise because the drop is consistent across
back-to-back --control runs (same-code noise floor is near-zero).

**Example (Sprint 12.1c — first biological-memory feature).** Default
α=0.10 + 7-day half-life + audit-bootstrap (90 rows) + rank-weighted
consideration-search. A/B on lessons surface showed:

  - recall@10: 1.0 → 1.0 (unchanged — targets still retrieved)
  - MRR:       0.9608 → 0.9235 (−0.037, beyond zero noise floor)
  - nDCG@5:    0.9706 → 0.9499 (−0.021)
  - nDCG@10:   0.9628 → 0.9502 (−0.013)

Not a bug — a known failure mode of naive access-frequency signals.
Traced the access log: after 4 benchmark runs, 1,200 consideration-search
rows accumulated. Lessons appearing in multiple queries (retry/backoff/
integration-test topic clusters) accumulated ~3-5× the salience of
single-query targets, causing them to outrank those targets when α=0.10.

**Mitigation paths for future sprints (12.1d+).**

1. **Query-conditional salience** — only boost lessons that also have
   semantic proximity to the current query. Compute salience × semantic
   similarity, not salience alone. Prevents popular-but-unrelated from
   rising.

2. **Drop `consideration-search` as a signal class** — rely only on
   strong consumption signals (`consumption-reflect`, `consumption-
   improve`, `consumption-tags`, `consumption-versions`) which require
   the consumer to actually dereference the lesson, not just see it
   surfaced. Rank-weighted consideration creates the feedback loop
   because the signal is too cheap to earn.

3. **Per-lesson-per-day cap on consideration-search weight** — one
   weight contribution per lesson per 24h window. Prevents rapid-fire
   benchmark runs from amplifying popularity.

4. **Lower α (0.02-0.05) with longer half-life (14-30d)** — smaller
   per-query shifts, longer-horizon memory. Biologically plausible
   (short-term working memory is fast + tight; long-term consolidation
   is slow + loose).

5. **Backfill from more sources** — `git_lesson_proposals`,
   `activity_log`, explicit lesson-pin mechanism. Diversifies the
   salience signal so it's not dominated by historical-guardrail bias.

Sprint 12.1d would experiment with (1) + (4) as the most promising
combination. 12.1c ships the infrastructure; calibration is deferred
explicit follow-up work.

**Related: bootstrap decay.** The audit-bootstrap seed (context=
'audit-bootstrap') ages. At 7-day half-life, 14-day-old audit rows
contribute ~0.25 weight; at 28 days they contribute 0.06. Within a few
weeks, fresh `consideration-search` rows dominate. This is intentional
biological consolidation (fresh signals override stale), but worth
noting: the "flashbulb memory" seed is a short-lived prior, not a
permanent one. If Sprint 12.1d reduces `consideration-search` weight
aggressively, the bootstrap gets proportionally more durable.

---

### downstream-behavior-coupling

**Definition.** A retrieval-layer change (e.g. dedup) silently alters the
output of downstream consumers that pipe retrieval results into further
processing (e.g. LLM synthesis, summarization). The retrieval change is
the intended sprint scope; the downstream shift is a side-effect the
sprint did not explicitly scope.

**Why it happens.** Retrieval results flow through many consumers:
REST API, MCP tool, GUI search, chat tool, `reflect` LLM-synthesis tool,
etc. When a retrieval primitive changes, every consumer's observed
behavior changes. Consumers that weight retrieval output by repetition
(LLM synthesis that sees the same bullet 5× will emphasize it) are
particularly affected.

**Diagnostic signal.** A downstream tool's output changes after a
retrieval-layer sprint, even though nothing in the tool's code changed.

**Example (Sprint 12.1a dedup).** The `reflect` MCP tool calls
`searchLessons({ limit: 12 })`, maps matches to bullets, feeds them to
`reflectOnTopic` (LLM synthesis). Previously, a query about retry
strategy retrieved 5 near-identical "Max retry attempts must be 3"
bullets — LLM synthesis weighted that point heavily because of
repetition. Post-Sprint-12.1a dedup, reflect sees one representative
per cluster; LLM synthesis gets cleaner variety. The effect is
(arguably) *better* synthesis — less bias from accidental fixture
duplication — but it IS a behavior change. Operators running the same
reflect query before vs after 2026-04-18 will get different answers.

**Example (Sprint 12.1b chunks dedup).** The `search_documents` chat
tool (`src/api/routes/chat.ts:86`) calls `searchChunks({ limit: 5 })`
and pipes matches into chat-LLM synthesis for doc-Q&A. Same dynamic as
the reflect tool above: pre-12.1b, 3 sample.pdf "extraction failed"
chunks could dominate 3 of 5 bullets, skewing the LLM's answer toward
the extraction-failure boilerplate. Post-12.1b, the cluster collapses
to 1; the LLM sees 4 other distinct chunks. Operators running the same
ask-AI / chat-search query before vs after 2026-04-18 get a cleaner
synthesis.

**Future fix path.** When changing a retrieval primitive:
1. Enumerate downstream consumers (grep for the function name).
2. Spot-check each consumer's output on a representative query pre- vs
   post-change.
3. Document the behavior delta in the session patch even when the
   delta is benign — prevents future mysteries ("why did reflect's
   answer shape change between these dates?").

---

### benchmark-wiring-gap

**Definition.** A unit test exists for a pure function but no
integration test proves the function is invoked correctly by the full
pipeline. A refactor could move or remove the invocation and all unit
tests still pass.

**Why it happens.** Pure-function tests are cheap; integration tests
require mocking the DB pool, embedding service, rerank client, etc.
When time pressure meets "the unit tests are green," integration tests
slide.

**Diagnostic signal.** The function is imported but never called
(detectable via grep). Or the function is called but not at the
semantically-correct point in the pipeline.

**Example (Sprint 12.1a dedup wiring).** `dedupLessonMatches` has
9-12 unit tests exercising every input pattern. But no integration
test proves:
- `searchLessons` actually calls dedup (vs accidentally short-circuiting).
- Dedup runs AFTER rerank (invariant: dedup respects reranker order).
- `searchLessonsMulti`'s cross-project merge runs BEFORE dedup (so
  cross-project dups would collapse — which MED-1 fix now prevents via
  project_id in the key, but the wiring order still matters).

**Future fix path.** Add integration tests with `tsx --test` that mock
`getDbPool()` and the rerank entry points, call `searchLessons`, and
assert the final matches list has dedup-applied characteristics.
Deferred to a future 12.0.3 cleanup pass.

**Sprint 12.1b /review-impl update — REST-level e2e tests fight infrastructure.**
The 12.0.2 lessons e2e test (`dedup-wiring-collapses-near-duplicate-cluster`)
and the 12.1b attempt to add an equivalent chunks e2e test BOTH hit
infrastructure reality walls that defeat the test's intent:

  1. **Distillation non-determinism (lessons).** When
     `DISTILLATION_ENABLED=true`, `addLesson` distills a summary via
     LLM at write time. Identical content may produce slightly-
     different summaries across 4 writes (LLM jitter, model drift).
     `content_snippet = summary ?? content` in the search response →
     different summaries → different `nearSemanticKey` → dedup misses
     cluster members. Test skipped when DISTILLATION_ENABLED=true.

  2. **Async chunk extraction (chunks).** `POST /api/documents`
     returns 201 before chunking completes (chunker is queued, not
     inline). Searching immediately after POST returns 0 chunks even
     though the docs exist. No simple wait/poll mechanism exposed
     via the REST surface. Chunks wiring test skipped entirely.

Both skipped tests preserve the INTENT in code and log a clear SKIP
reason pointing at the infrastructure cause. **The actual wiring proof
lives in the A/B baseline archives** (docs/qc/baselines/2026-04-18-
sprint-12.1a-*.json and sprint-12.1b-*.json): if dedup silently
unwires, the next `qc:baseline -- --control` run immediately regresses
`dup@10 nearsem` back to 0.43 / 0.29. Baseline is the integration test.

**Resolution paths for a future sprint that wants cleaner proof:**
  - Add `summary` override to POST /api/lessons (skip distiller when
    caller provides it) — enables deterministic lessons dedup tests.
  - Expose an extraction-complete signal or make POST /api/documents
    synchronous under a test-only flag — enables chunks dedup tests.
  - Or invest in mocked-pool unit tests at the service layer.

---

### golden-set-ceiling-bias

**Definition.** The golden set's queries are paraphrases of content that
lives in the retrieval index, and its target ids were cherry-picked from
the most-recently-active records. The baseline's `recall@10 = 1.0` reflects
"the queries are easy" rather than "the retriever is strong." A future
sprint could legitimately worsen ranking on unseen queries while the
golden-set numbers stay at ceiling.

**Why it happens.** When a benchmark is authored by someone who has just
eyeballed the index, query authorship is biased toward content that clearly
exists. Adversarial queries (synonyms, typos, indirect references, multi-hop
intent) are harder to hand-craft but are the ones a real user types.

**Diagnostic signal.** Two archives with meaningfully different retrievers
produce the same recall@10 on the same golden set. When this happens, the
golden set — not the retriever — has hit its ceiling.

**Example.** Sprint 12.0 baseline: `recall@10 = 1.0` on the 15-confident-hit
lesson queries, and `nDCG@10 = 0.82` (not 1.0 only because must_keywords
downgrade some hits from grade 2 to grade 1). The retriever gets "perfect"
coverage for queries I wrote. This tells us nothing about how it would
handle a user asking "how do I stop the backoff loop from firing on 4xx"
versus the target "Max retry attempts must be 3".

**Mitigation path (Sprint 12.0.1 or 12.1 prep).**
1. Add ≥10 adversarial lesson queries: synonyms, abbreviations, typos,
   indirect intent. Target ids stay the same; only phrasing changes.
2. Add a "hard-miss" group: queries that describe content we know *is not*
   in the index. Assert `recall@10 = 0` — any hit is a false positive.
3. Record in the scorecard: "recall@10 on confident-hit vs adversarial"
   split so the gap is visible.

---

### goldenset-grading-asymmetry

**Definition.** Queries with `must_keywords=[]` receive automatic grade-2 (exact)
for every target hit via vacuous truth on `mustKw.every(...)`. Queries with
populated `must_keywords` can produce grade-1 (weak) hits when the snippet
lacks the required tokens. Cross-goldenset nDCG comparison across runs with
different must_keywords distributions is therefore apples-to-oranges — the
delta includes a grading-treatment component, not just retriever behavior.

**Why it happens.** The grade=2 vs grade=1 logic in
`src/qc/runBaseline.ts:201-202` treats "no required keywords" as "fully
trust the hit." This is the correct behavior for individual queries (a multi-
target ambiguous query shouldn't force keyword gating) but it means two
goldensets with different must_keywords proportions have systematically
different nDCG ceilings.

**Diagnostic signal.** nDCG@10 delta between two archives whose goldensets
have meaningfully different ratios of empty-must_keywords queries. For the
Sprint 12.1d-fix (20q) → 12.1e1 (40q) diff, the legacy queries have
populated must_keywords; the 15 new ambig queries have
`must_keywords=[]`. The +0.0187 nDCG@10 delta partly reflects the shift in
grading treatment, not purely retriever quality.

**Example — Sprint 12.1e1.** The cross-goldenset nDCG@10 rose 0.9407 → 0.9594.
Spot-check: `lesson-ambig-dedup-key-design` returns targets at ranks [1,3,4,6]
all graded-2 because its must_keywords is empty. If those ranks had been
graded [2,1,1,1] under a populated must_keywords rule, the query's nDCG@10
would be materially lower.

**Mitigation.** Within-goldenset comparison (same goldenset, different runs)
is unaffected — grading rules apply uniformly. For CROSS-goldenset comparison,
explicitly disclose the must_keywords distribution shift in the diff
interpretation. Sprint 12.1e2 should compare WITHIN-12.1e1-goldenset-only;
don't chain cross-sprint deltas that span goldenset revisions.

**Cross-ref.** Sprint 12.1e1 /review-impl MED-1 (commit pending).

---

### goldenset-target-drift

**Definition.** A goldenset query's target lesson was chosen at authorship
time via keyword-overlap or topic-proximity. New lessons added to the corpus
can outrank the target for the same query, pushing it out of top-K. The
query then reports a spurious MISS, flagged as "no-relevant-hit" friction,
but the real issue is the loose target choice combined with corpus growth.

**Why it happens.** Goldenset queries are frozen snapshots of "what was
retrievable when authored." The corpus is a living system. As new content
arrives, loose query↔target mappings degrade — especially when the original
match relied on a surface token (e.g., "workflow") rather than semantic tightness.

**Diagnostic signal.** A query that HIT in a prior baseline now MISSes, AND
the query↔target mapping was never tight (the target lesson doesn't
specifically describe the topic the query asks about). Distinguishable from
a real retriever regression by: (a) top-10 contains other on-topic lessons,
(b) the specific target was a loose keyword-adjacent choice originally.

**Example — Sprint 12.1e1.** `lesson-cross-workflow-gate` query:
`workflow gate state machine 12-phase workflow v2.2` with target
`a0792c20` (Invoke /review-impl by default). The target lesson is about
/review-impl default invocation, not the workflow-gate state machine — the
original match was via "workflow" token overlap. 12.1e1's broader corpus
(new salience + baseline lessons) outranks a0792c20 for generic "workflow"
queries, producing a MISS that looks like a regression.

**Mitigation (per-query).** When a loose cross-topic match starts missing,
either: (a) re-target to a multi-target group of on-topic lessons (any-hit
preserves probe intent + survives data drift), (b) retire the query if no
lesson tightly describes its intent, or (c) tighten the query to match the
existing target's actual content.

**Sprint 12.1e1 response.** Re-targeted `lesson-cross-workflow-gate` to
`[a0792c20, e87cd142, 4e28d4bc]` — all workflow-adjacent lessons. Documented
as /review-impl MED-2.

**Cross-ref.** Sprint 12.1e1 /review-impl MED-2 (commit pending).

---

### goldenset-pollution

**Definition.** Measurement infrastructure that writes to the same state
it reads from can distort subsequent measurements. For free-context-hub,
every `qc:baseline` run accumulates `consideration-search` rows in
`lesson_access_log`; accumulated over many runs, these inflate the
salience of goldenset-target lessons and shift subsequent ranking
measurements.

**Why it happens.** `searchLessons` and `searchLessonsMulti` call
`logLessonAccess` fire-and-forget for every top-K match (per Sprint
12.1c write paths). Baseline runs exercise these paths. A 40-query
goldenset × K=10 × samples=3 writes ~1200 rows per run. Duplicate-trap
queries with 9-20 UUID targets each write 9-20 rows per query sample,
disproportionately inflating fixture-lesson salience.

**Diagnostic signal.** A baseline run shows top-K results dominated by
lessons whose titles look like test fixtures (`impexp-*`,
`agent-bootstrap-e2e-*`, `gui-filter-*`) or duplicate-group cluster
members, especially for abstract or semantically-distant queries.
Numerically: the change shows up at longer half-lives (≥ 14d) where
old access-log rows have enough weight to compete with hybrid-score.

**Example — Sprint 12.1e2.** Polluted-sweep HL=30: the undici paraphrase
query `why does swapping http agents between the default and an
installed one break streaming bodies` dropped rank-1 → rank-7 because
6 fixture lessons outranked the true target via accumulated salience.
On cleaned state (90 audit-bootstrap rows only), the same query hits
rank-2. The "regression" was entirely a measurement artifact.

**Mitigation paths.**
1. **Use `LESSONS_SALIENCE_NO_WRITE=true`** (Sprint 12.1e3) before
   salience-sensitive baseline runs. Reads still compute salience;
   writes are suppressed. One env flag, no state mutation. This is
   the recommended mitigation — cheap, non-destructive, toggle-friendly.
2. **Truncate before/after** (manual, error-prone, DESTRUCTIVE):
   `DELETE FROM lesson_access_log WHERE context='consideration-search'`
   after backing up. Used by Sprint 12.1e2 before NO_WRITE existed.
3. **Isolated measurement database** (long-term): a separate
   `lesson_access_log_baseline` table. Higher complexity; unnecessary
   given NO_WRITE.

**Cross-ref.** Sprint 12.1e2 POST-REVIEW investigation (commit 301d3e0)
discovered the pattern; Sprint 12.1e3 (pending commit) lands the
NO_WRITE flag as the non-destructive mitigation.

---

### measurement-write-drift

**Definition.** A measurement that modifies its own input during the
measurement can produce artifacts that look like signal. For
free-context-hub salience sweeps: each baseline query's fire-and-forget
`consideration-search` write lands in `lesson_access_log` BEFORE the
next query samples its salience score. Later queries therefore see more
rows than earlier queries, asymmetrically inflating salience for
whichever lessons those earlier queries matched.

**Why this is different from goldenset-pollution.** Goldenset-pollution
is the ACROSS-sprint version — 20+ baseline runs leave permanent bloat.
Measurement-write-drift is the WITHIN-sprint (and within-single-run!)
version — even a single fresh run has asymmetric state across its own
queries.

**Why it happens.** `searchLessons` and `searchLessonsMulti` call
`logLessonAccess` fire-and-forget for every top-K match, ~10 rows per
query sample. For a 40-query baseline at samples=1, query 40 sees
`N_start + 390` rows; query 1 sees `N_start`. The gap is entirely
fresh rows (age < runtime, ~15min). Fresh rows decay by ~exp(-0/HL) ≈
1.0 at any half-life ≥ 1d, so they contribute equally regardless of HL.
But their presence inflates the absolute magnitude of all lessons'
salience scores, which can shift rank-order interactions with hybrid
scores even when salience alone wouldn't.

**The trap for A/B sweeps across half-life.** Drift amount is
approximately HL-independent, but drift EFFECT on ranking is HL-
dependent — it competes differently with other salience contributions
that ARE HL-sensitive (audit-bootstrap). At HL=30, bootstrap has ~0.12
weight per row; drift-contributed fresh rows have ~1.0 weight; the two
interact. At HL=7, bootstrap has ~10⁻⁴ weight; drift dominates. This
causes a SYSTEMATIC difference between HL=7 and HL=30 runs under drift
that DISAPPEARS under NO_WRITE. Mistaking this artifact for "HL=30 is
better" is exactly what Sprint 12.1e2 did.

**Diagnostic signal — the 2×2 test.** If you suspect a measurement is
contaminated by write-drift, run the 2×2:

| | HL=X | HL=Y |
|---|---|---|
| drift (no NO_WRITE) | A | B |
| NOWRITE | C | D |

If `A → B` delta ≠ `C → D` delta, drift was a confounding factor.
If `C → D ≈ 0`, the half-life change has no real effect on THIS
goldenset in THIS state; the `A → B` signal was entirely drift.

**Example — Sprint 12.1e3's 2×2 on the 40q goldenset:**

| | HL=7 | HL=30 |
|---|---:|---:|
| drift (samples=1, no NO_WRITE) | nDCG@10 = 0.9495 | 0.9649 (+0.0154) |
| NOWRITE (samples=1) | 0.9521 | 0.9469 (−0.0052, within noise 0.013) |

The drift delta (+0.0154) is HL=30's apparent win; the clean delta
(−0.0052) shows HL=30 is actually within-noise and marginally worse.
Sprint 12.1e2 measured the drifted version only and changed env.ts
default 7→30 on polluted data. Sprint 12.1e3 reverted the default
after the 2×2 revealed the artifact.

**Mitigation.**
1. **Always use `LESSONS_SALIENCE_NO_WRITE=true`** for salience-sensitive
   A/B sweeps (Sprint 12.1e3's NO_WRITE flag). This eliminates
   within-run write drift entirely.
2. For pre-12.1e3 sweeps, the drift-amount is approximately equal
   across both sides of an A/B, so comparing deltas is not fully
   invalid — but the absolute magnitudes are inflated, and effects
   that compete with drift (like HL-sensitive bootstrap salience) can
   produce artifact deltas.

**Cross-ref.** Sprint 12.1e3's 2×2 analysis surfaced this pattern
(baselines: `2026-04-19-sprint-12.1e2-hl{7,30}-clean.json` drifted vs
`2026-04-19-sprint-12.1e3-{validate,hl7-nowrite}.json` NOWRITE). The
finding motivated reverting `LESSONS_SALIENCE_HALF_LIFE_DAYS` default
from 30 back to 7 in the same sprint.

---

### llm-rerank-cross-session-drift

**Definition.** The LLM-based reranker (`rerankGenerative`, configured
via `DISTILLATION_MODEL` + `DISTILLATION_ENABLED=true`) at temperature=0
produces **non-deterministic output across container recreates** even
when called with identical input. Single-container same-session calls
ARE deterministic (2 consecutive REST calls against same mcp container
return byte-identical results). But 90min-separated baseline runs at
the same config drift significantly — likely due to LM Studio internal
state changes (model cache warm/cold, batch context, etc.).

**Why it happens.** Local LLM backends (LM Studio, llama.cpp, etc.)
can exhibit subtle non-determinism even at temp=0 due to: floating-
point non-associativity in batched matrix operations, memory layout
differences between cold/warm starts, tokenizer state, or CUDA kernel
selection. Temperature=0 forces greedy sampling but doesn't guarantee
identical logits across invocation contexts.

**Diagnostic signal.** Same config (env vars, state, query) runs at
different times produce different `top_k_keys` for one or more
queries, particularly at rank-10-borderline positions where small
logit differences flip HIT/MISS. Sprint 12.1e4 observed **7/40 queries
drifting** between two HL=7 α=0.05 runs ~90min apart (MRR dropped
0.9784 → 0.9514 from drift alone).

**Scale of impact.** Drift magnitude ~0.027 MRR / ~0.031 nDCG@10 —
**exceeds most parameter signals we try to measure.** Any A/B sweep of
small-effect parameters (α, half-life tweaks) without controlling for
this drift produces spurious signal.

**Example — Sprint 12.1e4 initial 8-run grid.** Apparent "outliers"
at (HL=7, α=0.10) and (HL=30, α=0.20) — rank drop for
lesson-cross-sprint-11-closeout from rank-1 to MISS. Initially
interpreted as α-specific bad spot. Validation via rerank-off runs
showed A=B (α=0.05 vs α=0.10) are IDENTICAL under rerank-off, proving
the "α effect" was 100% rerank drift.

**Mitigation paths.**
1. **Disable rerank for baselines:** `DISTILLATION_ENABLED=false
   docker compose up -d --force-recreate mcp`. Eliminates the drift
   entirely. Also ~100× faster (rerank was the entire elapsed time).
   Trade-off: rerank adds ~0.06 MRR quality improvement when it "works"
   — but non-deterministically. For measurement, skip it.
2. **Same-session back-to-back A/B:** run the full A/B matrix inside a
   single session with minimal time gap. Reduces drift window but
   doesn't eliminate it.
3. **Switch to cross-encoder rerank:** `RERANK_TYPE=cross-encoder` uses
   a deterministic embedding-based rerank (provided the embedding
   backend is deterministic, which it is for LM Studio embeddings).
   Product decision: does the deterministic cross-encoder give equal or
   better quality than the generative reranker? Deferred.

**Cross-ref.** Sprint 12.1e4 POST-REVIEW investigation surfaced this
pattern. Validation runs `2026-04-19-sprint-12.1e4-hl{7-a010,7-a005}-norerank.json`
+ `-hl7-a010-norerank-rerun.json` prove determinism of no-rerank path.

---

### salience-blend-noop-when-no-access-history

**Definition.** The `blendHybridScore(hybrid, salience, α, relevance)`
function short-circuits to `hybridScore` unchanged when `salience` is
undefined or ≤ 0. For queries whose candidate lessons have NO entries
in `lesson_access_log`, the entire salience blend is a no-op — α and
HL have literally zero effect.

**Why it happens.** `src/services/salience.ts:242`:
```
if (!salience || salience <= 0) return hybridScore;
```
If a candidate lesson has no access log rows in the 180-day window,
`computeSalience` returns no entry for that lesson_id. `salienceMap.get(id)`
returns `undefined`. `blendHybridScore` short-circuits.

**Diagnostic signal.** Search response includes explanation string
`"salience: no access history for any candidate (N lessons)"` (when
ZERO candidates have history) or nonzero-but-small `"salience: enabled
query-conditional (α=X, halfLife=Yd); N/M with access history, Z
effective after relevance-gating"` where Z ≪ M. If Z = 0, no boost is
applied regardless of α or HL.

**Example.** Sprint 12.1e4: for the sprint-11-closeout query, 60 hybrid
candidates had 0 access-log entries → salience-blend no-op → α had
zero mathematical effect on ranking. All observed α variance came from
rerank drift.

**When to expect this.**
- Fresh corpus with no baseline-run traffic (consideration-search rows
  truncated per Sprint 12.1e3 pollution mitigation).
- Queries that surface lessons outside the guardrail audit-bootstrap
  set (most workaround/decision/preference lessons).
- Immediately after `TRUNCATE lesson_access_log` or similar cleanup.

**When salience IS active.**
- Guardrail lessons where `guardrail_audit_logs` rows backed them at
  migration 0047 time.
- Lessons that have been repeatedly retrieved / consumed (consumption-*
  writes accumulate).

**Mitigation.** Not a bug — correct behavior. The blend should no-op
when there's no signal. But for MEASUREMENT purposes, this means α
sweeps on bootstrap-only goldensets produce null results that don't
reflect production behavior (where traffic accumulates). Future
salience measurement should seed simulated real-traffic distribution.

**Cross-ref.** Sprint 12.1e4 summary
(`docs/qc/baselines/2026-04-19-sprint-12.1e4-summary.md`) for the
detection trace.

---

### cross-encoder-via-embeddings-api-mismatch

**Definition.** The `rerankCrossEncoder` code path in
`src/services/lessons.ts:605` uses the `/v1/embeddings` endpoint to
get independent embeddings for query and each candidate, then scores
by cosine similarity. This works for SOME rerank-tagged models (e.g.,
`gte-reranker-modernbert-base`) but fails catastrophically for others
(`text-embedding-bge-reranker-v2-m3`, `text-embedding-jina-reranker-v3`).
Classic "cross-encoder" models score `(query, doc)` PAIRS together
and don't produce independent embeddings suitable for cosine-sim
ranking — yet will happily respond to `/v1/embeddings` with SOMETHING,
just not something useful.

**Why it happens.** Reranker models have two output conventions:
1. **Bi-encoder / two-tower:** produce independent embeddings per
   input. Cosine sim between query-embedding and doc-embedding gives
   relevance. `gte-reranker-modernbert-base` apparently behaves this
   way via `/v1/embeddings`.
2. **True cross-encoder:** concatenate `(query, doc)` and score the
   pair with a single forward pass. Use `/v1/rerank` endpoint in
   LM Studio (if supported) or equivalent. `bge-reranker-v2-m3` and
   `jina-reranker-v3` are this kind.

Our code path assumes #1 for everything. When #2-kind models are used,
they return valid-shaped embeddings but with outputs that don't
correlate with relevance when cosine-compared.

**Diagnostic signal.** MRR on the 40q lessons goldenset drops below
the no-rerank floor (~0.92). Typically MRR < 0.5 when this happens
(near-random ranking). Also visible in explanation string showing
the rerank succeeded but top-K contains irrelevant lessons.

**Example — Sprint 12.1f.** Three cross-encoder models tested via
current code path:
- gte-reranker-modernbert-base: MRR=0.9538 (works)
- bge-reranker-v2-m3: MRR=0.1418 (broken)
- jina-reranker-v3: MRR=0.3375 (broken)

gte happens to have a bi-encoder-compatible output; bge and jina
don't.

**Mitigation.**
1. **Empirical model selection:** test candidate rerankers on the
   goldenset before trusting them. If MRR < no-rerank floor, the
   model+endpoint combination is broken.
2. **Implement `/v1/rerank` endpoint support** in the code — a proper
   cross-encoder code path where query+doc pairs score together.
   Small change (single new function alongside `rerankCrossEncoder`
   and `rerankGenerative`); would unlock bge/jina and other true
   cross-encoders. Candidate for Sprint 12.1g.
3. **Use `gte-reranker-modernbert-base` for deterministic QC
   measurement** (validated in 12.1f).

**Cross-ref.** Sprint 12.1f summary
(`docs/qc/baselines/2026-04-19-sprint-12.1f-summary.md`) for the
3-model test + root-cause analysis.

---

## Adding a new class

When a Phase-12 sprint discovers a pathology not covered here:

1. Add a section above with definition, cause, diagnostic signal, and one
   real example.
2. If the runner should auto-classify it, add a branch to `classifyFriction`
   in `src/qc/runBaseline.ts`.
3. Cross-reference the sprint that discovered it (commit SHA + sprint name)
   so the catalog's evolution is traceable.
