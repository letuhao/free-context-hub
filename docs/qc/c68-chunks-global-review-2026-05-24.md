# Sprint 16.1 C6+C8 — Chunks + Global Drafts Review (20 rows)

Tell me approval/edits same as before. Both surfaces here since they're small.

---

# Chunks surface (10 rows)

Source: `qc/chunks-queries.json`

---

## 1. `chunk-retry-strategy-overview` — group: confident-hit — category: standard — 36w

**Query:** what is the retry strategy for external API calls?

**Target chunks:** 1

**Ideal answer:** External API calls use exponential backoff with jitter. The maximum retry count is 3, starting with a 100ms base delay that doubles on each failure. This approach balances reliability against increased tail latency for downstream callers.

**Must contain facts:**
  - exponential backoff with jitter is used
  - maximum retry count is 3
  - base delay starts at 100ms
  - delay doubles on each failure

---

## 2. `chunk-retry-config-table` — group: confident-hit — category: standard — 37w

**Query:** retry configuration parameters base delay and multiplier

**Target chunks:** 1

**Ideal answer:** The retry configuration defines five parameters: max_retries (default 3), base_delay_ms (default 100), backoff_multiplier (default 2.0), jitter_fraction (default 0.2), and max_delay_ms (default 5000). The backoff multiplier controls how delay grows per attempt, and max_delay_ms caps the per-attempt delay.

**Must contain facts:**
  - max_retries defaults to 3
  - base_delay_ms defaults to 100
  - backoff_multiplier defaults to 2.0
  - jitter_fraction defaults to 0.2
  - max_delay_ms defaults to 5000

---

## 3. `chunk-retry-implementation-code` — group: confident-hit — category: standard — 45w

**Query:** how to implement a retry middleware wrapping fetch

**Target chunks:** 1

**Ideal answer:** Implement retries as middleware by wrapping fetch in a `withRetry(fn, opts)` function. On each retry, sleep for base_delay_ms × backoff_multiplier ^ attempt with jitter applied, clamped at max_delay_ms. Only idempotent requests should use retry middleware; the final error is returned when all retries are exhausted.

**Must contain facts:**
  - retries are implemented as middleware wrapping fetch
  - the wrapper function accepts opts for retry configuration
  - delay per attempt is base_delay multiplied by backoff_multiplier to the power of attempt
  - delay is clamped at max_delay_ms
  - jitter is applied to the delay
  - only idempotent requests should be retried
  - the final error is returned when all retries fail

---

## 4. `chunk-authentication-overview` — group: confident-hit — category: standard — 49w

**Query:** API authentication using API key in Authorization header

**Target chunks:** 1

**Ideal answer:** Authentication is performed via an API key passed in the Authorization header as a Bearer token. Keys are issued per project and scoped to a role. Requests missing a valid key receive a 401 response; keys are stored hashed at rest and the plaintext is shown only at issuance.

**Must contain facts:**
  - API key is sent in the Authorization header as a Bearer token
  - keys are issued per project
  - keys are scoped to a role
  - missing or invalid key returns 401
  - keys are stored hashed using SHA-256
  - plaintext key is shown only at issuance

---

## 5. `chunk-role-definitions` — group: confident-hit — category: standard — 35w

**Query:** what are the user roles admin editor viewer in the system

**Target chunks:** 1

**Ideal answer:** Three roles exist: admin, editor, and viewer. Admin has full read, write, delete, and user-management access; editor can read and write but cannot delete or manage users; viewer is read-only. Custom roles are not supported.

**Must contain facts:**
  - three roles exist: admin, editor, viewer
  - admin has full read/write/delete and user management
  - editor can read and write but cannot delete or manage users
  - viewer is read-only
  - custom roles are not supported

---

## 6. `chunk-data-storage-pgvector` — group: confident-hit — category: standard — 41w

**Query:** how are lessons stored pgvector postgres

**Target chunks:** 1

**Ideal answer:** Lessons and document chunks are stored in PostgreSQL with the pgvector extension. Embedding vectors are 1024-dimensional and indexed using HNSW for cosine similarity. The lesson table is indexed by project_id and status, with an additional GIN index for full-text search fallback.

**Must contain facts:**
  - storage backend is PostgreSQL with pgvector extension
  - embedding vectors are 1024-dimensional
  - HNSW index is used for cosine similarity search
  - lesson table is indexed by project_id and status
  - a GIN index supports full-text search fallback

---

## 7. `chunk-adr-intro-dup` — group: duplicate-trap — category: standard — 36w

**Query:** architecture decision records introduction

**Target chunks:** 2

**Ideal answer:** Architecture Decision Records (ADRs) document significant design choices made for the project. Each ADR captures the context, the decision taken, and the resulting consequences. This introductory chunk appears in both the docx and png corpus variants.

**Must contain facts:**
  - ADRs document significant architectural design choices
  - each ADR captures context, decision, and consequences

---

## 8. `chunk-cross-retry-auth-storage` — group: cross-topic — category: standard — 40w

**Query:** summary of retry authentication and data storage decisions

**Target chunks:** 3

**Ideal answer:** Retry uses exponential backoff with jitter, capped at 3 attempts. Authentication requires a per-project Bearer API key in the Authorization header, with keys stored hashed at rest. Lessons and chunks are persisted in PostgreSQL with pgvector, using 1024-dimensional HNSW-indexed embeddings.

**Must contain facts:**
  - retry uses exponential backoff with jitter
  - maximum retry attempts is 3
  - authentication uses a Bearer API key in the Authorization header
  - keys are stored hashed
  - storage uses PostgreSQL with pgvector
  - embeddings are 1024-dimensional with HNSW indexing

---

## 9. `chunk-miss-quantum` — group: adversarial-miss — category: no_answer — 16w

**Query:** quantum flux capacitor documentation chapter 7

**Ideal answer:** [NO_ANSWER] No chunk in this corpus addresses quantum mechanics, flux capacitors, or this fictional reference work.

**Must contain facts:** (none — no_answer category)

---

## 10. `chunk-miss-jazz` — group: adversarial-miss — category: no_answer — 13w

**Query:** history of bebop jazz improvisation notation

**Ideal answer:** [NO_ANSWER] No chunk in this corpus covers music history, jazz, or improvisation notation.

**Must contain facts:** (none — no_answer category)

---


# Global surface (10 rows)

Source: `qc/global-queries.json`

---

## 1. `global-retry-substr` — group: confident-hit — category: standard — 53w

**Query:** retry

**Targets:** lesson:2b07085d, lesson:4abf93d6, chunk:f379c8f6

**Ideal answer:** A search for 'retry' surfaces multiple entities: a decision lesson about retry test patterns using exponential backoff, a guardrail lesson enforcing a maximum of 3 retry attempts, and a documentation chunk describing the project's retry strategy — all external API calls use exponential backoff with a 1-second base delay and multiplier of 2.

**Must contain facts:**
  - At least one matched entity is a guardrail enforcing a maximum retry attempt limit
  - At least one matched entity describes exponential backoff as the retry strategy
  - The retry strategy applies to external API calls

---

## 2. `global-validation-substr` — group: confident-hit — category: standard — 55w

**Query:** validation

**Targets:** lesson:6247caba

**Ideal answer:** A search for 'validation' surfaces a decision lesson about the project CRUD REST API, covering input validation rules for POST and PUT endpoints: project_id must match a specific regex pattern (no leading or trailing hyphens, max 128 chars), duplicate project_id is caught via a Postgres 23505 error, and color inputs are validated against an allow-list.

**Must contain facts:**
  - The matched lesson describes validation for project CRUD REST endpoints (POST and PUT)
  - project_id must match a regex pattern with no leading or trailing hyphens and a maximum of 128 characters
  - Duplicate project_id is caught via Postgres error code 23505 and mapped to a 400 response
  - Color inputs are validated against an allow-list

---

## 3. `global-authentication-substr` — group: confident-hit — category: standard — 44w

**Query:** Authentication

**Targets:** chunk:80f588e6

**Ideal answer:** A search for 'Authentication' surfaces a documentation chunk describing the API's authentication model: all endpoints require an API key in the Authorization header using Bearer format, where the key is a SHA-256 hash scoped to a single project unless the key has admin role.

**Must contain facts:**
  - All endpoints require an API key in the Authorization header
  - The API key format is Bearer followed by a SHA-256 hash
  - Keys are scoped to a single project unless the holder has admin role

---

## 4. `global-max-retry-substr` — group: confident-hit — category: standard — 38w

**Query:** Max retry

**Targets:** guardrail:4abf93d6

**Ideal answer:** A search for 'Max retry' surfaces a guardrail lesson that enforces a maximum retry attempt limit of 3. This guardrail rule is stored as a lesson of type 'guardrail' and its title explicitly names the max retry policy.

**Must contain facts:**
  - The matched entity is a guardrail lesson enforcing a maximum retry limit
  - The enforced maximum number of retry attempts is 3

---

## 5. `global-architecture-substr` — group: confident-hit — category: standard — 46w

**Query:** Architecture Decision

**Targets:** chunk:512d7a46, chunk:79e04437

**Ideal answer:** A search for 'Architecture Decision' surfaces two documentation chunks that are both introductory headers for an Architecture Decision Records document. One is the bare introduction capturing key architectural decisions; the other extends it with the retry strategy decision (exponential backoff, 3 max attempts, 1-second base delay).

**Must contain facts:**
  - Both matched chunks are from an Architecture Decision Records document
  - At least one chunk contains the retry strategy as a recorded architectural decision
  - The retry strategy specifies exponential backoff with a maximum of 3 retry attempts

---

## 6. `global-pgvector-substr` — group: confident-hit — category: standard — 38w

**Query:** pgvector

**Targets:** chunk:0a02f1bd

**Ideal answer:** A search for 'pgvector' surfaces a documentation chunk about data storage, describing how lessons are persisted in PostgreSQL with the pgvector extension for embeddings. Each lesson has a 768-dimensional vector embedding; switching embedding models requires a full re-index.

**Must contain facts:**
  - Lessons are stored in PostgreSQL using the pgvector extension for embedding storage
  - Each lesson has a 768-dimensional vector embedding generated from its content
  - Switching embedding models requires a full re-index

---

## 7. `global-review-impl-substr` — group: confident-hit — category: standard — 49w

**Query:** review-impl

**Targets:** lesson:a0792c20

**Ideal answer:** A search for 'review-impl' surfaces a decision lesson recommending that the /review-impl skill be invoked by default during POST-REVIEW. Evidence from 6 consecutive sprints shows it found 21 additional issues (zero false positives) that self-review missed — particularly for auth, tenant isolation, destructive ops, non-trivial refactors, and test-only sprints.

**Must contain facts:**
  - The lesson recommends invoking /review-impl by default during POST-REVIEW
  - Evidence spans 6 consecutive sprints with 21 additional findings and zero false positives
  - /review-impl is most valuable for auth/credential handling, tenant isolation, destructive ops, and non-trivial refactors
  - Pure test-only sprints also benefit from /review-impl

---

## 8. `global-undici-substr` — group: confident-hit — category: standard — 55w

**Query:** undici

**Targets:** lesson:82e14086

**Ideal answer:** A search for 'undici' surfaces a workaround lesson: passing a userland undici Agent as a fetch dispatcher requires the userland version to exactly match the version Node bundles internally, since the Dispatcher interface changed between major versions. The mitigation is to pin undici to the caret of the bundled version and re-verify on Node upgrades.

**Must contain facts:**
  - The lesson is a workaround for undici dispatcher interop with Node's global fetch
  - The userland undici version must match the version Node bundles internally
  - A version mismatch produces an InvalidArgumentError about invalid onRequestStart method
  - The mitigation is to pin undici to the caret of the bundled version (e.g. ^6.21.2 for Node 23.11.1)

---

## 9. `global-workspace-substr` — group: coverage-probe — category: no_answer — 49w

**Query:** workspace

**Ideal answer:** [NO_ANSWER] A search for 'workspace' is a broad coverage-probe that matches across many entity types (lessons, MCP tokens, code references, config keys, etc.) — no single specific target is enforced for this query. It verifies the global search surface handles high-frequency generic terms without crashing or returning empty results.

**Must contain facts:** (none — no_answer category)

---

## 10. `global-miss-zephyr` — group: adversarial-miss — category: no_answer — 24w

**Query:** zephyr-ninja-pyramid-2026

**Ideal answer:** [NO_ANSWER] No entity in the corpus matches this fictional reference. The global search should return an empty result set rather than hallucinating a match.

**Must contain facts:** (none — no_answer category)

---
