import fg from 'fast-glob';
import fs from 'node:fs/promises';
import path from 'node:path';
import { embedTexts } from './embedder.js';
import { getDbPool } from '../db/client.js';
import { rebuildProjectSnapshot } from './snapshot.js';
import { loadIgnorePatternsFromRoot } from '../utils/ignore.js';
import { chunkTextByLines } from '../utils/chunker.js';
import { smartChunkCode, type SmartChunk } from '../utils/smartChunker.js';
import { detectLanguage } from '../utils/languageDetect.js';
import { expandForFtsIndex } from '../utils/ftsTokenizer.js';
import { sha256Hex } from '../utils/hash.js';
import { upsertFileGraphFromDisk } from '../kg/upsert.js';
import { bumpProjectCacheVersion } from './cacheVersions.js';
import { createModuleLogger } from '../utils/logger.js';
import { getEnv } from '../env.js';
import { indexGeneratedDocuments } from './generatedIndexer.js';

const logger = createModuleLogger('indexer');

export type IndexProjectResult = {
  status: 'ok' | 'error';
  files_indexed: number;
  generated_docs_indexed?: number;
  generated_chunks_indexed?: number;
  duration_ms: number;
  errors: Array<{ path: string; message: string }>;
};

export type IndexProjectParams = {
  projectId: string;
  root: string;
  linesPerChunk?: number;
  embeddingBatchSize?: number;
};

function isProbablyBinary(buffer: Buffer) {
  // Fast heuristic: treat as binary if it contains null bytes.
  return buffer.includes(0);
}

function vectorLiteral(embedding: number[]) {
  return `[${embedding.join(',')}]`;
}

export async function indexProject({ projectId, root, linesPerChunk, embeddingBatchSize }: IndexProjectParams) {
  const pool = getDbPool();
  const startedAt = Date.now();

  const errors: IndexProjectResult['errors'] = [];
  let filesIndexed = 0;

  const resolvedRoot = path.resolve(root);
  const ignore = await loadIgnorePatternsFromRoot(resolvedRoot);
  ignore.push('**/.git/**', '**/node_modules/**');

  const files = await fg('**/*', {
    cwd: resolvedRoot,
    dot: true,
    onlyFiles: true,
    ignore,
  });

  // Ensure project row exists.
  await pool.query(
    `INSERT INTO projects(project_id, name)
     VALUES ($1, $2)
     ON CONFLICT (project_id) DO NOTHING;`,
    [projectId, projectId],
  );

  const env = getEnv();
  const batchSize = embeddingBatchSize ?? env.INDEX_EMBEDDING_BATCH_SIZE;
  const chunkLines = linesPerChunk ?? env.CHUNK_LINES;
  const maxFileBytes = env.INDEX_MAX_FILE_BYTES;

  for (const fileRel of files) {
    const filePath = path.join(resolvedRoot, fileRel);
    try {
      const stat = await fs.stat(filePath);
      if (stat.size <= 0 || stat.size > maxFileBytes) continue;

      const buf = await fs.readFile(filePath);
      if (isProbablyBinary(buf)) continue;

      const contentHash = sha256Hex(buf);

      const existing = await pool.query(
        `SELECT content_hash
         FROM files
         WHERE project_id=$1 AND root=$2 AND path=$3;`,
        [projectId, resolvedRoot, fileRel],
      );

      if (existing.rowCount && existing.rows[0]?.content_hash === contentHash) {
        // Incremental guard:
        // If a previous indexing run failed after updating `files.content_hash`
        // (e.g., embeddings auth 401) we might have deleted chunks but left no vectors.
        // Only skip if chunks already exist for this file AND have FTS populated.
        // If fts is NULL, we need to re-index to populate the FTS column.
        const chunkExists = await pool.query(
          `SELECT 1
           FROM chunks
           WHERE project_id=$1 AND root=$2 AND file_path=$3
             AND fts IS NOT NULL
           LIMIT 1;`,
          [projectId, resolvedRoot, fileRel],
        );

        if (chunkExists.rowCount && chunkExists.rowCount > 0) {
          continue; // unchanged + vectors already present + FTS populated
        }
      }
      const text = buf.toString('utf8');
      const langInfo = detectLanguage(fileRel);
      // Use smart chunking for known languages, fall back to line-based.
      const chunks: SmartChunk[] = langInfo.language && langInfo.language !== 'json' && langInfo.language !== 'yaml' && langInfo.language !== 'markdown'
        ? smartChunkCode(text, langInfo.language, chunkLines)
        : chunkTextByLines(text, chunkLines).map(c => ({ ...c }));
      if (chunks.length === 0) continue;

      // IMPORTANT: embed FIRST, then update DB.
      // This prevents "sticky" state where we updated `files.content_hash`
      // and deleted old chunks, but embeddings failed (auth/dimension mismatch).
      const embeddedChunks: Array<{ chunk: SmartChunk; embedding: number[]; langInfo: typeof langInfo }> = [];

      // Embed chunks in small batches.
      for (let i = 0; i < chunks.length; i += batchSize) {
        const slice = chunks.slice(i, i + batchSize);
        const vectors = await embedTexts(slice.map(c => c.content));

        for (let j = 0; j < slice.length; j++) {
          const c = slice[j];
          const embedding = vectors[j];
          if (!embedding || embedding.length === 0) continue;
          embeddedChunks.push({ chunk: c, embedding, langInfo });
        }
      }

      if (embeddedChunks.length === 0) {
        // Nothing to persist.
        continue;
      }

      const client = await pool.connect();
      try {
        await client.query('BEGIN');

        // Upsert file metadata.
        await client.query(
          `INSERT INTO files(project_id, root, path, content_hash, last_indexed_at)
           VALUES ($1, $2, $3, $4, now())
           ON CONFLICT (project_id, root, path)
           DO UPDATE SET content_hash=EXCLUDED.content_hash, last_indexed_at=now();`,
          [projectId, resolvedRoot, fileRel, contentHash],
        );

        // Recreate chunks for this file (simple MVP approach).
        await client.query(
          `DELETE FROM chunks WHERE project_id=$1 AND root=$2 AND file_path=$3;`,
          [projectId, resolvedRoot, fileRel],
        );

        // Insert new chunk vectors with metadata and FTS.
        for (const { chunk: c, embedding, langInfo: li } of embeddedChunks) {
          await client.query(
            `INSERT INTO chunks(
              project_id, root, file_path, start_line, end_line, content, embedding,
              language, symbol_name, symbol_type, is_test, fts
            ) VALUES ($1,$2,$3,$4,$5,$6,$7::vector,$8,$9,$10,$11,to_tsvector('english', $12));`,
            [
              projectId,
              resolvedRoot,
              fileRel,
              c.startLine,
              c.endLine,
              c.content,
              vectorLiteral(embedding),
              li.language || null,
              c.symbolName || null,
              c.symbolType || null,
              li.isTest,
              // FTS content: file path + symbol name + code content, with camelCase/snake_case expansion.
              expandForFtsIndex(`${fileRel} ${c.symbolName ?? ''} ${c.content}`),
            ],
          );
        }

        await client.query('COMMIT');
        filesIndexed += 1;

        const graph = await upsertFileGraphFromDisk({
          projectId,
          rootAbs: resolvedRoot,
          fileRel,
        });
        if (graph.status === 'error') {
          logger.warn({ project_id: projectId, file: fileRel, message: graph.message }, 'kg upsert failed');
        }
      } catch (err) {
        await client.query('ROLLBACK');
        throw err;
      } finally {
        client.release();
      }
    } catch (err) {
      errors.push({
        path: fileRel,
        message: err instanceof Error ? err.message : String(err),
      });
    }
  }

  const generated = await indexGeneratedDocuments({
    projectId,
    root: resolvedRoot,
    linesPerChunk: chunkLines,
    embeddingBatchSize: batchSize,
  }).catch(err => ({
    status: 'error' as const,
    docs_indexed: 0,
    chunks_indexed: 0,
    errors: [{ doc_key: 'generated', message: err instanceof Error ? err.message : String(err) }],
  }));
  if (generated.errors.length) {
    for (const e of generated.errors) {
      errors.push({ path: `generated/${e.doc_key}`, message: e.message });
    }
  }

  await bumpProjectCacheVersion(projectId).catch(() => {});

  await rebuildProjectSnapshot(projectId).catch(err => {
    logger.error(
      { project_id: projectId, error: err instanceof Error ? err.message : String(err) },
      'rebuildProjectSnapshot failed',
    );
  });

  const duration_ms = Date.now() - startedAt;
  const status: IndexProjectResult['status'] = errors.length ? 'error' : 'ok';
  return {
    status,
    files_indexed: filesIndexed,
    generated_docs_indexed: generated.docs_indexed,
    generated_chunks_indexed: generated.chunks_indexed,
    duration_ms,
    errors,
  };
}

