# Git Intelligence Eval — qc-free-context-hub

This eval checks Phase 5 git intelligence as **RAG input** (quality + grounding), not just ingestion success.

## Steps executed (MCP)

1. `ingest_git_history(root=/data/repos/qc-free-context-hub, max_commits=50)`
   - result: commits_seen=24, commits_upserted=24, files_upserted=207

2. `list_commits(limit=5)`
   - returns latest commits with `project_id`, `sha`, `message`, `committed_at`

3. `get_commit(sha=<latest>)`
   - returns `commit` + `files[]` with change kinds and stats

4. `suggest_lessons_from_commits(limit=2)`
   - returns `draft` proposals with **string-only** `source_refs` (sanitized)

5. `analyze_commit_impact(commit_sha=<latest>)`
   - returns `affected_files[]` and (when KG enabled) `affected_symbols[]` and `related_lessons[]`

## Evidence snapshot

- Latest commit sampled: `19f742fc96e906ee7a5fde00dc446ccdf2137f6c`
- `get_commit.files` contained 6 file changes, including:
  - `src/services/distiller.ts` (M)
  - `src/services/jobQueue.ts` (M)
  - `src/worker.ts` (M)
- `suggest_lessons_from_commits` produced a draft workaround proposal grounded in schema hardening changes.
- `analyze_commit_impact` returned:
  - `affected_files` matching `get_commit.files`
  - non-empty `affected_symbols` (KG enabled)
  - `related_lessons` includes the seeded QC lessons that mention the impacted code

## Findings / quality notes

- **Grounding improved**: proposals include `git:<sha>` plus file paths; `source_refs` does not contain `\"[object Object]\"`.
- **Impact analysis**: when KG enabled, impacted symbols are reasonable and provide a “drill-down” surface for debugging/QA.

