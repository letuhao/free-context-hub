# Sprint 16.1 Group D — Edge Cases Review (25 rows, drafted_by=human)

Only edge cases shown (drafted_by='human'). Bootstrap rows omitted — they're already reviewed.

Tell me approval or edits. Edge cases use drafted_by='human' so they don't need reviewed_by per R7.

---

# lessons surface (8 edge cases)

## 1. `lesson-edge-multi-hop-1` — category: multi_hop — 58w

**Query:** What two patterns combine for safe state-transition testing in coordination layer tests?

**Targets:** lessons: 2

**Ideal answer:** Two patterns combine. First, read a row's pre-transition state via `SELECT … FOR UPDATE` rather than a `WITH-prev` CTE, so the lock guarantees the read corresponds to the same transaction that performs the update. Second, when testing an unreachable concurrency branch, extract the decision into an injectable seam — don't fake the race condition; inject the branch directly.

**Must contain facts:**
  - pre-transition state should be read via SELECT FOR UPDATE
  - WITH-prev CTE is not the recommended pattern for pre-transition reads
  - unreachable concurrency branches should be tested via injectable seams
  - tests must not fake race conditions to exercise these branches

---

## 2. `lesson-edge-multi-hop-2` — category: multi_hop — 58w

**Query:** What review steps are required when adding a new authorization or governance primitive?

**Targets:** lessons: 3

**Ideal answer:** Three combined requirements apply. A security-framed cold-start adversarial review is mandatory for any sprint adding an authorization or governance primitive — that is, hostile-actor framing on the new code with no prior context. The reviewer should also grep the diff for three recurring bypass patterns documented from prior tenant-scope work, since these patterns reappear in every authz PR.

**Must contain facts:**
  - a cold-start adversarial review is mandatory for new authorization or governance primitives
  - the review must use security-framed hostile-actor framing
  - the reviewer must have no prior context on the code under review
  - three recurring bypass patterns from tenant-scope work should be grepped in every authz PR

---

## 3. `lesson-edge-no-answer-1` — category: no_answer — 23w

**Query:** What's the recommended approach for distributed transactions across multiple Postgres instances?

**Targets:** none (no_answer)

**Ideal answer:** [NO_ANSWER] No lesson in this corpus addresses distributed transactions or multi-instance Postgres coordination. The project operates against a single Postgres instance per deployment.

**Must contain facts:** (none — no_answer)

---

## 4. `lesson-edge-contradictory-1` — category: contradictory — 47w

**Query:** Should every sprint require a cold-start adversarial review?

**Targets:** lessons: 2

**Ideal answer:** No — cold-start adversarial review is mandatory only for sprints that add an authorization or governance primitive, not for every sprint. Cleanup and small (S-size) sprints may even skip PLAN entirely. The rule scopes by sprint TYPE: security-sensitive primitives get the full review; ordinary code changes don't.

**Must contain facts:**
  - cold-start adversarial review is scoped to authorization or governance primitives
  - ordinary sprints do not require adversarial review
  - S-size sprints may skip PLAN entirely
  - the rule scopes by sprint type rather than universally

---

## 5. `lesson-edge-contradictory-2` — category: contradictory — 49w

**Query:** Can a lesson drafted by an LLM be considered final without further review?

**Targets:** lessons: 2

**Ideal answer:** No — LLM-drafted material requires human review before being treated as authoritative. The trust model treats LLM-generated content as a draft that must be validated, not as a final source of truth. This mirrors the broader principle that automated review does not replace cold-start adversarial review for security-sensitive material.

**Must contain facts:**
  - LLM-drafted material is not final without human review
  - the trust model treats LLM output as a draft requiring validation
  - automated review does not replace cold-start adversarial review

---

## 6. `lesson-edge-paraphrase-1` — category: paraphrase — 54w

**Query:** My JS Map can't find rows after pg returns the inserted UUIDs — what's going on?

**Targets:** lessons: 1

**Ideal answer:** PostgreSQL canonicalizes UUIDs to lowercase on cast and matches input UUIDs case-insensitively, so any uuid returned via RETURNING is lowercase. A JavaScript Map keyed by those returned ids will miss any lookup that uses the original uppercase form. Call `.toLowerCase()` on both sides whenever one side of the lookup is user-supplied rather than pg-derived.

**Must contain facts:**
  - pg canonicalizes UUIDs to lowercase on cast
  - RETURNING always yields lowercase UUIDs
  - uppercase input UUIDs are matched case-insensitively by pg
  - a Map lookup using an uppercase id will miss the entry
  - fix requires .toLowerCase() on both map-building and lookup sides

---

## 7. `lesson-edge-paraphrase-2` — category: paraphrase — 58w

**Query:** Why does my fetch call break after I install undici from npm?

**Targets:** lessons: 1

**Ideal answer:** Node's global fetch uses a bundled undici internally, and passing a userland undici Agent as the dispatcher requires the userland version to exactly match the bundled version. A version mismatch produces an obscure dispatcher-interface error because the Dispatcher contract changed between undici majors. Pin the userland package to match the bundled version and re-verify on every Node upgrade.

**Must contain facts:**
  - Node's global fetch is implemented by a bundled undici internally
  - passing a userland Agent as dispatcher requires matching the bundled undici version
  - version mismatch produces an obscure dispatcher-interface error at runtime
  - fix is to pin userland undici to match the bundled version

---

## 8. `lesson-edge-distractor-1` — category: distractor — 56w

**Query:** How should I invoke python in cross-platform shell scripts?

**Targets:** lessons: 1

**Ideal answer:** The corpus only documents this for the Windows pyenv-win case: `python3` resolves to a `.bat` shim that corrupts newlines in multi-line `-c` argument strings, so the workaround is to use plain `python`. No guidance exists for macOS or Linux behavior — the answer scopes specifically to Windows pyenv-win and should not be generalized to all platforms.

**Must contain facts:**
  - the lesson is specific to Windows pyenv-win
  - python3 resolves to a .bat shim on pyenv-win
  - the .bat shim corrupts newlines in multi-line -c argument strings
  - the workaround is to use plain python rather than python3
  - no equivalent guidance exists for macOS or Linux in this corpus

---

# code surface (10 edge cases)

## 9. `code-edge-multi-hop-1` — category: multi_hop — 54w

**Query:** How does index_project hand off chunks to the embedding service before writing to Postgres?

**Targets:** files: `src/services/indexer.ts`, `src/services/embedder.ts`

**Ideal answer:** The indexer walks the workspace via fast-glob, chunks files, then passes the chunk texts to the embedder's `embedTexts` function which batches OpenAI-compatible embedding requests. The indexer holds responsibility for persistence — chunks plus their returned embeddings are written into Postgres via pgvector in a single transaction. The embedder itself does not touch the database.

**Must contain facts:**
  - the indexer walks the workspace using fast-glob
  - the embedder exposes embedTexts as the batched embedding entry point
  - the indexer (not the embedder) writes chunks plus embeddings to Postgres
  - persistence uses pgvector for the embedding column

---

## 10. `code-edge-no-answer-1` — category: no_answer — 29w

**Query:** Where is the WebSocket gateway configured for streaming chat replies?

**Targets:** none (no_answer)

**Ideal answer:** [NO_ANSWER] No WebSocket gateway exists in this codebase. Streaming chat replies use Server-Sent Events over standard HTTP, not WebSockets. The REST API on port 3001 owns the streaming path.

**Must contain facts:** (none — no_answer)

---

## 11. `code-edge-no-answer-2` — category: no_answer — 27w

**Query:** How does the Kafka consumer initialize at startup?

**Targets:** none (no_answer)

**Ideal answer:** [NO_ANSWER] No Kafka consumer exists in this codebase. The project uses RabbitMQ as its message broker (gated behind QUEUE_ENABLED) and Redis for cache, but no Kafka integration.

**Must contain facts:** (none — no_answer)

---

## 12. `code-edge-contradictory-1` — category: contradictory — 56w

**Query:** Does MCP_AUTH_ENABLED apply uniformly across REST and MCP transports?

**Targets:** files: `src/api/middleware/auth.ts`, `src/mcp/auth.ts`

**Ideal answer:** Yes — after the SEC-7 fix MCP_AUTH_ENABLED is honored uniformly. Both the REST `bearerAuth` middleware and the MCP transport's auth helper check the flag and reject legacy single-shared tokens when `MCP_LEGACY_TOKEN_DISABLED=true`. Earlier in DEFERRED-029 PR F the REST side did not honor the flag, but the SEC-7 fix mirrored the MCP resolver into the REST middleware.

**Must contain facts:**
  - MCP_AUTH_ENABLED is honored uniformly across REST and MCP after the SEC-7 fix
  - both transports respect MCP_LEGACY_TOKEN_DISABLED for rejecting legacy tokens
  - earlier in DEFERRED-029 PR F the REST middleware did not honor the disable flag
  - the fix mirrored the MCP resolver into the REST middleware

---

## 13. `code-edge-contradictory-2` — category: contradictory — 55w

**Query:** Are retries enabled by default in this project's service layer?

**Targets:** files: `src/services/embedder.ts`, `src/services/jobQueue.ts`

**Ideal answer:** Retries are not uniformly applied — the answer depends on which service. Embedding calls retry on transient network failures via the embedder's built-in retry. The job queue itself does not retry job execution by default; failed jobs are surfaced via status, not re-enqueued. So 'default retry behavior' has no single answer; check the specific service.

**Must contain facts:**
  - retry behavior is not uniform across the service layer
  - the embedder retries on transient network failures
  - the job queue does not automatically retry failed jobs by default
  - the correct answer depends on the specific service

---

## 14. `code-edge-paraphrase-1` — category: paraphrase — 35w

**Query:** Where does the system check the workspace token for tools invoked over MCP?

**Targets:** files: `src/index.ts`

**Ideal answer:** The MCP entry point in src/index.ts wraps every tool handler with `assertWorkspaceToken`, which reads the incoming `workspace_token` header and validates it against the `CONTEXT_HUB_WORKSPACE_TOKEN` env value when `MCP_AUTH_ENABLED=true`. When auth is disabled the helper short-circuits.

**Must contain facts:**
  - MCP tool handlers in src/index.ts are wrapped by assertWorkspaceToken
  - assertWorkspaceToken validates against CONTEXT_HUB_WORKSPACE_TOKEN
  - the check only runs when MCP_AUTH_ENABLED is true
  - the helper short-circuits when auth is disabled

---

## 15. `code-edge-paraphrase-2` — category: paraphrase — 54w

**Query:** What tiers does the tiered code search use to find a function definition?

**Targets:** files: `src/services/retriever.ts`

**Ideal answer:** The tiered code search runs four tiers in order: Tier 1 ripgrep for literal matches, Tier 2 PostgreSQL ILIKE against the indexed symbol_name column, Tier 3 PostgreSQL FTS over file content, and Tier 4 semantic vector search as the fallback. Deterministic tiers run first; semantic only fires when earlier tiers produce too few results.

**Must contain facts:**
  - tier 1 uses ripgrep for literal matches
  - tier 2 uses ILIKE against the symbol_name column
  - tier 3 uses PostgreSQL FTS over file content
  - tier 4 uses semantic vector search as fallback
  - semantic search runs only when earlier tiers yield too few results

---

## 16. `code-edge-distractor-1` — category: distractor — 57w

**Query:** How is auth handled for the chat sidebar?

**Targets:** files: `src/api/middleware/auth.ts`

**Ideal answer:** The chat sidebar calls the REST API on port 3001, so it goes through the REST `bearerAuth` middleware. The middleware checks for an Authorization Bearer token and resolves it either to a hashed api_keys row or, when not disabled, to the legacy single-shared workspace token. This is distinct from the MCP-side `assertWorkspaceToken` helper used by tool calls.

**Must contain facts:**
  - chat sidebar requests go through the REST bearerAuth middleware
  - bearerAuth resolves the Bearer token against the api_keys table
  - the legacy single-shared workspace token is also accepted unless disabled
  - this is distinct from the MCP-side workspace token assertion

---

## 17. `code-edge-distractor-2` — category: distractor — 53w

**Query:** Where is retry logic defined?

**Targets:** files: `src/services/embedder.ts`

**Ideal answer:** The query is ambiguous — retry logic exists in several places. The most prominent is the embedder's batched-request retry on transient network failures. Separate retry-adjacent code exists for the job-queue worker (lease renewal), but that's not a request-level retry. The answer should specify which retry the questioner means; if unspecified, assume the embedder.

**Must contain facts:**
  - retry logic exists in multiple modules
  - the embedder retries on transient network failures
  - the job-queue worker performs lease renewal which is not the same as request retry
  - the answer should clarify which retry the questioner means

---

## 18. `code-edge-distractor-3` — category: distractor — 46w

**Query:** How are tests organized in this project?

**Targets:** files: `package.json`

**Ideal answer:** Unit tests live next to their source as `*.test.ts` files and are run via the `npm test` script, which lists every test file explicitly (new tests must be added manually). End-to-end tests live under `test/e2e/{api,gui,smoke,agent}` and run via dedicated `test:e2e:*` scripts. There is no glob-based runner.

**Must contain facts:**
  - unit tests live next to their source as *.test.ts files
  - npm test enumerates test files explicitly rather than globbing
  - end-to-end tests live under test/e2e/{api,gui,smoke,agent}
  - each e2e suite has its own npm script under test:e2e:*

---

# chunks surface (3 edge cases)

## 19. `chunk-edge-multi-hop-1` — category: multi_hop — 47w

**Query:** What's the complete retry mechanism — strategy, configuration, and implementation?

**Targets:** chunks: 3

**Ideal answer:** Strategy: exponential backoff with jitter for external API calls, max 3 retries. Configuration: base delay 100ms, multiplier 2.0, jitter fraction 0.2, max delay 5000ms. Implementation: a `withRetry(fn, opts)` middleware wraps fetch, sleeps for (base × multiplier^attempt) × random-jitter, clamps to max_delay, and only applies to idempotent requests.

**Must contain facts:**
  - retry strategy uses exponential backoff with jitter
  - max retry count is 3
  - base delay is 100ms and the backoff multiplier is 2
  - implementation is a withRetry middleware wrapping fetch
  - retries are limited to idempotent requests

---

## 20. `chunk-edge-no-answer-1` — category: no_answer — 26w

**Query:** How does the system handle GDPR right-to-erasure requests?

**Targets:** none (no_answer)

**Ideal answer:** [NO_ANSWER] No chunk in this corpus addresses GDPR, right-to-erasure, or data-subject-rights workflows. The sample documentation set covers retry, authentication, roles, and storage — not privacy regulation.

**Must contain facts:** (none — no_answer)

---

## 21. `chunk-edge-distractor-1` — category: distractor — 49w

**Query:** What is the maximum retry value used in the system?

**Targets:** chunks: 1

**Ideal answer:** The maximum retry count is 3, taken from the `max_retries` parameter in the retry configuration table. A separate `max_delay_ms` parameter caps per-attempt delay at 5000ms, but that is a delay ceiling, not a count of retries — the question is ambiguous and the correct answer is the count, 3.

**Must contain facts:**
  - max_retries is 3
  - max_retries is sourced from the retry configuration table
  - max_delay_ms (5000ms) caps per-attempt delay, not retry count
  - the question can be ambiguously interpreted as either count or delay

---

# global surface (4 edge cases)

## 22. `global-edge-multi-hop-1` — category: multi_hop — 52w

**Query:** retry workflow

**Targets:** mixed: lesson:2b07085d, chunk:f379c8f6

**Ideal answer:** A search for 'retry workflow' touches two surfaces: lessons covering retry-related guardrails and patterns, and a documentation chunk describing the project's exponential-backoff retry strategy with jitter for external API calls. The palette returns both surfaces; the user is likely looking for the consolidated retry guidance across project conventions and the documented mechanism.

**Must contain facts:**
  - the search matches both lessons and document chunks
  - matched lessons cover retry-related guardrails and patterns
  - the matched chunk describes the project's exponential-backoff retry strategy

---

## 23. `global-edge-no-answer-1` — category: no_answer — 24w

**Query:** obfuscation cipher quantum

**Targets:** none (no_answer)

**Ideal answer:** [NO_ANSWER] No entity in the corpus contains the substrings 'obfuscation', 'cipher', or 'quantum' as searchable text. The palette returns zero hits for this query.

**Must contain facts:** (none — no_answer)

---

## 24. `global-edge-contradictory-1` — category: contradictory — 47w

**Query:** approval

**Targets:** mixed: lesson:a0792c20, lesson:3fff9064

**Ideal answer:** A search for 'approval' surfaces two distinct concepts. One thread covers /review-impl approval gates during POST-REVIEW. A separate thread covers Phase 15 coordination approvals — request-step and motion approvals via the matrix-driven collective. The two are independent processes; the palette returns both and the user must disambiguate.

**Must contain facts:**
  - the search returns entities about /review-impl POST-REVIEW gates
  - the search also returns entities about Phase 15 coordination approvals
  - the two approval threads are independent processes
  - the user must disambiguate which kind of approval they mean

---

## 25. `global-edge-paraphrase-1` — category: paraphrase — 36w

**Query:** ADRs

**Targets:** mixed: chunk:512d7a46, chunk:79e04437

**Ideal answer:** A search for 'ADRs' surfaces the two near-duplicate Architecture Decision Records introduction chunks — sample.docx and sample.png variants of the same intro material describing what ADRs are. The palette returns both members of the duplicate cluster.

**Must contain facts:**
  - the search matches Architecture Decision Records introduction chunks
  - two near-duplicate chunks (docx and png variants) are returned
  - both chunks describe what ADRs are at an introductory level

---
