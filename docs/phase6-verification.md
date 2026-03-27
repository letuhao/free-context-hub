# Phase 6 — QC verification (chi tiết)

Tài liệu này bổ sung [QUICKSTART.md](QUICKSTART.md) cho luồng kiểm chứng **học nông → học sâu → đo** với `project_id` riêng và **một `correlation_id`** để audit.

## Hai thước đo (đừng lẫn)

| Thước | Cách chạy | Ý nghĩa |
| --- | --- | --- |
| **production eval** | Worker job `quality.eval` | Gọi `searchCode` trực tiếp trong process, metrics trong `benchmark_artifact` (`quality_eval/*`) |
| **QC harness** | `npm run qc:rag` / `npm run qc:rag:phase6` | Gọi MCP `search_code` qua HTTP, nhiều pass + heuristic QC; ghi `qc_artifact` / `qc_report` |

## Chuẩn bị

- Docker: `mcp` + `worker` + `db`, repo mount `/workspace`.
- `.env`: `PHASE6_KNOWLEDGE_LOOP_ENABLED=true`, `QUEUE_ENABLED=true`, embeddings reachable từ container (`host.docker.internal`…).
- Nếu **enqueue từ máy host** (script verify) dùng RabbitMQ: đặt `RABBITMQ_URL=amqp://guest:guest@127.0.0.1:5672` (host không resolve `host.docker.internal` cho Rabbit).

## Bước 1 — Full verify (index → shallow → deep → baseline)

```bash
# Trong container MCP (khuyến nghị) hoặc host với DATABASE_URL + RABBITMQ đúng
VERIFY_PHASE6_ROOT=/workspace npm run verify:phase6:qc
```

Biến tùy chọn:

- `VERIFY_PHASE6_QC_PROJECT_ID` — mặc định `phase6-qc-free-context-hub`
- `VERIFY_PHASE6_CORRELATION_ID` — mặc định sinh theo thời gian
- `VERIFY_PHASE6_DEEP_MAX_ROUNDS` — mặc định `3`
- `VERIFY_PHASE6_SKIP_BUILDER_MEMORY=true` — bỏ bước LLM builder memory trong deep (nhanh hơn)

Script sẽ:

1. `index.run`
2. `knowledge.loop.shallow` (FAQ + RAPTOR)
3. `knowledge.loop.deep` (vòng 1 có thể ghi **builder memory** nếu `PHASE6_BUILDER_MEMORY_ENABLED=true` và có model; xem mục *Large-repo memory* bên dưới)
4. `quality.eval` với `set_baseline: true`

Sau đó **assert** không có job `failed`/`dead_letter` cho `correlation_id`, và có artifact shallow/deep/quality_eval.

## Bước 2 — RAG QC harness (sau khi MCP chạy)

Mặc định project QC trùng verify:

```bash
npm run qc:rag:phase6
```

Yêu cầu: `MCP_SERVER_URL` (mặc định harness dùng `http://localhost:3000/mcp`), `QC_QUERIES_PATH` nếu cần.

## Bước 3 — “Coder agent” (định tính)

Chi tiết: [phase6-coder-agent-checklist.md](phase6-coder-agent-checklist.md).

## Log — đảm bảo flow đã chạy

Trong log worker / MCP, tìm:

- `event: job_execute_begin`, `phase6: true` cho job phase 6
- `phase6_boundary` / `phase6 quality.eval start` / `phase6 shallow start` / `phase6 deep start`
- `phase6 builder_memory` (khi bật builder memory)
- `rabbitmq_job_delivery` + `worker_invoke_runJobById` (nếu dùng RabbitMQ)

Nếu không thấy các dòng trên, kết quả đo RAG có thể không gắn với Phase 6.

## Large-repo memory (3M+ LOC)

Repo lớn không thể gom vào một prompt: hệ thống dùng **map-reduce** (manifest → leaf theo shard → merge theo module → global), mỗi bước là `benchmark_artifact` trong DB rồi được chunk/embed khi `index.run`.

### Khi nào dùng pipeline lớn

- **`knowledge.loop.deep`**: tự chọn pipeline lớn nếu `payload.large_repo === true`, hoặc nếu ước lượng LOC (heuristic từ kích thước file) ≥ `PHASE6_LARGE_REPO_LOC_THRESHOLD` (mặc định `500000`). Đặt threshold `0` để chỉ bật bằng flag `large_repo`.
- **Job riêng**: `enqueue_job` với `job_type: knowledge.memory.build` và `payload.root` (và `project_id`). Sau khi xong, worker enqueue `index.run` để embed.

### Payload (deep loop)

| Field | Ý nghĩa |
| --- | --- |
| `large_repo` | `true` — luôn dùng hierarchical memory |
| `memory_strategy` | `directory` (mặc định) hoặc `language` |
| `memory_max_shards` | Giới hạn shard (override `MEMORY_BUILD_MAX_SHARDS`) |
| `memory_run_id` | Id cố định cho một lần chạy (doc_key prefix); mặc định timestamp |
| `memory_resume_from_shard_index` | Resume leaf: shard index bắt đầu ghi lại; leaf cũ đọc từ DB theo cùng `memory_run_id` |

### Biến môi trường (chi phí / ngân sách)

- `MEMORY_BUILD_MAX_SHARDS` (mặc định `50`), `MEMORY_BUILD_SHARD_MAX_FILES`, `MEMORY_BUILD_SHARD_MAX_CHARS`, `MEMORY_BUILD_SHARD_MAX_FILE_CHARS`
- `MEMORY_BUILD_MODULE_MAX_INPUT_CHARS`, `MEMORY_BUILD_GLOBAL_MAX_INPUT_CHARS`
- `MEMORY_BUILD_LEAF_MAX_TOKENS`, `MEMORY_BUILD_MODULE_MAX_TOKENS`, `MEMORY_BUILD_GLOBAL_MAX_TOKENS`

Metadata artifact: `metadata.tier` ∈ `manifest | leaf | module | global`, `metadata.kind` ∈ `builder_memory_*`. Doc keys dạng `phase6/builder_memory/{manifest|leaf|module|global}/<run_id>/…`.

### Verify nhanh (ít shard)

Dry-run chi phí: đặt `memory_max_shards: 5` (deep) hoặc `payload.max_shards: 5` (`knowledge.memory.build`), chạy trên repo thật và kiểm tra `generated_documents` + log `builder_memory_large`.
