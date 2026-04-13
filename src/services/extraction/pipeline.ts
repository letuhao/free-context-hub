/**
 * Extraction pipeline orchestrator.
 *
 * Coordinates the full flow: load document → extract → chunk → embed → store.
 * Returns the persisted chunks. Updates documents.extraction_status / extraction_mode.
 */

import { getDbPool } from '../../db/client.js';
import { embedTexts } from '../embedder.js';
import { createModuleLogger } from '../../utils/logger.js';
import { extractFast } from './fastText.js';
import { extractQuality } from './qualityText.js';
import { chunkDocument } from './chunker.js';
import type {
  ExtractionMode,
  ChunkTemplate,
  DocumentChunk,
  PreChunk,
  ExtractionResult,
} from './types.js';

const logger = createModuleLogger('extraction:pipeline');

const EMBED_BATCH_SIZE = 32;

/**
 * Run the full extraction pipeline for a document.
 * Returns the chunks that were persisted, or throws on failure.
 */
export async function runExtraction(params: {
  docId: string;
  projectId: string;
  mode: ExtractionMode;
  template?: ChunkTemplate;
}): Promise<{ chunks: DocumentChunk[]; pages: number }> {
  const { docId, projectId, mode, template } = params;
  const pool = getDbPool();

  if (mode === 'vision') {
    throw new Error('Vision extraction not yet supported (Sprint 10.3)');
  }

  // 1. Load document and verify it has a buffer to extract
  const docRes = await pool.query(
    `SELECT doc_id, project_id, name, doc_type, content, file_size_bytes
     FROM documents
     WHERE doc_id = $1 AND project_id = $2`,
    [docId, projectId],
  );
  if (docRes.rows.length === 0) {
    throw new Error('Document not found');
  }
  const doc = docRes.rows[0];

  // For Sprint 10.1 we use the stored content as the source.
  // The current upload flow stores PDF as a placeholder string ("[PDF file: ...]"),
  // so PDFs uploaded via the existing endpoint won't have raw bytes available.
  // The new upload endpoint (added below) stores actual file bytes in storage_path
  // or extends the schema. For now, we accept text/markdown content and document
  // the limitation for binary formats.
  const ext = doc.doc_type === 'markdown' ? 'md' : doc.doc_type;

  // 2. Mark document as processing
  await pool.query(
    `UPDATE documents SET extraction_status = 'processing' WHERE doc_id = $1`,
    [docId],
  );

  try {
    // 3. Decode content — binary formats are stored base64-prefixed by the upload endpoint
    const rawContent: string = doc.content ?? '';
    let buffer: Buffer;
    if (rawContent.startsWith('data:base64;')) {
      buffer = Buffer.from(rawContent.slice('data:base64;'.length), 'base64');
    } else {
      buffer = Buffer.from(rawContent, 'utf-8');
    }

    const extraction: ExtractionResult =
      mode === 'quality'
        ? await extractQuality(buffer, ext)
        : await extractFast(buffer, ext);

    if (extraction.pages.length === 0 || extraction.pages.every((p) => !p.content.trim())) {
      throw new Error('Extraction produced no content');
    }

    // 4. Chunk the extracted content
    const preChunks: PreChunk[] = chunkDocument(extraction, { template });

    if (preChunks.length === 0) {
      throw new Error('Chunking produced no chunks');
    }

    // 5. Delete any existing chunks for this document (re-extraction overwrites)
    await pool.query(`DELETE FROM document_chunks WHERE doc_id = $1`, [docId]);

    // 6. Embed in batches
    const allEmbeddings: number[][] = [];
    for (let i = 0; i < preChunks.length; i += EMBED_BATCH_SIZE) {
      const batch = preChunks.slice(i, i + EMBED_BATCH_SIZE).map((c) => c.content);
      const batchEmbeddings = await embedTexts(batch);
      allEmbeddings.push(...batchEmbeddings);
    }

    if (allEmbeddings.length !== preChunks.length) {
      throw new Error(
        `Embedding count mismatch: got ${allEmbeddings.length}, expected ${preChunks.length}`,
      );
    }

    // 7. Insert chunks
    const insertedChunks: DocumentChunk[] = [];
    for (let i = 0; i < preChunks.length; i++) {
      const c = preChunks[i];
      const embedding = `[${allEmbeddings[i].join(',')}]`;
      const insRes = await pool.query(
        `INSERT INTO document_chunks
           (doc_id, project_id, chunk_index, content, page_number, heading,
            chunk_type, extraction_mode, embedding)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9::vector)
         RETURNING chunk_id, doc_id, project_id, chunk_index, content,
                   page_number, heading, chunk_type, extraction_mode,
                   confidence, created_at`,
        [
          docId,
          projectId,
          i,
          c.content,
          c.page_number,
          c.heading,
          c.chunk_type,
          mode,
          embedding,
        ],
      );
      insertedChunks.push(insRes.rows[0] as DocumentChunk);
    }

    // 8. Mark document complete
    await pool.query(
      `UPDATE documents
       SET extraction_status = 'complete',
           extraction_mode = $2,
           extracted_at = now(),
           updated_at = now()
       WHERE doc_id = $1`,
      [docId, mode],
    );

    logger.info(
      { docId, mode, chunks: insertedChunks.length, pages: extraction.total_pages },
      'extraction pipeline complete',
    );

    return { chunks: insertedChunks, pages: extraction.total_pages };
  } catch (err) {
    // Mark failed
    await pool.query(
      `UPDATE documents SET extraction_status = 'failed' WHERE doc_id = $1`,
      [docId],
    );
    throw err;
  }
}

/** List chunks for a document. */
export async function listDocumentChunks(params: {
  docId: string;
  projectId: string;
}): Promise<{ chunks: DocumentChunk[]; total: number }> {
  const pool = getDbPool();
  const result = await pool.query(
    `SELECT chunk_id, doc_id, project_id, chunk_index, content, page_number,
            heading, chunk_type, extraction_mode, confidence, created_at
     FROM document_chunks
     WHERE doc_id = $1 AND project_id = $2
     ORDER BY chunk_index ASC`,
    [params.docId, params.projectId],
  );
  return { chunks: result.rows as DocumentChunk[], total: result.rows.length };
}
