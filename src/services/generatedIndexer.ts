import { embedTexts } from './embedder.js';
import { getDbPool } from '../db/client.js';
import { getEnv } from '../env.js';
import { chunkTextByLines } from '../utils/chunker.js';
import { listGeneratedDocuments } from './generatedDocs.js';

function vectorLiteral(embedding: number[]) {
  return `[${embedding.join(',')}]`;
}

function syntheticPath(docType: string, docKey: string) {
  return `generated/${docType}/${docKey}.md`;
}

export async function indexGeneratedDocuments(params: {
  projectId: string;
  root: string;
  linesPerChunk?: number;
  embeddingBatchSize?: number;
}): Promise<{ status: 'ok' | 'error'; docs_indexed: number; chunks_indexed: number; errors: Array<{ doc_key: string; message: string }> }> {
  const pool = getDbPool();
  const env = getEnv();
  const docs = await listGeneratedDocuments({ projectId: params.projectId, limit: env.GENERATED_INDEX_MAX_DOCS });
  const chunkLines = params.linesPerChunk ?? env.CHUNK_LINES;
  const batchSize = params.embeddingBatchSize ?? env.INDEX_EMBEDDING_BATCH_SIZE;
  const errors: Array<{ doc_key: string; message: string }> = [];
  let docsIndexed = 0;
  let chunksIndexed = 0;

  for (const d of docs) {
    try {
      const text = String(d.content ?? '');
      const chunks = chunkTextByLines(text, chunkLines);
      if (!chunks.length) continue;

      const embedded: Array<{ startLine: number; endLine: number; content: string; embedding: number[] }> = [];
      for (let i = 0; i < chunks.length; i += batchSize) {
        const slice = chunks.slice(i, i + batchSize);
        const vecs = await embedTexts(slice.map(c => c.content));
        for (let j = 0; j < slice.length; j++) {
          const v = vecs[j];
          if (!v?.length) continue;
          embedded.push({ startLine: slice[j].startLine, endLine: slice[j].endLine, content: slice[j].content, embedding: v });
        }
      }
      if (!embedded.length) continue;

      const filePath = syntheticPath(d.doc_type, d.doc_key);
      const client = await pool.connect();
      try {
        await client.query('BEGIN');
        await client.query(
          `DELETE FROM chunks WHERE project_id=$1 AND root=$2 AND file_path=$3`,
          [params.projectId, params.root, filePath],
        );
        for (const c of embedded) {
          await client.query(
            `INSERT INTO chunks(project_id, root, file_path, start_line, end_line, content, embedding)
             VALUES ($1,$2,$3,$4,$5,$6,$7::vector)`,
            [params.projectId, params.root, filePath, c.startLine, c.endLine, c.content, vectorLiteral(c.embedding)],
          );
        }
        await client.query('COMMIT');
      } catch (err) {
        await client.query('ROLLBACK');
        throw err;
      } finally {
        client.release();
      }

      docsIndexed += 1;
      chunksIndexed += embedded.length;
    } catch (err) {
      errors.push({ doc_key: d.doc_key, message: err instanceof Error ? err.message : String(err) });
    }
  }

  return { status: errors.length ? 'error' : 'ok', docs_indexed: docsIndexed, chunks_indexed: chunksIndexed, errors };
}

