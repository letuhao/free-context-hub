# Plan: Refactor to Multi-Client Architecture + AI Streaming

## Context

free-context-hub is currently a monolithic MCP server (`src/index.ts`, 2300+ lines). For Phase 7 (GUI), we need:
- A REST API backend that both the web GUI and MCP clients can use
- A thin MCP client package that proxies tool calls to the REST API
- A Next.js web dashboard for humans to browse knowledge
- **AI chat streaming** for interactive knowledge Q&A via the GUI

The business logic in `src/services/` is already well-separated from the MCP protocol — services take plain objects and return plain objects. The refactor extracts this into a shared core, then builds two thin layers (MCP + REST) on top.

## Architecture

```
┌──────────────┐  ┌──────────────┐  ┌──────────────┐
│  Next.js GUI │  │  MCP Client  │  │ Claude Code  │
│  (browser)   │  │  (npm pkg)   │  │ / Cursor     │
└──────┬───────┘  └──────┬───────┘  └──────┬───────┘
       │ HTTP            │ HTTP            │ MCP
       │ + SSE           │                 │
       ▼                 ▼                 ▼
┌──────────────────────────────────────────────────┐
│          Single Node.js Process                   │
│                                                   │
│  ┌─────────────┐       ┌──────────────┐          │
│  │ REST API    │       │ MCP Server   │          │
│  │ :3001       │       │ :3000        │          │
│  │ /api/*      │       │ /mcp         │          │
│  │ /api/chat   │←─SSE streaming──→ LM Studio    │
│  └──────┬──────┘       └──────┬───────┘          │
│         │                     │                   │
│         └────────┬────────────┘                   │
│                  ▼                                │
│  ┌───────────────────────────────────┐           │
│  │         src/core/                  │           │
│  │  services/ db/ kg/ utils/ env.ts  │           │
│  └───────────────┬───────────────────┘           │
│                  ▼                                │
│  ┌─────┐ ┌──────┐ ┌───────┐ ┌──────────┐       │
│  │ PG  │ │Neo4j │ │ Redis │ │ RabbitMQ │       │
│  └─────┘ └──────┘ └───────┘ └──────────┘       │
└──────────────────────────────────────────────────┘
```

## AI Chat Streaming (Vercel AI SDK Integration)

### How it works

The REST API adds a chat endpoint that streams AI responses via SSE:

```
POST /api/chat
  Body: { messages: UIMessage[], project_id: string }
  Response: SSE stream (UI Message Stream v1 protocol)
```

**Server side** (Express route):
```typescript
import { streamText } from 'ai';

app.post('/api/chat', async (req, res) => {
  const { messages, project_id } = req.body;

  const result = streamText({
    model: openaiCompatible('distillation-model'),  // LM Studio
    system: `You are a knowledge assistant for project ${project_id}.
             Use the tools to search lessons and check guardrails.`,
    messages: convertToModelMessages(messages),
    tools: {
      searchLessons: {
        description: 'Search persistent lessons/decisions/workarounds',
        inputSchema: z.object({ query: z.string() }),
        execute: async ({ query }) => searchLessons({ projectId: project_id, query }),
      },
      checkGuardrails: {
        description: 'Check if an action is allowed by team guardrails',
        inputSchema: z.object({ action: z.string() }),
        execute: async ({ action }) => checkGuardrails(project_id, { action }),
      },
      searchCode: {
        description: 'Search code in the project',
        inputSchema: z.object({ query: z.string(), kind: z.string().optional() }),
        execute: async ({ query, kind }) => tieredSearch({ projectId: project_id, query, kind }),
      },
    },
    stopWhen: stepCountIs(5),  // max 5 tool-calling rounds
  });

  result.pipeUIMessageStreamToResponse(res);
});
```

**Client side** (Next.js with useChat):
```typescript
const { messages, sendMessage, status } = useChat({
  transport: new DefaultChatTransport({ api: 'http://localhost:3001/api/chat' }),
});
```

### Key decisions

1. **Model**: Uses the existing distillation model (qwen2.5-coder-7b-instruct) via LM Studio's OpenAI-compatible API. No Vercel AI Gateway needed — this is self-hosted.

2. **Tools**: The chat endpoint exposes our core services as AI SDK tools. The LLM can call search_lessons, check_guardrails, search_code during conversation. This makes the GUI's chat feature actually useful — users ask questions, the AI searches knowledge and answers.

3. **Protocol**: SSE (Server-Sent Events) with AI SDK's UI Message Stream v1 format. `pipeUIMessageStreamToResponse(res)` handles all streaming mechanics. `useChat` on the client handles parsing.

4. **No microservices needed**: The chat endpoint runs in the same Express process. It calls core services directly (in-memory, no HTTP). The only external call is to LM Studio for the LLM.

5. **Framework**: Uses `ai` package (Vercel AI SDK v6) with `@ai-sdk/openai-compatible` provider for LM Studio. GUI uses `@ai-sdk/react` for `useChat` hook.

### Dependencies to add
```
# Backend (REST API)
ai                          # AI SDK core (streamText, generateText)
@ai-sdk/openai-compatible   # Provider for LM Studio

# Frontend (Next.js GUI)
@ai-sdk/react               # useChat hook
ai-elements                 # Pre-built chat UI components
```

## Directory Structure

```
src/
  core/                    # Shared business logic
    services/              # All 27 service modules
    db/                    # PostgreSQL client, migrations
    kg/                    # Neo4j knowledge graph
    utils/                 # Shared utilities
    env.ts                 # Centralized env config
    auth.ts                # assertWorkspaceToken, resolveProjectIdOrThrow
    schemas.ts             # Shared Zod schemas

  mcp/                     # Thin MCP layer
    index.ts               # createMcpToolsServer(), tool registration
    formatters.ts          # formatToolResponse, OutputFormatSchema

  api/                     # REST API layer
    index.ts               # Express app factory, mount routes
    middleware/
      auth.ts              # Bearer token middleware
      errorHandler.ts      # Error → HTTP status mapping
    routes/
      lessons.ts           # GET/POST /api/lessons, POST /api/lessons/search
      search.ts            # POST /api/search/code-tiered
      guardrails.ts        # POST /api/guardrails/check
      projects.ts          # GET/DELETE /api/projects/:id
      chat.ts              # POST /api/chat (AI streaming)
      jobs.ts              # GET/POST /api/jobs
      git.ts               # POST /api/git/ingest
      ...

  main.ts                  # Boots MCP (:3000) + REST (:3001)

packages/
  mcp-client/              # Separate npm package (stdio transport → REST proxy)

gui/                       # Next.js dashboard
  app/
    layout.tsx
    page.tsx               # Dashboard overview
    chat/page.tsx           # AI chat interface (useChat + AI Elements)
    lessons/page.tsx        # Browse/search lessons
    guardrails/page.tsx     # View guardrails
    projects/page.tsx       # Project overview
    jobs/page.tsx           # Job monitor
```

## REST API Endpoints

| HTTP | Endpoint | Source | Notes |
|------|----------|--------|-------|
| **Chat** |
| POST | `/api/chat` | AI SDK streamText | SSE streaming, tool-calling |
| **Lessons** |
| GET | `/api/lessons` | list_lessons | Query params for filters |
| POST | `/api/lessons` | add_lesson | |
| POST | `/api/lessons/search` | search_lessons | |
| PATCH | `/api/lessons/:id/status` | update_lesson_status | |
| **Guardrails** |
| POST | `/api/guardrails/check` | check_guardrails | |
| **Search** |
| POST | `/api/search/code-tiered` | search_code_tiered | |
| **Projects** |
| GET | `/api/projects/:id/summary` | get_project_summary | |
| POST | `/api/projects/:id/index` | index_project | |
| POST | `/api/projects/:id/reflect` | reflect | |
| DELETE | `/api/projects/:id` | delete_workspace | |
| **Git** |
| POST | `/api/git/ingest` | ingest_git_history | |
| GET | `/api/git/commits` | list_commits | |
| **Jobs** |
| POST | `/api/jobs` | enqueue_job | |
| GET | `/api/jobs` | list_jobs | |
| **System** |
| GET | `/api/system/help` | help | |
| GET | `/api/system/health` | (new) | |

## Migration Strategy (Incremental)

### Phase M1: Extract `src/core/` (1-2 days)
- Create barrel re-exports, then move files
- Extract auth.ts from index.ts
- Zero behavior change

### Phase M2: Extract `src/mcp/` (1-2 days)
- Move tool registration out of index.ts into mcp/index.ts
- Slim index.ts to just boot MCP

### Phase M3: Add REST API `src/api/` (3-5 days)
- Express app on port 3001
- Routes call core services directly
- Add `POST /api/chat` with AI SDK streamText

### Phase M4: Docker updates (1 day)
- Add EXPOSE 3001, API_PORT env var

### Phase M5: MCP Client package (2-3 days)
- `packages/mcp-client/` with stdio → REST proxy

### Phase M6: Next.js GUI (ongoing)
- `gui/` with Next.js App Router
- MVP: chat, lessons browser, guardrails viewer

## Next.js GUI MVP Features

1. **AI Chat** — `useChat` + AI Elements (`<Message>`, `<Conversation>`, `<PromptInput>`)
   - User asks "what database does each service use" → AI calls search_lessons → streams answer
   - Tool calls visible in UI (AI Elements handles this automatically)

2. **Lessons Browser** — paginated list, type/tag filters, search, status management

3. **Guardrails Viewer** — list guardrails, test check_guardrails with sample actions

4. **Project Overview** — stats (chunks, lessons, guardrails count), project summary

5. **Jobs Monitor** — list jobs, status, enqueue new jobs

## Key Constraints

- One process, two Express apps (MCP :3000, REST :3001)
- Both share DB pool, Redis, services in memory
- No business logic duplication
- AI chat uses local LM Studio, not Vercel AI Gateway (self-hosted)
- MCP client is separate npm package
- GUI is separate Next.js deployment
