# Phase 14 — Global Model Swap CLARIFY Spec

**Date:** 2026-05-14
**Branch:** `phase-13-dlf-coordination` (or new `phase-14-model-swap` branch — TBD)
**Workflow phase:** CLARIFY
**Task size:** **M** (3 files, 1 new logic file, side effects YES)
**AMAW status:** awaiting Adversary review at REVIEW phase

---

## Intent

Swap the MCP server's global embedding model and distillation model:

| Component | From | To |
|-----------|------|----|
| `EMBEDDINGS_MODEL` | `mixedbread-ai/text-embedding-mxbai-embed-large-v1` (512 ctx, 1024 dim) | `text-embedding-bge-m3` (8192 ctx, 1024 dim) |
| `DISTILLATION_MODEL` | `qwen/qwen2.5-coder-14b` | `nvidia/nemotron-3-nano` |
| `EMBEDDINGS_DIM` | 1024 | 1024 (unchanged) |

**Pre-conditions:**
- LM Studio has both models loaded as of 2026-05-14 (user-confirmed).
- Contexthub stack is currently SHUT DOWN by user for maintenance — Phase 14 build happens during this window.
- Two projects exist: `free-context-hub` (638 lessons + thousands of chunks) and `phase-13-coordination` (0 lessons + 829 files indexed today).

## Why now (motivation)

1. **DEFERRED-002**: `mxbai-large` truncates inputs >512 tokens. `CHUNK_LINES=120` produces ~600-1000 tokens/chunk. Phase 12 measurement work (sprints 12.1c→12.1h) measured RAG quality on systematically truncated vectors. Switching to bge-m3 (8192 ctx) eliminates truncation entirely.
2. **Vietnamese content**: bge-m3 is multilingual-native; mxbai-large is EN-trained. Many lesson titles/contents are Vietnamese.
3. **DEFERRED-001 ABANDONED**: per-project model routing (the alternative) is more complex and unnecessary if global swap delivers benefit to both projects equally.
4. **Coder model age**: `qwen2.5-coder-14b` is ~12 months old. `nemotron-3-nano` (NVIDIA, late 2025) is newer with stronger reasoning + tool use.

## In scope (this phase)

1. Edit `.env` — `EMBEDDINGS_MODEL` + `DISTILLATION_MODEL` values
2. Write `src/scripts/reembedAll.ts` — bulk in-place re-embed for 3 tables (`chunks`, `lessons`, `document_chunks`)
3. Run reembedAll against both projects
4. Smoke test: search_lessons, search_code, reflect each return reasonable results
5. Update `docs/deferred/DEFERRED.md` — resolve DEFERRED-002
6. Add 1-2 lessons to MCP capturing the decision + new baseline
7. Supersede stale lesson `ecd2d610-1cdd-481f-bf4f-ef9f0ab356d8` (says "deferred to Phase 14" — now wrong)
8. Update `CLAUDE.md` env var snippet if needed

## Out of scope (deferred / separate work)

1. **Re-running Phase 12 goldenset baselines** under new vector space — recommended but not required for Phase 14 close. Track as new DEFERRED-003 if not done in same session.
2. **Per-project model routing** — explicitly abandoned (DEFERRED-001 ABANDONED).
3. **Re-distilling lessons** (regenerate `summary`, `quick_action`, `search_aliases` with nemotron-3-nano) — keeps existing aliases. If quality degrades, follow-up sprint.
4. **Knowledge graph (Neo4j) symbol embeddings** — KG is disabled by default (`KG_ENABLED=false`); skip unless user enables.
5. **Generated docs** (`generated_documents` table for FAQ/RAPTOR/QC artifacts) — check if it has embedding column; if yes, include in reembedAll; if no, skip.

## Assumptions (locked at CLARIFY)

| # | Assumption | Justification | Failure mode if wrong |
|---|---|---|---|
| A1 | bge-m3 in LM Studio returns 1024-dim vectors | Standard bge-m3 dim; user confirmed model loaded | Embedding fn throws on dim mismatch → halt before any UPDATE |
| A2 | bge-m3 endpoint follows OpenAI `/v1/embeddings` schema | LM Studio implements OpenAI-compat for all loaded models | `embedTexts()` decode fails → halt |
| A3 | nemotron-3-nano returns OpenAI-compat `/v1/chat/completions` | Standard LM Studio behavior | distill calls fail silently (already handled — falls back to `status: failed`) |
| A4 | Re-embedding in place (UPDATE embedding column) preserves all metadata, FTS, salience access logs | Pure column update; no DELETE | Should not happen unless we accidentally DROP |
| A5 | Existing `search_aliases` column values are usable with the new embedding model | Aliases are LLM-generated paraphrases of title+content; semantically still valid | Search recall slightly worse than fresh re-distill; acceptable tradeoff |
| A6 | `index_project` will skip re-indexing files with matching content_hash AFTER reembedAll runs (because we update vectors, not content) | indexer.ts check is on content_hash | If we accidentally `DELETE FROM chunks`, next index_project run re-creates them — recoverable but slow |
| A7 | bge-m3 throughput on LM Studio CPU/GPU is sufficient to complete re-embed in <60 min | Conservative estimate: 5-15 embeds/sec | Long runtime — acceptable, but track elapsed |

## Open questions (need user input)

| # | Question | Default if no answer |
|---|---|---|
| Q1 | Branch: do work on current `phase-13-dlf-coordination` or new `phase-14-model-swap`? | New branch (isolation) |
| Q2 | After Phase 14 closes, resume Phase 13 from Sprint 13.1 with refreshed baselines? | Yes |
| Q3 | Re-run Phase 12 goldenset baseline (40q) under bge-m3 — in this session or defer? | Defer to DEFERRED-003 |
| Q4 | If `nemotron-3-nano` produces measurably worse distillation than `qwen-coder-14b`, rollback or accept? | Accept (newer model assumed better; revisit only if egregious) |
| Q5 | Backup current DB state (pg_dump) before re-embed? | Yes — quick safety net, <30s |

## Three implementation approaches considered

### Approach A — In-place re-embed (RECOMMENDED)

For each table (`chunks`, `lessons`, `document_chunks`), SELECT rows with embedding-source columns, call `embedTexts()` with new model, UPDATE embedding column. Preserves all rows, metadata, FTS, salience access logs.

**Pros:**
- Zero data loss. 638 lessons survive intact.
- Idempotent — can re-run after partial failure.
- No schema migration (bge-m3 = same 1024 dim as mxbai).
- All search_aliases, summary, quick_action preserved.

**Cons:**
- Requires writing a new script (~150-200 LOC). Estimated 30 min coding.
- Re-embed time depends on LM Studio throughput.
- `search_aliases` was LLM-generated by old model — minor staleness but semantically still valid.

### Approach B — Nuke + reseed (matches historical migrations 0020-0028)

Run a new migration `0048_global_model_swap.sql`: `DELETE FROM chunks; DELETE FROM lessons; DELETE FROM document_chunks;`. Then re-run `index_project` for chunks. **Lessons cannot be reseeded** — they're user-created knowledge.

**Pros:**
- Matches existing migration pattern (team has done this 8 times in 0020-0028).
- No new script needed.

**Cons:**
- **LOSES 638 LESSONS** including Phase 12 retro lessons, friction classes, all decisions. UNACCEPTABLE.
- Unless we pre-export lessons via `exportProject` and re-import, but that's effectively the same as re-embed.
- Document_chunks (uploaded docs) similarly lost.

**Verdict: REJECTED.** The historical pattern was used early in the project when lessons were sparse. We have 638 valuable lessons now.

### Approach C — Hybrid: backup + nuke + restore via import/export

Use `exportProject` MCP tool → save bundles → run nuke migration → bring up new model → run `importProject` to re-add lessons (which re-embeds them during insert).

**Pros:**
- Uses existing tested export/import infrastructure (Phase 11).
- Final state same as Approach A.

**Cons:**
- More moving parts (export → migrate → restart → import).
- Re-distill happens on import (regenerates summary/quick_action/aliases with new LLM) — could be a pro OR con depending on quality. Adds runtime.
- Three failure surfaces vs one.

### Recommendation: **Approach A**

Simplest, safest, lowest risk. Approach C has merit for "fresh start with new LLM" but adds complexity Phase 14 doesn't need. If user wants fresh distillation later, that's a separate task (DEFERRED candidate).

## Estimated runtime

| Step | Time |
|------|------|
| LM Studio sanity check (curl test bge-m3 endpoint) | 1 min |
| pg_dump backup | 1 min |
| Write `reembedAll.ts` | 30 min |
| Switch `.env` + restart MCP+worker | 2 min |
| Re-embed `phase-13-coordination/chunks` (~4000) | 5-15 min |
| Re-embed `free-context-hub/chunks` (unknown count, probably 10-30k) | 30-90 min |
| Re-embed `free-context-hub/lessons` (638) | 1-3 min |
| Re-embed `document_chunks` (TBD count) | 5-15 min |
| Smoke test | 5 min |
| Update DEFERRED.md + add lessons | 5 min |
| **Total** | **~90-150 min** |

## Risks

| # | Risk | Severity | Mitigation |
|---|---|---|---|
| R1 | bge-m3 in LM Studio returns wrong dim (e.g., 768 if quantized variant) | HIGH | A1 sanity check before any UPDATE; embedTexts() throws on mismatch — fail fast |
| R2 | LM Studio crashes mid-re-embed | MED | Script is idempotent; resume picks up where left off via WHERE embedding-was-from-old-model-version flag, OR via "re-embed all rows" non-incremental approach with checkpoint |
| R3 | nemotron-3-nano outputs degenerate distillation | LOW | Distillation is best-effort already; failures get `status: failed`, lessons go to draft. Smoke test verifies. |
| R4 | Re-embed takes >2 hours, user wants to continue Phase 13 sooner | LOW | Skip re-embed for free-context-hub (only do phase-13-coordination), defer free-context-hub re-embed. But then queries to free-context-hub break — bad UX. Recommend: complete both. |
| R5 | Search quality regresses post-swap (bge-m3 worse than mxbai for our content) | MED | Re-run goldenset 40q post-swap (DEFERRED-003 candidate). If MRR drops >10%, consider rollback. |
| R6 | We forget to update CLAUDE.md/docs about new model names | LOW | TODO checklist item in PLAN phase |

## Acceptance criteria

- [ ] AC1: `.env` contains `EMBEDDINGS_MODEL=text-embedding-bge-m3` and `DISTILLATION_MODEL=nvidia/nemotron-3-nano`
- [ ] AC2: `src/scripts/reembedAll.ts` exists, is idempotent, processes all 3 embedding tables
- [ ] AC3: `chunks.embedding IS NOT NULL` for all rows after run
- [ ] AC4: `lessons.embedding IS NOT NULL` for all 638 lessons (count check before/after)
- [ ] AC5: `document_chunks.embedding IS NOT NULL` for all rows
- [ ] AC6: `search_lessons("phase 12 measurement")` returns reasonable results (not empty, not garbage)
- [ ] AC7: `search_code("embedTexts")` returns `src/services/embedder.ts` in top results
- [ ] AC8: `reflect("how should I design phase 13 leasing")` returns coherent output (uses nemotron)
- [ ] AC9: DEFERRED-002 marked RESOLVED with phase-14 sprint reference
- [ ] AC10: Stale lesson `ecd2d610` superseded (status=superseded, superseded_by=new_lesson_id)
- [ ] AC11: 2-3 new lessons added documenting model swap decision + new baseline

## Recovery / rollback plan

If AC6/AC7/AC8 fail (search quality unusable):

1. Stop MCP+worker
2. Restore from pg_dump backup (15s)
3. Revert `.env` to old model values
4. Restart MCP+worker
5. Document failure as new friction class lesson
6. Reopen DEFERRED-002 with note "Phase 14 attempt 1 failed — investigate why bge-m3 underperformed"

---

## Next steps (CLARIFY → DESIGN handoff)

Once user confirms Approach A:
1. Move to DESIGN phase — detailed script architecture, batching strategy, checkpoint mechanism, error handling
2. Spawn Adversary at REVIEW phase
3. Write PLAN with concrete tasks
4. BUILD → VERIFY → REVIEW → QC → POST-REVIEW → SESSION → COMMIT → RETRO
