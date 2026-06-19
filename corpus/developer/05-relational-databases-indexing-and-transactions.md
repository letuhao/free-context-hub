---
id: corpus/developer/relational-databases/indexing-and-transactions
domain: developer
subdomain: relational-databases
topic: indexing-and-transactions
sources:
  - "PostgreSQL docs — Indexes / Transactions tutorial (read 2026-06-16, OPEN, paraphrased)"
  - "use-the-index-luke.com — indexing concepts (READ, paraphrased)"
license_posture: own-words-paraphrase
status: drafted
last_reviewed: 2026-06-16
---

# Indexing and transactions (ACID)

## Indexes — what they buy and what they cost
An index is an auxiliary data structure that speeds **lookups/filters/sorts** by avoiding full table
scans. The trade-off: indexes **speed reads but slow writes** (every INSERT/UPDATE/DELETE must also
maintain each index) and consume storage. So **more indexes is not always faster overall** —
write-heavy tables and rarely-queried columns pay a cost for little benefit.

## Index types
- **B-tree** — the default; supports equality and **range** queries and ordering (`<`, `>`, BETWEEN,
  ORDER BY), because it keeps keys sorted.
- **Hash** — equality only (`=`); no range/ordering support.
- Specialized types exist (GIN/GiST for full-text, arrays, geometric).

## Composite indexes and the leftmost-prefix rule
A **composite index** on `(a, b, c)` can serve queries filtering on `a`, `a,b`, or `a,b,c` — the
**leftmost prefix** — but generally **not** a query filtering only on `b` or `c`. A **covering
index** includes all columns a query needs so the query is answered from the index alone
(index-only scan), skipping the table.

## When an index is NOT used
Having an index does **not** guarantee the planner uses it. It may be skipped when:
- **Low selectivity** — the predicate matches a large fraction of rows, so a sequential scan is
  cheaper than many random index lookups.
- A **function/expression wraps the column** (`WHERE lower(email) = …`) and no matching
  expression/functional index exists — the plain column index can't be used.
- Implicit **type mismatches** or leading wildcards (`LIKE '%x'`).
The planner is **cost-based**: it estimates and may rationally prefer a scan.

## Transactions and ACID
A transaction groups operations into an all-or-nothing unit with **ACID** guarantees:
- **Atomicity** — all operations commit or none do (rollback on failure).
- **Consistency** — a transaction moves the DB from one valid state to another (constraints hold).
- **Isolation** — concurrent transactions don't corrupt each other (governed by the isolation level).
- **Durability** — once committed, data survives crashes (persisted to durable storage/WAL).
