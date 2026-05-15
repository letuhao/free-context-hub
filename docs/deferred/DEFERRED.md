# Deferred Items

<!-- Managed by Scribe. Do not edit manually. -->
<!-- Next ID: 008 -->

## DEFERRED-007

- **What:** MCP tool calls that use `z.discriminatedUnion` in their `outputSchema` return error `"Cannot read properties of undefined (reading '_zod')"` to the client, even when the underlying handler executed successfully and the side effects landed. Confirmed affects: `claim_artifact`, `check_artifact_availability`, `submit_for_review`, `list_review_requests` (any tool added during Phase 13 using the discriminated-union output pattern). The error originates from the MCP SDK's output validation step, after the handler has returned.
- **Why deferred:** Latent regression — these tools' tests pass at the service level (bypass HTTP/MCP transport) and `tools/list` returns them correctly, so the issue was invisible until Sprint 13.4's end-to-end smoke directly invoked `tools/call`. The side effects DO land (verified: submit_for_review created the review_requests row and moved the lesson to pending-review), but clients receive an error response and may retry, causing double-execution risks. Sprint 13.4's GUI uses REST endpoints (not MCP), so its functionality is unaffected. Likely root cause is a version mismatch between `@modelcontextprotocol/sdk` and `zod/v4` after node_modules rebuild between sessions.
- **Trigger condition:** Sprint 13.5 if it adds MCP tools with discriminated unions; OR any agent integration testing that calls these tools via MCP; OR Sprint 13.7 E2E plan.
- **Estimated size:** S-M (likely a version pin or schema-shape adjustment; investigate via MCP SDK changelog).
- **Priority:** HIGH — silent client-facing failures on Phase 13 MCP tools. The side effects landing without clear client acknowledgement is the worst combination (double-submit risk if clients retry).
- **Session deferred:** 2026-05-15
- **Sessions open:** 1
- **Status:** OPEN
- **Source:** Sprint 13.4 deploy-state smoke discovered the regression; verified affects Sprint 13.1 tools too (not my Sprint 13.4 regression — pre-existing latent).
- **Workaround:** Use REST endpoints (`/api/projects/:id/review-requests`, `/api/projects/:id/artifact-leases`) which do not exhibit this issue.

---

## DEFERRED-006

- **What:** Integration-level smoke verification of `requireScope` 403 path under `MCP_AUTH_ENABLED=true`. Sprint 13.2 design Section 7 specified a 4-step smoke (steps 10a-10d) using a `docker-compose.auth-test.yml` override to verify: (10a) admin env-var token → 200 on force-release; (10b) writer DB key → 403 on force-release; (10c) reader key → 403; (10d) cross-tenant admin scope → 403. The Sprint 13.2 implementation has the unit-level coverage (requireScope.test.ts, me.test.ts) but the docker-compose override was never created and the end-to-end smoke was never run. Only the unauth-mode smoke ran in POST-REVIEW.
- **Why deferred:** Setting up a separate docker-compose profile + seeding DB-backed API keys for the smoke is moderate effort that overlaps directly with the Sprint 13.7 E2E test plan. Combining the work in 13.7 is cleaner than duplicating it twice.
- **Trigger condition:** Sprint 13.7 E2E test plan implementation. Tests should cover: env_token vs db_key paths on /api/me; requireScope 403 on cross-tenant force-release; requireRole 403 on writer attempting admin route. Cover all three identity types from the v4 design.
- **Estimated size:** S-M (docker-compose override + seed script + 4-6 e2e test cases).
- **Priority:** MED — backend code is reachable for cross-tenant exploits today (mitigated by the GUI + unit tests). Production deployments using MCP_AUTH_ENABLED=true should be advised to wait for 13.7 E2E sign-off before depending on scope enforcement.
- **Session deferred:** 2026-05-15
- **Sessions open:** 1
- **Status:** OPEN
- **Source:** Sprint 13.2 post-sprint audit (residual R2). Adversary noted: "cross-tenant force-release 403 path has zero integration-level verification — only unit-mocked tests at requireScope.test.ts."

---

## DEFERRED-005

- **What:** GUI production build (`npm run build` AND `docker compose up -d --build gui`) fails on Geist font resolution: `Module not found: Can't resolve '@vercel/turbopack-next/internal/font/google/font'` from `[next]/internal/font/google/geist_*.module.css`. Affects Next.js 16.2.1 + Turbopack default build path. Reproduced 2026-05-15 during Sprint 13.2 POST-REVIEW deploy-state smoke.
- **Why deferred:** Pre-existing issue (the running gui container at 4h uptime predates this regression). Sprint 13.2's tsc check is clean and the new code follows existing component patterns. Fixing the Geist resolution is a Next.js / Turbopack dependency issue outside Sprint 13.2's scope.
- **Trigger condition:** Next planned GUI work that requires a fresh container build (e.g., Sprint 13.4 or 13.6 in the current Phase 13 longrun); OR any urgent GUI hotfix that needs a deploy.
- **Estimated size:** S-M (likely a `next` version pin, font module installation, or Turbopack opt-out config flag).
- **Priority:** MED — blocks GUI deploys; running container survives but won't pick up Sprint 13.2's ActiveWorkPanel until resolved. The Sprint 13.2 backend ships fine (sweep, /api/me, requireScope all live).
- **Session deferred:** 2026-05-15
- **Sessions open:** 1
- **Status:** RESOLVED 2026-05-15 (longrun session 2 start)
- **Source:** Sprint 13.2 POST-REVIEW deploy-state smoke (Mitigation B step F1) discovered local AND docker GUI builds both fail with identical error.
- **Resolution:** Root cause was `next/font/google` requiring network access to fonts.gstatic.com at build time; the build host couldn't reach it (firewall/proxy). Replaced `next/font/google` with the official `geist` npm package (v1.7.0) which ships the font files locally. Updated `gui/src/app/layout.tsx`: import `GeistSans`/`GeistMono` from `geist/font/sans` and `geist/font/mono` respectively. Build now succeeds (24 routes prerendered). GUI container rebuilt + redeployed; Sprint 13.2's ActiveWorkPanel verified live in browser via curl on /agents.

---

## DEFERRED-004

- **What:** Backend tenant-scope enforcement on admin-role endpoints OTHER than `DELETE /api/projects/:id/artifact-leases/:leaseId/force`. The force-release route now has `requireScope('id')` (resolved 2026-05-15 in Sprint 13.2). Remaining admin endpoints — to be enumerated — may still allow a project-scoped admin key to act outside its scope. Examples to audit: any admin route under `/api/lesson-types`, `/api/api-keys`, `/api/groups` admin operations, etc.
- **Why deferred:** Sprint 13.2 surfaced this gap via the force-release UX work. The full audit + middleware rollout across all admin endpoints is broader than Sprint 13.2's scope. The new `requireScope` middleware (`src/api/middleware/requireScope.ts`) is the pattern to apply.
- **Trigger condition:** Sprint 13.7 E2E test design includes cross-tenant admin attempts on all admin endpoints; OR any security audit of the access-control layer.
- **Estimated size:** S (apply `requireScope` to ~3-5 admin routes + tests).
- **Priority:** MED — exploitable but requires a scoped-admin key; low likelihood in single-tenant deployments (the common case today). Force-release route is now safe.
- **Session deferred:** 2026-05-15
- **Sessions open:** 1
- **Status:** PARTIAL (force-release closed; broader rollout pending)
- **Source:** Sprint 13.2 design review r2 (docs/audit/findings-sprint-13.2-design-r2.md NEW FINDING 1) and code review r1 (docs/audit/findings-sprint-13.2-code-r1.md FINDING 1).
- **Partially resolved by:** Sprint 13.2 commit (TBD — pending Sprint 13.2 COMMIT phase). `requireScope` middleware added with 6 unit tests + applied to force-release route.

---

## DEFERRED-003

- **What:** `race_exhausted` code path in `src/services/artifactLeases.ts:74-82` (claimArtifact retry loop) is not covered by unit tests. The path triggers when two concurrent 23505-race winners both expire microseconds before our re-SELECT — statistically near-unhittable under MAX_TTL=240min defaults.
- **Why deferred:** Test would require deterministic control over Postgres transaction commit timing + system clock manipulation. Disproportionate setup cost for a near-unhittable rare path. Sprint 13.7 (E2E suite) can stress-test with synthetic short TTLs (e.g., 1-second leases) where the race window is naturally wider.
- **Trigger condition:** Sprint 13.7 E2E test design. OR: production observability shows the path firing (we'd log it via `logger.warn` for visibility).
- **Estimated size:** S (test scaffolding + 1 test)
- **Priority:** LOW
- **Session deferred:** 2026-05-15
- **Sessions open:** 1
- **Status:** OPEN
- **Source:** Sprint 13.1 post-audit (`docs/audit/sprint-13.1-residuals.md` R5); design review r2 acknowledged "exceedingly rare" but didn't write a deferred entry.

---


## DEFERRED-001

- **What:** Phase 14 — Per-project embedding/distillation model routing. Add `embedding_model` and `distillation_model` columns to `project_sources` (or new `project_model_config` table). Modify `src/services/embeddings.ts` and chat-model callers to select model from project config.
- **Why deferred:** ~~Out of Phase 13 scope; user chose option C (Phase 14 defer).~~
- **Trigger condition:** N/A
- **Estimated size:** L
- **Priority:** N/A
- **Session deferred:** 2026-05-14
- **Sessions open:** 1
- **Status:** ABANDONED
- **Abandon reason:** Session 2026-05-14 (same day) — user reconsidered and chose **global swap pattern** instead of per-project routing. Quote: "tôi đề nghĩ chúng ta nên làm phase 14 trước luôn vì nó không tốn nhiều time ... chúng ta sẽ chuyển hoàn toàn qua nvidia/nemotron-3-nano, text-embedding-bge-m3". Per-project routing complexity not needed; both projects move together to the new model stack. The new Phase 14 scope is documented as an active spec (see `docs/specs/2026-05-14-phase-14-model-swap-spec.md`), not a deferred item.
- **Source:** Session 2026-05-14 — initial decision then reversed within same session.

---

## DEFERRED-002

- **What:** `mxbai-embed-large-v1` has 512-token context window. With `CHUNK_LINES=120` (~600-1000 tokens/chunk), code chunks routinely get truncated. LM Studio logs confirm: "Number of tokens in input string (634) exceeds model context length (512). Truncating to 512 tokens." Also: "tokenizer.ggml.add_eos_token should be set to 'true' in the GGUF header." This means Phase 12 measurement work (sprints 12.1c through 12.1h) was conducted on systematically truncated embeddings. Baselines in `docs/qc/baselines/*` reflect degraded vectors, not the embedding model's full capability.
- **Why deferred:** Resolution requires model swap to `bge-m3` (8192 ctx, same 1024-dim). Resolution path now active via Phase 14 (global swap pattern). Item kept OPEN until Phase 14 actually ships and bge-m3 is in production for both `free-context-hub` and `phase-13-coordination` projects.
- **Trigger condition:** Phase 14 ships (`.env` updated to `EMBEDDINGS_MODEL=text-embedding-bge-m3`, `reembedAll` script run against both projects, smoke test confirms search quality is intact). At that point Scribe sets Status to RESOLVED with sprint reference.
- **Estimated size:** M (re-embed in place; preserves all data)
- **Priority:** MED
- **Session deferred:** 2026-05-14
- **Sessions open:** 1
- **Status:** RESOLVED
- **Resolved at:** 2026-05-15
- **Resolved by:** Phase 14 model swap (commits TBD — pending session close). `.env` switched to `EMBEDDINGS_MODEL=text-embedding-bge-m3` (8192 ctx, same 1024 dim). `src/scripts/reembedAll.ts` ran against both projects: free-context-hub (2069 chunks + 638 lessons + 11 document_chunks all OK) and phase-13-coordination (3334 chunks + 2 lessons + 0 document_chunks all OK). Smoke tests pass for search_lessons / search_code_tiered / reflect / add_lesson distillation. The 512-token truncation that systematically degraded Phase 12 measurement work is now eliminated — bge-m3's 8192-token context window covers our 120-line chunks (~600-1000 tokens) with margin.
- **Source:** Session 2026-05-14 — user message with LM Studio log + mxbai-embed-large-v1 model name. Resolution active via Phase 14.

---
