---
id: CH-MULTI-REPO-STRATEGY
date: 2026-03-30
module: Multi-Repo-Strategy
phase: Planning
---

# Session Patch — 2026-03-30

## Where We Are
Phase: **Multi-repo strategy planning.** Confirmed free-context-hub already supports multi-project natively via `project_id` scoping. Chose **Option C (Hybrid multi-layer)** for the user's microservice + integration architecture.

## What Was Done This Session
- Explored existing multi-repo capabilities (project_id isolation, workspace roots, project_sources)
- Identified 3 options: per-repo projects, single shared project, hybrid multi-layer
- Chose Option C — hybrid with layered project_ids (global → system → integration → microservice)
- Documented full strategy in `docs/multi-repo-strategy.md`

## Key Decision
**Microservices ≠ Integrations.** Systems (Order, Payment) are separate bounded contexts. Microservices are internal to a system. Integration knowledge (API contracts, retry policies) lives in dedicated integration projects, not forced into either system.

## Next Steps (next session)
1. Define actual system names and project IDs for user's repos
2. Create reusable CLAUDE.md template with multi-layer `search_lessons`
3. Register workspace roots for each repo
4. Seed shared guardrails in `platform-shared` project
5. Seed integration contracts as lessons
6. Evaluate adding multi-project `search_lessons` query support (feature enhancement)

## Prior Session Context
- Phase 7 GUI: 14/14 pages complete
- Open: Model Providers backend, KG routes, integration testing
