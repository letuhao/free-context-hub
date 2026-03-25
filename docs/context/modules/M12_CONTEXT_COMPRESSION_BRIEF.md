---
id: CH-M12
module: M12 Context Compression
status: done
updated: 2026-03-26
---

# M12 — Context Compression

## Purpose

Optional **LLM-assisted shrinking** of arbitrary text (not code chunks) when operators want to paste large notes or logs into memory workflows.

## Tool: `compress_context`

**Inputs:**

- `text` (required) — UTF-8 string to compress
- `max_output_chars` (optional) — soft cap for output length

**Outputs:**

- `compressed` — shorter text
- `warning` — present when timeout, truncation, or model unavailable

## Constraints

- Does **not** replace `search_code` or chunk storage.
- Uses the same OpenAI-compatible chat endpoint as distillation (`DISTILLATION_*` env).
- Respects `DISTILLATION_ENABLED=false` by returning a structured error or pass-through (implementation: skip LLM; return `warning` + original text truncated).

## Failure modes

| Symptom | Cause | Mitigation |
|---|---|---|
| No compression | `DISTILLATION_ENABLED=false` | Enable + configure chat model |
| Loses details | Aggressive prompt | Lower temperature; raise `max_output_chars` |
