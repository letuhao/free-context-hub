---
id: CH-T4  date: 2026-03-27  module: Phase4-KG  phase: Phase 4
---

# Session Patch — 2026-03-27

## Where We Are
Phase: **Phase 4 (Knowledge Graph) Wave A+B implemented** — Neo4j + ts-morph ingest, lesson↔symbol linking, MCP graph tools, docs.

## Completed This Session
- Docker Compose: `neo4j` service; `.env.example` + `src/env.ts`: `KG_ENABLED`, `NEO4J_*`
- `src/kg/*`: client, schema bootstrap, ts-morph extractor, idempotent upsert, queries, lesson linker, project graph delete
- `index_project` → graph upsert for TS/JS files (non-fatal on failure)
- MCP tools: `search_symbols`, `get_symbol_neighbors`, `trace_dependency_path`, `get_lesson_impact`
- `add_lesson` → Neo4j Lesson node + edges from `source_refs`; `delete_workspace` clears graph data after PG commit
- Smoke test: optional KG block when `KG_ENABLED=true`
- Docs: `docs/QUICKSTART.md`, `WHITEPAPER.md`, `AGENT_PROTOCOL.md`, `CLAUDE.md`

## Next
- Run `docker compose up -d` with Neo4j healthy; set `KG_ENABLED=true` and verify Bolt from host vs container (`bolt://127.0.0.1:7687` vs `bolt://neo4j:7687`)
- Re-`index_project` with KG on to populate symbols; tune extractor (cross-file resolution, call graph) as needed

## Open Blockers / Risks
- Graph extraction is best-effort for TS/JS; path aliases (`@/`) are not resolved
- `get_lesson_impact` reads Lesson from Neo4j only (lessons created while `KG_ENABLED=false` may show empty until re-added or linked)
