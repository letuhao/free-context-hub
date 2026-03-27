# Phase 6 — Checklist “coder agent” (định tính)

Sau khi [phase6-verification.md](phase6-verification.md) (index + shallow + deep + baseline) và tùy chọn `qc:rag:phase6`, dùng MCP để mô phỏng agent lập trình dạy fact và thử truy vấn khó.

## 1. Ghi fact có provenance

Gọi `add_lesson` với:

- `lesson_type`: `decision` hoặc `general_note`
- `title`: ngắn, có thể nhận diện (ví dụ: “Phase6: baseline doc_key”).
- `content`: 2–4 câu, nhắc rõ hành vi hệ thống.
- `source_refs`: mảng đường dẫn file thật, ví dụ `src/services/jobExecutor.ts`, `docs/phase6-verification.md`.
- `project_id`: cùng project đang verify (ví dụ `phase6-qc-free-context-hub`).

Lặp lại 2–3 lesson với chủ đề khác (queue, QC, builder memory).

## 2. Truy vấn khó (`search_code`)

Dùng các câu gần golden set trong [qc/queries.json](../qc/queries.json), ví dụ:

- “Where is workspace_token validated for MCP tool calls?”
- “Where is the MCP HTTP endpoint implemented and what routes are exposed?”
- “How does index_project discover files, chunk them, embed, and write to Postgres?”

Biến thể: thêm ngữ cảnh (“after Phase 6 shallow…”) để xem retrieval có ổn định không.

**Ghi nhận:** top 3 `path`, có trùng `target_files` kỳ vọng không, snippet có chứa keyword quan trọng không.

## 3. (Tuỳ chọn) Human gate

- `list_generated_documents` với `doc_status: draft` — xem artifact Phase 6.
- `promote_generated_document` trên một draft không nhạy cảm để mô phỏng duyệt.

## 4. So sánh trước/sau lesson

- Chạy lại một `search_code` giống nhau trước và sau khi thêm lesson (đợi index lesson nếu pipeline có embed lesson).
- Ghi nhận cải thiện định tính (không bắt buộc metric).
