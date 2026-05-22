# Sprint 15.11 — QC: AC coverage matrix

**Date:** 2026-05-21
**Design:** rev 2 hash `7226df2e99412ba81dc03e31cd7cbed891edcae3`
**Tests:** 680/680 green; tsc clean; live smoke ✓; security review CLEAR.

| AC | Description | Test | Status |
|----|-------------|------|--------|
| AC1 | joinTopic non-owner forced execution / non-execution rejected | topics.test.ts 15.11 AC1 (×2) + live smoke | ✅ |
| AC2 | owner first join honors authority (bootstrap) | topics.test.ts 15.11 AC2 | ✅ |
| AC3 | owner grants → topic.level_granted | topics.test.ts 15.11 AC3 | ✅ |
| AC4 | existing authority can grant | topics.test.ts 15.11 AC4 | ✅ |
| AC5 | coordination/execution cannot grant → not_authorized | topics.test.ts 15.11 AC5 | ✅ |
| AC6 | self-grant forbidden | topics.test.ts 15.11 AC6 | ✅ |
| AC7 | decideStep above granted level impossible | DEFENDED via §1+§4 security review (level now authoritative) | ✅ |
| AC8 | createBody requires admin (auth-on) | route raised to requireRole('admin'); security review §6 | ✅ |
| AC9 | addBodyMember requires admin | route raised; security review §6 | ✅ |
| AC10 | veto_holders cap | decisionBodies.ts cap (≤64 + ≤256 each) | ✅ |
| AC11 | actor-identity uniqueness | apiKeys.test.ts duplicate_active_key_name | ✅ |
| AC12 | backward compat — migration backfills granted_by NULL; existing levels preserved; test-helper migration 657→680 green | T13 (subagent, verified) | ✅ |
| AC13 | security scenario suite | findings-sprint-15.11-security-review.md (8 checklist + 5 probes, all defended) | ✅ |

Plus extra coverage:
- Proxies: grant (principal-only), revoke, list, body_not_found, principal_not_member,
  self-proxy reject — proxies.test.ts (8 tests).
- castVote proxy verification gated behind MCP_AUTH_ENABLED (auth-on rejects ungranted;
  auth-off records unverified) — proxies.test.ts.
- Key provisioning: created_by tracking, duplicate-name reject, revoke frees name,
  per-operator limit, revoke frees slot, legacy NULL uncounted — apiKeys.test.ts (6).
- Owner-permanence: a demoted owner retains grant power — topics.test.ts.

## Spec fingerprint vs implementation

| Item | DESIGN ref | Implementation | Drift |
|---|---|---|---|
| Migration 0063 | §1 | applied (atomic per applyMigrations.ts) | none |
| joinTopic owner-only level | §2.1 | topics.ts isOwner gate | none |
| grantLevel | §2.2 | topics.ts grantLevel | none |
| proxies grant/revoke/verify | §3.3/§3.4 | proxies.ts + castVote gated auth-on (F1) | none |
| body authz admin gate | §3.1 | routes/motions.ts requireRole('admin') | none |
| veto cap | §3.2 | decisionBodies.ts | none |
| key uniqueness + limit | §4 | apiKeys.ts + index | none |
| proxy posture gated auth-on | §3.4 rev 2 F1 | getEnv().MCP_AUTH_ENABLED gate | none |
| escalated_to field (note: 15.11 didn't touch the 15.10 escalation field) | n/a | n/a | n/a |

**No spec drift.**

## Deferred items

| Item | Status |
|------|--------|
| DEFERRED-015 | RESOLVED — level-grant chain |
| DEFERRED-016 | RESOLVED — actor-identity uniqueness + per-operator key limit |
| DEFERRED-017 | RESOLVED — body admin-gate + proxies grant/verify + veto cap |
| DEFERRED-009 | still OPEN — tenant-scope authz (separate concern, noted in security review) |
| DEFERRED-010 | still OPEN — replayEvents pagination |

## Verdict

**CLEAR.** 13/13 ACs covered; security review CLEAR (8 checklist + 5 probes); no spec
drift. DEFERRED-015/016/017 resolved. Ready for POST-REVIEW human gate.
