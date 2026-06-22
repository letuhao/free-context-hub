<!--
  Canonical feature map for free-context-hub.
  This file is the single index of what the product does. Each area links to a
  detailed doc under docs/features/. Keep counts and groupings in sync with the
  code: 105 MCP tools (src/mcp/index.ts), ~95 REST endpoints (src/api/routes/),
  32 GUI pages (gui/src/app/).
-->

# Features

A map of everything **free-context-hub** does, grouped by capability area. Each
feature lists how you reach it — **MCP** tool (for agents), **REST** path (for
integrations), and **GUI** page (for humans) — and links to a detailed guide.

> **Surface at a glance:** 105 MCP tools · ~95 REST endpoints · 32 GUI pages ·
> PostgreSQL + pgvector core, optional Neo4j / Redis / RabbitMQ.

For an end-to-end walkthrough, see the [User Guide](docs/USER_GUIDE.md). For the
strategic arc behind these features, see [ROADMAP.md](ROADMAP.md).

---

## Capability areas

| # | Area | What it gives you | Detail |
|---|------|-------------------|--------|
| 1 | **Memory & Lessons** | Durable, searchable team knowledge that survives across sessions and agents | [features/01-memory-lessons.md](docs/features/01-memory-lessons.md) |
| 2 | **Search & Retrieval** | Semantic + lexical search over lessons, code, and documents | [features/02-search-retrieval.md](docs/features/02-search-retrieval.md) |
| 3 | **Guardrails** | Pre-action policy checks that block risky operations | [features/03-guardrails.md](docs/features/03-guardrails.md) |
| 4 | **Code Intelligence** | Git ingestion, commit impact, and a symbol-level knowledge graph | [features/04-code-intelligence.md](docs/features/04-code-intelligence.md) |
| 5 | **Documents & Ingestion** | Multi-format extraction (PDF/DOCX/image/URL) with chunked search | [features/05-documents-ingestion.md](docs/features/05-documents-ingestion.md) |
| 6 | **Coordination** | Multi-actor topics, a task board, and artifact leasing | [features/06-coordination.md](docs/features/06-coordination.md) |
| 7 | **Governance & Decisions** | Approval routing, motions/voting, intake, and dispute resolution | [features/07-governance-decisions.md](docs/features/07-governance-decisions.md) |
| 8 | **Access Control & Identity** | Auth, principals, capability grants, API keys, tenant scope | [features/08-access-control-identity.md](docs/features/08-access-control-identity.md) |
| 9 | **Projects & Portability** | Multi-project organization, groups, and knowledge export/import | [features/09-projects-portability.md](docs/features/09-projects-portability.md) |
| 10 | **Human-in-the-Loop GUI** | Dashboard, chat, review inbox, analytics, and audit | [features/10-gui.md](docs/features/10-gui.md) |
| 11 | **Jobs & Operations** | Background job queue, workspace indexing, and system health | [features/11-jobs-operations.md](docs/features/11-jobs-operations.md) |

---

## 1. Memory & Lessons

The core value: capture decisions, preferences, workarounds, and guardrails once;
retrieve them forever.

| Feature | MCP | REST | GUI |
|---------|-----|------|-----|
| Capture a lesson | `add_lesson` | `POST /api/lessons` | `/lessons` |
| List / filter lessons | `list_lessons` | `GET /api/lessons` | `/lessons` |
| Update content / status | `update_lesson`, `update_lesson_status` | `PUT/PATCH /api/lessons/:id` | `/lessons/[id]` |
| Version history | `list_lesson_versions` | `GET /api/lessons/:id/versions` | `/lessons/[id]` |
| LLM synthesis across lessons | `reflect` | `POST /api/projects/:id/reflect` | `/chat` |
| Compress context | `compress_context` | — | — |
| Project briefing | `get_project_summary`, `get_context` | `GET /api/projects/:id/summary` | `/` |
| Custom lesson types / taxonomies | `*_taxonomy_profile` | `/api/lesson-types`, `/api/taxonomy-profiles` | `/settings/lesson-types` |

→ [Details](docs/features/01-memory-lessons.md)

## 2. Search & Retrieval

| Feature | MCP | REST | GUI |
|---------|-----|------|-----|
| Semantic lesson search | `search_lessons` | `POST /api/lessons/search` | `/lessons` |
| Tiered code search (ripgrep→FTS→semantic) | `search_code_tiered`, `search_code` | `POST /api/search/code-tiered` | `/knowledge/search` |
| Global search (Cmd+K) | — | `GET /api/search/global` | everywhere |
| Document chunk search (hybrid) | `search_document_chunks` | `GET /api/documents/.../chunks` | `/documents` |
| Reranking | (built into tiered search) | — | — |

→ [Details](docs/features/02-search-retrieval.md)

## 3. Guardrails

| Feature | MCP | REST | GUI |
|---------|-----|------|-----|
| Pre-action check | `check_guardrails` | `POST /api/guardrails/check` | `/guardrails` |
| "What would block?" simulate | — | `POST /api/guardrails/simulate` | `/guardrails` |
| Manage guardrail rules | (via `add_lesson` type=guardrail) | `GET /api/guardrails/rules` | `/guardrails` |

→ [Details](docs/features/03-guardrails.md)

## 4. Code Intelligence

| Feature | MCP | REST | GUI |
|---------|-----|------|-----|
| Ingest git history | `ingest_git_history` | `POST /api/git/ingest` | `/projects/git` |
| Browse commits | `list_commits`, `get_commit` | `GET /api/git/commits` | `/projects/git` |
| Suggest lessons from commits | `suggest_lessons_from_commits` | `POST /api/git/suggest-lessons` | `/projects/git` |
| Commit impact analysis | `analyze_commit_impact` | `POST /api/git/analyze-impact` | `/projects/git` |
| Symbol search / neighbors / paths | `search_symbols`, `get_symbol_neighbors`, `trace_dependency_path` | — | `/knowledge/graph` |
| Lesson → code impact | `get_lesson_impact` | — | `/knowledge/graph` |
| Index a project | `index_project` | `POST /api/projects/:id/index` | `/projects/sources` |

→ [Details](docs/features/04-code-intelligence.md)

## 5. Documents & Ingestion

| Feature | MCP | REST | GUI |
|---------|-----|------|-----|
| Upload & extract (PDF/DOCX/image) | — | `POST /api/documents/upload` | `/documents` |
| Ingest from URL (SSRF-hardened) | `ingest_document` | `POST /api/documents/ingest-url` | `/documents` |
| Chunk + embed + search | `search_document_chunks` | `GET /api/documents/:id/chunks` | `/documents` |
| Generated docs (FAQ/RAPTOR/QC) | `list_generated_documents`, `get_generated_document`, `promote_generated_document` | `/api/generated-docs` | `/knowledge/docs` |

→ [Details](docs/features/05-documents-ingestion.md)

## 6. Coordination

| Feature | MCP | REST | GUI |
|---------|-----|------|-----|
| Charter / join / close a topic | `charter_topic`, `join_topic`, `close_topic`, `get_topic` | `/api/topics` | — |
| Task board | `post_task`, `list_board`, `claim_task`, `release_task`, `complete_task` | `/api/topics/:id/tasks` | — |
| Write / baseline artifacts | `write_artifact`, `baseline_artifact` | `/api/topics/:id/tasks` | — |
| Artifact leasing (anti-collision) | `claim_artifact`, `release_artifact`, `renew_artifact`, `list_active_claims`, `check_artifact_availability` | `/api/projects/:id/artifact-leases` | — |
| Event log replay | `replay_topic_events` | `GET /api/topics/:id/events` | — |

→ [Details](docs/features/06-coordination.md)

## 7. Governance & Decisions

| Feature | MCP | REST | GUI |
|---------|-----|------|-----|
| Approval routing (DoA matrix) | `submit_request`, `list_requests`, `get_request`, `decide_request_step` | `/api/topics/:id/requests` | — |
| Motions & voting | `propose_motion`, `second_motion`, `cast_vote`, `veto_motion`, `tally_motion`, `list_motions`, `get_motion` | `/api/topics/:id/motions` | — |
| Decision bodies & proxies | `create_decision_body`, `add_body_member`, `grant_proxy`, `revoke_proxy`, `list_proxies`, `get/list_decision_bodies` | `/api/decision-bodies` | — |
| Intake mailbox | `submit_intake`, `triage_intake`, `dismiss_intake`, `get/list_intake` | `/api/intake` | — |
| Dispute resolution | `open_dispute`, `resolve_dispute`, `get/list_disputes` | `/api/topics/:id/disputes` | — |
| Review queue | `submit_for_review`, `list_review_requests` | `/api/projects/:id/review-requests` | `/review` |

→ [Details](docs/features/07-governance-decisions.md)

## 8. Access Control & Identity

| Feature | MCP | REST | GUI |
|---------|-----|------|-----|
| Who am I | `whoami` | `GET /api/me` | — |
| Login / MFA / sessions | — | `/api/auth` | `/login`, `/settings/sessions` |
| Principal directory | `list_principals` | `/api/principals` | `/identity` |
| Capability grants | `grant_capability`, `revoke_grant`, `list_grants`, `explain_authorization` | `/api/grants`, `/api/authz` | `/delegation`, `/authorization` |
| API keys & ephemeral keys | `mint_ephemeral_key` | `/api/api-keys`, `/api/access-review` | `/settings/access`, `/governance/access-review` |
| First-run bootstrap | — | `/api/bootstrap` | `/bootstrap` |

→ [Details](docs/features/08-access-control-identity.md)

## 9. Projects & Portability

| Feature | MCP | REST | GUI |
|---------|-----|------|-----|
| Projects (CRUD, summary) | `get_project_summary`, `delete_workspace` | `/api/projects` | `/projects`, `/projects/settings` |
| Project groups (knowledge sharing) | `create_group`, `add_project_to_group`, … | `/api/groups` | `/projects/groups` |
| Sources & workspace roots | `configure_project_source`, `prepare_repo`, `register_workspace_root`, `list_workspace_roots`, `scan_workspace` | `/api/workspace` | `/projects/sources` |
| Export / import bundles | — | `POST /api/projects/:id/export`, `/import` | `/projects/settings` |
| Cross-instance pull | — | `POST /api/projects/:id/pull-from` | `/projects/settings` |

→ [Details](docs/features/09-projects-portability.md)

## 10. Human-in-the-Loop GUI

| Feature | GUI page |
|---------|----------|
| Dashboard (health, activity, setup checklist) | `/` |
| AI chat (streaming, tool calls, pin to lesson) | `/chat` |
| Review inbox (approve AI-generated lessons) | `/review` |
| Analytics (retrieval trends, dead knowledge) | `/analytics` |
| Activity timeline | `/activity` |
| Agent audit trail & trust | `/agents` |
| Onboarding learning path | `/getting-started` |
| In-app feature guide | `/guide` |

These pages are backed by REST endpoints that are GUI-facing (not exposed as MCP
tools): `/api/chat` (streaming), `/api/analytics`, `/api/activity`,
`/api/notifications`, `/api/agents` (audit + trust), `/api/audit`,
`/api/learning-paths` (onboarding), and the collaboration endpoints
`/api/bookmarks` + lesson comments/feedback.

→ [Details](docs/features/10-gui.md)

## 11. Jobs & Operations

| Feature | MCP | REST | GUI |
|---------|-----|------|-----|
| Enqueue / run / list jobs | `enqueue_job`, `run_next_job`, `list_jobs` | `/api/jobs` | `/jobs` |
| System health / info | — | `/api/system/health`, `/api/system/info` | `/settings` |
| Model providers | — | — | `/settings/models` |

→ [Details](docs/features/11-jobs-operations.md)

---

## Optional / feature-gated capabilities

Some areas are off by default and enabled via `.env`:

| Capability | Flag | Default |
|------------|------|---------|
| Knowledge Graph (Neo4j) | `KG_ENABLED` | `false` |
| Job queue (RabbitMQ) | `QUEUE_ENABLED` | `false` |
| Tiered-search cache (Redis) | `REDIS_ENABLED` | `false` |
| Git ingestion | `GIT_INGEST_ENABLED` | `true` |
| LLM distillation (`reflect`/`compress`) | `DISTILLATION_ENABLED` | depends on model |
| MCP auth enforcement | `MCP_AUTH_ENABLED` | deployment-specific |

See [docs/QUICKSTART.md](docs/QUICKSTART.md) for full configuration.
