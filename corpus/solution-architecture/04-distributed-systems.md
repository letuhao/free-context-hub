---
id: corpus/solution-architecture/distributed-systems/cap-consistency-idempotency
domain: solution-architecture
subdomain: distributed-systems
topic: cap-consistency-idempotency
sources:
  - "Wikipedia — CAP theorem / PACELC / Consensus (read 2026-06-16, CC-BY-SA, paraphrased)"
  - "raft.github.io + Raft paper (OPEN, paraphrased); Kleppmann DDIA (READ, paraphrased)"
license_posture: own-words-paraphrase
status: drafted
last_reviewed: 2026-06-16
---

# Distributed systems — CAP, consistency, consensus, idempotency

## CAP theorem (the precise framing)
CAP says a distributed data store cannot simultaneously guarantee all three of **Consistency**
(every read sees the most recent write or an error), **Availability** (every request to a non-failing
node gets a response, possibly stale), and **Partition tolerance** (the system keeps working despite
dropped/delayed messages between nodes). The common "**pick 2 of 3**" slogan is misleading: in a real
network, **partitions are unavoidable**, so **P is not optional**. The actual decision is **C vs A
*when a partition occurs*** — a **CP** system sacrifices availability (refuses/errs to stay
consistent) during the partition; an **AP** system stays available but may serve stale data. When
there is **no** partition, a system can provide both C and A. (Also: CAP's "consistency" is
linearizability, different from ACID's "C".) A **CP system is not perpetually unavailable** — it only
sacrifices availability *during* a partition.

## PACELC (the extension)
PACELC extends CAP: **if Partition (P) → choose Availability or Consistency (A/C); Else (E) → choose
Latency or Consistency (L/C).** It captures that even with no partition there is a constant
**latency-vs-consistency** trade-off (e.g. waiting for synchronous replication = stronger consistency
but higher latency).

## Consistency models
- **Strong/linearizable** — reads always reflect the latest committed write (appears as a single copy).
- **Eventual** — replicas converge eventually; reads may be stale meanwhile.
- **Causal** — operations with a cause-effect relationship are seen in order, but unrelated ops may
  differ across replicas (a useful middle ground).

## Consensus (agreement despite failures)
**Consensus** protocols (**Raft**, **Paxos**) let a cluster agree on a single value/log order despite
crashes, typically requiring a **majority quorum** to make progress. Raft is designed for
understandability (leader election + replicated log). Consensus is how CP systems keep a consistent
replicated state.

## Exactly-once: delivery vs processing
**Exactly-once *delivery* over an unreliable network is impossible** (the two-generals problem): a
sender can't know if a message arrived without an ack, and the ack can be lost. The achievable goal
is **exactly-once *processing*** = **at-least-once delivery + idempotent (deduplicating) consumers**.
**Idempotent does NOT mean "returns identical response bytes"** — it means **applying the operation
more than once has the same effect on state as applying it once** (e.g. via a dedup key), so retries
are safe.
