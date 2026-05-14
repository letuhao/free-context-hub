/**
 * Phase 14 — Re-embed all rows in chunks, lessons, document_chunks tables.
 *
 * Usage:
 *   npx tsx src/scripts/reembedAll.ts --yes [options]
 *
 * Options:
 *   --project-id <id>     Restrict to one project (default: all projects)
 *   --table <name>        chunks | lessons | document_chunks | all (default: all)
 *   --batch-size <n>      Embedding batch size (default: 8)
 *   --dry-run             Count rows that would be updated; no UPDATE
 *   --limit <n>           Stop after processing N rows per table (testing)
 *   --from-id <uuid>      SCOPING ONLY: start AFTER this id. NOT for crash resume.
 *                         For resume after crash: re-run without --from-id (safe restart).
 *   --yes                 Skip confirmation prompt. Required for any UPDATE run.
 *
 * Design ref: docs/specs/2026-05-14-phase-14-design.md (v3.1, hash 88e6577760db9932)
 *
 * IMPORTANT: mcp + worker must be STOPPED during the run, otherwise search results
 * during the 30-90 min window will mix old/new vectors (cosine distance garbage).
 */

import { promises as fs } from 'node:fs';
import { embedTexts } from '../services/embedder.js';
import { getDbPool } from '../db/client.js';
import { bumpProjectCacheVersion } from '../services/cacheVersions.js';
import { getEnv } from '../env.js';
import { createModuleLogger } from '../utils/logger.js';

const logger = createModuleLogger('reembedAll');

type TableName = 'chunks' | 'lessons' | 'document_chunks';

type TableSpec = {
  name: TableName;
  idColumn: string;
  selectCols: string;
  buildEmbedText: (row: Record<string, unknown>) => string;
};

const TABLE_SPECS: Record<TableName, TableSpec> = {
  chunks: {
    name: 'chunks',
    idColumn: 'chunk_id',
    selectCols: 'chunk_id, project_id, content',
    buildEmbedText: (row) => String(row.content ?? ''),
  },
  lessons: {
    name: 'lessons',
    idColumn: 'lesson_id',
    selectCols: 'lesson_id, project_id, title, search_aliases, content',
    buildEmbedText: (row) => {
      const title = String(row.title ?? '');
      const aliases = row.search_aliases ? String(row.search_aliases) : '';
      const content = String(row.content ?? '');
      return aliases ? `${title}. ${aliases}. ${content}` : `${title}. ${content}`;
    },
  },
  document_chunks: {
    name: 'document_chunks',
    idColumn: 'chunk_id',
    selectCols: 'chunk_id, project_id, content',
    buildEmbedText: (row) => String(row.content ?? ''),
  },
};

type Args = {
  projectId: string | null;
  table: TableName | 'all';
  batchSize: number;
  dryRun: boolean;
  limit: number | null;
  fromId: string | null;
  yes: boolean;
};

function parseArgs(argv: string[]): Args {
  const out: Args = {
    projectId: null,
    table: 'all',
    batchSize: 8,
    dryRun: false,
    limit: null,
    fromId: null,
    yes: false,
  };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    const next = () => argv[++i];
    switch (a) {
      case '--project-id': out.projectId = next(); break;
      case '--table': {
        const v = next();
        if (v !== 'chunks' && v !== 'lessons' && v !== 'document_chunks' && v !== 'all') {
          console.error(`Invalid --table: ${v}. Must be chunks|lessons|document_chunks|all`);
          process.exit(1);
        }
        out.table = v;
        break;
      }
      case '--batch-size': out.batchSize = Number(next()); break;
      case '--dry-run': out.dryRun = true; break;
      case '--limit': out.limit = Number(next()); break;
      case '--from-id': out.fromId = next(); break;
      case '--yes': out.yes = true; break;
      case '--help':
      case '-h':
        console.log(`See header of ${__filename} for usage.`);
        process.exit(0);
        break;
      default:
        console.error(`Unknown arg: ${a}`);
        process.exit(1);
    }
  }
  return out;
}

// Module-scope state for signal handler access
const projectsSeen = new Set<string>();
let currentTableFailedIds: { table: TableName; ids: string[] } | null = null;
let interrupted = false;

async function flushFailedIdsToFile(table: TableName, ids: string[]) {
  if (ids.length === 0) return null;
  const ts = Math.floor(Date.now() / 1000);
  const failedFile = `.phase-gates/failed-${table}-${ts}.json`;
  try {
    await fs.mkdir('.phase-gates', { recursive: true });
    await fs.writeFile(failedFile, JSON.stringify(ids, null, 2), 'utf8');
    return failedFile;
  } catch (writeErr) {
    console.error(`FAILED to write failed-ids file: ${writeErr}`);
    console.error(`IDs (truncated to 50):`, JSON.stringify(ids.slice(0, 50)));
    return null;
  }
}

async function signalHandler(sig: string) {
  if (interrupted) return;
  interrupted = true;
  logger.warn({ sig, projects_so_far: Array.from(projectsSeen) }, 'received signal, flushing state before exit');
  // (a) Flush in-flight failed IDs
  if (currentTableFailedIds && currentTableFailedIds.ids.length > 0) {
    const f = await flushFailedIdsToFile(currentTableFailedIds.table, currentTableFailedIds.ids);
    if (f) console.error(`Flushed ${currentTableFailedIds.ids.length} failed IDs to ${f}`);
  }
  // (b) Bump caches for projects seen so far
  for (const projectId of projectsSeen) {
    try { await bumpProjectCacheVersion(projectId); } catch (e) {
      logger.error({ e: String(e), projectId }, 'cache bump on signal failed');
    }
  }
  process.exit(130);
}

async function reembedTable(spec: TableSpec, opts: Args) {
  const pool = getDbPool();

  const whereParts: string[] = [];
  const whereParams: unknown[] = [];
  if (opts.projectId) {
    whereParts.push(`project_id = $${whereParams.length + 1}`);
    whereParams.push(opts.projectId);
  }
  const baseWhere = whereParts.length ? `WHERE ${whereParts.join(' AND ')}` : '';

  const totalRes = await pool.query(
    `SELECT count(*)::int AS n FROM ${spec.name} ${baseWhere}`,
    whereParams,
  );
  const total = Number((totalRes.rows[0] as { n: number }).n);
  logger.info({ table: spec.name, total, project_id: opts.projectId ?? 'all' }, 'starting table');

  if (opts.dryRun) {
    console.log(`[${spec.name}] dry-run: ${total} rows would be re-embedded`);
    return;
  }

  if (total === 0) {
    logger.info({ table: spec.name }, 'no rows to process');
    return;
  }

  let lastId: string | null = opts.fromId ?? null;
  let processed = 0;
  let ok = 0;
  let failed = 0;
  const failedIds: string[] = [];
  currentTableFailedIds = { table: spec.name, ids: failedIds };
  const startedAt = Date.now();
  let lastProgressLog = 0;

  try {
    while (true) {
      if (interrupted) break;
      if (opts.limit && processed >= opts.limit) break;

      const keysetParts = [...whereParts];
      const keysetParams: unknown[] = [...whereParams];
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
        const texts = sel.rows.map((r) => spec.buildEmbedText(r as Record<string, unknown>));
        vectors = await embedTexts(texts);
        // Phase 14 round-2 fix: length-mismatch guard. If embedTexts returns fewer
        // vectors than inputs (e.g., LM Studio dropped a row or returned a degenerate
        // response), routing through the existing batch-skip catch keeps the script
        // restartable instead of throwing OOB on vectors[i].
        if (vectors.length !== sel.rows.length) {
          throw new Error(
            `embedTexts returned ${vectors.length} vectors for ${sel.rows.length} inputs (batch size mismatch)`,
          );
        }
      } catch (err) {
        const ids = sel.rows.map((r) => String((r as Record<string, unknown>)[spec.idColumn]));
        failed += sel.rows.length;
        failedIds.push(...ids);
        logger.error(
          { err: String(err), batch_size: sel.rows.length, sample_ids: ids.slice(0, 3) },
          `[${spec.name}] embed batch failed — skipping batch`,
        );
        lastId = ids[ids.length - 1] ?? lastId;
        processed += sel.rows.length;
        continue;
      }

      // Per-batch BEGIN/COMMIT
      let client;
      try {
        client = await pool.connect();
      } catch (err) {
        logger.error({ err: String(err) }, `[${spec.name}] pool.connect failed — aborting table`);
        const ids = sel.rows.map((r) => String((r as Record<string, unknown>)[spec.idColumn]));
        failed += sel.rows.length;
        failedIds.push(...ids);
        break;
      }

      let batchAborted = false;
      try {
        try {
          await client.query('BEGIN');
        } catch (err) {
          logger.error({ err: String(err) }, `[${spec.name}] BEGIN failed — aborting table`);
          const ids = sel.rows.map((r) => String((r as Record<string, unknown>)[spec.idColumn]));
          failed += sel.rows.length;
          failedIds.push(...ids);
          batchAborted = true;
        }

        if (!batchAborted) {
          for (let i = 0; i < sel.rows.length; i++) {
            const row = sel.rows[i] as Record<string, unknown>;
            const id = String(row[spec.idColumn]);
            const literal = `[${vectors[i].join(',')}]`;
            try {
              await client.query(
                `UPDATE ${spec.name} SET embedding = $1::vector WHERE ${spec.idColumn} = $2`,
                [literal, id],
              );
              ok++;
              projectsSeen.add(String(row.project_id));
            } catch (err) {
              failed++;
              failedIds.push(id);
              logger.warn({ id, err: String(err) }, `[${spec.name}] row UPDATE failed`);
            }
          }

          try {
            await client.query('COMMIT');
          } catch (err) {
            logger.error({ err: String(err) }, `[${spec.name}] COMMIT failed — rolling back`);
            await client.query('ROLLBACK').catch(() => {});
            batchAborted = true;
          }
        }
      } finally {
        client.release();
      }

      if (batchAborted) break;

      // Advance keyset
      const lastRow = sel.rows[sel.rows.length - 1] as Record<string, unknown>;
      lastId = String(lastRow[spec.idColumn]);
      processed += sel.rows.length;

      // Progress log every ~100 rows
      if (processed - lastProgressLog >= 100 || processed === total) {
        lastProgressLog = processed;
        const elapsedMs = Date.now() - startedAt;
        const rate = elapsedMs > 0 ? (processed / elapsedMs * 1000).toFixed(2) : '0';
        const remaining = total - processed;
        const etaS = remaining > 0 && Number(rate) > 0
          ? Math.round(remaining / Number(rate))
          : 0;
        logger.info(
          {
            table: spec.name, processed, total, ok, failed,
            rate: `${rate}/s`, eta_s: etaS, cursor_id: lastId,
          },
          'progress',
        );
      }
    }
  } finally {
    // Always flush failed IDs (even on abort/break)
    const failedFile = await flushFailedIdsToFile(spec.name, failedIds);
    if (failedFile) {
      console.error(`[${spec.name}] ${failedIds.length} rows failed. IDs written to ${failedFile}`);
      console.error(`  To retry, re-run the script WITHOUT --from-id (safe restart from zero).`);
    }
    const elapsedMs = Date.now() - startedAt;
    logger.info(
      { table: spec.name, ok, failed, processed, elapsed_s: Math.round(elapsedMs / 1000) },
      'table done',
    );
    currentTableFailedIds = null;
    // Phase 14 round-2 fix: bump caches INSIDE finally so a synchronous throw
    // (e.g., the length-mismatch guard escalating, or any unhandled error)
    // still invalidates Redis before propagating. Idempotent — multiple bumps
    // increment a counter monotonically. D8 says "after each table"; this is
    // the only path that runs on both success AND failure.
    for (const projectId of projectsSeen) {
      try {
        await bumpProjectCacheVersion(projectId);
      } catch (e) {
        logger.error({ e: String(e), projectId }, 'cache bump in finally failed');
      }
    }
    logger.info({ table: spec.name, projects_bumped: Array.from(projectsSeen) }, 'cache bumped (in finally)');
  }
}

async function main() {
  const args = parseArgs(process.argv.slice(2));

  // Confirmation gate
  if (!args.yes && !args.dryRun) {
    console.error('WARNING: This will UPDATE embedding columns globally.');
    console.error('Required: (1) pg_dump backup exists, (2) mcp + worker are STOPPED.');
    console.error('Pass --yes to proceed, or --dry-run to count without updating.');
    process.exit(1);
  }

  // Install signal handlers BEFORE any work begins
  process.on('SIGINT', () => signalHandler('SIGINT').catch(() => process.exit(130)));
  process.on('SIGTERM', () => signalHandler('SIGTERM').catch(() => process.exit(130)));

  // Pre-flight dim probe
  const env = getEnv();
  let probeVec: number[][];
  try {
    probeVec = await embedTexts(['preflight probe']);
  } catch (err) {
    console.error(`Pre-flight embed call FAILED: ${err}`);
    console.error(`Check: (1) LM Studio is running, (2) EMBEDDINGS_MODEL=${env.EMBEDDINGS_MODEL} is loaded`);
    process.exit(1);
  }
  const probeDim = probeVec[0]?.length ?? 0;
  if (probeDim !== env.EMBEDDINGS_DIM) {
    console.error(`Dim mismatch: model returned ${probeDim}, EMBEDDINGS_DIM=${env.EMBEDDINGS_DIM}`);
    console.error(`Will not proceed — schema vs model mismatch corrupts vectors.`);
    process.exit(1);
  }
  logger.info(
    { model: env.EMBEDDINGS_MODEL, dim: probeDim, project_id: args.projectId ?? 'all', table: args.table, dry_run: args.dryRun },
    'preflight ok — starting reembedAll',
  );

  // Process tables
  const tables: TableName[] = args.table === 'all'
    ? ['chunks', 'lessons', 'document_chunks']
    : [args.table];

  for (const t of tables) {
    if (interrupted) break;
    await reembedTable(TABLE_SPECS[t], args);
  }

  logger.info(
    { projects_touched: Array.from(projectsSeen), tables_processed: tables },
    'reembedAll complete',
  );
}

main().catch((err) => {
  console.error('Fatal error:', err);
  process.exit(1);
});
