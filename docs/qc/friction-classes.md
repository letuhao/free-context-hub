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

### snippet-redundancy *(deferred)*

**Definition.** Distinct DB rows with different IDs but identical content
snippets. Most extreme form of duplicate-domination; dup-rate at `key = id`
is 0, but dup-rate at `key = snippet_hash` is high.

**Status.** Deferred to Phase 12.1 implementation. The v0 duplication-rate
metric matches on normalized ID only. A v1 metric with `key = hash(title) |
hash(snippet[:100])` may be added when near-duplicate detection is
implemented in consolidation.

---

## Adding a new class

When a Phase-12 sprint discovers a pathology not covered here:

1. Add a section above with definition, cause, diagnostic signal, and one
   real example.
2. If the runner should auto-classify it, add a branch to `classifyFriction`
   in `src/qc/runBaseline.ts`.
3. Cross-reference the sprint that discovered it (commit SHA + sprint name)
   so the catalog's evolution is traceable.
