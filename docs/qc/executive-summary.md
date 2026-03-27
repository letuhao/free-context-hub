# RAG QC Executive Summary (1-page)

Date: 2026-03-27  
Project: `phase6-qc-free-context-hub`  
Audience: Engineering / Product / Infra

## TL;DR

- RAG quality has improved materially from the earlier baseline.
- Latest best measured run:
  - `recall@3 = 0.776`
  - `MRR = 0.716`
  - report: `docs/qc/2026-03-27T22-17-56-882Z-qc-report.md`
- We are now in an optimization phase for the remaining hard query clusters (not a “missing facts only” phase).

## What improved

- Major gains on core groups:
  - `mcp-auth`, `indexing`, `embeddings`, `guardrails`, `sources`, `db`, `snapshots`, `smoke`, `ci`, `retrieval` reached strong/complete top-3 recall in latest run.
- Overall ranking quality improved versus earlier runs (~0.50 recall@3 range).

## What is still weak

- Remaining hard clusters are concentrated in:
  - `kg`
  - `git`
  - `mcp-server` defaults/health
  - `workspace` delta/index routing
  - `lessons` internals
- Typical failure mode:
  - retrieval still returns semantically broad “hub” files before the exact target implementation file.

## What we tried (and kept)

- Two-pass retrieval evaluation in QC runner (semantic + focused pass).
- Lesson-to-code expansion:
  - map query -> semantically similar lessons -> `source_refs` -> code candidate priors/expansion.
- General retrieval improvements (workspace-agnostic):
  - dynamic candidate pool sizing,
  - hub-file dominance penalty,
  - MMR diversification,
  - lesson prior similarity threshold.
- Evaluation hygiene:
  - consistent pass settings,
  - path-scope handling,
  - file-level dedupe for fair scoring.

## What we learned

- Adding more facts alone is not enough now.
- Biggest wins come from retrieval/ranking mechanics (candidate selection + diversification), not from prompt tweaks.
- Quality is better but still sensitive on specialized verticals (KG/Git/MCP-server internals).

## Recommended next actions (priority order)

1. Add intent-aware routing for difficult verticals (`kg`, `git`, `mcp-server`, `workspace`) before ranking.
2. Improve candidate generation for implementation files (not only hub/config files).
3. Keep A/B tracking by run artifact and monitor both:
   - quality (`recall@3`, `MRR`)
   - stability/latency (`p95_ms`)
4. Continue with strict “general logic” policy:
   - no workspace-specific hardcoding to inflate QC.

## Source of truth

- Technical deep-dive and timeline:
  - `docs/qc/qc-report.md`
- Latest automated report:
  - `docs/qc/2026-03-27T22-17-56-882Z-qc-report.md`
