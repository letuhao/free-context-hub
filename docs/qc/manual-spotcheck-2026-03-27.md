# Manual spot-check — 2026-03-27

Scope: 4 hardest end-to-end tasks from `docs/qc/e2e-tasks.md`, evaluated using retrieval evidence from the latest QC artifacts.

Run used:
- QC report: `docs/qc/2026-03-27T13-58-03-232Z-qc-report.md`
- Artifacts: `docs/qc/artifacts/2026-03-27T13-58-03-232Z-qc-artifacts.json`

Rubric keys (see `docs/qc/task-eval-kit.md`): Grounded / Correct / Complete / Low hallucination.

## Task 1 — Worker pipeline (repo.sync)
- Expected target files: `src/services/jobExecutor.ts`, `src/services/jobQueue.ts`, `src/worker.ts`
- Evidence (closest QC query): `job-queue-rabbitmq`, `worker-rabbitmq-consumer`, `repo-sync-fanout`
- Result: **Not consistently retrieved in top-3** (queue/worker cluster still in worst list).
- Rubric (current state):
  - Grounded: **low** (missing key entrypoints)
  - Correct: **low**
  - Complete: **low**
  - Low hallucination: **medium** (agent likely to answer with adjacent infra files, but incomplete)

## Task 2 — correlation_id debugging
- Expected target files: `src/index.ts`, `src/services/jobQueue.ts`, `src/services/jobExecutor.ts`
- Evidence (QC query): `job-correlation-filter`
- Result: **mixed**; `jobQueue.ts` and `jobExecutor.ts` appear in neighbors often, but `src/index.ts` is still a hard miss in entrypoint/auth clusters.
- Rubric (current state):
  - Grounded: **medium**
  - Correct: **medium**
  - Complete: **medium-low**
  - Low hallucination: **medium**

## Task 3 — Indexing pipeline
- Expected target files: `src/services/indexer.ts`, `src/services/embedder.ts`
- Evidence (QC query): `index-project-main-pipeline` (worst list)
- Result: **fail** (top paths dominated by DB/KG schema; targets not found in top-10).
- Rubric (current state):
  - Grounded: **low**
  - Correct: **low**
  - Complete: **low**
  - Low hallucination: **medium-low**

## Task 4 — Retrieval contract & output_format
- Expected target files: `src/index.ts`, `src/utils/outputFormat.ts`, `src/smoke/smokeTest.ts`
- Evidence (QC query): `tool-output-formatting`, `output-format-parser-smoke`
- Result: **fail** (targets not found in top-3; output formatting files not surfaced reliably).
- Rubric (current state):
  - Grounded: **low**
  - Correct: **low**
  - Complete: **low**
  - Low hallucination: **medium**

## Summary (actionable)
Primary blockers for “real-world usable” answers on hardest tasks:
- `src/index.ts` retrieval remains the #1 entrypoint failure cluster (auth/routes/tool registrations).
- Indexing pipeline entrypoints (`src/services/indexer.ts`, `src/services/embedder.ts`) are not reliably retrieved for “how it works” prompts.
- Output formatting contract (`src/utils/outputFormat.ts`) is not surfaced for client-behavior questions.

