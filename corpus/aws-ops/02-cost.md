---
id: corpus/aws-ops/cost/pricing-rightsizing-savings
domain: aws-ops
subdomain: cost
topic: pricing-rightsizing-savings
sources:
  - "AWS Savings Plans User Guide — what are Savings Plans (read 2026-06-16, © Amazon, paraphrased)"
  - "AWS EC2 User Guide — Spot Instances (read 2026-06-16, © Amazon, paraphrased)"
  - "AWS Well-Architected Cost Optimization Pillar (© Amazon, paraphrased)"
license_posture: own-words-paraphrase
status: drafted
last_reviewed: 2026-06-16
---

# AWS cost — pricing models, right-sizing, and commitment plans

## The compute purchasing models
- **On-Demand** — pay per second/hour, no commitment. Most flexible, highest unit price. Best for
  spiky/unpredictable or short-lived workloads.
- **Spot Instances** — use **spare EC2 capacity at a steep discount (up to ~90% off On-Demand)**.
  The catch: AWS can **reclaim** them when it needs the capacity, giving only a **two-minute
  interruption notice**. Ideal for **fault-tolerant, interruptible, stateless** work (batch, CI,
  big-data, rendering) — *not* unsuitable for everything, but wrong for workloads that can't tolerate
  interruption without design (checkpointing, queue-based retry).
- **Savings Plans / Reserved Instances** — commit to a **specified amount of compute (per hour) for
  1 or 3 years** in exchange for **up to ~72% savings**. Compute Savings Plans are flexible across
  instance family/size/OS/Region and also cover **Fargate and Lambda**.

## Commitment is a risk, not a guaranteed win
Savings Plans/RIs are **only cheaper if you actually use the committed amount** — you pay for the
commitment whether or not you consume it. Over-committing (or workloads that later shrink/migrate)
can cost **more** than On-Demand. So "Reserved/Savings = always cheaper" is conditional on stable,
predictable baseline usage; size the commitment to your steady-state floor, not your peak.

## Right-sizing
Match instance/resource size to actual utilization; oversized always-on resources are the most
common waste. Right-sizing (and turning off idle resources) is usually the **first** cost lever,
before purchasing commitments.

## Data-transfer / egress costs (commonly overlooked)
Network charges surprise teams: **data transfer within AWS is NOT uniformly free.** Inbound from the
internet is generally free, but **outbound (egress) to the internet is billed**, and **cross-AZ and
cross-Region traffic incur charges** (traffic within a single AZ using private IPs is typically
free). Architectures that chat across AZs/Regions or push large egress can run up significant,
easily-missed bills.

## Storage-class cost trade-offs
For S3, cheaper classes (Standard-IA, One Zone-IA, Glacier tiers) lower storage price but add
retrieval cost/latency or reduced AZ-resilience — use **lifecycle policies** to move data down the
tiers as it cools.

## Cost allocation
**Tagging** resources (by team/project/environment) enables cost allocation and accountability —
without it, optimization is guesswork.
