---
id: corpus/solution-architecture/reliability-resilience/slo-breaker-bulkhead
domain: solution-architecture
subdomain: reliability-resilience
topic: slo-breaker-bulkhead
sources:
  - "Google SRE Book / Workbook (READ, paraphrased)"
  - "Wikipedia — Circuit breaker design pattern (read 2026-06-16, CC-BY-SA, paraphrased); Nygard, Release It! (READ, paraphrased)"
license_posture: own-words-paraphrase
status: drafted
last_reviewed: 2026-06-16
---

# Reliability & resilience — SLOs, circuit breakers, bulkheads

## SLI / SLO / SLA and error budgets (distinct things)
- **SLI (Indicator)** — a measured signal of service health (e.g. % of successful requests, latency
  percentile).
- **SLO (Objective)** — an **internal target** for an SLI (e.g. 99.9% success over 30 days).
- **SLA (Agreement)** — an **external contract** with consequences (credits/penalties) if breached.
**SLO ≠ SLA**: an SLO is your internal goal; an SLA is a customer-facing promise (usually set looser
than the SLO). The **error budget** = 1 − SLO (e.g. a 99.9% SLO allows ~0.1% failure); it quantifies
how much unreliability is acceptable and gates risk (when the budget is spent, slow down risky
releases). As a magnitude: **99.9% availability ≈ 43 minutes of downtime per 30-day month**
(~8.76 h/year).

## Circuit breaker (three states)
A **circuit breaker** stops calling a failing dependency to prevent cascading failure and give it
time to recover:
- **Closed** — calls flow normally; failures are counted.
- **Open** — after a failure threshold, calls **fail fast** (no call made) for a cool-down period.
- **Half-open** — after the cool-down, a few trial calls test recovery; success → closed, failure →
  open again.

## Timeouts, retries, bulkheads
- **Timeouts** — always bound waits. **"It's usually fast" is not a reason to skip a timeout** — the
  rare slow call is exactly what exhausts threads/connections and cascades.
- **Retries** — must be **bounded** with **exponential backoff + jitter**. **Unbounded/aggressive
  retries do NOT improve reliability** — they amplify load and cause retry storms that worsen an
  outage. And **retrying a non-idempotent operation after a timeout is unsafe** (the first attempt may
  have succeeded) — only retry idempotent operations (or use idempotency keys).
- **Bulkhead** — isolate resources (separate thread/connection pools per dependency) so one failing
  dependency can't sink the whole service (like watertight compartments in a ship).

## Graceful degradation & DR
Prefer **graceful degradation** (serve reduced functionality/stale data) over hard failure.
Disaster-recovery targets — **RPO** (tolerable data loss) and **RTO** (tolerable downtime) — drive
backup/replication strategy; lower RPO/RTO costs more.
