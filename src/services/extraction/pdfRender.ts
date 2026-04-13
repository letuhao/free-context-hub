/**
 * PDF page renderer using pdftoppm (poppler-utils).
 * Renders each PDF page to a PNG buffer, no native Node deps.
 */

import { spawn } from 'node:child_process';
import { mkdtemp, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { createModuleLogger } from '../../utils/logger.js';

const logger = createModuleLogger('extraction:pdfRender');

export interface RenderedPage {
  page_number: number;
  /** PNG bytes */
  image: Buffer;
}

/**
 * Render every page of a PDF buffer to PNG via pdftoppm.
 *
 * @param buffer Raw PDF bytes
 * @param dpi Resolution in DPI (default 150 — good balance of quality/size)
 */
export async function renderPdfPages(buffer: Buffer, dpi = 150): Promise<RenderedPage[]> {
  const tmp = await mkdtemp(path.join(tmpdir(), 'pdfrender-'));
  const inputPath = path.join(tmp, 'input.pdf');
  const outputPrefix = path.join(tmp, 'page');

  try {
    await writeFile(inputPath, buffer);

    // pdftoppm -png -r <dpi> <input> <output_prefix>
    // Produces output_prefix-1.png, output_prefix-2.png, etc.
    await runPdftoppm(['-png', '-r', String(dpi), inputPath, outputPrefix]);

    // Read all generated PNGs in numeric order
    const files = (await readdir(tmp))
      .filter((f) => f.startsWith('page-') && f.endsWith('.png'))
      .sort((a, b) => extractPageNumber(a) - extractPageNumber(b));

    const pages: RenderedPage[] = [];
    for (const file of files) {
      const image = await readFile(path.join(tmp, file));
      pages.push({
        page_number: extractPageNumber(file),
        image,
      });
    }

    logger.info({ pages: pages.length, totalBytes: pages.reduce((s, p) => s + p.image.length, 0) }, 'pdf rendered');
    return pages;
  } finally {
    // Cleanup tmp dir
    await rm(tmp, { recursive: true, force: true }).catch(() => {});
  }
}

/** Extract the page number from a filename like "page-3.png" or "page-12.png". */
function extractPageNumber(filename: string): number {
  const match = filename.match(/page-(\d+)\.png$/);
  return match ? parseInt(match[1], 10) : 0;
}

/** Spawn pdftoppm with the given args. Rejects on non-zero exit. */
function runPdftoppm(args: string[]): Promise<void> {
  return new Promise((resolve, reject) => {
    const child = spawn('pdftoppm', args, { stdio: ['ignore', 'ignore', 'pipe'] });
    const errChunks: Buffer[] = [];
    child.stderr.on('data', (c) => errChunks.push(c));
    child.on('error', (err) => reject(new Error(`pdftoppm not available: ${err.message}`)));
    child.on('close', (code) => {
      if (code !== 0) {
        const stderr = Buffer.concat(errChunks).toString('utf-8').slice(0, 500);
        reject(new Error(`pdftoppm exited ${code}: ${stderr}`));
        return;
      }
      resolve();
    });
  });
}

/**
 * Get the page count of a PDF without rendering it.
 * Uses `pdfinfo` (poppler-utils) which is fast.
 */
export async function getPdfPageCount(buffer: Buffer): Promise<number> {
  const tmp = await mkdtemp(path.join(tmpdir(), 'pdfinfo-'));
  const inputPath = path.join(tmp, 'input.pdf');
  try {
    await writeFile(inputPath, buffer);
    const output = await runPdfinfo(inputPath);
    const match = output.match(/Pages:\s+(\d+)/);
    if (!match) throw new Error('Could not parse page count from pdfinfo');
    return parseInt(match[1], 10);
  } finally {
    await rm(tmp, { recursive: true, force: true }).catch(() => {});
  }
}

function runPdfinfo(filePath: string): Promise<string> {
  return new Promise((resolve, reject) => {
    const child = spawn('pdfinfo', [filePath], { stdio: ['ignore', 'pipe', 'pipe'] });
    const outChunks: Buffer[] = [];
    const errChunks: Buffer[] = [];
    child.stdout.on('data', (c) => outChunks.push(c));
    child.stderr.on('data', (c) => errChunks.push(c));
    child.on('error', (err) => reject(new Error(`pdfinfo not available: ${err.message}`)));
    child.on('close', (code) => {
      if (code !== 0) {
        const stderr = Buffer.concat(errChunks).toString('utf-8').slice(0, 500);
        reject(new Error(`pdfinfo exited ${code}: ${stderr}`));
        return;
      }
      resolve(Buffer.concat(outChunks).toString('utf-8'));
    });
  });
}
