/**
 * Fast Text extraction — pdf-parse + mammoth + turndown.
 * Pure JS, no native deps, runs in any Node.js environment.
 *
 * Quality is "good enough" for clean text-based PDFs and simple DOCX files.
 * For complex layouts, use Quality Text (pandoc) or Vision mode.
 */

import { createModuleLogger } from '../../utils/logger.js';
import type { ExtractionResult, ExtractedPage } from './types.js';

const logger = createModuleLogger('extraction:fast');

/**
 * Extract a document buffer using fast text extraction.
 * Throws on unsupported format.
 */
export async function extractFast(
  buffer: Buffer,
  ext: string,
): Promise<ExtractionResult> {
  const normalized = ext.toLowerCase().replace(/^\./, '');

  switch (normalized) {
    case 'pdf':
      return extractPdfFast(buffer);
    case 'docx':
      return extractDocxFast(buffer);
    case 'md':
    case 'markdown':
    case 'txt':
    case 'text':
      return extractPlainText(buffer);
    default:
      throw new Error(`Fast extraction does not support .${normalized} files`);
  }
}

/** PDF extraction via pdf-parse v2 (class-based API). */
async function extractPdfFast(buffer: Buffer): Promise<ExtractionResult> {
  // pdf-parse v2 exports a PDFParse class
  const { PDFParse } = await import('pdf-parse');
  // Cast to Uint8Array for pdf-parse compatibility
  const parser = new (PDFParse as any)({ data: new Uint8Array(buffer) });

  const result: any = await parser.getText();
  await parser.destroy();

  // pdf-parse v2 returns { text, pages: [...], info, ... }
  // The pages array contains per-page text objects when available
  const pages: ExtractedPage[] = [];
  if (Array.isArray(result.pages) && result.pages.length > 0) {
    result.pages.forEach((p: any, i: number) => {
      const pageText = typeof p === 'string' ? p : (p?.text ?? '');
      pages.push({ page_number: i + 1, content: pageText.trim() });
    });
  } else {
    // Fallback: single page from concatenated text
    const fullText: string = result.text ?? '';
    pages.push({ page_number: 1, content: fullText.trim() });
  }

  const totalPages = pages.length || 1;
  const totalChars = pages.reduce((s, p) => s + p.content.length, 0);

  logger.info({ pages: totalPages, chars: totalChars }, 'pdf fast extraction complete');

  return {
    mode: 'fast',
    pages: pages.length > 0 ? pages : [{ page_number: 1, content: '' }],
    total_pages: totalPages,
  };
}

/** DOCX extraction via mammoth → HTML → turndown markdown. */
async function extractDocxFast(buffer: Buffer): Promise<ExtractionResult> {
  const mammoth = await import('mammoth');
  const TurndownService = (await import('turndown')).default;

  const { value: html } = await mammoth.convertToHtml({ buffer });
  const turndown = new TurndownService({
    headingStyle: 'atx',
    codeBlockStyle: 'fenced',
    bulletListMarker: '-',
  });
  // Tables: mammoth's HTML uses <table>, turndown converts but plain pipes only
  const markdown = turndown.turndown(html);

  logger.info({ chars: markdown.length }, 'docx fast extraction complete');

  return {
    mode: 'fast',
    pages: [{ page_number: null, content: markdown.trim() }],
    total_pages: 1,
  };
}

/** Plain text / markdown — no transformation needed. */
function extractPlainText(buffer: Buffer): ExtractionResult {
  const text = buffer.toString('utf-8').trim();
  return {
    mode: 'fast',
    pages: [{ page_number: null, content: text }],
    total_pages: 1,
  };
}
