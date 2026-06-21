---
id: corpus/aws-ops/databases/rds-dynamodb-elasticache
domain: aws-ops
subdomain: databases
topic: rds-dynamodb-elasticache
sources:
  - "AWS DynamoDB Developer Guide — read consistency (read 2026-06-16, © Amazon, paraphrased)"
  - "AWS DynamoDB Developer Guide — partition key design / adaptive capacity (read 2026-06-16, © Amazon, paraphrased)"
  - "AWS RDS / Aurora and ElastiCache docs (© Amazon, paraphrased)"
license_posture: own-words-paraphrase
status: drafted
last_reviewed: 2026-06-16
---

# AWS databases — RDS/Aurora vs DynamoDB vs ElastiCache

## RDS / Aurora — managed relational
RDS is **managed relational** database hosting (PostgreSQL, MySQL, MariaDB, Oracle, SQL Server);
**Aurora** is AWS's MySQL/PostgreSQL-compatible engine with a distributed storage layer. They
provide SQL, joins, transactions, and schemas. **Multi-AZ** deployments give **high availability via
synchronous standby replicas and automatic failover** within a Region. In the standard **Multi-AZ DB
instance** deployment the standby is for failover only and does **not** serve reads; the newer
**Multi-AZ DB cluster** deployment has two standbys that **can** serve read traffic. To scale reads
generally, use async **read replicas**. RDS suits workloads needing relational
modeling and strong transactional/SQL semantics.

## DynamoDB — managed NoSQL key-value/document
DynamoDB is a **NoSQL** key-value/document store with single-digit-millisecond latency at scale. It
does **not support joins**; access is by key, `Query` (within a partition), or `Scan`.

### Read consistency (a precise, commonly-misstated fact)
DynamoDB table and LSI reads offer two modes: **eventually consistent (the DEFAULT)** and **strongly
consistent (opt-in)**. By default a read may not reflect a very recent write; repeating the read
shortly after returns the latest value. **Strong consistency is requested explicitly** by setting
`ConsistentRead = true` on `GetItem`/`Query`/`Scan`, and it **costs twice as much** (eventually
consistent reads are half the price). Crucially, **strongly consistent reads are NOT supported on
Global Secondary Indexes (GSIs) or Streams** — **all GSI and Stream reads are eventually
consistent**, regardless of the parameter. Global tables (multi-Region) replicate typically within a
second and are eventually consistent across Regions.

### Partition-key design and throttling
Throughput is spread across **partitions** keyed by the partition key. A poorly chosen key that
concentrates traffic creates a **hot partition** that throttles even when total provisioned capacity
seems adequate. Mitigations: design **high-cardinality, evenly-accessed keys**, use **write
sharding**, and rely on **adaptive capacity** (which redistributes capacity toward hot partitions,
in both on-demand and provisioned modes) — but adaptive capacity reduces, and does not categorically
eliminate, throttling. **`Scan` reads the whole table/index and is inefficient for key lookups** —
use `Query`/`GetItem` against keys/indexes instead.

## ElastiCache — managed in-memory cache
ElastiCache is **managed in-memory caching** (Redis and Memcached engines) for sub-millisecond reads
of hot data — used in front of RDS/DynamoDB to offload repeated reads, for session stores, and for
leaderboards/rate-limiters (Redis). It is a cache/data-structure store, not the system of record.

## Choosing between them
- **Relational model, joins, transactions, SQL** → **RDS/Aurora** (Multi-AZ for HA, read replicas
  for read scaling).
- **Massive-scale key-value/document, predictable latency, no joins** → **DynamoDB** (mind default
  eventual consistency, partition-key design, and `Scan` cost).
- **Sub-millisecond cache / ephemeral hot data** → **ElastiCache** (Redis/Memcached).
