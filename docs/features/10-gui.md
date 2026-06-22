# Human-in-the-Loop GUI

The GUI (Next.js, port 3002) is where humans review, approve, and refine the
knowledge agents create — and the single externally-published entrypoint (it proxies
`/api/*` to REST and `/mcp` to the MCP server). It has **32 pages**.

## Page map

### Core
| Page | Route | What you do |
|------|-------|-------------|
| Dashboard | `/` | Project health, stats, setup checklist, recent activity, quick actions |
| AI Chat | `/chat` | Streaming chat with tool calls, pinned messages, create lessons from replies, history |
| Lessons Library | `/lessons` | Browse/search/filter/tag, bulk approve/archive, import/export |
| Lesson Detail | `/lessons/[id]` | Rich editor, comments, version history, related lessons |
| Review Inbox | `/review` | Approve/return AI-generated and submitted lessons |
| Guardrails | `/guardrails` | Browse rules, test/simulate actions |

### Knowledge
| Page | Route | What you do |
|------|-------|-------------|
| Documents | `/documents` | Upload/extract/chunk/search PDFs, images, URLs |
| Code Search | `/knowledge/search` | Tiered search with file-kind filters |
| Graph Explorer | `/knowledge/graph` | Symbol search, dependency tracing (Neo4j) |
| Generated Docs | `/knowledge/docs` | FAQ/RAPTOR/QC/benchmarks; promote to lesson |
| Activity | `/activity` | Unified event timeline + notification settings |
| Analytics | `/analytics` | Retrieval trends, approval rates, dead knowledge |
| Getting Started | `/getting-started` | Onboarding learning path with progress tracking |
| Feature Guide | `/guide` | In-app interactive guide to every feature |

### Projects
| Page | Route |
|------|-------|
| Projects Overview | `/projects` |
| Project Settings | `/projects/settings` |
| Git History | `/projects/git` |
| Project Sources | `/projects/sources` |
| Groups | `/projects/groups` |

### Administration & Security
| Page | Route | What you do |
|------|-------|-------------|
| Agent Audit | `/agents` | Agent timeline, trust levels, approval stats |
| System Settings | `/settings` | Server info, ports, feature flags, model details |
| Access Control | `/settings/access` | API keys, roles, permissions |
| Sessions & Security | `/settings/sessions` | List/revoke sessions |
| Lesson Types | `/settings/lesson-types` | Custom lesson types |
| Model Providers | `/settings/models` | LLM provider config |
| Access Review | `/governance/access-review` | Credential rotation, ephemeral keys |
| Identity / Delegation / Authorization | `/identity`, `/delegation`, `/authorization` | Principals, grants, authz tree |

### Operations & Auth
| Page | Route |
|------|-------|
| Job Queue | `/jobs` |
| Login / Register / Bootstrap | `/login`, `/register`, `/bootstrap` |

## GUI-supporting REST endpoints

These pages are backed by REST endpoints that exist for the GUI (and integrations)
but are **not** exposed as MCP tools:

| Endpoint | Powers |
|----------|--------|
| `/api/chat` | Streaming AI chat with tool calls |
| `/api/analytics` | Retrieval trends, approval rates, dead-knowledge |
| `/api/activity` | Activity timeline feed |
| `/api/notifications` | Unread notifications + settings |
| `/api/agents` | Agent audit trail + trust levels |
| `/api/audit` | Guardrail/action audit log + stats |
| `/api/learning-paths` | Onboarding learning path + progress |
| `/api/bookmarks`, lesson comments/feedback | Collaboration (bookmarks, threads, thumbs) |

## Cross-cutting UX

- **Cmd+K** global search on every page.
- **Project selector** with an "All Projects" mode on cross-project views.
- Consistent Tailwind dark theme + shared component library.

## Related

Every page is backed by the [REST API](../../FEATURES.md) and ultimately the same
services the [MCP tools](01-memory-lessons.md) use.
