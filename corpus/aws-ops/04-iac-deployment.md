---
id: corpus/aws-ops/iac-deployment/cfn-cdk-terraform
domain: aws-ops
subdomain: iac-deployment
topic: cfn-cdk-terraform
sources:
  - "AWS CloudFormation User Guide — what is CFN (read 2026-06-16, © Amazon, paraphrased)"
  - "AWS CDK v2 Developer Guide — home (read 2026-06-16, © Amazon, paraphrased)"
  - "HashiCorp Terraform — Intro / providers / state (read 2026-06-16, paraphrased)"
license_posture: own-words-paraphrase
status: drafted
last_reviewed: 2026-06-16
---

# Infrastructure as Code — CloudFormation vs CDK vs Terraform; deployment strategies

## What IaC is (and the declarative model)
Infrastructure as Code defines resources in version-controlled files. The dominant model is
**declarative**: you describe the **desired end-state**, and the tool computes and applies the
changes to reach it — you do **not** write ordered imperative steps. Applying the same definition
repeatedly is **idempotent** (converges to the same state), which is what makes IaC consistent and
repeatable.

## CloudFormation (CFN)
AWS-native IaC. You write a **template** (JSON/YAML) describing resources and properties; CFN
provisions and tracks them as a **stack**. It manages dependency ordering and rollback on failure.
**Drift detection** reports when live resources have diverged from the template (e.g. someone changed
a setting in the console) — drift is a first-class concept precisely because out-of-band changes
break the desired-state guarantee.

## CDK (Cloud Development Kit)
CDK lets you define infrastructure in a **general-purpose programming language** (TypeScript, Python,
Java, etc.). It is **not a separate provisioning engine**: CDK **synthesizes down to CloudFormation
templates**, which CFN then deploys. So you get loops/abstractions/typing of real code, with CFN as
the execution layer underneath.

## Terraform (HashiCorp)
**Multi-cloud** IaC using a declarative configuration language (HCL). It works across providers (AWS,
Azure, GCP, Kubernetes, and thousands more) through a **provider** plugin model. Terraform keeps a
**state file** (`terraform.tfstate`) that maps configuration to real-world resources — **state is
fundamental to how Terraform works**, used to plan diffs and detect drift; it is not optional. (CFN
holds equivalent state internally as the stack; Terraform exposes it as a file you must manage and
secure.) Terraform favors an **immutable** approach to changes.

## Choosing
- **AWS-only, want native integration/rollback** → **CloudFormation** (or **CDK** if you prefer real
  code that compiles to CFN).
- **Multi-cloud / single tool across providers** → **Terraform** (mind state-file management).

## Deployment strategies (orthogonal to the IaC tool)
- **Rolling** — replace instances in batches; no extra fleet, but mixed versions briefly coexist.
- **Blue/green** — stand up a full parallel ("green") environment, cut traffic over, keep "blue" for
  instant rollback; higher cost, lowest risk.
- **Canary** — shift a **small percentage** of traffic to the new version first, watch metrics, then
  ramp. (AWS frames canary as a more risk-averse **type of blue/green**; the practical distinction is
  that classic blue/green flips all traffic at once after cutover, while canary ramps traffic by
  proportion.)
