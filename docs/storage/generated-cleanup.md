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

## Suggested git hygiene

- Keep only latest representative artifacts in git.
- Remove stale timestamped QC artifacts after key reports are summarized.
- Prefer linking report summaries in docs over committing all generated files.

