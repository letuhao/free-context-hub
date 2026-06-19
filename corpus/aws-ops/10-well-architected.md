---
id: corpus/aws-ops/well-architected/six-pillars
domain: aws-ops
subdomain: well-architected
topic: six-pillars
sources:
  - "AWS Well-Architected Framework — The pillars of the framework (read 2026-06-16, © Amazon, paraphrased)"
license_posture: own-words-paraphrase
status: drafted
last_reviewed: 2026-06-16
---

# AWS Well-Architected Framework — the six pillars

## There are six pillars (not five)
The AWS Well-Architected Framework is organized into **six pillars**. The sixth, **Sustainability**,
was added in **2021**; older material citing "five pillars" predates that addition. The Framework is
a structured way to evaluate architectures and is **not** about security alone — security is just
one of the six.

1. **Operational Excellence** — running and monitoring systems to deliver business value, and
   continuously improving processes and procedures (IaC, observability, runbooks, small frequent
   reversible changes, learning from failure).
2. **Security** — protecting data, systems, and assets: identity and access management,
   least-privilege, detective controls, defense in depth, data protection in transit and at rest.
3. **Reliability** — a workload performing its intended function correctly and consistently, and
   recovering from failure: automatic recovery, horizontal scaling, removing single points of
   failure, managing change.
4. **Performance Efficiency** — using computing resources efficiently and maintaining that as demand
   and technology change: selecting the right resource types, monitoring, and making data-driven
   trade-offs.
5. **Cost Optimization** — avoiding unnecessary cost: matching supply to demand, choosing the right
   pricing models, measuring and attributing spend, and stopping spend on undifferentiated work.
6. **Sustainability** — minimizing the environmental impact of running cloud workloads: maximizing
   utilization, choosing efficient regions/services, and reducing the resources needed per unit of
   work.

## The pillars trade off against each other
The pillars are **lenses, not independent checkboxes** — they routinely **conflict**, and good
architecture is about deliberate trade-offs. For example, the strongest reliability (multi-Region
active/active) raises cost; aggressive cost optimization can reduce performance headroom or
resilience; tighter security controls can add latency or operational friction. Well-Architected
reviews surface these trade-offs explicitly so they are chosen, not stumbled into, against business
priorities.
