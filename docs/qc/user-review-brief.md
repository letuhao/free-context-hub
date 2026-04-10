# ContextHub — User Review Brief

## What is this?

**ContextHub** is a self-hosted knowledge management system for AI agents. It stores decisions, workarounds, guardrails, and patterns that AI coding agents (like Claude Code, Cursor, etc.) learn during work sessions — so the knowledge persists across conversations instead of being lost.

Think of it as a **wiki + safety system for AI agents**, with a human-in-the-loop GUI for review and management.

**URL:** http://localhost:3002

## How to access

The app is running locally via Docker. Open http://localhost:3002 in your browser. No login required — it's a self-hosted tool.

The default project is `free-context-hub`. You should see data already populated (500+ lessons, guardrails, documents, etc.).

## Architecture

```
Sidebar (left)  │  Main content (right)
                │
  Navigation    │  Page header
  - Dashboard   │  Content area (scrolls independently)
  - Chat        │  
  - Knowledge   │  
  - Project     │  
  - System      │  
```

- **Sidebar**: Fixed left panel with navigation. Collapsible via Ctrl+B.
- **Main area**: Each page scrolls independently (sidebar stays fixed).
- **Command palette**: Ctrl+K opens a search palette for quick navigation.

## Pages to review (23 total)

### Main
| Page | URL | What it does |
|------|-----|-------------|
| **Dashboard** | `/` | Project overview — stat cards, health score, insights, recent lessons, active jobs, recent commits |
| **Chat** | `/chat` | AI-powered Q&A — ask questions about your knowledge base. Conversation history in left panel. |

### Knowledge
| Page | URL | What it does |
|------|-----|-------------|
| **Lessons** | `/lessons` | Main knowledge table — browse, search, filter, create, edit, archive lessons. Click a row to open detail panel. |
| **Review Inbox** | `/review` | Lessons pending human review (draft/pending status). Agent trust levels. |
| **Guardrails** | `/guardrails` | Safety rules for AI agents. "Test Action" field to check if an action would be blocked. Rules table below. |
| **Documents** | `/documents` | Upload and manage reference documents (markdown, text). Link documents to lessons. |
| **Getting Started** | `/getting-started` | Learning path — categorized lessons as a checklist with progress tracking. |
| **Generated Docs** | `/knowledge/docs` | Auto-generated documents (FAQ, RAPTOR summaries, QC reports, benchmarks). |
| **Code Search** | `/knowledge/search` | Search indexed source code with semantic + keyword matching. |
| **Graph Explorer** | `/knowledge/graph` | Knowledge graph visualization (coming soon — shows planned capabilities). |

### Project
| Page | URL | What it does |
|------|-----|-------------|
| **Overview** | `/projects` | Project dashboard — stats, recent activity, groups, summary. |
| **Groups** | `/projects/groups` | Organize projects into groups for shared knowledge. |
| **Git History** | `/projects/git` | Ingested git commits with suggested lessons. |
| **Sources** | `/projects/sources` | Configure project source (local path or git remote). |
| **Settings** | `/projects/settings` | Project config — name, description, color, groups, feature toggles. |

### System
| Page | URL | What it does |
|------|-----|-------------|
| **Jobs** | `/jobs` | Background job queue — indexing, ingestion, generation tasks. |
| **Activity** | `/activity` | Activity feed with tabs (All, Lessons, Jobs, Guardrails, Documents). Notification settings. |
| **Analytics** | `/analytics` | Knowledge health — retrieval trends chart, lessons by type donut, top lessons, dead knowledge. |
| **Settings** | `/settings` | System config — server info, ports, feature flags with enabled/disabled status. |
| **Model Providers** | `/settings/models` | Configure LLM providers for embeddings, distillation, reranking. |
| **Lesson Types** | `/settings/lesson-types` | Built-in + custom lesson type management (decision, pattern, guardrail, workaround, etc.). |
| **Agent Audit** | `/agents` | Agent audit trail — total actions, approval rate, blocked count. Timeline of agent activities. |
| **Access Control** | `/settings/access` | API key management (create/revoke) + permissions matrix (reader/writer/admin roles). |

## Key user flows to test

### 1. Browse lessons
1. Go to `/lessons`
2. Scroll through the table (12 rows per page, pagination at bottom)
3. Use the search bar to find specific lessons
4. Click status tabs (Active, Draft, Pending Review, Superseded)
5. Click a lesson row to open the detail panel on the right

### 2. Create a lesson
1. On `/lessons`, click "+ Add Lesson" button (top right)
2. Fill: title, select type (decision/pattern/guardrail/workaround), write content
3. Click "Add Lesson" to save
4. Verify it appears in the table

### 3. Edit a lesson
1. Click a lesson row to open detail panel
2. Click the pencil/edit icon
3. Should see a rich markdown editor with toolbar (Bold, Italic, Code, Heading, List, Link)
4. Edit content, click Save

### 4. Test guardrails
1. Go to `/guardrails`
2. In the "Test Action" field, type an action like "deploy to production"
3. Click "Check" — should show whether the action is blocked or allowed
4. Scroll down to see the rules table

### 5. Chat with AI
1. Go to `/chat`
2. Type a question like "What are our key architectural decisions?"
3. AI should search the knowledge base and respond (requires distillation model configured)

### 6. View analytics
1. Go to `/analytics`
2. Check stat cards, retrieval trends chart, lessons by type distribution
3. Scroll to "Dead Knowledge" section (lessons never retrieved)

### 7. Manage settings
1. Go to `/settings` — check feature flags
2. Go to `/settings/lesson-types` — see built-in + custom types
3. Go to `/settings/access` — see API keys and permissions matrix

### 8. Project settings
1. Go to `/projects/settings`
2. Edit project name/description
3. Toggle feature flags (Git Intelligence, Knowledge Graph, etc.)

## What to look for

### Layout & Design
- Does the sidebar stay fixed when scrolling content?
- Do pages fill the viewport without unnecessary vertical scroll?
- Are stat cards, tables, and charts properly aligned?
- Is the dark theme consistent? Any contrast issues?
- Does the command palette (Ctrl+K) work?

### Functionality
- Can you create, edit, and archive lessons?
- Does search return relevant results?
- Do guardrail checks show blocked/allowed results?
- Does pagination work (click page numbers at bottom of tables)?
- Do status tabs (Active, Draft, Superseded) filter correctly?

### Responsive behavior
- The app is designed for 1920x1080 desktop. How does it look at 1440x900?
- Does the sidebar collapse properly (Ctrl+B)?

### Data quality
- Are lesson titles readable and meaningful?
- Do badges/tags display correctly?
- Are timestamps shown as relative time (e.g., "2 hours ago")?

### Edge cases
- What happens with empty states (no lessons, no documents)?
- What happens when you search for something that doesn't exist?
- Can you break any forms with unusual input?

## Tech stack (for context)

- **Frontend**: Next.js 16, React 19, Tailwind CSS, Lucide icons
- **Backend**: Node.js, Express REST API (port 3001), MCP server (port 3000)
- **Database**: PostgreSQL + pgvector, Neo4j (optional), Redis, RabbitMQ
- **Deployment**: Docker Compose (all services)
