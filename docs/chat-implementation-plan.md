# Chat Implementation Plan

> **Status (as of 2026-04-18):** This document is a **historical design artifact**. The chat feature shipped in **Phase 7** (Sprint 7.3 — see [`phase7-task-breakdown.md`](phase7-task-breakdown.md)). C1 (basic streaming chat), C2 (tool-calling), and C3 (thread persistence) are live. C4 (shared threads, attachments) was descoped — if any of its features resurface as load-bearing, they'd reopen as a fresh design rather than inherit this document's framing.
>
> The design reasoning below remains a useful reference for how chat was shaped, but do not treat it as a commitment register.

---

## Overview

Multi-phase implementation of the AI Chat feature — from basic streaming to full
persistence with thread management. Each phase is independently shippable.

---

## Phase C1: Basic Streaming Chat (MVP)

**Goal**: User can ask questions, AI streams answers using the local LM Studio model.
No tools, no persistence. Just works.

### Dependencies
```bash
# Backend
npm install ai @ai-sdk/openai-compatible

# Frontend
cd gui && npm install @ai-sdk/react
```

### Backend
**File**: `src/api/routes/chat.ts`
```
POST /api/chat
  Body: { messages: UIMessage[], project_id: string }
  Response: SSE stream
```

- Uses `streamText` from `ai` package
- Provider: `createOpenAICompatible({ baseURL: env.DISTILLATION_BASE_URL })`
- Model: `env.DISTILLATION_MODEL` (e.g. `qwen2.5-coder-7b-instruct`)
- System prompt: "You are a knowledge assistant for project {project_id}."
- Returns `result.toDataStreamResponse()` for SSE

### Frontend
**File**: `gui/src/app/chat/page.tsx`
- `useChat` hook from `@ai-sdk/react`
- Message list: user messages (right-aligned) + assistant messages (left-aligned)
- Input bar at bottom with Send button
- Streaming indicator (animated dots while generating)
- Suggested prompt chips on empty state

### Config
Uses existing env vars — no new config needed:
- `DISTILLATION_BASE_URL` → LM Studio URL
- `DISTILLATION_MODEL` → model name
- `DISTILLATION_API_KEY` → optional API key
- `DISTILLATION_ENABLED` → must be true

### Validation
- [ ] Send a message → stream response appears word by word
- [ ] Multiple messages in conversation maintain context
- [ ] Error handling: show toast if model is unreachable
- [ ] Empty state: suggested prompts work

---

## Phase C2: Tool-Calling (Knowledge-Augmented)

**Goal**: AI can search lessons, check guardrails, and search code during conversation.
Tool calls are shown inline so user sees what the AI searched.

### Backend Changes
Extend `POST /api/chat` with tools:

```typescript
tools: {
  search_lessons: {
    description: 'Search project lessons, decisions, and workarounds',
    parameters: z.object({ query: z.string() }),
    execute: async ({ query }) => searchLessons({ projectId, query }),
  },
  check_guardrails: {
    description: 'Check if an action is allowed by project guardrails',
    parameters: z.object({ action: z.string() }),
    execute: async ({ action }) => checkGuardrails(projectId, { action }),
  },
  search_code: {
    description: 'Search project code by identifier, path, or description',
    parameters: z.object({ query: z.string(), kind: z.string().optional() }),
    execute: async ({ query, kind }) => tieredSearch({ projectId, query, kind }),
  },
}
```

- Max 5 tool-calling rounds per message (prevent infinite loops)
- System prompt updated to explain available tools

### Frontend Changes
- Tool call display: collapsible blocks showing what the AI searched
  ```
  🔧 search_lessons("database conventions")
  ▸ Found 3 results — click to expand
  ```
- Tool results shown as compact cards inside the conversation
- Sources/citations linked at bottom of AI response

### Validation
- [ ] Ask "what database do we use?" → AI calls search_lessons → answers with citations
- [ ] Ask "can I force push to main?" → AI calls check_guardrails → warns about violation
- [ ] Tool calls visible and collapsible in conversation
- [ ] Max 5 rounds prevents infinite tool loops

---

## Phase C3: Chat Persistence (Thread Management)

**Goal**: Chat history saved to database. Users can resume conversations,
browse past threads, and delete old chats.

### Database Schema

```sql
-- Migration: 0029-chat-threads.sql

CREATE TABLE chat_threads (
  thread_id     UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id    TEXT NOT NULL,
  title         TEXT,                    -- auto-generated from first message
  created_at    TIMESTAMPTZ DEFAULT now(),
  updated_at    TIMESTAMPTZ DEFAULT now(),
  message_count INT DEFAULT 0,
  is_archived   BOOLEAN DEFAULT FALSE
);

CREATE INDEX idx_chat_threads_project ON chat_threads(project_id, updated_at DESC);

CREATE TABLE chat_messages (
  message_id    UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  thread_id     UUID NOT NULL REFERENCES chat_threads(thread_id) ON DELETE CASCADE,
  role          TEXT NOT NULL,           -- 'user' | 'assistant' | 'tool'
  content       TEXT NOT NULL,
  tool_calls    JSONB,                   -- tool invocations (for assistant messages)
  tool_results  JSONB,                   -- tool results (for tool messages)
  created_at    TIMESTAMPTZ DEFAULT now()
);

CREATE INDEX idx_chat_messages_thread ON chat_messages(thread_id, created_at ASC);
```

### Backend — New Service
**File**: `src/services/chatThreads.ts`

```typescript
// Thread CRUD
createThread(projectId: string, title?: string): Promise<Thread>
listThreads(projectId: string, limit?: number): Promise<Thread[]>
getThread(threadId: string): Promise<Thread | null>
deleteThread(threadId: string): Promise<void>
archiveThread(threadId: string): Promise<void>

// Message persistence
appendMessages(threadId: string, messages: Message[]): Promise<void>
getMessages(threadId: string): Promise<Message[]>

// Auto-title
generateThreadTitle(firstMessage: string): Promise<string>
```

### Backend — New Routes
**File**: `src/api/routes/chat.ts` (extend)

| Endpoint | Purpose |
|----------|---------|
| `GET /api/chat/threads` | List threads for project |
| `POST /api/chat/threads` | Create new thread |
| `GET /api/chat/threads/:id` | Get thread + messages |
| `DELETE /api/chat/threads/:id` | Delete thread |
| `PATCH /api/chat/threads/:id` | Update title, archive |
| `POST /api/chat` | Send message (now includes `thread_id`) |

### Chat route changes
- `POST /api/chat` now accepts optional `thread_id`
- If `thread_id` provided: load existing messages as context
- After streaming completes: persist user message + assistant response
- Auto-generate thread title from first user message (via LLM or truncation)

### Frontend — Thread Sidebar

```
┌──────────────────────────────────────────────────────┐
│ Chat                                    [+ New Chat] │
│                                                      │
│ ┌─ Thread List ─┐ ┌─ Conversation ─────────────┐   │
│ │               │ │                              │   │
│ │ Today         │ │  🤖 Welcome! Ask me...      │   │
│ │ • Database    │ │                              │   │
│ │   conventions │ │  👤 What database do we...  │   │
│ │ • Deploy      │ │                              │   │
│ │   guardrails  │ │  🤖 Based on the project... │   │
│ │               │ │                              │   │
│ │ Yesterday     │ │                              │   │
│ │ • Architecture│ │                              │   │
│ │   overview    │ │                              │   │
│ │               │ │                              │   │
│ └───────────────┘ └──────────────────────────────┘   │
│                                                      │
│ ┌─ Input ───────────────────────────────────────┐   │
│ │ Ask about this project...            [Send ↵] │   │
│ └───────────────────────────────────────────────┘   │
└──────────────────────────────────────────────────────┘
```

- Left panel: thread list grouped by date (Today / Yesterday / Last Week / Older)
- Thread titles auto-generated, editable on click
- Active thread highlighted
- Swipe/right-click to delete or archive
- "New Chat" creates a new thread and clears the conversation
- Thread list collapsible on mobile

### Frontend — Changes to chat page
- `useChat` now passes `thread_id` in request body
- On mount: load threads list + active thread messages
- After each response: thread list updates with new title/timestamp
- Thread switch: load messages from API, replace conversation
- Optimistic: new user message appears immediately, persisted async

### Validation
- [ ] Start a conversation → thread auto-created with generated title
- [ ] Close tab, reopen → conversation is still there
- [ ] Switch between threads → messages load correctly
- [ ] Delete thread → removes from list and DB
- [ ] Thread list shows correct timestamps and message counts
- [ ] New Chat button → creates fresh thread, clears conversation
- [ ] 50+ threads → list is scrollable, grouped by date

---

## Phase C4: Advanced Chat Features (v2)

**Goal**: Power-user features for enterprise teams.

### Features (each independently shippable)

#### C4a: Message Actions
- Copy message as markdown
- Regenerate response (re-send with same context)
- Edit user message (re-send from that point)
- Rate response (thumbs up/down) → stored for quality improvement

#### C4b: Thread Search
- Search across all thread messages
- `GET /api/chat/threads/search?q=database`
- Results show thread title + matching message snippet
- Click → opens thread at that message

#### C4c: Export Thread
- Export conversation as markdown or JSON
- Download button in thread header
- Useful for documentation, sharing, audits

#### C4d: Shared Threads
- Share a read-only link to a thread
- `GET /api/chat/threads/:id/share` → generates a share token
- Shared view: read-only, no input bar
- Useful for team knowledge sharing

#### C4e: Context Attachments
- Attach files or code snippets to a message
- Stored as attachments in `chat_messages.attachments JSONB`
- AI receives attachment content in context
- Useful for "explain this code" or "review this config"

---

## Phase Summary

| Phase | Scope | New Deps | DB Changes | Effort |
|-------|-------|----------|-----------|--------|
| **C1** | Basic streaming | `ai`, `@ai-sdk/openai-compatible`, `@ai-sdk/react` | None | Low |
| **C2** | Tool calling | None (uses C1 deps) | None | Low |
| **C3** | Persistence | None | 2 tables, 1 migration | Medium |
| **C4** | Advanced | None | Schema extensions | Medium each |

### Recommended execution order
1. **C1 + C2 together** — streaming without tools is useless for this product. Ship both.
2. **C3** — persistence is the #1 user request. Ship next.
3. **C4a–C4e** — pick based on user feedback.

### Env vars (already exist)
```
DISTILLATION_ENABLED=true
DISTILLATION_BASE_URL=http://localhost:1234
DISTILLATION_MODEL=qwen2.5-coder-7b-instruct
DISTILLATION_API_KEY=                          # optional
```

No new env vars needed. The chat endpoint reuses the distillation model config.
If Model Providers page is implemented, GUI assignments override env vars.
