---
id: corpus/aws-ops/storage/s3-ebs-efs
domain: aws-ops
subdomain: storage
topic: s3-ebs-efs
sources:
  - "AWS S3 User Guide — What is S3 + data consistency model (read 2026-06-16, © Amazon, paraphrased)"
  - "AWS EBS User Guide — What is Amazon EBS (read 2026-06-16, © Amazon, paraphrased)"
  - "AWS EFS User Guide — What is Amazon EFS (read 2026-06-16, © Amazon, paraphrased)"
  - "AWS S3 storage classes docs — durability figure (© Amazon, paraphrased)"
license_posture: own-words-paraphrase
status: drafted
last_reviewed: 2026-06-16
---

# AWS storage — S3 vs EBS vs EFS

## Amazon S3 — object storage
S3 is an **object store** (not a filesystem and not a block device): data is stored as objects in
flat buckets, addressed by key, and accessed over an HTTP API. It is designed for **11 nines
(99.999999999%) of durability** for S3 Standard by redundantly storing objects across multiple
devices and Availability Zones within a Region. It offers multiple **storage classes** (Standard,
Standard-IA, One Zone-IA, Glacier tiers, Intelligent-Tiering) and **lifecycle policies** to
transition or expire objects automatically — the cost/access trade-off is explicit per class.

### S3 consistency model
S3 provides **strong read-after-write consistency** for PUT and DELETE of objects, in **all
Regions**, automatically and at no extra cost. This applies to **new objects and overwrites of
existing objects**: any GET or LIST issued after a successful write returns the latest data (a
just-written object appears in a listing immediately; a just-deleted object is gone immediately).
Reads on object metadata/HEAD, ACLs, tags, and S3 Select are also strongly consistent. Two nuances
worth holding precisely: (1) **updates are atomic per key** — a concurrent reader gets either the
old or new object, never a partial/corrupt one — but there is **no cross-key atomicity and no
object locking for concurrent writers** (with two simultaneous PUTs to one key, **last writer
wins** by timestamp). (2) **Bucket configurations** (not object data) have an **eventual
consistency** model — e.g. just-enabled versioning may take a short time to propagate. Historically
(before December 2020) S3 was only eventually consistent for some new-object reads; that limitation
no longer exists.

## Amazon EBS — block storage
EBS provides **block storage volumes** that attach to EC2 instances and behave like a raw disk. A
volume lives in a **single Availability Zone** and is normally **attached to one instance at a
time** (within that AZ); it is not multi-AZ by default. (The exception is **EBS Multi-Attach** for
io1/io2 Provisioned IOPS volumes, which can attach to up to 16 instances **in the same AZ** — still
not cross-AZ.) Durability/availability across AZs is
achieved indirectly via **snapshots**, which are point-in-time backups stored in S3 and can restore
a new volume in any AZ of the Region. EBS suits databases and boot volumes — workloads needing
low-latency, persistent, single-attach block storage tied to one instance.

## Amazon EFS — shared file storage
EFS is a **serverless, elastic, shared file system** speaking the **NFS (v4.1/v4.0)** protocol. It
is **multi-AZ** (highly available and durable across AZs within a Region by design) and can be
**mounted concurrently by many compute clients** — EC2, ECS, EKS, Lambda, Fargate. It scales
automatically to petabytes without provisioning capacity. (The default **Regional** file-system type
is multi-AZ; EFS also offers a cheaper **One Zone** type that stores data in a single AZ.) EFS suits **shared-file workloads** where
multiple instances need the same filesystem (content management, shared home directories, lift-and-
shift apps expecting POSIX file semantics).

## Choosing between them
- **Object data, web-scale, durable, API-accessed** → **S3** (not a mountable filesystem).
- **Single-instance, low-latency block disk in one AZ** → **EBS** (multi-AZ only via snapshots).
- **Shared POSIX filesystem mounted by many clients across AZs** → **EFS** (NFS, multi-AZ).
