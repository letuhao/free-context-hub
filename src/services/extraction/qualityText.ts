/**
 * Quality Text extraction — pdftotext + pandoc.
 * Requires external binaries (poppler-utils + pandoc) installed in the host/container.
 *
 * Falls back to fastText when binaries are unavailable. Better quality than
 * fast mode for complex DOCX, multi-column PDFs, and supports more formats
 * (EPUB, ODT, RTF, HTML).
 */

import { spawn } from 'node:child_process';
import { createModuleLogger } from '../../utils/logger.js';
import { extractFast } from './fastText.js';
import type { ExtractionResult, ExtractedPage } from './types.js';

const logger = createModuleLogger('extraction:quality');

/** Quality extraction with pandoc/pdftotext. Falls back to fast on failure. */
export async function extractQuality(
  buffer: Buffer,
  ext: string,
): Promise<ExtractionResult> {
  const normalized = ext.toLowerCase().replace(/^\./, '');

  try {
    switch (normalized) {
      case 'pdf':
        return await extractPdfQuality(buffer);
      case 'docx':
      case 'odt':
      case 'rtf':
      case 'epub':
      case 'html':
        return await extractWithPandoc(buffer, normalized);
      case 'md':
      case 'markdown':
      case 'txt':
      case 'text':
        // No quality benefit for plain text, defer to fast
        return await extractFast(buffer, normalized);
      default:
        throw new Error(`Quality extraction does not support .${normalized} files`);
    }
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    logger.warn({ ext: normalized, err: msg }, 'quality extraction failed, falling back to fast');
    // Graceful fallback: if pandoc/pdftotext not installed, use the npm path
    if (normalized === 'pdf' || normalized === 'docx') {
      return extractFast(buffer, normalized);
    }
    // Formats with no fast-mode fallback — give a clear error
    const isToolMissing = /not available/.test(msg);
    if (isToolMissing) {
      throw new Error(
        `${normalized.toUpperCase()} extraction requires pandoc to be installed. ` +
          `It's included in the Docker image but missing in this environment. ` +
          `Install pandoc or use a supported format (pdf, docx, markdown, text).`,
      );
    }
    throw err;
  }
}

/** PDF extraction via pdftotext (poppler-utils). Page-aware via -layout flag. */
async function extractPdfQuality(buffer: Buffer): Promise<ExtractionResult> {
  // pdftotext - - reads from stdin, writes to stdout
  // -layout preserves columns/structure, -nopgbrk OFF gives form-feed page breaks
  const text = await runBinary('pdftotext', ['-layout', '-', '-'], buffer);

  // pdftotext separates pages with form-feed (\f) by default
  const pageTexts = text.split('\f').filter((p) => p.trim().length > 0);
  const pages: ExtractedPage[] = pageTexts.map((content, i) => ({
    page_number: i + 1,
    content: content.trim(),
  }));

  logger.info({ pages: pages.length, chars: text.length }, 'pdftotext extraction complete');

  return {
    mode: 'quality',
    pages: pages.length > 0 ? pages : [{ page_number: 1, content: '' }],
    total_pages: pages.length || 1,
  };
}

/** Extract via pandoc to markdown. Handles DOCX, ODT, RTF, EPUB, HTML. */
async function extractWithPandoc(buffer: Buffer, ext: string): Promise<ExtractionResult> {
  // pandoc auto-detects most formats from stdin, but we hint with -f
  const fromFormat = ext === 'html' ? 'html' : ext === 'rtf' ? 'rtf' : ext;
  const markdown = await runBinary(
    'pandoc',
    ['-f', fromFormat, '-t', 'markdown_strict+pipe_tables+raw_html', '--wrap=none', '-'],
    buffer,
  );

  logger.info({ ext, chars: markdown.length }, 'pandoc extraction complete');

  return {
    mode: 'quality',
    pages: [{ page_number: null, content: markdown.trim() }],
    total_pages: 1,
  };
}

/**
 * Spawn an external binary, pipe buffer to stdin, read stdout to string.
 * Rejects on non-zero exit, stderr, or missing binary (ENOENT).
 */
function runBinary(cmd: string, args: string[], input: Buffer): Promise<string> {
  return new Promise((resolve, reject) => {
    const child = spawn(cmd, args, { stdio: ['pipe', 'pipe', 'pipe'] });
    const chunks: Buffer[] = [];
    const errChunks: Buffer[] = [];

    child.stdout.on('data', (c) => chunks.push(c));
    child.stderr.on('data', (c) => errChunks.push(c));

    child.on('error', (err) => {
      // ENOENT = binary not installed
      reject(new Error(`${cmd} not available: ${err.message}`));
    });

    child.on('close', (code) => {
      if (code !== 0) {
        const stderr = Buffer.concat(errChunks).toString('utf-8').slice(0, 500);
        reject(new Error(`${cmd} exited ${code}: ${stderr}`));
        return;
      }
      resolve(Buffer.concat(chunks).toString('utf-8'));
    });

    child.stdin.write(input);
    child.stdin.end();
  });
}
