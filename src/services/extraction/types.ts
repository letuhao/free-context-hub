/** Phase 10 — extraction pipeline types */

export type ExtractionMode = 'fast' | 'quality' | 'vision';

export type ChunkType = 'text' | 'table' | 'diagram_description' | 'mermaid' | 'code';

export type ChunkTemplate = 'auto' | 'naive' | 'hierarchical';

/** A single page of extracted content (markdown). */
export interface ExtractedPage {
  /** 1-indexed page number, null for formats without pages (DOCX, EPUB, etc.) */
  page_number: number | null;
  /** Markdown content */
  content: string;
  /** Optional confidence 0-1 (vision mode only for v1) */
  confidence?: number;
}

/** Result of an extraction operation. */
export interface ExtractionResult {
  mode: ExtractionMode;
  pages: ExtractedPage[];
  total_pages: number;
}

/** A chunk before it is persisted (no DB-assigned fields). */
export interface PreChunk {
  content: string;
  page_number: number | null;
  heading: string | null;
  chunk_type: ChunkType;
}

/** A persisted document chunk row (matches document_chunks table columns). */
export interface DocumentChunk {
  chunk_id: string;
  doc_id: string;
  project_id: string;
  chunk_index: number;
  content: string;
  page_number: number | null;
  heading: string | null;
  chunk_type: ChunkType;
  extraction_mode: ExtractionMode | null;
  confidence: number | null;
  created_at: string;
}

/** Options for the chunker. */
export interface ChunkOptions {
  template?: ChunkTemplate;
  /** Approximate max tokens per chunk. ~4 chars per token, so default 512 ≈ 2048 chars. */
  maxTokens?: number;
  /** Overlap tokens between consecutive chunks (continuity). */
  overlapTokens?: number;
}
