---
id: corpus/solution-architecture/scalability-performance/caching-lb-capacity
domain: solution-architecture
subdomain: scalability-performance
topic: caching-lb-capacity
sources:
  - "Wikipedia — Cache (computing) / Load balancing (computing) (read 2026-06-16, CC-BY-SA, paraphrased)"
  - "Cloud architecture center — caching strategies (READ, paraphrased)"
license_posture: own-words-paraphrase
status: drafted
last_reviewed: 2026-06-16
---

# Scalability & performance — caching, load balancing, capacity

## Caching strategies
- **Cache-aside (lazy loading)** — app checks cache; on miss, loads from the DB and populates the
  cache. Only requested data is cached; stale data possible until invalidated/expired.
- **Write-through** — writes go to cache and DB synchronously; cache always fresh, writes slower.
- **Write-behind (write-back)** — writes go to cache, flushed to the DB asynchronously; fast writes,
  risk of data loss if the cache fails before flush.
Caching trades freshness for speed: **caching does not always improve correctness or performance** —
it introduces **staleness/invalidation** problems ("there are only two hard things… cache
invalidation and naming things") and adds little for low-reuse or write-heavy data. Use **TTLs** and
explicit invalidation to bound staleness.

## Horizontal vs vertical scaling
- **Vertical (scale up)** — bigger machine (more CPU/RAM). Simple, but **finite** — you hit a hardware
  ceiling and a single point of failure; **it does not scale infinitely**.
- **Horizontal (scale out)** — more machines behind a load balancer. Scales much further and adds
  redundancy, but requires the workload to be distributable.
**Statelessness** (no per-instance session state; push state to a shared store/cache) is what makes
horizontal scale-out work — any instance can serve any request.

## Load balancing & CDN
A **load balancer** distributes requests across instances (round-robin, least-connections, etc.) and
routes around unhealthy nodes. A **CDN** caches static (and some dynamic) content at edge locations
near users to cut latency and offload origin servers.

## Bottlenecks and capacity
- **Adding app servers does NOT fix a single-database bottleneck** — if all instances hit one DB, the
  DB is the limit; you need read replicas, sharding, caching, or partitioning instead.
- **N+1 query problem** — fetching a list then issuing one query per item (N extra round-trips);
  fix with joins/batch fetching/eager loading.
- **Capacity & latency budgets** — plan for peak load with headroom; track tail latency (p95/p99),
  not just averages, since tail latency dominates user-perceived performance and fan-out behavior.
