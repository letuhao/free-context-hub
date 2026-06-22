# Security Policy

## Supported Versions

free-context-hub is pre-1.0; the public API and configuration surface may change
between minor releases. Security fixes are provided for supported release lines.

| Version | Supported          |
| ------- | ------------------ |
| 0.1.x   | :white_check_mark: |
| < 0.1   | :x:                |

## Reporting a Vulnerability

**Please do not open a public GitHub issue for security vulnerabilities.**

Report vulnerabilities privately using one of these channels:

1. **Email:** [letuhao1994@gmail.com](mailto:letuhao1994@gmail.com)
2. **GitHub Security Advisories:** use [Report a vulnerability](https://github.com/letuhao/free-context-hub/security/advisories/new) on the repository Security tab.

Include as much detail as you can:

- Affected version or commit
- Component (MCP server, REST API, GUI, worker, docker-compose, etc.)
- Steps to reproduce
- Impact assessment (confidentiality, integrity, availability)
- Proof of concept, if available

## Response Timeline

- **Acknowledgment:** within **5 business days** of a valid report
- **Initial assessment:** within **10 business days**, with severity classification
  and expected fix timeline when possible
- **Updates:** we will keep you informed of progress until the issue is resolved
  or declined with rationale

We may ask for additional information to reproduce or validate the report.

## Disclosure

- We prefer **coordinated disclosure**. Please allow reasonable time to develop
  and release a fix before public disclosure.
- When a fix is available, we will publish a GitHub Security Advisory (and a
  CHANGELOG entry when appropriate) and credit reporters who wish to be named.
- If you need a specific embargo date, mention it in your initial report.

## Scope

**In scope**

- This repository's application code, default docker-compose configuration, and
  documented deployment paths
- Authentication, authorization, and tenant isolation in the MCP server, REST API,
  and GUI
- Injection, SSRF, path traversal, and similar flaws in ingestion, search, or
  export/import flows
- Cryptographic or secret-handling mistakes in the codebase

**Out of scope (operator responsibility)**

free-context-hub is **self-hosted**. Each operator controls their own deployment,
network exposure, TLS termination, firewall rules, database credentials, API keys,
and backup policy.

- Misconfiguration of `.env`, exposed admin ports, or weak operator-chosen secrets
- Vulnerabilities in third-party dependencies already fixed in a supported release
  (please still report if our pinned version is affected)
- Issues that require physical access to the operator's infrastructure
- Social engineering against project maintainers or end users

Secrets belong in `.env` (gitignored). Never commit credentials, tokens, or
private keys to the repository.

## Safe Harbor

We support good-faith security research on your own deployments or clearly
identified test environments. Do not access, modify, or exfiltrate data that is
not yours. Do not perform denial-of-service testing against shared infrastructure
without prior written consent.

Thank you for helping keep free-context-hub and its users safe.
