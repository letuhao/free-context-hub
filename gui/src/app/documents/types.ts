/** Shared types for the documents feature. */

export type DocType =
  | "pdf"
  | "markdown"
  | "url"
  | "text"
  | "docx"
  | "image"
  | "epub"
  | "odt"
  | "rtf"
  | "html";

export type DocFilter = "all" | "pdf" | "markdown" | "url" | "linked" | "unlinked";

export interface Doc {
  doc_id: string;
  name: string;
  doc_type: DocType;
  url: string | null;
  file_size_bytes: number | null;
  description: string | null;
  created_at: string;
  linked_lesson_count?: number;
}

export type ChunkType = "text" | "table" | "diagram_description" | "mermaid" | "code";

export type ExtractionMode = "fast" | "quality" | "vision";

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
  updated_at?: string;
}
