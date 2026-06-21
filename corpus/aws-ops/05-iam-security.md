---
id: corpus/aws-ops/iam-security/policy-evaluation-roles
domain: aws-ops
subdomain: iam-security
topic: policy-evaluation-roles
sources:
  - "AWS IAM User Guide — Policy evaluation logic (read 2026-06-16, © Amazon, paraphrased)"
  - "AWS IAM User Guide — IAM roles (read 2026-06-16, © Amazon, paraphrased)"
  - "AWS IAM User Guide — Permissions boundaries (read 2026-06-16, © Amazon, paraphrased)"
license_posture: own-words-paraphrase
status: drafted
last_reviewed: 2026-06-16
---

# AWS IAM — policy evaluation, roles, and boundaries

## Default is implicit deny
Every request starts from an **implicit deny**: if **no policy explicitly allows** an action, the
request is **denied by default**. Access requires an explicit `Allow` somewhere applicable, and that
allow must not be countered by any explicit `Deny`.

## The decision order: explicit Deny beats Allow beats implicit deny
AWS evaluates all applicable policy types together and resolves them with a fixed precedence:
**an explicit `Deny` in any policy overrides any `Allow`.** So the effective rule is
**explicit Deny > explicit Allow > (default) implicit deny.** An explicit allow only takes effect
when no explicit deny applies — a deny is absolute. (This is why a guardrail `Deny` in an SCP or a
permissions boundary cannot be overridden by granting an allow elsewhere.)

## Identity vs resource policies — union within an account
**Identity-based policies** attach to a principal (user/role); **resource-based policies** attach to
a resource (e.g. an S3 bucket policy). For a request **within the same account**, the effective
permissions are the **union**: if the action is allowed by the identity policy, the resource policy,
or both, it is allowed (still subject to: any explicit deny wins). For **cross-account** access,
both sides are generally required — the resource must grant access to the external principal **and**
the principal's account must allow it.

## IAM roles = temporary credentials
An **IAM role** is an identity assumed by a principal (user, service, or workload); assuming it via
**STS** yields **temporary, automatically-expiring security credentials** for the session, not
long-lived secrets. This contrasts with IAM-user **access keys**, which are **long-lived static
credentials** that persist until manually rotated/deleted (they do not auto-expire). Roles are the
preferred mechanism for EC2/Lambda/ECS workloads and cross-account access precisely because the
credentials are short-lived and auto-rotated.

## Permissions boundaries — a cap, not a grant
A **permissions boundary** is a managed policy that sets the **maximum permissions** an identity-
based policy can grant to a user or role. It **does not itself grant any permission** — effective
permissions are the **intersection** of (identity-based policies) AND (the boundary). Adding a
boundary can only **reduce** what a principal can do; removing it can only increase it. To actually
perform an action, the principal generally needs *both* an allow in an identity policy *and* that
action within the boundary (and no explicit deny). One advanced carve-out: a **resource-based policy
that grants directly to a user or role-session ARN** is not blocked by the boundary's *implicit*
deny (an *explicit* deny still wins). The same intersection/cap logic applies to AWS Organizations
**SCPs** (account-level cap; note SCPs do not restrict the management account) and the newer
**RCPs**; **session policies** can further narrow a session's permissions.

## Least privilege
The governing principle: grant only the permissions a principal needs, scope them with conditions
and resource ARNs, and prefer temporary role credentials over static keys.
