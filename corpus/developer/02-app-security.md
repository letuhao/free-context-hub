---
id: corpus/developer/app-security/owasp-top10-authn-authz
domain: developer
subdomain: app-security
topic: owasp-top10-authn-authz
sources:
  - "OWASP Top 10:2025 (read 2026-06-16, CC-BY-SA, paraphrased)"
  - "OWASP Cheat Sheet Series — injection, XSS, CSRF, authn/authz (CC-BY-SA, paraphrased)"
license_posture: own-words-paraphrase
status: drafted
last_reviewed: 2026-06-16
---

# Application security — OWASP Top 10 and authn/authz

## OWASP Top 10 — current edition is 2025
The OWASP Top 10 is a consensus awareness list of the most critical web-app security risks. The
**current release is the 2025 edition** (succeeding 2021). The 2025 ranking:
1. **A01 Broken Access Control** (remains #1)
2. **A02 Security Misconfiguration**
3. **A03 Software Supply Chain Failures** (expanded from the older "Vulnerable & Outdated Components")
4. **A04 Cryptographic Failures**
5. **A05 Injection** (note: dropped from #3 in 2021 to #5 in 2025 — it is no longer the top risk)
6. **A06 Insecure Design**
7. **A07 Authentication Failures**
8. **A08 Software or Data Integrity Failures**
9. **A09 Security Logging and Alerting Failures**
10. **A10 Mishandling of Exceptional Conditions** (new in 2025)

## Authentication vs authorization (distinct)
- **Authentication (authn)** — verifying **who** you are (login, credentials, MFA).
- **Authorization (authz)** — deciding **what** you may do once authenticated (permissions/access
  control).
They are **not the same**; broken access control (an authz failure) is the #1 risk and is separate
from authentication failures.

## Injection — parameterized queries, not escaping
Injection (SQL, command, etc.) happens when untrusted input is interpreted as code/query. The
**primary defense is parameterized queries / prepared statements** (the query structure is fixed and
data can never become code). Hand-rolled **input escaping is fragile and not the recommended fix** —
parameterization is. ORMs that parameterize underneath help, but string-concatenated queries remain
vulnerable regardless of ORM.

## XSS vs CSRF (different attacks, different defenses)
- **XSS (Cross-Site Scripting)** — attacker scripts run in the victim's browser. Defense: **context-
  aware output encoding/escaping** of untrusted data, plus Content-Security-Policy.
- **CSRF (Cross-Site Request Forgery)** — the victim's browser is tricked into making an authenticated
  request. Defense: **anti-CSRF tokens** and **SameSite cookies**.
Encoding stops XSS; tokens/SameSite stop CSRF — they are not interchangeable.

## Cross-cutting rules
- **Validate and enforce on the server.** **Client-side validation is for UX only and is NOT a
  security control** (the client is attacker-controlled).
- **HTTPS protects data in transit but does NOT stop XSS or CSRF** (those are application-layer).
- Handle **secrets** outside code (secret managers/env, never hard-coded or committed); apply
  least-privilege and defense in depth.
