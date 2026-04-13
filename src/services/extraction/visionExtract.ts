/**
 * High-level vision extraction orchestrator.
 *
 * - PDF: render every page to PNG via pdftoppm, send each to vision model
 * - Image: send the buffer directly as a single page
 * - DOCX/EPUB/etc: convert to PDF first via pandoc, then process as PDF
 *
 * Per-page errors are captured and returned as placeholder pages with
 * confidence: 0 and content: "[extraction failed: ...]". The caller
 * decides whether to retry failed pages.
 */

import { spawn } from 'node:child_process';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { createModuleLogger } from '../../utils/logger.js';
import { renderPdfPages } from './pdfRender.js';
import { extractPageVision } from './vision.js';
import { getEnv } from '../../env.js';
import { isJobCancelled, updateJobProgress } from '../jobQueue.js';
import type { ExtractionResult, ExtractedPage } from './types.js';

const logger = createModuleLogger('extraction:vision-extract');

/** Custom error thrown when the user cancels an in-progress job. */
export class JobCancelledError extends Error {
  constructor(message = 'Job cancelled by user') {
    super(message);
    this.name = 'JobCancelledError';
  }
}

export interface VisionExtractOptions {
  /** Optional job ID for progress reporting + cancellation checks. */
  jobId?: string;
  /** Custom prompt template — overrides the default structured-markdown prompt. */
  promptTemplate?: 'default' | 'mermaid';
}

const MERMAID_PROMPT = `This page may contain a diagram, flowchart, or visual relationship.

Reproduce it as Mermaid code so it can be rendered in markdown.

Rules:
- Use the most appropriate Mermaid diagram type: graph LR / graph TD (flowchart),
  sequenceDiagram, classDiagram, stateDiagram, erDiagram
- Preserve all node labels, edge labels, and directional relationships
- If the page also contains text alongside the diagram, include that as a brief
  summary AFTER the mermaid block
- If you cannot reproduce it as Mermaid (e.g., the page has no diagram at all),
  output a plain markdown description instead

Output format:
\`\`\`mermaid
[mermaid code]
\`\`\`

Brief description: [1-2 sentences explaining what the diagram shows]`;

function getPromptForTemplate(template?: 'default' | 'mermaid'): string | undefined {
  if (template === 'mermaid') return MERMAID_PROMPT;
  return undefined; // default — extractPageVision uses its built-in default
}

/**
 * Run vision-based extraction over a document buffer.
 *
 * @param buffer Raw file bytes
 * @param ext File extension (lowercase, no dot)
 * @param docType Original doc_type from the documents table
 * @param options Optional jobId for progress + promptTemplate
 */
export async function extractVision(
  buffer: Buffer,
  ext: string,
  docType: string,
  options: VisionExtractOptions = {},
): Promise<ExtractionResult> {
  const env = getEnv();
  const normalized = ext.toLowerCase().replace(/^\./, '');
  const dpi = env.VISION_PDF_DPI;
  const maxTokens = env.VISION_MAX_TOKENS;

  // Image: send directly as a single page
  if (normalized === 'image' || docType === 'image' || ['png', 'jpg', 'jpeg', 'webp'].includes(normalized)) {
    return extractImageDirect(buffer, maxTokens, options);
  }

  // PDF: render pages and process each
  if (normalized === 'pdf') {
    return extractPdfPages(buffer, dpi, maxTokens, options);
  }

  // DOCX/EPUB/ODT/RTF/HTML: convert to PDF first via pandoc, then render
  if (['docx', 'epub', 'odt', 'rtf', 'html'].includes(normalized)) {
    const pdfBuffer = await convertToPdfViaPandoc(buffer, normalized);
    return extractPdfPages(pdfBuffer, dpi, maxTokens, options);
  }

  throw new Error(`Vision extraction does not support .${normalized} files`);
}

/** Render a PDF buffer and run vision extraction page by page. */
async function extractPdfPages(
  buffer: Buffer,
  dpi: number,
  maxTokens: number,
  options: VisionExtractOptions,
): Promise<ExtractionResult> {
  const env = getEnv();
  const concurrency = env.VISION_CONCURRENCY;
  const customPrompt = getPromptForTemplate(options.promptTemplate);

  const rendered = await renderPdfPages(buffer, dpi);
  if (rendered.length === 0) {
    throw new Error('PDF rendered to zero pages');
  }

  logger.info(
    { pages: rendered.length, dpi, concurrency, prompt_template: options.promptTemplate ?? 'default' },
    'pdf rendered, dispatching to vision model',
  );

  // Initial progress
  if (options.jobId) {
    await updateJobProgress(options.jobId, 0, `Extracting ${rendered.length} pages`);
  }

  // Use a worker pool: up to `concurrency` pages extracted in parallel.
  // Local LM Studio handles one request at a time anyway; cloud APIs benefit from parallelism.
  const pages: ExtractedPage[] = new Array(rendered.length);
  let succeeded = 0;
  let failed = 0;
  let truncated = 0;
  let completed = 0;
  let cursor = 0;
  let cancelled = false;

  async function worker(): Promise<void> {
    while (!cancelled) {
      const idx = cursor++;
      if (idx >= rendered.length) return;
      const r = rendered[idx];

      // Cancellation check before each page
      if (options.jobId && (await isJobCancelled(options.jobId))) {
        cancelled = true;
        return;
      }

      try {
        const result = await extractPageVision({
          imagePng: r.image,
          maxTokens,
          prompt: customPrompt,
        });
        pages[idx] = {
          page_number: r.page_number,
          content: result.markdown,
          // Lower confidence if response was truncated by token budget
          confidence: result.finish_reason === 'length' ? 0.6 : 1.0,
        };
        if (result.finish_reason === 'length') truncated++;
        succeeded++;
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        logger.warn({ page: r.page_number, err: msg }, 'vision extraction failed for page');
        pages[idx] = {
          page_number: r.page_number,
          content: `> [extraction failed: ${msg}]`,
          confidence: 0,
        };
        failed++;
      }

      completed++;
      if (options.jobId) {
        const pct = (completed / rendered.length) * 100;
        await updateJobProgress(
          options.jobId,
          pct,
          `${completed}/${rendered.length} pages (${succeeded} ok, ${failed} failed)`,
        );
      }
    }
  }

  // Spawn `concurrency` workers
  const workers = Array.from({ length: Math.min(concurrency, rendered.length) }, () => worker());
  await Promise.all(workers);

  if (cancelled) {
    throw new JobCancelledError(`Cancelled after ${completed}/${rendered.length} pages`);
  }

  logger.info(
    { total_pages: rendered.length, succeeded, failed, truncated },
    'vision pdf extraction complete',
  );

  return {
    mode: 'vision',
    pages,
    total_pages: rendered.length,
  };
}

/** Send a raw image buffer directly to the vision model as a single page. */
async function extractImageDirect(
  buffer: Buffer,
  maxTokens: number,
  options: VisionExtractOptions,
): Promise<ExtractionResult> {
  const customPrompt = getPromptForTemplate(options.promptTemplate);

  if (options.jobId) {
    await updateJobProgress(options.jobId, 0, 'Extracting image');
  }

  const result = await extractPageVision({
    imagePng: buffer,
    maxTokens,
    prompt: customPrompt,
  });

  if (options.jobId) {
    await updateJobProgress(options.jobId, 100, '1/1 page complete');
  }

  logger.info({ chars: result.markdown.length }, 'vision image extraction complete');

  return {
    mode: 'vision',
    pages: [
      {
        page_number: 1,
        content: result.markdown,
        confidence: 1.0,
      },
    ],
    total_pages: 1,
  };
}

/**
 * Convert a non-PDF document to PDF via pandoc.
 * Used for DOCX/EPUB/ODT/RTF/HTML → vision flow.
 *
 * Note: this requires pandoc with a working PDF engine (pdflatex, weasyprint, etc.).
 * Alpine doesn't ship with one by default — for v1 we expect this to fail and the
 * user falls back to Quality Text mode for those formats.
 */
async function convertToPdfViaPandoc(buffer: Buffer, ext: string): Promise<Buffer> {
  const tmp = await mkdtemp(path.join(tmpdir(), 'pandoc-pdf-'));
  const inputPath = path.join(tmp, `input.${ext}`);
  const outputPath = path.join(tmp, 'output.pdf');

  try {
    await writeFile(inputPath, buffer);
    await runPandoc(['-f', ext, '-o', outputPath, inputPath]);
    return await readFile(outputPath);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    throw new Error(
      `Cannot convert .${ext} to PDF for vision extraction: ${msg}. ` +
        `Use Quality Text mode for this format instead.`,
    );
  } finally {
    await rm(tmp, { recursive: true, force: true }).catch(() => {});
  }
}

function runPandoc(args: string[]): Promise<void> {
  return new Promise((resolve, reject) => {
    const child = spawn('pandoc', args, { stdio: ['ignore', 'ignore', 'pipe'] });
    const errChunks: Buffer[] = [];
    child.stderr.on('data', (c) => errChunks.push(c));
    child.on('error', (err) => reject(new Error(`pandoc not available: ${err.message}`)));
    child.on('close', (code) => {
      if (code !== 0) {
        const stderr = Buffer.concat(errChunks).toString('utf-8').slice(0, 500);
        reject(new Error(`pandoc exited ${code}: ${stderr}`));
        return;
      }
      resolve();
    });
  });
}
