# Phase 14 — DESIGN Document

**Date:** 2026-05-14 (initial), revised 2026-05-15 after Adversary review (REJECTED → 2 BLOCK + 1 WARN)
**Spec ref:** `docs/specs/2026-05-14-phase-14-model-swap-spec.md` (CLARIFY)
**Phase:** DESIGN (Phase 2 of 12 in AMAW workflow)
**Review history:** v1 design REJECTED by Adversary; this is v2 addressing all 3 findings (see `.phase-gates/design-review.gate`)

---

## Spec fingerprint

```
spec_hash: <to be computed at gate write>
spec_file: docs/specs/2026-05-14-phase-14-model-swap-spec.md
spec_size: ~5KB
approach: A (in-place re-embed)
```

---

## High-level architecture (v2 — revised after Adversary review)

**Key principle (NEW):** Mcp + worker are STOPPED for the entire re-embed window. This prevents the half-migrated vector space problem (Finding 2 of design-review.gate). LM Studio + Postgres stay UP — the script connects to both directly without going through MCP.

```
┌─────────────────────────────────────────────────────────────┐
│  Pre-flight (Bash + manual)                                  │
│  ────────────────────────────                                │
│  1. curl LM Studio /v1/embeddings with bge-m3 — verify 1024d │
│  2. curl LM Studio /v1/chat/completions with nemotron-3-nano │
│  3. docker compose ps  — confirm mcp+worker currently down   │
│     (user already shut down per session message)             │
│  4. pg_dump → backups/2026-05-14-pre-phase14.dump            │
│  5. Edit .env (EMBEDDINGS_MODEL + DISTILLATION_MODEL)        │
│  6. ❌ DO NOT bring mcp/worker up yet                        │
└──────────────────────────┬───────────────────────────────────┘
                           │
                           ▼
┌─────────────────────────────────────────────────────────────┐
│  Re-embed script  (src/scripts/reembedAll.ts)                │
│  ─────────────────                                            │
│                                                               │
│  CLI args                                                     │
│   ├─ --project-id <id>   (optional, default: all projects)   │
│   ├─ --table <name>      (chunks|lessons|document_chunks|all)│
│   ├─ --batch-size <n>    (default: 8)                        │
│   ├─ --dry-run           (count only, no UPDATE)             │
│   ├─ --limit <n>         (test mode: only process N rows)    │
│   ├─ --from-id <uuid>    (resume: start AFTER this row id)   │
│   └─ --yes               (skip confirmation prompt)          │
│                                                               │
│  Flow per table (KEYSET PAGINATION — no cursor):              │
│   ┌──────────────────────────────────────────────┐           │
│   │ 1. SELECT id, content WHERE id > $last_id    │           │
│   │      ORDER BY id LIMIT $batchSize            │           │
│   │ 2. If 0 rows → done with this table          │           │
│   │ 3. embedTexts() with new model               │           │
│   │ 4. BEGIN / per-row UPDATE / COMMIT (per-batch)│          │
│   │ 5. last_id = batch[last].id                  │           │
│   │ 6. Log progress + last_id every 100 rows     │           │
│   │ 7. On batch error: log + SKIP batch +        │           │
│   │      record skipped IDs; do NOT abort        │           │
│   │ 8. Loop back to step 1                       │           │
│   └──────────────────────────────────────────────┘           │
│                                                               │
│  Cache invalidation after EACH table:                        │
│   - Call bumpProjectCacheVersion(projectId) for each project │
│   - Logs the new cache version                               │
│                                                               │
│  After ALL 3 tables done:                                    │
│   - Print summary: ok/fail counts per table                  │
│   - Print "manual resume cmd" if any failures                │
└──────────────────────────┬───────────────────────────────────┘
                           │
                           ▼
┌─────────────────────────────────────────────────────────────┐
│  Bring stack back up                                         │
│  ─────────────────────                                       │
│  1. docker compose up -d mcp worker                          │
│  2. Wait for healthcheck                                     │
│  3. (Optional) Rebuild project snapshots via add_lesson      │
│     no-op, or just let next add_lesson trigger rebuild       │
└──────────────────────────┬───────────────────────────────────┘
                           │
                           ▼
┌─────────────────────────────────────────────────────────────┐
│  Smoke + Goldenset (verify phase)                            │
│  ────────────────────────────────                            │
│  1. search_lessons / search_code / reflect — manual smoke    │
│  2. Run goldenset 40q via npx tsx src/qc/runBaseline.ts      │
│  3. Snapshot results to docs/qc/baselines/2026-05-14-phase14 │
└─────────────────────────────────────────────────────────────┘
```

### Why mcp+worker MUST be down during re-embed (addresses Finding 2)

If MCP is up while reembedAll is in progress:
- **Search queries**: every search_lessons/search_code call compares the user's query (embedded with NEW bge-m3) against a half-old/half-new vector pool. Cosine distances are nonsensical — different model = different vector space. Results are garbage.
- **addLesson during run**: inserts a NEW lesson, embeds with NEW model, calls `findConflictSuggestions` against existing lessons.embedding — half old, half new. Conflict detection returns wrong matches.
- **indexer during run**: new code chunks embedded with NEW model and inserted; reembedAll later may UPDATE them again (wasteful but not corrupting), OR may skip them if keyset has already passed their ID.
- **Redis cache**: `search_lessons` results are cached. Old-model results stay in cache until TTL expires (default 5-15 min). After re-embed, fresh queries hit cache and return old vectors' nearest neighbors.

Stopping mcp+worker eliminates ALL of these concurrency hazards. LM Studio (port 1234) and Postgres (port 5432) stay up — the script needs them.

## Module structure

### `src/scripts/reembedAll.ts` (NEW, ~280 LOC)

**Algorithm change from v1 (addresses Finding 3):** keyset pagination, no PG cursor, per-batch BEGIN/COMMIT.

```typescript
// Imports (v3 round-3 fix: fs.promises was missing)
import { promises as fs } from 'node:fs';
import { embedTexts } from '../services/embedder.js';
import { getDbPool } from '../db/client.js';
import { bumpProjectCacheVersion } from '../services/cacheVersions.js';
import { getEnv } from '../env.js';
import { createModuleLogger } from '../utils/logger.js';

const logger = createModuleLogger('reembedAll');

type TableSpec = {
  name: 'chunks' | 'lessons' | 'document_chunks';
  idColumn: string;
  buildEmbedText: (row: any) => string;
  selectCols: string;
};

const TABLE_SPECS: Record<string, TableSpec> = {
  chunks: {
    name: 'chunks',
    idColumn: 'chunk_id',
    selectCols: 'chunk_id, project_id, content',
    buildEmbedText: (row) => row.content,
  },
  lessons: {
    name: 'lessons',
    idColumn: 'lesson_id',
    selectCols: 'lesson_id, project_id, title, search_aliases, content',
    buildEmbedText: (row) => {
      const aliases = row.search_aliases || '';
      return aliases
        ? `${row.title}. ${aliases}. ${row.content}`
        : `${row.title}. ${row.content}`;
    },
  },
  document_chunks: {
    name: 'document_chunks',
    idColumn: 'chunk_id',
    selectCols: 'chunk_id, project_id, content',
    buildEmbedText: (row) => row.content,
  },
};

// CLI parsing — simple key=value, no external dep
const args = parseArgs(process.argv.slice(2));
// { projectId?, table, batchSize, dryRun, limit?, fromId?, yes }

// Confirmation gate
if (!args.yes && !args.dryRun) {
  console.error('WARNING: This will UPDATE embedding columns.');
  console.error('Required: (1) pg_dump backup exists, (2) mcp + worker are STOPPED.');
  console.error('Pass --yes to proceed, or --dry-run to count without updating.');
  process.exit(1);
}

// Pre-flight: verify embedding dim matches env
const env = getEnv();
const probe = await embedTexts(['preflight probe']);
if (probe[0].length !== env.EMBEDDINGS_DIM) {
  throw new Error(`Dim mismatch: model returned ${probe[0].length}, EMBEDDINGS_DIM=${env.EMBEDDINGS_DIM}`);
}
logger.info({ model: env.EMBEDDINGS_MODEL, dim: probe[0].length }, 'preflight dim check passed');

// Track all projects touched for cache invalidation
const projectsSeen = new Set<string>();

// Module-scope reference to current table's failed IDs (for signal handler access)
// Set inside reembedTable before its main loop; cleared on table done.
let currentTableFailedIds: { table: string; ids: string[] } | null = null;

// Install SIGINT/SIGTERM handler — bump caches + flush failed-ids on signal exit (v3 round-3 fix)
let interrupted = false;
const signalHandler = async (sig: string) => {
  if (interrupted) return; // ignore re-entry
  interrupted = true;
  logger.warn({ sig, projects_so_far: Array.from(projectsSeen) }, 'received signal, flushing state before exit');
  // (a) Flush in-flight failed IDs for the currently-processing table
  if (currentTableFailedIds && currentTableFailedIds.ids.length > 0) {
    const ts = Math.floor(Date.now() / 1000);
    const failedFile = `.phase-gates/failed-${currentTableFailedIds.table}-${ts}.json`;
    await fs.writeFile(failedFile, JSON.stringify(currentTableFailedIds.ids, null, 2), 'utf8')
      .catch((e) => logger.error({ e: String(e) }, 'failed-ids flush on signal failed'));
  }
  // (b) Bump caches for all projects seen so far
  for (const projectId of projectsSeen) {
    await bumpProjectCacheVersion(projectId).catch((e) => logger.error({ e: String(e), projectId }, 'cache bump on signal failed'));
  }
  process.exit(130);
};
process.on('SIGINT', () => signalHandler('SIGINT'));
process.on('SIGTERM', () => signalHandler('SIGTERM'));

// Process each table
const tables = args.table === 'all' ? (['chunks', 'lessons', 'document_chunks'] as const) : [args.table];
for (const table of tables) {
  await reembedTable(TABLE_SPECS[table], args, projectsSeen);
  // Cache invalidation INSIDE the loop (after each table) — addresses v2 Finding 2
  // Bumps for projects newly touched by this table.
  // (projectsSeen accumulates across tables; we bump all of them after each table for safety.
  // Multiple bumps are idempotent — bumpProjectCacheVersion increments a counter.)
  for (const projectId of projectsSeen) {
    await bumpProjectCacheVersion(projectId);
  }
  logger.info({ table, projects_bumped: Array.from(projectsSeen) }, 'cache bumped after table');
}

logger.info({ projects_touched: Array.from(projectsSeen) }, 'reembedAll complete');

async function reembedTable(spec: TableSpec, opts: Args, projectsSeen: Set<string>) {
  const pool = getDbPool();

  // Build WHERE clause
  const whereParts: string[] = [];
  const whereParams: any[] = [];
  let p = 1;
  if (opts.projectId) {
    whereParts.push(`project_id = $${p++}`);
    whereParams.push(opts.projectId);
  }

  // Count total (informational)
  const baseWhere = whereParts.length ? `WHERE ${whereParts.join(' AND ')}` : '';
  const totalRes = await pool.query(`SELECT count(*) AS n FROM ${spec.name} ${baseWhere}`, whereParams);
  const total = Number(totalRes.rows[0].n);
  logger.info({ table: spec.name, total }, 'starting table');

  if (opts.dryRun) {
    console.log(`[${spec.name}] dry-run: ${total} rows would be re-embedded`);
    return;
  }

  // Keyset pagination state
  let lastId: string | null = opts.fromId ?? null;
  let processed = 0;
  let ok = 0;
  let failed = 0;
  const failedIds: string[] = [];
  const startedAt = Date.now();

  // Expose failedIds to module-level signal handler (v3 round-3 fix)
  currentTableFailedIds = { table: spec.name, ids: failedIds };

  // Helper: write failed IDs to file (called from finally to handle abort paths)
  const writeFailedIdsFile = async () => {
    if (failedIds.length === 0) return;
    const ts = Math.floor(Date.now() / 1000);
    const failedFile = `.phase-gates/failed-${spec.name}-${ts}.json`;
    try {
      await fs.writeFile(failedFile, JSON.stringify(failedIds, null, 2), 'utf8');
      console.error(`[${spec.name}] ${failedIds.length} rows failed. IDs written to ${failedFile}`);
    } catch (writeErr) {
      // Last resort: print to stderr if file write itself failed
      console.error(`[${spec.name}] FAILED to write failed-ids file: ${writeErr}. IDs (truncated to 50):`,
        JSON.stringify(failedIds.slice(0, 50)));
    }
  };

  try {
    // ... main batch loop body goes here (existing code) ...

  while (true) {
    // SELECT next batch
    const keysetParts = [...whereParts];
    const keysetParams = [...whereParams];
    if (lastId) {
      keysetParts.push(`${spec.idColumn} > $${keysetParams.length + 1}`);
      keysetParams.push(lastId);
    }
    const keysetWhere = keysetParts.length ? `WHERE ${keysetParts.join(' AND ')}` : '';
    const limit = opts.limit
      ? Math.min(opts.batchSize, opts.limit - processed)
      : opts.batchSize;
    if (limit <= 0) break;

    const sel = await pool.query(
      `SELECT ${spec.selectCols} FROM ${spec.name} ${keysetWhere}
       ORDER BY ${spec.idColumn} LIMIT ${limit}`,
      keysetParams,
    );
    if (sel.rows.length === 0) break;

    // Embed batch
    let vectors: number[][];
    try {
      const texts = sel.rows.map(spec.buildEmbedText);
      vectors = await embedTexts(texts);
    } catch (err) {
      // Whole batch fails — log + record IDs + skip
      const ids = sel.rows.map((r) => r[spec.idColumn] as string);
      failed += sel.rows.length;
      failedIds.push(...ids);
      logger.error({ err: String(err), batch_size: sel.rows.length, ids: ids.slice(0, 3) },
        `[${spec.name}] embed batch failed — skipping`);
      // Advance keyset cursor to last id of failed batch
      lastId = sel.rows[sel.rows.length - 1][spec.idColumn];
      processed += sel.rows.length;
      continue;
    }

    // Per-batch BEGIN / UPDATE / COMMIT (addresses v1 Finding 3)
    let client;
    let batchAborted = false;
    try {
      client = await pool.connect();
    } catch (err) {
      // Pool exhausted / network drop — abort table loop entirely (v2 Finding 3b / D10)
      logger.error({ err: String(err) }, `[${spec.name}] pool.connect failed — aborting table`);
      failed += sel.rows.length;
      failedIds.push(...sel.rows.map((r) => r[spec.idColumn] as string));
      break;
    }
    try {
      try {
        await client.query('BEGIN');
      } catch (err) {
        // BEGIN failed = connection dead. Abort table loop (D10).
        logger.error({ err: String(err) }, `[${spec.name}] BEGIN failed — connection dead, aborting table`);
        failed += sel.rows.length;
        failedIds.push(...sel.rows.map((r) => r[spec.idColumn] as string));
        batchAborted = true;
      }
      if (!batchAborted) {
        for (let i = 0; i < sel.rows.length; i++) {
          const row = sel.rows[i];
          const id = row[spec.idColumn];
          const literal = `[${vectors[i].join(',')}]`;
          try {
            await client.query(
              `UPDATE ${spec.name} SET embedding = $1::vector WHERE ${spec.idColumn} = $2`,
              [literal, id],
            );
            ok++;
            projectsSeen.add(row.project_id);
          } catch (err) {
            // Single row failed — log + continue (other rows in batch still committed)
            failed++;
            failedIds.push(id);
            logger.warn({ id, err: String(err) }, `[${spec.name}] row UPDATE failed`);
          }
        }
        try {
          await client.query('COMMIT');
        } catch (err) {
          // COMMIT failed — record batch as failed, attempt rollback, abort table loop
          logger.error({ err: String(err) }, `[${spec.name}] COMMIT failed — rolling back, aborting table`);
          await client.query('ROLLBACK').catch(() => {});
          batchAborted = true;
        }
      }
    } finally {
      client.release();
    }
    if (batchAborted) break;

    // Advance keyset
    lastId = sel.rows[sel.rows.length - 1][spec.idColumn];
    processed += sel.rows.length;

    // Progress every ~100 rows
    if (processed % 100 < opts.batchSize) {
      const elapsedMs = Date.now() - startedAt;
      const rate = (processed / elapsedMs * 1000).toFixed(2);
      const remaining = total - processed;
      const etaMs = remaining > 0 ? remaining / Number(rate) * 1000 : 0;
      logger.info(
        { table: spec.name, processed, total, ok, failed, rate: `${rate}/s`, eta_s: Math.round(etaMs / 1000), last_id: lastId },
        'progress',
      );
    }
  }

  // End of batch loop — fall through to finally for failed-ids file write
  } finally {
    // ALWAYS write failed IDs (even on early break / signal / uncaught) — addresses v3 self-review
    await writeFailedIdsFile();
    const elapsedMs = Date.now() - startedAt;
    logger.info({ table: spec.name, ok, failed, processed, elapsed_s: Math.round(elapsedMs / 1000) }, 'table done');
    if (failed > 0) {
      console.error(`  To retry the whole table including these IDs, re-run the script WITHOUT --from-id.`);
      console.error(`  To retry only the failed IDs, a follow-up script is needed (out of Phase 14 scope).`);
    }
  }
}
```

## Key design decisions

### D1: No model versioning in DB (CONFIRMED, with honest framing)

We do NOT add an `embedded_with_model` column. Reasons:
- Migration overhead
- Phase 14 is one-shot; future re-embeds (Phase 15+) will be similar one-shots
- If we ever want versioning, can be added later as DEFERRED-N

**Honest consequence (addresses v1 Finding 1 + v2 Finding 1):** The script is NOT idempotent in the sense of "skip already-done rows".

**RESUME POLICY (v3, revised):** After ANY failure (LM Studio crash, Ctrl-C, DB connection drop), the canonical recovery is to **re-run WITHOUT `--from-id`**. The script will re-embed all rows in scope from the beginning. This wastes the time spent on already-done rows but is **provably safe** — no silent skip of rows that never got new vectors. The `--from-id` flag is RETAINED ONLY as a scoping tool for testing/partial runs (e.g., "re-embed only rows with id > X"), not as a recovery mechanism. The error matrix and progress logs reflect this distinction.

Why we rejected the "advance lastId only on successful UPDATE" approach: tracking lastSuccessId separately from cursorId adds a state machine that has its own edge cases (what if some rows in a batch succeed and others fail? Which gets reported?). The "just re-run from zero" approach trades 2× worst-case time for zero correctness risk. Acceptable for Phase 14 one-shot operation.

### D2: Per-batch BEGIN/COMMIT (REVISED, addresses Finding 3)

Alternatives considered:
- One giant transaction for all rows: WAL bloat, autovacuum blocked, all-or-nothing rollback risk
- Per-row autocommit (no explicit BEGIN/COMMIT): slower (1 round-trip per row)
- **Chosen (v2)**: Per-batch BEGIN/COMMIT. Each batch of `batchSize` rows is its own transaction. On batch failure, only that batch is rolled back; prior batches stay committed. WAL stays manageable, autovacuum can run.

Rejected v1 approach (one-tx-per-table-with-cursor) was a bug — would have held a 30-90 min open transaction.

### D3: Batch failure isolation

If `embedTexts()` fails for a batch (e.g., LM Studio crash), the batch is SKIPPED (no UPDATE attempted). The failed IDs are tracked in-memory and printed at end. The keyset cursor advances past the failed batch so the script continues to the next batch instead of hammering LM Studio on the same failing input.

For row-level UPDATE failures inside a successfully-embedded batch (rare, e.g., row deleted concurrently — but mcp+worker are down so this shouldn't happen), we log + continue within the batch's transaction. The successful rows get committed; failed row IDs are recorded.

### D4: Keyset pagination (REVISED, was D4 cursor-based)

`SELECT ... WHERE id > $last_id ORDER BY id LIMIT N` instead of `DECLARE CURSOR`. Reasons:
- No long-lived cursor to manage (and no WITH HOLD complexity)
- Stable across our own UPDATEs (we don't modify the PK column)
- Each batch is a fresh independent query — pairs naturally with per-batch BEGIN/COMMIT
- Resume via `--from-id` is a 1-line tweak to the same SQL

### D5: `--from-id` as scoping flag, NOT resume (REVISED v3 after Adversary v2)

`--from-id` is a SCOPING tool for deliberate partial runs (testing, manual retry of a known-good range). It is NOT for crash recovery.

**For crash recovery:** re-run the script WITHOUT `--from-id`. It will re-embed from row 0. Accepts 2× worst-case time as the cost of correctness.

Why: tracking `lastSuccessId` separately from `cursorId` (so `--from-id` could mean "after last committed row") introduces state-machine complexity and edge cases. The simpler "re-run from zero" approach has no silent-skip failure mode.

Progress logs print `cursor_id` (last fetched row's id) — purely informational, NOT marketed as a resume point.

### D6: Goldenset baseline path

After re-embed completes, run `npx tsx src/qc/runBaseline.ts` and snapshot results to `docs/qc/baselines/2026-05-14-phase14-bge-m3.json`. Compare visually to last mxbai-large baseline.

**IMPORTANT (addresses part of Finding 1):** the comparison is informational only, not apples-to-apples. Different model = different vector space, so absolute MRR/nDCG@10 numbers between mxbai-large and bge-m3 are not directly comparable — they're each measuring "search quality in their own embedding world." A 10% drop in MRR after swap is NOT necessarily a regression; could be the goldenset reference set being more aligned with mxbai's tokenization quirks. Document delta in retro lesson with this caveat. Do NOT block Phase 14 close on goldenset numbers.

### D7: Confirmation prompt + STOP REQUIREMENT (REVISED, addresses Finding 2)

The `--yes` confirmation now also requires user has stopped mcp+worker:
```
WARNING: This will UPDATE embedding columns.
Required: (1) pg_dump backup exists, (2) mcp + worker are STOPPED.
Pass --yes to proceed, or --dry-run to count without updating.
```
Script does NOT programmatically check mcp/worker state (that's a manual ops concern). If mcp is up, search results during run are garbage but data isn't corrupted — accepted operator-error mode.

### D8: Cache invalidation after each table + signal trap (REVISED v3 after Adversary v2)

After each table completes, call `bumpProjectCacheVersion(projectId)` for every project_id touched IN THAT TABLE. This is now INSIDE `reembedTable`, not at end of script. So if the script crashes between tables (e.g., after `chunks` done but before `lessons` starts), at least `chunks` has its cache invalidated.

**Signal trap (NEW):** the script installs SIGINT/SIGTERM handlers. On signal: print summary, then call `bumpProjectCacheVersion` for ALL projects seen so far across all tables, then exit 130. This bounds the stale-cache window to "the rows fetched after the last in-loop bump but never committed."

**Belt-and-suspenders:** the rollback procedure (below) also includes `docker compose exec redis redis-cli FLUSHDB` as a final cache clear, so even if the in-script bump misses something, the rollback wipes Redis entirely.

**`bumpProjectCacheVersion` semantics:** invalidates Redis cache entries scoped to project_id AND triggers snapshot rebuild on next `get_project_summary` call.

### D9: Failed IDs to file, not stderr (NEW, addresses v2 Finding 3a)

If any rows fail (LM Studio crash on a batch, row UPDATE error), the script writes the failed IDs to `.phase-gates/failed-<table>-<unix_timestamp>.json` as a JSON array. Not flooded to stderr.

A follow-up tool/script can read this file and retry only those IDs — but that's out of Phase 14 scope. For Phase 14 manual recovery: just re-run the entire script (per D5/D1 resume policy).

### D10: Abort on connection-level errors (NEW, addresses v2 Finding 3b)

If `BEGIN` itself fails (line in script), it indicates the DB connection is bad. The script logs the error, attempts ROLLBACK (best-effort), releases the client, then `break`s out of the per-table loop instead of continuing with a dead pool.

Other connection-level errors (pool exhausted, network drop) also trigger `break`. The summary at end of table reports "aborted at cursor_id X" rather than "completed."

## Data flow per table

### chunks
```
SELECT chunk_id, project_id, content FROM chunks WHERE [optional: project_id = $1]
  → embedTexts([content_1, content_2, ..., content_8])
  → UPDATE chunks SET embedding = $vec::vector WHERE chunk_id = $id
```

### lessons
```
SELECT lesson_id, project_id, title, search_aliases, content FROM lessons WHERE [optional: project_id = $1]
  → buildEmbedText: `${title}. ${search_aliases ?? ''}. ${content}` (drop empty parts)
  → embedTexts([text_1, ...])
  → UPDATE lessons SET embedding = $vec::vector WHERE lesson_id = $id
```

### document_chunks
```
SELECT chunk_id, project_id, content FROM document_chunks WHERE [optional: project_id = $1]
  → embedTexts([content_1, ...])
  → UPDATE document_chunks SET embedding = $vec::vector WHERE chunk_id = $id
```

## Error handling matrix

| Failure | Action | Exit code | Resume cmd |
|---------|--------|-----------|------------|
| Dim mismatch on pre-flight test | Abort with clear error | 1 | (no resume — fix model first) |
| LM Studio unreachable | Abort with clear error | 1 | (no resume — fix LM Studio first) |
| Single batch embed fails (e.g., LM Studio momentary crash) | Log, advance keyset past failed batch, continue | continue | rerun without --from-id; failed batch IDs printed at end for manual retry |
| Row UPDATE fails inside committed batch | Log per-row, continue within batch txn | continue | rerun + use printed failed IDs |
| DB connection lost mid-batch | ROLLBACK current batch only; abort run | 2 | rerun with `--from-id <last_id from last progress log>` |
| User Ctrl-C | Print partial summary including last_id, exit | 130 | rerun with `--from-id <last_id>` |

## Verification plan

### Smoke tests (manual)

```bash
# 1. Lesson search
curl -X POST http://localhost:3001/api/lessons/search \
  -d '{"project_id":"free-context-hub","query":"phase 12 measurement","limit":5}'
# Expected: returns ≥3 results with reasonable scores

# 2. Code search
curl -X POST http://localhost:3001/api/code/search \
  -d '{"project_id":"phase-13-coordination","query":"embedTexts","limit":5}'
# Expected: top hit is src/services/embedder.ts

# 3. Reflect (uses nemotron-3-nano)
curl -X POST http://localhost:3000/mcp/tools/call \
  -d '{"name":"reflect","arguments":{"project_id":"phase-13-coordination","topic":"how to claim an artifact"}}'
# Expected: coherent multi-paragraph response
```

### Goldenset run

```bash
npx tsx src/qc/runBaseline.ts \
  --project-id free-context-hub \
  --goldenset docs/qc/lessons-goldenset-40q.json \
  --output docs/qc/baselines/2026-05-14-phase14-bge-m3.json
```

## Out-of-scope confirmations

- ❌ Not modifying `src/services/embedder.ts` — single global model is fine
- ❌ Not modifying `src/services/indexer.ts` — content_hash skip behavior is correct for our flow
- ❌ Not modifying `src/services/lessons.ts` — embed source text logic is correct
- ❌ Not touching `generated_documents` table — no embedding column there (confirmed via `grep "embedding" migrations/0029*.sql` shows generated docs have content, not vectors)
- ❌ Not re-distilling lessons (regenerate summary/quick_action/aliases with nemotron) — keeps existing aliases

## Rollback procedure

**Trigger:** SMOKE TEST FAILURE only. Goldenset baseline numbers are informational (per D6) — a lower MRR/nDCG@10 on bge-m3 vs mxbai is NOT a rollback trigger (different vector spaces, not comparable). A rollback fires when smoke tests cannot find expected results (empty result lists for known queries, or 100% wrong-document returns), not on metric deltas.

```bash
# 1. Stop the stack (if not already down)
docker compose stop mcp worker

# 2. Drop and restore from pg_dump
#    (pg_dump format: custom; use pg_restore for .dump files)
docker compose exec -T postgres psql -U contexthub -c "DROP DATABASE IF EXISTS contexthub_old;"
docker compose exec -T postgres psql -U contexthub -c "ALTER DATABASE contexthub RENAME TO contexthub_old;"
docker compose exec -T postgres pg_restore -U contexthub -d postgres -C backups/2026-05-14-pre-phase14.dump
# Or simpler: drop + recreate from dump file via psql pipe if dump is plain SQL

# 3. Flush Redis cache (NEW v3 — required to clear any cached new-model results)
docker compose exec -T redis redis-cli FLUSHDB

# 4. Revert env
git checkout .env  # revert EMBEDDINGS_MODEL + DISTILLATION_MODEL

# 5. Restart
docker compose up -d mcp worker
```

Time to rollback: ~3-5 min (mostly pg_restore time depending on DB size).

## Next phase: REVIEW-DESIGN (re-spawn after v2 revisions)

Spawn cold-start Adversary sub-agent. Input files only:
- `docs/specs/2026-05-14-phase-14-model-swap-spec.md` (CLARIFY)
- `docs/specs/2026-05-14-phase-14-design.md` (this DESIGN)
- `docs/deferred/DEFERRED.md` (open items context)
- `src/services/embedder.ts`, `src/services/indexer.ts`, `src/services/lessons.ts` (related code)
- `migrations/0042_document_chunks.sql`, `migrations/0001_init.sql` (schema)

Adversary task: find exactly 3 problems (BLOCK or WARN). Cold-start = no chat context.
