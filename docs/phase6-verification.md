# Phase 6 — QC verification (chi tiết)

Tài liệu này bổ sung [QUICKSTART.md](QUICKSTART.md) cho luồng kiểm chứng **học nông → học sâu → đo** với `project_id` riêng và **một `correlation_id`** để audit.

## Hai thước đo (đừng lẫn)

| Thước | Cách chạy | Ý nghĩa |
| --- | --- | --- |
| **production eval** | Worker job `quality.eval` | Gọi `searchCode` trực tiếp trong process, metrics trong `benchmark_artifact` (`quality_eval/*`) |
| **QC harness** | `npm run qc:rag` / `npm run qc:rag:phase6` | Gọi MCP `search_code` qua HTTP, nhiều pass + heuristic QC; ghi `qc_artifact` / `qc_report` |

## Chuẩn bị

- Docker: `mcp` + `worker` + `db`, repo mount `/workspace`.
- `.env`: `KNOWLEDGE_LOOP_ENABLED=true`, `QUEUE_ENABLED=true`, embeddings reachable từ container (`host.docker.internal`…). (Tên cũ `PHASE6_*` vẫn được đọc nếu bạn chưa đổi file.)
- Nếu **enqueue từ máy host** (script verify) dùng RabbitMQ: đặt `RABBITMQ_URL=amqp://guest:guest@127.0.0.1:5672` (host không resolve `host.docker.internal` cho Rabbit).

### Docker Compose (khuyến nghị)

1. Từ thư mục repo (có `docker-compose.yml`):

   ```bash
   docker compose up -d db rabbitmq redis mcp worker
   ```

2. `.env` dùng chung cho `mcp` / `worker` (`env_file`): `DATABASE_URL` trong compose được ghi đè bằng URL nội bộ tới `db`; **giữ** `KNOWLEDGE_LOOP_ENABLED=true`, `QUEUE_ENABLED=true`, model chat nếu cần builder memory. `QUEUE_BACKEND` mặc định trong compose là `postgres` (worker poll `async_jobs` — không cần enqueue qua Rabbit từ host).

3. Chạy script verify **trong container `mcp`** với `WORKDIR=/app` (có `node_modules` từ image), còn chỉ mục index là mount `/workspace`:

   ```bash
   npm run verify:phase6:prereq:compose
   # (tuỳ chọn, ~vài phút) chỉ thử bước builder memory LLM trước khi chạy full QC ~1h
   npm run verify:phase6:qc:builder-memory:compose
   npm run verify:phase6:qc:compose
   ```

   Tương đương thủ công:

   ```bash
   docker compose exec -T -w /app mcp env QC_VERIFY_REPO_ROOT=/workspace npm run verify:phase6:qc
   ```

4. **Worker** phải chạy (`worker` service) để job `queued` được xử lý.

5. **RAG QC harness** chạy trên **máy host** (hoặc bất kỳ chỗ nào có Node), trỏ MCP đã publish cổng:

   ```bash
   QC_PROJECT_ID=phase6-qc-free-context-hub MCP_SERVER_URL=http://localhost:3000/mcp npm run qc:rag:phase6
   ```

6. `verify:phase6:lesson-probe` / `verify:phase6:audit`: có thể chạy trên host nếu `DATABASE_URL` trỏ `localhost:5432` và cùng DB với compose; hoặc `docker compose exec -w /app mcp npm run verify:phase6:audit -- <correlation_id>`.

### Probe builder memory (một bước, không FAQ/RAPTOR/index)

Dùng khi full `verify:phase6:qc` hay timeout ở bước `phase6 builder_memory` (thường do `BUILDER_AGENT_TIMEOUT_MS` quá thấp so với prompt lớn + model chậm). Script gọi đúng `buildProjectMemoryArtifact` như worker:

```bash
QC_VERIFY_REPO_ROOT=/workspace npm run verify:phase6:qc:builder-memory
# hoặc trong compose:
npm run verify:phase6:qc:builder-memory:compose
```

Mặc định `BUILDER_AGENT_TIMEOUT_MS=120000` (2 phút). Nếu vẫn abort: tăng thêm hoặc giảm `BUILDER_MEMORY_SAMPLE_MAX_TOTAL_CHARS` / các `BUILDER_MEMORY_SAMPLE_*` trong `.env`.

Single-pass builder memory (repo nhỏ / heuristic LOC thấp) dùng **map–reduce**: cắt mẫu repo theo `BUILDER_MEMORY_MAP_CHUNK_MAX_CHARS` (mặc định 28k), gọi LLM từng chunk rồi merge (và bước polish cuối). `BUILDER_MEMORY_MAP_CONCURRENCY` (mặc định 2) giảm wall-time map; tổng thời gian có thể tăng do nhiều round-trip. Đặt `BUILDER_MEMORY_MAP_CHUNK_MAX_CHARS` ≥ `BUILDER_MEMORY_SAMPLE_MAX_TOTAL_CHARS` nếu muốn một lần gọi LLM như trước (vẫn rủi ro vượt context / timeout).

### Hierarchical (“large-repo”) builder memory — không chạy full QC

Pipeline **manifest → leaf → module → global** (`buildLargeRepoProjectMemory`), job `knowledge.memory.build`. **Không** chạy FAQ/RAPTOR/`knowledge.loop.deep`. Cần **worker** đang poll queue. Khi job thành công, executor tự enqueue thêm **`index.run`** để embed artifact.

```bash
npm run enqueue:knowledge.memory.build:compose
# hoặc: QC_VERIFY_REPO_ROOT=/workspace npm run enqueue:knowledge.memory.build
```

Theo dõi job: `list_jobs` (MCP) hoặc `WAIT_FOR_JOB=1` cùng lệnh trên. Tuỳ chọn payload qua MCP `enqueue_job`: `strategy` (`directory`|`language`), `max_shards`, `run_id`, `resume_from_shard_index` (xem `jobExecutor` → `knowledge.memory.build`).

**Khi nào dùng:** repo rất lớn hoặc muốn artifact dạng shard/ global; với LOC heuristic dưới `BUILDER_MEMORY_LARGE_REPO_LOC_THRESHOLD`, deep loop mặc định vẫn chọn **single-pass** — probe ở trên đã đủ trừ khi bạn cần đúng pipeline hierarchical.

## Bước 1 — Full verify (index → deep → baseline)

```bash
# Trong container MCP (khuyến nghị) hoặc host với DATABASE_URL + queue đúng
QC_VERIFY_REPO_ROOT=/workspace npm run verify:phase6:qc
```

Biến tùy chọn:

- `QC_VERIFY_PROJECT_ID` — mặc định `phase6-qc-free-context-hub` (alias cũ: `VERIFY_PHASE6_QC_PROJECT_ID`)
- `QC_VERIFY_CORRELATION_ID` — mặc định sinh theo thời gian
- `QC_VERIFY_DEEP_MAX_ROUNDS` — mặc định `3`
- `QC_VERIFY_SKIP_BUILDER_MEMORY=true` — bỏ bước LLM builder memory trong deep (nhanh hơn)

Script sẽ:

1. `index.run`
2. **`knowledge.loop.deep` duy nhất** (không enqueue `knowledge.loop.shallow` riêng — tránh hai job LLM song song). Vòng 1 của deep chạy FAQ + RAPTOR + **builder memory** (nếu `BUILDER_MEMORY_ENABLED=true` và có model; xem *Large-repo memory*).
3. `quality.eval` với `set_baseline: true`

Sau đó **assert** không có job `failed`/`dead_letter` cho `correlation_id`, và có artifact deep summary + quality_eval (và builder memory nếu bật — xem script WARN nếu thiếu).

**Tiện ích (trong repo):**

- `npm run verify:phase6:prereq` — kiểm tra env Phase 6 + kết nối DB + đã chạy migrate.
- `npm run verify:phase6:audit` — in bảng `async_jobs` theo `QC_AUDIT_CORRELATION_ID` hoặc tham số CLI; thoát mã lỗi nếu có job `failed`/`dead_letter`.
- `npm run verify:phase6:lesson-probe` — (tuỳ chọn) `add_lesson` (`lesson_payload.project_id` bắt buộc nếu server không set `DEFAULT_PROJECT_ID`) + `search_lessons` + `search_code` qua MCP cho `QC_PROJECT_ID` (mặc định `phase6-qc-free-context-hub`). Fact trong lesson chủ yếu thấy qua `search_lessons`, không phải `search_code`.
- `npm run verify:phase6:qc:builder-memory` — chỉ single-pass builder memory (nhanh), trước khi chạy full verify.
- `npm run enqueue:knowledge.memory.build` — enqueue hierarchical builder memory (`knowledge.memory.build`); cần worker.

## Bước 2 — RAG QC harness (sau khi MCP chạy)

Mặc định project QC trùng verify:

```bash
npm run qc:rag:phase6
```

Yêu cầu: `MCP_SERVER_URL` (mặc định harness dùng `http://localhost:3000/mcp`), `QC_QUERIES_PATH` nếu cần.

## Bước 3 — “Coder agent” (định tính)

_(The separate coder-agent checklist was archived in Sprint 11.Z; Phase 6 is complete and the checklist's content lives in git history if needed.)_

## Log — đảm bảo flow đã chạy

Trong log worker / MCP, tìm:

- `event: job_execute_begin`, `phase6: true` cho job phase 6
- `phase6_boundary` / `phase6 quality.eval start` / `phase6 shallow start` / `phase6 deep start`
- `phase6 builder_memory` (khi bật builder memory)
- `rabbitmq_job_delivery` + `worker_invoke_runJobById` (nếu dùng RabbitMQ)

Nếu không thấy các dòng trên, kết quả đo RAG có thể không gắn với Phase 6.

## Builder memory: vì sao có WARN sau `verify:phase6:qc`?

Script kiểm tra có document `metadata.kind` = `builder_memory` (single-pass) hoặc `builder_memory_global` (large-repo). **Bước LLM chạy trong service `worker`**, không chạy trong container nơi bạn gõ lệnh verify (trừ khi worker và script cùng env).

**Nguyên nhân thường gặp**

1. **Không có model chat**: `BUILDER_AGENT_MODEL` và `DISTILLATION_MODEL` đều trống → mọi bước builder gọi `builderChatCompletion` trả rỗng → `reason: no_llm_output`, không ghi artifact `builder_memory`.
2. **Chỉ có embedding server**: URL trỏ LM Studio / API chỉ phục vụ `POST /v1/embeddings` mà không có `POST /v1/chat/completions` (hoặc chưa load model chat) → HTTP lỗi hoặc rỗng → cùng kết quả.
3. **Large-repo path** (`BUILDER_MEMORY_LARGE_REPO_LOC_THRESHOLD` hoặc `large_repo: true`): có thể chỉ thấy `builder_memory_manifest` / leaf trong DB mà không có `global` nếu merge LLM lỗi — script verify sẽ in bảng `phase6/builder_memory*` gần nhất khi WARN.

**Cách xử lý**

- Trong `.env` (Compose đọc qua `env_file` cho `worker`): đặt ví dụ `DISTILLATION_BASE_URL=http://host.docker.internal:1234` và `DISTILLATION_MODEL=<id model chat trong LM Studio>` (hoặc `BUILDER_AGENT_*` riêng).
- Xem log **worker**: `phase6 builder_memory skipped`, `builder memory chat failed`, `phase6_builder_memory` với `reason: no_llm_output`.
- Chạy `npm run verify:phase6:prereq` (hoặc `:compose`) — prereq báo lỗi nếu bật `BUILDER_MEMORY_ENABLED` mà thiếu model.

## Large-repo memory (3M+ LOC)

Repo lớn không thể gom vào một prompt: hệ thống dùng **map-reduce** (manifest → leaf theo shard → merge theo module → global), mỗi bước là `benchmark_artifact` trong DB rồi được chunk/embed khi `index.run`.

### Khi nào dùng pipeline lớn

- **`knowledge.loop.deep`**: tự chọn pipeline lớn nếu `payload.large_repo === true`, hoặc nếu ước lượng LOC (heuristic từ kích thước file) ≥ `BUILDER_MEMORY_LARGE_REPO_LOC_THRESHOLD` (mặc định `500000`). Đặt threshold `0` để chỉ bật bằng flag `large_repo`.
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
