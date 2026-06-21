---
id: corpus/solution-architecture/data-architecture/event-sourcing-cqrs-outbox
domain: solution-architecture
subdomain: data-architecture
topic: event-sourcing-cqrs-outbox
sources:
  - "martinfowler.com — Event Sourcing / CQRS (read 2026-06-16, READ, paraphrased)"
  - "Wikipedia — CQRS (read 2026-06-16, CC-BY-SA, paraphrased); microservices.io — saga / transactional outbox (READ, paraphrased)"
license_posture: own-words-paraphrase
status: drafted
last_reviewed: 2026-06-16
---

# Data architecture — Event Sourcing, CQRS, and the Outbox

## Event Sourcing (ES)
Event Sourcing stores **the full sequence of state-changing events as the source of truth**, instead
of only the current state. Current state is **derived by replaying** events. Key properties:
- Events are an **append-only, immutable log** — **you do not edit past events**; you correct things
  by appending a new compensating/corrective event.
- A full **audit trail** and the ability to **reconstruct any past state** come for free.
- **Snapshots** periodically capture state so replay doesn't start from the beginning (bounding
  replay cost).
- ES is **not the same as event-driven architecture (EDA)**: ES is a *persistence* pattern (events as
  storage); EDA is a *communication/integration* style (services react to events). They often appear
  together but are distinct concerns.

## CQRS (Command Query Responsibility Segregation)
CQRS separates the **write model (commands)** from the **read model (queries)** — two different
**models**, optimized independently (writes for consistency/validation, reads for query shape). Key
nuance: **CQRS separates models, not necessarily databases** — it does **not require two separate
databases** (though it permits them). Read models are **projections** built from the write side and
are **rebuildable** (especially when paired with ES — replay events to regenerate a projection).
CQRS adds complexity and is justified when read and write workloads/shapes diverge sharply.

## The dual-write problem and the Outbox pattern
A service often must **update its database AND publish an event** (e.g. to a broker). Doing both as
two separate operations is the **dual-write problem**: there is **no atomicity across a database and
a message broker**, so a crash between them leaves them inconsistent (DB updated, event lost, or vice
versa). **A single local DB transaction does NOT atomically publish to the broker.**
The **Transactional Outbox** solves this: within the **same local transaction**, write the business
change *and* insert the event into an **outbox table**; a separate relay/poller (or CDC) then reads
the outbox and publishes to the broker **at-least-once**. Atomicity is preserved because both writes
hit one database in one transaction.
