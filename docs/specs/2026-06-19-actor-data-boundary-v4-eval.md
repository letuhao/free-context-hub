# Scenario Evaluation — DESIGN v4 (code-grounded) + the decisive convergence finding

**Date:** 2026-06-19 · **Branch:** `feature/actor-data-boundary`
**Input:** `-design-v4.md` · **Method:** 3 cold-start red-teams, ~46 scenarios, each verified against
the as-built code.

## Bottom line — the 4th round did NOT converge to fewer findings; it revealed something sharper

I predicted round 4 would find finer, fewer bindings. **It didn't.** It found ~14 BREAKS and ~15
underspecified — comparable to round 3. But it revealed the decisive thing: **now that the spec is
detailed enough to make concrete claims about code, those claims are starting to be FALSE.** Four of
the BREAKS are *inaccurate code anchors* — v4 asserts things about the real code that aren't true:

1. **"reuse `cacheVersions.ts`"** — that table has a single-column `project_id` PK; the 4-scope model
   needs a *new* table. (can't reuse)
2. **"`VALIDATE CONSTRAINT` runs outside the migration txn"** — `applyMigrations.ts` wraps every file
   in one `BEGIN/COMMIT`; there is **no out-of-txn mechanism**. (un-implementable as written)
3. **instance minting "at `bearerAuth`/`resolveMcpCallerScope`"** — `bearerAuth` has no DB handle/
   response-header path and returns early on auth-off (where instances are still needed). (infeasible)
4. **refer-back drain "takes `refer_backs FOR UPDATE`"** — `closeTopic` Phase-2 is *deliberately
   lock-free* ("no FOR UPDATE on item rows… avoid deadlock"); consume can beat the drain. (false)

**This is the strongest possible evidence that paper design has run its course:** you cannot validate
a mechanism against code without writing code, so the more mechanism detail a doc adds, the more it
asserts about reality it hasn't run — and it drifts. Every BREAKS/UNDERSPECIFIED in round 4 was found
*by reading the real files*, and each closes with a failing test in BUILD, not another paragraph.

## Two genuine design *contradictions* (worth a small reconciliation regardless of when we build)
- **Flag-vs-appointment authority (S-B-10):** `resolveAuthority` returns the global root, which is a
  *flag* (`is_authority_root`); but the refer-back *consume* gate requires an authority *appointment*
  whose scope ⊇ the topic. On a minimal install where only the global root exists, **nobody can
  approve a refer-back.** §3.2-S-B9 and §3.3-S-B10 contradict. → consume gate must accept
  `is_authority_root OR a covering authority appointment`.
- **Governance predicate entanglement (S-B-15):** v4's `phase15_grants[rt,action] AND NOT
  codex_denies` assumes governance grants are *pure predicates the engine can read before deciding*.
  In the real `motions.ts`/`requests.ts` the checks are **entangled with the mutation** (tally checks
  status+deadline *while* it flips state; `tally` has no actor predicate at all). → either extract pure
  predicate fns (net-new refactor) or have the engine interpret the lifecycle fns' typed result codes.

## Other genuine new BREAKS (not anchor drift)
- **on_behalf_of never checks the *authenticating* principal's status** — P1 gates only `actor` (=
  on_behalf_of target); a suspended proxy/worker credential keeps acting. One-line fix (`AND
  principal_id=principal`), real auth bypass.
- **on_behalf_of self-mutates `kind`** — the kind trigger binds to the DB-session actor (worker), not
  the engine actor → a job can self-verify an agent to human. Fix: thread engine actor via GUC; forbid
  `principal:verify` on the on_behalf_of path.
- **Seal trigger magic-password moved one indirection up** — the GUC now must reference an *approved*
  `re_consecrations` row, but nothing gates inserting/approving that row, and it's *replayable* (no
  consume). The C1 headline is still not closed — it relocated.
- **NULL-project job + on_behalf_of → unrestricted scope** (the v3 launder reborn on the project axis).
- **Genesis** — root mints a second human to suspend the Council (causal audit keyed to one id is
  defeated); and the genesis `assertGrantSubset` superset has *no genesis-only gate* → root is an
  unconstrained grantor forever. Group-A #5 not closed.
- **`system:*` actor reachability** — if `system:custodian`/etc. are credentialable, the owner
  fast-path makes them master keys to quarantined private data. Fix: forbid api_keys on `kind='system'`.
- **emitChain misses `applyMotionToStep`** — a 3rd chain site stamps `created_by='motion:<id>'`; v4
  patched only 2 of ≥3.
- **Append-only immutability is app-level only** — `coordination_events` has no DB immutability
  trigger; §11's "immutable because we added a write-once column" overstates it (the column isn't
  enforced write-once either). Fix: honest scoping OR a real trigger.
- **Flip gate replays only *observed* shapes** → unobserved-shape flip-on-absence (S-C3 narrowed, not
  closed). Fix is cheap and *actually closes it*: enumerate the **bounded** shape space (≤144/action)
  and replay every combination, not just observed ones.

## Underspecified (binding edges → BUILD/TDD): topic_id inheritance/immutability; composite re-key vs
recurring `system:*` literals; confinement re-point; dynamic action strings; chain_depth at the
motion→task boundary; per-tuple cap value/reset; per-call read fan-out + perf budget; observed_shapes
per-access write hotspot; DEFAULT-sentinel masking + orphan reconciliation; mint worker-parity/secret
channel; kill/mode flag seeding at bootstrap; depth-truncation invalidation edge.

## Confirmed HANDLED (held against code): assertGrantSubset sibling-topic + wildcard union;
carried-tally SELECT omission accurate (the fix is right); lapsed-motion = no chain (moot);
authorizeMany status-once parity; per-process version-keyed cache survives the stateless transport
(saves the closure load); H4 opaque-id erasure; last-root retire trigger.

## Verdict per cluster (does v4 close it at the binding level?)
| Cluster | v4 status |
|---|---|
| C1 sealing | **NOT closed** — magic-password relocated up one indirection (S1/S6); + app-level-only immutability |
| C2 instance fence | **PARTIAL** — worker-mint-only closes the fence, but the mint *location* is infeasible as anchored |
| C3 authority root | **NOT closed** — flag-vs-appointment contradiction; genesis sockpuppet + unconstrained superset |
| C4 on_behalf_of | **PARTIAL** — wiring direction right (emitChain), but NULL-project launder + un-gated principal status + 3rd chain site + self-kind |
| C5 governance | **NOT closed at binding** — predicates entangled with mutation in real code |
| C6 scope coverage | **PARTIAL** — topic axis works only for task-linked knowledge; inheritance/immutability unspecified |
| C7 no-escalation | **PARTIAL** — confinement re-point gap; genesis superset bypass |
| C8 invalidation | **PARTIAL** — correct design; inaccurate `cacheVersions` anchor; read fan-out; shapes hotspot |
| H1/H2 lifecycle/refer-back | **PARTIAL** — drain "FOR UPDATE" false vs lock-free closeTopic; consume-vs-drain winner inverted |
| H3 flip gate | **NOT closed** — shape replay narrowed S-C3, didn't close; fix = enumerate bounded shape space |
| H4 retention | **CLOSED** |

## The honest recommendation (unchanged, now strongly evidenced)
**Stop the paper loop and BUILD Phase A.** The 4th round's defining result — *the spec now makes false
claims about code* (4 inaccurate anchors) — is proof that the remaining work cannot be done on paper:
it requires writing code and running tests against the real `applyMigrations`, `bearerAuth`,
`closeTopic`, `cacheVersions`, `motions.ts`. A v5 will (a) find the next binding level AND (b) add more
anchor drift.

Proposed path:
1. **A ~1-page pre-build reconciliation** of the *genuine design contradictions only* (flag-vs-
   appointment consume gate; governance-predicate strategy: extract-pure-fns vs interpret-result-codes;
   on_behalf_of must gate BOTH principal and actor status; `system:*` are non-authenticable sentinels;
   seal needs the re_consecrations row gated + one-shot). These are decisions, not mechanisms.
2. **BUILD Phase A (identity)** TDD-first, with the mandatory per-phase cold-start adversary review.
   Every other v4-eval item becomes an **acceptance criterion with a failing test written first** —
   the seal-replay test, the on_behalf_of-status test, the VALIDATE-outside-txn test, the
   instance-minting test, the flip-gate-unobserved-shape test. These are exactly the tests that close
   the round-4 findings, against real code.
