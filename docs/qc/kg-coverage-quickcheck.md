# KG Coverage Quickcheck — qc-free-context-hub

This file captures a minimal, repeatable KG sanity pass for the QC run.

## Evidence (MCP calls)

- `search_symbols(query="indexProject")` returned:
  - `indexProject` (function) in `src/services/indexer.ts`
  - `IndexProjectResult` / `IndexProjectParams` (types) in `src/services/indexer.ts`

- `get_symbol_neighbors(symbol_id=<indexProject>, depth=1)` returned:
  - Neighbor symbols: `isProbablyBinary`, `vectorLiteral`
  - Edges:
    - `File DECLARES indexProject`
    - `indexProject CALLS vectorLiteral`
    - `indexProject CALLS isProbablyBinary`

- `trace_dependency_path(indexProject -> vectorLiteral)`:
  - `found=true`, `hops=1`, edge `CALLS`

## Notes
- This confirms KG ingest and basic CALLS/DECLARES edges are present for at least one core symbol path.\n
