---
id: corpus/solution-architecture/security-architecture/oauth-zerotrust-multitenancy
domain: solution-architecture
subdomain: security-architecture
topic: oauth-zerotrust-multitenancy
sources:
  - "Wikipedia — OAuth / OpenID Connect / Zero trust architecture (read 2026-06-16, CC-BY-SA, paraphrased)"
  - "IETF RFC 6749 (OAuth 2.0) + OIDC core (OPEN, paraphrased); NIST SP 800-207 Zero Trust (US-gov public domain, paraphrased)"
license_posture: own-words-paraphrase
status: drafted
last_reviewed: 2026-06-16
---

# Security architecture — OAuth2/OIDC, zero trust, multi-tenancy

## Authentication vs authorization
- **Authentication (authn)** — verify **who** the principal is.
- **Authorization (authz)** — decide **what** they may do.
Distinct concerns, and the basis for the most common protocol confusion below.

## OAuth 2.0 is authorization; OpenID Connect adds authentication
**OAuth 2.0 (RFC 6749) is an authorization / delegated-access framework** — it lets a user grant a
client **delegated access** to their resources (via an **access token**) **without sharing their
password**. **OAuth2 is NOT an authentication protocol** by itself (using it as one is a classic
mistake). **OpenID Connect (OIDC)** is an **identity layer on top of OAuth2** that adds
authentication and standardizes user identity via an **ID token**.
- Roles: resource owner, client, authorization server, resource server.
- The recommended browser/mobile flow is **Authorization Code with PKCE** (PKCE protects against
  code interception; the implicit flow is deprecated).
- **Token types:** **access token** (authorizes API calls, short-lived), **refresh token** (obtains
  new access tokens without re-login, long-lived, must be stored securely), **ID token** (OIDC only —
  a JWT asserting *who* the user is, for the client).

## JWTs: signed ≠ encrypted
A standard **JWT (JWS) is signed, not encrypted** — signing gives **integrity and authenticity**
(you can trust it wasn't tampered with) but the payload is only **base64url-encoded and fully
readable**. **A JWT is NOT confidential by default**; never put secrets in one unless you use the
encrypted variant (JWE) or transport protection. (Always send tokens over TLS.)

## Zero trust
**Zero trust** = **"never trust, always verify"**: users and devices are **not trusted by default,
even inside the corporate network/perimeter** (perimeterless security). Access is granted per-request
based on continuously-verified identity, device posture, and least privilege. **A network perimeter
(firewall/VPN) is NOT zero trust** — "inside the network = trusted" is exactly the assumption zero
trust rejects.

## Multi-tenancy isolation
- **Silo model** — each tenant gets dedicated resources (separate DB/stack): strongest isolation,
  higher cost/ops.
- **Pool model** — tenants share infrastructure with logical separation (e.g. a tenant_id column +
  enforced scoping): efficient, but isolation depends entirely on correct application enforcement.
- **Bridge** — mix (shared compute, isolated data, or vice versa).
The core risk in pooled multi-tenancy is **cross-tenant data leakage** if every query/operation isn't
scoped to the tenant; defense-in-depth (row-level security, scoped credentials, tests) matters.

## Cross-cutting
Encrypt **in transit (TLS)** and **at rest**; apply **least privilege** and defense in depth; manage
secrets in a secret store, never in code.
