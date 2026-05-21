# Sprint 15.11 — REVIEW-DESIGN round 1 (security-aware adversarial self-review)

**Date:** 2026-05-21
**Subject:** `docs/specs/2026-05-21-phase-15-sprint-15.11-design.md` rev 1 (hash `b1c43445df851cb26a372406204c37f198c8a618`)
**Method:** "Where does the authz model leak, contradict itself, or break existing behavior?"

---

## F1 (BLOCK) — Proxy verification posture contradicts the approved Q2 enforcement model

**Where:** §3.4 (castVote proxy verification) vs Q2 (CLARIFY).

**The problem:** Q2 (approved) states: *"Level-grant always-on; **body authz + key
uniqueness activate with `MCP_AUTH_ENABLED=true`**."* Proxy verification is part of
body authz (DEFERRED-017 Q3). But §3.4 makes the `proxy_not_granted` check run
**always** — including auth-off — with a hand-wave ("auth-off callers can grant freely
... Acceptable").

Two problems:
1. **Contradicts the approved posture.** Q2 puts body authz behind auth-on. §3.4
   puts proxy verification (a body-authz feature) always-on.
2. **Breaks auth-off backward compat.** Sprint 15.4 recorded `proxy_for` unverified
   (always accepted). Any existing auth-off test casting a vote WITH `proxy_for` set
   now fails with `proxy_not_granted` (no grant row exists in the test). The 15.4
   castVote tests likely include a proxy_for case.

**Recommended fix:** gate the `proxy_not_granted` check behind
`getEnv().MCP_AUTH_ENABLED`:
- Auth-off: `proxy_for` recorded unverified (15.4 behavior preserved — the dev
  single-operator trusted posture).
- Auth-on: verified against the `proxies` table.

This restores Q2 consistency AND preserves existing auth-off tests. The `proxies`
table + grant/revoke ops still ship (they're the mechanism); only the *enforcement*
gate aligns with Q2.

**Severity:** BLOCK — a direct contradiction with the approved CLARIFY + a silent
backward-compat break.

---

## F2 (WARN) — Migration 0063 unique-index creation can half-apply on duplicate active key-names

**Where:** §1 / §4.1 — `CREATE UNIQUE INDEX api_keys_active_name_uniq ON api_keys
(name) WHERE revoked = false`.

**The problem:** if two active keys already share a `name`, the index creation throws.
If migration 0063 is NOT run in a single transaction, the earlier DDL (proxies table,
topic_participants.granted_by, api_keys.created_by) would already be committed, leaving
a half-applied migration — the schema is inconsistent and re-running 0063 fails on
"column already exists".

**Recommended fix:**
- Confirm the migration runner wraps each file in BEGIN/COMMIT (most do). If so, a
  failure rolls back cleanly — document this assumption in the migration header.
- If the runner does NOT wrap, add explicit `BEGIN; ... COMMIT;` to 0063.
- Either way, add a pre-flight comment: "if this index fails, two active api_keys
  share a name — revoke the duplicate (`UPDATE api_keys SET revoked=true WHERE ...`)
  then re-run."

**Severity:** WARN — dev has few keys (low collision probability); but a half-applied
migration is painful. Make 0063 atomic.

---

## F3 (WARN) — Owner-permanence + authority mutual-demotion semantics under-specified

**Where:** §2.2 grantLevel (authorize-the-grantor + demotion).

**The problem:** §2.2 allows grantLevel to LOWER a level ("Sets/raises (or lowers)").
Combined with the owner-by-created_by rule, this creates under-documented dynamics:
1. **Owner permanence**: the owner is authorized by `created_by` regardless of their
   participant level. A hostile granted-authority Bob could demote owner Alice's
   participant row to `execution`, but Alice retains grant power (still owner). Is the
   owner intended to be a permanent root? (Defensible — like a repo owner — but must
   be stated.)
2. **Authority mutual demotion**: two authorities (Bob, Carol, both granted by owner)
   can demote each other. A race or a rogue authority could demote peers. Within the
   trusted authority set this is a management op, but it's an availability concern
   (authority A locks out authority B).

**Recommended fix:** document explicitly in DESIGN §2.2 + the security checklist:
- The owner (`created_by`) is a **permanent grant root** — cannot be stripped of grant
  power by demotion. This is intentional (bootstrap anchor).
- `authority` is a **mutually-trusted role**; an authority may demote a peer. The owner
  is the tiebreaker / recovery root if authorities deadlock. Mutual demotion among
  authorities is accepted (they are trusted by the owner who granted them).
- Optionally (defer): forbid demoting the owner's participant row below authority
  (cosmetic — owner power isn't level-derived anyway).

**Severity:** WARN — semantics are coherent but unstated; the security review needs
the explicit model to assess.

---

## Summary

| F# | Severity | Where | Action |
|----|----------|-------|--------|
| F1 | BLOCK | §3.4 proxy verification vs Q2 | FIX rev 2: gate proxy_not_granted behind MCP_AUTH_ENABLED |
| F2 | WARN | §1 migration index atomicity | FIX rev 2: make 0063 atomic + pre-flight note |
| F3 | WARN | §2.2 owner-permanence + mutual demotion | DOC rev 2: state the model explicitly |

**Verdict:** REJECTED — 1 BLOCK. Revise to rev 2.
