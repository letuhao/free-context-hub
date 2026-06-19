---
id: corpus/aws-ops/observability/cloudwatch-xray
domain: aws-ops
subdomain: observability
topic: cloudwatch-xray
sources:
  - "AWS CloudWatch User Guide — metrics concepts / alarms (read 2026-06-16, © Amazon, paraphrased)"
  - "AWS CloudWatch Logs — log retention (© Amazon, paraphrased)"
  - "AWS X-Ray Developer Guide — what is X-Ray (read 2026-06-16, © Amazon, paraphrased)"
license_posture: own-words-paraphrase
status: drafted
last_reviewed: 2026-06-16
---

# AWS observability — CloudWatch and X-Ray

## Three different signal types
Metrics, logs, and traces are distinct — not interchangeable:
- **Metrics** — numeric time-series (e.g. CPUUtilization, request count). Cheap to store and alarm
  on; answer "how much / how many / how fast" over time.
- **Logs** — discrete, timestamped text/event records. Answer "what exactly happened" for a specific
  event; higher volume, queried (CloudWatch Logs Insights) rather than alarmed-on directly.
- **Traces** — the path of a single request across services. Answer "where did the latency/error
  occur" in a distributed call graph.
A metric and a log are **not** the same data shape, and X-Ray is for **traces**, not metrics.

## CloudWatch — metrics, alarms, logs
**CloudWatch** collects **metrics** (AWS-published and **custom metrics**, including
**high-resolution** down to 1-second), stores **logs** (CloudWatch Logs), and triggers **alarms**.
- **Alarms** watch a single metric (or a metric math expression) against a threshold; **composite
  alarms** combine multiple alarms to reduce noise. Alarms can notify (SNS) or trigger actions
  (Auto Scaling, EC2).
- **Log retention is configurable per log group, and the default is "never expire"** — CloudWatch
  Logs keep data **indefinitely** until you set a retention period (1 day … 10 years) to age it out.
  So unbounded retention/cost is the default unless you act.

## X-Ray — distributed tracing
**X-Ray** provides **distributed tracing**: it follows requests as they travel through your
application's services, builds a **trace map** (also called a service map), and surfaces latency bottlenecks and error
hotspots across a microservice call graph. It is the "traces" pillar of observability — used to
debug *where* a request slowed or failed, complementing CloudWatch metrics (how much) and logs
(what happened).

## Putting them together
A typical setup: CloudWatch **metrics + alarms** for health/SLO monitoring, CloudWatch **Logs** (with
an explicit retention policy to control cost) for forensic detail, and **X-Ray** traces for
cross-service latency/error analysis.
