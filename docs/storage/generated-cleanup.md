# Generated Export Cleanup

Use this guide to avoid repository bloat while keeping DB-first artifacts intact.

## Principles

- Canonical generated content is in Postgres (`generated_documents`).
- `docs/faq/*`, `docs/.raptor/*`, and `docs/qc/artifacts/*` are derived exports.
- You can safely remove derived exports and regenerate via worker jobs.

## Backfill old exports to DB

```bash
npm run backfill:generated-docs
```

Optional environment variables:

- `BACKFILL_PROJECT_ID` (default: `DEFAULT_PROJECT_ID` or `free-context-hub`)
- `BACKFILL_ROOT` (default: current repo root)

## Regenerate exports

- Run `faq.build` worker job to regenerate `docs/faq/*`.
- Run `raptor.build` worker job to regenerate `docs/.raptor/*`.
- Run `qc:rag` to regenerate QC artifacts/reports.
- Run worker job `quality.eval` (or `npm run qc:rag` for the harness) to refresh production retrieval metrics stored as `benchmark_artifact` rows.

## Phase 6 rollback / baseline

- **Baseline row:** `quality.eval` with `set_baseline: true` overwrites the `benchmark_artifact` at `doc_key` `quality_eval/baseline` (configurable via `PHASE6_BASELINE_DOC_KEY`). To “rollback” a baseline, upsert that row from a previous JSON snapshot (copy `content` from an older `quality_eval/<timestamp>` row) or delete the row and re-run.
- **Shallow/deep artifacts:** `phase6/shallow/*` and `phase6/deep/summary/*` are audit rows; safe to delete from `generated_documents` if you no longer need them (canonical FAQ/RAPTOR content remains in other `doc_type` rows or filesystem exports).
- **Draft promotion:** Phase 6 loop artifacts may carry `metadata.status: draft`; `promote_generated_document` sets `active` without deleting history.

## Suggested git hygiene

- Keep only latest representative artifacts in git.
- Remove stale timestamped QC artifacts after key reports are summarized.
- Prefer linking report summaries in docs over committing all generated files.

