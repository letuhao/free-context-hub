---
id: corpus/solution-architecture/architecture-styles/monolith-microservices-serverless
domain: solution-architecture
subdomain: architecture-styles
topic: monolith-microservices-serverless
sources:
  - "Wikipedia — Microservices (read 2026-06-16, CC-BY-SA, paraphrased)"
  - "martinfowler.com (MonolithFirst, MicroservicePremium) · microservices.io (READ, paraphrased)"
license_posture: own-words-paraphrase
status: drafted
last_reviewed: 2026-06-16
---

# Architecture styles — monolith, microservices, serverless

## The styles
- **Monolith** — one deployable unit. Simple to build, test, deploy, and reason about locally;
  becomes hard to scale teams and change safely as it grows.
- **Modular monolith** — a single deployable with strong internal module boundaries. Often the
  pragmatic middle: monolith simplicity + clean seams to split later.
- **Microservices** — independently deployable services around business capabilities, each owning
  its data. Enables independent deploy/scale and team autonomy at the cost of **distributed-system
  complexity** (network failures, eventual consistency, observability, ops).
- **Event-driven** — components communicate via asynchronous events (loose coupling, good for
  reactive/streaming flows).
- **Serverless (FaaS)** — functions run on demand, scale to zero, pay-per-use; no server management.

## The trade-off, stated honestly
Microservices buy **deployment independence and team scaling** but pay a **"microservice premium"**:
operational and distributed-systems complexity (inter-service calls, partial failure, data
consistency, deployment/monitoring overhead). So **microservices are not universally better than a
monolith**, and they do **not "reduce complexity"** — they *relocate* complexity from inside a
codebase to between services and into operations. A common guidance is **"monolith first"**: start
with a (modular) monolith and extract services once boundaries and scaling needs are clear.

## Serverless caveats
Serverless removes server *management*, but **"serverless" does not mean there are no servers** (a
provider runs them) and it does **not eliminate operational concerns** — notably **cold starts**
(latency when a new execution environment spins up), execution-time/resource limits, statelessness,
and vendor lock-in.

## When each fits
- **Monolith / modular monolith** → small teams, early products, when domain boundaries aren't yet
  clear; the safe default.
- **Microservices** → systems whose **complexity has outgrown a monolith** (Fowler's primary driver
  is system complexity, with team/deploy independence secondary), and where the platform maturity
  (CI/CD, observability, on-call) exists to pay the premium.
- **Serverless** → event-driven, spiky, glue/integration workloads where scale-to-zero and pay-per-use
  win and cold-start/limits are acceptable.
Selection follows system complexity, organizational scale, and operational maturity — not technology
fashion.
