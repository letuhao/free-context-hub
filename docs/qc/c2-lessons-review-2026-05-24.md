# Sprint 16.1 C2 — Lesson Drafts Review (40 rows)

Read each row's **ideal_answer** + **facts**. For any that need changes:
- type the **id** + your edit in chat, OR
- edit `qc/lessons-queries.json` directly

When done, tell me to bulk-set `reviewed_by: letuhao1994@gmail.com` on the approved rows.

---

## 1. `lesson-pg-uuid-casing` — group: confident-hit — category: standard — 67w

**Query:** how to handle pg UUID casing when building map lookups after RETURNING

**Ideal answer:** PostgreSQL canonicalizes UUIDs to lowercase on cast, so `RETURNING id` always yields lowercase regardless of input casing. When building a JavaScript Map from pg results, call `.toLowerCase()` on both sides: when inserting into the map and at lookup time. Apply this whenever one side of the lookup comes from user-supplied input (JSONL, HTTP body) rather than a pg query; if both sides are pg-derived, no action needed.

**Must contain facts:**
  - pg canonicalizes UUIDs to lowercase on cast
  - RETURNING always yields lowercase UUIDs
  - uppercase input UUIDs are matched case-insensitively by pg
  - a Map lookup using an uppercase id will miss the entry
  - fix requires .toLowerCase() when building the map from pg results
  - fix requires .toLowerCase() at lookup time
  - apply the fix when one lookup side is user-supplied rather than pg-derived

---

## 2. `lesson-undici-version-pinning` — group: confident-hit — category: standard — 68w

**Query:** why must undici userland version match the Node bundled version

**Ideal answer:** Node's global `fetch()` uses a bundled undici internally; passing a userland undici `Agent` as `{ dispatcher }` requires the userland version to match that bundled version. A mismatch produces an obscure dispatcher-interface error at runtime because the Dispatcher contract changed between undici major versions. Pin the userland package to match the bundled version and re-verify on every Node upgrade; a diagnostic exists for printing Node's bundled undici version.

**Must contain facts:**
  - Node's global fetch is implemented by a bundled undici internally
  - passing a userland Agent as dispatcher requires matching the bundled undici version
  - version mismatch produces an obscure dispatcher-interface error at runtime
  - the Dispatcher interface changed between undici major versions
  - a diagnostic exists for printing Node's bundled undici version
  - fix is to pin userland undici to match the bundled version
  - the pin must be re-verified on Node upgrades

---

## 3. `lesson-pyenv-python3-shim` — group: confident-hit — category: standard — 61w

**Query:** pyenv-win python3.bat shim fails with multi-line -c bash arguments

**Ideal answer:** On Windows with pyenv-win, `python3` resolves to a `.bat` shim whose CMD translation corrupts newlines in multi-line `-c` argument strings, producing a Python `IndentationError` on the first line of the script. The failure is silent because subsequent commands still execute. Use plain `python` instead of `python3` — they route through different shims; use `bash -x` tracing to surface the hidden error.

**Must contain facts:**
  - pyenv-win python3 resolves to a .bat shim
  - CMD translation in the shim corrupts newlines in multi-line -c strings
  - failure produces a Python IndentationError on the first script line
  - failure is silent because subsequent commands still execute
  - workaround is to use plain python instead of python3
  - bash -x tracing reveals the hidden error

---

## 4. `lesson-npm-test-silent-skip` — group: confident-hit — category: standard — 62w

**Query:** npm test script lists test files explicitly so new ones silently skip

**Ideal answer:** The `test` script in package.json uses explicit file paths rather than a glob, so any new test file is silently omitted from runs with no warning. When adding a new test file, also append it to the test script in the same commit. A long-term fix is to migrate to a glob pattern or a test runner that discovers files by convention.

**Must contain facts:**
  - the test script uses explicit file paths rather than a glob
  - new test files are silently excluded with no warning or error
  - fix requires adding the new file to the test script in the same commit
  - a glob-based or convention-based runner would eliminate the manual step

---

## 5. `lesson-api-lessons-items-shape` — group: confident-hit — category: standard — 45w

**Query:** GET /api/lessons response shape uses items not lessons

**Ideal answer:** The lessons list endpoint returns results under the `items` key, not `lessons` or `results`. Tests that defensively coalesce alternative field names to an empty array silently hide the mismatch, producing confusing downstream failures. Verify the correct field name against the service implementation before writing assertions.

**Must contain facts:**
  - the lessons list endpoint returns results under the `items` key
  - reading a wrong field name with defensive coalescing silently returns an empty array
  - downstream assertions then fail with misleading error messages
  - the correct field name should be verified against the service implementation

---

## 6. `lesson-review-impl-default` — group: confident-hit — category: standard — 56w

**Query:** should I invoke review-impl in post-review by default in the v2.2 workflow

**Ideal answer:** Yes — invoke `/review-impl` by default during POST-REVIEW whenever code touches auth, tenant isolation, destructive ops, new integration boundaries, or non-trivial refactors. Over six consecutive sprints it produced 21 additional findings with zero false positives. On large diffs, run it twice; pure test-only sprints also benefit because tests can be tautological or check the wrong fields.

**Must contain facts:**
  - invoke review-impl by default during POST-REVIEW
  - applies to auth, tenant isolation, and destructive operation code paths
  - applies to non-trivial refactors and new integration boundaries
  - produced additional findings across multiple sprints with no false positives
  - run it twice on large diffs
  - test-only sprints benefit because tests can be tautological

---

## 7. `lesson-noproject-guard-hydration` — group: confident-hit — category: standard — 50w

**Query:** NoProjectGuard hydration-safe approach for Next.js data pages

**Ideal answer:** NoProjectGuard wraps data pages and only activates after the projects list has loaded from the API, preventing a false flash during SSR hydration. It covers two cases: no project selected (empty or default project ID) and project not found (ID not in the loaded list). Twelve data pages are protected.

**Must contain facts:**
  - NoProjectGuard only activates after the projects list is loaded from the API
  - the guard prevents a false flash during SSR hydration
  - one variant handles no project selected
  - another variant handles project ID not present in the loaded list
  - twelve data pages are wrapped by the guard

---

## 8. `lesson-project-crud-validation` — group: confident-hit — category: standard — 55w

**Query:** project CRUD POST PUT endpoints with validation rules

**Ideal answer:** POST and PUT project endpoints enforce a slug-style regex on project_id (no leading or trailing hyphens, max 128 chars), validate color against an allow-list, trim inputs at the route level, and map a duplicate-key database error to a 400 response. A failed group-add on create returns a warning field rather than failing the whole request.

**Must contain facts:**
  - project_id is validated against a slug-style regex with no leading or trailing hyphens
  - project_id has a maximum length of 128 characters
  - a duplicate project_id maps the database unique-violation error to a 400 response
  - color is validated against an allow-list
  - inputs are trimmed at the route layer
  - a failed group-add on create returns a warning field rather than an error

---

## 9. `lesson-multi-project-color` — group: confident-hit — category: standard — 45w

**Query:** multi-project color and description schema additions

**Ideal answer:** `color` and `description` columns were added to the projects table. Color is validated against a fixed allow-list in both the backend service and frontend components — these two lists must be kept in sync. Description has a 2000-character limit and name has a 256-character limit.

**Must contain facts:**
  - color and description columns were added to the projects table
  - color is validated against a fixed allow-list
  - the allow-list exists in both backend and frontend and must be kept in sync
  - description has a 2000-character limit
  - name has a 256-character limit

---

## 10. `lesson-code-review-workflow-pref` — group: confident-hit — category: standard — 60w

**Query:** code review preference: review each file group separately after bulk implementation

**Ideal answer:** After large implementations, review code in focused groups — backend service, backend routes, frontend components, frontend pages, integration — rather than all at once. This structured approach found 18 issues in one session including bugs, security gaps, and logic errors. Key patterns to check include frontend/backend validation sync, Tailwind dynamic class purging, React hydration race conditions, and useEffect dependency stability.

**Must contain facts:**
  - review code in focused file-group passes rather than all at once
  - structured group review found bugs and security gaps missed during implementation
  - frontend and backend validation rules must be checked for sync
  - React hydration race conditions are a common pattern to check
  - useEffect dependency stability should be reviewed for derived-object dependencies

---

## 11. `lesson-dup-max-retry-guardrail` — group: duplicate-trap — category: standard — 26w

**Query:** max retry attempts must be 3 external API call guardrail

**Ideal answer:** Retry attempts for external API calls must not exceed 3. This is an enforced guardrail: any call that retries more than 3 times violates the limit.

**Must contain facts:**
  - retry attempts are capped at a maximum of 3
  - exceeding 3 retries violates the enforced guardrail

**Targets** (duplicate-trap cluster): 9 lessons

---

## 12. `lesson-dup-global-search-retry-pattern` — group: duplicate-trap — category: standard — 11w

**Query:** global search test retry pattern exponential backoff

**Ideal answer:** For global search tests, use exponential backoff as the retry strategy.

**Must contain facts:**
  - global search tests should use exponential backoff for retries

**Targets** (duplicate-trap cluster): 11 lessons

---

## 13. `lesson-dup-valid-impexp-fixture` — group: duplicate-trap — category: standard — 26w

**Query:** valid impexp extra entry fixture

**Ideal answer:** These entries are timestamped test fixture lessons created by the import/export validation suite. They carry minimal content and serve only as seed data for round-trip tests.

**Must contain facts:**
  - these lessons are timestamped test fixture entries
  - they are created by the import/export validation suite
  - they carry minimal placeholder content

**Targets** (duplicate-trap cluster): 9 lessons

---

## 14. `lesson-miss-unicorn` — group: adversarial-miss — category: no_answer — 12w

**Query:** how to render a rainbow unicorn in WebGL with subsurface scattering

**Ideal answer:** [NO_ANSWER] No lesson in this corpus addresses WebGL rendering or subsurface scattering.

**Must contain facts:** (none — no_answer category)

---

## 15. `lesson-miss-astrophysics` — group: adversarial-miss — category: no_answer — 12w

**Query:** thermonuclear astrophysics of quark-gluon plasma at LHC

**Ideal answer:** [NO_ANSWER] No lesson in this corpus covers astrophysics or particle physics topics.

**Must contain facts:** (none — no_answer category)

---

## 16. `lesson-miss-falconry` — group: adversarial-miss — category: no_answer — 12w

**Query:** medieval falconry training manual hood design

**Ideal answer:** [NO_ANSWER] No lesson in this corpus covers falconry or medieval training topics.

**Must contain facts:** (none — no_answer category)

---

## 17. `lesson-cross-integration-test-backoff` — group: cross-topic — category: standard — 18w

**Query:** integration test exponential backoff retry strategy

**Ideal answer:** Use exponential backoff for retries in integration tests. Retry attempts must be capped at a maximum of 3.

**Must contain facts:**
  - exponential backoff is the recommended retry strategy
  - retry attempts must be capped at a maximum of 3

**Targets** (duplicate-trap cluster): 20 lessons

---

## 18. `lesson-cross-sprint-11-closeout` — group: cross-topic — category: standard — 48w

**Query:** sprint 11.6c-sec DNS pinning body-stall timeout security polish

**Ideal answer:** Sprint 11.6c-sec covered DNS pinning and body-stall defenses. A key finding was that a userland HTTP dispatcher package must match the version Node bundles internally; a version mismatch produces an obscure dispatcher-interface error at runtime. Pin the userland package to the bundled version and re-verify on Node upgrades.

**Must contain facts:**
  - a userland HTTP dispatcher must match the version bundled by Node internally
  - a version mismatch produces an obscure dispatcher-interface error at runtime
  - fix is to pin the userland package to match the bundled version
  - the pin must be re-verified when upgrading Node

---

## 19. `lesson-cross-workflow-gate` — group: cross-topic — category: standard — 41w

**Query:** workflow gate state machine 12-phase workflow v2.2

**Ideal answer:** No lesson directly describes the v2.2 workflow-gate state machine. The closest workflow-adjacent lessons cover invoking adversarial review by default during POST-REVIEW, what that review catches that self-review misses, and the preference for reviewing code in focused file groups after bulk implementation.

**Must contain facts:**
  - no lesson directly describes the workflow-gate state machine
  - related lessons cover adversarial review during POST-REVIEW
  - related lessons cover structured code review by file group

**Targets** (duplicate-trap cluster): 3 lessons

---

## 20. `lesson-cross-agent-bootstrap-e2e` — group: cross-topic — category: standard — 25w

**Query:** agent context bootstrap end-to-end testing

**Ideal answer:** These are bootstrap seed lessons created for agent end-to-end test runs. They carry minimal content and are intended to be archived after the tests complete.

**Must contain facts:**
  - these lessons are seed data created for agent end-to-end test runs
  - they carry minimal content
  - they are intended to be archived after the tests complete

**Targets** (duplicate-trap cluster): 2 lessons

---

## 21. `lesson-ambig-measurement-methodology` — group: ambiguous-multi-target — category: standard — 55w

**Query:** how do we measure RAG ranking changes rigorously

**Ideal answer:** Rigorous RAG measurement requires: a measure-first baseline sprint before shipping any improvement; using delta-from-control (new minus control within the same run) rather than raw cross-sprint MRR diffs; treating the A/B baseline archive as the primary wiring integration test; and knowing that baseline determinism holds only for back-to-back runs because embeddings-service load causes jitter across sessions.

**Must contain facts:**
  - establish a measure-first baseline before shipping any retrieval improvement
  - use delta-from-control rather than raw cross-sprint metric diffs
  - the A/B baseline archive is the primary wiring integration test for retrieval changes
  - baseline determinism holds only for back-to-back runs within the same session

**Targets** (duplicate-trap cluster): 4 lessons

---

## 22. `lesson-ambig-dedup-key-design` — group: ambiguous-multi-target — category: standard — 52w

**Query:** how to build a near-duplicate key that doesn't over-collapse or under-collapse

**Ideal answer:** A near-duplicate key should include project_id and lesson_type beyond content hash to avoid collapsing legitimate cross-project or cross-type variants. Digit-run normalization deliberately collapses timestamp variants but risks over-collapsing when digits carry semantic meaning. Empty content fields need a distinguishing fallback such as entity path. An exact-entity-id key is blind to same-title-different-UUID duplication.

**Must contain facts:**
  - the dedup key should include project_id and lesson_type beyond content hash
  - digit normalization collapses timestamp variants but may over-collapse semantically distinct content
  - empty content fields need a distinguishing fallback value
  - a key based on exact entity id is blind to same-title-different-UUID duplication

**Targets** (duplicate-trap cluster): 4 lessons

---

## 23. `lesson-ambig-review-impl-default` — group: ambiguous-multi-target — category: standard — 43w

**Query:** invoke adversarial review in post-review by default

**Ideal answer:** Yes — invoke adversarial review by default during POST-REVIEW. It consistently catches additional findings that self-review and human POST-REVIEW miss, including silent-false-confidence bugs in measurement and benchmarking code that produce wrong numbers without crashing. Always run it even when the code appears non-safety-critical.

**Must contain facts:**
  - invoke adversarial review by default during POST-REVIEW
  - it catches findings that self-review and human POST-REVIEW miss
  - it is especially valuable for measurement and benchmarking code
  - bugs in measurement code produce wrong numbers without crashing rather than failing visibly

**Targets** (duplicate-trap cluster): 2 lessons

---

## 24. `lesson-ambig-popularity-feedback` — group: ambiguous-multi-target — category: standard — 52w

**Query:** when salience boosts cause popular lessons to drown out specific hits

**Ideal answer:** Naive access-frequency salience creates a popularity feedback loop: broadly-matched lessons accumulate accesses and outrank specific targets. The fix is to gate the salience boost on query-conditional relevance using a composite signal — the maximum of semantic and lexical match scores — rather than pure semantic similarity, so FTS-only matches are not penalized.

**Must contain facts:**
  - naive access-frequency salience creates a popularity feedback loop
  - broadly-matched lessons accumulate more accesses and outrank specific targets
  - the fix gates the salience boost on query-conditional relevance
  - the relevance gate should use a composite of semantic and lexical scores
  - pure semantic similarity as the gate penalizes FTS-only matches

**Targets** (duplicate-trap cluster): 2 lessons

---

## 25. `lesson-ambig-baseline-drift` — group: ambiguous-multi-target — category: standard — 60w

**Query:** why do baselines drift between runs

**Ideal answer:** Baselines drift between sessions because the embeddings service is sensitive to transient CPU and memory load — the same query can produce a different score ordering hours apart. Determinism holds only for back-to-back runs in the same session. To isolate true code effect from data drift, always run a control baseline back-to-back at the same time as the new-state baseline.

**Must contain facts:**
  - embeddings service score ordering is sensitive to transient load
  - baseline determinism holds only for back-to-back runs
  - hours-separated runs can drift even with no code changes
  - run a control baseline back-to-back with the new-state baseline to isolate code effect

**Targets** (duplicate-trap cluster): 2 lessons

---

## 26. `lesson-ambig-numeric-edge-cases` — group: ambiguous-multi-target — category: standard — 55w

**Query:** handling numeric edge cases and avoiding silent failures

**Ideal answer:** Two common numeric silent failures: (1) a min/max clamp does not guard against NaN — NaN propagates through both Math.min and Math.max, corrupting downstream sort order silently; precede any clamp with a finite-check guard. (2) floating-point arithmetic in tests needs tolerance comparison, not strict equality — IEEE 754 subtraction produces inexact results for fractional operands.

**Must contain facts:**
  - Math.min and Math.max both propagate NaN rather than filtering it
  - NaN from a clamped value corrupts downstream sort order silently
  - a finite-check guard should precede any defensive clamp
  - floating-point arithmetic needs tolerance comparison in tests, not strict equality
  - integer arithmetic is safe for strict equality but fractional operands are not

**Targets** (duplicate-trap cluster): 2 lessons

---

## 27. `lesson-ambig-test-infra-async` — group: ambiguous-multi-target — category: standard — 49w

**Query:** integration test fixture timing and async work

**Ideal answer:** Async work in the retrieval pipeline (async chunking, non-deterministic distillation) defeats naive seed-and-verify REST e2e tests. The preferred alternative is the A/B baseline archive, which proves wiring by comparing same-goldenset runs rather than seeding. Baseline results are reliable only for back-to-back runs; hours-separated runs drift due to embeddings-service load.

**Must contain facts:**
  - async chunking and non-deterministic distillation defeat seed-and-verify REST e2e tests
  - the A/B baseline archive is the preferred wiring integration test for retrieval pipelines
  - baseline reliability holds only for back-to-back runs
  - hours-separated runs drift due to embeddings-service load variation

**Targets** (duplicate-trap cluster): 3 lessons

---

## 28. `lesson-ambig-noise-floor` — group: ambiguous-multi-target — category: standard — 59w

**Query:** noise floor for A/B diffs catches jitter

**Ideal answer:** The A/B diff tooling must consume the noise floor produced by back-to-back control runs; deltas smaller than the floor should be flagged as within-jitter rather than regressions. Establishing the floor requires back-to-back runs at the same load. Use delta-from-control within the same sprint run so that data drift between sessions does not inflate or mask the true code contribution.

**Must contain facts:**
  - the diff tooling must consume the noise floor to suppress jitter-only changes
  - the noise floor is established by back-to-back runs at the same load
  - deltas smaller than the noise floor should not be flagged as regressions
  - use delta-from-control within the same sprint to exclude cross-session data drift

**Targets** (duplicate-trap cluster): 4 lessons

---

## 29. `lesson-ambig-downstream-propagation` — group: ambiguous-multi-target — category: standard — 45w

**Query:** downstream consumers silently break when ranking shifts

**Ideal answer:** Retrieval-layer changes silently propagate to downstream consumers such as AI synthesis tools. When changing a retrieval primitive, enumerate downstream consumers and spot-check each one's output before and after. Popularity-feedback-loop effects are a propagation phenomenon; delta-from-control measurement is how you detect the shift after the fact.

**Must contain facts:**
  - retrieval-layer changes silently propagate to downstream consumers
  - enumerate downstream consumers when changing a retrieval primitive
  - spot-check each downstream consumer before and after the change
  - delta-from-control measurement detects unintended propagation effects

**Targets** (duplicate-trap cluster): 3 lessons

---

## 30. `lesson-ambig-fire-and-forget-pool` — group: ambiguous-multi-target — category: standard — 51w

**Query:** how to avoid pool starvation when inserting asynchronously

**Ideal answer:** Two mitigations for pool starvation from async writes: (1) document pool-sizing assumptions wherever fire-and-forget writes exist in hot paths, and plan for write-behind batching before load grows; (2) replace per-project query loops with a single batched query using array parameters so the number of roundtrips stays constant regardless of project count.

**Must contain facts:**
  - fire-and-forget writes in hot paths can saturate the connection pool under concurrent load
  - document pool-sizing assumptions wherever fire-and-forget writes exist
  - plan write-behind batching before load grows
  - per-project query loops cause N+1 roundtrips that should be replaced with a single batched query

**Targets** (duplicate-trap cluster): 2 lessons

---

## 31. `lesson-ambig-multi-project-isolation` — group: ambiguous-multi-target — category: standard — 43w

**Query:** how to keep project data isolated in queries and dedup

**Ideal answer:** Treat project_id as a first-class dimension in three areas: include it in near-duplicate keys so cross-project variants are not collapsed; add project-specific columns such as color and description with validated allow-lists; and use batched array-parameter queries for multi-project aggregations rather than per-project loops.

**Must contain facts:**
  - project_id must be included in near-duplicate keys to prevent cross-project collapsing
  - project-specific schema additions such as color require a validated allow-list
  - multi-project aggregations should use batched queries instead of per-project loops

**Targets** (duplicate-trap cluster): 3 lessons

---

## 32. `lesson-ambig-composite-relevance` — group: ambiguous-multi-target — category: standard — 53w

**Query:** why use a composite signal not pure semantic for ranking boost

**Ideal answer:** Pure semantic similarity as a relevance gate cancels FTS-only matches — short technical tokens, identifiers, and version numbers where the embedder cannot separate signal from surrounding context. A composite gate using the maximum of semantic and lexical scores preserves both match types. Without this, naive access-frequency salience degrades into a popularity feedback loop.

**Must contain facts:**
  - pure semantic similarity cancels FTS-only matches for short technical tokens
  - a composite gate uses the maximum of semantic and lexical match scores
  - the composite gate preserves both semantic and lexical match types
  - without query-conditional composite gating salience degrades into a popularity feedback loop

**Targets** (duplicate-trap cluster): 2 lessons

---

## 33. `lesson-ambig-content-empty-dedup` — group: ambiguous-multi-target — category: standard — 64w

**Query:** empty content fields cause false dedup collisions

**Ideal answer:** Three dedup failure modes: (1) when both title and snippet are empty, a content hash collapses the entire top-k into one cluster — always populate at least one field from a distinguishing source such as entity path; (2) a content-only hash collapses legitimate cross-project or cross-type variants — include project_id and lesson_type in the key; (3) an exact-entity-id key is blind to same-title-different-UUID duplication.

**Must contain facts:**
  - empty title and snippet collapse the entire top-k into one cluster via the content hash
  - always populate at least one distinguishing field such as entity path
  - a content-only hash collapses cross-project and cross-type variants incorrectly
  - an exact-entity-id key is blind to same-title-different-UUID duplication

**Targets** (duplicate-trap cluster): 3 lessons

---

## 34. `lesson-ambig-recency-frequency-retrieval` — group: ambiguous-multi-target — category: standard — 58w

**Query:** does recency and frequency belong in retrieval ranking

**Ideal answer:** Recency and frequency can belong in retrieval ranking, but only as query-conditional signals. A static per-lesson frequency score creates a popularity feedback loop where broadly-matched lessons accumulate accesses and suppress specific targets. Gate any frequency or recency boost on a composite relevance signal so the boost applies only when the lesson is actually relevant to the current query.

**Must contain facts:**
  - static per-lesson frequency scores create a popularity feedback loop
  - broadly-matched lessons accumulate accesses and suppress specific targets
  - frequency and recency boosts should be gated on query-conditional relevance
  - the relevance gate should use a composite of semantic and lexical signals

**Targets** (duplicate-trap cluster): 2 lessons

---

## 35. `lesson-ambig-dedup-e2e-testing` — group: ambiguous-multi-target — category: standard — 52w

**Query:** why can't I write a simple seed-and-verify e2e test for dedup

**Ideal answer:** Seed-and-verify REST e2e tests for dedup are defeated by two pipeline properties: distillation is non-deterministic so identical inserts produce different content summaries, and chunking completes asynchronously so searching immediately after a POST returns no results. Use the A/B baseline archive instead — a regression in the duplicate-rate metric proves dedup wiring broke.

**Must contain facts:**
  - non-deterministic distillation causes identical inserts to produce different content summaries
  - async chunking means search immediately after POST returns no results
  - the A/B baseline archive is the recommended alternative wiring test for dedup
  - a regression in the duplicate-rate metric proves dedup wiring is broken

**Targets** (duplicate-trap cluster): 2 lessons

---

## 36. `lesson-para-pg-map-miss` — group: semantic-paraphrase — category: standard — 66w

**Query:** why does a Map miss entries right after an insert returns the key

**Ideal answer:** A Map lookup misses when the key used to insert and the key used to look up differ in casing. PostgreSQL normalizes identifiers to a canonical lowercase form on cast, so a key returned from the database is always lowercase. If the lookup key came from user input and has a different case, normalize both sides to lowercase before building the map and at lookup time.

**Must contain facts:**
  - PostgreSQL normalizes identifiers to lowercase on cast
  - a key returned from the database is always lowercase
  - a lookup key from user input may differ in casing and will miss the map entry
  - normalize both sides to lowercase when building the map and at lookup time

---

## 37. `lesson-para-undici-node-mismatch` — group: semantic-paraphrase — category: standard — 58w

**Query:** why does swapping http agents between the default and an installed one break streaming bodies

**Ideal answer:** Node's built-in HTTP client uses an internally bundled HTTP library. Passing a separately-installed HTTP agent as a dispatcher works only when the installed library version matches the bundled one exactly. A mismatch causes an obscure interface error because the Dispatcher contract changed between major versions. Pin the installed package to the bundled version and re-verify on Node upgrades.

**Must contain facts:**
  - Node's built-in HTTP client uses an internally bundled HTTP library
  - a separately-installed agent must match the bundled library version
  - a version mismatch produces an obscure dispatcher-interface error
  - pin the installed package to the bundled version
  - re-verify the pin on Node upgrades

---

## 38. `lesson-para-nan-defensive-math` — group: semantic-paraphrase — category: standard — 53w

**Query:** defensive bounds via min and max don't stop bad numeric input from corrupting results

**Ideal answer:** Min and max range guards do not filter out the special not-a-number value — it passes through both operations unchanged and corrupts any downstream arithmetic or sort. Precede every range guard over externally-sourced numbers with a finite-value check. The not-a-number value most commonly enters from degenerate database vector fields or missing API responses.

**Must contain facts:**
  - min and max operations do not filter out NaN — NaN passes through unchanged
  - NaN corrupts downstream arithmetic and sort order silently
  - precede every range guard with a finite-value check
  - NaN commonly enters from degenerate database vector fields or missing numeric responses

---

## 39. `lesson-para-new-test-not-running` — group: semantic-paraphrase — category: standard — 65w

**Query:** why is a brand new unit test file not executing when the suite passes

**Ideal answer:** The test runner script uses a hard-coded list of file paths rather than a glob, so a new file is simply not referenced and never runs — the suite passes silently with the file omitted. Fix by adding the new file to the script in the same commit as creating it. A longer-term fix is to switch to a runner that discovers files by convention.

**Must contain facts:**
  - the test runner uses a hard-coded file list rather than discovery
  - a new file not in the list is silently omitted with no warning
  - add the new file to the script in the same commit as creating it
  - switching to convention-based discovery eliminates the manual step

---

## 40. `lesson-para-windows-python-newlines` — group: semantic-paraphrase — category: standard — 59w

**Query:** on Windows my inline Python script argument loses newlines at the batch-file boundary

**Ideal answer:** On Windows, one Python launcher resolves through a batch-file wrapper whose CMD translation strips newlines from multi-line inline script arguments. The script then fails with an indentation error on the first line, but because subsequent shell commands still run the failure is invisible without trace-level logging. Switch to the alternative launcher that does not route through a batch file.

**Must contain facts:**
  - one Python launcher on Windows routes through a batch-file wrapper
  - CMD translation in the batch file strips newlines from multi-line inline arguments
  - the failure produces a Python indentation error on the first line
  - the failure is invisible without trace-level logging because subsequent commands still run
  - the workaround is to use the alternative Python launcher that avoids the batch-file path

---
