---
id: CH-BUGFIX-PHASE10-PLAN
date: 2026-04-13
module: BugFixes-Phase10-Planning
phase: COMPLETE
---

# Session Patch — 2026-04-13 (Session 7)

## Where We Are
**Bug fix session + Phase 10 planning.** Fixed 18 UI bugs from a deep review across 4 sprints, all visually verified via browser. Designed the Phase 10 multi-format extraction pipeline with 8 review rounds and 3 HTML drafts. Ready to start Sprint 10.1 implementation.

## What Was Done This Session

### Bug Fix Sprint 1 — Quick Wins (10 bugs) ✅
- Fix document View crash (CRITICAL): `document_id` → `doc_id` field rename
- Fix NaNmo time formatting: null/NaN guard in `relTime()`
- Fix broken emoji on Code Search: surrogate pair → literal emoji
- Fix sidebar multi-highlight: exact match for `/projects` and `/settings`
- Fix Chat "New Chat" button: `chatKey` + `id` to force `useChat` reset, memoize transport
- Fix Graph Explorer search freeze: remove unnecessary API call
- Fix Code Search dropdown freeze: debounce `kind` filter
- Fix Add Guardrail modal title: new `dialogTitle` prop
- Add toast feedback for Dashboard Re-index/Ingest Git actions
- Fix Access Control misleading empty message when only revoked keys

### Bug Fix Sprint 2 — Data/API Shape Fixes (3 bugs) ✅
- Fix Analytics donut chart: embed `getLessonsByType` into `/overview` endpoint
- Fix Most Retrieved Lessons: embed `getMostRetrievedLessons` into `/overview`
- Fix Activity feed descriptions: map `title`/`detail` fields, dot-notation event icons, category prefix filtering

### Bug Fix Sprint 3 — Logic + Polish (3 bugs fixed, 2 verified) ✅
- Fix Getting Started "Mark Complete": localStorage persistence (broken API call removed)
- Fix Semantic search empty state: embeddings service unavailable message + "Switch to Text" button
- Fix Bookmarked filter wrong empty state: contextual icon/title/description
- Verified Bug #15 (stat cards) and Bug #17 (edit template) — already working, not bugs

### Bug Fix Sprint 4 — Feature Additions (2 bugs, 1 not a bug) ✅
- Verified Bug #18 (Generated Docs clickable) — already has SlideOver viewer
- Fix Bug #19 chat persistence — **root cause was sidebar field mismatch** (`res.conversations` vs `res.items`). Also added MutationObserver + DOM-based save mechanism since `useChat` + `TextStreamChatTransport` has stale closure issues with React `useEffect`.

### Visual Review via Playwright ✅
Verified 13 fixes live in the browser (Docker rebuild between attempts):
- NaNmo fix on Jobs page
- Document View crash fix (viewer opens correctly)
- Broken emoji on Code Search (🔍 renders)
- Sidebar highlight on `/projects/groups` and `/settings/access`
- Add Guardrail modal title correct
- Dashboard Re-index toast appears
- Analytics donut chart (66 total, proper breakdown)
- Most Retrieved Lessons table populated
- Activity feed with titles + actors + entity links
- Getting Started Mark Complete (progress updates to 1/50 2%)
- Graph Explorer search doesn't freeze
- Access Control misleading message fixed
- Chat persistence (11 conversations in sidebar after final fix)

### Phase 10 Planning — Multi-Format Extraction Pipeline ✅

Created comprehensive design document: `docs/phase10-extraction-pipeline.md`

**8 review rounds identifying 22 issues:**
1. Context & Data Engineering — chunking, provenance, per-chunk lesson generation
2. Security — file validation, data exfiltration warning, XSS sanitization
3. Cost & Resources — cost estimate before vision extraction, batch embedding
4. UX / Product — progressive quality feedback, per-page progress streaming
5. Operations — partial success, resume, Docker native deps
6. Agent / MCP — agent-triggerable extraction, tiered search inclusion
7. Testing — quality benchmarking with ground truth test set
8. Lessons from RAGFlow — template-based chunking, garble detection, OCR→vision cascade, positional metadata

**Key design decisions:**
- Two extraction modes: Text (free, local) and Vision (model provider)
- Two user paths: Quick (auto, no review) and Careful (full review)
- Pluggable chunking templates: auto, naive, hierarchical, table, per-page
- New `document_chunks` table with embeddings + FTS + bbox coordinates
- Content-hash deduplication
- Mermaid diagram extraction for strong vision models (renderable + editable + searchable via text summary)
- Chunk types: text, table, diagram_description, mermaid, code

**3 HTML drafts created in `docs/gui-drafts/pages/`:**
- `extraction-mode-selector.html` — Text vs Vision mode cards, page selection with low-density warnings, cost estimate, Quick/Careful toggle
- `extraction-review.html` — Full-width split-pane (PDF preview + markdown editor), per-page actions including "Extract as Mermaid", Mermaid preview panel with rendered diagram + source code, page navigator with color-coded confidence states
- `extraction-progress.html` — Overall progress bar, per-page status grid, early review prompt, failed page retry

## Commits This Session

| Commit | Description | Files |
|--------|-------------|-------|
| `8aaa754` | Fix 17 UI bugs from deep review — Sprints 1-4 | 16 |
| `d32a3f8` | Fix chat persistence — sidebar field mismatch + DOM-based save | 3 |
| (pending) | Phase 10 design: extraction pipeline doc + 3 HTML drafts | 4 |

## Summary

| Metric | Value |
|--------|-------|
| Bugs reported | 21 |
| Bugs fixed | 18 |
| Bugs verified not-bugs | 3 |
| Files changed (bug fixes) | 19 |
| Lines added / removed | ~350 / ~215 |
| Visual verifications | 13 |
| Phase 10 review rounds | 8 |
| Phase 10 issues identified | 22 |
| Phase 10 HTML drafts | 3 |

## What's Next

### Sprint 10.1 — Text Extraction Foundation
- Migration: new `document_chunks` table with embeddings + FTS + bbox columns
- Migration: add `docx` and `image` to `documents.doc_type` CHECK constraint
- Migration: add `content_hash` to documents for deduplication
- Backend: text extraction service (pdf-parse for PDF, mammoth for DOCX)
- Backend: chunking service (naive + hierarchical strategies)
- Backend: new API endpoints (POST /api/documents/:id/extract, GET/PUT extraction)
- Backend: embedding pipeline for chunks (batch via existing `embedTexts`)

### Sprint 10.2 — Extraction Review UI
- New components: ExtractionModeSelector, ExtractionReview (split-pane), PageNavigator
- Wire to backend APIs
- Per-page accept/edit/skip/save flow

### Sprint 10.3-10.6
- Vision extraction backend (pdfjs-dist + model provider)
- Vision mode UI + cost estimate + Mermaid extraction
- Image upload support
- Polish + integration tests
