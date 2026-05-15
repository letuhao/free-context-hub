# Sprint 13.1 — Residual Findings Audit (post-COMMIT)

**Date:** 2026-05-15
**Auditor:** main session (self-audit before Sprint 13.2 begins)
**Commit reviewed:** `1e36c95` on `phase-13-dlf-coordination-amaw`

## Why this audit

Before broadening scope to Sprint 13.2 (TTL sweep + GUI), check for residuals from 13.1 that:
- AMAW review loops did NOT catch
- Were acknowledged but deferred (race_exhausted, AC13)
- Are deployment-state vs source-state gaps (code in repo but not running)
- Are documentation/spec drift not in the AMAW review scope

## Findings

### 🔴 R1 (MED) — Attempt-rate limit (20/min) per agent NOT implemented

**Spec:** `docs/phase-13-design.md:228` says: "max 10 active leases per (agent_id, project_id) **and max 20 claim_artifact attempts per (agent_id, project_id) per minute**".

**Code:** `src/services/artifactLeases.ts:98-110` only enforces lease COUNT (MAX_ACTIVE_LEASES_PER_AGENT=10). No attempts/min throttle.

**Impact:** A misbehaving agent can hammer `claim_artifact` at thousands/sec, each call paying full transaction cost. Adversary did not catch this — neither did Scope Guard's AC matrix because AC4 only covered the lease count limit.

**Why AMAW missed it:** the CLARIFY spec listed only one rate limit (lease count). The detailed Phase 13 design.md text mentioning attempts/min was outside the file Adversary read.

**Fix cost:** 30 min. Add `attempt_log` table or in-memory sliding window per (project_id, agent_id). Or accept-and-defer to 13.2 (worker-level).

---

### 🔴 R2 (HIGH) — Code committed but NOT deployed

**Evidence:**
- Docker image `free-context-hub-mcp:latest` created "About an hour ago" — BEFORE Sprint 13.1 BUILD started
- `curl GET /api/projects/free-context-hub/artifact-leases` → **404**
- MCP tools list does not include `claim_artifact`/etc. (verified via curl probe — couldn't parse but tools count signals)

**Impact:** Sprint 13.1 is "complete" per workflow-gate.sh but the running stack still has the OLD code. Anyone trying the new tools will get errors.

**Fix cost:** 2 min. `docker compose build mcp worker && docker compose up -d mcp worker`. Then verify the routes + tools.

**Why AMAW missed it:** Scope Guard verified code-level correctness but didn't run smoke tests against the deployed system. AC13 ("Manual MCP smoke") was marked PARTIAL with rationale "service-level tests cover the equivalent path" — true for logic but not for deployment.

---

### 🟡 R3 (MED) — No end-to-end smoke against deployed stack

**Issue:** Tests pass against direct service calls + real DB, but the MCP-tool → service path and REST → service path were never exercised after deployment. Type/route-mounting issues could pass tsc and unit tests yet fail at runtime.

**Mitigation paired with R2 fix:** after rebuild, run 5-6 curl + MCP probe calls covering each of: claim, conflict, release, renew, list, check, force-release.

**Fix cost:** 10 min (after R2 is fixed).

---

### 🟢 R4 (LOW) — schema_migrations registry missing 0048

**Evidence:**
```
SELECT id FROM schema_migrations WHERE id LIKE '0048%';
→ 0 rows
```

The table exists (created by my direct `psql DROP TABLE + CREATE TABLE` during BUILD-phase IMMUTABLE fix), but the migration runner's registry never recorded it.

**Impact:** Next mcp startup, `applyMigrations()` will re-read `0048_artifact_leases.sql` and re-apply it. The file uses `IF NOT EXISTS` so it's idempotent — no error, but cosmetic state mess.

**Fix cost:** 1 min. Either insert the row manually OR just let startup register it.

---

### 🟢 R5 (LOW) — `race_exhausted` code path untested

**Acknowledged in r2 design review:** the path is "statistically near-unhittable" — requires two consecutive winners to expire microseconds before our SELECT. Tests for it would be inherently flaky.

**Decision:** ACCEPT-AND-DOCUMENT in deferred items. No fix this sprint.

---

### 🟢 R6 (LOW) — Doc inconsistency: regex allows `_`, doc says "Hyphens for spaces"

**Evidence:** `docs/artifact-id-convention.md:14` says regex allows `[a-z0-9\-_]*` but doc Rule 2 says "Hyphens for spaces" (implying underscore is wrong).

**Impact:** Future maintainers may interpret as bug-or-feature.

**Fix cost:** 1 min. Either drop `_` from regex OR clarify doc that underscore is allowed but discouraged.

---

### 🟢 R7 (LOW) — `checkArtifactAvailability` doesn't validate artifact_id format

**Evidence:** `claim_artifact` validates both `artifact_type` (closed enum) AND `artifact_id` (regex). `checkArtifactAvailability` only validates type (after r2 fix). A caller passing malformed `artifact_id` (e.g., "FOO BAR") gets `{available: true}` — false negative.

**Impact:** Snapshot reads can silently miss conflicts if caller mis-formats the ID. Authoritative check (claim_artifact) still throws.

**Fix cost:** 2 min. Add format check to `checkArtifactAvailability` too.

---

## Summary

| Severity | Count | Recommended action |
|----------|-------|--------------------|
| HIGH | 1 | Fix now: rebuild + redeploy |
| MED  | 2 | Fix now or defer to 13.2 |
| LOW  | 4 | Fix opportunistically OR defer |

## Recommendations

**Fix in this session before Sprint 13.2:**
- R2: rebuild + restart (HIGH, 2 min)
- R3: smoke test against deployed stack (MED, 10 min)
- R1: attempt-rate limit (MED, 30 min) OR defer to Sprint 13.2

**Defer to Sprint 13.2:**
- R4-R7: low impact, can batch fix in 13.2 commit

**Documentation-only:**
- R5 → write to DEFERRED.md as known acknowledged behavior
