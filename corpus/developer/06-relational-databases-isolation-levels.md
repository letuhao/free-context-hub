---
id: corpus/developer/relational-databases/isolation-levels
domain: developer
subdomain: relational-databases
topic: isolation-levels
sources:
  - "PostgreSQL docs — Transaction Isolation (read 2026-06-16, OPEN, paraphrased)"
  - "Wikipedia — Isolation (database systems) (read 2026-06-16, CC-BY-SA, paraphrased)"
license_posture: own-words-paraphrase
status: drafted
last_reviewed: 2026-06-16
---

# Transaction isolation levels

## The four SQL-standard levels
The SQL standard defines four isolation levels, from weakest to strongest:
**READ UNCOMMITTED → READ COMMITTED → REPEATABLE READ → SERIALIZABLE.** Higher isolation prevents
more concurrency anomalies but reduces concurrency/throughput — it is a correctness-vs-performance
dial.

## The three read phenomena and what each level prevents (per the SQL standard)
- **Dirty read** — reading data written by a concurrent *uncommitted* transaction.
- **Non-repeatable read** — re-reading a row and finding it *changed* by another committed transaction.
- **Phantom read** — re-running a range query and finding *new/removed rows* matching the predicate,
  due to another committed transaction.

| Level | Dirty | Non-repeatable | Phantom |
|---|---|---|---|
| READ UNCOMMITTED | allowed | allowed | allowed |
| READ COMMITTED | prevented | allowed | allowed |
| REPEATABLE READ | prevented | prevented | **allowed (per standard)** |
| SERIALIZABLE | prevented | prevented | prevented |

So **by the SQL standard, REPEATABLE READ does NOT eliminate phantoms** — only SERIALIZABLE does.

## The PostgreSQL nuance (implementation stronger than standard)
The standard specifies which anomalies *must not* occur — implementations may be **stronger**.
**PostgreSQL's REPEATABLE READ uses a transaction-level snapshot and does NOT allow phantom reads**,
exceeding the standard. PostgreSQL's READ COMMITTED still allows both non-repeatable and phantom
reads. (This is why isolation claims should be anchored to "the SQL standard" vs "in PostgreSQL".)

## MVCC and serialization failures
PostgreSQL implements isolation with **MVCC (multiversion concurrency control)**: each transaction
sees a consistent **snapshot**, so **readers do not block writers and writers do not block readers**
(contrast lock-based systems). The cost: at REPEATABLE READ and SERIALIZABLE, conflicting concurrent
updates raise a **serialization failure** ("could not serialize access…") and the application **must
retry** the transaction. Only READ COMMITTED avoids that retry requirement. SERIALIZABLE (via
Serializable Snapshot Isolation) makes concurrent transactions behave as if run one-at-a-time.
