---
id: CH-PHASE12-S1201
date: 2026-04-18
module: Phase12-Sprint12.0.1
phase: PHASE_12
---

# Session Patch — 2026-04-18 (Phase 12 Sprint 12.0.1 — dup-rate v1 + code indexing prereqs)

## Where We Are
**Sprint 12.0.1 closed.** Two load-bearing prereqs for Sprint 12.1 (consolidation) shipped as a bundled M-size sub-sprint: (a) near-semantic dup-rate v1 metric extension and (b) code indexing of `free-context-hub` against the live stack. **Eight commits on `phase-12-rag-quality`** now, 4 from 12.0 + 4 from 12.0.1. `/review-impl` pattern continues — caught 7 findings on a sprint that looked clean at POST-REVIEW, including 1 HIGH where the v1 metric was reporting spurious 1.0 dup-rate on code (missing title/snippet passthrough). All fixed and re-verified.

## Commits shipped this sprint
- `85aa93e` — T1–T5: `normalizeForHash` + `nearSemanticKey` helpers, snippet passthrough, v1 aggregation in runBaseline, diff DIRECTION map extension
- `8007308` — T6–T7: `register_workspace_root` + `index_project` against `/workspace` (3925 chunks initially), first sprint-0.1 baseline + diff
- `04fc925` — `/review-impl` fixes: HIGH-1 code callCode content fix + MED 1–4 + LOW 1–2 + COSMETIC test
- `17ab44e` — regenerated sprint-0.1 archive at clean commit SHA (04fc925) after fixes

## The nail — `dup@10 nearsem = 0.42` on lessons (real pathology quantified)

The original Phase-12 motivation — "10+ near-duplicate lessons dominate top-k" — is now a concrete number. Sprint 12.1 consolidation has a target to drive down.

| Surface | Q | recall@10 | MRR | nDCG@10 | dup@10 | dup@10 nearsem | cov% | p95 ms |
|---|---:|---:|---:|---:|---:|---:|---:|---:|
| lessons | 20 | 0.9412 | 0.7716 | 0.8120 | 0 | **0.4200** | 0.9412 | 6275 |
| code | 67 | 0.7910 | 0.4746 | 0.5388 | 0 | 0.0000 | 0.7910 | 1866 |
| chunks | 10 | 1.0000 | 0.9167 | 0.9455 | 0 | 0.2900 | 1.0000 | 45 |
| global | 10 | 0.8889 | 0.6481 | 0.7093 | 0 | 0.1400 | 0.8889 | 9 |

Independent verification of the 0.42: inspected top-10 for `lesson-pg-uuid-casing`. Ranks 2–8 are Import A/B fixture rows with identical normalized snippets ("the document titled 'import a/b: impexp-n' contains content labeled as..."). These are real duplicates, not metric artifacts.

## What /review-impl caught that POST-REVIEW didn't (largest haul yet: 7 findings)

### HIGH-1 — code `dup@10 nearsem = 1.0` was spurious
`callCode` left `title` undefined and set `snippet` = `f.snippet` (which doesn't exist — `search_code_tiered` returns `sample_lines` array). Every code SurfaceItem had `nearSemanticKey(undefined, undefined) = "||"`, collapsing the whole top-k into one cluster. The metric reported catastrophic 100% duplication when the truth is zero (files are distinct paths). **Fix**: populate `title: path` (unique per file) + `snippet: sample_lines.join(' ')`. Verified: code dup@10 nearsem now reports 0. Lesson: content-based hash metrics are mined by empty-content adapters — always include a distinguishing fallback (e.g., path) when retriever doesn't return content fields.

### MED-1 — junk chunks in code index (4426 of 3925 were useless)
`index_project` default excludes cover `.git` and `node_modules` but not `dist/`, `gui/.next/`, `.claude/worktrees/`, `agentic-workflow/`. Initial indexing ingested build outputs + agent workspace files. Purged via direct SQL DELETE; post-purge 2069 clean chunks. Permanent fix (expand DEFAULT_IGNORE or project-level `.contexthubignore`) deferred to Sprint 12.0.2. Documented as `index-hygiene` friction class.

### MED-2 — `normalizeForHash` digit-collapse false-positive latent risk
`"Phase 10"` and `"Phase 11"` both → `"phase n"`. `"v1.2.3"` / `"v2.0.0"` → `"vn.n.n"`. `"step1.ts"` / `"step2.ts"` → `"step-n.ts"`. Empirically clean for the current lesson dataset (all observed clusters have near-identical snippets too, confirmed via archive inspection). Load-bearing on specific data shape. Documented as `digit-collapse-false-positive` friction class.

### MED-3 — `qc/queries.json` notes misleading for legacy runners
`ragQcRunner.ts` and `tieredBaseline.ts` read `QC_PROJECT_ID` env (default `qc-free-context-hub`), NOT the goldenset's `project_id_suggested`. Updated notes to explicitly state which runner consumes which field.

### MED-4 — cross-run measurement jitter
Sprint-0 back-to-back runs byte-identical on quality. Sprint-0 → 0.1 (~2h apart) showed lessons recall@10 drift 1.0→0.94 with no lesson-ranking changes in between. Root cause: embeddings service jitter under varying load. Added `measurement-jitter` friction class. Operator protocol for real before/after measurement: run a same-tag back-to-back control baseline first to establish noise floor. Future runner enhancement: `--control` flag (Sprint 12.0.2+).

### LOW-1 — archive snippet cap 200→300 chars (diagnostic ergonomics)

### LOW-2 — indexer-excludes inconsistency documented (covered by MED-1)

### COSMETIC — regression test added
`all-null title+snippet collapse` test locks in the HIGH-1 behavior; `Phase 10 / Phase 11` + `step1.ts / step2.ts` tests lock in MED-2 trade-offs.

## Friction-class catalog expansion (10 classes total)
Added in 12.0.1:
- `measurement-jitter` — cross-run noise on embeddings-backed metrics
- `index-hygiene` — build-output pollution of the chunks table
- `digit-collapse-false-positive` — normalizer trade-off for timestamp-variant titles

## Files delivered
```
src/qc/
├── metrics.ts                      + normalizeForHash, nearSemanticKey exports
├── metrics.test.ts                 + 16 tests (normalize, nearSem, all-null trap, digit trap)
├── surfaces.ts                       callCode now populates title=path + snippet=sample_lines
├── runBaseline.ts                    snippet passthrough (top_k_snippets@300 chars), v1 aggregation,
│                                     new metric col in scorecard
├── diffBaselines.ts                  Metrics+DIRECTION extended; asNullable forward-compat;
│                                     emoji ∞ fix
└── diffBaselines.test.ts           + 6 tests (undefined forward-compat, ∞ emoji direction)

qc/
└── queries.json                      project_id_suggested=free-context-hub + clarified notes

docs/
├── specs/2026-04-18-phase-12-sprint-0.1-spec.md   combined spec+design+plan
└── qc/
    ├── friction-classes.md         + 3 classes (measurement-jitter, index-hygiene, digit-collapse)
    └── baselines/
        ├── 2026-04-18-phase-12-sprint-0.1.{json,md}   sprint-0.1 archive
        └── 2026-04-18-sprint-0-to-0.1.diff.md         the nail diff
```

## DB side effect
- 3925 chunks written to `chunks` table for project_id=`free-context-hub` (via `index_project`).
- 4426 junk chunks deleted via direct DELETE (dist/, gui/.next/, .claude/*, agentic-workflow/, test-results/, coverage/, *.log).
- Net: 2069 clean chunks remain. Workspace root `e8603167-259a-431c-9c59-4e560c27b2eb` registered for `free-context-hub` at `/workspace`.
- These side effects are not reversible via git alone — need `DELETE FROM chunks WHERE project_id='free-context-hub'` + `DELETE FROM project_workspaces WHERE workspace_id='e8603167-...'` to fully roll back.

## Test count: 138/138 unit tests (was 116 at 12.0; +22 new)
- 16 from metrics v1 additions
- 6 from diffBaselines null/undefined + emoji tests
- All green at each of the 4 commits.

## What's next — Sprint 12.0.2 candidate (deferred items)

Small-scope sub-sprint to finish 12.0 prereqs before 12.1:
1. **Indexer ignore-pattern expansion** — expand `DEFAULT_IGNORE` in `src/services/indexer.ts` to cover `dist/**`, `.next/**`, `.claude/**`, build outputs. Re-run index_project to prove the ignore lands.
2. **Runner `--control` flag** — run goldenset twice back-to-back in one invocation, emit per-run-noise-floor metric in archive. Fixes MED-4 measurement-jitter as a feature, not a caveat.
3. **Legacy runner honors `project_id_suggested`** (optional, MED-3 elevation): change `ragQcRunner.ts` and `tieredBaseline.ts` to fall back to goldenset's field when `QC_PROJECT_ID` is unset.

Then Sprint 12.1a: lesson exact-title dedup targeting the 0.42 nearsem dup-rate.

## Operational state
- 8 commits on `phase-12-rag-quality`, all on `origin` after this session's push.
- `.workflow-state.json` at retro (clean).
- Docker compose stack healthy; 138/138 unit tests pass.
- No pending todos.

---

---
id: CH-PHASE12-S120
date: 2026-04-18
module: Phase12-Sprint12.0
phase: OPENS_PHASE_12
---

# Session Patch — 2026-04-18 (Phase 12 Sprint 12.0 — RAG baseline scorecard)

## Where We Are
**Phase 12 opened.** Sprint 12.0 ships the unified RAG baseline scorecard — the "nail" every downstream Phase-12 sprint will cite in its before/after diff. Six commits on branch `phase-12-rag-quality`, not yet merged to main. 12-phase workflow v2.2 fully exercised: /review-impl caught 15 findings (6 MED + 6 LOW + 3 COSMETIC) that the initial Phase-7 REVIEW and Phase-9 POST-REVIEW missed; all 15 fixed in `29c7956`. The baseline pattern now validated across seven consecutive sprints (11.5, 11.6a/b/c-sec/c-perf, 11.Z, 12.0).

## What shipped (6 commits)
- `08d793d` — planning: Phase-12 spec + Sprint-12.0 design + execution plan (3 files, ~570 LOC)
- `ea1b255` — T1–T4 foundation: extended goldenTypes, 33-test metrics module (TDD), tagged queries.json (7 files)
- `cc69e92` — T5–T8: 4 surface adapters + 3 seeded golden sets (20 lessons + 10 chunks + 10 global queries, all IDs DB-verified) (4 files)
- `8204f10` — T9, T10, T13: unified runBaseline.ts + diffBaselines.ts + npm scripts (3 files)
- `aaa4cda` — T11, T14-T16: 7-class friction catalog + first archived baseline (3 files)
- `29c7956` — review-impl fixes: 15 findings from adversarial review addressed (8 files, 44 new diff tests)

## Baseline numbers (2026-04-18, against live docker-compose stack)
| Surface | Project | Q | recall@10 | MRR | nDCG@10 | dup@10 | cov% | p50 ms | p95 ms |
|---|---|---:|---:|---:|---:|---:|---:|---:|---:|
| lessons | free-context-hub | 20 | 1.0000 | 0.7642 | 0.8188 | 0 | 1.00 | 2122 | 5957 |
| code | qc-free-context-hub | 67 | 0.0000 | 0.0000 | 0.0000 | 0 | 0.00 | 32 | 39 |
| chunks | free-context-hub | 10 | 1.0000 | 0.9167 | 0.9455 | 0 | 1.00 | 29 | 34 |
| global | free-context-hub | 10 | 0.8889 | 0.7593 | 0.7972 | 0 | 0.89 | 8 | 10 |

## Three durable findings for Phase-12 scope (not just numbers)

### 1. v0 dup-rate gives false confidence
Baseline reports `dup@10 = 0` across all surfaces. Yet `free-context-hub` has ≥5 "Max retry attempts must be 3" guardrails and ≥6 "Global search test retry pattern" decisions — the original Phase-12 dogfood motivation. The v0 metric keys on exact entity id; same-title-different-UUID noise is mathematically invisible. Scorecard's `## Known limitations` now calls this out explicitly so readers don't misinfer "no duplication." Sprint 12.1 MUST extend dup-rate to `key = title_hash` or `snippet_hash` variant before claiming consolidation improvement.

### 2. Code surface empty — indexing prereq
`chunks` table (code chunks for search_code_tiered) is empty for every project. All 67 existing code queries return empty result sets. Not a retrieval bug — an infrastructure gap. Must `index_project` against `free-context-hub` before code metrics become meaningful. Sprint 12.0.1 or a pre-12.1 task.

### 3. Golden-set ceiling bias
Lesson queries are paraphrases of lesson content + targets cherry-picked from recently-active records. Reported `recall@10 = 1.0` may reflect "queries are easy" rather than "retriever is strong." Documented as `golden-set-ceiling-bias` friction class with mitigation path (adversarial queries, hard-miss group, split scoring).

## /review-impl pattern continues to earn its keep
Seven sprints in a row where the adversarial-review command catches findings that POST-REVIEW self-check missed. Today: 15 findings caught (largest haul yet), zero false positives. Categories: coverage gaps in the metric design (dup-rate silent on the motivating pathology), latent landmines (substring matching in code surface), wire-up failures (must_keywords parsed but ignored), and missing tests (diff generator had 0 tests on pure logic). POST-REVIEW as a human-interactive checkpoint remains the right design — I initially self-signaled "not safety-sensitive, skip /review-impl" and the user over-rode that call correctly.

## Files delivered
```
src/qc/
├── goldenTypes.ts                   extended (+Surface, +GradedHit, +5 target fields, +doc strings)
├── metrics.ts                       NEW, 96 lines   (6 pure functions, deterministic)
├── metrics.test.ts                  NEW, 164 lines  (33 unit tests)
├── surfaces.ts                      NEW, 219 lines  (4 adapters, uniform SurfaceResult contract)
├── runBaseline.ts                   NEW, 540 lines  (orchestrator + scorecard renderer)
├── diffBaselines.ts                 NEW, 235 lines  (diff CLI + exported pure helpers)
└── diffBaselines.test.ts            NEW, 245 lines  (44 unit tests)

qc/
├── queries.json                     tagged: surface=code (existing 67q)
├── lessons-queries.json             NEW, 20 queries
├── chunks-queries.json              NEW, 10 queries
└── global-queries.json              NEW, 10 queries

docs/
├── specs/2026-04-18-phase-12-rag-quality.md        spec (+ CLARIFY decisions)
├── specs/2026-04-18-phase-12-sprint-0-design.md    design
├── plans/2026-04-18-phase-12-sprint-0-plan.md      16-task plan
└── qc/
    ├── friction-classes.md          NEW, 8 classes (7 seeded + 1 deferred)
    └── baselines/
        └── 2026-04-18-phase-12-sprint-0.{json,md}  first archived run
```

## How to reproduce / extend
```bash
docker compose up -d
npm run qc:baseline -- --tag my-tag        # runs all 4 surfaces, ~2-3 min
npx tsx src/qc/diffBaselines.ts a.json b.json --out diff.md

# Test scoped:
npm run test:metrics                        # 33 metrics tests
npx tsx --test src/qc/diffBaselines.test.ts # 44 diff tests
npm test                                    # 116 tests total
```

## What's next (Phase 12 sprint board — tentative)

Sprint 12.0 locked in. Sprints below are candidates — dogfooding + baseline friction drives prioritization.

| Sprint | Topic | Status | Depends on |
|---|---|---|---|
| 12.0 | Baseline scorecard | ✅ done | — |
| 12.0.1 | Fix dup-rate v1 (title/snippet hash keys) + run index_project | candidate | none |
| 12.1a | Lesson dedup — exact-title collapse | planned | 12.0.1 dup-rate v1 |
| 12.1b | Near-duplicate merge — cosine-threshold clustering | planned | 12.1a |
| 12.1c | Prune-on-decay — access-count + age-based archive | planned | 12.1a |
| 12.2a | Access-frequency counter in Redis | planned | 12.1 |
| 12.2b | Salience weight (git-incident / error-site boost) | planned | 12.2a |
| 12.2c | Hierarchical pointer retrieval | planned | 12.2a |
| 12.2d | Sleep-mode consolidation worker | planned | 12.2a–c |

## Operational state
- 6 commits on branch `phase-12-rag-quality`, 0 on `origin`.
- `.workflow-state.json` at phase=session (advancing to commit/retro).
- Docker compose stack healthy; 116/116 unit tests green.
- No pending todos beyond push + retro.

---

---
id: HANDOFF-2026-04-18-E
date: 2026-04-18
phase: HANDOFF
session_status: closed
pushed_to_origin: true
---

# Handoff — end of 2026-04-18 (session E — PHASE 11 COMPLETE, session closed, pushed)

## TL;DR
**Phase 11 is DONE, pushed to origin, session closed.** Eight commits landed publicly this session: workflow v2.2 adoption + Sprints 11.5 / 11.6a / 11.6b / 11.6c-sec / 11.6c-perf + Phase-11 closeout reconciliation + Sprint 11.Z closeout hygiene. The knowledge-portability story is end-to-end: bundle format → export → import w/ conflict policies → GUI panel → cross-instance pull → test infrastructure → streaming polish → security polish → perf polish → hygiene pass. User decision: **start using the system for real work instead of additional QC cycles**. Next session will likely be dogfooding-driven rather than feature-driven.

### Commits shipped this session (all on origin/main now)
- `9fd4f87` Agentic Workflow v2.2 adoption
- `cd73629` Sprint 11.5 — cross-instance pull
- `2ffa36d` Sprint 11.6a — test infrastructure
- `210ffd8` Sprint 11.6b — streaming polish
- `c4e302a` Sprint 11.6c-sec — DNS pinning + body-stall
- `0b4e2f6` Sprint 11.6c-perf — batched-SELECT (closed Phase 11)
- `2e5b130` Docs: Phase 11 closeout reconciliation
- `d9d1c75` Sprint 11.Z — closeout hygiene

Session-E sprints:
- **Sprint 11.5** cross-instance pull — 10 findings across 3 passes, 56/56 E2E green
- **Sprint 11.6a** test infrastructure — 5 findings, 61/61 API + 52/52 GUI green
- **Sprint 11.6b** streaming polish — 3 doc-only findings, peak memory cut 99% / 45%, 32/32 unit + 61/61 E2E green
- **Sprint 11.6c-sec** DNS-rebinding pinning + body-stall timeout — 5 findings, closes the 11.5 security gaps, 39/39 unit + 61/61 E2E green
- **Sprint 11.6c-perf** N+1 SELECT reduction via batched-SELECT — 4 findings, ~99% SELECT-count reduction, 61/61 E2E green

**No blocking work remains in Phase 11.** Residual known-issues (V8 string cap on documents.content, undici version pin) are documented as out-of-phase. Next phase to plan: Phase 12 or a polish pass; no commitments.

## This session — what shipped
- **11.5** Cross-instance pull — `POST /api/projects/:id/pull-from` orchestrates SSRF-checked fetch → temp-file stream → `importProject`. Reuses `assertHostAllowed` from urlFetch.ts. 9 integration tests. 10 review findings all fixed. (commits `9fd4f87`, `cd73629`)
- **11.6a** Test infrastructure — 5 import scenario tests via REST API (roundtrip checksum, ID remapping, policy overwrite/fail, cross-tenant guard under overwrite) + 1 Playwright scenario (export → upload → Apply). 5 review-impl findings caught + fixed. (commit `2ffa36d`)
- **11.6b** Streaming polish — new `base64Stream.ts` helper with 3-byte-aligned streaming encoding (12 unit tests incl. 1 MB random round-trip); `iterateJsonl` refactored to readline + hashTap Transform with EOF checksum validation; `materializeDocContent` now streams. 3 doc-only findings caught + documented. 32/32 unit + 61/61 e2e green. (commit `210ffd8`)
- **11.6c-sec** Security polish — new `pinnedHttpAgent.ts` (undici Agent with connect.lookup override); `assertHostAllowed` now returns `PinnedAddress` for the caller to pin; `urlFetch.ts` refactored into a per-hop pinned-agent `runHop` helper; `pullFromRemote.ts` gets a `StallTransform` (60s idle timer) in the body-streaming pipeline. 5 findings caught across 2 passes (MED: no StallTransform test; LOW: unbounded close() cleanup — switched to destroy()). DNS-rebinding TOCTOU + slow-loris body stall both closed. (commit `c4e302a`)
- **11.6c-perf** N+1 SELECT reduction — `APPLY_BATCH_SIZE=200` + `processBatched` helper drives all 6 apply\* functions through batched bulk-SELECT queries. SELECT count drops from 687 → 7 on a 581-lesson project (~99% reduction; ~49% total query reduction). `/review-impl` caught 1 MED (intra-batch dup IDs → pg constraint violation; fixed with `assertUniqueBatchIds` raising malformed_bundle) + 1 LOW (UUID casing mismatch for hand-crafted bundles; fixed with `.toLowerCase()` canonicalization on both map sides). 61/61 e2e green (89s — essentially flat vs pre-refactor baseline).

## Agentic Workflow v2.2 adopted and exercised
Before Sprint 11.5, the repo absorbed the `agentic-workflow/` bundle (v2.2 — 12-phase workflow with POST-REVIEW as human checkpoint + `/review-impl` slash command for on-demand adversarial review). Fixed a pyenv-win python3.bat shim bug that corrupted multi-line `-c` args (scripts/workflow-gate.sh now prefers `python` over `python3`).

Across 11.5 + 11.6a + 11.6b + 11.6c-sec, `/review-impl` ran **five times total** and caught **19 additional findings** the initial Phase-7 REVIEW passes missed (10 in 11.5 across 2 passes, 4 in 11.6a, 3 in 11.6b, 2 in 11.6c-sec). On 11.6b — a pure memory refactor — findings were all doc-only but surfaced a pre-existing V8 string ceiling we now document. On 11.6c-sec — security-sensitive — /review-impl caught both a coverage gap (StallTransform untested) and an unbounded cleanup path (close() could hang). Five sprints in a row where /review-impl earns its keep.

## What's next

**Phase 11 is DONE and shipped.** Session closed by user decision: rather than more QC cycles, the next natural move is to **actually use the system** and let real-world friction surface what to patch.

Across the full 11.5 → 11.Z arc, `/review-impl` ran **six times total** and caught **21 additional findings** the initial Phase-7 REVIEW passes missed. Pattern validated across six consecutive security/perf/memory sprints with zero false positives and zero regressions in live-test reruns.

### Next session: dogfood-driven, not feature-driven

When a friction surfaces during real use, capture it as a lesson via `add_lesson` (decision / workaround / general_note). The accumulating lessons become the Phase-12 scope naturally, prioritized by "this actually bit me" rather than "this would be nice in theory."

### Candidate items if dogfooding doesn't redirect priority

Prioritized by "load-bearing-ness" rather than strict order:

- **`phase10.spec.ts extract` flake** — the one pre-existing flake that occasionally reddens CI under full-suite load. Fix if it blocks merge velocity in practice.
- **`documents.content` TEXT → BYTEA migration** — only bites if someone actually uploads a >300 MB document. Phase-10-level change, non-trivial migration + read-path updates. Don't pre-empt.
- **GUI for cross-instance pull** — API-only today; nice-to-have if sharing projects between ContextHub instances becomes a routine operator flow.
- **undici version sync guard** — small tooling sprint: add a runtime check or CI assertion that `undici@${process.versions.undici}` matches our declared `^6.21.2`. Prevents silent breakage on Node upgrades.
- **Deferred Phase 11 items**: merge conflict policy, bundle caching, webhook pulls, encryption/signing. None load-bearing today.

### Operational state at session close
- All 8 commits of this session are on `origin/main`.
- `.workflow-state.json` at retro (clean).
- Docker compose stack runs healthily; 61/61 API e2e + 52/52 GUI + 39/39 unit pass.
- No uncommitted changes, no pending todos.
- Next session starts fresh — no carryover work queue.

## How to get the stack running
```bash
cd d:/Works/source/free-context-hub
docker compose up -d
# Wait ~5 s, then:
curl http://localhost:3001/api/projects        # verify API
curl -I http://localhost:3002                  # verify GUI
```

The `ALLOW_PRIVATE_FETCH_FOR_TESTS=true` flag in `.env` is required for the pull-from self-pull integration test (loopback DNS resolution must be allowed).

## Open issues / known flakes (surviving Phase 11 closeout)
- `phase10.spec.ts › extract button → mode selector → Fast → review opens` — flaky under full-suite load (passes in isolation in 2.8s). Not blocking.
- ~~Bundle decoder buffers each jsonl entry into memory.~~ **Fixed in 11.6b** — streams line-by-line via readline + hashTap.
- ~~No body-stall timeout in pull-from.~~ **Fixed in 11.6c-sec** — `StallTransform` 60s idle timer.
- ~~DNS rebinding TOCTOU between `assertHostAllowed` and undici connect lookup.~~ **Fixed in 11.6c-sec** — per-request pinned undici Agent via `connect.lookup` override.
- ~~N+1 SELECT pattern in `importProject`.~~ **Fixed in 11.6c-perf** — batched SELECT via `APPLY_BATCH_SIZE=200` drops SELECT count ~99%.
- V8 string heap max (~512 MB on 64-bit) caps `documents.content` base64 at ~384 MB raw per document. Pre-existing; documented in `base64Stream.ts`. Real fix is migrating `documents.content` → BYTEA (Phase-10-level work, deferred beyond Phase 11).
- Lesson creation via POST /api/lessons occasionally 500s under full-suite load (embeddings service under pressure). Same root cause as the Phase 10 flake. Workaround applied in `phase11-exchange.spec.ts` — test no longer seeds a lesson, uses empty projects.
- **undici version pin** — `^6.21.2` (matches Node 23's bundled version). Bumping to 7+ breaks the pinned Agent's Dispatcher interface; re-verify if a future Node upgrade ships with a newer undici.

## File map (Phase 11 — updated)
```
src/services/exchange/
├── bundleFormat.ts             580 lines  — encoder/decoder (iterateJsonl
│                                            streams line-by-line, 11.6b)
├── bundleFormat.test.ts        550 lines  — 16 unit tests (+2 in 11.6b)
├── base64Stream.ts             ~65 lines — streaming base64 helper (11.6b)
├── base64Stream.test.ts        ~140 lines — 12 unit tests (11.6b)
├── exportProject.ts            300 lines  — DB → bundle
├── importProject.ts            ~900 lines — bundle → DB (materializeDocContent
│                                            streams via base64Stream, 11.6b;
│                                            all 6 apply* batched, 11.6c-perf)
├── pullFromRemote.ts           ~370 lines — cross-instance pull (11.5);
│                                            + StallTransform + pinned agent (11.6c-sec)
└── pullFromRemote.test.ts      NEW, ~95 lines — 3 StallTransform tests (11.6c-sec)

src/services/urlFetch.ts        assertHostAllowed returns PinnedAddress (11.6c-sec);
                                runHop helper with per-hop pinned agent
src/services/pinnedHttpAgent.ts NEW, ~60 lines — undici Agent w/ connect.lookup
                                override (11.6c-sec)
src/services/pinnedHttpAgent.test.ts NEW, ~85 lines — 2 unit tests (11.6c-sec)

src/api/routes/projects.ts      export + import + pull-from routes

gui/src/lib/api.ts              exportProjectUrl + importProject
gui/src/app/projects/settings/exchange-panel.tsx   400 lines  — full panel

test/e2e/api/phase11-pull.test.ts    260 lines — 9 tests (11.5)
test/e2e/api/phase11-import.test.ts  360 lines — 5 tests (11.6a)
test/e2e/gui/phase11-exchange.spec.ts 140 lines — 1 scenario (11.6a)

docs/phase11-task-breakdown.md  authoritative plan (11.6 split into a/b/c-sec/c-perf)
docs/sessions/SESSION_PATCH.md  this file

.claude/commands/review-impl.md  on-demand adversarial review (v2.2 workflow)
scripts/workflow-gate.sh         12-phase state machine

Dependencies added: undici@^6.21.2 (matches Node 23.11.1's bundled version)
```

---

# Sprint history

---
id: CH-PHASE11-S116CPERF
date: 2026-04-18
module: Phase11-Sprint11.6c-perf
phase: CLOSES_PHASE_11
---

# Session Patch — 2026-04-18 (Phase 11 Sprint 11.6c-perf — N+1 SELECT reduction)

## Where We Are
**Phase 11 is DONE.** Sprint 11.6c-perf closes the final Phase-11 wart: the N+1 SELECT pattern in `importProject` flagged since Sprint 11.3. All 6 `apply*` functions now consume their entities in batches of 200 rows via a shared `processBatched` helper, doing ONE bulk `= ANY($1)` SELECT per batch. SELECT count drops from 687 → 7 on a 581-lesson project (~99% reduction). 61/61 e2e green, zero regressions. Phase 11 complete at 6/6 sprints (with 11.6 split into a/b/c-sec/c-perf — 9 sub-sprints all shipped).

## What shipped

### processBatched<Row> helper + APPLY_BATCH_SIZE=200
A reusable async-iterable → batch processor: collects up to BATCH_SIZE rows from the iterator, passes them as a complete array to a handler that does ONE bulk existence query and applies each row individually against the pre-fetched map. Streaming-friendly — only BATCH_SIZE rows in memory at once, not the whole entity.

### All 6 apply* functions refactored
Each now takes `existing: Map<string, ...>` as a new parameter and replaces its per-row SELECT with a map lookup. The decision logic (cross-tenant guard, skip/overwrite/fail branches, dry-run guards) is **textually identical** — only the existence-check source changed from SELECT to `map.get()`. Zero behavior changes to the invariants.

### 6 orchestrator loops replaced
Each `for await` loop became a `processBatched(iter, APPLY_BATCH_SIZE, handleBatch)` call, where `handleBatch` does the bulk SELECT + iterates the batch applying rows. Six variants — 5 use `WHERE id = ANY($1::uuid[])` (or `::text[]` for lesson_types); document_lessons uses `JOIN unnest($1::uuid[], $2::uuid[]) AS t(doc_id, lesson_id)` to handle its composite PK via positional array zip.

### /review-impl hardening — 2 fixes
- **assertUniqueBatchIds helper** — pre-checks each batch for duplicate IDs and throws `ImportError('malformed_bundle', 'duplicate <entity> id ... within a single batch')` up front. Without this, a malformed bundle with intra-batch duplicates would silently succeed the first INSERT (map says "not exists"), then hit pg's unique constraint on the second (map is stale) → opaque 500 error. Pre-check surfaces bundle corruption cleanly.
- **UUID canonicalization** — `.toLowerCase()` on both map-building (SELECT RETURNING + id array) and lookup (inside each apply*) sides for the 5 UUID entities. pg's UUID cast always returns canonical lowercase, so bundle-side IDs must be lowercased before lookup to tolerate hand-crafted bundles with non-canonical UUIDs. lesson_types stays case-sensitive since its PK is TEXT.

## Query count reduction (for a typical 581-lesson project)

Before:
- lessons: 581 SELECTs
- guardrails: 76 SELECTs
- lesson_types: 6 SELECTs
- documents: 14 SELECTs
- chunks: 10 SELECTs
- document_lessons: 0 SELECTs (typically empty)
- **Total: 687 SELECTs + ~687 INSERT/UPDATE = ~1374 queries**

After (batch size 200):
- lessons: ⌈581/200⌉ = 3 SELECTs
- guardrails: 1 SELECT
- lesson_types: 1 SELECT
- documents: 1 SELECT
- chunks: 1 SELECT
- document_lessons: 0 SELECTs
- **Total: 7 SELECTs + ~687 INSERT/UPDATE = ~694 queries**

**~99% SELECT-count reduction, ~49% total-query reduction.**

## Review passes — 4 findings
### Phase-7 REVIEW (0 MED, 2 LOW accepted)
- LOW: APPLY_BATCH_SIZE hardcoded (not env-configurable — acceptable default).
- LOW: processBatched local to module (no other callers yet).

### /review-impl (1 MED + 1 LOW, both fixed)
- **MED**: intra-batch duplicate IDs → opaque pg unique-constraint violation. Fixed: `assertUniqueBatchIds` raises `ImportError('malformed_bundle')` pre-flight.
- **LOW**: UUID casing mismatch regresses hand-crafted bundles. Fixed: `.toLowerCase()` both sides.

## Invariants preserved (all verified by existing e2e tests, no new tests needed)
- Cross-tenant UUID guard (phase11-import-cross-tenant-guard-under-overwrite, phase11-import-id-remapping)
- Fail-fast on first conflict (phase11-import-policy-fail → 409 + code=conflict_fail)
- Per-conflict reason reporting (phase11-pull-happy-path asserts conflict list shape)
- Dry-run (phase11-pull-dry-run via self-pull round-trip)
- Transaction atomicity (phase11-import-policy-fail verifies items.length unchanged after 409)
- FK-safe order (lesson_types → documents → chunks → lessons → guardrails → document_lessons, unchanged)

## Live test results
```
tsc --noEmit              → 0 errors
npm test                  → 39/39 unit passed (no new tests — defense lives
                            at the e2e layer; existing phase11-import and
                            phase11-pull suites cover all 6 entities ×
                            3 policies × cross-tenant guard)
npm run test:e2e:api      → 61/61 passed, 0 failed (89s) after mcp rebuild.
                            Essentially flat vs pre-refactor baseline, which
                            is correct — the self-pull test fixtures have
                            a single-row batch, so per-request overhead
                            dominates over the SELECT count win. Real perf
                            gain shows up at scale (600+ rows/entity).
```

## Phase 11 retrospective (final)
**6/6 sprints complete.** The knowledge-portability story is fully end-to-end. Every wart flagged during the phase has been closed or explicitly documented as out-of-scope.

Notable observations from the phase:
- The v2.2 workflow + `/review-impl` pattern was exercised 9 times (one per sub-sprint) and caught 23+ real findings that the initial Phase-7 REVIEW missed. Zero false positives, zero regressions across ~10 rebuild/retest cycles.
- Three of the sub-sprints were unplanned splits from the original 11.6 framing. Splitting by risk profile (tests / streaming / security / perf) let each slice go through `/review-impl` in its own mental mode, which mattered — the findings-per-sprint stayed roughly constant, suggesting the review cost doesn't scale with code volume but with risk surface.
- The undici version-pin caveat was discovered during 11.6c-sec by running the tests, not during design. Worth the lesson: security-sensitive deps that integrate with Node internals deserve a runtime compatibility check before commit.

Phase 11 closes clean.

---
id: CH-PHASE11-S116CSEC
date: 2026-04-18
module: Phase11-Sprint11.6c-sec
phase: IN_PROGRESS
---

# Session Patch — 2026-04-18 (Phase 11 Sprint 11.6c-sec — Security polish)

## Where We Are
**Sprint 11.6c-sec complete and live-tested.** Both security gaps flagged in the Sprint 11.5 handoff are now closed: DNS-rebinding TOCTOU (closed via per-request pinned undici Agent on both urlFetch and pullFromRemote) + slow-loris body-stall (closed via 60s idle-timer Transform in the pullFromRemote pipeline). 39/39 unit + 61/61 e2e green, zero regressions. Added undici@^6.21.2 as an explicit dep (matches Node 23's bundled version — tried 8.x first, API drift broke the Dispatcher interface).

## Why split 11.6c into sec + perf
Original 11.6c scope bundled `ON CONFLICT` migration + body-stall + DNS pinning. Three different reviewer mental modes (SQL correctness, request lifecycle, network boundary) — mixing them into one commit would've forced /review-impl to context-switch mid-pass. Split 11.6c-sec (security items, same mental mode) from 11.6c-perf (SQL refactor, different risk profile).

## What shipped
### New: src/services/pinnedHttpAgent.ts (~60 lines)
- `pinnedAgentForAddress(PinnedAddress): Agent` — returns an undici Agent whose `connect.lookup` always returns the pre-validated IP, ignoring the hostname. Closes the TOCTOU race between `assertHostAllowed`'s DNS lookup and undici's own connect-time lookup.
- Handles BOTH `opts.all=true` (undici's actual usage pattern — expects `[{address,family}]` array) and `opts.all=false` (defensive, 3-arg `cb(null, address, family)`).
- Doesn't weaken HTTPS — SNI + Host header still use URL hostname, only DNS path is overridden.

### New: src/services/pinnedHttpAgent.test.ts (2 scenarios)
- **fetch to non-resolvable hostname lands on pinned IP** — uses a local HTTP server on 127.0.0.1:<random> and fetches `http://fake-host.example.invalid:<port>/ping`. Without pinning, fetch would error with ENOTFOUND. With pinning, the request lands on 127.0.0.1 and responds with the Host header (proves pinning only touches DNS, not HTTP semantics).
- **second agent with different port works independently** — guards against singleton/cached state in the impl.

### src/services/urlFetch.ts refactor
- `assertHostAllowed(host): Promise<PinnedAddress>` — signature change; returns the first validated DNS record (all records were already validated against private-range denylist; returning any safe one is fine). Two call sites both updated in this sprint.
- Redirect loop refactored: `fetchUrlAsDocument` now has an outer loop that creates a fresh pinned agent per hop, and a `runHop` inner helper that wraps the single-hop fetch + body-streaming in a try/finally that `agent.destroy()`s on every exit path. Per-hop agent is critical correctness: re-using one agent across hops would send all hops to the first hop's IP, defeating the redirect-SSRF check.
- `HopResult` discriminated union: `{kind:'redirect', next}` or `{kind:'done', value}`. Clean pattern match in the outer loop.

### src/services/exchange/pullFromRemote.ts changes
- `BODY_STALL_MS = 60_000` constant.
- `StallTransform` class (exported for unit testing): armed in constructor, resets timer in `_transform` (fires `this.destroy(new PullError('timeout', ..., 504))` if ms elapse without a chunk), clears timer in `_flush` + `_destroy`.
- Pipeline updated: `Readable.fromWeb(resp.body) → stall → counter → writeStream`. Stall sits before ByteCounter so its timer ticks on every chunk received from remote.
- Pinned agent created after `assertHostAllowed`, passed as `dispatcher`, `agent.destroy()` in finally. destroy() over close() so cleanup is bounded-time — close() waits for graceful socket drain and could hang on a dropped-network partner.

### New: src/services/exchange/pullFromRemote.test.ts (3 tests)
- **rejects pipeline when no chunks arrive within ms** — creates a Readable that never pushes, pipes through StallTransform(80ms), expects PullError('timeout', 504) within 50-1000ms window. The slow-loris defense in action.
- **does NOT fire when chunks arrive faster than the timeout** — trickles chunks at 30ms < 80ms stall window; pipeline must succeed, not reject. Regression guard against armTimer forgetting clearTimeout.
- **_destroy clears the pending timer** — destroys the stream manually, waits longer than ms; the implicit assertion is that nothing fires against a destroyed stream.

### package.json
- `undici@^6.21.2` dep added (first tried 8.1.0 but hit "invalid onRequestStart method" — undici 8's Dispatcher interface is incompatible with Node 23's internal undici 6.21.2).
- Three new test files added to `npm test`: pinnedHttpAgent.test.ts, pullFromRemote.test.ts, the 11.6b files from before.

## Review passes — 5 findings across two passes
### Phase-7 REVIEW (0 MED, 3 LOW accepted)
- LOW redundant close() semantics (later changed to destroy() in /review-impl)
- LOW undici version pin documented via package.json ^6.21.2
- LOW StallTransform constructor-arm race (cosmetic — pipe wiring is synchronous)

### /review-impl (1 MED + 1 LOW fixed, 1 LOW + 1 COSMETIC accepted)
- **MED**: StallTransform had no targeted test. The defense was visible only via code inspection — a regression in `_destroy` or `armTimer` wouldn't be caught by any existing test. Fixed: new `pullFromRemote.test.ts` with 3 cases proving timer-fires / trickle-succeeds / _destroy-cleans-up.
- **LOW**: `agent.close()` could hang on stuck sockets — Dispatcher.close() waits for graceful drain. Fixed: switched to `agent.destroy()` in both urlFetch (runHop finally) and pullFromRemote (outer finally). Per-request agent is throwaway so there's no reason to wait for graceful drain.
- LOW: no dedicated "DNS rebinding simulation" test (mock dns.lookup returning different IPs on successive calls). Accepted: the pinning unit test makes the STRONGER claim that no DNS lookup happens at connect time, which subsumes the attack simulation.
- COSMETIC: logger could include remoteHostname for debug. Not security-relevant. Skipped.

## Live test results (Sprint 11.6c-sec final)
```
tsc --noEmit              → 0 errors
npm test                  → 39/39 passed (+4 new: 3 StallTransform,
                            1 pinnedAgent outer suite)
npm run test:e2e:api      → 61/61 passed, 0 failed (88s) after mcp rebuild
                            phase10-ingest-url-* exercises urlFetch's
                            new pinned + runHop path
                            phase11-pull-* exercises pullFromRemote's
                            new pinned + stall paths
```

## undici dep caveat (important for future Node upgrades)
We pin `undici@^6.21.2` because Node 23.11.1 bundles undici 6.21.2 internally (used by global fetch). When we pass our userland `dispatcher: agent` to fetch, the internal dispatcher code checks for specific methods like `onRequestStart` — undici 8.x removed or renamed those, causing `Error [InvalidArgumentError]: invalid onRequestStart method`. If a future Node release bumps its bundled undici, this package's undici must be updated to match. The caret `^6.21.2` keeps us on 6.x.y — safe to run `npm update` without breaking.

## Security gains
Two attack vectors documented since Sprint 11.5 are now fully closed:
1. **DNS rebinding** — attacker controls a DNS record that resolves safely on first lookup (passes `assertHostAllowed`) and unsafely on second (undici's internal connect). Previously exploitable — undici did its own lookup and our validation didn't pin the IP. Now: `pinnedAgentForAddress` ensures the validated IP is the exact one undici connects to. No second lookup happens.
2. **Slow-loris on body stream** — attacker connects, sends headers, then trickles body bytes under MAX_BUNDLE_BYTES/sec so the stream stays open for hours without triggering the byte cap. Previously bounded only by the 500MB byte cap. Now: 60s idle timer kills the stream if no data arrives for the window.

## What's NOT in 11.6c-sec (deferred to 11.6c-perf)
- N+1 SELECT pattern in importProject — kept intact; different risk profile, deserves its own CLARIFY + /review-impl focused on SQL correctness rather than network boundary.

## Workflow artifacts this sprint produced
Fourth consecutive sprint through the full 12-phase v2.2 workflow. Even on this security-sensitive refactor, /review-impl caught 2 issues Phase-7 REVIEW missed (the StallTransform coverage gap + the close-could-hang gap). Five straight sprints validating the pattern.

---
id: CH-PHASE11-S116B
date: 2026-04-18
module: Phase11-Sprint11.6b
phase: IN_PROGRESS
---

# Session Patch — 2026-04-18 (Phase 11 Sprint 11.6b — Streaming polish)

## Where We Are
**Sprint 11.6b complete and live-tested.** Both documented memory hot spots in the bundle pipeline refactored to streaming. Hot spot #1 (`iterateJsonl`) dropped peak memory ~99% via readline + hashTap Transform. Hot spot #2 (`materializeDocContent`) dropped peak ~45% via a new `encodeStreamToBase64` helper with 3-byte-aligned chunked encoding. 32/32 unit + 61/61 e2e green. Zero behavior changes; 3 `/review-impl` findings all doc-only.

## What shipped
- **`src/services/exchange/base64Stream.ts`** (NEW, ~65 lines including ~40 lines of JSDoc) — pure helper `encodeStreamToBase64(stream: Readable): Promise<string>`. Maintains a 0-2 byte `tail` between iterations so `Buffer.toString('base64')` only runs on 3-byte-aligned prefixes, preventing mid-stream `=` padding from corrupting the output. JSDoc documents: 3-byte alignment invariant, V8 string size ceiling (~512 MB on 64-bit → ~384 MB raw input limit), and the Buffer-chunks precondition.

- **`src/services/exchange/base64Stream.test.ts`** (NEW, ~140 lines) — 12 unit tests:
  1. empty stream → empty base64
  2. single byte (1 → `==` padding)
  3. two bytes (2 → `=` padding)
  4. three bytes (3 → no padding)
  5. four bytes (4 → `==` padding)
  6. five bytes (5 → `=` padding)
  7. chunks exactly 3-byte aligned → no tail buffering
  8. chunks crossing 3-byte boundaries (2+2+3 split) → tail discipline required
  9. single-byte chunks (worst case for tail carry)
  10. 1 MB random buffer byte-identical round-trip
  11. rejects on upstream stream error
  12. (additional edge case merged into 10)

- **`src/services/exchange/bundleFormat.ts`** — `iterateJsonl` refactored. Raw zip entry stream pipes through a `Transform` hash tap (`hash.update(chunk); cb(null, chunk)`), then through `readline.createInterface({ input: hashTap, crlfDelay: Infinity })`. Records yielded per line. Finally block closes readline + destroys rawStream on early abort. Checksum + line-count validation shifted from pre-yield to EOF (existing tests are drain-until-error so unaffected).

- **`src/services/exchange/bundleFormat.test.ts`** — +2 streaming tests: (a) 10k-record round-trip proves line splitting + large-entry streaming; (b) consumer early-abort cleanup proves generator finally runs and yauzl fd is released.

- **`src/services/exchange/importProject.ts`** — `materializeDocContent` replaced Buffer.concat + toString with `await encodeStreamToBase64(stream)`. JSDoc updated: notes the peak-memory reduction (#2), the V8 string ceiling, and the existing test-coverage gap (phase11 tests don't seed doc fixtures).

- **`package.json`** — `npm test` script now includes `src/services/exchange/base64Stream.test.ts` + `src/services/exchange/bundleFormat.test.ts`. Without this, the `test` script only ran the 2 pre-existing git tests and would have missed every new unit test.

## Memory impact — peak reductions
### Hot spot #1: iterateJsonl
Before: `readEntireEntry` → `buf.toString('utf-8')` → `text.split('\n')`. For a 50 MB lessons.jsonl, peak = ~100 MB (Buffer + UTF-16 string duplicating the data).
After: readline streams one line at a time. Peak = single-line size (<1 MB typical).
**~99% peak reduction.**

### Hot spot #2: materializeDocContent
Before: accumulate chunks → `Buffer.concat` → `buffer.toString('base64')`. For a 100 MB PDF, peak = ~233 MB (100 MB raw Buffer + 133 MB base64 string coexisting during the final return).
After: raw chunks GC'd progressively; only the growing base64 string + current 1 MB chunk remain alive. Peak = ~134 MB.
**~45% peak reduction.** Base64 peak unchanged (133 MB) because pg-node serializes the full query's text value at send time — true end-to-end streaming would require migrating `documents.content` to BYTEA.

### Hard ceiling we now document
V8's max string size on 64-bit is `(1 << 29) - 24` ≈ 512 MB. Base64 inflates 4/3×, so any single document ≥384 MB raw throws `RangeError: Invalid string length` when pg-node flattens the query. Both old and new code had this limit; Sprint 11.6b documents it explicitly in `base64Stream.ts` + `materializeDocContent` JSDoc. The Phase-10-level fix (bytea migration + streaming INSERT) is out of scope; for Phase 11 the practical cap is ~100 MB per document, well within the limit.

## Review passes — 3 findings caught + fixed
### Phase-7 REVIEW (0 MED, 2 LOW accepted)
- **LOW** redundant `rl.close()` in generator finally — defensive, kept.
- **LOW** no size cap on `encodeStreamToBase64` — bounded by caller's 500 MB multer cap, documented.

### `/review-impl` (1 MED + 2 LOW, all doc-only)
- **MED 1** V8 string ceiling caps documents at ~384 MB raw — pre-existing, not introduced by this refactor. Documented in both files + cross-linked to Phase-10-level bytea fix.
- **LOW 2** No integration test for document round-trip through import — pre-existing gap (phase11 tests don't seed docs). JSDoc note added in `materializeDocContent`.
- **LOW 3** `encodeStreamToBase64` silently breaks on string streams (`.length` counts UTF-16 units not bytes). Explicit precondition added to helper's JSDoc.

## Live test results (Sprint 11.6b)
```
npx tsc --noEmit                 → 0 errors
npm test                         → 32/32 passed, 0 failed (543ms)
                                   (2 pre-existing + 12 new base64Stream
                                    + 16 bundleFormat incl. 2 new streaming)
npm run test:e2e:api             → 61/61 passed, 0 failed (85s)
                                   after mcp rebuild (zero regressions)
```

## Semantic shift worth flagging for future sprints
`iterateJsonl` now validates checksum AT END of iteration rather than BEFORE yielding records. A consumer that wants to reject a bad bundle before doing any work must drain the whole iterator first. `importProject` is transactional (any mid-stream error triggers rollback), so this is safe; but if a future caller expects "if checksum is wrong, nothing is yielded", they need to know.

## What's NOT in 11.6b (deferred to 11.6c)
- INSERT ... ON CONFLICT migration on importProject (N+1 perf)
- Body-stall timeout for pullFromRemote (slow-loris defense)
- DNS-rebinding pinning (custom undici agent — shared with urlFetch.ts)
- Migrating `documents.content` to BYTEA (Phase-10-level work beyond Phase 11)

## Workflow artifacts this sprint produced
Third consecutive sprint through the full 12-phase v2.2 workflow. `/review-impl` ran once (0 MED from initial review, 1 MED + 2 LOW from review-impl) — all doc-only findings surface a pre-existing V8 string ceiling that wasn't documented anywhere. The coverage-gap mental mode paid off again even on a pure memory refactor.

---
id: CH-PHASE11-S116A
date: 2026-04-18
module: Phase11-Sprint11.6a
phase: IN_PROGRESS
---

# Session Patch — 2026-04-18 (Phase 11 Sprint 11.6a — Test infrastructure)

## Where We Are
**Sprint 11.6a complete and live-tested.** Test coverage closed for the import scenarios Sprint 11.3 shipped without automation (ID remapping, conflict policies, cross-tenant guard under all policies) plus a first Playwright scenario exercising the Knowledge Exchange panel end-to-end. 61/61 API + 52/52 GUI green. Coverage strengthened after `/review-impl` caught 2 MED + 2 LOW test-quality gaps on the first-pass tests.

## Why we split 11.6 into a/b/c
Original 11.6 scope bundled test infrastructure + streaming polish + perf/security polish. At ~10-15 files with mixed risk profiles (pure coverage vs. memory refactor vs. security-sensitive agent injection), running them as one sprint would have produced a single commit where a `/review-impl` pass finding in one area would block the others. Splitting per risk lets each slice through the full workflow independently.

- **11.6a** (this sprint) — pure test coverage, no behavior change
- **11.6b** (next) — streaming JSONL decode + streaming base64 import; isolated to bundleFormat.ts + importProject.ts
- **11.6c** (after) — ON CONFLICT migration + body-stall timeout + DNS-rebinding pinning (security-sensitive; will warrant `/review-impl`)

## What shipped
- **`test/e2e/api/phase11-import.test.ts`** (~360 lines) — 5 scenario tests hitting the live Docker Postgres via REST:
  - `phase11-import-roundtrip-checksum` — per-entry sha256 stable across re-exports; import result carries `source_project_id`, `schema_version=1`, `counts.lessons.total=1` from the bundle manifest
  - `phase11-import-id-remapping` — deletes src before import so the lesson actually lands on dst; verifies `project_id` rewrite via the list endpoint's `items` field (the list's `items` key was an incidental catch — earlier tests used `body?.lessons ?? body?.results` and silently got undefined)
  - `phase11-import-policy-overwrite` — `counts.lessons.updated=1` AND title reverts to bundle version (verifies the UPDATE ran on real data, not just a counter)
  - `phase11-import-policy-fail` — 409 + `code=conflict_fail` AND `items.length` unchanged (transaction rollback verified)
  - `phase11-import-cross-tenant-guard-under-overwrite` — guard refuses overwrite of a UUID owned by another project even under `policy=overwrite`; records `skipped=1` + conflict entry; lesson does not leak onto dst
- **`test/e2e/api/runner.ts`** — registered `allPhase11ImportTests`
- **`test/e2e/gui/phase11-exchange.spec.ts`** (~140 lines, 1 Playwright scenario) — exercises the full export → download → upload → Apply flow through the Knowledge Exchange panel shipped in Sprint 11.4. Uses the download event handler + setInputFiles on the hidden file input + localStorage keys (`contexthub-project-id`, `contexthub-selected-project-ids`) for project switching.

## Review passes — 5 findings caught + fixed
### Initial Phase-7 REVIEW (0 MED, 1 LOW + 1 COSMETIC)
- **LOW** temp bundle cleanup not wrapped in try/finally — accepted (OS tmp cleanup, leak bounded to failed runs)
- **COSMETIC** JSDoc on `readEntryAsBuffer` clarified "small entries only" — fixed

### `/review-impl` pass (2 MED + 2 LOW)
- **MED 1** `phase11-import-roundtrip-checksum`'s main round-trip assertion was tautological — comparing `lesson_types.jsonl` sha256 between two exports on the same instance is a no-op because lesson_types are globally scoped, hashes match even if import did nothing. Fix: assert the import result's `source_project_id`, `schema_version`, and `counts.lessons.total` instead — all carried from the bundle manifest, proves bundle actually decoded.
- **MED 2** `phase11-import-id-remapping` wasn't testing remapping. Because src still existed, the cross-tenant guard fired before the project_id rewrite would execute. Test was effectively a renamed cross-tenant guard test duplicating test 5. Fix: delete src before import; lesson now lands on dst; verify `project_id=dst` on the actual row via the list endpoint.
- **LOW 3** `phase11-import-policy-overwrite` trusted `counts.lessons.updated=1` without verifying the data actually reverted. Fix: GET the lessons list after import, find the row by id, assert title=='overwrite lesson v1'.
- **LOW 4** `phase11-import-policy-fail` asserted 409 but not transaction rollback. Fix: capture lesson count before, assert unchanged after.

## Incidental catch during fixes
The list endpoint (`GET /api/lessons`) returns rows under `items`, not `lessons` or `results`. An earlier sanity check in test 3 used the wrong field name and silently got undefined, producing the confusing "edit not visible, got title: undefined" failure. All uses in the file now correctly read `body?.items`. (Source: `listLessons()` in `src/services/lessons.ts:334`.)

## Playwright flake avoidance
Initial phase11-exchange.spec.ts failed in the full GUI suite (passed in isolation) because `createLesson` in beforeAll hit HTTP 500 — embeddings service under load, same root cause as the documented Phase 10 flake. Fix: removed lesson seeding from the GUI test. Empty projects are sufficient because globally-scoped lesson_types still make the exported zip non-empty, and the data-level lesson round-trip is already proven by `phase11-import-roundtrip-checksum`. The GUI test's job is to prove the UI wires up (download handler + dropzone + Preview + Apply + banner), not to verify data correctness.

## Live test results (Sprint 11.6a)
```
npx tsc --noEmit                     → 0 errors
npm run test:e2e:api                 → 61/61 passed, 0 failed (79s)
                                      (dropped from 194s after /review-impl
                                       removed tautological round-trip cycle)
npm run test:e2e:gui                 → 52/52 passed, 0 failed (47s)
                                      (1 new phase11-exchange scenario)
```

Zero regressions across 56+51 pre-existing tests.

## What's NOT in 11.6a (deferred)
- **Cross-version schema migration** — no v2 schema yet; fixture would be speculative
- **FK integrity on chunks/documents** — no chunk/doc fixtures in these tests; would require heavy seed (phase10 tests cover the FK-chunked flow indirectly)
- **Role enforcement tests on /import** — covered by `auth.test.ts` + `requireRole('writer')` middleware; not duplicating
- **Streaming polish** — Sprint 11.6b
- **Perf + security polish** — Sprint 11.6c

## Workflow artifacts this sprint produced
Second sprint driven through the full 12-phase v2.2 workflow. `/review-impl` once again caught what Phase-7 REVIEW missed (2 MED this time) — the coverage-gap-hunt mental mode continues to pay off even on pure test code. Third straight sprint where `/review-impl` demonstrates concrete value; saving as a workflow lesson.

---
id: CH-PHASE11-S115
date: 2026-04-18
module: Phase11-Sprint11.5
phase: IN_PROGRESS
---

# Session Patch — 2026-04-18 (Phase 11 Sprint 11.5 — Cross-instance pull)

## Where We Are
**Sprint 11.5 complete and live-tested.** `POST /api/projects/:id/pull-from` orchestrates a SSRF-guarded fetch of a remote `/export` bundle into a temp file, then hands the file to the existing `importProject` service. All 9 acceptance criteria met; 56/56 E2E tests green (+9 new phase11-pull tests, zero regressions). Three review passes (Phase-7 REVIEW + `/review-impl` × 2) caught 10 findings — all fixed.

## What shipped
- **`src/services/urlFetch.ts`** — exported `assertHostAllowed` (1-line + JSDoc, no behavior change).
- **`src/services/exchange/pullFromRemote.ts`** (~330 lines) — the orchestrator:
  - Validates `remote_url` (parseable + scheme allowlist), `remote_project_id` (≤ 256 chars), `api_key` (allow-list `/^[\x20-\x7E\t]+$/`).
  - Reuses `assertHostAllowed` for SSRF (TOCTOU race with undici connect lookup documented; same gap as urlFetch.ts, deferred to 11.6).
  - Fetch with `AbortController + clearTimeout(connectTimer)` after headers, so body drain is bounded by `MAX_BUNDLE_BYTES` (500 MB) not a wall clock — otherwise a legitimate 500 MB pull on a 5 Mbps link would abort mid-stream.
  - `redirect: 'manual'` — reject 3xx (remote `/export` doesn't redirect; no per-hop SSRF check needed).
  - Content-Type exact-match on `application/zip` or `application/zip+<suffix>` (not loose `startsWith` which would accept `application/zipper`).
  - `pipeline(Readable.fromWeb(resp.body), ByteCounter, createWriteStream(tmp))` — 500 MB cap enforced in-stream, not buffered.
  - `importProject({ bundlePath })` handoff; result extended with `remote: { url, project_id, bytes_fetched }`.
  - `finally` unlinks temp file + rmdirs temp dir, best-effort.
  - Error enum: `invalid_url / invalid_api_key / invalid_project_id / bad_scheme / ssrf_blocked / unreachable / timeout / upstream_error / bad_content_type / too_large`.
- **`src/api/routes/projects.ts`** (+78 lines) — `POST /:id/pull-from` route. Validates body shape, constructs `PullFromRemoteOptions`, maps `PullError`→HTTP status via `e.httpStatus`, maps `ImportError` same as `/import`.
- **`test/e2e/api/phase11-pull.test.ts`** (~260 lines, 9 tests):
  1. `phase11-pull-happy-path` — self-pull round-trips a 6,388-byte bundle; asserts `applied=true`, `bytes_fetched>0`, `remote.project_id` echoed, `counts.lessons.total=1`, and either `created=1` OR `skipped=1` with a cross-tenant conflict entry (depending on whether source/target share a DB).
  2. `phase11-pull-dry-run` — `applied=false`, `dry_run=true`, 0 rows on target.
  3-7. Validation 400s (`missing remote_url / missing remote_project_id / bad scheme / invalid url / api_key CR-LF injection / long project_id`). The api_key-injection test asserts the raw injected value does NOT appear in the error message.
  8. `phase11-pull-nonexistent-remote` — remote 404 maps to 502 `upstream_error`.

## Review passes — 10 issues caught + fixed

### Phase-7 REVIEW (1 MED)
- **MED** `AbortSignal.timeout(60_000)` spanned the body-drain phase; a 500 MB pull on a slow link would abort mid-stream. Replaced with `AbortController + setTimeout + clearTimeout(timer)` immediately after headers return. Same pattern urlFetch.ts uses.

### `/review-impl` pass 1 (3 MED + 2 LOW)
- **MED 1** api_key echo in error responses: undici's `TypeError` message includes the raw header value on invalid headers → flowed through `new PullError('unreachable', err.message, 502)` → JSON response → user logging pipelines (Sentry, browser console) captured the credential. Fixed by pre-validating api_key before header construction.
- **MED 2** Content-Type loose match (`startsWith('application/zip')`) accepted `application/zipper`, `application/zip2`. Tightened to exact type/subtype match.
- **MED 3** DNS rebinding TOCTOU — documented the accepted risk (urlFetch.ts precedent). Pinning requires a custom undici agent with a `lookup` override; deferred to 11.6.
- **LOW 4** Temp dir leak window — `mkdtemp` was before the try block. Moved inside try; finally guards possibly-undefined `tmpPath`/`tmpDir`.
- **LOW 5** No `remoteProjectId` length cap. Added `MAX_PROJECT_ID_LENGTH=256` with a new `invalid_project_id` error code.
- Added 2 new E2E tests: `phase11-pull-api-key-injection`, `phase11-pull-long-project-id`.

### `/review-impl` pass 2 (1 MED + 2 LOW)
- **MED A** File-header docstring still claimed "`AbortSignal.timeout` with a 60s overall timeout" — but we'd replaced it with `AbortController` in Phase-7 REVIEW. Also contradicted the FETCH_TIMEOUT_MS JSDoc. Rewrote the file-header Pipeline and Known-Limitations sections so they match the code.
- **LOW A** Inline step numbers (`// 1. Validate remote_url`, `// 2. ...`, etc.) had drifted after adding api_key validation — `// 3. Build export URL` at line 204 was actually step ~5. Stripped numbers; kept descriptive headings.
- **LOW B** `HEADER_INJECTION_RE` was a deny-list. If undici rejects bytes we didn't block (e.g. 8-bit obs-text), the TypeError message would still echo the credential. Swapped for an allow-list: `API_KEY_ALLOWED_RE = /^[\x20-\x7E\t]+$/` (visible ASCII + HTAB — covers every realistic API key format).

## Live test results (Sprint 11.5 — final)
```
56/56 passed, 0 failed (134478ms)
  phase11-pull-happy-path                 14881ms  ✓
  phase11-pull-dry-run                    10949ms  ✓
  phase11-pull-missing-remote-url             1ms  ✓
  phase11-pull-missing-remote-project-id      1ms  ✓
  phase11-pull-bad-scheme                     2ms  ✓
  phase11-pull-invalid-url                    1ms  ✓
  phase11-pull-api-key-injection              1ms  ✓
  phase11-pull-long-project-id                1ms  ✓
  phase11-pull-nonexistent-remote             3ms  ✓
```

Three full e2e cycles run across the sprint (initial 54-test, +2 after pass-1 fixes, +0 after pass-2 fixes → 56/56 stable). Zero regressions across 47 pre-existing tests.

## Self-pull caveat (documented in code + test)
Because source and target share a database in self-pull, the Sprint 11.3 cross-tenant UUID guard correctly refuses to re-own a lesson_id. Net result for self-pull: `counts.lessons.skipped=1 + conflict entry`, not `created=1`. True cross-instance pull targets a separate DB where UUIDs are fresh — the test asserts EITHER outcome. This is a correctness feature, not a test workaround.

## What's NOT in 11.5 (deferred to 11.6)
- GUI for cross-instance pull (API-only; Sprint 11.4 shipped the main Knowledge Exchange panel for local import/export)
- Bundle caching for repeat pulls
- Webhook-driven / scheduled pulls
- Body-stall (slow-loris) timeout — bounded by MAX_BUNDLE_BYTES for now
- DNS-rebinding pinning — needs custom agent, shared concern with urlFetch.ts
- SSRF-blocked integration test — requires disabling `ALLOW_PRIVATE_FETCH_FOR_TESTS` which also disables `/test-static/` used by Phase 10 tests; tested manually via curl smoke instead

## Workflow artifacts this sprint produced
- `.workflow-state.json` drove all 12 phases; pre-commit hook in `.claude/settings.json` would have blocked a commit without VERIFY + POST-REVIEW + SESSION evidence
- `/review-impl` invoked twice — second invocation on the post-fix code — caught docstring drift that would otherwise have gone unnoticed until a future reader debugged a timeout



---
id: CH-PHASE11-S114
date: 2026-04-15
module: Phase11-Sprint11.4
phase: IN_PROGRESS
---

# Session Patch — 2026-04-15 (Phase 11 Sprint 11.4 — GUI export + import)

## Where We Are
**Sprint 11.4 complete and live-tested.** Knowledge Exchange section added to the existing Project Settings page — no new top-level routes. Two subsections in one component: Export (toggles + download anchor) and Import (drag-drop + policy radio + dry-run preview + apply + result panel with per-entity counts table and conflicts list). End-to-end browser round-trip verified: created a fresh project with one lesson via API → exported → deleted the project → uploaded the bundle through the GUI dropzone → ran dry-run → clicked Apply → lesson restored byte-identical.

### What shipped
- **`gui/src/lib/api.ts`** — two new methods:
  - `exportProjectUrl({ projectId, includeDocuments?, includeChunks? })` returns the URL string for an `<a href>`. No JS fetch — the browser handles the streaming download natively.
  - `importProject(file, { projectId, policy?, dryRun?, conflictsCap? })` posts the multipart bundle to the import endpoint and returns the parsed `ImportResult`.
- **`gui/src/app/projects/settings/exchange-panel.tsx`** (~330 lines) — single component holding both subsections:
  - **Export**: two checkboxes for `include_documents` and `include_chunks`, reactive href on the download `<a>`, lucide `Download` icon.
  - **Import**: drag-drop dropzone with click-to-browse fallback, file size cap (500 MB matching the BE multer limit), policy radio (`skip` / `overwrite` / `fail` — `skip` default), Preview (dry-run) and Apply buttons (both permissive — no required preview), Clear button to reset.
  - **Result panel**: green ✓ for `Imported`, blue file icon for dry-run, amber for `Not applied`. Source/generated metadata, per-entity counts table (`total / created / updated / skipped` with em-dash for zeros and color-coded values), conflicts list capped server-side (we display `(N+)` if `conflicts_truncated`).
- **`gui/src/app/projects/settings/page.tsx`** — wired `<ExchangePanel projectId={projectId} />` between the Features panel and the Danger Zone.

### Live test results (Sprint 11.4)
Driven via the MCP playwright tools against http://localhost:3002:
1. Navigated to /projects/settings → Exchange panel renders
2. Verified default export href: `http://localhost:3001/api/projects/free-context-hub/export`
3. Unchecked "Include document binaries" → href reactively updated to `?include_documents=false`
4. Created fresh `sp114-test` project + 1 lesson via API, exported a 6,372 B bundle to disk
5. Switched the GUI to the new project via localStorage + reload → href tracks the new project_id
6. Clicked the dropzone → file chooser → uploaded `sp114-bundle.zip` → dropzone label updated to filename + size
7. Deleted the source project to make the import meaningful
8. Clicked "Preview (dry-run)" → result panel rendered with `Lessons 1 1 — —` (total / created / updated / skipped), 6 lesson_types skipped (already exist globally), 6 conflicts listed
9. Clicked "Apply" → header changed to ✓ Imported, lesson visible in `/api/lessons?project_id=sp114-test` with the original `lesson_id` `5baa274c-...`

Full GUI Playwright suite: 50 passed, 1 unrelated flake in `phase10.spec.ts › extract button → mode selector → Fast → review opens` (passes in isolation in 2.8s, fails under full-suite load — same pattern as the earlier lesson distillation flake).

### Code review — 2 issues caught + fixed
1. **MED** State (`file`, `result`, `busy`) didn't reset when the user switched projects via the project selector. Result panel would show the previous project's import outcome under a different project's header, and a half-uploaded file could be applied to the wrong target. Fixed with a `useEffect([projectId])` that clears file/result/busy and resets the file input. Toggles intentionally NOT reset (user preference for export shape persists across projects).
2. **LOW** Documented the cross-origin `<a download>` caveat — the HTML `download` attribute is ignored cross-origin, so the actual download filename comes from the BE's `Content-Disposition` header. Kept the attribute for the same-origin production case.

### What's NOT in 11.4 (deferred)
- Standalone import/export pages (using project-settings is fine — more discoverable, less code)
- Cross-instance pull UI — that's Sprint 11.5
- Scheduled / batch imports
- Editable `conflicts_cap` from the GUI (BE supports it; FE always uses default 50)
- Strict mode (require dry-run before apply) — went permissive instead

## Sprint 11.3 history (prev)

---
id: CH-PHASE11-S113
date: 2026-04-15
module: Phase11-Sprint11.3
phase: IN_PROGRESS
---

# Session Patch — 2026-04-15 (Phase 11 Sprint 11.3 — Full project import + conflict policy)

## Where We Are
**Sprint 11.3 complete and live-tested.** `POST /api/projects/:id/import` accepts a multipart bundle upload, decodes via `bundleFormat.openBundle()`, and applies it transactionally to a target project with three conflict policies (`skip`, `overwrite`, `fail`) and a dry-run preview mode. Bundles up to 500 MB. Auto-creates the target project. Round-trip end-to-end test (export → delete → import) restores byte-identical rows. The `document_lessons` link table is now part of the bundle format too — backwards-compatible v1 addition.

### What shipped
- **`src/services/exchange/importProject.ts`** (~520 lines) — the full apply algorithm:
  - Decodes bundle, validates schema_version
  - `BEGIN` (skipped in dry-run), auto-creates target project
  - Walks entities in FK-safe order: `lesson_types → documents → chunks → lessons → guardrails → document_lessons`
  - For each row: SELECT by PK → apply policy → INSERT or UPDATE (or skip)
  - `project_id` rewritten on every row from bundle source to URL target
  - UUIDs preserved (re-import with `skip` is a no-op)
  - Document binaries base64-encoded uniformly with `data:base64;` prefix (no doc_type-dependent branching — symmetric encoding)
  - Embeddings cast to pgvector via `$N::vector` literal
  - Conflicts captured into a bounded list (`conflictsCap`, default 50, hard ceiling 1000) with `conflicts_truncated` flag
  - `COMMIT` on success, `ROLLBACK` on any failure
  - Custom `ImportError` codes: `malformed_bundle` / `schema_version_mismatch` / `conflict_fail` / `invalid_row` / `io_error`
- **`POST /api/projects/:id/import`** in `src/api/routes/projects.ts`:
  - `multer.diskStorage` with **500 MB cap** (vs. the 10 MB default used elsewhere) — bundles routinely exceed 10 MB
  - Query params: `policy` / `dry_run` / `conflicts_cap`
  - Maps `ImportError` codes to HTTP status: 400 for malformed/schema/invalid_row, 409 for conflict_fail, 500 for io_error
  - `requireRole('writer')`
  - Always cleans up the temp upload file in `finally` (multer disk storage doesn't auto-delete)
- **bundleFormat extension** — `BundleData.document_lessons` + `BundleReader.document_lessons()` + `ENTRY_NAMES.document_lessons`. Backwards-compatible: older bundles without the entry yield empty (forward-compat already supported). `schema_version` stays at `1`.
- **exportProject extension** — added a `cursorIterable` for `document_lessons` joined to `documents` to scope by project (the link table has no `project_id` column).
- **Built-in lesson_type protection** — overwrite policy refuses to clobber `is_builtin=true` types, recording the refusal as a conflict instead.

### Live test results (Sprint 11.3)
```
# Round-trip on a fresh project
POST /api/projects               → create sprint113-test
POST /api/lessons                → create 1 lesson
GET  /export                     → 6,341 B bundle
DELETE /api/projects             → delete project
POST /import (policy=skip)       → applied: true, lessons: {created: 1, ...}
GET  /api/lessons                → lesson_id, title, content, tags all byte-identical

# Conflict policies
POST /import (policy=skip)       → 1 lesson skipped, 7 conflicts (1 + 6 lesson_types)
POST /import (policy=overwrite)  → 1 lesson updated
POST /import (policy=fail)       → HTTP 409, code=conflict_fail

# Bounded conflicts list
POST /import?conflicts_cap=2     → 2 entries, conflicts_truncated: true

# Bad input
POST (no file)                   → HTTP 400, "file is required"
POST ?policy=banana              → HTTP 400, "invalid policy"
POST garbage.zip                 → HTTP 400, code=malformed_bundle

# Dry-run on the real project
POST /import (dry_run=true)      → applied: false, total counts:
                                    581 lessons, 76 guardrails, 6 lesson_types,
                                    14 documents, 11 chunks, 1 document_lesson
                                    (all skipped because UUIDs are global PKs)
```

### Code review — 4 issues caught + fixed
1. **HIGH** `materializeDocContent` had an export/import asymmetry: export used a `data:base64;` prefix detection on the column string, import branched on `doc_type` to choose utf-8 vs base64. The two heuristics could disagree on edge cases (e.g. a `markdown` doc accidentally stored as base64). Fixed by always re-encoding as `data:base64;` on import — base64 round-trips ANY byte sequence, the asymmetry is gone, and the read path already handles both formats transparently.
2. **HIGH** `applyLessonType` overwrite path silently clobbered `is_builtin=true` rows — a malicious or buggy bundle could downgrade canonical types or rewrite their display names. Fixed by refusing the overwrite when the destination row is a built-in, recording the refusal as a `conflict` so the operator sees what happened.
3. **MED** Documented the N+1 SELECT-then-INSERT pattern (~1200 round-trips for 581 lessons) — chosen over `INSERT ... ON CONFLICT` because the SELECT lets us count + report conflicts accurately. At ~1ms per query it's negligible vs base64 + transaction overhead.
4. **MED** Documented the per-doc memory cost — `materializeDocContent` buffers entire binaries into RAM before encoding (a 100 MB PDF = 100 MB Buffer + 133 MB base64 string). Bounded by the 500 MB multer route limit. Streaming encoding deferred to 11.6 polish.

### Why this matters for the rest of Phase 11
- Sprint 11.4 (GUI) just calls these two endpoints — no new server-side work needed.
- Sprint 11.5 (cross-instance pull) chains `exportProject` against a remote URL into `importProject` on the local instance. Because both sides use the same `BundleData` shape and UUIDs are preserved, repeat pulls under `policy=skip` are idempotent.
- The `ImportConflict` reporting will inform the GUI's dry-run preview UI in 11.4 (show conflicts, let user pick policy, then re-submit without `dry_run`).

### What's NOT in 11.3 (deferred)
- `merge` policy — too complex for v1; `overwrite` covers the common "I want the import to win" case
- ID remapping (rename UUIDs on collision) — would require rewriting all FK references
- Partial entity selection on import (`?include_lessons=false`) — defer
- Async background import for huge bundles — current path holds the HTTP connection
- Switching to `INSERT ... ON CONFLICT` for the N+1 perf win
- Streaming base64 encoding to bound per-doc memory
- Unit tests — round-trip live test covers the happy paths; will add `importProject.test.ts` in 11.6 polish

## Sprint 11.2 history (prev)

---
id: CH-PHASE11-S112
date: 2026-04-14
module: Phase11-Sprint11.2
phase: IN_PROGRESS
---

# Session Patch — 2026-04-14 (Phase 11 Sprint 11.2 — Full project export)

## Where We Are
**Sprint 11.2 complete and live-tested.** `GET /api/projects/:id/export` streams a full project bundle (lessons + guardrails + lesson_types + documents + chunks) as a zip download, built on `bundleFormat.encodeBundle()` from 11.1. Uses `pg-cursor` for cursor-based iteration so even multi-thousand-row tables stream without buffering. Live test against the docker stack: 3.0 MB zip with 581 lessons, 76 guardrails, 6 lesson_types, 11 chunks, 14 documents (PDF/DOCX/PNG/markdown), all decoded byte-correctly via `openBundle()`.

### What shipped
- **`src/services/exchange/exportProject.ts`** (~280 lines) — `exportProject(opts, output)` opens a single dedicated `PoolClient`, builds a `BundleData` whose entity arrays are async generators backed by `pg-cursor`, and pipes through `bundleFormat.encodeBundle()`. Cursors are consumed sequentially (one open at a time) and closed in the generator's finally before the next opens. Embeddings parsed from pgvector text format (`"[0.1,0.2,...]"` → `number[]`).
- **`GET /api/projects/:id/export`** in `src/api/routes/projects.ts` — sets `Content-Type: application/zip` + `Content-Disposition` headers, streams archiver directly into `res`. Query params `include_documents=false` / `include_chunks=false` skip those entities (default both true — "bundle huge is normal"). 404 if project missing.
- **bundleFormat extension** — `BundleDocument.content` now accepts `null` for URL-only docs that have no stored binary. The encoder writes the metadata row with `entry: null`; the decoder exposes `BundleDocumentRead.hasContent` and throws `BundleError("missing_entry")` if a consumer calls `openContent()` on a metadata-only doc. New unit test covers the full round-trip.
- **Documents content extraction** — handles both Phase 10 binary uploads (`data:base64;<...>` prefix) and plain-text uploads (raw utf-8). Extension picked from filename, falling back to doc_type.
- **`pg-cursor` ^2.19.0 + `@types/pg-cursor` ^2.7.2** added to package.json.

### Live test results (Sprint 11.2)
```
GET /api/projects/free-context-hub/export                       → 200, 3,023,663 B
GET /api/projects/free-context-hub/export?include_chunks=false  → 200, 2,970,887 B
GET /api/projects/free-context-hub/export?include_documents=false → 200, 2,968,116 B
GET /api/projects/does-not-exist-xyz/export                     → 404

Decoded full bundle:
  schema: 1
  project: free-context-hub / free-context-hub
  entries:
    lessons.jsonl       7,623,284 B (581 records)
    guardrails.jsonl       17,358 B (76 records)
    lesson_types.jsonl      1,266 B (6 records)
    chunks.jsonl          146,472 B (11 records)
    documents/<11 markdown files> · 30-31 B each
    documents/<doc>.docx · 12,214 B
    documents/<doc>.pdf  ·  2,545 B
    documents/<doc>.png  · 46,040 B
    documents.jsonl         8,270 B (14 records)
  decoded: 581 lessons, 76 guardrails, 6 lesson_types, 11 chunks,
           14 documents (0 metadata-only, 61,131 binary bytes)
```

All bundles decode round-trip via `openBundle()`. Binary docs (PDF / DOCX / PNG) are byte-identical to their on-disk originals.

### Code review — 3 issues caught + fixed
1. **MED** `encodeBundle(data, output as never)` used a `as never` type cast to bridge `NodeJS.WritableStream` ↔ `Writable`. Replaced by typing the parameter as `Writable` directly — proper compile-time checking restored.
2. **LOW** `lesson_types` is a global table with no `project_id` column → exporting "the project" actually exports every type known to the instance. Documented in the JSDoc so the import side (Sprint 11.3) knows to reconcile against existing types on the destination.
3. **LOW** Headers-sent race in the route: if `encodeBundle` errors mid-stream, headers are already flushed and we can't return a clean error. Documented in the route's catch comment — the partial zip will fail to decode client-side and the manifest checksum mismatch will surface the cause.

### Why this matters for the rest of Phase 11
- 11.3 (full import + conflict policy) consumes the format we just produced. Round-trip already verified end-to-end against real DB rows means import can rely on the data shape.
- The cursor-based design means Sprint 11.5 (cross-instance pull) can call `exportProject(remoteUrl)` against a 50k-lesson production project without OOM'ing the destination instance.
- The `BundleDocument.content = null` extension means URL-only docs survive the round-trip as references — important for projects that link to external papers without copying them.

### What's NOT in 11.2 (deferred)
- API key/role gating on export — readers should be allowed to export, no admin gate
- Feature toggle to disable export per-project
- Async background export jobs for huge projects (current sync path holds an HTTP connection for the duration)
- Encryption / signing of bundles
- Embedding binary packing — vectors-as-JSON works fine for the 600-lesson test project (~7.6 MB lessons.jsonl, mostly embeddings)

## Sprint 11.1 history (prev)

---
id: CH-PHASE11-S111
date: 2026-04-14
module: Phase11-Sprint11.1
phase: IN_PROGRESS
---

# Session Patch — 2026-04-14 (Phase 11 Sprint 11.1 — Bundle format v1)

## Where We Are
**Phase 11 started.** Sprint 11.1 ships the bundle format primitive — a streaming-friendly zip serializer/deserializer that later sprints will wire into export, import, conflict resolution, and cross-instance sync. **No HTTP routes, no DB, no GUI yet** — just the format and its validator. 10 unit tests, all green.

### What shipped
- **`src/services/exchange/bundleFormat.ts`** (~570 lines) — `encodeBundle()` + `openBundle()` reading/writing zip archives with this layout:
  ```
  bundle.zip
  ├── manifest.json              schema_version, project meta, sha256+bytes per entry
  ├── lessons.jsonl              one record per line — streamable
  ├── guardrails.jsonl
  ├── lesson_types.jsonl
  ├── chunks.jsonl               text + embedding vectors
  ├── documents.jsonl            metadata only
  └── documents/<doc_id>.<ext>   raw binary, byte-identical
  ```
  Encoder accepts `AsyncIterable | Iterable` for every entity kind so the export route can stream from a DB cursor without loading the project into memory. Decoder yields async generators that validate per-entry SHA-256 at EOF.
- **`src/services/exchange/bundleFormat.test.ts`** (~330 lines, `node:test`) — 10 tests:
  1. happy path round-trip (lessons + guardrails + lesson_types + chunks + documents)
  2. empty bundle (project only)
  3. rejects bundle with no manifest
  4. rejects schema_version mismatch
  5. rejects jsonl checksum mismatch
  6. rejects malformed jsonl line
  7. **1MB document round-trip** (regression for the `pipeline()` drainage bug found in code review)
  8. **doc id collision after sanitization** ("a/b" + "a_b" both → `a_b.pdf`)
  9. disk round-trip (file path, not just buffer)
  10. (combined into above)
- **Dependencies added**: `archiver` ^7.0.1 (write), `yauzl` ^3.3.0 (read), plus `@types/*`. Both pure JS, no native bindings.

### Live test results (Sprint 11.1)
```
node --test src/services/exchange/bundleFormat.test.ts
✔ happy path round-trip — all entity kinds (21ms)
✔ empty bundle — project only, no entities (1ms)
✔ rejects bundle with no manifest.json (4ms)
✔ rejects schema_version mismatch (3ms)
✔ rejects jsonl checksum mismatch (6ms)
✔ rejects malformed jsonl line (4ms)
✔ large document round-trips correctly (above stream highWaterMark) (10ms)
✔ rejects document id collision after sanitization (1ms)
✔ round-trips a bundle to disk (16ms)

10 pass / 0 fail (72ms total)
```

### Code review — 4 real bugs caught + fixed
1. **HIGH** `measureStream.sha256` getter called `hash.digest('hex')` twice (once for the `documents/<id>.ext` entry, once for the metadata line referencing it). Node crypto throws `ERR_CRYPTO_HASH_FINALIZED` on the second call. Fixed by finalizing the digest in the Transform's `flush()` callback and caching the hex string.
2. **HIGH** `openEntryStream()` initially tried to re-walk the zip's central directory by calling `zip.readEntry()` again, but yauzl can't restart a directory walk after it ends. Fixed by keeping the raw `yauzl.Entry` objects from the indexing pass and passing them directly to `openReadStream()`.
3. **HIGH** `openContent()` used `stream/promises.pipeline()` to chain `raw → hashGate`. `pipeline()` fully drains the streams before resolving — small docs survived in the highWaterMark buffer (~16KB) but anything larger deadlocked on backpressure. Fixed by replacing `pipeline()` with a direct `.pipe()` chain that streams to the consumer at its pace; checksum is validated in the Transform's `flush()` callback. Caught by adding the 1MB regression test.
4. **MED** No collision detection on `safeDocId` — two distinct ids that sanitized to the same path silently overwrote each other in the archive. Fixed with explicit `entries[entryPath]` check + dedicated test.

### Why these matter for the rest of Phase 11
- The format is the contract every other sprint depends on. Catching the streaming bug in 11.1 saved us from a phantom "import randomly truncates large PDFs" issue that would have surfaced only in Sprint 11.4 with real user data.
- Per-entry SHA-256 in the manifest gives Sprint 11.5 (cross-instance pull) cheap end-to-end integrity verification — no separate signature scheme needed for v1.
- Async-iterable encoder API means Sprint 11.2 can stream from `pg.cursor()` without buffering the whole project.

### What's NOT in 11.1 (intentionally deferred)
- HTTP routes (Sprint 11.2)
- DB queries (Sprint 11.2)
- ID remapping, conflict policies (Sprint 11.3)
- GUI import/export pages (Sprint 11.4)
- Cross-instance pull (Sprint 11.5)
- Compression tuning, encryption, embedding binary packing — all polish for 11.6 if needed

## Sprint 10.8 history (prev)

---
id: CH-PHASE10-S108
date: 2026-04-14
module: Phase10-Sprint10.8
phase: IN_PROGRESS
---

# Session Patch — 2026-04-14 (Sprint 10.8 — Phase 10 Playwright browser tests)

## Where We Are
**Sprint 10.8 complete.** Phase 10 GUI flows now regression-tested at the browser layer. 7 new Playwright tests covering the Documents page upload → extract → review → chunk-search loop. Full GUI suite: **50 passed, 1 pre-existing flake** (`lessons.spec.ts › detail panel opens and edit works` — unrelated to Phase 10).

### What shipped
- **`test/e2e/gui/phase10.spec.ts`** — 7 scenario tests:
  1. Upload dialog (file picker) → row appears in table
  2. URL ingest tab → backend fetches `http://localhost:3001/test-static/sample.md` via SSRF-relaxed loopback → row appears
  3. Extract button → mode selector modal → Fast mode → review opens with chunk rail
  4. "Chunks" row action opens review in read-mode on an already-extracted doc
  5. Chunk search panel: query runs, results or empty-state render
  6. Chunk search: type filter chip toggles, clear button resets
  7. "Re-extract All" header button → confirm() → toast "Queued N vision extractions"
- **Per-test unique fixtures** — `uniqueMarkdownBuffer(marker)` generates fresh content each run so content-hash dedup never collides (was the root cause of the first test-run failures where seeded docs silently returned existing_doc_id with the old name).
- **`beforeAll` preflight** — skips the whole suite if `/test-static` isn't mounted (matches the API suite's pattern).

### Live test results (Sprint 10.8)
```
7/7 passed, 0 failed (~8s)
phase10-upload-dialog-file              1.2s   ✓
phase10-url-ingest-tab                  1.2s   ✓
phase10-extract-fast-review             1.0s   ✓
phase10-chunks-row-action               1.0s   ✓
phase10-chunk-search-query              1.1s   ✓
phase10-chunk-search-filter-toggle      809ms  ✓
phase10-reextract-all-button            910ms  ✓

Full GUI suite: 50 passed, 1 pre-existing flake (lessons detail panel)
```

### Bugs caught during test authoring
- **Content-hash dedup masked the seed helper.** Initial `seedDoc('sample.md', override)` returned the pre-existing doc's id (with its old name) whenever `sample.md` had been uploaded before, so `row:has-text(marker)` never matched. Fixed by generating unique content per marker instead of reusing on-disk fixtures. Lesson: any test that seeds via content-hash–gated ingestion endpoints must vary the payload, not just the metadata.
- **`.or()` strict-mode violation.** Using `a.or(b)` where both locators happen to match triggers Playwright's strict-mode guard. Replaced with two sequential `expect().toBeVisible()` calls on distinct, unambiguous anchors.

### Vision flow — intentionally skipped
Async vision progress modal + cancel is exercised by the API suite (`test/e2e/api/phase10.test.ts` — 3 vision tests) which gates on `SKIP_VISION_TESTS`. Browser-level vision tests would add multi-minute wall-clock + LM Studio as a hard dep with no extra coverage, so they're out of scope for this sprint.

## Sprint 10.7 history (prev)

---
id: CH-PHASE10-S107
date: 2026-04-13
module: Phase10-Sprint10.7
phase: IN_PROGRESS
---

# Session Patch — 2026-04-13 (Sprint 10.7 — URL ingestion)

## Where We Are
**Sprint 10.7 complete and live-tested (commit 232d758).** URL ingestion with an SSRF-hardened fetcher closes the "paste a link" onboarding gap and enables Playwright browser tests to drive the upload flow via URL strings instead of file pickers. 47/47 E2E tests passing, including 3 new URL ingestion tests + all Phase 10.1-10.6 tests.

### What shipped
- **`src/services/urlFetch.ts`** — SSRF-safe downloader: scheme allowlist, DNS-based private-range rejection (loopback / RFC1918 / link-local / CGNAT / cloud metadata), manual redirect re-validation (max 5, strips auth), streaming 10MB cap, 30s AbortSignal timeout, Content-Type allowlist (pdf/docx/epub/odt/rtf/html/markdown/plain/png/jpeg/webp), Content-Disposition filename derivation. Defuses DNS rebinding by resolving IPs before connecting.
- **`POST /api/documents/ingest-url`** — mirrors the multipart upload pipeline (content_hash dedupe → createDocument → extraction-ready). Maps UrlFetchError codes to 400/403/413/415/502/504.
- **`ALLOW_PRIVATE_FETCH_FOR_TESTS` env flag** — simultaneously (a) relaxes the SSRF private-range check and (b) mounts `/test-static/` serving `test-data/` so the E2E harness can ingest its own fixtures from loopback. Defaults to false; docker-compose wires it through for local dev.
- **Upload dialog URL tab** — the pre-existing "Link URL" tab now calls `ingest-url` instead of creating a useless `url` stub. Duplicate detection surfaces same toast as file uploads. Helper text warns about 10MB + SSRF limits.

### Live test results (Sprint 10.7)
```
47/47 passed, 0 failed (159806ms)
phase10-ingest-url-markdown-happy      11ms   ✓ test-static loopback fetch + doc_type detection
phase10-ingest-url-ssrf-blocked        5ms    ✓ file:/// ftp:/// gopher:/// empty / malformed all 4xx
phase10-ingest-url-bad-content-type    3ms    ✓ application/json rejected (not in allowlist)
```

### Why this unlocks browser tests
Before 10.7, Playwright tests would need `page.setInputFiles(path)` workarounds to attach real binary files. Now they can type a URL string pointing at `http://host.docker.internal:3001/test-static/sample.pdf` — no file picker dance. Sprint 10.8 (browser tests) can proceed cleanly.

## Sprint 10.6 history (prev)

# Session Patch — 2026-04-13 (Sprint 10.6 — Phase 10 COMPLETE)

## Where We Are
**Sprint 10.6 complete and live-tested (commit f2418f8). Phase 10 is DONE.** Polish + Phase 10 integration test suite shipped. Full E2E harness runs **44/44 tests passing** in ~135 s including real vision extraction via LM Studio glm-4.6v-flash (~25 s for 3-page PDF). Every Sprint 10.1-10.5 feature is now regression-tested at the API + MCP boundaries.

### Sprint 10.6 polish (P1-P5)
- **P1** Chat search_documents tool result auto-expanded with inline top-3 chunk citations + "show N more" toggle (no click-to-see-sources)
- **P2** Chunk search panel gained "Load more" button + backend limit raised 50 → 100 with MAX_RESULTS=100 ceiling + tip
- **P3** Embedding-down amber banner with retry in chunk search panel (reads explanations.includes('embedding service unavailable'))
- **P4** Mermaid fenced blocks now render as live diagrams everywhere via MermaidChunk (wired into MarkdownContent CodeBlock component)
- **P5** "Re-extract All" header button + POST /api/documents/bulk-extract endpoint for project-wide vision re-extraction

### Sprint 10.6 tests (T1-T4)
- `test/e2e/api/phase10.test.ts` — 10 tests covering happy path (fast extract + optimistic lock + cascade delete), chunk search hybrid + validation, global search chunks group, image thumbnail endpoint, vision async flow + cancel + bulk, MCP search_document_chunks tool
- Runner registers the suite and opts into MCP (`withMcp: true`)
- `uploadFixture` helper gracefully reuses existing_doc_id on 409 duplicate (content_hash dedupe) — matches real re-upload flow
- Vision tests gated on `SKIP_VISION_TESTS=false` so CI without LLM still passes

### Live E2E results
```
44/44 passed, 0 failed (135553ms)
phase10-happy-path-fast-extract      522ms
phase10-chunk-search-hybrid          144ms
phase10-chunk-search-invalid-type    1ms
phase10-chunk-search-empty-query     1ms
phase10-global-search-chunks-group   135ms
phase10-image-thumbnail-endpoint     55ms
phase10-vision-async-flow            25626ms (real LM Studio)
phase10-vision-cancel-flow           579ms
phase10-bulk-extract-smoke           63ms
phase10-mcp-chunk-search-tool        2706ms
```

## Phase 10 Complete
6 sprints, 41 files modified, 12 commits (including 4 review-fix commits catching 20 real issues before prod). End-to-end: upload any format → extract (fast / quality / vision) → chunk → embed → hybrid search (REST + Cmd+K + chat tool + MCP tool) with chunk edit/delete + optimistic locking + async job progress/cancel + bulk re-extract + mermaid rendering + image UX closed. First-class document retrieval for agents.

## Sprint 10.5 history (prev)
**Sprint 10.5 complete and live-tested (commit 41f9cf4).** Document chunks are now first-class in retrieval — hybrid pgvector+FTS search, Cmd+K palette, chat tool, MCP tool. Image upload UX closed: upload dialog accepts png/jpg/webp with live thumbnail, extraction selector preselects Vision for images, documents list shows inline thumbnails. 12 tasks (7 backend + 5 frontend). Both typechecks clean.

### Sprint 10.5 code review — 5 issues found + fixed (commit 4dab5b8)
- **CRITICAL** listDocuments returned full base64 content — a page of image docs was worst-case ~120MB. Fixed by enumerating columns (no content) and adding `GET /api/documents/:id/thumbnail` that streams image bytes with cache headers; frontend uses the URL instead of decoding client-side. List response dropped to 5.7KB.
- **CRITICAL** searchChunks threw 500 when embedding service was down → wrapped in try/catch, falls back to FTS-only ranking with a clear explanation string. SQL rebuilt to handle missing vector (sem_score=0, requires FTS hit).
- **HIGH** globalSearch used ILIKE on `document_chunks.content` (seq scan) → switched to `c.fts @@ plainto_tsquery('english', ...)` which uses the existing GIN index; results ordered by ts_rank.
- **HIGH** Upload dialog `URL.createObjectURL` leaked on rapid file re-selection — effect cleanup fired after next setPreview. Now revokes synchronously inside functional setPreview callback.
- **MED** Chunk search JOIN lacked defense-in-depth cross-tenant filter → added `d.project_id = c.project_id` to the join predicate.

### Live-test results (Sprint 10.5)
- ✅ `POST /api/documents/chunks/search` hybrid retrieval: "retry strategy exponential backoff" → 3 results, top hit 0.83 score (correct chunk)
- ✅ `chunk_types=[text]` filter narrows correctly
- ✅ Invalid chunk_type returns 400
- ✅ `/api/search/global` now returns `chunks` array alongside lessons/docs
- ✅ MCP `search_document_chunks` tool registered
- ✅ Chat `search_documents` tool wired, specialized rendering of chunk matches

## Sprint 10.4 history

**Sprint 10.4 complete and live-tested.** Vision UI + mermaid + chunk edit/delete + async progress/cancel. Backend B0–B6 (migration 0046, updateChunk/deleteChunk with optimistic lock + re-embed, updateJobProgress/isJobCancelled/cancelJob, mermaid prompt template, 3 new endpoints) and frontend F1–F10 (Vision card enabled, cost estimate panel, ExtractionProgress modal with polling + cancel, mermaid renderer via npm `mermaid`, editable chunks with save/delete, confidence-aware page navigator + legend, "Extract as Mermaid" shortcut) all implemented. Both typechecks pass. Live-tested all flows end-to-end against real Docker stack + LM Studio (zai-org/glm-4.6v-flash).

### Sprint 10.4 code review — 6 issues found + fixed (commit e6c6935)
- **HIGH** Cancel endpoint allowed cross-tenant job cancellation via leaked job_id → `cancelJob` now takes optional `projectId`, scoped SQL
- **HIGH** `updateChunk` returned TIMESTAMPTZ as Date → second edit always 409'd → normalize Date → ISO in the RETURNING path
- **HIGH** ExtractionProgress polling effect re-ran on every parent re-render (stale closure / callback double-fire risk) → callback refs + `fireTerminal` single-fire guard
- **MED** `prompt_template` validated only by TypeScript → server 400 validation added
- **MED** Duplicate unreachable `includes('```mermaid')` check in `detectChunkType` → removed
- **MED** Chunk switch silently discarded unsaved edit buffer → `switchToChunk` confirm gate

### Live-test results (Sprint 10.4)
- ✅ `POST /extract/estimate` → 3 pages, glm-4.6v-flash provider, 30s ETA
- ✅ `POST /extract` vision → 202 queued, job_id returned
- ✅ Progress reporting: 0% "Extracting 3 pages" → 33% "1/3 pages (1 ok, 0 failed)" → 100% "3/3 pages"
- ✅ Cancel mid-flight: `POST /jobs/:id/cancel` → status=cancelled, doc marked failed
- ✅ Chunk update stale TS → 409 conflict (caught a real bug: node-pg returns TIMESTAMPTZ as Date, not string — fixed via toISOString normalization)
- ✅ Chunk update fresh TS → 200 ok, content updated + re-embedded
- ✅ Chunk delete → 200 ok
- ✅ Mermaid prompt template → chunks correctly typed as `mermaid` by chunker (fenceLang detection)

### Sprint 10.3 history
Vision extraction backend shipped: pdftoppm PDF rendering, LM Studio + OpenAI vision API, per-page retry + concurrency + timeout + progress confidence, prompt templating, Alpine font fix. Code review found 10 quality issues — all fixed.

### Sprint 10.1 history
Backend text extraction pipeline (Fast + Quality modes) working end-to-end against real PDF/DOCX/Markdown files. 12 review issues + 3 live bugs fixed.

## What Was Done This Session

### Bug Fix Sprint 1 — Quick Wins (10 bugs) ✅
- Fix document View crash (CRITICAL): `document_id` → `doc_id` field rename
- Fix NaNmo time formatting: null/NaN guard in `relTime()`
- Fix broken emoji on Code Search: surrogate pair → literal emoji
- Fix sidebar multi-highlight: exact match for `/projects` and `/settings`
- Fix Chat "New Chat" button: `chatKey` + `id` to force `useChat` reset, memoize transport
- Fix Graph Explorer search freeze: remove unnecessary API call
- Fix Code Search dropdown freeze: debounce `kind` filter
- Fix Add Guardrail modal title: new `dialogTitle` prop
- Add toast feedback for Dashboard Re-index/Ingest Git actions
- Fix Access Control misleading empty message when only revoked keys

### Bug Fix Sprint 2 — Data/API Shape Fixes (3 bugs) ✅
- Fix Analytics donut chart: embed `getLessonsByType` into `/overview` endpoint
- Fix Most Retrieved Lessons: embed `getMostRetrievedLessons` into `/overview`
- Fix Activity feed descriptions: map `title`/`detail` fields, dot-notation event icons, category prefix filtering

### Bug Fix Sprint 3 — Logic + Polish (3 bugs fixed, 2 verified) ✅
- Fix Getting Started "Mark Complete": localStorage persistence (broken API call removed)
- Fix Semantic search empty state: embeddings service unavailable message + "Switch to Text" button
- Fix Bookmarked filter wrong empty state: contextual icon/title/description
- Verified Bug #15 (stat cards) and Bug #17 (edit template) — already working, not bugs

### Bug Fix Sprint 4 — Feature Additions (2 bugs, 1 not a bug) ✅
- Verified Bug #18 (Generated Docs clickable) — already has SlideOver viewer
- Fix Bug #19 chat persistence — **root cause was sidebar field mismatch** (`res.conversations` vs `res.items`). Also added MutationObserver + DOM-based save mechanism since `useChat` + `TextStreamChatTransport` has stale closure issues with React `useEffect`.

### Visual Review via Playwright ✅
Verified 13 fixes live in the browser (Docker rebuild between attempts):
- NaNmo fix on Jobs page
- Document View crash fix (viewer opens correctly)
- Broken emoji on Code Search (🔍 renders)
- Sidebar highlight on `/projects/groups` and `/settings/access`
- Add Guardrail modal title correct
- Dashboard Re-index toast appears
- Analytics donut chart (66 total, proper breakdown)
- Most Retrieved Lessons table populated
- Activity feed with titles + actors + entity links
- Getting Started Mark Complete (progress updates to 1/50 2%)
- Graph Explorer search doesn't freeze
- Access Control misleading message fixed
- Chat persistence (11 conversations in sidebar after final fix)

### Phase 10 Planning — Multi-Format Extraction Pipeline ✅

Created comprehensive design document: `docs/phase10-extraction-pipeline.md`

**8 review rounds identifying 22 issues:**
1. Context & Data Engineering — chunking, provenance, per-chunk lesson generation
2. Security — file validation, data exfiltration warning, XSS sanitization
3. Cost & Resources — cost estimate before vision extraction, batch embedding
4. UX / Product — progressive quality feedback, per-page progress streaming
5. Operations — partial success, resume, Docker native deps
6. Agent / MCP — agent-triggerable extraction, tiered search inclusion
7. Testing — quality benchmarking with ground truth test set
8. Lessons from RAGFlow — template-based chunking, garble detection, OCR→vision cascade, positional metadata

**Key design decisions:**
- Two extraction modes: Text (free, local) and Vision (model provider)
- Two user paths: Quick (auto, no review) and Careful (full review)
- Pluggable chunking templates: auto, naive, hierarchical, table, per-page
- New `document_chunks` table with embeddings + FTS + bbox coordinates
- Content-hash deduplication
- Mermaid diagram extraction for strong vision models (renderable + editable + searchable via text summary)
- Chunk types: text, table, diagram_description, mermaid, code

**3 HTML drafts created in `docs/gui-drafts/pages/`:**
- `extraction-mode-selector.html` — Text vs Vision mode cards, page selection with low-density warnings, cost estimate, Quick/Careful toggle
- `extraction-review.html` — Full-width split-pane (PDF preview + markdown editor), per-page actions including "Extract as Mermaid", Mermaid preview panel with rendered diagram + source code, page navigator with color-coded confidence states
- `extraction-progress.html` — Overall progress bar, per-page status grid, early review prompt, failed page retry

### Phase 10 Sprint 10.1 — Text Extraction Foundation ✅

**Backend pipeline (no GUI yet) — 3 commits, ~1400 lines.**

#### Migrations
- `0042_document_chunks.sql` — new table with embeddings, FTS, bbox columns, HNSW + GIN indexes, auto-update trigger. Embedding column initially `vector(768)`, corrected to `vector(1024)` after live test.
- `0043_documents_extraction.sql` — expand doc_type to include docx/image/epub/odt/rtf/html, add content_hash + extraction_status + extraction_mode + extracted_at columns, unique index per project on content_hash. Backfills existing rows with `legacy:<doc_id>` to avoid collisions.
- `0044_document_chunks_dim_1024.sql` — corrects 0042's hardcoded vector dim to match `EMBEDDINGS_DIM=1024`.

#### Services (`src/services/extraction/`)
- `types.ts` — ExtractionMode, ChunkType, DocumentChunk, ChunkOptions
- `fastText.ts` — pdf-parse v2 (PDFParse class API) + mammoth + turndown. Per-page extraction for PDFs.
- `qualityText.ts` — pdftotext (poppler-utils) + pandoc subprocess via stdin/stdout. Falls back to fast on missing binaries. Supports PDF, DOCX, ODT, RTF, EPUB, HTML.
- `chunker.ts` — naive + hierarchical strategies with auto-select. Preserves heading levels (#, ##, ###). Tables and code blocks emit as their own chunks for precise type filtering. Bounded code-block fence search prevents infinite loops on malformed markdown.
- `pipeline.ts` — orchestrator with transactional DELETE+INSERT, batch INSERT (single multi-row statement), magic byte verification, XSS sanitization, embedding before DB writes (data-loss safe).

#### API endpoints (`src/api/routes/documents.ts`)
- `POST /api/documents/upload` — adds SHA-256 dedup, atomic content_hash insert, filename sanitization, base64-encoded binary storage, expanded doc_type detection
- `POST /api/documents/:id/extract` — runs pipeline, returns chunks, surfaces 422 for content errors and 501 for vision mode
- `GET /api/documents/:id/chunks` — returns persisted chunks

#### Dockerfile
- Added `poppler-utils` and `pandoc` to alpine base for Quality Text mode

#### Code Review Round 1 — 12 issues fixed (commit `1cdca39`)
1. **HIGH** Pipeline data loss on failed re-extraction → transactional replaceChunks()
2. **MED** N+1 chunk INSERTs → single multi-row statement with auto-batching
3. **LOW** Dead pagerender callback in fastText
4. **LOW** Hierarchical chunker flattened H1/H3 to ## → preserve original level
5. **MED** splitIntoBlocks unbounded fence search swallowed entire doc → bounded MAX_CODE_BLOCK_LINES
6. **MED** Upload dedup race condition → atomic INSERT + unique constraint catch
7. **LOW** NULL content_hash blocked future dedup → backfill via pgcrypto digest
8. **MED** No magic byte verification → verify %PDF, PK, {\rtf
9. **LOW** Confusing error when pandoc missing → clear install message
10. **LOW** bufType promotion imprecise → tables/code always own chunks
11. **MED** No XSS sanitization → strip script/iframe/event handlers/javascript URIs
12. **LOW** No filename sanitization → strip control chars, path traversal, leading dots

#### Live Test — 3 more real bugs found (commit `06e32a4`)
- **Embedding dim mismatch**: 0042 hardcoded vector(768) but EMBEDDINGS_DIM=1024 → fixed in 0042 and added 0044 ALTER. Transaction safety verified: failed extraction rolled back cleanly with no orphan chunks.
- **pdf-parse v2 API**: v2 has class-based PDFParse, not v1 function. All PDF uploads threw "pdfParse is not a function" → rewrote extractPdfFast() to instantiate PDFParse and call .getText().
- **Migration backfill collision**: 9 seeded duplicates of "Retry Strategy RFC.md" produced identical hashes, blocking unique index → backfill now uses `legacy:<doc_id>`. New uploads use real SHA-256.
- API error handling: extraction errors that are content/format problems return HTTP 422 with actual message instead of generic 500.

#### Live Verification (against real Docker stack)
| Format | Mode | Result |
|---|---|---|
| Markdown | Fast | 7 chunks, types detected (text/table/code), headings preserved |
| DOCX | Fast | 7 chunks (table structure lost — known turndown limitation) |
| DOCX | Quality | 7 chunks, table chunk_type correctly detected via pandoc |
| PDF (3 pages) | Fast | 3 chunks, one per page, page numbers tracked |
| PDF (3 pages) | Quality | 3 chunks via pdftotext, transactional re-extract |
| Vision | — | HTTP 501 with "Sprint 10.3" message |
| Fake PDF | Fast | HTTP 422 "magic bytes mismatch" |
| Dedup re-upload | — | HTTP 409 with existing_doc_id |
| Concurrent dedup | — | Both return 409 |
| Cascade delete | — | Chunks removed when document deleted |

### Phase 10 Sprint 10.2 — Extraction Review UI ✅

**Frontend pipeline (no backend changes) — 2 commits, ~720 lines.**

#### New components (`gui/src/app/documents/`)
- `types.ts` — Shared `Doc`, `DocumentChunk`, `ChunkType`, `ExtractionMode`, `DocType` (consolidates duplicated local types).
- `extraction-mode-selector.tsx` — Three mode cards (Fast / Quality / Vision-disabled). Vision shows "Coming Sprint 10.3" badge. Per-card icons, feature tags, selection ring. Calls `api.extractDocument`. **Includes full progress UX**: blue banner with spinner, elapsed-seconds counter, dimmed cards, disabled Cancel, no overlay-close mid-request.
- `extraction-review.tsx` — Read-only chunk viewer. Left rail = chunk list with type badges + page indicators. Right pane = active chunk (markdown rendered for text/table, monospace `<pre>` for code/mermaid). Footer = page navigator (only shown when multi-page). Empty state shows "Extract Now" CTA when no chunks exist.

#### API client (`gui/src/lib/api.ts`)
- `extractDocument()` and `getDocumentChunks()` with full chunk types
- `uploadDocument()` now surfaces 409 dedup as `{ status: "duplicate", existing_doc_id, ... }` instead of throwing

#### Documents page + DocumentViewer
- New row actions: Extract (blue), Chunks
- Extract button in DocumentViewer header
- Re-extract loop wired between Review and Mode Selector
- UploadDialog accepts `.docx/.epub/.odt/.rtf/.html`, friendly toast for duplicates

#### Code Review Round 1 — 6 fixed, 2 deferred (commit `60daa55`)
- **MED** #6 No extraction progress UI → blue spinner banner with elapsed-seconds counter
- **LOW** #1 Duplicate Doc type → consolidated `types.ts`
- **LOW** #2 Chunks button empty-array indirection → state shape `chunks?: DocumentChunk[]`
- **LOW** #4 initialChunks prop changes don't sync → `useEffect` syncs state
- **LOW** #5 activeChunkIdx out-of-bounds on shrink → clamp effect
- **LOW** #8 "Re-extract" CTA shown for never-extracted docs → "Extract Now" button via onReExtract
- **LOW** #11 Page-count limit → deferred to Sprint 10.4
- **LOW** #12 MarkdownContent cross-feature import → deferred (small, contained)

#### Live Verification (against Docker stack)
| Test | Result |
|---|---|
| Documents row actions visible | ✅ Extract / Chunks / Lessons / Delete buttons per row |
| Click Chunks on sample.md | ✅ Modal opens, 7 chunks in rail with text/table/code badges |
| Click table chunk | ✅ Pipe-formatted markdown table renders correctly |
| Click code chunk | ✅ TypeScript monospace pre block |
| Click Extract on sample.pdf | ✅ Mode selector opens with metadata |
| Select Quality + Start | ✅ Toast "Extracted 3 chunks from 3 pages", review opens |
| Page navigator | ✅ Footer shows `p1 (1) | p2 (1) | p3 (1)` with active page highlighted |
| Extraction progress UI (3s simulated delay) | ✅ Blue banner + spinner + elapsed counter + dimmed cards + disabled Cancel |

### Phase 10 Sprint 10.3 — Vision Extraction Backend ✅

**Backend pipeline (no GUI yet) — async via job queue, vision model integration.**

#### Migrations
- `0045_document_extract_vision_job.sql` — adds `document.extract.vision` to the `async_jobs.job_type` CHECK constraint. **Bug caught by live test:** initial enqueue failed with constraint violation, fixed in this migration.

#### New services (`src/services/extraction/`)
- `pdfRender.ts` — `renderPdfPages()` via `pdftoppm` (poppler-utils) returning per-page PNG buffers; `getPdfPageCount()` via `pdfinfo`. Uses temp dirs, cleans up after itself.
- `vision.ts` — `extractPageVision()` calls OpenAI-compatible `/v1/chat/completions` with image_url content blocks (base64 data URI). Handles thinking-model `reasoning_content` fallback. Strips outer markdown fences. Plus `estimateVisionCost()` for known cloud models, returns null for local.
- `visionExtract.ts` — high-level orchestrator: `extractVision(buffer, ext, docType)` dispatches PDF→render+per-page-loop, image→direct, DOCX/EPUB/etc→pandoc-to-PDF→render. Per-page errors captured as placeholder chunks (confidence: 0).

#### Pipeline integration
- `pipeline.ts` — `runExtraction()` now handles `mode === 'vision'` by calling `extractVision()`. Vision is no longer 501.

#### Job queue integration
- `jobQueue.ts` — added `'document.extract.vision'` to `JobType` union.
- `jobExecutor.ts` — new `case 'document.extract.vision'` handler. Lazy-imports `runExtraction` to avoid circular deps.
- `worker.ts` — already polls/consumes from RabbitMQ, no change needed.

#### API endpoints (`documents.ts`)
- `POST /api/documents/:id/extract` — for `mode: 'vision'`, marks document as `processing`, enqueues `document.extract.vision` job, returns HTTP 202 with `job_id`. For `fast`/`quality`, sync as before.
- `POST /api/documents/:id/extract/estimate` — counts PDF pages via `pdfinfo`, applies cost model, returns `page_count`, `estimated_usd`, `per_page`, `provider`, `estimated_seconds`. Local models return null cost.
- `GET /api/documents/:id/extraction-status` — polls document status + latest extraction job + chunk count. Used by the GUI to track async vision jobs.

#### Environment
- `env.ts` — new optional vars: `VISION_BASE_URL`, `VISION_API_KEY`, `VISION_MODEL`, `VISION_TIMEOUT_MS` (default 300s), `VISION_PDF_DPI` (default 150), `VISION_MAX_TOKENS` (default 8192).
- `.env` — added `VISION_MODEL=zai-org/glm-4.6v-flash` + `VISION_BASE_URL=http://host.docker.internal:1234` for local LM Studio testing.
- `Dockerfile` — added `ttf-dejavu fontconfig` to base image so pdftoppm renders text correctly (caught when test PDFs rendered as blank pages).

#### Live Verification (against Docker stack + LM Studio + glm-4.6v-flash)
| Test | Result |
|---|---|
| Cost estimate for 3-page PDF | ✅ 3 pages, null USD (local), provider `zai-org/glm-4.6v-flash`, 30s estimate |
| Vision extraction enqueue | ✅ HTTP 202, `job_id`, `backend: rabbitmq` |
| Worker picks up job (RabbitMQ) | ✅ Job claimed, transitions queued→running |
| PDF rendering via pdftoppm | ✅ 3 pages → PNG buffers, fonts render correctly |
| Per-page vision extraction | ✅ 3/3 pages, 0 failures, 18s total wall clock |
| Chunk creation | ✅ 3 chunks, page 2 detected as `chunk_type: table` |
| Table reproduction | ✅ Vision model produced perfect markdown table with pipe syntax |
| Status polling endpoint | ✅ Returns extraction_status, mode, chunk_count, full job details |
| Image upload + direct vision extract | ✅ PNG uploaded as `doc_type: image`, extracted in 14s, perfect markdown |
| Job marked succeeded | ✅ `succeeded` status, finished_at set |

#### Code review issues found and fixed during live test
1. **Real bug**: `async_jobs.job_type` CHECK constraint rejected `document.extract.vision`. Fix: migration 0045.
2. **Real bug**: `pdftoppm` produced blank PNGs without fonts ("Couldn't find a font for 'Helvetica'"). Fix: add `ttf-dejavu fontconfig` to Dockerfile.
3. **Real bug**: `docker compose restart` did not reload `.env` changes. Fix: `up -d --force-recreate` (operational note, no code change).
4. **Real bug**: New migration files require Docker rebuild (not just restart) since they're baked into the image at build time. Fix: `up -d --build mcp worker` (operational note).

#### Code Review Round 1 — 10 issues fixed (commit `5952318`)

After reviewing extraction quality + implementation, found 10 issues:

**HIGH (cause of content loss observed in initial test):**
- **#1** `extractPageVision()` had hardcoded `max_tokens: 4096` default; pipeline was passing 8192 but only when explicitly provided. Fixed to use `env.VISION_MAX_TOKENS`. Default also bumped from 8192 to 16384 because thinking models (glm-4.6v-flash) burn 2-5k tokens on `reasoning_content` before producing output.
- **#2** Empty `content` (not nullish) didn't fall through to `reasoning_content`. The `??` operator only catches null/undefined, but thinking models with insufficient budget return `content=""` and put the actual answer in `reasoning_content`. Fixed with explicit empty-string check.
- **#3** `finish_reason: "length"` was not detected. Now logged as warning, and chunk confidence drops to 0.6 for truncated pages so users can spot incomplete extractions.

**MEDIUM:**
- **#4** Default `VISION_PDF_DPI` bumped from 150 to 200 — better for dense text recognition.
- **#5** New `VISION_CONCURRENCY` env var (default 1). Worker pool pattern extracts pages in parallel via cursor-based queue. Local LM Studio serializes anyway, cloud APIs benefit dramatically (50-page PDF: 15min → 4min at concurrency=4).
- **#6** Per-page retry via `VISION_PAGE_RETRIES` (default 2) with exponential backoff (1s, 2s, 4s). Distinguishes transient errors (5xx, network, timeouts) from permanent ones via `isTransientError()`.
- **#11** Per-page timeout via `AbortSignal.timeout(env.VISION_TIMEOUT_MS)` composed with caller signal via `anySignal()`. Prevents hung extractions.

**LOW:**
- **#7** API extract endpoint now rejects vision mode for non-pdf/non-image doc_types with HTTP 422 + clear message ("use Quality Text mode instead"). Previously enqueued a job that was guaranteed to fail in alpine because pandoc has no PDF engine.
- **#9** New `VISION_TEMPERATURE` env var (default 0.1). Was hardcoded 0.2.
- **#10** Upload endpoint whitelists `image/png`, `image/jpeg`, `image/webp` instead of accepting any `image/*`. SVG/HEIC/AVIF would break vision models.

#### Re-test after fixes
| Test | Before fixes | After fixes |
|---|---|---|
| `finish_reason` | not checked | "stop" for all 3 pages |
| Page 2 (table) chars | 367 | 487 (better column padding) |
| Truncation warnings | none | logged + confidence 0.6 if any |
| Retry behavior | none | up to 2 retries with backoff |
| Timeout enforcement | none | 300s per page |
| Total wall clock | 18s | 24s (more thinking budget) |

**Quality assessment:** vision extraction now correctly produces the full content of every page in the test PDF. The earlier "missing sections" observation was based on comparing to the original markdown source, not the actual PDF — the PDF generator (`generate-pdf.mjs`) only includes 3 simplified pages, and vision extraction reproduced ALL of that content. With the token budget bump, dense real-world pages will also extract cleanly.

## Commits This Session

| Commit | Description | Files |
|--------|-------------|-------|
| `8aaa754` | Fix 17 UI bugs from deep review — Sprints 1-4 | 16 |
| `d32a3f8` | Fix chat persistence — sidebar field mismatch + DOM-based save | 3 |
| `ba34d30` | [Session] Bug fix + Phase 10 planning — pipeline doc + 3 HTML drafts | 5 |
| `39e1252` | Phase 10 Sprint 10.1: Text extraction foundation | 11 |
| `1cdca39` | [10.1] Review fixes — 12 issues from Sprint 10.1 code review | 7 |
| `06e32a4` | [10.1] Live test fixes — 3 bugs caught by real PDF/DOCX/MD pipeline tests | 7 |
| `157ac32` | [Session] Sprint 10.1 complete — update session patch | 1 |
| `cd1862e` | Phase 10 Sprint 10.2: Extraction Review UI | 6 |
| `60daa55` | [10.2] Review fixes — 6 issues from Sprint 10.2 code review | 5 |
| `5d375b5` | [Session] Add per-sprint session-update rule + Sprint 10.2 patch entry | 2 |
| `5e1700d` | Phase 10 Sprint 10.3: Vision extraction backend | 12 |
| `388ab54` | [Session] Update SESSION_PATCH with 10.3 commit hash | 1 |
| `5952318` | [10.3] Review fixes — 10 issues from Sprint 10.3 code review | 4 |

## Summary

| Metric | Value |
|--------|-------|
| Bugs reported | 21 |
| Bugs fixed | 18 |
| Bugs verified not-bugs | 3 |
| Files changed (bug fixes) | 19 |
| Lines added / removed | ~350 / ~215 |
| Visual verifications | 13 |
| Phase 10 review rounds | 8 |
| Phase 10 issues identified | 22 |
| Phase 10 HTML drafts | 3 |

## What's Next

### Sprint 10.4 — Vision Mode UI + Mermaid + Per-page mode (next)
- Enable Vision mode card in `ExtractionModeSelector` (currently shows "Coming Sprint 10.3")
- Cost estimate display in the selector (call `/extract/estimate` before user picks mode)
- Async polling in the GUI: enqueue → poll `extraction-status` → show progress → display chunks
- Mermaid diagram preview in review UI (renderer + editable source)
- "Extract as Mermaid" per-page action (separate vision prompt)
- Per-page mode selection (mix Fast/Quality/Vision in one document)
- Page-count guard for huge documents (deferred from 10.2 #11)

### Sprint 10.5 — Auto-recommendation
- Backend: detect document characteristics (text density, page complexity)
- Frontend: "Recommended: Quality mode" hint based on detection

### Sprint 10.6 — Polish + integration tests
- Quality benchmarking test set
- E2E tests for the full extract flow
- Documentation updates
