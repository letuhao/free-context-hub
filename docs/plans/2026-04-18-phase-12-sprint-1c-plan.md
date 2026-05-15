---
phase: 12
sprint: 12.1c
title: Access-frequency salience — execution plan
status: ready
depends_on:
  - docs/specs/2026-04-18-phase-12-sprint-1c-spec.md
created: 2026-04-18
---

# Sprint 12.1c — Execution plan

**15 tasks across 4 commits. ~2-3 days of deliberate work.** Each task names exact file paths, intent, and a verify command. No placeholders. TDD where applicable.

## Prerequisite

Before BUILD: docker compose stack healthy, 179/179 baseline tests green.

---

## Commit 1 — Foundation: schema + salience service (read path) + env knobs

### T1 — `migrations/0047_lesson_access_log.sql` (NEW)
**Intent:** CREATE TABLE + 2 indexes + backfill INSERT from `guardrail_audit_logs`.
**Schema:** `(access_id uuid pk, lesson_id uuid fk, project_id text, accessed_at timestamptz, context text, weight real default 1.0, metadata jsonb)`.
**Indexes:** `(lesson_id, accessed_at desc)` + `(project_id, accessed_at desc)`.
**Backfill:** `INSERT INTO lesson_access_log (lesson_id, project_id, accessed_at, context, weight) SELECT lesson_id, project_id, created_at, 'audit-bootstrap', 1.0 FROM guardrail_audit_logs WHERE lesson_id IS NOT NULL`.
**Verify:** `SELECT count(*) FROM lesson_access_log GROUP BY context` returns ≥1 row with `context='audit-bootstrap'`.

### T2 — Apply migration to running dev DB
**Intent:** `npm run migrate` against docker-compose stack; verify backfill rows landed.
**Verify:** DB query shows ~228 `audit-bootstrap` rows (count matches `guardrail_audit_logs` with non-null lesson_id).

### T3 — `src/services/salience.ts` (NEW)
**Intent:** Pure-ish module with `computeSalience(pool, projectId, lessonIds, config)` + `SalienceConfig` type + `getSalienceConfig()` env reader.
**SQL:** the weighted-sum decay query from the spec. Normalize `weighted_score → salience` via `1 - exp(-weighted_score)`.
**Exports:** `computeSalience`, `SalienceConfig`, `getSalienceConfig`, `blendHybridScore(hybridScore, salience, alpha)` (pure).
**Verify:** `npx tsc --noEmit` clean.

### T4 — `src/services/salience.test.ts` (NEW)
**Intent:** Unit tests. Mock `pool.query` for the one SQL call; pure tests for `blendHybridScore`.
**Cases:**
- `blendHybridScore`: zero salience → unchanged score; max salience → `score × (1+α)`; negative score stays sane; clamp at 1.0.
- `getSalienceConfig`: defaults (α=0.10, halfLife=7), env overrides, invalid values fall back to defaults.
- `computeSalience` with mocked pool: 0 rows → empty map; 3 rows → map with 3 entries with salience∈[0,1]; verify weight factor is honored (single-row weight=0.5 halves the effective count).
**Verify:** `npx tsx --test src/services/salience.test.ts` all pass.

### T5 — `src/env.ts` — add three env knobs
**Intent:** Add `LESSONS_SALIENCE_DISABLED` (boolean, default false), `LESSONS_SALIENCE_ALPHA` (float, default 0.10, clamped [0, 1]), `LESSONS_SALIENCE_HALF_LIFE_DAYS` (int, default 7, min 1, max 365).
**Verify:** `npx tsc --noEmit` clean; `getEnv()` returns the defaults when unset.

**Commit 1 boundary:** `git add migrations/0047_lesson_access_log.sql src/services/salience.ts src/services/salience.test.ts src/env.ts package.json && git commit -m "Phase 12 Sprint 12.1c (T1-T5): lesson_access_log schema + salience read-path"`

Test count after commit 1: 179 + ~8 salience tests = ~187.

---

## Commit 2 — Write paths (three insertion points)

### T6 — `src/services/salience.ts` — add `logLessonAccess` helper
**Intent:** Export `logLessonAccess(pool, batch: AccessLogEntry[])` that does ONE batched INSERT. Fire-and-forget (caller uses `.catch()` to swallow errors + log at warn).
**Signature:** `logLessonAccess(pool: Pool, entries: Array<{ lesson_id, project_id, context, weight?, metadata? }>): Promise<void>`
**Verify:** unit test in salience.test.ts — mocked pool; batch of 3 rows produces one INSERT with a 3-row VALUES clause.

### T7 — `src/services/lessons.ts` — wire consideration-search logging
**Intent:** In `searchLessons` and `searchLessonsMulti`, after dedup and before the final return, call `logLessonAccess` with one entry per returned match: `{ lesson_id, project_id, context: 'consideration-search', weight: 1.0 / rank, metadata: { query: params.query } }` where `rank` is the 1-based position.
Guard by `!isSalienceDisabled()` (hoist existing pattern from dedup). Fire-and-forget — do NOT await. Log warn on error.
**Verify:** after running a search, DB shows new rows with `context='consideration-search'`.

### T8 — `src/mcp/index.ts` — wire consumption-reflect logging
**Intent:** In the `reflect` tool handler (around line 1682), after `searchLessons` returns and `retrieved.matches` is passed to `reflectOnTopic`, fire-and-forget `logLessonAccess` with `{ context: 'consumption-reflect', weight: 1.0 }` per lesson.
**Verify:** invoking `reflect` MCP tool inserts consumption-reflect rows.

### T9 — `src/api/routes/lessons.ts` — wire consumption-read logging
**Intent:** In the `GET /api/lessons/:id` handler, after the lesson is successfully fetched (200 response path), fire-and-forget `logLessonAccess` with `{ context: 'consumption-read', weight: 1.0 }`.
**Verify:** `curl /api/lessons/<uuid>?project_id=...` inserts one consumption-read row.

**Commit 2 boundary:** `git add src/services/salience.ts src/services/lessons.ts src/mcp/index.ts src/api/routes/lessons.ts && git commit -m "Phase 12 Sprint 12.1c (T6-T9): access-log write paths — consideration-search + consumption-reflect + consumption-read"`

Test count after commit 2: ~189 (+2 for logLessonAccess + batched-insert tests).

---

## Commit 3 — Read path integration: salience blended into ranking

### T10 — `src/services/lessons.ts` — integrate `computeSalience` into the ranking loop
**Intent:** In `searchLessons` (and Multi), after DB returns hybrid-scored rows + BEFORE rerank:
1. If `isSalienceDisabled()` → skip, log explanation `salience: disabled via env`.
2. Otherwise call `computeSalience(pool, pid, matches.map(m => m.lesson_id), config)` → Map<id, salience>.
3. Recompute `m.score = LEAST(1.0, oldScore × (1 + alpha × salienceOrZero))` for each match.
4. Re-sort `matches` by new score desc.
5. Log explanation: `salience: enabled (α=${alpha}, halfLife=${halfLife}d); ${nSalient}/${n} lessons had access history`.

Dedup and rerank still run AFTER this step — order preserved.
**Verify:** unit test in lessons.test.ts — mock pool + computeSalience; assert re-sort happens; assert env-disabled short-circuits.

### T11 — `src/services/lessons.test.ts` — salience integration tests
**Intent:** Extend the existing test file. Mock computeSalience + verify:
- With salience disabled → no reorder, explanation contains "disabled".
- With salience enabled + mocked map → reorder happens; explanation reports n/total.
- Alpha=0 → no effective change (regression guard).
**Verify:** `npx tsx --test src/services/lessons.test.ts` all pass.

### T12 — `src/mcp/index.ts` — update `search_lessons` tool description
**Intent:** Add paragraph noting that results are now salience-weighted; `LESSONS_SALIENCE_DISABLED` opt-out; α and halfLife knobs.
**Verify:** `grep "salience" src/mcp/index.ts` finds the new lines.

**Commit 3 boundary:** `git add src/services/lessons.ts src/services/lessons.test.ts src/mcp/index.ts && git commit -m "Phase 12 Sprint 12.1c (T10-T12): blend salience into ranking + integration tests"`

Test count after commit 3: ~193.

---

## Commit 4 — Measurement + documentation

### T13 — Rebuild docker + A/B baseline (--control protocol)
**Intent:**
1. Add `LESSONS_SALIENCE_DISABLED=true` to `.env`. Rebuild mcp container. Run `npm run qc:baseline -- --tag sprint-12.1c-control --surfaces lessons --samples 3 --control`.
2. Flip to `LESSONS_SALIENCE_DISABLED=false`. Rebuild. Run `npm run qc:baseline -- --tag sprint-12.1c-new --surfaces lessons --samples 3 --control`.
3. Diff via `npx tsx src/qc/diffBaselines.ts ... --out docs/qc/baselines/2026-04-18-sprint-12.1c.diff.md`.

Note samples=3 per the 12.1b /review-impl LOW-5 lesson (reduces p95 noise-floor).
**Verify:** diff .md exists; MRR/nDCG@10 deltas visible; `salience:` explanation appears in per-query per_query section of the new archive.

### T14 — Commit archives + diff
**Intent:** `git add docs/qc/baselines/2026-04-18-sprint-12.1c-*.{json,md} docs/qc/baselines/2026-04-18-sprint-12.1c.diff.md && git commit -m "Phase 12 Sprint 12.1c (T13-T14): A/B archives + diff"`. Remove `.env` A/B flag before final container rebuild.

### T15 — friction-classes update + session patch
**Intent:**
- Add new friction class `salience-bootstrap-bias`: the audit-log-only bootstrap means non-guardrail lessons start at salience=0. Document the expected bias; future sprints can backfill from additional sources.
- Update `downstream-behavior-coupling` with a 12.1c example (salience changes ranking in reflect tool input).
**Verify:** `grep "salience-bootstrap-bias" docs/qc/friction-classes.md` matches.

**Commit 4 boundary:** `git commit` bundles friction-classes update + session patch.

---

## Workflow phases to traverse

Per CLAUDE.md v2.2 for an L-sized sprint: no phase skips.
- CLARIFY ✅ (this spec)
- DESIGN ✅ (embedded in this spec)
- REVIEW-DESIGN — gate before BUILD
- PLAN ✅ (this doc)
- BUILD (15 tasks, 4 commits)
- VERIFY (unit tests + A/B verified post-T13)
- REVIEW-CODE (spec compliance + quality, 2-stage)
- QC (sanity-check A/B output)
- POST-REVIEW (human checkpoint; offer `/review-impl` given this is a production ranking change)
- SESSION (SESSION_PATCH.md entry)
- COMMIT (push)
- RETRO (durable lessons)

## Risks (lifted from spec, revalidated)

1. **Latency regression** — extra SQL query per search. Mitigation: if p95 regresses beyond noise floor, fold salience into the main hybrid query as a CTE.
2. **Write storm** — every search writes ~10 rows. Mitigation: fire-and-forget + TTL job (deferred). Monitor write rate post-deploy via `SELECT count(*) FROM lesson_access_log WHERE accessed_at > NOW() - INTERVAL '1 hour'`.
3. **Bootstrap bias** — non-guardrail lessons start at salience=0. Accept + document.
4. **Dedup interaction** — salience re-sort runs BEFORE dedup, so a salience-boosted cluster member ranks highest; dedup keeps the highest-ranked rep. Tested in T11.
5. **Env-flag proliferation** — 3 flags. Mitigation: umbrella flag `LESSONS_SALIENCE_DISABLED` kills entire subsystem; tuning knobs are optional.

## Execution mode

**Inline** (single-agent sequential). Tasks have clear commit boundaries. No subagent dispatch needed — shared state across tasks (salience module, env config, lessons service integration) makes parallel work more error-prone than sequential.

## Reclassification trigger

If T10 (blend integration) reveals that computeSalience adds >500ms to p95 latency (measured by the --control A/B in T13), reclassify to XL and introduce a CTE-based refactor as T10.5.
