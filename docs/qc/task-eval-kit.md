# RAG Task Eval Kit (Human Rubric)

Use this kit to evaluate **answer quality** for ContextHub RAG (indexing + retrieval + KG + lessons).
This is not a “function test”; it measures **grounding, correctness, and usefulness**.

## Scoring rubric (1–5)

Score each dimension 1–5 (1=poor, 5=excellent).

- **Grounded**
  - 5: cites exact file paths + line ranges or highly specific code excerpts; no unsupported claims.
  - 3: cites file paths but misses key lines/edges; some vague statements.
  - 1: mostly ungrounded / speculative.

- **Correct**
  - 5: matches code behavior and configuration semantics.
  - 3: mostly correct but with minor mistakes or missing edge cases.
  - 1: incorrect or contradicts code.

- **Complete**
  - 5: covers end-to-end flow + key dependencies + failure modes.
  - 3: covers main path but misses important steps or configuration.
  - 1: incomplete; only partial explanation.

- **Low hallucination**
  - 5: does not invent tools/APIs/files; admits uncertainty and verifies via MCP searches.
  - 3: minor invention but doesn’t change conclusion.
  - 1: invents APIs/files, leading to wrong action.

## Evaluation protocol

For each task:
1. Run **fixed tool sequence**:
   - `search_code(query, limit=5, filters.path_glob=...)`
   - (optional) `search_symbols` / `get_symbol_neighbors` for symbol-level follow-up
   - (optional) `search_lessons` when the task is policy/guardrail related
2. Produce final answer with citations (file paths + key code references).
3. Score rubric and record evidence.

## Task list (suggested 12)

1. Explain end-to-end worker pipeline for `repo.sync`.
2. Trace how `correlation_id` propagates and how to debug a single run.
3. Explain `index_project` pipeline and how chunking/embedding works.
4. Explain `search_code` retrieval contract and output format handling.
5. Explain how KG bootstrap + schema constraints work.
6. Explain how TS symbol extraction via ts-morph produces edges.
7. Explain git ingestion pipeline and how deleted files are handled.
8. Explain idempotent draft proposal upsert for commit lesson suggestions.
9. Explain S3 source artifact sync/materialize flow and keys written.
10. Explain local workspace scanning and delta indexing behavior.
11. Explain how lessons are linked to symbols and how `get_lesson_impact` is populated.
12. Explain guardrails rule matching and required confirmations.

## Output template (copy/paste)

```markdown
### Task: <name>
- **Prompt**: <task prompt>
- **Tools used**: <search_code / search_symbols / ...>
- **Answer summary**: <1–3 paragraphs>
- **Evidence**: <file paths + key lines>
- **Scores**:
  - Grounded: _
  - Correct: _
  - Complete: _
  - Low hallucination: _
- **Notes / failure modes**: <what went wrong, what to improve>
```

