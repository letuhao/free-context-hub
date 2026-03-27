# Phase 5 Worker Validation — 2026-03-27

## Target

- `project_id`: `bench-free-context-hub`
- `git_url`: `https://github.com/letuhao/free-context-hub`
- `ref`: `main`
- `source_storage_mode`: `hybrid` (S3 + local materialization)

## Environment

- Queue backend: RabbitMQ (`QUEUE_ENABLED=true`, `QUEUE_BACKEND=rabbitmq`)
- Worker: enabled (`worker` service running)
- Source cache root: `/data/repos`
- S3 endpoint/bucket: configured (MinIO via docker compose)

## Validation Artifacts

- JSON report (final run, includes workspace mode): `docs/benchmarks/artifacts/2026-03-27T12-34-28-572Z-phase5-worker-validation.json`
- JSON report (initial run without workspace root): `docs/benchmarks/artifacts/2026-03-27T12-32-49-713Z-phase5-worker-validation.json`

## Gate Results

- `prepare_repo_ok`: pass
- `s3_sync_ok`: pass
- `queue_chain_ok`: pass
- `commits_available`: pass
- `search_has_hits`: pass

Overall verdict: **PASS**

## Key Evidence

- `prepare_repo` returned:
  - `repo_root=/data/repos/bench-free-context-hub`
  - `last_sync_commit=752562a83ca49067a191ca699608d7d69064a2da`
  - `s3_sync.uploaded=true`
  - `artifact_key=source-artifacts/bench-free-context-hub/main/repo.bundle`
  - `metadata_key=source-artifacts/bench-free-context-hub/main/latest.json`
- Queue orchestration observed successful chain jobs:
  - `repo.sync` -> `git.ingest` -> `index.run`
- Git data quality:
  - `list_commits` returned 5 rows
  - `get_commit` (latest) returned 12 changed files
- Search quality sample:
  - 5/5 query probes returned hits, each with 5 matches
  - query latency sample range: 38–45 ms
- Lesson/impact path:
  - `suggest_lessons_from_commits`: proposals=1
  - `link_commit_to_lesson`: linked_refs=13
  - `analyze_commit_impact`: files=12, symbols=50, lessons>=1
- Local workspace mode:
  - `register_workspace_root` + `scan_workspace(run_delta_index=true)` succeeded on `/workspace`
  - delta indexed files: 121

## Notes

- During implementation, migration drift was detected for draft proposal idempotency index; fixed with:
  - `migrations/0007_git_lesson_proposals_draft_unique.sql`
- Smoke regression suite passed after changes (`npm run smoke-test`).

## Next Actions

- Optional: add a CI job to run `validate:phase5-worker` nightly and archive JSON artifacts.
- Optional: tune queue polling/report logic to evaluate only jobs created in current correlation window.

