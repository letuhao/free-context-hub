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
 *
 * Transactional: DELETE+INSERT of chunks is wrapped in a transaction. If
 * embedding fails after the DELETE, the transaction rolls back and the user's
 * existing chunks are preserved.
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

  // 1. Load document
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
  const ext = doc.doc_type === 'markdown' ? 'md' : doc.doc_type;

  // 2. Mark document as processing
  await pool.query(
    `UPDATE documents SET extraction_status = 'processing' WHERE doc_id = $1`,
    [docId],
  );

  try {
    // 3. Decode content — binary formats are stored base64-prefixed
    const buffer = decodeDocumentContent(doc.content ?? '', doc.doc_type);

    // Magic byte sanity check for binary formats (Issue #8)
    verifyMagicBytes(buffer, doc.doc_type);

    // 4. Extract
    const extraction: ExtractionResult =
      mode === 'quality'
        ? await extractQuality(buffer, ext)
        : await extractFast(buffer, ext);

    if (extraction.pages.length === 0 || extraction.pages.every((p) => !p.content.trim())) {
      throw new Error('Extraction produced no content');
    }

    // 5. Sanitize extracted content (XSS prevention — Issue #11)
    for (const page of extraction.pages) {
      page.content = sanitizeExtractedContent(page.content);
    }

    // 6. Chunk
    const preChunks: PreChunk[] = chunkDocument(extraction, { template });
    if (preChunks.length === 0) {
      throw new Error('Chunking produced no chunks');
    }

    // 7. Embed in batches BEFORE touching the database (so failure here
    //    doesn't destroy existing chunks)
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

    // 8. Atomically replace chunks: DELETE + batch INSERT in a transaction
    const insertedChunks: DocumentChunk[] = await replaceChunks(
      pool,
      docId,
      projectId,
      mode,
      preChunks,
      allEmbeddings,
    );

    // 9. Mark document complete
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
    // Mark failed but DO NOT touch chunks (the transaction in replaceChunks
    // either committed all or rolled back all)
    await pool.query(
      `UPDATE documents SET extraction_status = 'failed' WHERE doc_id = $1`,
      [docId],
    );
    throw err;
  }
}

/**
 * Atomically replace all chunks for a document.
 * Uses a transaction so DELETE + INSERT is all-or-nothing.
 * Uses batch INSERT (single statement) instead of N+1 inserts.
 */
async function replaceChunks(
  pool: ReturnType<typeof getDbPool>,
  docId: string,
  projectId: string,
  mode: ExtractionMode,
  preChunks: PreChunk[],
  embeddings: number[][],
): Promise<DocumentChunk[]> {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    await client.query(`DELETE FROM document_chunks WHERE doc_id = $1`, [docId]);

    // Build a single multi-row INSERT. Postgres parameter limit is 65535 per
    // statement, so we batch if there are too many chunks. With 10 columns per
    // row, we cap at ~6500 rows per INSERT (safe headroom).
    const COLS_PER_ROW = 10;
    const MAX_ROWS_PER_INSERT = Math.floor(60000 / COLS_PER_ROW);

    const inserted: DocumentChunk[] = [];
    for (let start = 0; start < preChunks.length; start += MAX_ROWS_PER_INSERT) {
      const slice = preChunks.slice(start, start + MAX_ROWS_PER_INSERT);
      const sliceEmbeddings = embeddings.slice(start, start + MAX_ROWS_PER_INSERT);

      const valuesParts: string[] = [];
      const params: any[] = [];
      let p = 1;
      for (let i = 0; i < slice.length; i++) {
        const c = slice[i];
        const embedding = `[${sliceEmbeddings[i].join(',')}]`;
        valuesParts.push(
          `($${p++}, $${p++}, $${p++}, $${p++}, $${p++}, $${p++}, $${p++}, $${p++}, $${p++}::vector)`,
        );
        params.push(
          docId,
          projectId,
          start + i, // chunk_index
          c.content,
          c.page_number,
          c.heading,
          c.chunk_type,
          mode,
          embedding,
        );
      }

      const result = await client.query(
        `INSERT INTO document_chunks
           (doc_id, project_id, chunk_index, content, page_number, heading,
            chunk_type, extraction_mode, embedding)
         VALUES ${valuesParts.join(', ')}
         RETURNING chunk_id, doc_id, project_id, chunk_index, content,
                   page_number, heading, chunk_type, extraction_mode,
                   confidence, created_at`,
        params,
      );
      inserted.push(...(result.rows as DocumentChunk[]));
    }

    await client.query('COMMIT');
    return inserted;
  } catch (e) {
    await client.query('ROLLBACK').catch(() => {});
    throw e;
  } finally {
    client.release();
  }
}

/**
 * Decode the document.content column into a Buffer.
 * Binary formats are stored as `data:base64;...` by the upload endpoint.
 * Text formats (markdown, plain text) are stored as utf-8.
 */
function decodeDocumentContent(content: string, docType: string): Buffer {
  if (content.startsWith('data:base64;')) {
    return Buffer.from(content.slice('data:base64;'.length), 'base64');
  }
  // Defensive: if doc_type indicates binary but content has no prefix,
  // the document was uploaded via the legacy flow and isn't extractable.
  const isBinary = ['pdf', 'docx', 'image', 'epub', 'odt', 'rtf'].includes(docType);
  if (isBinary && content.startsWith('[PDF file:')) {
    throw new Error(
      `Document was uploaded via legacy flow without raw bytes. Re-upload the file to enable extraction.`,
    );
  }
  return Buffer.from(content, 'utf-8');
}

/**
 * Verify magic bytes for binary formats (Issue #8).
 * Catches the case where a non-PDF buffer is mislabeled as PDF.
 */
function verifyMagicBytes(buffer: Buffer, docType: string): void {
  if (buffer.length < 4) return; // skip tiny buffers
  switch (docType) {
    case 'pdf':
      if (buffer.subarray(0, 4).toString('ascii') !== '%PDF') {
        throw new Error('PDF magic bytes mismatch — file may be corrupted or mislabeled');
      }
      break;
    case 'docx':
    case 'epub':
    case 'odt':
      // ZIP archives all start with "PK"
      if (buffer.subarray(0, 2).toString('ascii') !== 'PK') {
        throw new Error(
          `${docType.toUpperCase()} magic bytes mismatch — file may be corrupted or mislabeled`,
        );
      }
      break;
    case 'rtf':
      if (buffer.subarray(0, 5).toString('ascii') !== '{\\rtf') {
        throw new Error('RTF magic bytes mismatch — file may be corrupted or mislabeled');
      }
      break;
    // text/markdown/html: no magic bytes, skip
  }
}

/**
 * Sanitize extracted content to prevent XSS (Issue #11).
 * Strips <script>, <iframe>, on* event handlers, javascript: URIs.
 */
function sanitizeExtractedContent(content: string): string {
  return content
    // Remove <script>...</script> blocks
    .replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi, '')
    // Remove <iframe>...</iframe> blocks
    .replace(/<iframe\b[^>]*>[\s\S]*?<\/iframe>/gi, '')
    // Remove on* event handler attributes
    .replace(/\son\w+\s*=\s*("[^"]*"|'[^']*'|[^\s>]*)/gi, '')
    // Neutralize javascript: URIs
    .replace(/javascript:/gi, 'js-removed:');
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
