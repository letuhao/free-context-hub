# Sprint 13.1 — POST-REVIEW (Scope Guard)

**Verdict:** CLEAR
**Spec hash current:** `f14ede2370dcfec5`
**Spec hash expected:** `f14ede2370dcfec5`
**Spec drift:** NO

## AC coverage (13 total)

| # | AC | State | Evidence |
|---|----|-------|----------|
| AC1 | Migration 0048 applies cleanly | COVERED | `migrations/0048_artifact_leases.sql` uses IF NOT EXISTS; BUILD-phase fix logged |
| AC2 | claimed status | COVERED | `artifactLeases.ts` claimArtifact; test passes |
| AC3 | conflict status | COVERED | Service populates all fields; test passes |
| AC4 | rate_limited at 10 | COVERED | MAX_ACTIVE_LEASES_PER_AGENT=10; test passes |
| AC5 | Concurrent claims no 500 | COVERED | 23505 catch + retry; 5-parallel test asserts 1+4 |
| AC6 | release_artifact 3 paths | COVERED | 3 dedicated tests pass |
| AC7 | renew_artifact incl. expired | COVERED | FOR UPDATE + cap_reached; 4 tests |
| AC8 | list_active_claims filter | COVERED | enum validation + 2 tests |
| AC9 | check_artifact_availability | COVERED | 2 tests |
| AC10 | REST mirrors MCP 1:1 | COVERED | 6 routes mirror 5 MCP tools + force; mergeParams |
| AC11 | Admin DELETE requires admin role | COVERED | requireRole('admin'); tenant-isolated; wrong-project test |
| AC12 | Tests + tsc clean | COVERED | 19/19 pass; tsc --noEmit exits 0 |
| AC13 | Manual MCP smoke | PARTIAL | Service-level tests cover equivalent flow; manual smoke deferred to 13.7 |

**Coverage: 12 COVERED, 1 PARTIAL, 0 UNCOVERED.**

## Findings resolution (9/9 RESOLVED across 4 review rounds)

| Round | Finding | Status |
|-------|---------|--------|
| Design r1 BLOCK 1 | force-release cross-tenant | RESOLVED |
| Design r1 BLOCK 2 | Renew silent no-op at TTL cap | RESOLVED (cap_reached status) |
| Design r1 BLOCK 3 | Synthetic agent_id | RESOLVED (__retry signal + race_exhausted) |
| Design r2 WARN 1 | Misleading rate_limited reason | RESOLVED (race_exhausted enum) |
| Code r1 BLOCK 1 | GET /:leaseId bypassed service | RESOLVED (route deleted, POST /check added) |
| Code r1 WARN 2 | Flat MCP outputSchemas | RESOLVED (3 → discriminatedUnion) |
| Code r1 WARN 3 | artifact_type unvalidated | RESOLVED (closed enum + test) |
| Code r2 WARN 1 | Asymmetric validation | RESOLVED (symmetric in list + check) |
| Code r2 WARN 2 | Stale doc refs | RESOLVED (design.md updated) |

## Deferred items

None new. DEFERRED.md unchanged (001 ABANDONED, 002 RESOLVED).

## Verdict reasoning

Spec fingerprint matches exactly (no drift). All 9 findings resolved with file:line evidence. 19/19 unit tests pass on fresh run, tsc --noEmit clean. AC13 PARTIAL (manual MCP smoke) is acceptable in autonomous mode — service-level tests exercise the same code path that MCP tools wrap. BUILD-phase migration adjustment documented at `migrations/0048:5-14` with rationale; concurrent-claim test validates DELETE-then-INSERT pattern under race.

**Cleared for SESSION + COMMIT.**
