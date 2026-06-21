---
id: corpus/developer/concurrency/race-deadlock-models
domain: developer
subdomain: concurrency
topic: race-deadlock-models
sources:
  - "Wikipedia — Race condition / Deadlock / Coffman conditions (read 2026-06-16, CC-BY-SA, paraphrased)"
license_posture: own-words-paraphrase
status: drafted
last_reviewed: 2026-06-16
---

# Concurrency hazards — races, deadlocks, and lock-free models

## Data race
A **data race** occurs when two or more threads access the **same memory location concurrently**,
**at least one access is a write**, and there is **no synchronization** ordering them. The result is
undefined/nondeterministic. Fix by synchronizing (locks, atomics) or by not sharing mutable state.

## Atomicity vs visibility (two distinct properties)
- **Atomicity** — an operation completes indivisibly (no interleaving mid-operation). `i++` is
  **read-modify-write** and is **not atomic** even on a single variable.
- **Visibility** — whether one thread's write becomes observable to another (memory ordering / caches).
A visibility keyword (Java `volatile`, etc.) provides visibility/ordering **but does NOT make a
compound op like `i++` atomic** — you still need an atomic instruction (CAS) or a lock for that.

## Deadlock and the four Coffman conditions
A **deadlock** is a set of threads each waiting forever for a resource another holds. It can occur
**only if all four Coffman conditions hold simultaneously**:
1. **Mutual exclusion** — resources are non-shareable.
2. **Hold and wait** — a thread holds one resource while waiting for another.
3. **No preemption** — resources can't be forcibly taken.
4. **Circular wait** — a cycle of threads each waiting on the next.
Breaking **any one** prevents deadlock (e.g. enforce a global **lock ordering** to kill circular wait).

## Deadlock vs livelock vs starvation
- **Deadlock** — threads are blocked, making no progress.
- **Livelock** — threads are *active* (not blocked) but keep reacting to each other and still make no
  progress.
- **Starvation** — a thread is perpetually denied a resource it needs while others proceed.

## Lock-free and CAS
**Compare-And-Swap (CAS)** is an atomic primitive that updates a value only if it still equals an
expected value; it underlies **lock-free** algorithms that avoid mutual exclusion (and thus avoid
deadlock), typically via retry loops.

## Scaling realities
More threads do **not** automatically mean more throughput — beyond the number of cores, CPU-bound
threads contend and incur context-switch/cache costs. A **single global lock** serializes access and
**limits scalability** (it becomes the bottleneck); fine-grained locking, sharding, or lock-free
structures scale better.
