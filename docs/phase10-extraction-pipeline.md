# Phase 10 — Multi-Format Extraction Pipeline

## Design Principles

1. **User chooses the mode** — text extraction (free, fast) or vision extraction (uses configured model provider). No forced dependency on any API.
2. **Human always reviews** — even the strongest models fail on complex documents. Every extraction ends at a review/edit step before saving. The system never auto-saves without approval.
3. **Progressive enhancement** — text extraction works out of the box with zero config. Vision extraction is available when the user has a model provider configured.
4. **Reuse existing infrastructure** — Model Providers settings, Feature Assignment, document viewer, rich editor, `generateLessonsFromDoc`, and the lesson CRUD pipeline all exist. Phase 10 adds the extraction frontend, not a new architecture.

---

## Pipeline Overview

```
┌──────────────────────────────────────────────────────────────────┐
│  1. UPLOAD                                                       │
│  User uploads PDF, DOCX, or image(s)                             │
│  → stored as document in DB (existing flow)                      │
└──────────────────────┬───────────────────────────────────────────┘
                       │
┌──────────────────────▼───────────────────────────────────────────┐
│  2. MODE SELECT                                                  │
│  User picks extraction mode:                                     │
│                                                                   │
│  ┌─────────────────────┐  ┌──────────────────────────────┐       │
│  │  📄 Text Extraction │  │  👁 Vision Extraction         │       │
│  │  Fast, free, local  │  │  Uses model provider          │       │
│  │  Best for text docs │  │  Best for diagrams/tables     │       │
│  └─────────────────────┘  └──────────────────────────────┘       │
└──────────────────────┬───────────────────────────────────────────┘
                       │
┌──────────────────────▼───────────────────────────────────────────┐
│  3. EXTRACT                                                      │
│                                                                   │
│  Text mode:                                                       │
│  ├─ PDF  → pdf-parse (npm) → raw text                            │
│  ├─ DOCX → mammoth (npm) → HTML → markdown                      │
│  └─ Image → skip (no text to extract, prompt user for vision)    │
│                                                                   │
│  Vision mode:                                                     │
│  ├─ PDF  → render pages as images (pdfjs-dist)                   │
│  │         → send each page image to vision model                │
│  │         → receive structured markdown per page                │
│  ├─ DOCX → convert to PDF first, then same as PDF               │
│  └─ Image → send directly to vision model                        │
│                                                                   │
│  Output: array of { page_number, content_markdown, confidence }  │
└──────────────────────┬───────────────────────────────────────────┘
                       │
┌──────────────────────▼───────────────────────────────────────────┐
│  4. REVIEW & EDIT                                                │
│                                                                   │
│  Split-pane view:                                                 │
│  ┌──────────────────┬──────────────────────┐                     │
│  │  Original        │  Extracted Text      │                     │
│  │  (PDF viewer /   │  (Rich markdown      │                     │
│  │   image preview) │   editor)            │                     │
│  │                  │                      │                     │
│  │  Page 1 of 5     │  User edits/corrects │                     │
│  │  [< prev] [next >]  errors here        │                     │
│  └──────────────────┴──────────────────────┘                     │
│                                                                   │
│  Per-page actions: Accept / Edit / Skip / Re-extract             │
│  "Re-extract" sends page to vision model if initially text-only  │
└──────────────────────┬───────────────────────────────────────────┘
                       │
┌──────────────────────▼───────────────────────────────────────────┐
│  5. SAVE                                                         │
│                                                                   │
│  User chooses what to create:                                     │
│  ├─ Save as document content (updates the document's text)       │
│  ├─ Generate lessons (existing generateLessonsFromDoc flow)      │
│  └─ Both                                                         │
│                                                                   │
│  Extracted text stored in documents.content column                │
│  Lessons go through normal CRUD + review workflow                │
└──────────────────────────────────────────────────────────────────┘
```

---

## Extraction Modes in Detail

### Text Extraction (no model required)

| Format | Library | Output | Limitations |
|--------|---------|--------|-------------|
| PDF | `pdf-parse` | Plain text, preserves paragraphs | No tables, no images, no layout |
| DOCX | `mammoth` | HTML → markdown via turndown | Loses complex formatting, no embedded images |
| Image | N/A | Not supported — prompts user to switch to vision | — |

**When to use:** Meeting notes, text-heavy specs, RFCs, code docs, plain contracts.

### Vision Extraction (requires model provider)

| Format | Pre-processing | Model input | Expected output |
|--------|---------------|-------------|-----------------|
| PDF | Render each page as PNG via `pdfjs-dist` | Page image + prompt | Structured markdown |
| DOCX | Convert to PDF first (libreoffice headless or docx-pdf), then same as PDF | Page image + prompt | Structured markdown |
| Image | Direct | Image + prompt | Structured markdown |

**Prompt template for vision extraction (default):**
```
Extract all content from this document page as structured markdown.

Rules:
- Preserve headings, lists, and paragraph structure
- Reproduce tables as markdown tables
- Note any text you're uncertain about with [?]
- If the page is mostly a diagram, describe what it shows

Output only the markdown content, no commentary.
```

**Prompt template for Mermaid diagram extraction:**

When the user clicks "Extract as Mermaid" on a page with a detected diagram, or when the system auto-detects a diagram-heavy page, use this prompt:

```
This page contains a diagram. Reproduce it as Mermaid code.

Rules:
- Use the most appropriate Mermaid diagram type (graph, sequenceDiagram, classDiagram, flowchart, etc.)
- Preserve all node labels, edge labels, and directional relationships
- If the diagram has a title or caption, include it as a comment
- After the Mermaid code block, add a brief text summary of what the diagram shows
- If you cannot reproduce it as Mermaid, describe it in structured text instead

Output format:
```mermaid
[diagram code]
```

Summary: [1-2 sentence description]
```

**When to offer Mermaid extraction:**
- Page has a detected diagram (low text density + visual layout elements)
- User manually clicks "Extract as Mermaid" on any page
- The vision model prompt mentions flowcharts, architecture diagrams, sequence diagrams, ER diagrams, state machines

**Mermaid output is stored as:**
- `chunk_type: "mermaid"` in document_chunks
- Raw Mermaid code in `content` field
- Rendered preview in the review UI (using a Mermaid renderer like `mermaid.js`)
- Text summary stored alongside for search/embedding (Mermaid syntax alone embeds poorly)

**When to use:** Architecture diagrams, UI mockups, scanned docs, presentation slides, documents with tables/charts.

---

## Feature Assignment Integration

The extraction feature maps to the existing Model Providers / Feature Assignment system:

| Feature Key | Description | Default |
|---|---|---|
| `document_extraction` | Vision model for document extraction | Not assigned (text-only mode available) |

When `document_extraction` has no model assigned → vision mode is disabled in the UI, only text mode shown. When assigned → both modes available.

---

## Backend API

### New endpoints

```
POST /api/documents/:id/extract
  Body: { mode: "text" | "vision", pages?: number[] }
  Returns: { pages: [{ page: 1, content: "...", confidence: 0.95 }] }
  
  - Text mode: extracts immediately, returns result
  - Vision mode: enqueues a job (can be slow), returns job_id
  - pages param: optional, extract specific pages only (for re-extract)

GET /api/documents/:id/extraction
  Returns: { pages: [...], status: "complete" | "processing" }
  
  - Polling endpoint for vision extraction progress

PUT /api/documents/:id/extraction
  Body: { pages: [{ page: 1, content: "edited content" }] }
  
  - Save reviewed/edited extraction results back to document
```

### Job type (for vision extraction)

```
Job type: "document_extract"
Payload: { doc_id, project_id, mode: "vision", pages: [1,2,3] }
```

Runs in the existing worker queue, calls model provider for each page.

---

## GUI Components

### New / Modified

| Component | Type | Description |
|---|---|---|
| `ExtractionModeSelector` | New | Two-card selector: Text vs Vision mode |
| `ExtractionReview` | New | Split-pane: original preview + markdown editor |
| `PageNavigator` | New | Page prev/next + thumbnails for multi-page docs |
| `DocumentViewer` | Modified | Add "Extract" button next to "Generate Lessons" |
| `UploadDialog` | Modified | Add extraction mode step after upload |

### Flow in the UI

1. User uploads document (existing flow) → document appears in `/documents`
2. User clicks "Extract" on the document row or viewer
3. `ExtractionModeSelector` appears — pick Text or Vision
4. Extraction runs (instant for text, shows progress for vision)
5. `ExtractionReview` opens — split pane with original + extracted markdown
6. User reviews, edits corrections page by page
7. User clicks "Save" → content stored, optionally generate lessons

---

## Dependencies (npm)

### Required (text extraction)
- `pdf-parse` — PDF text extraction (already lightweight, no native deps)
- `mammoth` — DOCX to HTML conversion

### Required (vision extraction)
- `pdfjs-dist` — PDF page rendering to canvas/image (Mozilla's PDF.js)
- `canvas` or `sharp` — server-side image rendering for PDF pages (Node.js)

### Optional
- `turndown` — HTML to markdown conversion (for mammoth DOCX output)

No Python dependencies. Everything runs in Node.js.

---

## Phasing

| Sprint | Scope |
|--------|-------|
| 10.1 | Text extraction backend (pdf-parse + mammoth), new API endpoints |
| 10.2 | Extraction review UI (split pane, page navigator, edit/save) |
| 10.3 | Vision extraction backend (pdfjs-dist rendering, model provider integration, job queue) |
| 10.4 | Vision mode UI (mode selector, progress indicator, re-extract per page) |
| 10.5 | Image upload support (direct vision extraction for screenshots/photos) |
| 10.6 | Polish + integration tests |

Text extraction (10.1-10.2) ships first and is useful on its own. Vision extraction (10.3-10.4) adds on top.

---

## Review: Context Engineering & Data Engineering Concerns

### Problem 1: No Chunking Strategy — Documents Don't Reach Semantic Search

**Current state:** The `documents.content` column stores the full extracted text as one blob. Lessons have embeddings (`vector(768)`) and are semantically searchable. Documents are NOT embedded — they're only searchable via the `document_lessons` link table.

**Impact:** A 50-page PDF gets extracted to one huge text field. It's not chunked, not embedded, not searchable via semantic search. The only way to find it is by document name or by lessons linked to it.

**Fix — Add document chunking layer:**

```
Extracted text → chunk by semantic boundaries → embed each chunk → store in document_chunks table
```

New table:
```sql
CREATE TABLE document_chunks (
  chunk_id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  doc_id UUID NOT NULL REFERENCES documents(doc_id) ON DELETE CASCADE,
  project_id TEXT NOT NULL,
  chunk_index INT NOT NULL,
  content TEXT NOT NULL,
  page_number INT,               -- source page (for PDF)
  heading TEXT,                   -- section heading if detected
  chunk_type TEXT DEFAULT 'text', -- 'text' | 'table' | 'diagram_description' | 'mermaid' | 'code'
  embedding vector(768),
  fts tsvector,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX ON document_chunks(doc_id, chunk_index);
CREATE INDEX ON document_chunks USING hnsw (embedding vector_cosine_ops);
CREATE INDEX ON document_chunks USING gin (fts);
```

**Chunking strategy (rule-based, no LLM):**
1. Split by headings (H1/H2/H3 in markdown → natural section boundaries)
2. Within sections, split at ~500 tokens (overlap 50 tokens for context continuity)
3. Keep tables as single chunks (don't split mid-row)
4. Keep code blocks as single chunks
5. Tag each chunk with `chunk_type` for retrieval filtering

This makes documents first-class citizens in semantic search alongside lessons.

---

### Problem 2: No Provenance Tracking — Can't Trace Back to Source Page

**Current state:** When a lesson is generated from a document, the link is `document_lessons(doc_id, lesson_id)`. No page number, no source text, no extraction confidence.

**Impact:** User sees a generated lesson and thinks "where did this come from in the original document?" — no way to answer that. This is critical for review trust.

**Fix — Enrich the extraction metadata:**

```sql
-- Add to document_chunks
ALTER TABLE document_chunks ADD COLUMN confidence REAL; -- extraction confidence 0-1
ALTER TABLE document_chunks ADD COLUMN extraction_mode TEXT; -- 'text' | 'vision'

-- Add to document_lessons (or a new table)
ALTER TABLE document_lessons ADD COLUMN source_chunk_id UUID REFERENCES document_chunks(chunk_id);
ALTER TABLE document_lessons ADD COLUMN source_page INT;
```

When generating lessons from a document:
- Link each lesson to the specific chunk it was derived from
- Store the page number for "jump to source" in the UI
- Store extraction mode so the user knows if it was text-extracted or vision-extracted

---

### Problem 3: Vision Prompt Is Too Generic — Loses Structured Data

**Current state:** The vision prompt says "Extract all content as structured markdown." This works for simple pages but fails on:
- **Tables:** Model may describe the table instead of reproducing it
- **Diagrams:** "Flowchart: A → B → C" loses the actual relationships
- **Mixed content:** No separation between text, tables, and diagrams

**Fix — Use structured extraction with typed output:**

Instead of one generic prompt, use a two-pass approach:

**Pass 1: Classify page content type**
```
What types of content are on this page?
Reply as JSON: { "types": ["text", "table", "diagram", "code", "image"] }
```

**Pass 2: Extract per content type** (different prompts per type)

| Type | Prompt strategy | Output format |
|------|----------------|---------------|
| text | "Extract as markdown with headings" | Markdown |
| table | "Reproduce this table as a markdown table. Preserve all cells." | Markdown table |
| diagram | "Describe this diagram as: 1) a title, 2) a structured description of nodes and edges, 3) a text summary" | Structured JSON + text |
| code | "Extract the code exactly, preserving formatting. Identify the language." | Fenced code block |
| image | "Describe what this image shows in detail" | Text description |

This produces **typed chunks** from vision extraction — tables stay as tables, diagrams get both a description and a structured representation, code stays as code. Each becomes a `document_chunk` with the right `chunk_type`.

---

### Problem 4: No Quality Signal — User Can't Prioritize Review Effort

**Current state:** All extracted pages look the same in the review UI. User has to read every page to find errors.

**Fix — Add confidence scoring and visual quality indicators:**

For text extraction:
- Pages with very low text density (< 50 chars) → flag as "possibly image/diagram, consider vision mode"
- Pages with encoding artifacts (repeated `???`, `□`) → flag as "extraction may have failed"

For vision extraction:
- If the model uses `[?]` markers → count them, show as confidence score
- Compare text extraction vs vision extraction overlap → low overlap = likely diagram-heavy

In the review UI:
- Show per-page confidence: green (high) / yellow (medium) / red (low)
- Sort pages by confidence ascending — review worst pages first
- "Auto-accept" option for pages above a confidence threshold

---

### Problem 5: No Deduplication — Same PDF Uploaded Twice Creates Duplicate Chunks

**Current state:** The `documents` table has no uniqueness constraint on content. Upload the same PDF twice → duplicate chunks, duplicate embeddings, duplicate search results.

**Fix — Content-hash deduplication:**

```sql
ALTER TABLE documents ADD COLUMN content_hash TEXT;
CREATE UNIQUE INDEX ON documents(project_id, content_hash) WHERE content_hash IS NOT NULL;
```

On upload:
1. Compute SHA-256 of file bytes
2. Check if `content_hash` already exists for this project
3. If yes → show "This document was already uploaded on {date}" with option to re-extract
4. If no → proceed normally

For re-extraction:
- Don't create a new document — update the existing one
- Preserve existing lesson links
- Show diff between old and new extraction in the review UI

---

### Problem 6: generateLessonsFromDoc Receives Unstructured Text — No Context Boundaries

**Current state:** `generateLessonsFromDocument` takes `docContent: string` — the entire document text as one string. The LLM has to figure out where one topic ends and another begins.

**Impact:** For short docs this works. For a 50-page PDF, the LLM either truncates (context limit) or produces generic summaries that miss specific details.

**Fix — Generate lessons per chunk, not per document:**

```
Document → chunks → for each meaningful chunk:
  → generateLessonsFromChunk(chunk.content, chunk.chunk_type, chunk.heading)
  → link generated lesson to source chunk
```

Benefits:
- Each lesson has a clear, traceable source
- No context window overflow
- Chunk type informs the prompt (table → "extract data rules", diagram → "describe the architecture decision", code → "document the pattern")
- User reviews per-chunk lessons in the context of the original page

---

### Problem 7: doc_type CHECK Constraint Doesn't Support New Formats

**Current state:** `documents.doc_type` has `CHECK (doc_type IN ('pdf', 'markdown', 'url', 'text'))`. Images aren't supported.

**Fix — Migration to add image types:**

```sql
ALTER TABLE documents DROP CONSTRAINT IF EXISTS documents_doc_type_check;
ALTER TABLE documents ADD CONSTRAINT documents_doc_type_check
  CHECK (doc_type IN ('pdf', 'markdown', 'url', 'text', 'docx', 'image'));
```

---

### Revised Pipeline with Fixes Applied

```
┌─────────────────────────────────────────────────────────────────┐
│  1. UPLOAD + DEDUP                                              │
│  Upload file → hash → check duplicate → store in documents      │
│  New doc_types: 'docx', 'image' (migration)                    │
└──────────────────────┬──────────────────────────────────────────┘
                       │
┌──────────────────────▼──────────────────────────────────────────┐
│  2. MODE SELECT                                                 │
│  Text (free) / Vision (model provider)                          │
│  Image uploads → auto-select vision, no text option             │
└──────────────────────┬──────────────────────────────────────────┘
                       │
┌──────────────────────▼──────────────────────────────────────────┐
│  3. EXTRACT + CLASSIFY                                          │
│                                                                  │
│  Text mode: pdf-parse / mammoth → raw markdown                  │
│  Vision mode:                                                    │
│    Pass 1: classify page content types                          │
│    Pass 2: extract per type (text/table/diagram/code)           │
│                                                                  │
│  Output: typed chunks with page numbers + confidence scores     │
└──────────────────────┬──────────────────────────────────────────┘
                       │
┌──────────────────────▼──────────────────────────────────────────┐
│  4. CHUNK + EMBED                                               │
│                                                                  │
│  Split extracted text into semantic chunks:                      │
│  - By headings (H1/H2/H3)                                      │
│  - Within sections: ~500 tokens, 50 token overlap               │
│  - Tables and code blocks kept as single chunks                 │
│                                                                  │
│  Each chunk → embed → store in document_chunks table            │
│  Tag: chunk_type, page_number, heading, confidence              │
│                                                                  │
│  Documents now searchable via semantic search                   │
└──────────────────────┬──────────────────────────────────────────┘
                       │
┌──────────────────────▼──────────────────────────────────────────┐
│  5. REVIEW & EDIT (human-in-the-loop)                           │
│                                                                  │
│  Split-pane: original page ↔ extracted markdown                 │
│  Per-page confidence: 🟢 high / 🟡 medium / 🔴 low              │
│  Sort by confidence ascending — worst pages first               │
│  Per-page: Accept / Edit / Skip / Re-extract (switch mode)     │
│  Auto-accept option for pages above threshold                   │
└──────────────────────┬──────────────────────────────────────────┘
                       │
┌──────────────────────▼──────────────────────────────────────────┐
│  6. SAVE + GENERATE                                             │
│                                                                  │
│  Save reviewed chunks to document_chunks table                  │
│  Update documents.content with merged full text                 │
│  Optionally: generate lessons per chunk (not per document)      │
│  Each lesson linked to source chunk + page number               │
│  Lessons enter normal review workflow (draft → active)          │
└─────────────────────────────────────────────────────────────────┘
```

### Revised Phasing

| Sprint | Scope |
|--------|-------|
| 10.1 | Migration (doc_type, document_chunks table), text extraction backend, chunking + embedding |
| 10.2 | Extraction review UI (split pane, page nav, confidence indicators) |
| 10.3 | Vision extraction backend (classify + typed extraction, model provider) |
| 10.4 | Vision mode UI, deduplication, per-chunk lesson generation |
| 10.5 | Image upload, auto-accept, quality indicators |
| 10.6 | Polish + integration tests |

---

## Review Round 2: Security

### Problem 8: File Upload Has No Content Validation Beyond Extension

**Current state:** `multer` accepts up to 10MB. `doc_type` is from file extension only. No MIME check, no magic byte validation, no page count limit.

**Risks:**
- Malicious file renamed to `.pdf` (executable, zip bomb)
- Decompression bomb in PDF causing memory exhaustion in pdf-parse
- 1000+ page PDFs causing OOM in pdfjs-dist rendering
- Path traversal in filename (`../../etc/passwd.pdf`)

**Fixes:**
1. Validate MIME type matches extension
2. Magic byte check: `%PDF` for PDF, `PK` for DOCX, `\x89PNG` / `\xFF\xD8` for images
3. Page count limit after parsing (default 200, configurable)
4. Per-page render timeout (5s) for pdfjs-dist
5. Sanitize filenames: strip `../`, null bytes, control chars

### Problem 9: Vision Extraction Sends Content to External APIs

User uploads a confidential doc, clicks vision extraction — content goes to Claude/OpenAI without explicit consent.

**Fixes:**
1. Explicit warning before vision extraction: "This sends page images to {provider}. Confirm?"
2. Log `extraction_provider` in document metadata for audit trail
3. Highlight when a local-only model is available (no data leaves machine)

### Problem 10: Extracted Content May Contain XSS Payloads

A crafted PDF with `<script>alert('xss')</script>` in text gets extracted and rendered in the markdown editor or lesson content.

**Fix:** Sanitize extracted text before storage — strip HTML tags, script content. Verify `MarkdownContent` component sanitizes or uses `dangerouslySetInnerHTML` safely.

---

## Review Round 3: Cost & Resources

### Problem 11: Vision Extraction Cost Is Unpredictable

50-page PDF = 50 vision API calls. Sonnet: ~$0.50-1.50. Opus: ~$7.50. User has no warning.

**Fixes:**
1. Show cost estimate before extraction: "{N} pages, ~${estimate} using {model}. Proceed?"
2. Allow page selection — extract specific pages only, not all
3. Hybrid auto-suggest — text-extract all pages first, flag low-text-density pages as "may benefit from vision"

### Problem 12: Embedding All Chunks Is Expensive for Large Documents

100 pages → ~200 chunks. Embedding 200 chunks is slow and costly with paid APIs.

**Fixes:**
1. Batch embedding (groups of 32-64) — `embedTexts` already accepts arrays
2. Background embedding via job queue — don't block the review UI
3. Consider lazy embedding — embed on first search, not on extraction

---

## Review Round 4: UX / Product

### Problem 13: Review Is Per-Page But Lesson Generation Is Per-Document

User carefully reviews page-by-page, but lesson generation takes the merged blob. Per-page effort gets flattened.

**Fix:** Generate per chunk (already addressed in Problem 6). UI should show: "Generate lessons from {N} accepted chunks?" with per-chunk attribution.

### Problem 14: No Progress for Multi-Page Vision Extraction

50 pages = 2-5 minutes. User stares at a spinner.

**Fix:**
- Per-page progress: "Extracting page 12 of 50..."
- Pages appear in review UI as they complete (streaming results)
- User can start reviewing early pages while later ones process

### Problem 15: Text Mode Looks Broken for Diagram-Heavy PDFs

User uploads architecture doc, picks text mode, gets garbled output. Thinks the feature is broken.

**Fix:** After text extraction, show quality assessment: "Extracted {N} chars from {M} pages. {K} pages have very little text — may contain images." Suggest vision mode for specific pages with one-click action.

---

## Review Round 5: Operations & Reliability

### Problem 16: No Retry for Vision Extraction Failures

API returns 429/500 on page 23 of 50. Entire extraction fails.

**Fixes:**
1. Per-page retry (3x with exponential backoff)
2. Partial success — save 47/50, flag 3 failed pages for re-extraction
3. Resume — if user closes browser, job queue continues; user returns to partial results

### Problem 17: No Cleanup for Abandoned Extractions

User starts extraction, navigates away. Job continues, chunks created, embeddings generated — all for a doc they'll delete.

**Fixes:**
1. `extraction_status` column on documents: 'none' | 'processing' | 'review' | 'complete'
2. Cancel button to kill in-progress extraction jobs
3. Cascade cleanup when document is deleted during processing

### Problem 18: pdfjs-dist + canvas in Docker Is Fragile

`canvas` npm requires native C++ deps (Cairo, Pango). Notorious Docker build issues, especially Alpine.

**Alternatives:**
1. `sharp` instead of `canvas` — better maintained, pre-built binaries
2. `pdf-to-img` — wraps pdfjs-dist with sharp, avoids canvas entirely
3. Separate extraction container with all native deps pre-installed

---

## Review Round 6: Agent / MCP Integration

### Problem 19: Agents Can't Trigger Extraction

Pipeline is GUI-only. An AI agent that finds a PDF spec in the repo can't ingest it.

**Fix — New MCP tools:**
```
extract_document(doc_id, mode, pages?)  → returns extracted chunks
get_document_chunks(doc_id, query?)     → semantic search within one document
search_document_chunks(query, project)  → cross-document chunk search
```

### Problem 20: Document Chunks Don't Participate in Tiered Search

`tieredSearch` (Phase 6) covers: ripgrep → FTS files → semantic lessons. Documents are not in any tier.

**Fix:** Add document_chunks to the search tiers:
```
Tier 2: FTS on files + lessons + document_chunks
Tier 3: Semantic on lessons + document_chunks
```

An agent asking "what does the retry RFC say?" finds the answer from an ingested PDF.

---

## Review Round 7: Testing & QA

### Problem 21: No Way to Measure Extraction Quality

How do you know text extraction is "good enough"? How do you compare vision prompt variants?

**Fix:**
1. Ground truth test set — 5-10 test docs (tables, diagrams, scanned, clean text) with expected markdown
2. Automated diff — compare extracted vs expected, measure accuracy
3. A/B prompt testing — try different vision prompts, measure which is closest to ground truth
4. Store extraction metadata — mode, model, prompt_version, processing_time_ms per page

### Problem 22: No Integration Test for Full Pipeline

**Fix — E2E test:**
1. Upload test PDF with known content
2. Text-extract → verify chunks
3. Vision-extract same PDF → verify diagram descriptions
4. Semantic search for PDF term → verify chunk returned
5. Generate lessons from chunks → verify titles
6. Delete document → verify cascade cleanup

---

## Summary of All Reviews

| Round | Perspective | Issues | Critical Ones |
|---|---|---|---|
| 1 | Context & Data Engineering | #1-7 | Chunking (#1), provenance (#2), per-chunk generation (#6) |
| 2 | Security | #8-10 | File validation (#8), data exfiltration warning (#9) |
| 3 | Cost & Resources | #11-12 | Cost estimate (#11) |
| 4 | UX / Product | #13-15 | Quality feedback (#15) |
| 5 | Operations | #16-18 | Partial success (#16), Docker deps (#18) |
| 6 | Agent / MCP | #19-20 | Agent extraction (#19), tiered search (#20) |
| 7 | Testing | #21-22 | Quality benchmarking (#21) |
| | **Total** | **22 issues** | |

### Must-Have for Phase 10 Launch

1. **Document chunking + embedding** (#1) — without this, extraction is a dead end
2. **File validation** (#8) — security baseline
3. **Cost warning for vision mode** (#11) — user trust
4. **Partial success + resume** (#16) — reliability
5. **doc_type migration** (#7) — enables new formats
6. **Per-chunk lesson generation** (#6) — quality of generated knowledge

### Nice-to-Have (can ship after launch)

- MCP tools (#19-20) — agents can use GUI in the meantime
- Quality benchmarking (#21) — useful for tuning, not blocking
- Deduplication (#5) — annoying but not breaking
- Lazy embedding (#12) — optimization

---

## Review Round 8: Lessons from RAGFlow (infiniflow/ragflow)

RAGFlow is an open-source RAG engine with a mature document parsing pipeline (`deepdoc/`). Their approach is Python-heavy and over-engineered in places, but several design patterns are worth adopting.

### Lesson A: Layout Detection Before Text Extraction — Not After

**RAGFlow's approach:** PDF pages are rendered to images FIRST. A layout recognition model (ONNX) classifies regions into 10 types: text, title, figure, table, caption, header, footer, reference, equation. THEN text is extracted per region, with type-specific handling.

**Our pipeline's gap:** We extract text first (pdf-parse) and try to infer structure afterward (split by headings). This is backwards — you can't detect a table in raw text if the table structure was already lost during extraction.

**Takeaway:** For text mode, pdf-parse is fine. But add a **lightweight page analysis** step: render each page as an image, run a simple heuristic (text density, region count) to classify pages as "text-heavy" vs "visual/table-heavy." Flag visual pages to the user: "Pages 3, 7 may need vision mode." This doesn't require a model — just pixel density analysis.

### Lesson B: Template-Based Chunking Is Powerful

**RAGFlow's approach:** Instead of one universal chunker, they have domain-specific parsers:
- `paper.py` — detects abstract, uses frequency-based section pivots
- `laws.py` — preserves article → clause hierarchy, disables token limits
- `book.py` — bullet-based hierarchical merge with fallback to naive
- `table.py` — each row becomes a chunk with "Field: Value" formatting
- `resume.py` — structured field extraction
- `naive.py` — generic delimiter-based splitting with configurable overlap

**Our pipeline's gap:** We proposed one chunking strategy for all documents. A 50-page legal contract needs very different chunking than a 3-page architecture diagram or a spreadsheet.

**Takeaway:** Start with the naive chunker (headings + token budget) but design the chunking interface to be pluggable. Add a `chunk_template` field to the extraction config:

```
chunk_template: "auto" | "naive" | "hierarchical" | "table" | "per-page"
```

- **auto** — detect based on content (default): headings found → hierarchical, no headings → naive
- **naive** — delimiter-based, fixed token budget, overlap
- **hierarchical** — preserve document structure (headings, bullets, numbered lists)
- **table** — one row per chunk with column headers
- **per-page** — one chunk per page (good for slide decks, image-heavy docs)

Ship with `auto` and `naive` in 10.1. Add others incrementally.

### Lesson C: OCR Fallback Detection Is Non-Trivial

**RAGFlow's approach:** They run pdfplumber text extraction first, then check for "garbled" text:
- PUA (Private Use Area) Unicode characters → garbled font encoding
- CID characters → unmappable font glyphs
- If >50% of characters are garbled → discard text, fall back to OCR

**Our pipeline's gap:** We assumed pdf-parse either works or doesn't. In reality, many PDFs have partial garbling — some pages extract fine, others produce garbage because of embedded fonts, scanned pages mixed with digital pages, or CJK encoding issues.

**Takeaway:** After text extraction, run a **garble detection** heuristic per page:
1. Count characters in Unicode Private Use Area (U+E000–U+F8FF)
2. Count replacement characters (U+FFFD)
3. Check text-to-whitespace ratio (garbled text often has no spaces)
4. If garble score > threshold → flag page as "extraction failed, try vision"

This is cheap (no model needed) and prevents users from seeing garbage in the review step.

### Lesson D: Tables Need Special Treatment — Not Just "Keep Whole"

**RAGFlow's approach:** Tables are:
1. Detected by layout recognition
2. Extracted via Table Structure Recognition (TSR) — detects rows, columns, headers, spanning cells
3. Converted to HTML with structure preserved
4. Optionally: each row becomes a separate chunk with "Field: Value" format for better retrieval

**Our pipeline's gap:** We said "keep tables as single chunks." But a 100-row table as one chunk is useless for retrieval — it'll never match a specific query. And our text extraction (pdf-parse) doesn't detect tables at all.

**Takeaway:** Two approaches depending on mode:
- **Text mode:** Can't detect tables (pdf-parse limitation). Accept this. Tables will be garbled text.
- **Vision mode:** The vision model prompt should explicitly output tables as markdown tables. Then chunk: small tables (< 20 rows) → one chunk. Large tables → one chunk per logical group of rows (or per-row with headers prepended).

Add `chunk_type: "table"` to the chunk metadata so the retrieval layer can handle table chunks differently (e.g., return the full table when any row matches, not just the matching row).

### Lesson E: Image OCR → Vision LLM Is a Smart Cascade

**RAGFlow's approach:** For images:
1. Run OCR first (cheap, fast)
2. If OCR produces >32 words → use OCR text directly
3. If OCR produces <32 words → call vision LLM for a richer description

**Our pipeline's gap:** We proposed binary: text mode (no images) or vision mode (all images to LLM). No middle ground.

**Takeaway:** Adopt the cascade for image-heavy pages:
1. Text-extract the page
2. If text < 50 chars → this is an image/diagram page
3. For image pages: try OCR first (if available), then fall back to vision LLM
4. User sees: "This page appears to be an image. OCR extracted: '{short text}'. Want to use vision model for a better description?"

This saves vision API calls for pages where OCR is sufficient (screenshots with text, scanned text documents).

### Lesson F: Positional Metadata Matters for Provenance

**RAGFlow's output structure per text block:**
```json
{
  "text": "...",
  "x0": 0, "x1": 612, "top": 100, "bottom": 200,
  "page_number": 3,
  "layout_type": "table",
  "position_tag": "encoded position"
}
```

**Our pipeline's gap:** We store `page_number` and `heading` per chunk but no bounding box coordinates. When the user reviews extraction in the split-pane view, they can't see WHERE on the page a chunk came from.

**Takeaway:** For vision extraction (where we already have page images), store bounding box coordinates per chunk. In the review UI, highlight the source region on the original page when the user focuses a chunk. This makes review much faster — "this chunk came from the table in the bottom-left of page 7."

Not critical for v1, but the `document_chunks` schema should have the columns ready:
```sql
bbox_x0 REAL, bbox_y0 REAL, bbox_x1 REAL, bbox_y1 REAL
```

### What NOT to Copy from RAGFlow

1. **Heavy Python dependency chain** — RAGFlow requires PaddleOCR, ONNX Runtime, XGBoost, scikit-learn. We stay Node.js-native with optional vision model calls.
2. **Custom ML models for layout** — They train/ship layout recognition models. We use the user's configured vision model instead. Simpler, more flexible.
3. **Complex table structure recognition** — TSR with row/column/header/spanning-cell detection is a whole sub-system. Not worth building. Vision models handle tables well enough.
4. **Over-specialization** — 15+ parser types (laws, resume, paper, email...) is maintenance debt. We start with auto/naive/hierarchical, add templates only when users request them.

---

## Updated Design Decisions After All Reviews

| Decision | Before | After |
|---|---|---|
| Chunking | One universal strategy | Pluggable templates: auto, naive, hierarchical, table, per-page |
| Text mode quality | Assume pdf-parse works | Add garble detection per page, flag bad pages |
| Image handling | Binary: text or vision | Cascade: OCR first, vision LLM if OCR insufficient |
| Table chunking | Keep whole | Small tables whole, large tables chunked per row group |
| Vision prompt | Two-pass classify+extract | Single prompt v1, typed output format. Two-pass only if measured quality gap |
| User workflow | Always full review | Two paths: Quick (auto-extract, no review) and Careful (full review) |
| Chunk metadata | page_number, heading | + bbox coordinates, confidence, extraction_mode, chunk_type |
| Diagram output | Text description only | Mermaid code (renderable + editable) with text summary for embedding |
| Page quality signal | None | Garble score + text density → flag pages needing vision |
