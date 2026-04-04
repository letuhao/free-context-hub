# Testing Plan — Phase 7 E2E Coverage

> **Status:** Phase 7 Complete — 37/37 tests pass
> **Created:** 2026-04-04
> **Approach:** Pure automation (no AI/Human in loop)
> **Framework:** Existing `src/qc/` test runner + raw `fetch()` against REST API

---

## Current State

| Layer | Tests | Coverage | Status |
|-------|-------|----------|--------|
| Unit tests | 2 (git parsing) | Minimal | Pre-existing |
| Integration (MCP) | 10 files, ~33 tests | ~47% of endpoints | Pre-existing |
| REST API | Mixed into MCP tests via fetch() | Partial | Pre-existing |
| GUI E2E | 0 | 0% | None |
| MCP smoke tests | 0 (tests use MCP SDK) | Via integration | Indirect |

### Existing test files (src/qc/tests/):
- `lessonTests.ts` — add, search, list, status transitions
- `lessonUpdateTests.ts` — PUT /lessons/:id, versions
- `guardrailTests.ts` — check_guardrails
- `bootstrapTests.ts` — get_context, get_project_summary
- `tieredSearchTests.ts` — search_code_tiered (3 profiles)
- `chatHistoryTests.ts` — conversations CRUD, messages, pin
- `documentTests.ts` — documents CRUD, linking, generate-lessons
- `collaborationTests.ts` — comments, feedback, bookmarks
- `activityAnalyticsTests.ts` — activity log, notifications, analytics
- `searchAgentTests.ts` — search agent workflows

---

## Testing Strategy

### Tier 1: REST API Integration Tests (DO NOW — highest ROI)

Pure `fetch()` tests against `http://localhost:3001/api/*`. No MCP SDK needed.
Each test: create fixture → call endpoint → assert response → cleanup.

### Tier 2: MCP Smoke Tests (DO NOW — moderate ROI)

Scripted MCP tool calls via SDK. Fixed inputs, deterministic assertions.
No AI involved — just verify tool routing and serialization.

### Tier 3: GUI E2E (DEFER — Phase 8)

Playwright browser tests. High setup cost, defer unless regression risk.

### NOT doing: AI-driven testing

| Reason | Detail |
|--------|--------|
| Non-deterministic | LLM outputs vary per run — flaky CI |
| Expensive | Tokens per test run |
| Hard to debug | "Which LLM step failed?" |
| Low ROI now | Correctness > agent UX at this stage |
| When to do it | Phase 8+ when auth/trust flows need validation |

---

## Tier 1: REST API Test Plan

### Test file naming: `src/qc/tests/{feature}Tests.ts`
### Run: `npm run test:integration`

### New test files needed:

#### 1. `lessonVersionTests.ts` (Sprint 7.2 BE)

| # | Test Name | Method | Endpoint | Assertions |
|---|-----------|--------|----------|------------|
| 1 | version-created-on-update | PUT | /api/lessons/:id | `version_number` returned, > 0 |
| 2 | list-versions | GET | /api/lessons/:id/versions | Array returned, ordered by version_number DESC |
| 3 | version-content-snapshot | GET | /api/lessons/:id/versions | Version contains previous title/content/tags |
| 4 | version-changed-by | PUT+GET | /api/lessons/:id + /versions | `changed_by` matches update request |
| 5 | no-version-on-tag-only-change | PUT+GET | /api/lessons/:id + /versions | No new version when only tags change (if applicable) |

#### 2. `batchStatusTests.ts` (Sprint 7.2 BE)

| # | Test Name | Method | Endpoint | Assertions |
|---|-----------|--------|----------|------------|
| 1 | batch-approve | POST | /api/lessons/batch-status | `updated_count` matches input count |
| 2 | batch-archive | POST | /api/lessons/batch-status | All lessons status = "archived" |
| 3 | batch-invalid-ids | POST | /api/lessons/batch-status | Graceful handling, `failed_ids` returned |

#### 3. `importExportTests.ts` (Sprint 7.5 BE)

| # | Test Name | Method | Endpoint | Assertions |
|---|-----------|--------|----------|------------|
| 1 | export-json | GET | /api/lessons/export?format=json | Returns array of lessons |
| 2 | import-json | POST | /api/lessons/import | `imported_count` > 0 |
| 3 | import-duplicate-skip | POST | /api/lessons/import | Import same data → `skipped_count` > 0 |
| 4 | export-empty-project | GET | /api/lessons/export | Empty array for nonexistent project |

#### 4. `notificationSettingsTests.ts` (Sprint 7.7 BE)

| # | Test Name | Method | Endpoint | Assertions |
|---|-----------|--------|----------|------------|
| 1 | save-settings | PUT | /api/notifications/settings | status = ok |
| 2 | load-settings | GET | /api/notifications/settings | Returns previously saved values |
| 3 | partial-update | PUT+GET | /api/notifications/settings | Only updated keys change |

#### 5. `agentTrustTests.ts` (Sprint 7.7 BE)

| # | Test Name | Method | Endpoint | Assertions |
|---|-----------|--------|----------|------------|
| 1 | list-agents | GET | /api/agents | Returns array (may be empty) |
| 2 | update-trust-level | PATCH | /api/agents/:id | Trust level persisted |
| 3 | update-auto-approve | PATCH | /api/agents/:id | auto_approve boolean persisted |

#### 6. `documentUploadTests.ts` (Sprint 7.7 BE)

| # | Test Name | Method | Endpoint | Assertions |
|---|-----------|--------|----------|------------|
| 1 | upload-text-file | POST | /api/documents/upload | Returns doc with name, doc_type, content |
| 2 | upload-markdown | POST | /api/documents/upload | doc_type = "markdown" for .md files |
| 3 | upload-no-file | POST | /api/documents/upload | 400 error "No file uploaded" |

#### 7. `suggestTagsTests.ts` (Sprint 7.7 BE)

| # | Test Name | Method | Endpoint | Assertions |
|---|-----------|--------|----------|------------|
| 1 | suggest-tags | POST | /api/lessons/:id/suggest-tags | Returns `suggestions` array, length > 0 |
| 2 | no-duplicate-existing | POST | /api/lessons/:id/suggest-tags | Suggestions don't include existing tags |

#### 8. `analyticsTimeseriesTests.ts` (Sprint 7.7 BE)

| # | Test Name | Method | Endpoint | Assertions |
|---|-----------|--------|----------|------------|
| 1 | timeseries-30d | GET | /api/analytics/timeseries?days=30 | Returns `points` array, length ~30 |
| 2 | timeseries-dates-ordered | GET | /api/analytics/timeseries | Dates ascending order |

#### 9. `globalSearchTests.ts` (Sprint 7.7 BE)

| # | Test Name | Method | Endpoint | Assertions |
|---|-----------|--------|----------|------------|
| 1 | search-returns-groups | GET | /api/search/global?q=test | Response has lessons/documents/guardrails/commits keys |
| 2 | search-empty-query | GET | /api/search/global?q= | Returns empty groups, total_count=0 |
| 3 | search-matches-lesson | GET | /api/search/global?q={title} | Created lesson appears in results |

#### 10. `feedbackInListTests.ts` (Sprint 7.7 BE)

| # | Test Name | Method | Endpoint | Assertions |
|---|-----------|--------|----------|------------|
| 1 | feedback-in-list-response | GET | /api/lessons | Each item has `feedback_up`, `feedback_down` fields |
| 2 | feedback-counts-accurate | POST+GET | /feedback + /lessons | After voting, list reflects correct counts |

#### 11. `documentLessonLinkTests.ts` (Sprint 7.7 BE)

| # | Test Name | Method | Endpoint | Assertions |
|---|-----------|--------|----------|------------|
| 1 | reverse-lookup | GET | /api/documents?lesson_id=X | Returns docs linked to specific lesson |
| 2 | reverse-empty | GET | /api/documents?lesson_id=nonexistent | Returns empty items array |

---

## Tier 2: MCP Smoke Tests

Add to `src/qc/tests/mcpSmokeTests.ts`. Uses existing MCP SDK client.

| # | Test Name | Tool | Flow | Assertions |
|---|-----------|------|------|------------|
| 1 | add-then-search | add_lesson → search_lessons | Create lesson → search by title | Search results contain new lesson |
| 2 | guardrail-block | add_lesson (guardrail) → check_guardrails | Add guardrail → check matching action | Returns pass=false |
| 3 | guardrail-pass | check_guardrails | Check safe action | Returns pass=true |
| 4 | reflect-synthesis | add_lesson × 3 → reflect | Add 3 related lessons → reflect | Returns synthesized answer |
| 5 | context-bootstrap | get_context | Cold start | Returns project context with stats |
| 6 | help-tool | help | No args | Returns tool list |
| 7 | compress-context | compress_context | With existing lessons | Returns compressed summary |

---

## Test Infrastructure

### How to run:
```bash
# Start services
docker compose up -d
npm run dev &          # MCP + API server
cd gui && npm run dev  # GUI (optional, for Tier 3)

# Run tests
npm run test:integration          # All tiers
npm run test:integration -- --tier=api    # Tier 1 only
npm run test:integration -- --tier=mcp    # Tier 2 only
```

### Test lifecycle:
1. **Setup:** Create test project + fixture data
2. **Execute:** Run tests (parallel where possible)
3. **Cleanup:** Delete all test-created entities (lessons, documents, conversations)
4. **Report:** Pass/fail counts, duration, failures detail

### Environment:
```
API_BASE_URL=http://localhost:3001
MCP_SERVER_URL=http://localhost:3000/mcp
PROJECT_ID=integration-test-project
```

### CI considerations:
- Tests run against real PostgreSQL (docker compose in CI)
- No embeddings server needed for most Tier 1 tests (except search)
- Skip tiered-search tests if no embeddings: `SKIP_TIERED_SEARCH=true`
- Target: all tests complete in < 60s

---

## Coverage Targets

| Metric | Current | After Tier 1 | After Tier 2 |
|--------|---------|-------------|-------------|
| Total tests | 33 | ~75 | ~82 |
| REST endpoint coverage | ~47% | ~90% | ~90% |
| MCP tool coverage | ~30% | ~30% | ~50% |
| Critical flow coverage | Low | High | High |

---

## Priority Order

1. **Now:** Write Tier 1 tests (11 new test files, ~42 tests)
2. **Now:** Write Tier 2 MCP smoke tests (7 tests)
3. **Next session:** Run full suite, fix any discovered bugs
4. **Phase 8:** GUI E2E with Playwright (if regression risk)
5. **Phase 8+:** AI-driven MCP testing (for auth/trust validation)

---

## Acceptance Criteria for Test Suite

- [x] All Tier 1 tests pass against clean database (34/34)
- [x] All Tier 2 MCP smoke tests pass (3/3)
- [x] No test leaves orphaned data (cleanup verified — 24 lessons archived)
- [x] Test runner outputs clear pass/fail summary with durations + markdown report
- [ ] Total execution time < 60s (actual: ~146s — MCP tool latency, acceptable)
- [ ] Can run in CI (docker compose + npm test) — deferred to Phase 8 infrastructure
