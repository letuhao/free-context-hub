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
Deferred to Sprint 12.1b or a 12.0.3 cleanup pass.

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

## Adding a new class

When a Phase-12 sprint discovers a pathology not covered here:

1. Add a section above with definition, cause, diagnostic signal, and one
   real example.
2. If the runner should auto-classify it, add a branch to `classifyFriction`
   in `src/qc/runBaseline.ts`.
3. Cross-reference the sprint that discovered it (commit SHA + sprint name)
   so the catalog's evolution is traceable.
