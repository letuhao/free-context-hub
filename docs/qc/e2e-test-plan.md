# E2E Test Plan — free-context-hub

## Context

Phase 8D just completed (feature toggles, role enforcement, rich editor, onboarding checklist). Before starting Phase 9 (multi-format ingestion), we need a comprehensive safety net of E2E tests. The project has **105 REST endpoints**, **45 MCP tools**, and **23 GUI pages** — with zero browser tests and no systematic coverage.

## Test Philosophy: Two Layers

### Layer 1: Smoke Tests (every surface, "does it work at all?")
- **API smoke**: Hit every endpoint once → expect not-500
- **GUI screenshots**: Navigate every page → screenshot + no console errors
- **MCP tool smoke**: Call every tool once → expect valid response

### Layer 2: Scenario Tests (key flows, "does it work correctly?")
- CRUD lifecycles, role enforcement, guardrail blocking, search accuracy
- MCP→GUI visual verification (agent adds data, GUI reflects it)

**Layer 1 runs first. If a page is broken, Layer 2 fails for the right reasons.**

---

## Test Counts

| Category | Layer 1 (Smoke) | Layer 2 (Scenario) | Total |
|----------|----------------:|-------------------:|------:|
| API      | 60              | 33                 | 93    |
| GUI      | 23              | 21                 | 44    |
| MCP      | 45              | 9                  | 54    |
| **Total**| **128**         | **63**             | **191** |

---

## Directory Structure

```
test/e2e/
├── shared/
│   ├── constants.ts          # API_BASE, MCP_URL, GUI_URL, PROJECT_ID
│   ├── apiClient.ts          # typed REST fetch wrapper with auth header support
│   ├── mcpClient.ts          # MCP connect/disconnect (re-exports qc pattern)
│   ├── authHelpers.ts        # create/revoke test API keys per role
│   ├── cleanup.ts            # global cleanup registry (lessons, docs, keys)
│   └── testContext.ts        # E2ETestContext type, bootstrap/teardown
│
├── smoke/
│   ├── runner.ts             # Layer 1 runner — all smoke tests
│   ├── api-smoke.test.ts     # 60 tests — every endpoint once
│   ├── gui-smoke.spec.ts     # 23 tests — every page screenshot
│   └── mcp-smoke.test.ts     # 45 tests — every tool once
│
├── api/
│   ├── runner.ts             # Layer 2 API runner
│   ├── auth.test.ts          # 7 tests — roles, 401/403
│   ├── lessons.test.ts       # 8 tests — CRUD, search, export/import
│   ├── guardrails.test.ts    # 6 tests — rules, check, simulate, supersede
│   ├── documents.test.ts     # 5 tests — create, upload, link, filter
│   ├── search.test.ts        # 4 tests — global, tiered, empty query
│   └── system.test.ts        # 3 tests — health, info, lesson-types CRUD
│
├── gui/
│   ├── playwright.config.ts  # Chromium only, sequential, HTML report
│   ├── fixtures.ts           # extended test with apiClient + cleanup + projectId
│   ├── dashboard.spec.ts     # 5 tests
│   ├── lessons.spec.ts       # 7 tests
│   ├── guardrails.spec.ts    # 4 tests
│   └── settings.spec.ts      # 5 tests
│
└── agent/
    ├── runner.ts             # MCP + Playwright hybrid runner
    ├── agentContext.ts        # MCP client + Playwright page combined context
    ├── lessonFlow.spec.ts    # 4 tests
    ├── guardrailFlow.spec.ts # 3 tests
    └── bootstrapFlow.spec.ts # 2 tests
```

---

## Layer 1: Smoke Tests

### API Smoke — 60 tests (`smoke/api-smoke.test.ts`)

Each test calls one endpoint with minimal valid params, expects HTTP status != 500. Grouped by route module.

#### Lessons (11 endpoints)
| Test | Method | Path | Expect |
|------|--------|------|--------|
| `smoke-GET-lessons` | GET | /api/lessons?project_id=P | 200 |
| `smoke-POST-lesson` | POST | /api/lessons | 201 (cleanup) |
| `smoke-POST-lessons-search` | POST | /api/lessons/search | 200 |
| `smoke-POST-lesson-improve` | POST | /api/lessons/:id/improve | 200 or skip (distillation) |
| `smoke-POST-lesson-suggest-tags` | POST | /api/lessons/:id/suggest-tags | 200 or skip |
| `smoke-GET-lesson-versions` | GET | /api/lessons/:id/versions | 200 |
| `smoke-PUT-lesson` | PUT | /api/lessons/:id | 200 |
| `smoke-POST-batch-status` | POST | /api/lessons/batch-status | 200 |
| `smoke-PATCH-lesson-status` | PATCH | /api/lessons/:id/status | 200 |
| `smoke-GET-lessons-export` | GET | /api/lessons/export?project_id=P | 200 |
| `smoke-POST-lessons-import` | POST | /api/lessons/import | 200 |

#### Projects (7 endpoints)
| Test | Method | Path | Expect |
|------|--------|------|--------|
| `smoke-GET-projects` | GET | /api/projects | 200 |
| `smoke-POST-project` | POST | /api/projects | 201 (cleanup) |
| `smoke-PUT-project` | PUT | /api/projects/:id | 200 |
| `smoke-GET-project-summary` | GET | /api/projects/:id/summary | 200 or 404 |
| `smoke-POST-project-index` | POST | /api/projects/:id/index | 200 or skip |
| `smoke-POST-project-reflect` | POST | /api/projects/:id/reflect | 200 or skip |
| `smoke-DELETE-project` | DELETE | /api/projects/:id | 200 (test project) |

#### Guardrails (3 endpoints)
| Test | Method | Path | Expect |
|------|--------|------|--------|
| `smoke-GET-guardrail-rules` | GET | /api/guardrails/rules?project_id=P | 200 |
| `smoke-POST-guardrail-simulate` | POST | /api/guardrails/simulate | 200 |
| `smoke-POST-guardrail-check` | POST | /api/guardrails/check | 200 |

#### Search (2 endpoints)
| Test | Method | Path | Expect |
|------|--------|------|--------|
| `smoke-POST-search-tiered` | POST | /api/search/code-tiered | 200 |
| `smoke-GET-search-global` | GET | /api/search/global?project_id=P&q=test | 200 |

#### Chat + Conversations (6 endpoints)
| Test | Method | Path | Expect |
|------|--------|------|--------|
| `smoke-POST-chat` | POST | /api/chat | 200 or skip (distillation) |
| `smoke-POST-conversation` | POST | /api/chat/conversations | 201 (cleanup) |
| `smoke-GET-conversations` | GET | /api/chat/conversations?project_id=P | 200 |
| `smoke-GET-conversation` | GET | /api/chat/conversations/:id | 200 |
| `smoke-POST-message` | POST | /api/chat/conversations/:id/messages | 201 |
| `smoke-DELETE-conversation` | DELETE | /api/chat/conversations/:id | 200 |

#### Documents (9 endpoints)
| Test | Method | Path | Expect |
|------|--------|------|--------|
| `smoke-POST-document` | POST | /api/documents | 201 (cleanup) |
| `smoke-POST-document-upload` | POST | /api/documents/upload | 201 |
| `smoke-GET-documents` | GET | /api/documents?project_id=P | 200 |
| `smoke-GET-document` | GET | /api/documents/:id | 200 |
| `smoke-POST-doc-generate-lessons` | POST | /api/documents/:id/generate-lessons | 200 or skip |
| `smoke-DELETE-document` | DELETE | /api/documents/:id | 200 |
| `smoke-POST-doc-lesson-link` | POST | /api/documents/:id/lessons/:lid | 201 |
| `smoke-DELETE-doc-lesson-link` | DELETE | /api/documents/:id/lessons/:lid | 200 |
| `smoke-GET-doc-lessons` | GET | /api/documents/:id/lessons | 200 |

#### Collaboration (6 endpoints)
| Test | Method | Path | Expect |
|------|--------|------|--------|
| `smoke-GET-comments` | GET | /api/lessons/:id/comments | 200 |
| `smoke-POST-comment` | POST | /api/lessons/:id/comments | 201 |
| `smoke-DELETE-comment` | DELETE | /api/lessons/:id/comments/:cid | 200 |
| `smoke-GET-feedback` | GET | /api/lessons/:id/feedback | 200 |
| `smoke-POST-feedback` | POST | /api/lessons/:id/feedback | 200 |
| `smoke-DELETE-feedback` | DELETE | /api/lessons/:id/feedback | 200 |

#### Bookmarks (3 endpoints)
| Test | Method | Path | Expect |
|------|--------|------|--------|
| `smoke-GET-bookmarks` | GET | /api/bookmarks?project_id=P | 200 |
| `smoke-POST-bookmark` | POST | /api/bookmarks | 201 |
| `smoke-DELETE-bookmark` | DELETE | /api/bookmarks | 200 |

#### Activity + Notifications (4 endpoints)
| Test | Method | Path | Expect |
|------|--------|------|--------|
| `smoke-GET-activity` | GET | /api/activity?project_id=P | 200 |
| `smoke-GET-notifications` | GET | /api/notifications?project_id=P | 200 |
| `smoke-GET-notification-settings` | GET | /api/notifications/settings?project_id=P | 200 |
| `smoke-PUT-notification-settings` | PUT | /api/notifications/settings | 200 |

#### Analytics (6 endpoints)
| Test | Method | Path | Expect |
|------|--------|------|--------|
| `smoke-GET-analytics-overview` | GET | /api/analytics/overview?project_id=P | 200 |
| `smoke-GET-analytics-by-type` | GET | /api/analytics/by-type?project_id=P | 200 |
| `smoke-GET-analytics-top-lessons` | GET | /api/analytics/top-lessons?project_id=P | 200 |
| `smoke-GET-analytics-dead` | GET | /api/analytics/dead-knowledge?project_id=P | 200 |
| `smoke-GET-analytics-timeseries` | GET | /api/analytics/timeseries?project_id=P | 200 |
| `smoke-GET-analytics-agents` | GET | /api/analytics/agents?project_id=P | 200 |

#### System + Admin (9 endpoints)
| Test | Method | Path | Expect |
|------|--------|------|--------|
| `smoke-GET-health` | GET | /api/system/health | 200 |
| `smoke-GET-info` | GET | /api/system/info | 200 |
| `smoke-GET-lesson-types` | GET | /api/lesson-types | 200 |
| `smoke-GET-api-keys` | GET | /api/api-keys | 200 |
| `smoke-GET-audit` | GET | /api/audit?project_id=P | 200 |
| `smoke-GET-audit-stats` | GET | /api/audit/stats?project_id=P | 200 |
| `smoke-GET-agents` | GET | /api/agents?project_id=P | 200 |
| `smoke-GET-groups` | GET | /api/groups | 200 |
| `smoke-GET-learning-paths` | GET | /api/learning-paths?project_id=P | 200 |

#### Git (5 endpoints)
| Test | Method | Path | Expect |
|------|--------|------|--------|
| `smoke-GET-commits` | GET | /api/git/commits?project_id=P | 200 |
| `smoke-GET-commit` | GET | /api/git/commits/:sha | 200 or 404 |
| `smoke-POST-git-ingest` | POST | /api/git/ingest | 200 or skip |
| `smoke-POST-git-suggest` | POST | /api/git/suggest-lessons | 200 |
| `smoke-POST-git-impact` | POST | /api/git/analyze-impact | 200 |

---

### GUI Smoke — 23 tests (`smoke/gui-smoke.spec.ts`)

Each test navigates to a page, waits for load, takes a screenshot, asserts no unhandled console errors.

| Test | Page | URL |
|------|------|-----|
| `gui-smoke-dashboard` | Dashboard | `/` |
| `gui-smoke-lessons` | Lessons | `/lessons` |
| `gui-smoke-review` | Review Inbox | `/review` |
| `gui-smoke-guardrails` | Guardrails | `/guardrails` |
| `gui-smoke-chat` | Chat | `/chat` |
| `gui-smoke-documents` | Documents | `/documents` |
| `gui-smoke-getting-started` | Getting Started | `/getting-started` |
| `gui-smoke-activity` | Activity | `/activity` |
| `gui-smoke-analytics` | Analytics | `/analytics` |
| `gui-smoke-agents` | Agents | `/agents` |
| `gui-smoke-jobs` | Jobs | `/jobs` |
| `gui-smoke-knowledge-docs` | Knowledge Docs | `/knowledge/docs` |
| `gui-smoke-knowledge-graph` | Knowledge Graph | `/knowledge/graph` |
| `gui-smoke-knowledge-search` | Knowledge Search | `/knowledge/search` |
| `gui-smoke-projects` | Projects | `/projects` |
| `gui-smoke-projects-git` | Projects Git | `/projects/git` |
| `gui-smoke-projects-groups` | Projects Groups | `/projects/groups` |
| `gui-smoke-projects-sources` | Projects Sources | `/projects/sources` |
| `gui-smoke-projects-settings` | Projects Settings | `/projects/settings` |
| `gui-smoke-settings` | Settings | `/settings` |
| `gui-smoke-settings-models` | Model Providers | `/settings/models` |
| `gui-smoke-settings-lesson-types` | Lesson Types | `/settings/lesson-types` |
| `gui-smoke-settings-access` | Access Control | `/settings/access` |

**Screenshots saved to `docs/qc/screenshots/` as visual baseline.**

---

### MCP Tool Smoke — 45 tests (`smoke/mcp-smoke.test.ts`)

Each test calls one MCP tool with minimal valid args, expects a non-error response.

| # | Tool | Minimal Args |
|---|------|-------------|
| 1 | `help` | `{}` |
| 2 | `index_project` | `{project_id, root}` (skip if no root) |
| 3 | `search_code` | `{project_id, query:"test"}` |
| 4 | `search_code_tiered` | `{project_id, query:"test"}` |
| 5 | `list_lessons` | `{project_id}` |
| 6 | `search_lessons` | `{project_id, query:"test"}` |
| 7 | `add_lesson` | `{lesson_payload:{project_id, lesson_type:"decision", title, content}}` (cleanup) |
| 8 | `update_lesson` | `{project_id, lesson_id, title:"updated"}` |
| 9 | `update_lesson_status` | `{project_id, lesson_id, status:"archived"}` |
| 10 | `list_lesson_versions` | `{project_id, lesson_id}` |
| 11 | `check_guardrails` | `{project_id, action_context:{action:"test"}}` |
| 12 | `get_context` | `{project_id, task:"test"}` |
| 13 | `get_project_summary` | `{project_id}` |
| 14 | `reflect` | `{project_id, topic:"test"}` (skip if no distillation) |
| 15 | `compress_context` | `{text:"hello world"}` (skip if no distillation) |
| 16 | `delete_workspace` | `{project_id:"e2e-temp-delete"}` |
| 17 | `search_symbols` | `{project_id, query:"test"}` (skip if KG off) |
| 18 | `get_symbol_neighbors` | `{project_id, symbol_id:"test"}` (skip if KG off) |
| 19 | `trace_dependency_path` | `{project_id, from_symbol_id:"a", to_symbol_id:"b"}` (skip if KG off) |
| 20 | `get_lesson_impact` | `{project_id, lesson_id}` (skip if KG off) |
| 21 | `ingest_git_history` | `{project_id, root}` (skip if no git) |
| 22 | `list_commits` | `{project_id}` |
| 23 | `get_commit` | `{project_id, sha:"0000000"}` |
| 24 | `suggest_lessons_from_commits` | `{project_id}` |
| 25 | `link_commit_to_lesson` | `{project_id, commit_sha:"test", lesson_id}` |
| 26 | `analyze_commit_impact` | `{project_id, commit_sha:"test"}` |
| 27 | `configure_project_source` | `{project_id, source_mode:"local", root}` |
| 28 | `prepare_repo` | `{project_id}` (skip if no git_url) |
| 29 | `get_project_source` | `{project_id}` |
| 30 | `register_workspace_root` | `{project_id, root:"."}` |
| 31 | `list_workspace_roots` | `{project_id}` |
| 32 | `scan_workspace` | `{project_id}` |
| 33 | `enqueue_job` | `{project_id, job_type:"index_project"}` |
| 34 | `list_jobs` | `{project_id}` |
| 35 | `run_next_job` | `{project_id}` |
| 36 | `list_generated_documents` | `{project_id}` |
| 37 | `get_generated_document` | `{project_id, doc_id:"nonexistent"}` |
| 38 | `promote_generated_document` | `{project_id, doc_id:"nonexistent"}` |
| 39 | `list_groups` | `{}` |
| 40 | `create_group` | `{name:"e2e-smoke-group"}` (cleanup) |
| 41 | `delete_group` | `{group_id}` |
| 42 | `add_project_to_group` | `{group_id, project_id}` |
| 43 | `remove_project_from_group` | `{group_id, project_id}` |
| 44 | `list_group_members` | `{group_id}` |
| 45 | `list_project_groups` | `{project_id}` |

---

## Layer 2: Scenario Tests

### API Scenarios — 33 tests

#### auth.test.ts (7)
| Test | Verifies |
|------|----------|
| `auth-no-token-401` | GET /api/lessons without Bearer → 401 |
| `auth-invalid-token-401` | Bearer garbage-token → 401 |
| `auth-reader-cannot-POST-lesson` | Reader key + POST /api/lessons → 403 |
| `auth-reader-can-GET-lessons` | Reader key + GET /api/lessons → 200 |
| `auth-writer-can-POST-lesson` | Writer key + POST /api/lessons → 201 |
| `auth-writer-cannot-DELETE-project` | Writer key + DELETE /api/projects/:id → 403 |
| `auth-admin-env-token-full-access` | Env var token bypasses role check → not 403 |

#### lessons.test.ts (8)
| Test | Verifies |
|------|----------|
| `lesson-crud-full-lifecycle` | Create → list → update → version history → status change |
| `lesson-pagination-and-sorting` | limit/offset/sort/order params work |
| `lesson-filter-by-type` | lesson_type and tags_any filters |
| `lesson-semantic-search` | POST /search returns matches, respects status filter |
| `lesson-search-multi-project` | Multi-project search doesn't 500 on missing project |
| `lesson-batch-status-update` | Bulk archive 3 lessons, verify counts |
| `lesson-export-and-import` | Export JSON → import with skip_duplicates |
| `lesson-missing-fields-400` | Missing project_id/lesson_type → 400 |

#### guardrails.test.ts (6)
| Test | Verifies |
|------|----------|
| `guardrail-rules-list` | GET rules returns correct count after adding guardrail |
| `guardrail-check-blocks` | Matching action → pass=false, matched_rules present |
| `guardrail-check-passes` | Unrelated action → pass=true |
| `guardrail-simulate-bulk` | 3 actions → 3 results with correct pass/fail |
| `guardrail-simulate-max-50` | 51 actions → 400 error |
| `guardrail-superseded-no-block` | Superseded guardrail no longer enforced |

#### documents.test.ts (5)
| Test | Verifies |
|------|----------|
| `document-json-create-get-delete` | Full CRUD lifecycle + 404 after delete |
| `document-multipart-upload` | File upload via FormData → doc_type detected |
| `document-lesson-linking` | Link/unlink doc↔lesson, verify counts |
| `document-list-with-filters` | linked/unlinked and doc_type filters |
| `document-missing-file-400` | Upload without file → 400 |

#### search.test.ts (4)
| Test | Verifies |
|------|----------|
| `global-search-all-types` | Returns lessons, documents, guardrails arrays |
| `global-search-empty-query` | Empty q → total_count=0 |
| `global-search-limit` | limit=1 caps each array |
| `tiered-search-graceful` | Works or returns empty (no 500) |

#### system.test.ts (3)
| Test | Verifies |
|------|----------|
| `system-health-check` | GET /health → status:"ok" |
| `system-info-features` | All feature keys present in /info |
| `lesson-types-crud` | Create → list → update → delete custom type |

---

### GUI Scenarios — 21 tests (Playwright)

#### dashboard.spec.ts (5)
- Page loads with stat cards
- Project selector renders and opens
- Create project modal works
- Recent lessons section shows seeded data
- Cmd+K command palette opens/closes

#### lessons.spec.ts (7)
- Page loads and lists lessons
- Create lesson via dialog (fill form, save, verify toast + row)
- Filter by type
- Text search with debounce
- Sort by column header
- Detail panel opens, edit with RichEditor, save
- Archive lesson via kebab menu

#### guardrails.spec.ts (4)
- Page loads with test action textarea
- Simulate blocking action → shows BLOCKED
- What Would Block mode with multiple actions
- Rules table lists seeded guardrails

#### settings.spec.ts (5)
- System info feature flags display
- Lesson types list with defaults
- Create custom lesson type
- Create and revoke API key
- Permissions matrix visible

---

### Agent MCP Scenarios — 9 tests (MCP + Playwright visual)

#### lessonFlow.spec.ts (4)
- `add_lesson` via MCP → lesson visible on GUI lessons page (screenshot)
- `update_lesson` via MCP → updated title reflected in GUI (screenshot)
- `search_lessons` via MCP → results match GUI search (screenshot)
- `update_lesson_status` to superseded → removed from GUI active list (screenshot)

#### guardrailFlow.spec.ts (3)
- Add guardrail via MCP → visible in GUI rules table (screenshot)
- `check_guardrails` via MCP → audit entry in GUI activity page (screenshot)
- Simulate same action in GUI → result matches MCP response (screenshot)

#### bootstrapFlow.spec.ts (2)
- `get_project_summary` via MCP → dashboard loads without error (screenshot)
- `help` tool → lists expected tool names

---

## Shared Utilities

### Reuse from existing codebase:
- `src/qc/testTypes.ts` — `callTool()`, `withAuth()`, `extractJson()`, `pass()`/`fail()`
- `src/qc/integrationTestRunner.ts` — runner loop, markdown report generation
- `src/qc/tests/chatHistoryTests.ts` — native `fetch()` REST test pattern

### New shared code:
- **`apiClient.ts`** — typed `fetch` wrapper with per-call `Authorization: Bearer <token>` override
- **`authHelpers.ts`** — `createTestApiKey(role)` → `{ key, key_id }`, `revokeAllTestKeys(keyIds)`
- **`cleanup.ts`** — `CleanupRegistry` tracking lessonIds, docIds, apiKeyIds with `runAll()` teardown
- **`constants.ts`** — `API_BASE`, `MCP_URL`, `GUI_URL`, `E2E_PROJECT_ID` from env with defaults

---

## Dependencies

```bash
npm install -D @playwright/test
npx playwright install chromium
```

## Package.json Scripts

```json
"test:e2e:smoke":   "tsx test/e2e/smoke/runner.ts",
"test:e2e:smoke:gui": "playwright test --config=test/e2e/gui/playwright.config.ts test/e2e/smoke/gui-smoke.spec.ts",
"test:e2e:api":     "tsx test/e2e/api/runner.ts",
"test:e2e:gui":     "playwright test --config=test/e2e/gui/playwright.config.ts test/e2e/gui/*.spec.ts",
"test:e2e:agent":   "tsx test/e2e/agent/runner.ts",
"test:e2e":         "npm run test:e2e:smoke && npm run test:e2e:api && npm run test:e2e:gui && npm run test:e2e:agent"
```

## Execution Order

```
1. docker compose up -d --wait
2. npm run test:e2e:smoke      ← Layer 1: every surface, fast, catch crashes
3. npm run test:e2e:api        ← Layer 2: API scenarios
4. npm run test:e2e:gui        ← Layer 2: GUI scenarios (Playwright)
5. npm run test:e2e:agent      ← Layer 2: MCP→GUI visual verification
```

## Test Isolation

- Every test uses `Date.now()` marker in titles (matching existing `src/qc/` pattern)
- Every test registers resources in `CleanupRegistry`, cleaned in afterEach/finally
- Dedicated `E2E_PROJECT_ID` separate from dev/integration project
- Sequential execution within files (no parallel state conflicts)
- Self-skip for optional features (embeddings, Neo4j, distillation)

## Implementation Order (sprints)

| Sprint | Scope | Tests |
|--------|-------|------:|
| 1 | Shared utilities + smoke runner infrastructure | 0 (setup) |
| 2 | API smoke (all 60 endpoints) | 60 |
| 3 | GUI smoke (all 23 pages + screenshots) | 23 |
| 4 | MCP tool smoke (all 45 tools) | 45 |
| 5 | API scenarios: auth + lessons + guardrails | 21 |
| 6 | API scenarios: documents + search + system | 12 |
| 7 | GUI scenarios: dashboard + lessons | 12 |
| 8 | GUI scenarios: guardrails + settings | 9 |
| 9 | Agent scenarios: all flows | 9 |

## Critical Files to Reference

- `src/qc/testTypes.ts` — TestResult, callTool, pass/fail patterns
- `src/qc/integrationTestRunner.ts` — runner loop + report generation
- `src/qc/tests/chatHistoryTests.ts` — REST test pattern with fetch
- `src/api/middleware/auth.ts` — bearerAuth logic (env fast path vs DB lookup)
- `src/api/middleware/requireRole.ts` — role hierarchy (reader < writer < admin)
- `src/api/index.ts` — route mounting with role enforcement
- `gui/src/components/sidebar.tsx` — all nav routes and labels for Playwright selectors

## CI/CD Considerations

```yaml
jobs:
  e2e:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
      - run: npm ci && cd gui && npm ci
      - run: docker compose up -d --wait
      - run: npx playwright install --with-deps chromium
      - run: npm run test:e2e
      - uses: actions/upload-artifact@v4
        if: always()
        with:
          name: e2e-reports
          path: |
            docs/qc/playwright-report/
            docs/qc/screenshots/
```

### Handling optional services:
- **Embeddings unavailable**: search/improve/suggest-tags tests self-skip
- **Chat disabled**: chat smoke detects 503 and marks skipped
- **Neo4j disabled**: KG tool tests skip when `KG_ENABLED=false`
- **Git not configured**: git ingest tests skip gracefully
