# Baseline archive

Forensic-only baseline JSON / MD pairs. NOT in the standard reproducibility
chain. Anything in here exists to preserve evidence of a bug/failure mode
that the main artifacts on disk no longer demonstrate.

If you are looking for a baseline to compare against, use the files in
`docs/qc/baselines/` directly, NOT the archive.

## 2026-06-17-v11-broken-pre-reasoning-effort-patch

**First v11 hybrid Tradition B baseline attempt — corrupted by gemma-4
reasoning-by-default.**

- Tag: `2026-06-17-phase-17-v11-hybrid-tradition-b-defer-judge-full` (same
  tag as the clean run that ships under `docs/qc/baselines/`).
- Symptom: `faithfulness=null` on 147/152 rows. Judge calls 3–4× slower
  than expected (~50s vs ~14s). MOST other metrics computed correctly;
  faith failed because RAGAS's `_create_statements` uses instructor for
  structured JSON output, and gemma-4 in reasoning-by-default mode
  exhausts `max_tokens` on internal reasoning before any JSON is written.
- Root cause: between the v6 Tradition B baseline (completion 15:32)
  and this v11 attempt (start 17:18), LM Studio's gemma-4-26b-a4b loaded
  into a runtime state where `chat.completions.create` defaults to
  reasoning-on. The sidecar never set `reasoning_effort=none`.
- Fix: `services/ragas-judge/main.py:_build_openai_client` now wraps
  `client.chat.completions.create` to inject
  `extra_body={"reasoning_effort": "none"}` on every call. Shipped on
  commit `e97bbeb` (branch `v11-hybrid-templates`, PR #36).
- Re-run with the patched sidecar: faith ≈ 0.45–0.95 across surfaces,
  judge calls ~17s — see `2026-06-17-2026-06-17-phase-17-v11-hybrid-tradition-b-defer-judge-full.{json,md}`
  in the parent directory.

Keep this archive entry as the evidence-of-fix artifact. If the patch is
ever removed and faith scores start returning null again, this is the
shape of the bug to expect.
