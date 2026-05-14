# Postgres Advisory Lock Registry

Postgres advisory locks share a single 64-bit signed-integer namespace across the entire database. Subsystems must coordinate on key allocation to avoid collisions. This document is the authoritative registry.

## Allocation policy

- Each subsystem chooses a stable string literal as its key namespace.
- The actual int64 key is derived deterministically: `signed_int64(first 8 bytes of SHA256(literal))`.
- The literal must be repository-unique. Convention: `phase-<N>.<feature-name>` or `<service-name>.<purpose>`.
- New entries MUST be added to this file in the same PR that introduces the lock usage. A grep for `pg_advisory_lock` / `pg_try_advisory_lock` / `pg_advisory_xact_lock` should match exactly the entries here.

## Registry

| Key literal | Derived bigint (decimal) | Subsystem | File | Purpose |
|---|---|---|---|---|
| `phase-13.leases-sweep` | (computed at module init from sha256) | `src/services/sweepScheduler.ts` | leases.sweep job scheduler | Leader election for periodic `leases.sweep` enqueue (15-min cadence) across N replicas. Held only across the enqueue, not the actual sweep. |

## Adding a new lock

1. Choose a unique literal following the convention.
2. Run `node -e "console.log(BigInt('0x' + require('crypto').createHash('sha256').update('YOUR_LITERAL').digest('hex').slice(0,16)))"` to preview the derived key. Confirm it doesn't collide with any entry above (extremely unlikely with 64-bit space but verifiable).
3. Add a row to this table.
4. In code, derive the key the same way (see `sweepScheduler.ts` for the pattern).
5. Write a unit test asserting the key equals the SHA256-derivation.

## Auditing

Grep command for existing usage:
```bash
grep -rE "pg_(try_)?advisory(_xact)?_lock" src/
```
Each match should correspond to a row in this registry.
