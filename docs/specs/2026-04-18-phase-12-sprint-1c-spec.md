---
phase: 12
sprint: 12.1c
title: Access-frequency salience for lessons retrieval
status: draft
branch: phase-12-rag-quality
created: 2026-04-18
---

# Sprint 12.1c — Access-frequency salience (first biological-memory feature)

## Where This Sits in the Phase-12 Arc

The ChatGPT-transcript thesis that opened Phase 12 described three pillars of "biological memory" — frequency-based tiering, salience weighting, and sleep-mode consolidation. Sprints 12.0 through 12.1b built the *measurement substrate* and shipped *storage-side consolidation* (dedup on lessons + chunks). Sprint 12.1c starts the *retrieval-side salience* work — the first feature where retrieval ORDERING changes based on signals beyond semantic + FTS similarity.

Access-frequency is the foundational primitive. Everything later in the biological-memory arc — Redis hot-cache tiering (12.2a), salience decay (12.2b), sleep consolidation (12.2c) — needs access data. Shipping it here lays the data-collection substrate AND cashes in a first measurable signal.

## What This Sprint Ships

A complete access-frequency salience system for lessons retrieval:

1. **Write path** — every search-hit records an access-log entry.
2. **Read path** — retrieval queries compute a time-decayed access score per lesson and blend it into the final ranking score.
3. **Decay formula** — exponential decay with a tunable half-life; defaults to 7 days (short-term "hot" memory).
4. **Blend formula** — salience score multiplies existing hybrid (semantic + FTS) ranking; default blend weight α = 0.10 (a 10% boost at max).
5. **Env knobs** — `LESSONS_SALIENCE_DISABLED`, `LESSONS_SALIENCE_ALPHA`, `LESSONS_SALIENCE_HALF_LIFE_DAYS` for A/B + tuning.
6. **Bootstrap** — backfill initial access-log rows from `guardrail_audit_logs` so the first A/B has signal rather than a cold-start zero.

## CLARIFY decisions (to lock before DESIGN/PLAN)

Three scope questions the user should decide before we commit to design:

### Q1 — Schema shape ✅ LOCKED 2026-04-18: A (append-only `lesson_access_log`)

Per-event rows give us the Q2-E per-row `weight` AND per-event `accessed_at` needed by the decay formula. B loses both; C = A plus materialization, worth it only if read latency justifies it (not yet).

### Q2 — Write-path trigger: when does an access event get logged? ✅ LOCKED 2026-04-18

**DECISION: B' + E combo — consumption signals at full weight + search-consideration at rank-weighted partial weight.**

Rationale: biological memory consolidation strengthens on USE, not on mere consideration. Over-counting flat search-hits dilutes the salience signal. Server-side consumption signals we can observe today:

| Event | Context string | Weight | Source |
|---|---|---:|---|
| `reflect` MCP tool pipes lesson into LLM synthesis | `consumption-reflect` | 1.0 | `src/mcp/index.ts:1682` handler |
| `GET /api/lessons/:id` | `consumption-read` | 1.0 | `src/api/routes/lessons.ts` |
| Lesson appears in top-k of `searchLessons` at rank N | `consideration-search` | `1.0 / N` | `src/services/lessons.ts` (both paths) |
| Backfill from `guardrail_audit_logs` | `audit-bootstrap` | 1.0 | one-time migration |

Consumption events (reflect-usage, direct-read) are strong signal (weight=1.0). Search-consideration is weak signal (weight inversely proportional to rank — rank-1 counts full, rank-10 counts 0.1). The weighted SUM in the decay formula handles the blend naturally.

**Out of scope for 12.1c:** GUI telemetry (client-side click tracking on lesson cards / lesson-detail page) and chat-tool-citation detection (parsing agent replies for lesson_ids). Both are future-work items.

### Q3 — Bootstrap source ✅ LOCKED 2026-04-18: B (guardrail-audit-logs backfill)

Biologically coherent (audit-fire = flashbulb memory), uses existing data (228 rows), day-1 A/B has real signal. `context='audit-bootstrap'`, weight=1.0, `accessed_at = audit row's created_at`.

## Design

### Schema (assuming A + A + B locked)

Migration `042_lesson_access_log.sql`:
```sql
CREATE TABLE lesson_access_log (
  access_id   UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  lesson_id   UUID NOT NULL REFERENCES lessons(lesson_id) ON DELETE CASCADE,
  project_id  TEXT NOT NULL,
  accessed_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  -- Q2 decision: B' + E. Context values documented in spec §Q2.
  context     TEXT NOT NULL,
  -- Q2 decision: E — rank-weighted search-consideration gets < 1.0 weight;
  -- consumption events keep 1.0. Sum-weighted decay at read time.
  weight      REAL NOT NULL DEFAULT 1.0,
  metadata    JSONB
);
CREATE INDEX idx_lesson_access_lesson_time  ON lesson_access_log (lesson_id, accessed_at DESC);
CREATE INDEX idx_lesson_access_project_time ON lesson_access_log (project_id, accessed_at DESC);
```

Then a backfill INSERT from `guardrail_audit_logs` (Q3 decision: bootstrap):
```sql
INSERT INTO lesson_access_log (lesson_id, project_id, accessed_at, context, weight)
SELECT gal.lesson_id, gal.project_id, gal.created_at, 'audit-bootstrap', 1.0
FROM guardrail_audit_logs gal
WHERE gal.lesson_id IS NOT NULL;
```

### Write path (three insertion points per Q2-B' + E)

**1. Search consideration (weighted by rank)** — in `searchLessons` and `searchLessonsMulti`, after dedup and before the final return, fire-and-forget an INSERT of one row per item in the returned `matches`:
```ts
// rank is 1-based position in the final matches array
{ lesson_id, project_id, context: 'consideration-search', weight: 1.0 / rank }
```
Batched into one query. Wrapped in try/catch. Guarded by `!isSalienceDisabled()`.

**2. Reflect consumption** — in the reflect MCP tool handler (`src/mcp/index.ts:1682`), after `searchLessons` returns and the retrieved matches are passed to `reflectOnTopic`, fire-and-forget an INSERT of one row per retrieved lesson:
```ts
{ lesson_id, project_id, context: 'consumption-reflect', weight: 1.0 }
```

**3. Direct read** — in `GET /api/lessons/:id` handler (`src/api/routes/lessons.ts`), after the lesson is successfully fetched, fire-and-forget an INSERT:
```ts
{ lesson_id, project_id, context: 'consumption-read', weight: 1.0 }
```

All three wrap the INSERT in try/catch so write failures never break the request. Logged at WARN level on failure.

### Read path (src/services/salience.ts — NEW)
A pure-ish function that returns a `Map<lesson_id, salience_score>` for a given set of lesson_ids, project_id, and config:

```ts
export type SalienceConfig = {
  alpha: number;             // default 0.10 — max boost magnitude
  halfLifeDays: number;      // default 7 — time for access value to halve
};

export async function computeSalience(
  pool: Pool,
  projectId: string,
  lessonIds: string[],
  config: SalienceConfig,
): Promise<Map<string, number>>;
```

SQL (note the `weight` column factors in — Q2 E decision):
```sql
SELECT lesson_id,
       SUM(weight * EXP(-EXTRACT(EPOCH FROM (NOW() - accessed_at)) / 86400.0 / $halfLifeDays * LN(2)))
       AS weighted_score
FROM lesson_access_log
WHERE project_id = $projectId
  AND lesson_id = ANY($lessonIds)
  AND accessed_at > NOW() - INTERVAL '180 days'   -- hard window
GROUP BY lesson_id;
```

A single rank-1 consumption event today contributes `1.0 × exp(0) = 1.0`. A rank-10 consideration from yesterday contributes `0.1 × exp(-1 × ln(2) / 7) ≈ 0.089`. A 7-day-old consumption contributes `1.0 × 0.5 = 0.5`. Events compound additively.

Then normalize `weighted_score → salience ∈ [0, 1]` via `salience = 1 - exp(-weighted_score)` (sigmoid-like, caps at 1).

### Blend formula (src/services/lessons.ts ranking integration)
Compute salience for the top-N candidates (wider than returned limit — let's say 2× rerank budget), then:

```ts
const finalScore = hybridScore * (1 + alpha * salience);
```

Multiplicative so a zero-salience lesson keeps its hybrid score unchanged; a maxed-salience lesson gets `hybridScore × 1.10` (when α=0.10).

Re-sort `matches` by `finalScore` desc before rerank and dedup.

### Env knobs
- `LESSONS_SALIENCE_DISABLED=true` — disables both write and read entirely
- `LESSONS_SALIENCE_ALPHA=<float>` — default 0.10
- `LESSONS_SALIENCE_HALF_LIFE_DAYS=<int>` — default 7

## Measurement

A/B via `--control` protocol:
- Control: `LESSONS_SALIENCE_DISABLED=true` (no write, no read) → baseline
- New: defaults applied → salience active, backfill seed data drives boost

Expected numeric result:
- `recall@10` unchanged or marginally better
- `MRR` expected to LIFT on queries where the target lesson is in the audit-log backfill set
- `nDCG@10` expected to LIFT for the same reason
- `dup@10 nearsem` unchanged (dedup still applies)
- `latency_p95` expected to rise slightly (added SQL query; target < 200ms added p95)

The A/B diff is the nail. If salience adds no measurable lift, we learn the boost is too small or the backfill is insufficient — both fixable via env knobs without re-deploy.

## Size classification

- **Files touched:** ~10
  - `migrations/042_lesson_access_log.sql` (NEW)
  - `src/services/salience.ts` (NEW, pure/SQL)
  - `src/services/salience.test.ts` (NEW)
  - `src/services/lessons.ts` (wire write + read + blend into both search functions)
  - `src/services/lessons.test.ts` (extend — test blend fn)
  - `src/env.ts` (add three env knobs)
  - `src/mcp/index.ts` (update search_lessons tool description)
  - `docs/qc/friction-classes.md` (update downstream-behavior-coupling with salience impact)
  - `package.json` (test script)
  - A/B archives + diff
- **Logic changes:** ~8 (schema, backfill, write-path, read-path, decay SQL, blend formula, env integration, re-sort)
- **Side effects:** YES — new DB table, production ranking behavior change, write load on every search
- **Classification:** **L** — full 12 phases, plan file required, possibly subagent dispatch for parallel BUILD tasks, `/review-impl` strongly recommended at post-review.

## Risks

1. **Latency regression** — added SQL query per search. Mitigations: batch the salience query into the main hybrid query as a CTE, or cache per-session. Starting with separate query for simplicity; if latency regresses beyond noise floor, refactor to CTE.
2. **Write storm** — every search generates an INSERT. If `search_lessons` gets called at high QPS (e.g., by an agent in a tight loop), write volume could spike. Mitigations: fire-and-forget async writes, table partitioning on `accessed_at`, TTL-delete old rows (>180 days) in a nightly job. Start with fire-and-forget; add TTL job as a deferred item.
3. **Bootstrap bias** — guardrail_audit_logs are skewed toward lessons that FIRED guardrails (only ~228 events for ~600 lessons). Non-guardrail lessons start at zero salience. Mitigation: accept — the bias reflects real operator signal ("these are the lessons that mattered when something broke"), which IS the biological semantic we want.
4. **Dedup interaction** — dedup runs AFTER salience blend. If salience re-orders matches and a salience-boosted duplicate now ranks highest, dedup correctly keeps it. No interaction bug expected. Verify in tests.
5. **Env-flag drift from the 12.1a/b dedup pattern** — three env knobs instead of one. Operators may miss one. Mitigation: single umbrella flag `LESSONS_SALIENCE_DISABLED` kills all three paths; individual knobs are for tuning only.

## Locked CLARIFY decisions (2026-04-18)

1. **Schema:** A — append-only `lesson_access_log`.
2. **Write trigger:** B' + E combo — consumption signals at weight 1.0 (reflect-MCP, GET /api/lessons/:id) + rank-weighted search-consideration (weight = 1/rank).
3. **Bootstrap:** B — backfill from `guardrail_audit_logs` (228 rows) with `context='audit-bootstrap'`, weight=1.0.
4. **Scope:** all of 1+2+3+measurement+review-impl in one sprint. No rush — this is ~2-3 days of deliberate work.
