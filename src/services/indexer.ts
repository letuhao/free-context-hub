import fg from 'fast-glob';
import fs from 'node:fs/promises';
import path from 'node:path';
import { embedTexts } from './embedder.js';
import { getDbPool } from '../db/client.js';
import { rebuildProjectSnapshot } from './snapshot.js';
import { loadIgnorePatternsFromRoot } from '../utils/ignore.js';
import { chunkTextByLines } from '../utils/chunker.js';
import { sha256Hex } from '../utils/hash.js';
import { upsertFileGraphFromDisk } from '../kg/upsert.js';
import { bumpProjectCacheVersion } from './cacheVersions.js';

export type IndexProjectResult = {
  status: 'ok' | 'error';
  files_indexed: number;
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

  const batchSize = embeddingBatchSize ?? 8;
  const chunkLines = linesPerChunk ?? 120;
  const MAX_FILE_BYTES = 2_000_000;

  for (const fileRel of files) {
    const filePath = path.join(resolvedRoot, fileRel);
    try {
      const stat = await fs.stat(filePath);
      if (stat.size <= 0 || stat.size > MAX_FILE_BYTES) continue;

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
        // Only skip if chunks already exist for this file.
        const chunkExists = await pool.query(
          `SELECT 1
           FROM chunks
           WHERE project_id=$1 AND root=$2 AND file_path=$3
           LIMIT 1;`,
          [projectId, resolvedRoot, fileRel],
        );

        if (chunkExists.rowCount && chunkExists.rowCount > 0) {
          continue; // unchanged + vectors already present
        }
      }
      const text = buf.toString('utf8');
      const chunks = chunkTextByLines(text, chunkLines);
      if (chunks.length === 0) continue;

      // IMPORTANT: embed FIRST, then update DB.
      // This prevents "sticky" state where we updated `files.content_hash`
      // and deleted old chunks, but embeddings failed (auth/dimension mismatch).
      const embeddedChunks: Array<{ chunk: (typeof chunks)[number]; embedding: number[] }> = [];

      // Embed chunks in small batches.
      for (let i = 0; i < chunks.length; i += batchSize) {
        const slice = chunks.slice(i, i + batchSize);
        const vectors = await embedTexts(slice.map(c => c.content));

        for (let j = 0; j < slice.length; j++) {
          const c = slice[j];
          const embedding = vectors[j];
          if (!embedding || embedding.length === 0) continue;
          embeddedChunks.push({ chunk: c, embedding });
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

        // Insert new chunk vectors.
        for (const { chunk: c, embedding } of embeddedChunks) {
          await client.query(
            `INSERT INTO chunks(
              project_id, root, file_path, start_line, end_line, content, embedding
            ) VALUES ($1,$2,$3,$4,$5,$6,$7::vector);`,
            [
              projectId,
              resolvedRoot,
              fileRel,
              c.startLine,
              c.endLine,
              c.content,
              vectorLiteral(embedding),
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
          console.warn(`[indexer] kg upsert failed for ${fileRel}: ${graph.message}`);
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

  await bumpProjectCacheVersion(projectId).catch(() => {});

  await rebuildProjectSnapshot(projectId).catch(err => {
    console.error('[indexer] rebuildProjectSnapshot failed:', err instanceof Error ? err.message : err);
  });

  const duration_ms = Date.now() - startedAt;
  const status: IndexProjectResult['status'] = errors.length ? 'error' : 'ok';
  return { status, files_indexed: filesIndexed, duration_ms, errors };
}

