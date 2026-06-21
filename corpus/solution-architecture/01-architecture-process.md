---
id: corpus/solution-architecture/architecture-process/nfr-adr-migration
domain: solution-architecture
subdomain: architecture-process
topic: nfr-adr-migration
sources:
  - "adr.github.io (Nygard ADRs) (read 2026-06-16, OPEN, paraphrased)"
  - "Wikipedia — Non-functional requirement (CC-BY-SA, paraphrased); martinfowler.com StranglerFig, ThoughtWorks fitness functions (READ, paraphrased)"
license_posture: own-words-paraphrase
status: drafted
last_reviewed: 2026-06-16
---

# Architecture process — NFRs, ADRs, migration

## Functional vs non-functional requirements
**Functional requirements** say *what* the system does (features/behavior). **Non-functional
requirements (NFRs / quality attributes)** say *how well* it does it — performance, scalability,
availability, security, maintainability, observability, cost. NFRs are often what *drives the
architecture* (a "handle 10k rps at p99 < 100ms" NFR shapes the design far more than any single
feature).

## Trade-offs: you cannot maximize everything
Quality attributes **conflict** — you **cannot simultaneously maximize all of them**. Stronger
consistency costs latency/availability; more security adds friction; higher availability costs money
and complexity. Good architecture makes these trade-offs **explicit and intentional** against
business priorities — the honest answer to most architecture questions is **"it depends"** (on the
NFRs and context), not a universal best.

## Architecture Decision Records (ADRs)
An **ADR** captures a single significant decision: the **context** (forces/constraints), the
**decision** made, and its **consequences** (trade-offs accepted, including the downsides). ADRs are
**written at decision time** and kept immutable (superseded by new ADRs, not edited) — they are a
**decision log explaining *why*, not after-the-fact documentation** of *what*. Their value is
preserving the reasoning for future maintainers.

## Migration: strangler-fig over big-bang
The **Strangler Fig pattern** migrates a legacy system **incrementally**: new functionality is built
around the edges and traffic is gradually redirected from the old system to the new, piece by piece,
until the old system can be retired. This keeps the system running and **reduces risk** versus a
**big-bang rewrite** — which is **not the safe default**: big-bang rewrites are high-risk (long
no-value period, hard cutover, "second-system" over-engineering) and frequently fail.

## Architecture fitness functions
**Fitness functions** are automated checks that continuously verify the architecture still meets its
quality goals (e.g. dependency rules, latency budgets, layering constraints) — turning NFRs into
executable guardrails so architectural erosion is caught like a failing test, not discovered years
later.
