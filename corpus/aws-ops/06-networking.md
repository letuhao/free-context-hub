---
id: corpus/aws-ops/networking/vpc-routing-endpoints
domain: aws-ops
subdomain: networking
topic: vpc-routing-endpoints
sources:
  - "AWS VPC User Guide — NAT gateways (read 2026-06-16, © Amazon, paraphrased)"
  - "AWS PrivateLink — concepts (read 2026-06-16, © Amazon, paraphrased)"
  - "AWS Elastic Load Balancing User Guide — what is ELB; ALB/NLB user guides (read 2026-06-16, © Amazon, paraphrased)"
license_posture: own-words-paraphrase
status: drafted
last_reviewed: 2026-06-16
---

# AWS VPC — routing, NAT, endpoints, and load balancers

## Public vs private subnets (it's about the route, not the IP)
A subnet is **"public" because its route table sends internet-bound traffic (0.0.0.0/0) to an
Internet Gateway (IGW)** — not merely because a resource has a public IP. A **private subnet** has no
such route to an IGW. An instance can hold a public IP yet still be effectively private if its
subnet has no IGW route; conversely the defining property of a public subnet is the IGW route.

## NAT gateway — outbound only
A **NAT gateway** lets instances in a **private subnet initiate outbound connections** to the
internet or other VPCs while **preventing external services from initiating inbound connections** to
them. **Connections must always be initiated from within the VPC**; the NAT gateway does not accept
unsolicited inbound traffic. (A *public* NAT gateway reaches the internet via an IGW; a *private* NAT
gateway reaches other VPCs/on-prem without internet exposure.) This is the standard way to give
private instances egress (updates, API calls) without making them reachable from outside.

## VPC endpoints / PrivateLink — keep traffic off the public internet
**VPC endpoints** provide **private connectivity to AWS services (or third-party/your own services
via PrivateLink)** without traversing the public internet, an IGW, or a NAT gateway. **Gateway
endpoints** (S3, DynamoDB) add a route-table entry; **interface endpoints (PrivateLink)** place an
elastic network interface with a private IP in your subnet that proxies to the service. Note **gateway
endpoints do NOT use PrivateLink** — only interface endpoints do. The benefit is traffic stays on the
AWS network — better security posture (and gateway endpoints to S3/DynamoDB carry no hourly charge,
though interface endpoints do bill per-hour and per-GB).

## Security groups vs network ACLs (the stateful/stateless split)
Two layers, deliberately different (this cell complements the SG-vs-NACL pilot doc):
- **Security group** — operates at the **ENI/instance** level, is **stateful** (return traffic for an
  allowed flow is automatically permitted), and supports **allow rules only**.
- **Network ACL** — operates at the **subnet** level, is **stateless** (you must allow both
  directions explicitly), supports **allow AND deny** rules, and evaluates rules in number order.

## Load balancers: ALB (L7) vs NLB (L4)
- **Application Load Balancer (ALB)** operates at **Layer 7 (HTTP/HTTPS)** — it can route on host,
  path, headers, and methods, terminate TLS, and target containers/IPs/Lambda. Use for HTTP/web/API
  routing.
- **Network Load Balancer (NLB)** operates at **Layer 4 (TCP/UDP/TLS)** — it offers ultra-low
  latency, very high throughput, static IPs, and preserves source IP. Use for non-HTTP, extreme
  performance, or static-IP requirements.
They are **not interchangeable**: the choice follows the protocol layer and feature needs, not
preference.

## Route 53
**Route 53** is managed DNS with routing policies (simple, weighted, latency-based, failover,
geolocation, multi-value) and health checks — used for traffic distribution and DNS-level failover.
