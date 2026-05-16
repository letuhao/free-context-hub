# Distillation Model Benchmark — 2026-05-15

## Objective

Select the **distillation model** for free-context-hub — the OpenAI-compatible chat model
behind `DISTILLATION_MODEL`. It powers `add_lesson` summarization, `reflect`,
`compress_context`, `get_project_summary`, and (by fallback) rerank and the QA agent.

The previous default was `nvidia/nemotron-3-nano`, a **reasoning model**. On a
summarization task it spent ~2,500+ tokens per call on chain-of-thought before writing the
answer, pushing each `add_lesson` distillation to **~25-35 seconds**. Distillation is a
summarization / JSON-extraction task — it does not need deep reasoning. Goal: find a
**non-reasoning** instruct model that is fast, returns clean parseable JSON, and has enough
context window for ContextHub's inputs.

---

## Test Setup

- **Endpoint:** LM Studio (OpenAI-compatible `/v1/chat/completions`), local.
- **Two prompts:** (1) a generic "summarize into JSON `{summary, quick_action}`" probe, and
  (2) ContextHub's exact `distillLesson` system+user prompt (`src/services/distiller.ts`).
- **Metrics:** wall-clock time, `completion_tokens`, `completion_tokens_details.reasoning_tokens`,
  `finish_reason`, effective tok/s, and whether the output parses as JSON with non-empty
  `summary` + `quick_action` (the check `distillLesson` enforces).
- **Conditions:** measured with a clean VRAM state (only the model under test + the
  embedding model loaded) so contention does not skew tok/s. Warm runs; cold model-load
  time excluded. In-stack figures are `POST /api/lessons` end-to-end (HTTP + DB + embed +
  distillation).
- **Decisive axis:** *reasoning vs non-reasoning*. A reasoning model burns most of its
  output budget on chain-of-thought — wasted work for a summarization task.

---

## Results

| # | Model | Reasoning? | Speed (warm) | Context window | Verdict |
|---|-------|-----------|--------------|----------------|---------|
| 1 | `nvidia/nemotron-3-nano` | Yes | ~25-35s / distill call | — | ✗ Previous default — too slow |
| 2 | `qwen/qwen3.5-9b` | Yes — could not be disabled | ~101 tok/s raw, but ~2,500 CoT tok/call | — | ✗ Reasoning, no API off-switch |
| 3 | `microsoft/phi-4` | No — 0 reasoning tokens | ~66 tok/s · in-stack `add_lesson` ~3.7s | 16,384 | ◯ Viable; small context |
| 4 | `mistralai/mistral-nemo-instruct-2407` | No — 0 reasoning tokens | non-reasoning confirmed (not fully benchmarked) | ~128K | ◯ Viable alternative |
| 5 | `deepseek-r1-distill-qwen-32b` | Yes — disable-able via `<think></think>` prefill | ~5 tok/s (32B, VRAM-bound on this host) | 64K | ✗ Too slow even non-thinking |
| 6 | **`ibm/granite-4-h-tiny`** | **No — 0 reasoning tokens** | **~32-53 tok/s · in-stack `add_lesson` ~5.6s** | **~102K loaded (max 1,048,576)** | **✓ Winner** |

### Winner: IBM Granite-4-H-Tiny

- **Non-reasoning** — 0 reasoning tokens on both the generic probe and the real
  `distillLesson` prompt. No chain-of-thought waste.
- **Fast enough** — short-prompt 3-run benchmark: 0.76 / 0.77 / 0.78s (extremely
  consistent); the full `distillLesson` prompt completed in ~4.2s; in-stack `add_lesson`
  end-to-end ~5.6s. (Previous reasoning models: ~25-35s.)
- **Huge context window** — max 1,048,576 tokens; loaded here at ~102K. This eliminates
  ContextHub's context-window risk: `distillLesson` / `reflect` / `compress` /
  builder-memory / RAPTOR inputs cannot realistically overflow.
- **Clean JSON** — emits a raw JSON object with no markdown fences; passes the
  `distillLesson` validation (`summary` + `quick_action` both populated).

---

## Key Insights

1. **Reasoning vs non-reasoning is the only axis that matters for distillation.**
   Summarization + JSON extraction does not benefit from chain-of-thought. A reasoning
   model spends ~80-99% of its output budget "thinking", making each call 5-30× slower for
   no quality gain on this task.

2. **A reasoning model's thinking often cannot be turned off via the API.**
   `qwen/qwen3.5-9b` ignored all three standard switches through LM Studio — `/no_think`,
   `reasoning_effort: low`, and `chat_template_kwargs.enable_thinking=false` — emitting
   599/600 tokens as reasoning every call. Verify a candidate is *natively* non-reasoning;
   do not rely on a runtime toggle.

3. **R1-distilled models CAN be forced non-thinking — but stay slow.**
   `deepseek-r1-distill-qwen-32b` skips reasoning if the assistant turn is prefilled with a
   closed `<think></think>` block (0 reasoning tokens, clean JSON). But at 32B it runs
   ~5 tok/s on this host — a real distillation would still take ~25-30s. Model size, not
   just reasoning mode, dictates viability.

4. **Context window matters more than a small speed edge.**
   `microsoft/phi-4` is slightly faster than granite (~66 vs ~32-53 tok/s) but has only a
   16,384-token window — large lessons / `reflect` / `compress` inputs can overflow it,
   which would require adding model-context-aware input chunking to the LLM layer.
   Granite's ~100K-1M window removes that whole problem class. The ~2s/call difference is
   immaterial — agents do not need human-realtime distillation.

5. **Right-size output budgets for non-reasoning models.** `distillMaxTokens` in
   `src/services/distiller.ts` reserves up to 8,000 output tokens — bumped in Phase 14 for
   reasoning models that needed room for chain-of-thought. A non-reasoning model produces a
   ~150-word summary in ~600 tokens; the 8,000 cap and `DISTILLATION_TIMEOUT_MS=180000` are
   now oversized.

---

## Decision

`DISTILLATION_MODEL=ibm/granite-4-h-tiny` — set 2026-05-15. Supersedes the
`qwen2.5-coder-7b-instruct` recommendation in the [2026-03-28 benchmark](2026-03-28-embedding-model-benchmark.md)
and the `nvidia/nemotron-3-nano` Phase 14 default.

**Verified in-stack:** the stack was restarted on granite; `POST /api/lessons` returned
`distillation: {status: "ok"}` with a populated summary in ~5.6s end-to-end.

### Recommended follow-ups (non-blocking)

- Reduce `DISTILLATION_TIMEOUT_MS` (currently `180000`, a reasoning-era value) to ~`30000`.
- Reduce the `distillMaxTokens` floor/cap in `src/services/distiller.ts` (currently
  `2000`-`8000`) toward ~`512`-`1024` now that the model is non-reasoning — faster calls,
  more context headroom.
- The earlier "add model-context-window awareness + input chunking" audit (Scope A) is no
  longer urgent: granite's ~100K+ window covers ContextHub's inputs with large margin.
