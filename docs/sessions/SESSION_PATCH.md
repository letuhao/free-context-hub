---
id: CH-T5
date: 2026-03-27
module: Phase5-Git-Intelligence
phase: Phase 5
---

# Session Patch — 2026-03-27

## Where We Are
Phase: **Phase 5 (Automation & Git Intelligence) implemented** — git ingest storage + MCP tools + draft lesson proposals + graph-assisted commit impact.

## Completed This Session
- Migration `0005_git_intelligence.sql`: `git_commits`, `git_commit_files`, `git_ingest_runs`, `git_lesson_proposals`
- Env + runtime: `GIT_INGEST_ENABLED`, `GIT_MAX_COMMITS_PER_RUN` in `src/env.ts` and `.env.example`
- Git intelligence service: ingest idempotent commit/file metadata from git + proposal/link/impact flows
- MCP tools added:
  - `ingest_git_history`, `list_commits`, `get_commit`
  - `suggest_lessons_from_commits`, `link_commit_to_lesson`, `analyze_commit_impact`
- Distillation extension: commit→lesson suggestion helper in `src/services/distiller.ts`
- Workspace cleanup extended: `delete_workspace` now deletes Phase 5 git tables
- Docker dependency: added `git` package to image and workspace read-only mount (`/workspace`) for containerized git ingestion
- Smoke test extended with Phase 5 assertions (`SMOKE_GIT_ROOT`) and verified pass
- Docs updated: `README.md`, `docs/QUICKSTART.md`, `AGENT_PROTOCOL.md`, `WHITEPAPER.md`
- Production hardening:
  - `list_jobs` supports filtering by `correlation_id` for per-run reporting.
  - Worker chain propagation keeps correlation across child jobs (`repo.sync`/`workspace.scan` fan-out).
  - `smokeTest` now has dedicated optional block for `prepare_repo`, `enqueue_job`, `run_next_job`, `scan_workspace`.
  - `validate:phase5-worker` deep checks now include clone evidence, DB index/git counts, and correlation-scoped queue gates.
  - Added scheduled CI workflow `.github/workflows/phase5-worker-validation.yml` + mock embeddings server script.

## Next
- Harden commit diff parsing for rename/copy edge cases (large repos, binary-only commits)
- Add pagination cursor for `list_commits` and server-side filters (author/date/range)
- Add approval workflow endpoint to promote `git_lesson_proposals` into `lessons`

## Open Blockers / Risks
- Git ingestion in Docker requires repo visibility inside container (current approach: `/:/workspace:ro` mount)
- Commit ingestion is metadata-focused; full patch semantic classification is still best-effort
