---
id: CH-M03  status: not-started  phase: MVP  depends-on: M02  updated: 2026-03-25
---

# Module Brief: M03 — Retrieval Service

## Outcome
Executes semantic search over indexed chunks, returns ranked structured results.
MVP: vector similarity only. Post-MVP: lightweight lexical/symbol enrichment.

## Scope
IN: Vector similarity search, top-k ranking, structured output format,
    path/language filters, debug explanations (optional)
OUT: Graph traversal, cross-repo federation, ML-based reranking (post-MVP)

## Acceptance
- [ ] AT-M03-01: `search_code(query)` returns matches with `{path, start_line, end_line, snippet, score, match_type}`
- [ ] AT-M03-02: Top-k configurable via `limit` param (default: 10)
- [ ] AT-M03-03: Filter by file path glob pattern works correctly
- [ ] AT-M03-04: Empty corpus returns `{matches: [], explanations: []}` — not an error
- [ ] AT-M03-05: Search latency p50 < 500ms on local hardware (single node)

## API Surface
Internal service; exposed via M01 `search_code` tool.

Response schema:
```json
{
  "matches": [
    {
      "path": "src/auth/session.ts",
      "start_line": 42,
      "end_line": 58,
      "snippet": "...",
      "score": 0.87,
      "match_type": "semantic"
    }
  ],
  "explanations": []
}
```

## Sub-phases
| SP | Scope | Status |
|---|---|---|
| SP-1 | pgvector cosine similarity query | not-started |
| SP-2 | Top-k selection + score normalization | not-started |
| SP-3 | Path/language filter support | not-started |
| SP-4 | Debug mode (explanations field populated) | not-started |

## Risks (open)
- R-M03-01: Retrieval quality inherits embedding quality from M02 [high — shared with M02]

## Recent Decisions
- (none yet)
