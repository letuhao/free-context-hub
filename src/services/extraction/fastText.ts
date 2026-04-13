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

/** PDF extraction via pdf-parse. Splits pages on form-feed if present. */
async function extractPdfFast(buffer: Buffer): Promise<ExtractionResult> {
  // pdf-parse v2 ESM export
  const pdfParseModule: any = await import('pdf-parse');
  const pdfParse = pdfParseModule.pdf ?? pdfParseModule.default ?? pdfParseModule;

  const data = await (pdfParse as any)(buffer);
  const totalPages: number = data.numpages ?? 1;
  const fullText: string = data.text ?? '';

  // pdf-parse separates pages with form-feed \f. If the form-feed isn't present
  // (some PDFs), fall back to a single page chunk.
  const pages: ExtractedPage[] = [];
  if (totalPages > 1 && fullText.includes('\f')) {
    const split = fullText.split('\f');
    split.forEach((pageText, i) => {
      pages.push({ page_number: i + 1, content: pageText.trim() });
    });
  } else {
    pages.push({ page_number: 1, content: fullText.trim() });
  }

  logger.info({ pages: pages.length, chars: fullText.length }, 'pdf fast extraction complete');

  return {
    mode: 'fast',
    pages,
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
