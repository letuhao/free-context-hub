---
phase: 12
sprint: 12.0
title: Baseline scorecard — PLAN
status: ready
depends_on:
  - docs/specs/2026-04-18-phase-12-rag-quality.md
  - docs/specs/2026-04-18-phase-12-sprint-0-design.md
created: 2026-04-18
---

# Sprint 12.0 — Execution PLAN

16 tasks grouped into 4 natural commits. Each task: exact file, intent, verify command. No placeholders. TDD where test-able.

## Estimated timing
~5.5 hours across 4 commits (tight scope, one-dev day). Seeding tasks (T6–T8) are the slowest — require live-data inspection.

## Prerequisite before BUILD starts
```bash
docker compose up -d
# wait ~5s
curl -sf http://localhost:3001/api/projects >/dev/null && echo "API ready"
curl -sf http://localhost:3000/mcp -X POST -H "Content-Type: application/json" \
  -d '{"jsonrpc":"2.0","method":"tools/list","id":1}' >/dev/null && echo "MCP ready"
```
If either fails → diagnose before coding. Stack must be live for T5–T16.

---

## Commit 1 — Foundation: types + metrics (TDD)

### T1 — Extend `src/qc/goldenTypes.ts`
**Intent:** Add `Surface` type, set-level `surface` field, new target fields, `GradedHit`. Backwards-compat: existing `target_files` + `recallAtK` / `mrr` functions stay; new fields are optional.
**Verify:** `npx tsc --noEmit` passes. No callers break.

### T2 — Create `src/qc/metrics.test.ts` (RED phase)
**Intent:** Unit tests (Vitest) for `ndcgAtK`, `duplicationRateAtK`, `latencySummary`, `coveragePct`. 5+ cases each: empty, single, all-zero, ideal-ordering, inverted-ordering, known-fixture-with-hand-computed-expected-value.
**Verify:** `npx vitest run src/qc/metrics.test.ts` fails with "module not found" for `./metrics.js`.

### T3 — Create `src/qc/metrics.ts` (GREEN phase)
**Intent:** Implement 4 new functions + re-export `recallAtK` + `mrr` from `goldenTypes`. Pure functions, no I/O.
- `ndcgAtK(gradedHits, k)`: DCG = Σ(2^rel - 1)/log2(rank+1), IDCG = same on sorted-desc grades, ratio.
- `duplicationRateAtK(items, k)`: count items whose `key` appears >1× in top-k; divide by k.
- `latencySummary(samples)`: sort, return p50/p95/mean/n.
- `coveragePct(hasRelevantHit)`: trues / total.
**Verify:** `npx vitest run src/qc/metrics.test.ts` all pass.

### T4 — Tag `qc/queries.json`
**Intent:** Add `"surface": "code"` at root level (alongside `"version"`). One-line change. Existing consumers (`tieredBaseline.ts`, `ragQcRunner.ts`) don't read `surface` → no break.
**Verify:** `node -e "const s=require('./qc/queries.json'); if(s.surface!=='code')throw new Error('x')"` → exit 0. Re-run `npx tsx src/qc/tieredBaseline.ts --dry` (if flag exists) or equivalent parsing smoke.

**Commit 1 boundary:** `git add src/qc/metrics.ts src/qc/metrics.test.ts src/qc/goldenTypes.ts qc/queries.json && git commit -m "Phase 12 Sprint 12.0 (T1-T4): metrics module + typed golden-set schema"`

---

## Commit 2 — Surface adapters + seeded golden sets

### T5 — Create `src/qc/surfaces.ts`
**Intent:** One adapter per surface. Uniform return shape:
```ts
export type SurfaceResult = {
  items: Array<{ key: string; id: string; title?: string; snippet?: string }>;
  latencyMs: number;
  error?: string;
};
export async function callLessons(client: McpClient, projectId: string, query: string, k: number): Promise<SurfaceResult>;
export async function callCode(client: McpClient, projectId: string, query: string, k: number): Promise<SurfaceResult>;
export async function callChunks(client: McpClient, projectId: string, query: string, k: number): Promise<SurfaceResult>;
export async function callGlobal(projectId: string, query: string, k: number, apiUrl: string): Promise<SurfaceResult>;
```
First-action: grep MCP tool registry for `search_document_chunks` and `search_global` / `global_search`. If chunks has a tool → use MCP; if global doesn't → use REST `/api/search` (hit `src/api/routes/*` to find the route).
**Key construction:** `lessons` → lesson_id; `code` → `normalizePath(path)`; `chunks` → `${document_id}:${chunk_index}`; `global` → `${type}:${id}`.
**Error handling:** catch per-call, return `error` field, latencyMs still recorded.
**Verify:** Small smoke script `src/qc/smokeSurfaces.ts` (NOT checked in — temp) calls each adapter with a real query, prints first 3 items. All 4 must return non-empty items against the live stack.

### T6 — Seed `qc/lessons-queries.json` (20 queries)
**Intent:** Hand-craft queries grounded in real project lessons.
**Process:**
1. `mcp__contexthub__list_lessons` (via curl or MCP client) to inventory active lessons for `free-context-hub`.
2. Pick 15 "should-hit" queries (varied groups: integration-test, architecture, workaround, decision). Each specifies `target_lesson_ids` from the inventory.
3. Add 3 "adversarial" queries designed to probably fail (query uses terms not in any lesson) — these test coverage% accurately.
4. Add 2 "duplicate-trap" queries that historically return duplicates (mimic the 2026-04-18 finding) to validate dup-rate metric.
**Schema:** `{ version: "2026-04-18", surface: "lessons", project_id_suggested: "free-context-hub", queries: [...] }`.
**Verify:** JSON parses (`node -e "require('./qc/lessons-queries.json')"`); every `target_lesson_ids` entry exists in DB (small script: `SELECT id FROM lessons WHERE id = ANY($1)`).

### T7 — Seed `qc/chunks-queries.json` (15 queries)
**Intent:** Same pattern for document chunks. Inventory via REST `GET /api/documents` → pick 10 documents, formulate queries targeting specific chunks (by `chunk_index`).
**Process:**
1. List documents; prefer documents with >3 chunks (more interesting targets).
2. 12 "should-hit" queries + 3 "should-miss-probably" (coverage testing).
**Verify:** JSON parses; every `(document_id, chunk_index)` pair exists in `document_chunks`.

### T8 — Seed `qc/global-queries.json` (10 queries)
**Intent:** Cross-surface queries with heterogeneous `target_any`. Tests global-search's ability to rank across types.
**Process:** 10 queries where the ideal top result is sometimes a lesson, sometimes a chunk, sometimes code. Target_any lists all acceptable hits.
**Verify:** JSON parses; every referenced ID exists in its respective table.

**Commit 2 boundary:** `git add src/qc/surfaces.ts qc/lessons-queries.json qc/chunks-queries.json qc/global-queries.json && git commit -m "Phase 12 Sprint 12.0 (T5-T8): surface adapters + seeded golden sets"`

---

## Commit 3 — Runner + diff generator + scripts

### T9 — Create `src/qc/runBaseline.ts`
**Intent:** Orchestrator.
**CLI:** `npx tsx src/qc/runBaseline.ts --tag <tag> [--out docs/qc/baselines] [--k 10] [--samples 3]`
**Flow:**
1. Connect to MCP (reuse pattern from `ragQcRunner.ts`).
2. Load 4 golden-sets; fail fast if any missing or malformed.
3. For each set, for each query, for N=samples times:
   - Call surface adapter, record latency + raw items.
   - Compute `found_ranks` by matching target IDs into item keys.
   - Compute `graded_hits_in_rank_order` (binary for v0: 2 if exact target hit, else 0).
4. Compute aggregate metrics per surface (all 6 metrics).
5. Classify friction: apply `classifyFriction(perQuery)` — see T9-sub.
6. Build JSON archive → write `<outDir>/YYYY-MM-DD-<tag>.json`.
7. Render Markdown scorecard → write `<outDir>/YYYY-MM-DD-<tag>.md`.
**Friction classifier (sub-helper inside runBaseline.ts):** simple heuristics:
- `recall@10 === 0` → `no-relevant-hit`
- `duplication_rate > 0.3` → `duplicate-domination`
- `recall@10 === 1 && mrr < 0.3` → `rank-order-inversion`
- else null
**Verify:** End-to-end on live stack: `npx tsx src/qc/runBaseline.ts --tag smoke-test`. Must complete < 5 min, produce 2 files, no crashes. Manually eyeball first scorecard — numbers plausible (not all 1.0 or all 0.0).

### T10 — Create `src/qc/diffBaselines.ts`
**Intent:** CLI diff of two archived runs.
**CLI:** `npx tsx src/qc/diffBaselines.ts <from.json> <to.json> [--out diff.md]`
**Logic:**
1. Load both JSONs, assert schema_version match.
2. For each surface × each metric: compute delta + pct.
3. Emit markdown table with 🟢/🔴/⚪ emoji by direction.
4. Apply regression thresholds (nDCG drop > 0.05, recall@10 drop > 0.05, p95 increase > 20%) → append "Regressions flagged" section.
**Verify:** Synthetic test — copy the smoke-test JSON, manually tweak one metric in the copy, run diff, confirm delta + emoji correct.

### T13 — `package.json` scripts
**Intent:** Add two scripts.
```json
"qc:baseline": "tsx src/qc/runBaseline.ts",
"qc:baseline:diff": "tsx src/qc/diffBaselines.ts"
```
**Verify:** `npm run qc:baseline -- --help` (or `--tag help-smoke`) exits cleanly.

**Commit 3 boundary:** `git add src/qc/runBaseline.ts src/qc/diffBaselines.ts package.json && git commit -m "Phase 12 Sprint 12.0 (T9, T10, T13): unified baseline runner + diff CLI"`

---

## Commit 4 — Docs + first real archived run

### T11 — Create `docs/qc/friction-classes.md`
**Intent:** Catalog doc. 6 seed classes per design spec § 7.
**Verify:** All 6 headers present (`grep -c "^### " docs/qc/friction-classes.md` → ≥ 6).

### T12 — Create `docs/qc/baselines/.gitkeep`
**Intent:** Ensure dir exists pre-first-run.
**Verify:** file exists.

### T14 — First real baseline run (this IS the Phase-6 VERIFY step, ALSO deliverable)
**Intent:** Produce `docs/qc/baselines/2026-04-18-phase-12-sprint-0.{json,md}`.
**Command:** `npm run qc:baseline -- --tag phase-12-sprint-0`
**Verify:** Both files exist. JSON has all 4 surfaces populated. Markdown scorecard opens cleanly in a Markdown viewer. At least one friction example in the `## Friction observed` section.

### T15 — Determinism check (VERIFY)
**Intent:** Run baseline twice in a row. Quality metrics identical; latency within ±20% p95.
**Command:**
```bash
npm run qc:baseline -- --tag determinism-run-1
npm run qc:baseline -- --tag determinism-run-2
npx tsx src/qc/diffBaselines.ts \
  docs/qc/baselines/2026-04-18-determinism-run-1.json \
  docs/qc/baselines/2026-04-18-determinism-run-2.json
```
**Verify:** Diff output shows all quality metrics `Δ=0`; latency diffs non-zero but not catastrophic. If quality metrics drift → investigate nondeterminism BEFORE commit (probably a cache-priming effect; document in known-limitations).

### T16 — Diff generator e2e (VERIFY)
**Intent:** Confirm diff regression flagging works.
**Process:** Manually edit a copy of the archived JSON to drop `lessons.metrics.recall_at_10` by 0.10; run diff; confirm "Regressions flagged" section mentions lessons.
**Verify:** Generated Markdown includes regression line for lessons.

**Commit 4 boundary:** `git add docs/qc/friction-classes.md docs/qc/baselines/ && git commit -m "Phase 12 Sprint 12.0 (T11-T16): friction catalog + first archived baseline"`

---

## Placeholder-scan self-review
- [x] Every task names an exact file path.
- [x] Every task has a concrete verify command.
- [x] No "TBD", "add error handling here", "implement as needed".
- [x] Task boundaries align with natural commit points.
- [x] Surface-adapter unknowns (global search MCP tool existence) are resolved *inside* T5, not deferred.
- [x] Dependencies respected (metrics before runner, adapters before runner, runner before first-archive).

## Execution mode decision
**Inline.** Single-agent sequential execution. No subagent dispatch — tasks are cohesive, share state (types, surfaces), and commit boundaries provide natural checkpoints. Per-commit verification + Phase 7 REVIEW + Phase 9 POST-REVIEW (human) gates are the right granularity.

## Reclassification trigger
If during T5 we discover:
- Global search needs >2 hours of plumbing → reclassify to L, re-enter PLAN for T5+.
- Chunks / global golden-set seeding reveals data quality issues that block seeding → reclassify, discuss with user.
Otherwise: stay M, execute straight through.
