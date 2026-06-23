# Pre-Release Checklist — Open-Source v0.1.0

Durable planning doc for everything that should happen **before** free-context-hub is
published as open source. Researched against the OpenSSF OSPS Baseline, OWASP Top-10 for
LLM Applications, npm/Node supply-chain guidance, and multi-tenant pentest practice, then
mapped to this repo's actual state.

> **Status:** the QC program (94 scenarios, 4 bugs fixed, security P0s verified, GUI e2e
> 56/56 + regression 4/4) is complete. We are **NOT tagging v0.1.0 yet** — the items below
> are the remaining release work. Plan/execute later.

**Legend:** `[x]` done · `[ ]` todo · `[~]` partial · `[?]` owner decision needed

---

## 0. Already in place ✅

- [x] LICENSE (MIT), README, CHANGELOG
- [x] SECURITY.md with a **private** disclosure contact (letuhao1994@gmail.com)
- [x] CONTRIBUTING.md, CODE_OF_CONDUCT, issue/PR templates
- [x] CI workflow (`ci.yml`: backend typecheck + GUI build) + `phase5-worker-validation.yml`
- [x] Lockfiles committed (`package-lock.json`, `gui/package-lock.json`); **no `.env` tracked**
- [x] Strong internal security work already done:
  - DEFERRED-029 tenant-scope: cold-start adversary, **5 passes / 7 bypasses fixed**, 843 unit + 300 e2e
  - Phase-15 coordination/governance: cold-start hostile-actor reviews; **330/330** automated tests
  - This QC pass (live, hardened stack): adversary suite (22), security trio (ADV-06/11/17),
    COORD-04 fencing, COORD-23 self-approval, ADV-13 stored-XSS, ADV-18 guardrail server-eval,
    cross-tenant 404-no-oracle, actor-spoof block, lease-theft block
  - Defenses: SSRF + DNS-rebinding pin, zip-bomb 413, slow-loris 504
  - **auth-ON by default** (DEPLOYMENT_PROFILE=production); auth bring-up runbook (`docs/ops/auth-bring-up.md`)
  - Authenticated Playwright e2e harness (login + CSRF inject + token seeding) — `npm run test:e2e:gui`

This is a stronger base than most projects launch with. The gaps below turn "well-tested"
into "audited + supply-chain-hardened."

---

## P0 — should block a public v0.1.0

### Security — formalize + close the AI-specific gap
- [ ] **Threat model doc** (`docs/security/THREAT_MODEL.md`) — write down trust boundaries
      (MCP agent ↔ backend ↔ DB ↔ LLM), tenant isolation, secrets, attacker paths. The
      analysis is largely done; capture it.
- [ ] **OWASP LLM Top-10 red-team pass** — *the highest-value new work for this project.*
      As an MCP server + RAG + chat we are most exposed here. Cover at least:
  - [ ] LLM01 **Prompt injection** — direct (chat) AND indirect (poisoned lesson/document/URL
        content influencing the chat tool-use or reflect synthesis)
  - [ ] LLM06 **Excessive agency / tool sandboxing** — MCP tool surface least-privilege; can a
        crafted prompt make an agent call a destructive/cross-tenant tool?
  - [ ] LLM07 **System-prompt leakage** — can the chat reveal its system prompt / guardrail rules?
  - [ ] LLM08 **Vector/embedding weakness** — poisoned lessons/chunks skewing retrieval; the
        review-gate (active-only) helps but verify pending/draft can't be injected into RAG
  - [ ] Add a durable red-team spec (mirror `test/e2e/gui/qc-regression.spec.ts` style)
- [ ] **Multi-tenant isolation test matrix** — formalize the live cross-tenant verification into
      a documented role × surface matrix (every role, every MCP/REST surface). Decide: structured
      self-pentest doc now, external audit later.

### Supply chain
- [ ] `npm audit` (root + `gui/`) clean or documented exceptions; **commit an SCA-violation policy**
      (OpenSSF requires this pre-release)
- [ ] **SBOM** (CycloneDX or SPDX) generated in CI for backend + gui + Docker images
- [ ] **GitHub secret scanning + push protection** enabled as a required check
- [ ] Pin Docker base images by digest; enforce `npm ci` (lockfile integrity) in CI

### Secrets & config hygiene
- [ ] **gitleaks scan of full git history** before the repo goes public (private history becomes
      public on release)
- [ ] Verify no insecure defaults ship — `.env.example` has placeholders only; no baked tokens
      (already avoided — re-verify)

---

## P1 — strongly recommended

- [ ] **CI security gates**: CodeQL (SAST) + Trivy/Grype (container scan) + `npm audit` +
      license-compliance check on every PR + release
- [ ] **License compliance**: verify all deps (backend 29 + 10 dev, plus gui) are MIT-compatible
      (no GPL/AGPL contamination for redistribution)
- [ ] **Expand CI to gate real tests**: unit + coordination (330) + authenticated e2e (56) —
      currently `ci.yml` is only typecheck+build
- [ ] **Dependabot or Renovate** for automated dependency updates
- [ ] **Coordinated disclosure policy** with response SLAs; enable GitHub *private vulnerability
      reporting* (SECURITY.md has the contact, add timeframes)
- [ ] **Signed releases**: GPG-signed tags + GitHub Release with artifacts + SHA256 checksums;
      consider cosign for Docker images + npm provenance
- [ ] **Production deployment hardening doc**: TLS/reverse-proxy in front of `:3002`, loopback-bind
      backend posture, backup/restore, the `migrate:coordination-actors` boot-gate step (OPS-BOOTGATE)

---

## P2 — polish / post-launch

- [ ] **OpenSSF Best Practices Badge** (bestpractices.dev) / **OSPS Baseline** self-assessment —
      strong signal; structured checklist that subsumes much of the above
- [ ] Privacy / data-handling note (what agent memory is stored; telemetry off by default)
- [ ] Trademark / project-name availability check
- [ ] Seed/demo data now that the corpus is clean (209 real lessons); verify quickstart works
      from a clean clone (`docker compose up`)
- [ ] Screenshots/docs current

---

## Owner decisions still open

- [?] **qc-operator credential** — global-admin account in the **dev DB** has a known password
      (`QcOperator!2026`) used as the e2e login (supplied via `E2E_LOGIN_PASSWORD` at runtime, not
      committed). Not in the shipped artifact. Rotate it if this instance is ever exposed, or keep
      it as the designated e2e test operator.
- [?] **External security audit** vs. structured self-pentest for v0.1.0 (cost/timing).
- [?] **Tag location**: tag `v0.1.0` on `release/v0.1.0-prep`, or merge to `main` first.

---

## Sources

- OpenSSF OSPS Baseline — https://baseline.openssf.org/
- OpenSSF Best Practices Badge — https://www.bestpractices.dev
- OpenSSF Concise Guide for Evaluating OSS — https://github.com/ossf/wg-best-practices-os-developers/blob/main/docs/Concise-Guide-for-Evaluating-Open-Source-Software.md
- OWASP Top-10 for LLM Applications — https://owasp.org/www-project-top-10-for-large-language-model-applications/
- OWASP LLM practical checklist — https://thedataguy.pro/writing/2026/03/owasp-top-10-llm-applications-practical-checklist/
- Node.js supply-chain / SBOM / lockfile guide — https://letsbuildsolutions.com/blog/devops/supply-chain-security-for-nodejs-lockfile-integrity-sbom-generation-and-dependency-auditing/
- Anchore JavaScript SBOM guide — https://anchore.com/blog/javascript-sbom-generation/
- SaaS / multi-tenant pentest guide — https://www.wati.com/the-ultimate-guide-to-saas-penetration-testing-in-2025/
- GitHub secret scanning 2026 — https://www.buildmvpfast.com/blog/github-secret-scanning-pattern-updates-devops-2026
- OSS pre-launch checklist (binbash) — https://medium.com/binbash-inc/open-source-github-repository-pre-launch-checklist-4a52dbbe4af1
