---
id: corpus/solution-architecture/integration-messaging/queues-streams-sagas
domain: solution-architecture
subdomain: integration-messaging
topic: queues-streams-sagas
sources:
  - "enterpriseintegrationpatterns.com (Hohpe) · microservices.io/patterns/data/saga (READ, paraphrased)"
  - "kafka.apache.org/documentation · rabbitmq.com/docs (read 2026-06-16, OPEN, paraphrased)"
license_posture: own-words-paraphrase
status: drafted
last_reviewed: 2026-06-16
---

# Integration & messaging — queues, streams, sagas

## Queue vs stream/log (not interchangeable)
- **Message queue** (e.g. RabbitMQ) — work-distribution: a message is delivered to **one** consumer
  and **removed once acknowledged**. Good for task/job distribution and competing consumers.
- **Event stream / log** (e.g. Kafka) — an **append-only, ordered, retained log**: messages persist
  and can be **re-read** by **multiple independent consumer groups**, each tracking its own offset.
  Good for replay, multiple subscribers, and event history.
So a **queue and a stream are not interchangeable**: a queue is consume-once work distribution; a log
is replayable, multi-consumer event history.

## Pub/sub and sync vs async
**Publish/subscribe** broadcasts a message to all interested subscribers. **Synchronous**
(request/response, e.g. HTTP) couples caller and callee in time; **asynchronous** (messaging)
decouples them, improving resilience and load-leveling. But **async is not always faster or better**:
it adds latency for end-to-end completion, complexity (ordering, idempotency, eventual consistency),
and harder debugging — choose it for decoupling/buffering/throughput, not as a blanket upgrade.

## Delivery semantics and idempotent consumers
Practical messaging is **at-least-once** delivery (a message may be redelivered after a failed ack).
Therefore **consumers must be idempotent** (dedupe by message/business key) so reprocessing a
duplicate does no harm. Combined with at-least-once, this yields effective exactly-once *processing*.

## Backpressure
When producers outpace consumers, **backpressure** (bounded buffers, flow control, consumer-paced
pulling, rate limiting) prevents unbounded queue growth and memory exhaustion.

## Sagas for distributed consistency (instead of 2PC)
A **saga** maintains consistency across services as a sequence of **local transactions**, each with a
**compensating transaction** to undo prior steps on failure (eventual consistency, not atomic). Two
coordination styles:
- **Choreography** — services react to each other's events (no central coordinator); simple but logic
  is spread out.
- **Orchestration** — a central orchestrator tells each service what to do; clearer control, one more
  component.
**Two-phase commit (2PC) is NOT the standard way to keep microservices consistent** — distributed 2PC
is blocking, hurts availability, and couples services; sagas (with idempotency + outbox) are the
prevailing pattern.
