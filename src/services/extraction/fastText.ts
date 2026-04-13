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

/** PDF extraction via pdf-parse. Returns text per page when possible. */
async function extractPdfFast(buffer: Buffer): Promise<ExtractionResult> {
  // pdf-parse v2 ESM export
  const pdfParseModule: any = await import('pdf-parse');
  const pdfParse = pdfParseModule.pdf ?? pdfParseModule.default ?? pdfParseModule;

  // pdf-parse returns concatenated text by default. We use a pagerender callback
  // to capture each page individually and produce page-level chunks.
  const pages: ExtractedPage[] = [];

  const data = await (pdfParse as any)(buffer, {
    // pagerender is called per page with a TextContent-like object
    pagerender: async (pageData: any) => {
      const textContent = await pageData.getTextContent();
      let pageText = '';
      let lastY = 0;
      for (const item of textContent.items) {
        // Insert newline when y position changes significantly (new line/paragraph)
        if (lastY && Math.abs(item.transform[5] - lastY) > 5) {
          pageText += '\n';
        }
        pageText += item.str;
        lastY = item.transform[5];
      }
      return pageText;
    },
  });

  // Split the concatenated text by form-feed character (pdf-parse delimiter between pages)
  // Fall back to splitting by data.numpages worth of equal-ish chunks if no FF chars
  const totalPages: number = data.numpages ?? 1;
  const fullText: string = data.text ?? '';

  // pdf-parse separates pages with \n\n — we use that as a heuristic to split
  // Note: the pagerender hook above is the more reliable path, but pdf-parse
  // doesn't always invoke it in v2.x. The simpler and reliable approach is to
  // pass the full text as a single page when we can't reliably split.
  if (totalPages === 1 || !fullText.includes('\f')) {
    pages.push({ page_number: 1, content: fullText.trim() });
  } else {
    const split = fullText.split('\f');
    split.forEach((pageText, i) => {
      pages.push({ page_number: i + 1, content: pageText.trim() });
    });
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
