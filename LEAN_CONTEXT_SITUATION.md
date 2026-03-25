# Lean Context Situation — free-context-hub (MVP-first)

## TIER 0 — Project Invariants (baseline)
- `MCP tools` trả dữ liệu dạng cấu trúc JSON (không dùng freeform prose) theo bề mặt tool surface trong `src/index.ts`.
- `Retrieved/indexed text` được coi là untrusted (prompt-injection defense) theo tinh thần ở `docs/context/PROJECT_INVARIANTS.md` (hiện MVP tập trung vào “guardrails always auditable / never silent”).
- Indexing là `vector-first` (embedding) + ignore/secret exclusion khi ingest.
- Guardrails engine:
  - Luôn audit-log
  - Không “silently allow” khi có match trigger: trả `pass=false` + `needs_confirmation=true` khi rule được match.

## TIER 1 — Phase Context (current MVP execution status)
- MVP scope & module brief hiện đã được implement end-to-end bằng code:
  - M04 (Lessons/Preferences) có CRUD tối thiểu + `get_preferences` lọc `preference-*`.
  - M02 (Ingestion/Indexing) có discovery + ignore/secret-aware + chunk theo dòng + embedding + ghi `chunks`/`files`.
  - M03 (Retrieval) có semantic search (pgvector cosine via `<=>`) + filter `path_glob`.
  - M05 (Guardrails) có trigger match (exact + regex dạng `/.../`) + audit log.
  - M01 (MCP Interface) có 6 tools và auth theo `workspace_token`:
    `index_project`, `search_code`, `get_preferences`, `add_lesson`, `check_guardrails`, `delete_workspace`.
- `docker-compose.yml` + migration `migrations/0001_init.sql` đã được thêm và chạy được.
- Tool response format đã được mở rộng theo parameter `output_format` trong `[src/index.ts](src/index.ts)` để hỗ trợ nhiều model/client:
  `auto_both` (default), `json_only`, `json_pretty`, `summary_only`.

## TIER 2 — Module Brief status (what’s blocked)
1. Retrieval DoD (AT-M03-01) hiện đã **đạt trong các lần smoke test trước đó**
   - Sau khi sửa M02 indexer (reorder embed first + incremental guard), `search_code` trả về `matches > 0`.
2. Project reset/isolation (M04 + delete_workspace tool) hiện đã **đạt trong các lần smoke test trước đó**
   - Sau `delete_workspace(project_id)`: `get_preferences` và `search_code` theo đúng `project_id` về rỗng/0, project khác vẫn giữ dữ liệu.
3. Blocker hiện tại (environment wiring)
   - `npm run smoke-test` đôi lúc fail với:
     `MCP error -32602: Unauthorized: invalid workspace_token`
   - Nguyên nhân hiện tại: MCP server đang chạy nền có thể đang dùng `CONTEXT_HUB_WORKSPACE_TOKEN` khác với token trong `.env` (smoke-test luôn đọc token từ `.env`).

4. Backlog V1 (non-blocking): debug field misleading
   - `src/services/guardrails.ts` trả `rules_checked: 0` trong nhánh “có rules nhưng không match trigger”.
   - Không ảnh hưởng pass/fail MVP, nhưng gây nhầm khi debug ý nghĩa của `rules_checked`.

## TIER 3 — Session Patch / Immediate Next Fix
- Các fixes MVP cho indexing đã được áp dụng:
  - M02 reorder: embed/chunks trước, chỉ update `files` + delete/insert chunks khi embedding thành công.
  - Incremental guard: nếu `files.content_hash` không đổi thì chỉ skip khi `chunks` đã tồn tại.
- Fix immediate cho blocker hiện tại (token mismatch):
  - Restart MCP server đang chạy nền để nó đọc đúng `CONTEXT_HUB_WORKSPACE_TOKEN` từ `.env`.
  - Sau restart, chạy lại `npm run smoke-test` để xác nhận auth/integration ổn định.

## Notes
- Docs embedding model đã được đồng bộ với code/schema đang dùng: `mixedbread-ai/text-embedding-mxbai-embed-large-v1` (1024 dims).
- DEC-003 (chunking line-based) và DEC-004 (bearer token auth) hiện đã được ghi “resolved” nhất quán giữa `SESSION_PATCH.md` và các docs context.

## Success Criteria (DoD retrieval verification)
- Chạy lại `npm run smoke-test` và kỳ vọng:
  - `index_project` status `ok`
  - `search_code` có `matches.length > 0`

