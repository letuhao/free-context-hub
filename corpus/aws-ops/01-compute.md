---
id: corpus/aws-ops/compute/ec2-ecs-eks-lambda
domain: aws-ops
subdomain: compute
topic: ec2-ecs-eks-lambda
sources:
  - "AWS Lambda Developer Guide — quotas / limits (read 2026-06-16, © Amazon, paraphrased)"
  - "AWS EKS User Guide — what is EKS (read 2026-06-16, © Amazon, paraphrased)"
  - "AWS ECS/Fargate docs (© Amazon, paraphrased)"
license_posture: own-words-paraphrase
status: drafted
last_reviewed: 2026-06-16
---

# AWS compute — EC2 vs containers (ECS/EKS) vs serverless (Lambda)

## The spectrum of control vs. management
- **EC2** — virtual machines you provision and operate. Maximum control (OS, patching, scaling),
  maximum operational responsibility.
- **Containers (ECS / EKS)** — orchestrate Docker containers. **ECS** is AWS's native orchestrator;
  **EKS** is managed **Kubernetes**. They differ in the orchestration API, not in "EKS removes all
  ops" — EKS gives you Kubernetes (and its flexibility *and* its operational complexity), while ECS
  is simpler but AWS-specific.
- **Lambda** — serverless functions; you supply code, AWS runs it on demand. No servers to manage,
  scales to zero, pay-per-use.

## ECS/EKS launch types: Fargate vs EC2
A cluster's tasks/pods run on one of two launch types:
- **Fargate** — **serverless containers**: AWS provisions and manages the underlying compute; you do
  **not** manage EC2 nodes. You pay per task's vCPU/memory.
- **EC2 launch type** — you run and manage a fleet of **EC2 container instances** yourself (capacity,
  patching, scaling of the nodes).
So Fargate's defining property is *no node management*; choosing the EC2 launch type means you **do**
manage the EC2 nodes.

## Lambda — concrete limits that drive design
- **Maximum execution time: 900 seconds (15 minutes)** per invocation — Lambda is **not** for
  arbitrarily long jobs.
- **Memory: 128 MB to 10,240 MB** (in 1-MB steps); CPU scales with memory (≈1 vCPU at 1,769 MB).
- **`/tmp` ephemeral storage: 512 MB to 10,240 MB.**
- **Concurrency:** default **1,000 concurrent executions per Region** (a soft quota, raisable to tens
  of thousands); new functions also face **cold starts** when a new execution environment spins up.
These limits mean Lambda fits event-driven, bursty, short-lived work; long-running or
heavy-state workloads belong on containers or EC2.

## Choosing
- **Full OS control / legacy / specialized workloads** → **EC2**.
- **Containerized services, want orchestration** → **ECS** (simpler, AWS-native) or **EKS**
  (Kubernetes, portable, more complex); pair with **Fargate** to avoid node management.
- **Event-driven, short, spiky, pay-per-use** → **Lambda** (mind the 15-min ceiling and cold starts).
