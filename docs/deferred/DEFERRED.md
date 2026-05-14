# Deferred Items

<!-- Managed by Scribe. Do not edit manually. -->
<!-- Next ID: 003 -->

## DEFERRED-001

- **What:** Phase 14 — Per-project embedding/distillation model routing. Add `embedding_model` and `distillation_model` columns to `project_sources` (or new `project_model_config` table). Modify `src/services/embeddings.ts` and chat-model callers to select model from project config.
- **Why deferred:** ~~Out of Phase 13 scope; user chose option C (Phase 14 defer).~~
- **Trigger condition:** N/A
- **Estimated size:** L
- **Priority:** N/A
- **Session deferred:** 2026-05-14
- **Sessions open:** 1
- **Status:** ABANDONED
- **Abandon reason:** Session 2026-05-14 (same day) — user reconsidered and chose **global swap pattern** instead of per-project routing. Quote: "tôi đề nghĩ chúng ta nên làm phase 14 trước luôn vì nó không tốn nhiều time ... chúng ta sẽ chuyển hoàn toàn qua nvidia/nemotron-3-nano, text-embedding-bge-m3". Per-project routing complexity not needed; both projects move together to the new model stack. The new Phase 14 scope is documented as an active spec (see `docs/specs/2026-05-14-phase-14-model-swap-spec.md`), not a deferred item.
- **Source:** Session 2026-05-14 — initial decision then reversed within same session.

---

## DEFERRED-002

- **What:** `mxbai-embed-large-v1` has 512-token context window. With `CHUNK_LINES=120` (~600-1000 tokens/chunk), code chunks routinely get truncated. LM Studio logs confirm: "Number of tokens in input string (634) exceeds model context length (512). Truncating to 512 tokens." Also: "tokenizer.ggml.add_eos_token should be set to 'true' in the GGUF header." This means Phase 12 measurement work (sprints 12.1c through 12.1h) was conducted on systematically truncated embeddings. Baselines in `docs/qc/baselines/*` reflect degraded vectors, not the embedding model's full capability.
- **Why deferred:** Resolution requires model swap to `bge-m3` (8192 ctx, same 1024-dim). Resolution path now active via Phase 14 (global swap pattern). Item kept OPEN until Phase 14 actually ships and bge-m3 is in production for both `free-context-hub` and `phase-13-coordination` projects.
- **Trigger condition:** Phase 14 ships (`.env` updated to `EMBEDDINGS_MODEL=text-embedding-bge-m3`, `reembedAll` script run against both projects, smoke test confirms search quality is intact). At that point Scribe sets Status to RESOLVED with sprint reference.
- **Estimated size:** M (re-embed in place; preserves all data)
- **Priority:** MED
- **Session deferred:** 2026-05-14
- **Sessions open:** 1
- **Status:** RESOLVED
- **Resolved at:** 2026-05-15
- **Resolved by:** Phase 14 model swap (commits TBD — pending session close). `.env` switched to `EMBEDDINGS_MODEL=text-embedding-bge-m3` (8192 ctx, same 1024 dim). `src/scripts/reembedAll.ts` ran against both projects: free-context-hub (2069 chunks + 638 lessons + 11 document_chunks all OK) and phase-13-coordination (3334 chunks + 2 lessons + 0 document_chunks all OK). Smoke tests pass for search_lessons / search_code_tiered / reflect / add_lesson distillation. The 512-token truncation that systematically degraded Phase 12 measurement work is now eliminated — bge-m3's 8192-token context window covers our 120-line chunks (~600-1000 tokens) with margin.
- **Source:** Session 2026-05-14 — user message with LM Studio log + mxbai-embed-large-v1 model name. Resolution active via Phase 14.

---
