---
id: corpus/aws-ops/resilience-ha/multi-az-region-dr
domain: aws-ops
subdomain: resilience-ha
topic: multi-az-region-dr
sources:
  - "AWS Disaster Recovery whitepaper — DR options in the cloud (read 2026-06-16, © Amazon, paraphrased)"
  - "AWS EC2 Auto Scaling User Guide — what is Auto Scaling (read 2026-06-16, © Amazon, paraphrased)"
  - "AWS Well-Architected Reliability Pillar (© Amazon, paraphrased)"
license_posture: own-words-paraphrase
status: drafted
last_reviewed: 2026-06-16
---

# AWS resilience — Multi-AZ vs Multi-Region, Auto Scaling, and DR strategies

## Multi-AZ ≠ Multi-Region
These solve different problems:
- **Multi-AZ** = **high availability within a single Region** by spreading resources across
  Availability Zones (isolated data centers). It survives an AZ failure, with low-latency
  synchronous replication between AZs.
- **Multi-Region** = **disaster recovery and/or global low latency** by running in geographically
  separate Regions. It survives a whole-Region event and serves users closer to them, but spans long
  distances (so cross-Region replication is typically asynchronous).
Multi-AZ does **not** give Region-level DR; a Region-wide event still takes down a single-Region,
multi-AZ deployment.

## RTO and RPO drive the DR choice
- **RTO (Recovery Time Objective)** — how long recovery may take.
- **RPO (Recovery Point Objective)** — how much data loss (time) is tolerable.
Lower RTO/RPO costs more (more standby infrastructure running). The four DR strategies trade cost
against RTO/RPO, from cheapest/slowest to most expensive/fastest:
1. **Backup & Restore** — back up data, restore on disaster. Lowest cost, **highest RTO/RPO**.
2. **Pilot Light** — core data replicated and minimal services dormant; scale up on disaster.
3. **Warm Standby** — a scaled-down but **always-running** copy; scale it up on disaster.
4. **Multi-Site Active/Active** — full production in multiple Regions serving live traffic; **lowest
   RTO/RPO**, highest cost.
So lower RTO/RPO is **not free** — it is bought with standby capacity.

## Auto Scaling is reactive, not instant
**EC2 Auto Scaling** launches/terminates instances to match demand using **scaling policies**
(commonly **target tracking**, also step/simple; **predictive** scaling forecasts ahead). It also
maintains **desired capacity** and replaces unhealthy instances. But it is **not instantaneous**: a
scale-out reacts to a metric breach, then must launch and boot instances (and respect cooldowns), so
there is a lag. For sharp spikes, combine with warm pools / predictive scaling / over-provisioning —
do not assume Auto Scaling absorbs an instant surge.

## Putting it together
HA (Multi-AZ + Auto Scaling + health checks + load balancing) keeps a workload running through
component/AZ failures *within* a Region; DR (Multi-Region with a chosen strategy) handles Region-level
disasters, scoped by the RTO/RPO the business will pay for.
