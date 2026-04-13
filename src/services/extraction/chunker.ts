/**
 * Chunking service for extracted document content.
 * Two strategies:
 *
 *   - hierarchical: splits at markdown headings (# / ## / ###), produces one
 *     chunk per section (or sub-chunks if section exceeds maxTokens).
 *
 *   - naive: splits by paragraph boundaries with a token budget and overlap.
 *     Falls back when no headings are present.
 *
 * Auto template picks hierarchical when the document has H1/H2/H3 headings,
 * naive otherwise. Tables and code blocks are kept intact (not split mid-row).
 */

import { createModuleLogger } from '../../utils/logger.js';
import type {
  ExtractionResult,
  PreChunk,
  ChunkOptions,
  ChunkType,
} from './types.js';

const logger = createModuleLogger('extraction:chunker');

const DEFAULT_MAX_TOKENS = 512;
const DEFAULT_OVERLAP_TOKENS = 50;
const CHARS_PER_TOKEN = 4; // approximate, English-biased

/** Top-level chunker. Dispatches to naive/hierarchical based on template. */
export function chunkDocument(
  result: ExtractionResult,
  options?: ChunkOptions,
): PreChunk[] {
  const template = options?.template ?? 'auto';
  const maxTokens = options?.maxTokens ?? DEFAULT_MAX_TOKENS;
  const overlapTokens = options?.overlapTokens ?? DEFAULT_OVERLAP_TOKENS;

  const chunks: PreChunk[] = [];

  for (const page of result.pages) {
    if (!page.content.trim()) continue;

    const useHierarchical =
      template === 'hierarchical' ||
      (template === 'auto' && hasHeadings(page.content));

    const pageChunks = useHierarchical
      ? hierarchicalChunk(page.content, page.page_number, maxTokens)
      : naiveChunk(page.content, page.page_number, maxTokens, overlapTokens);

    chunks.push(...pageChunks);
  }

  logger.info(
    { chunks: chunks.length, pages: result.pages.length, template },
    'document chunked',
  );

  return chunks;
}

/** Detect if markdown contains at least one heading. */
function hasHeadings(markdown: string): boolean {
  return /^#{1,3}\s+\S/m.test(markdown);
}

/**
 * Hierarchical chunker: splits at H1/H2/H3 headings, one chunk per section.
 * If a section exceeds maxTokens, it is further split via naive chunker.
 */
function hierarchicalChunk(
  markdown: string,
  pageNumber: number | null,
  maxTokens: number,
): PreChunk[] {
  const lines = markdown.split('\n');
  const sections: { heading: string | null; content: string[] }[] = [];
  let current: { heading: string | null; content: string[] } = {
    heading: null,
    content: [],
  };

  for (const line of lines) {
    const headingMatch = line.match(/^#{1,3}\s+(.+)$/);
    if (headingMatch) {
      // Flush current section if it has content
      if (current.content.length > 0 || current.heading) {
        sections.push(current);
      }
      current = { heading: headingMatch[1].trim(), content: [] };
    } else {
      current.content.push(line);
    }
  }
  if (current.content.length > 0 || current.heading) {
    sections.push(current);
  }

  const chunks: PreChunk[] = [];
  const maxChars = maxTokens * CHARS_PER_TOKEN;

  for (const section of sections) {
    const body = section.content.join('\n').trim();
    if (!body && !section.heading) continue;

    const fullContent = section.heading
      ? `## ${section.heading}\n\n${body}`
      : body;

    if (fullContent.length <= maxChars) {
      chunks.push({
        content: fullContent,
        page_number: pageNumber,
        heading: section.heading,
        chunk_type: detectChunkType(fullContent),
      });
    } else {
      // Section too large — split it with naive chunker, preserve heading on each chunk
      const subChunks = naiveChunk(body, pageNumber, maxTokens, 0);
      subChunks.forEach((sub, i) => {
        chunks.push({
          content: section.heading
            ? `## ${section.heading} (part ${i + 1})\n\n${sub.content}`
            : sub.content,
          page_number: pageNumber,
          heading: section.heading,
          chunk_type: sub.chunk_type,
        });
      });
    }
  }

  return chunks;
}

/**
 * Naive chunker: splits text by paragraph, accumulates until token budget,
 * preserves overlap tokens at chunk boundaries.
 *
 * Tables (lines starting with |) and code blocks (```) are kept intact.
 */
function naiveChunk(
  content: string,
  pageNumber: number | null,
  maxTokens: number,
  overlapTokens: number,
): PreChunk[] {
  const maxChars = maxTokens * CHARS_PER_TOKEN;
  const overlapChars = overlapTokens * CHARS_PER_TOKEN;

  // Pre-split: respect code blocks and tables as atomic units
  const blocks = splitIntoBlocks(content);

  const chunks: PreChunk[] = [];
  let buf = '';
  let bufType: ChunkType = 'text';

  const flush = () => {
    if (buf.trim()) {
      chunks.push({
        content: buf.trim(),
        page_number: pageNumber,
        heading: null,
        chunk_type: bufType,
      });
    }
    buf = '';
    bufType = 'text';
  };

  for (const block of blocks) {
    // If this block alone exceeds the budget, emit it as its own chunk
    if (block.text.length > maxChars) {
      flush();
      chunks.push({
        content: block.text.trim(),
        page_number: pageNumber,
        heading: null,
        chunk_type: block.type,
      });
      continue;
    }

    // Adding this block would overflow — flush first
    if (buf.length + block.text.length + 2 > maxChars) {
      // Apply overlap: keep the tail of the current buffer as the start of the next
      const tail = overlapChars > 0 ? buf.slice(-overlapChars) : '';
      flush();
      buf = tail;
      bufType = 'text';
    }

    buf += (buf ? '\n\n' : '') + block.text;
    // Promote chunk type if a table or code block was added
    if (block.type !== 'text' && bufType === 'text') {
      bufType = block.type;
    }
  }
  flush();

  return chunks;
}

/** Split markdown content into blocks: paragraphs, tables, code blocks. */
function splitIntoBlocks(content: string): { text: string; type: ChunkType }[] {
  const blocks: { text: string; type: ChunkType }[] = [];
  const lines = content.split('\n');
  let i = 0;

  while (i < lines.length) {
    const line = lines[i];

    // Code block ``` ... ```
    if (line.trim().startsWith('```')) {
      const start = i;
      i++;
      while (i < lines.length && !lines[i].trim().startsWith('```')) i++;
      const codeText = lines.slice(start, i + 1).join('\n');
      blocks.push({ text: codeText, type: 'code' });
      i++;
      continue;
    }

    // Table block — line starts with | and next line has | and dashes
    if (line.trim().startsWith('|')) {
      const start = i;
      i++;
      while (i < lines.length && lines[i].trim().startsWith('|')) i++;
      const tableText = lines.slice(start, i).join('\n');
      // Only treat as table if at least 2 lines (header + separator)
      if (i - start >= 2) {
        blocks.push({ text: tableText, type: 'table' });
        continue;
      } else {
        // Single line starting with | — treat as text
        blocks.push({ text: tableText, type: 'text' });
        continue;
      }
    }

    // Regular paragraph: collect lines until blank
    const start = i;
    while (i < lines.length && lines[i].trim() !== '' && !lines[i].trim().startsWith('```') && !lines[i].trim().startsWith('|')) {
      i++;
    }
    const paragraph = lines.slice(start, i).join('\n').trim();
    if (paragraph) {
      blocks.push({ text: paragraph, type: 'text' });
    }
    // Skip blank lines
    while (i < lines.length && lines[i].trim() === '') i++;
  }

  return blocks;
}

/** Detect chunk type from content (used for hierarchical sections). */
function detectChunkType(content: string): ChunkType {
  if (content.includes('```')) return 'code';
  // Multi-line table heuristic: 2+ lines starting with |
  const tableLines = content.split('\n').filter((l) => l.trim().startsWith('|'));
  if (tableLines.length >= 2) return 'table';
  if (content.includes('```mermaid')) return 'mermaid';
  return 'text';
}
