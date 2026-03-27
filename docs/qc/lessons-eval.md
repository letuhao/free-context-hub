# Lessons Eval — qc-free-context-hub

This eval seeds a small set of lessons and verifies:\n
- `search_lessons` retrieves expected lessons by intent.\n
- `get_lesson_impact` returns linked symbols/files when `source_refs` point to real paths (KG enabled).\n

## Seeded lessons (MCP: add_lesson)

1. **Decision** — \"Use correlation_id for job run scoping\"\n
   - tags: `qc-seed`, `decision-queue`\n
   - source_refs: `src/index.ts`, `src/services/jobQueue.ts`, `src/services/jobExecutor.ts`\n

2. **Workaround** — \"Filter [object Object] from source_refs\"\n
   - tags: `qc-seed`, `workaround-distiller`\n
   - source_refs: `src/services/distiller.ts`, `src/services/gitIntelligence.ts`\n

## Retrieval checks

- Query: \"correlation_id job run scoping\" → `search_lessons` returned both seeded lessons with the decision ranked #1.\n

## Impact checks (KG)

- `get_lesson_impact` for decision lesson returned:\n
  - linked_symbols including `executeByType`, `runNextJob`, `enqueueJob`, `listJobs`, and others\n
  - affected_files includes: `src/services/jobExecutor.ts`, `src/services/jobQueue.ts`, `src/index.ts`\n

- `get_lesson_impact` for workaround lesson returned:\n
  - linked_symbols including `normalizeSourceRefs`, `suggestLessonsFromCommits`, `suggestLessonFromCommit`\n
  - affected_files includes: `src/services/gitIntelligence.ts`, `src/services/distiller.ts`\n

## Notes / findings\n
- Lesson linkage works well when `source_refs` are real file paths and KG is enabled.\n
- Consider adding a negative-control lesson with no `source_refs` to ensure `get_lesson_impact` returns an appropriate warning and no hallucinated links.\n

