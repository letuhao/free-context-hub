# Sprint 15.11 — Security-framed adversarial review (POST-REVIEW)

**Date:** 2026-05-21
**Mandate:** guardrail `5c0b7b25` — sprints adding an authorization primitive require
a security-framed cold-start adversarial review.
**Framing:** hostile actor trying to escalate privilege, forge identity, or subvert
the governance authz model. Walks the DESIGN §10 checklist + adversarial probes.
**Subject:** the shipped Sprint 15.11 code (level-grant chain, proxies, body authz,
key provisioning) on `phase-15-sprint-15.11`.

## §10 checklist verdicts

### 1. A non-owner cannot self-assert authority at join — ✅ DEFENDED
`joinTopic` (`topics.ts`) computes `isOwner = actorId === topicRow.created_by`. A
non-owner passing `level !== 'execution'` → `BAD_REQUEST` (`level_grant_required`).
Verified by topics.test.ts AC1 + live smoke (`400 level_grant_required`). The
participant row is inserted with `isOwner ? level : 'execution'` — even a bypass of
the throw (impossible — it precedes the insert) would still seat execution.

### 2. A non-owner / non-authority cannot grantLevel — ✅ DEFENDED
`grantLevel` step 4: authorized iff `granted_by === ownerId` OR the grantor's
participant `level === 'authority'`. A coordination/execution grantor → `not_authorized`.
Verified AC5 + live smoke (coordination grantor → `not_authorized`).

### 3. No actor can self-grant — ✅ DEFENDED
`grantLevel` step 3: `granted_by === actor_id` → `self_grant_forbidden`, BEFORE the
authorization check (so even an authority cannot self-raise — though they're already
at the top). Verified AC6 + live smoke.

### 4. decideStep cannot be driven above an actor's granted level — ✅ DEFENDED
`decideStep` (unchanged) authorizes by `topic_participants.level === target_office`.
The level is now authoritative (granted, not self-asserted). Combined with §1+§2+§3,
an actor's level reflects a real grant from the owner/authority chain. A request step
targeting `authority` can only be decided by an actor the owner granted authority.

### 5. A non-member cannot vote; a proxy without a grant cannot cast — ✅ DEFENDED
`castVote`: principal must be a `body_members` row (`not_member`). Proxy: when
`proxy_for` set AND `MCP_AUTH_ENABLED`, verifies a `proxies` row (principal=actor_id,
proxy=proxy_for) else `proxy_not_granted`. Verified proxies.test.ts (auth-on rejects
ungranted; accepts granted). Auth-off preserves 15.4 unverified behavior (documented
trusted-dev posture, Q2).

### 6. createBody / addBodyMember require admin (auth-on) — ✅ DEFENDED
Routes raised to `requireRole('admin')`. Auth-off: `requireRole` is a no-op (no role) —
the trusted single-operator dev posture (Q2). Auth-on: a writer key → 403. The
service layer is intentionally ungated (tests call it directly) — the gate is the
route, consistent with the existing role model.

### 7. Actor-identity uniqueness holds; key-count limit enforced — ✅ DEFENDED
Partial unique index `api_keys_active_name_uniq (name) WHERE revoked=false` — one
active key per name (DB-enforced; 23505 → `duplicate_active_key_name`). Per-operator
limit: `createApiKey` counts active keys by `created_by` vs `MAX_KEYS_PER_CREATOR`.
Verified apiKeys.test.ts (duplicate rejected; limit enforced; revoke frees a slot;
legacy NULL created_by uncounted).

### 8. The one-human-two-keys residual is documented + bounded — ✅ ACCEPTED-BOUNDED
DESIGN §8.2: a single human controlling two legitimately-distinct authorized keys
(e.g., owner Alice + granted-authority Bob, both same human) can drive a multi-level
flow. This is fundamentally a human-trust problem — you cannot cryptographically
prevent one human from controlling two principals. **Bounded by:** (a) the
per-operator key-count limit caps how many identities one operator mints; (b) the
level-grant chain means even N keys can't self-grant authority — the owner must
grant each, leaving an audit trail (`granted_by` + `topic.level_granted` events);
(c) actor-identity uniqueness removes name ambiguity. The residual is the accepted
boundary, explicitly documented, not silently open.

## Adversarial probes (beyond the checklist)

### P1 — Can a hostile authority lock out the owner? — DEFENDED (owner-permanence)
A granted authority Bob demotes owner Alice's participant row to execution. Does Alice
lose grant power? NO — `grantLevel` authorizes the owner by `created_by`, INDEPENDENT
of participant level. Verified topics.test.ts "owner-permanence" test: a demoted
owner still grants. The owner is the permanent recovery root.

### P2 — Can a proxy grant be forged by a third party? — DEFENDED
`grantProxy` requires `granted_by === principal` — only the principal delegates their
own vote. A third party (`granted_by ≠ principal`) → `not_authorized`. Verified
proxies.test.ts.

### P3 — Can a closed/closing topic still be granted on? — DEFENDED
`grantLevel` rejects `topic_closed` on closing/closed status (FOR UPDATE read).
appendEvent would also reject on closed. No grant lands on a sealed topic.

### P4 — Lock-order / deadlock with concurrent grant + decide? — SAFE
`grantLevel` locks topic row (FOR UPDATE) → participant rows. `decideStep` reads
participant level with a plain SELECT (no lock). No ABBA cycle. A grant landing
mid-decide yields either old or new level — both legitimate at their instant
(DESIGN §8.1).

### P5 — Can the migration's unique index be bypassed by a race? — SAFE
The DB-level partial unique index is the enforcement; the service-layer count +
23505 catch are belt-and-suspenders. Two concurrent createApiKey with the same name:
one wins the unique index, the other gets 23505 → `duplicate_active_key_name`.

## Verdict

**CLEAR.** All 8 §10 checklist items defended; 5 adversarial probes defended or
bounded-and-documented. The one-human-two-keys residual is an explicitly accepted
trust boundary (not a defect). No BLOCK or WARN findings.

The Phase 15 authorization model (DEFERRED-015/016/017) is sound: levels are granted
through an owner-rooted chain (not self-asserted), bodies are admin-gated, proxies are
principal-authorized, and key identities are unique + bounded. Safe to enable
`MCP_AUTH_ENABLED=true` with respect to the coordination authz surface (the HARD
pre-prod trigger is satisfied).

**Note (out of scope, carried):** DEFERRED-009 (topic-scope tenant authz — a writer
key for project A acting on project B's topic by topic_id) is a SEPARATE tenant-
isolation concern, not closed by 15.11. It remains OPEN. This sprint closed the
*coordination-role* authz (who may hold a level/credential/vote), not *tenant-scope*
authz (which project's topics a key may touch).
