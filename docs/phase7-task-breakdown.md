# Phase 7: GUI Enhancement — Task Breakdown

> **Status:** Planning complete, Sprint 7.1 ready to start
> **Created:** 2026-04-04
> **Design drafts:** [`docs/gui-drafts/`](gui-drafts/) (21 pages + 16 components)

## Current State

- **BE:** 42 REST endpoints, 36 MCP tools, 30 migrations, ~20 tables
- **FE:** 14 pages functional, 15 shared components, 26 API client methods
- **Drafts:** 21 pages + 16 components designed (v4), 7 screenshots in README

## Gap: New Backend Required

| Feature | New Tables | New Endpoints | Effort |
|---------|-----------|---------------|--------|
| Lesson editing (update content) | — | `PUT /api/lessons/:id` | Low |
| Lesson version history | `lesson_versions` | `GET /api/lessons/:id/versions` | Medium |
| Comments on lessons | `lesson_comments` | CRUD `/api/lessons/:id/comments` | Medium |
| Feedback (thumbs up/down) | `lesson_feedback` | `POST/GET /api/lessons/:id/feedback` | Low |
| Bookmarks | `bookmarks` | CRUD `/api/bookmarks` | Low |
| Documents (upload/link) | `documents`, `document_lessons` | CRUD `/api/documents` + upload | High |
| Generate lessons from doc | — | `POST /api/documents/:id/generate-lessons` | High (AI) |
| Review workflow (draft→active) | — (existing status field) | `POST /api/lessons/batch-status` | Medium |
| Agent trust levels | `agent_trust_levels` | CRUD `/api/agents` | Medium |
| Activity feed | `activity_log` | `GET /api/activity` | Medium |
| Notifications | `notifications` | CRUD `/api/notifications` | Medium |
| Analytics | — (computed views) | `GET /api/analytics/*` | Medium |
| Chat history | `chat_conversations`, `chat_messages` | CRUD `/api/conversations` | Medium |
| Onboarding / Learning path | `learning_paths`, `learning_progress` | CRUD `/api/learning-paths` | Medium |
| Global search | — (orchestrates existing) | `GET /api/search/global` | Low |

---

## Sprint Plan

### Sprint 7.1: Foundation & FE Refactor
> **Goal:** Upgrade component library, no new backend needed
> **Type:** FE-only | **Estimate:** 8 days

| # | Task | Type | Est | Dep | Status |
|---|------|------|-----|-----|--------|
| 7.1.1 | Install `lucide-react`, replace all emoji icons in sidebar + all pages | FE | 2d | — | [ ] |
| 7.1.2 | Extract shared `<Breadcrumb>` component, add to all nested pages | FE | 1d | — | [ ] |
| 7.1.3 | Upgrade `<DataTable>` — sticky headers, sort indicator SVGs | FE | 1d | — | [ ] |
| 7.1.4 | Move `<Pagination>` from lessons-only to shared `ui/` component | FE | 0.5d | — | [ ] |
| 7.1.5 | Add slide/fade animations to `<SlideOver>`, `<ConfirmDialog>`, `<Toast>` | FE | 1d | — | [ ] |
| 7.1.6 | Convert lesson detail + knowledge-docs from SlideOver to center `<Modal>` | FE | 1d | — | [ ] |
| 7.1.7 | Update `<SearchBar>` with Lucide icon, backdrop blur on all overlays | FE | 0.5d | 7.1.1 | [ ] |
| 7.1.8 | Create `<KeyboardShortcuts>` overlay component (? key) | FE | 1d | — | [ ] |

**Deliverable:** All 14 existing pages visually upgraded, component library cleaned up

---

### Sprint 7.2: Lesson Editing & Review Workflow
> **Goal:** Humans can edit, approve/reject AI-generated lessons
> **Type:** FE+BE | **Estimate:** 10.5 days

| # | Task | Type | Est | Dep | Status |
|---|------|------|-----|-----|--------|
| 7.2.1 | `PUT /api/lessons/:id` — update title, content, tags | BE | 1d | — | [✓] |
| 7.2.2 | `lesson_versions` table + migration, auto-create version on update | BE | 1.5d | 7.2.1 | [✓] |
| 7.2.3 | `GET /api/lessons/:id/versions` — list versions with diff data | BE | 1d | 7.2.2 | [ ] |
| 7.2.4 | Lesson detail edit mode — inline title/content/tags editing | FE | 2d | 7.2.1 | [ ] |
| 7.2.5 | Version history section in lesson detail modal | FE | 1d | 7.2.3 | [ ] |
| 7.2.6 | Dirty indicator + Ctrl+S save, undo/redo | FE | 1d | 7.2.4 | [ ] |
| 7.2.7 | `POST /api/lessons/batch-status` — bulk approve/reject/archive | BE | 0.5d | — | [ ] |
| 7.2.8 | Review Inbox page — card-based review, batch approve/reject | FE | 2d | 7.2.7 | [ ] |
| 7.2.9 | Lessons page — add "Draft / Pending Review" status tab | FE | 0.5d | — | [ ] |

**Deliverable:** Full lesson CRUD + review workflow operational

---

### Sprint 7.3: AI-Assisted Features
> **Goal:** AI helps humans refine knowledge
> **Type:** FE+BE (AI integration) | **Estimate:** 12 days

| # | Task | Type | Est | Dep | Status |
|---|------|------|-----|-----|--------|
| 7.3.1 | `POST /api/lessons/:id/improve` — AI rewrite endpoint (uses chat model) | BE | 2d | — | [ ] |
| 7.3.2 | AI-assisted editor — chunk selection, Ask AI toolbar, diff view, per-chunk accept/reject | FE | 3d | 7.2.4, 7.3.1 | [ ] |
| 7.3.3 | `POST /api/chat/conversations` + `GET /api/chat/conversations` — persist chat | BE | 1.5d | 7.3.4 | [ ] |
| 7.3.4 | `chat_conversations` + `chat_messages` tables + migration | BE | 1d | — | [ ] |
| 7.3.5 | Chat history sidebar, load/switch conversations | FE | 2d | 7.3.3 | [ ] |
| 7.3.6 | "Create Lesson from Answer" — popover with pre-filled fields | FE | 1d | — | [ ] |
| 7.3.7 | Chat markdown rendering (`react-markdown` + `rehype-highlight`) | FE | 1d | — | [ ] |
| 7.3.8 | Pinned messages bar in chat | FE | 0.5d | 7.3.5 | [ ] |

**Deliverable:** AI-assisted editing, persistent chat, markdown rendering

---

### Sprint 7.4: Documents & Knowledge Management
> **Goal:** Attach reference docs, generate lessons from them
> **Type:** FE+BE | **Estimate:** 11.5 days

| # | Task | Type | Est | Dep | Status |
|---|------|------|-----|-----|--------|
| 7.4.1 | `documents` + `document_lessons` tables + migration | BE | 1d | — | [ ] |
| 7.4.2 | CRUD `/api/documents` — upload (multipart), link URL, list, get, delete | BE | 2d | 7.4.1 | [ ] |
| 7.4.3 | `POST /api/documents/:id/generate-lessons` — AI parses doc, suggest lessons | BE | 2d | 7.4.1 | [ ] |
| 7.4.4 | Document-Lesson linking: `POST/DELETE /api/documents/:id/lessons/:lessonId` | BE | 0.5d | 7.4.1 | [ ] |
| 7.4.5 | Documents page — list, upload dialog, type filter tabs | FE | 2d | 7.4.2 | [ ] |
| 7.4.6 | Document viewer modal — content, in-doc search, linked lessons sidebar | FE | 2d | 7.4.2 | [ ] |
| 7.4.7 | "Generate Lessons" flow — trigger, show suggestions, accept/dismiss | FE | 1.5d | 7.4.3 | [ ] |
| 7.4.8 | Linked documents section in lesson detail | FE | 0.5d | 7.4.4 | [ ] |

**Deliverable:** Full document management with AI lesson generation

---

### Sprint 7.5: Collaboration & Feedback
> **Goal:** Comments, feedback, bookmarks, import/export
> **Type:** FE+BE | **Estimate:** 9.5 days

| # | Task | Type | Est | Dep | Status |
|---|------|------|-----|-----|--------|
| 7.5.1 | `lesson_comments` table + migration | BE | 0.5d | — | [ ] |
| 7.5.2 | CRUD `/api/lessons/:id/comments` — add, list, reply, delete | BE | 1d | 7.5.1 | [ ] |
| 7.5.3 | `lesson_feedback` table + `POST/GET /api/lessons/:id/feedback` | BE | 1d | — | [ ] |
| 7.5.4 | `bookmarks` table + CRUD `/api/bookmarks` | BE | 0.5d | — | [ ] |
| 7.5.5 | Comments section in lesson detail (threaded replies) | FE | 1.5d | 7.5.2 | [ ] |
| 7.5.6 | Feedback thumbs up/down + retrieval count display | FE | 1d | 7.5.3 | [ ] |
| 7.5.7 | Bookmark button + bookmarks filter in lessons page | FE | 1d | 7.5.4 | [ ] |
| 7.5.8 | `POST /api/lessons/import` + `GET /api/lessons/export` (JSON/CSV) | BE | 1d | — | [ ] |
| 7.5.9 | Import dialog (JSON/CSV/Markdown tabs, preview, duplicate detection) | FE | 1.5d | 7.5.8 | [ ] |
| 7.5.10 | Export button (JSON/CSV download) | FE | 0.5d | 7.5.8 | [ ] |

**Deliverable:** Social features + data portability

---

### Sprint 7.6: Activity, Analytics & Onboarding
> **Goal:** Visibility, metrics, new member experience
> **Type:** FE+BE | **Estimate:** 13 days

| # | Task | Type | Est | Dep | Status |
|---|------|------|-----|-----|--------|
| 7.6.1 | `activity_log` table + auto-log on lesson/job/guardrail events | BE | 2d | — | [ ] |
| 7.6.2 | `GET /api/activity` — list with filters (type, time range) | BE | 0.5d | 7.6.1 | [ ] |
| 7.6.3 | `notifications` table + `GET/PATCH /api/notifications` (mark read) | BE | 1d | 7.6.1 | [ ] |
| 7.6.4 | Activity & Notifications page — timeline, preferences panel | FE | 2d | 7.6.2, 7.6.3 | [ ] |
| 7.6.5 | Notification bell in sidebar with unread count | FE | 0.5d | 7.6.3 | [ ] |
| 7.6.6 | `GET /api/analytics/*` — retrieval stats, stale detection, agent activity | BE | 2d | — | [ ] |
| 7.6.7 | Analytics page — charts, tables, dead knowledge | FE | 2d | 7.6.6 | [ ] |
| 7.6.8 | `learning_paths` + `learning_progress` tables + CRUD API | BE | 1.5d | — | [ ] |
| 7.6.9 | Getting Started page — learning path, progress tracker | FE | 1.5d | 7.6.8 | [ ] |
| 7.6.10 | Dashboard insights panel + knowledge health score | FE | 1d | 7.6.6 | [ ] |

**Deliverable:** Full observability + onboarding experience

---

### Sprint 7.7: Polish & Integration
> **Goal:** Final polish, global search, guardrail UX, agent trust
> **Type:** FE+BE+QA | **Estimate:** 9 days

| # | Task | Type | Est | Dep | Status |
|---|------|------|-----|-----|--------|
| 7.7.1 | `GET /api/search/global` — orchestrate across lessons, docs, code, guardrails, commits | BE | 1.5d | — | [ ] |
| 7.7.2 | Global search Cmd+K — cross-entity results, grouped, highlighted | FE | 2d | 7.7.1 | [ ] |
| 7.7.3 | `agent_trust_levels` table + CRUD `/api/agents` | BE | 1d | — | [ ] |
| 7.7.4 | Agent trust levels panel in Review Inbox | FE | 1d | 7.7.3 | [ ] |
| 7.7.5 | Guardrail test presets + test history | FE | 1d | — | [ ] |
| 7.7.6 | Guardrail "What Would Block?" mode | FE | 1d | — | [ ] |
| 7.7.7 | Responsive breakpoints — sidebar auto-collapse at md | FE | 1d | — | [ ] |
| 7.7.8 | Empty state improvements (gradient rings) | FE | 0.5d | — | [ ] |
| 7.7.9 | Integration testing — all new endpoints + GUI flows | QA | 2d | All | [ ] |
| 7.7.10 | Update screenshots + docs with final implementation | Docs | 0.5d | All | [ ] |

**Deliverable:** Phase 7 complete

---

## Summary

| Sprint | Focus | FE | BE | Total | Can Parallel? |
|--------|-------|----|----|-------|--------------|
| **7.1** | Foundation & FE Refactor | 8d | 0d | 8d | Start immediately |
| **7.2** | Lesson Editing & Review | 6.5d | 4d | 10.5d | BE can start while 7.1 FE runs |
| **7.3** | AI-Assisted Features | 7.5d | 4.5d | 12d | Needs 7.2 BE done |
| **7.4** | Documents & Knowledge | 6d | 5.5d | 11.5d | BE can parallel with 7.3 FE |
| **7.5** | Collaboration & Feedback | 5.5d | 4d | 9.5d | BE can parallel with 7.4 FE |
| **7.6** | Activity, Analytics, Onboarding | 6d | 7d | 13d | BE can start early (no deps) |
| **7.7** | Polish & Integration | 6.5d | 2.5d | 9d | After all sprints |
| | **Total** | **46d** | **27.5d** | **73.5d** | |

### Parallel Execution Strategy

With 1 FE + 1 BE developer working in parallel:

```
Week 1-2:  FE does 7.1 (foundation)     | BE starts 7.2 (lesson edit API + versions)
Week 3-4:  FE does 7.2 FE tasks         | BE does 7.3 BE (AI improve + chat persist)
Week 5-6:  FE does 7.3 FE (AI editor)   | BE does 7.4 BE (documents API)
Week 7-8:  FE does 7.4 FE (documents)   | BE does 7.5 + 7.6 BE (comments, activity, analytics)
Week 9-10: FE does 7.5 + 7.6 FE         | BE does 7.7 BE (global search, agents)
Week 11:   FE does 7.7 FE (polish)      | QA integration testing
```

**Critical path:** ~11 weeks with 2 developers in parallel, ~16 weeks with 1 developer sequential.

### Design References

All draft HTML files are in `docs/gui-drafts/`:
- Open `docs/gui-drafts/index.html` in browser for the full catalog
- Each draft shows the target design with sample data
- Compare draft vs current TSX when implementing each task
